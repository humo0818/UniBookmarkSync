import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import ThemeProvider from '../../components/ThemeProvider.jsx';
import StatusIndicator from '../../components/StatusIndicator.jsx';
import browser from '../../../lib/browser-polyfill.js';
import { MESSAGE_TYPES, SYNC_STATUS, ADAPTERS, STORAGE_KEYS, CONFLICT_STRATEGIES } from '../../../shared/constants.js';
import { init, t } from '../../../lib/i18n.js';

async function sendMessageSafe(msg) {
  try { return await browser.runtime.sendMessage(msg); }
  catch (e) { if (!e.message?.includes('Could not establish connection')) console.error(e); return null; }
}

function Popup() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(ADAPTERS.WEBDAV);
  const [syncState, setSyncState] = useState({});
  const [autoSyncWebdav, setAutoSyncWebdav] = useState(true);
  const [autoSyncGit, setAutoSyncGit] = useState(true);
  const [conflictWebdav, setConflictWebdav] = useState('smart-merge');
  const [conflictGit, setConflictGit] = useState('smart-merge');
  const [gitBranch, setGitBranch] = useState('main');
  const [branches, setBranches] = useState(['main']);
  const [gitDesc, setGitDesc] = useState('');
  const [customBranch, setCustomBranch] = useState(false);
  const [gitVersion, setGitVersion] = useState(null);
  const [hasWebdavConfig, setHasWebdavConfig] = useState(false);
  const [hasGitConfig, setHasGitConfig] = useState(false);

  useEffect(() => {
    init().then(() => setReady(true));
    loadConfig();

    let port = browser.runtime.connect({ name: 'popup' });
    const onPortMessage = (msg) => {
      if (msg.type === MESSAGE_TYPES.SYNC_STATUS) {
        if (msg.payload.syncState) setSyncState(msg.payload.syncState);
        if (msg.payload.conflictResolution) setConflictWebdav(msg.payload.conflictResolution); setConflictGit(msg.payload.conflictResolution);
      }
    };
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      port = browser.runtime.connect({ name: 'popup' });
      port.onMessage.addListener(onPortMessage);
      fetchState();
    });
    fetchState();
    loadBranches();

    return () => { try { port.disconnect(); } catch (_) {} };
  }, []);

  async function loadConfig() {
    try {
      const result = await browser.storage.local.get([
        STORAGE_KEYS.SYNC_CONFIG, STORAGE_KEYS.SYNC_STATE,
        STORAGE_KEYS.AUTO_SYNC_WEBDAV, STORAGE_KEYS.AUTO_SYNC_GIT,
        STORAGE_KEYS.CONFLICT_RESOLUTION_WEBDAV, STORAGE_KEYS.CONFLICT_RESOLUTION_GIT,
        STORAGE_KEYS.CONFLICT_RESOLUTION,
      ]);
      const cfg = result[STORAGE_KEYS.SYNC_CONFIG];
      if (cfg) {
        if (cfg.gitBranch) setGitBranch(cfg.gitBranch);
        if (cfg.conflictResolution) { setConflictWebdav(cfg.conflictResolution); setConflictGit(cfg.conflictResolution); }
        setHasWebdavConfig(!!(cfg.webdavUrl && cfg.webdavUser && cfg.webdavPass));
        setHasGitConfig(!!(cfg.gitRemote && cfg.gitToken));
      }
      // Use popup-selected adapter from storage, fall back to config, then webdav
      const activeRes = await browser.storage.local.get(STORAGE_KEYS.ACTIVE_ADAPTER);
      const active = activeRes[STORAGE_KEYS.ACTIVE_ADAPTER];
      if (active === ADAPTERS.WEBDAV || active === ADAPTERS.GIT) setTab(active);
      else if (cfg?.adapter === ADAPTERS.WEBDAV || cfg?.adapter === ADAPTERS.GIT) setTab(cfg.adapter);
      if (result[STORAGE_KEYS.SYNC_STATE]) {
        setSyncState(result[STORAGE_KEYS.SYNC_STATE]);
      }
      if (result[STORAGE_KEYS.AUTO_SYNC_WEBDAV] !== undefined) setAutoSyncWebdav(result[STORAGE_KEYS.AUTO_SYNC_WEBDAV]);
      if (result[STORAGE_KEYS.AUTO_SYNC_GIT] !== undefined) setAutoSyncGit(result[STORAGE_KEYS.AUTO_SYNC_GIT]);
      if (result[STORAGE_KEYS.CONFLICT_RESOLUTION_WEBDAV]) setConflictWebdav(result[STORAGE_KEYS.CONFLICT_RESOLUTION_WEBDAV]);
      if (result[STORAGE_KEYS.CONFLICT_RESOLUTION_GIT]) setConflictGit(result[STORAGE_KEYS.CONFLICT_RESOLUTION_GIT]);
      // Fallback to shared keys
      if (result[STORAGE_KEYS.CONFLICT_RESOLUTION]) {
        setConflictWebdav(result[STORAGE_KEYS.CONFLICT_RESOLUTION]);
        setConflictGit(result[STORAGE_KEYS.CONFLICT_RESOLUTION]);
      }
    } catch (e) { console.error('popup:', e); }
  }

  async function loadBranches() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_CONFIG);
      const cfg = result[STORAGE_KEYS.SYNC_CONFIG];
      if (cfg && cfg.gitRemote && cfg.gitToken) {
        const resp = await sendMessageSafe({
          type: MESSAGE_TYPES.LIST_BRANCHES, payload: { config: cfg },
        });
        if (resp?.ok && resp.branches.length > 0) {
          setBranches(resp.branches);
          if (!resp.branches.includes(gitBranch)) setGitBranch(resp.branches[0]);
        }
        // Also fetch current version
        const verResp = await sendMessageSafe({
          type: MESSAGE_TYPES.GET_VERSION, payload: { config: cfg },
        });
        if (verResp?.ok && verResp.version) setGitVersion(verResp.version);
      }
    } catch (_) {}
  }

  async function fetchState() {
    try {
      const resp = await sendMessageSafe({ type: MESSAGE_TYPES.GET_STATUS });
      if (resp?.syncState) setSyncState(resp.syncState);
      if (resp?.conflictResolution) { setConflictWebdav(resp.conflictResolution); setConflictGit(resp.conflictResolution); }
    } catch (_) {}
  }

  async function handleSync() {
    sendMessageSafe({
      type: MESSAGE_TYPES.MANUAL_SYNC,
      payload: {
        adapter: tab,
        force: true,
        ...(tab === ADAPTERS.GIT ? { branch: autoSync ? '' : gitBranch, description: autoSync ? '' : gitDesc } : {}),
      },
    });
  }

  // Per-adapter states (independent)
  const autoSync = tab === ADAPTERS.WEBDAV ? autoSyncWebdav : autoSyncGit;
  const conflictResolution = tab === ADAPTERS.WEBDAV ? conflictWebdav : conflictGit;

  async function setConflict(val) {
    if (tab === ADAPTERS.WEBDAV) setConflictWebdav(val); else setConflictGit(val);
    const key = tab === ADAPTERS.WEBDAV ? STORAGE_KEYS.CONFLICT_RESOLUTION_WEBDAV : STORAGE_KEYS.CONFLICT_RESOLUTION_GIT;
    await browser.storage.local.set({ [key]: val, [STORAGE_KEYS.CONFLICT_RESOLUTION]: val });
    sendMessageSafe({ type: MESSAGE_TYPES.CONFIG_CHANGED, payload: {} });
  }

  async function toggleAutoSync(val) {
    if (tab === ADAPTERS.WEBDAV) setAutoSyncWebdav(val); else setAutoSyncGit(val);
    const key = tab === ADAPTERS.WEBDAV ? STORAGE_KEYS.AUTO_SYNC_WEBDAV : STORAGE_KEYS.AUTO_SYNC_GIT;
    await browser.storage.local.set({ [key]: val });
    sendMessageSafe({ type: MESSAGE_TYPES.CONFIG_CHANGED, payload: { autoSync: val } });
  }

  const st = syncState[tab] || {};
  const tabStatus = st.status || SYNC_STATUS.IDLE;
  const tabLastSync = st.lastSync || null;
  const tabError = st.error || null;

  function formatTime(iso) {
    if (!iso) return t('never');
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return t('secondsAgo');
    if (min < 60) return t('minutesAgo', String(min));
    const hours = Math.floor(min / 60);
    if (hours < 24) return t('hoursAgo', String(hours));
    return t('daysAgo', String(Math.floor(hours / 24)));
  }

  if (!ready) return null;

  return (
    <ThemeProvider>
      <div class="popup">
        <header class="popup-header">
          <h1>UniBookmarkSync</h1>
        </header>

        <main class="popup-body">
          <StatusIndicator
            status={tabStatus}
            lastSync={tabLastSync}
            bookmarkCount={null}
            errorMessage={tabError}
            adapter={tab === ADAPTERS.WEBDAV ? 'WebDAV' : 'Git'}
            configured={tab === ADAPTERS.WEBDAV ? hasWebdavConfig : hasGitConfig}
          />

          <div class="tab-bar">
            <button
              class={`tab-btn ${tab === ADAPTERS.WEBDAV ? 'tab-btn--active' : ''}`}
              onClick={() => { setTab(ADAPTERS.WEBDAV); setSyncState(prev => ({ ...prev, webdav: { ...(prev.webdav||{}), status: SYNC_STATUS.IDLE } })); sendMessageSafe({ type: MESSAGE_TYPES.ADAPTER_CHANGED, payload: { adapter: ADAPTERS.WEBDAV } }); }}
            >{t('webdav')}</button>
            <button
              class={`tab-btn ${tab === ADAPTERS.GIT ? 'tab-btn--active' : ''}`}
              onClick={() => { setTab(ADAPTERS.GIT); setSyncState(prev => ({ ...prev, git: { ...(prev.git||{}), status: SYNC_STATUS.IDLE } })); sendMessageSafe({ type: MESSAGE_TYPES.ADAPTER_CHANGED, payload: { adapter: ADAPTERS.GIT } }); }}
            >{t('git')}</button>
          </div>

          {((tab === ADAPTERS.WEBDAV && !hasWebdavConfig) || (tab === ADAPTERS.GIT && !hasGitConfig)) ? (
            <button class="btn-primary sync-btn-full"
              onClick={async () => { await browser.storage.local.set({ [STORAGE_KEYS.ACTIVE_ADAPTER]: tab }); browser.runtime.openOptionsPage(); }}>
              {t('goToSettings')}
            </button>
          ) : (
            <button class="btn-primary sync-btn-full"
              onClick={handleSync}
              disabled={tabStatus === SYNC_STATUS.SYNCING}>
              {tabStatus === SYNC_STATUS.SYNCING && <span class="sync-spinner" />}
              {tabStatus === SYNC_STATUS.SYNCING ? t('statusSyncing') : t('syncNow')}
            </button>
          )}
          {tabError && tabStatus !== SYNC_STATUS.SYNCING && (
            <p class="sync-error-hint">{tabError}</p>
          )}

          {tab === ADAPTERS.WEBDAV && (
            <div class="mode-panel">
              <div class="info-row">
                <span class="info-label">{t('syncMode')}</span>
                {autoSync ? (
                  <span class="info-value">{t(conflictResolution)}</span>
                ) : (
                  <select class="field-input" value={conflictResolution}
                    onChange={(e) => setConflict(e.target.value)}
                    style="flex:1;font-size:var(--font-size-xs);padding:2px 4px;">
                    <option value={CONFLICT_STRATEGIES.SMART_MERGE}>{t('smart-merge')}</option>
                    <option value={CONFLICT_STRATEGIES.LOCAL_FIRST}>{t('local-first')}</option>
                    <option value={CONFLICT_STRATEGIES.REMOTE_FIRST}>{t('remote-first')}</option>
                  </select>
                )}
              </div>
              <div class="info-row">
                <span class="info-label">{t('autoSync')}</span>
                <button
                  class={`toggle-switch ${autoSync ? 'toggle--on' : ''}`}
                  onClick={() => toggleAutoSync(!autoSync)}
                ><span class="toggle-knob" /></button>
              </div>
            </div>
          )}

          {tab === ADAPTERS.GIT && (
            <div class="mode-panel">
              {autoSync ? (
                <div class="info-rows">
                  <div class="info-row">
                    <span class="info-label">{t('syncMode')}</span>
                    <span class="info-value">{t(conflictResolution)}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{t('gitBranch')}</span>
                    <span class="info-value">{gitBranch}</span>
                  </div>
                  <div class="info-row">
                    <span class="info-label">{t('gitVersion')}</span>
                    <span class="info-value version-msg">
                      {gitVersion ? gitVersion.message : (hasGitConfig ? t('loadingCommits') : '')}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div class="info-row">
                    <span class="info-label">{t('syncMode')}</span>
                    <select class="field-input" value={conflictResolution}
                      onChange={(e) => setConflict(e.target.value)}
                      style="flex:1;font-size:var(--font-size-xs);padding:2px 4px;">
                      <option value={CONFLICT_STRATEGIES.LOCAL_FIRST}>{t('local-first')}</option>
                      <option value={CONFLICT_STRATEGIES.REMOTE_FIRST}>{t('remote-first')}</option>
                      <option value={CONFLICT_STRATEGIES.SMART_MERGE}>{t('smart-merge')}</option>
                    </select>
                  </div>
                  <div class="field-row">
                    <label class="field-label">{t('gitBranch')}</label>
                    {customBranch ? (
                      <div class="field-input-wrap">
                        <input class="field-input" type="text" value={gitBranch}
                          onInput={(e) => setGitBranch(e.target.value)} placeholder="branch name" />
                        <button class="field-input-clear" onClick={() => { setCustomBranch(false); setGitBranch(branches[0]||'main'); }}>✕</button>
                      </div>
                    ) : (
                      <select class="field-input" value={gitBranch}
                        onChange={(e) => {
                          if (e.target.value === '__new__') { setCustomBranch(true); setGitBranch(''); }
                          else setGitBranch(e.target.value);
                        }}>
                        {branches.map(b => <option key={b} value={b}>{b}</option>)}
                        <option value="__new__">+ {t('newBranch')}</option>
                      </select>
                    )}
                  </div>
                  <div class="field-row">
                    <label class="field-label">{t('gitDesc')}</label>
                    <input class="field-input" type="text" value={gitDesc}
                      onInput={(e) => setGitDesc(e.target.value)} placeholder={t('gitDescPlaceholder')} />
                  </div>
                </>
              )}
              <div class="info-row" style={autoSync ? {marginTop:'var(--space-2)',paddingTop:'var(--space-2)',borderTop:'1px solid var(--color-border)'} : {}}>
                <span class="info-label">{t('autoSync')}</span>
                <button
                  class={`toggle-switch ${autoSync ? 'toggle--on' : ''}`}
                  onClick={() => toggleAutoSync(!autoSync)}
                ><span class="toggle-knob" /></button>
              </div>
            </div>
          )}
        </main>

        <footer class="popup-footer">
          <button class="btn-ghost" onClick={() => browser.runtime.openOptionsPage()}>
            {t('settings')}
          </button>
        </footer>
      </div>
    </ThemeProvider>
  );
}

render(<Popup />, document.getElementById('app'));
