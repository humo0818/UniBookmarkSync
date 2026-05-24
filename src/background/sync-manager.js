/**
 * Sync Manager — core orchestrator for bookmark synchronization.
 *
 * Responsibilities:
 * - Monitor bookmark changes and debounce auto-sync triggers
 * - Dispatch sync operations (WebDAV / Git) via configured adapter
 * - Broadcast status updates to connected popup ports
 * - Handle manual sync, config changes, rollback, and commit listing
 */
import browser from '../lib/browser-polyfill.js';
import * as logger from '../lib/logger.js';
import {
  SYNC_DEBOUNCE_MS, SYNC_HEARTBEAT_MINUTES, SYNC_TIMEOUT_MS, MESSAGE_TYPES,
  SYNC_STATUS, CONFLICT_STRATEGIES, ADAPTERS, STORAGE_KEYS,
} from '../shared/constants.js';
import { ConflictError, AuthError, NetworkError, ConfigError } from '../shared/errors.js';
import { startMonitoring } from './bookmark-monitor.js';
import * as storage from './storage.js';
import debounce from '../lib/debounce.js';
import { serialize } from '../lib/bookmark-tree.js';
import sha256 from '../lib/hash.js';
import diff from '../lib/bookmark-diff.js';
import { createAdapter } from '../sync-adapters/adapter-registry.js';
import SyncQueue from './sync-queue.js';

const LOG_TAG = 'sync-manager';

// ── Module state ────────────────────────────────────
let activeAdapter = null;
let activeConfig = null;
let lastLocalTree = null;
let connectedPorts = [];
let pendingSyncFlags = {};
let autoSyncEnabled = true;
let popupSelectedAdapter = null; // Adapter selected in popup tabs
const operationQueue = new SyncQueue();

// ── Public API ─────────────────────────────────────

/** Initialize the sync manager. Called once on service worker startup. */
export function init() {
  initAsync();
}

// ── Initialization ─────────────────────────────────

async function initAsync() {
  await loadActiveAdapter();
  loadAutoSyncPreference();
  // Load popup-selected adapter (takes priority over settings)
  const r = await browser.storage.local.get(STORAGE_KEYS.ACTIVE_ADAPTER);
  popupSelectedAdapter = r[STORAGE_KEYS.ACTIVE_ADAPTER] || null;
  // Clear any stuck SYNCING/ERROR/CONFLICT status from previous shutdown
  const state = await storage.getSyncState();
  for (const [adapter, s] of Object.entries(state)) {
    if (s.status !== SYNC_STATUS.IDLE) {
      await storage.setAdapterStatus(adapter, SYNC_STATUS.IDLE);
    }
  }
  // Restore persisted tree for diff computation after service worker restart
  if (activeConfig) {
    lastLocalTree = await storage.getLastTree(activeConfig.adapter);
  }

  startMonitoring(onBookmarkChanged);

  // Periodic heartbeat to catch any missed changes
  browser.alarms.create('sync-heartbeat', { periodInMinutes: SYNC_HEARTBEAT_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync-heartbeat' && autoSyncEnabled) {
      logger.debug(LOG_TAG, 'Heartbeat triggered');
      performSync();
    }
  });

  // Popup port management
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
      connectedPorts.push(port);
      port.onDisconnect.addListener(() => {
        connectedPorts = connectedPorts.filter((p) => p !== port);
      });
      broadcastStatus();
    }
  });

  // Message dispatch from popup and options pages
  browser.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case MESSAGE_TYPES.MANUAL_SYNC:
        logger.info(LOG_TAG, 'Manual sync requested');
        pendingSyncFlags = msg.payload || {};
        debouncedSync.flush();
        performSync();
        break;
      case MESSAGE_TYPES.CONFIG_CHANGED:
        logger.info(LOG_TAG, 'Config changed');
        if (msg.payload && typeof msg.payload.autoSync === 'boolean') {
          autoSyncEnabled = msg.payload.autoSync;
        } else {
          loadActiveAdapter();
        }
        break;
      case MESSAGE_TYPES.GET_STATUS:
        return buildStatusResponse();
      case MESSAGE_TYPES.TEST_CONNECTION:
        return handleTestConnection(msg.payload);
      case MESSAGE_TYPES.ROLLBACK:
        return handleRollback(msg.payload);
      case MESSAGE_TYPES.LIST_COMMITS:
        return handleListCommits(msg.payload);
      case MESSAGE_TYPES.ROLLBACK_TO:
        return handleRollbackTo(msg.payload);
      case MESSAGE_TYPES.LIST_BRANCHES:
        return handleListBranches(msg.payload);
      case MESSAGE_TYPES.GET_VERSION:
        return handleGetVersion(msg.payload);
      case MESSAGE_TYPES.ADAPTER_CHANGED:
        popupSelectedAdapter = msg.payload?.adapter || null;
        browser.storage.local.set({ [STORAGE_KEYS.ACTIVE_ADAPTER]: popupSelectedAdapter });
        broadcastStatus();
        break;
    }
  });

  logger.info(LOG_TAG, 'Initialized');
}

