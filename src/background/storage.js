/**
 * Storage layer — wraps browser.storage.local for sync state persistence.
 *
 * Uses a single key (SYNC_STATE) to store per-adapter status, hashes, and timestamps.
 * Sync config and preferences are stored in separate keys.
 */
import browser from '../lib/browser-polyfill.js';
import { STORAGE_KEYS, SYNC_STATUS } from '../shared/constants.js';

const STATE_KEY = STORAGE_KEYS.SYNC_STATE;

// ── Internal helpers ────────────────────────────────

async function loadState() {
  const result = await browser.storage.local.get(STATE_KEY);
  return result[STATE_KEY] || {};
}

async function saveState(state) {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

/** Get or create the per-adapter state object. */
async function getAdapterEntry(adapter) {
  const state = await loadState();
  if (!state[adapter]) state[adapter] = {};
  return { state, entry: state[adapter] };
}

// ── Sync config ────────────────────────────────────

export async function getSyncConfig() {
  const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_CONFIG);
  return result[STORAGE_KEYS.SYNC_CONFIG] || null;
}

export async function setSyncConfig(config) {
  await browser.storage.local.set({ [STORAGE_KEYS.SYNC_CONFIG]: config });
}

// ── Per-adapter sync state ─────────────────────────

export async function getLastSyncedHash(adapter) {
  const state = await loadState();
  return state[adapter]?.lastHash || null;
}

export async function setLastSyncedHash(adapter, hash) {
  const { state, entry } = await getAdapterEntry(adapter);
  entry.lastHash = hash;
  await saveState(state);
}

export async function getLastSyncTimestamp(adapter) {
  const state = await loadState();
  return state[adapter]?.lastSync || null;
}

export async function setLastSyncTimestamp(adapter, iso) {
  const { state, entry } = await getAdapterEntry(adapter);
  entry.lastSync = iso;
  await saveState(state);
}

export async function getAdapterStatus(adapter) {
  const state = await loadState();
  return state[adapter]?.status || SYNC_STATUS.IDLE;
}

export async function setAdapterStatus(adapter, status, error) {
  const { state, entry } = await getAdapterEntry(adapter);
  entry.status = status;
  entry.error = error || null;
  await saveState(state);
}

export async function getSyncState() {
  return loadState();
}

// ── Other settings ─────────────────────────────────

export async function getConflictResolution() {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.CONFLICT_RESOLUTION,
    STORAGE_KEYS.SYNC_CONFIG,
  ]);
  return result[STORAGE_KEYS.CONFLICT_RESOLUTION]
    || result[STORAGE_KEYS.SYNC_CONFIG]?.conflictResolution
    || 'smart-merge';
}

export async function saveLastTree(adapter, tree) {
  const { state, entry } = await getAdapterEntry(adapter);
  entry.lastTree = tree;
  await saveState(state);
}

export async function getLastTree(adapter) {
  const state = await loadState();
  return state[adapter]?.lastTree || null;
}

export async function getThemePreference() {
  const result = await browser.storage.sync.get(STORAGE_KEYS.THEME_PREFERENCE);
  return result[STORAGE_KEYS.THEME_PREFERENCE] || 'auto';
}