/** Load the configured sync adapter from storage. */
async function loadActiveAdapter() {
  try {
    activeConfig = await storage.getSyncConfig();
    if (activeConfig && activeConfig.adapter) {
      activeAdapter = createAdapter(activeConfig);
      logger.info(LOG_TAG, `Adapter loaded: ${activeConfig.adapter}`);
    } else {
      activeAdapter = null;
    }
    broadcastStatus();
  } catch (err) {
    logger.error(LOG_TAG, 'Failed to load adapter', err);
    activeAdapter = null;
  }
}

/** Read auto-sync toggle from storage (default: on). */
let autoSyncCache = {};

async function loadAutoSyncPreference() {
  try {
    const result = await browser.storage.local.get([STORAGE_KEYS.AUTO_SYNC_WEBDAV, STORAGE_KEYS.AUTO_SYNC_GIT]);
    autoSyncCache = {
      webdav: result[STORAGE_KEYS.AUTO_SYNC_WEBDAV] !== false,
      git: result[STORAGE_KEYS.AUTO_SYNC_GIT] !== false,
    };
  } catch { autoSyncCache = { webdav: true, git: true }; }
}

async function isAdapterAutoSyncOn(adapter) {
  const key = adapter === ADAPTERS.WEBDAV ? STORAGE_KEYS.AUTO_SYNC_WEBDAV : STORAGE_KEYS.AUTO_SYNC_GIT;
  const r = await browser.storage.local.get(key);
  return r[key] !== false;
}

// ── Bookmark change handler ─────────────────────────

const debouncedSync = debounce(() => {
  operationQueue.enqueue(() => performSync());
}, SYNC_DEBOUNCE_MS);

async function onBookmarkChanged(event) {
  const adapter = popupSelectedAdapter || activeConfig?.adapter;
  if (adapter && !(await isAdapterAutoSyncOn(adapter))) {
    logger.debug(LOG_TAG, `Auto-sync off for ${adapter}, ignoring`);
    return;
  }
  logger.debug(LOG_TAG, 'Bookmark event:', event.type);
  debouncedSync();
}

// ── Core sync logic ─────────────────────────────────

async function performSync() {
  // Retry adapter load if service worker just started
  if (!activeAdapter || !activeConfig) {
    await loadActiveAdapter();
  }
  if (!activeAdapter || !activeConfig) {
    logger.info(LOG_TAG, 'No adapter — skipping');
    return;
  }

  const configAdapter = activeConfig.adapter;
  let syncAdapter = popupSelectedAdapter || pendingSyncFlags.adapter || configAdapter;
  logger.info(LOG_TAG, `Sync start: configAdapter=${configAdapter}`);

  try {
    const bookmarkTree = await serialize();
    const currentHash = await sha256(bookmarkTree);

    // Use popup-selected adapter as the sync target
    syncAdapter = popupSelectedAdapter || pendingSyncFlags.adapter || configAdapter;
    logger.info(LOG_TAG, `Sync using: popup=${popupSelectedAdapter} pending=${pendingSyncFlags.adapter} config=${configAdapter} → ${syncAdapter}`);

    const previousHash = await storage.getLastSyncedHash(syncAdapter);
    logger.info(LOG_TAG, `Hash: current=${currentHash.slice(0,8)} previous=${(previousHash||'').slice(0,8)}`);

    // Skip if nothing changed (unless manual force-sync)
    if (currentHash === previousHash && !pendingSyncFlags.force) {
      logger.info(LOG_TAG, 'No changes — skipping');
      await storage.setAdapterStatus(syncAdapter, SYNC_STATUS.IDLE);
      broadcastStatus();
      return;
    }

    // Compute change diff for commit messages
    const changeInfo = lastLocalTree
      ? buildChangeSummary(lastLocalTree, bookmarkTree)
      : { totalBookmarks: countTreeBookmarks(bookmarkTree), added: 0, removed: 0, modified: 0 };
    logger.info(LOG_TAG, `Change summary: +${changeInfo.added} -${changeInfo.removed} ~${changeInfo.modified}`);
    lastLocalTree = bookmarkTree;
    storage.saveLastTree(syncAdapter, bookmarkTree);

    await storage.setAdapterStatus(syncAdapter, SYNC_STATUS.SYNCING);
    broadcastStatus();

    // Wrap sync in timeout
    const syncPromise = (async () => {
      if (syncAdapter === ADAPTERS.GIT && activeConfig.gitRemote) {
        activeAdapter = createAdapter({ ...activeConfig, adapter: ADAPTERS.GIT });
        await syncViaGit(bookmarkTree, currentHash, ADAPTERS.GIT, changeInfo, !previousHash);
      } else if (syncAdapter === ADAPTERS.WEBDAV && activeConfig.webdavUrl) {
        activeAdapter = createAdapter({ ...activeConfig, adapter: ADAPTERS.WEBDAV });
        await syncViaWebDAV(bookmarkTree, currentHash, ADAPTERS.WEBDAV);
      } else {
        throw new ConfigError(`Cannot sync via ${syncAdapter}: not configured`);
      }
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new NetworkError('Sync timed out after 30s')), SYNC_TIMEOUT_MS)
    );

    try {
      await Promise.race([syncPromise, timeoutPromise]);
    } catch (err) {
      await handleSyncError(err, syncAdapter);
    }
  } catch (err) {
    await handleSyncError(err, syncAdapter);
  }
}

/** Push bookmarks to Git (GitHub/GitLab API). */
async function syncViaGit(tree, currentHash, adapterId, changeInfo, isFirstSync) {
  logger.info(LOG_TAG, 'Git push...');

  const branch = pendingSyncFlags.branch || activeConfig.gitBranch;
  if (branch && branch !== activeAdapter.branch) {
    activeAdapter.branch = branch;
  }

  const desc = pendingSyncFlags.description || '';
  await activeAdapter.pushLocal(tree, {
    changeSummary: changeInfo,
    description: desc,
    addedList: namesFromDiff(changeInfo.addedDiff),
    removedList: namesFromDiff(changeInfo.removedDiff),
    modifiedList: (changeInfo.modifiedDiff || []).map(d => d.new?.title || d.title).filter(Boolean),
    isFirstSync,
  });

  pendingSyncFlags = {};
  await storage.setLastSyncedHash(adapterId, currentHash);
  await storage.setLastSyncTimestamp(adapterId, new Date().toISOString());
  await storage.setAdapterStatus(adapterId, SYNC_STATUS.IDLE);
  broadcastStatus();
  logger.info(LOG_TAG, 'Git sync done');
}

/** Push bookmarks to WebDAV with conflict resolution. */
async function syncViaWebDAV(tree, hash, adapterId) {
  let remoteTree = null;
  let remoteHash = null;

  try {
    const remote = await activeAdapter.fetchRemote();
    if (remote.status === 'changed') {
      remoteTree = remote.tree;
      remoteHash = await sha256(remoteTree);
    }
  } catch (err) {
    if (err instanceof NetworkError || err instanceof AuthError) throw err;
    logger.warn(LOG_TAG, 'Remote fetch failed, pushing local', err);
  }

  const strategy = await storage.getConflictResolution();
  if (remoteTree && remoteHash && remoteHash !== hash) {
    if (strategy !== CONFLICT_STRATEGIES.REMOTE_FIRST) {
      await activeAdapter.pushLocal(tree);
    }
  } else {
    await activeAdapter.pushLocal(tree);
  }

  await storage.setLastSyncedHash(adapterId, hash);
  await storage.setLastSyncTimestamp(adapterId, new Date().toISOString());
  await storage.setAdapterStatus(adapterId, SYNC_STATUS.IDLE);
  broadcastStatus();
}

/** Map sync errors to appropriate status codes. */
async function handleSyncError(err, adapterId) {
  logger.error(LOG_TAG, 'Sync failed', err);
  let message = err.message || 'Unknown error';
  let status = SYNC_STATUS.ERROR;

  if (err instanceof ConflictError) {
    message = 'Remote conflict detected';
    status = SYNC_STATUS.CONFLICT;
  } else if (err instanceof AuthError) {
    message = `Auth error: ${err.message}`;
  } else if (err instanceof NetworkError) {
    message = `Network error: ${err.message}`;
  }

  await storage.setAdapterStatus(adapterId, status, message);
  broadcastStatus();
}

// ── Status broadcasting ─────────────────────────────

async function broadcastStatus() {
  const state = await storage.getSyncState();
  const conflictRes = await storage.getConflictResolution();
  const bookmarkCount = lastLocalTree ? countTreeBookmarks(lastLocalTree) : null;

  const payload = {
    adapter: activeConfig?.adapter || null,
    config: activeConfig || null,
    syncState: state,
    conflictResolution: conflictRes,
    bookmarkCount,
  };

  for (const port of connectedPorts) {
    try { port.postMessage({ type: MESSAGE_TYPES.SYNC_STATUS, payload }); } catch { /* port closed */ }
  }
}

async function buildStatusResponse() {
  return {
    adapter: activeConfig?.adapter || null,
    config: activeConfig || null,
    syncState: await storage.getSyncState(),
    conflictResolution: await storage.getConflictResolution(),
  };
}

// ── Message handlers ────────────────────────────────

async function handleTestConnection({ adapter, config }) {
  try {
    const testAdapter = createAdapter({ ...config, adapter });
    return await testAdapter.testConnection();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetVersion({ config }) {
  try {
    const gitAdapter = createAdapter({ ...config, adapter: ADAPTERS.GIT });
    const version = await gitAdapter.getCurrentVersion();
    return { ok: true, version };
  } catch (err) {
    return { ok: false, version: null, error: err.message };
  }
}

async function handleListBranches({ config }) {
  try {
    const gitAdapter = createAdapter({ ...config, adapter: ADAPTERS.GIT });
    return { ok: true, branches: await gitAdapter.listBranches() };
  } catch (err) {
    return { ok: false, branches: [], error: err.message };
  }
}

async function handleRollback({ config }) {
  try {
    const gitAdapter = createAdapter({ ...config, adapter: ADAPTERS.GIT });
    return await gitAdapter.rollbackTo();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleListCommits({ config }) {
  try {
    const gitAdapter = createAdapter({ ...config, adapter: ADAPTERS.GIT });
    return await gitAdapter.listCommits();
  } catch (err) {
    return { ok: false, error: err.message, commits: [] };
  }
}

async function handleRollbackTo({ config, oid }) {
  logger.info(LOG_TAG, `Rollback to ${oid}`);
  try {
    const gitAdapter = createAdapter({ ...config, adapter: ADAPTERS.GIT });
    const result = await gitAdapter.rollbackTo(oid);

    if (result.ok && result.tree) {
      const { restoreTree } = await import('../lib/bookmark-tree.js');
      await restoreTree(result.tree);

      const hashMod = await import('../lib/hash.js');
      const sha = await hashMod.default(result.tree);

      await storage.setLastSyncedHash(ADAPTERS.GIT, sha);
      await storage.setLastSyncTimestamp(ADAPTERS.GIT, new Date().toISOString());
      await storage.setAdapterStatus(ADAPTERS.GIT, SYNC_STATUS.IDLE);
      lastLocalTree = result.tree;
      storage.saveLastTree(ADAPTERS.GIT, result.tree);
      broadcastStatus();
      logger.info(LOG_TAG, 'Rollback applied to local bookmarks');
    }
    return result;
  } catch (err) {
    logger.error(LOG_TAG, 'Rollback error', err);
    return { ok: false, error: err.message };
  }
}

// ── Helpers ─────────────────────────────────────────

function buildChangeSummary(oldTree, newTree) {
  const d = diff(oldTree, newTree);
  return {
    totalBookmarks: countTreeBookmarks(newTree),
    added: d.added.length,
    removed: d.removed.length,
    modified: d.modified.length,
    addedDiff: d.added,
    removedDiff: d.removed,
    modifiedDiff: d.modified,
  };
}

function namesFromDiff(diffEntries) {
  if (!diffEntries) return [];
  return diffEntries.map(e => e.title || e.node?.title).filter(Boolean);
}

function countTreeBookmarks(tree) {
  let total = 0;
  for (const root of Object.values(tree.roots || {})) {
    total += countBookmarkNodes(root);
  }
  return total;
}

function countBookmarkNodes(node) {
  let count = node.url ? 1 : 0;
  if (node.children) {
    for (const child of node.children) count += countBookmarkNodes(child);
  }
  return count;
}
