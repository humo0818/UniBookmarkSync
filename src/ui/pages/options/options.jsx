import { render } from 'preact';
import { useState, useEffect, useContext } from 'preact/hooks';
import ThemeProvider, { ThemeContext } from '../../components/ThemeProvider.jsx';
import browser from '../../../lib/browser-polyfill.js';
import { init, setLang, getLang, t } from '../../../lib/i18n.js';
import {
  ADAPTERS, THEMES, CONFLICT_STRATEGIES,
  STORAGE_KEYS, MESSAGE_TYPES,
} from '../../../shared/constants.js';

function CommitList({ config, onClose }) {
  const [commits, setCommits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rollingBack, setRollingBack] = useState(null);

  useEffect(() => {
    loadCommits();
  }, []);

  async function loadCommits() {
    setLoading(true);
    setError(null);
    try {
      const res = await browser.runtime.sendMessage({
        type: MESSAGE_TYPES.LIST_COMMITS,
        payload: { config },
      });
      if (res?.ok) {
        setCommits(res.commits);
      } else {
        setError(res?.error || t('connectionFail'));
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function handleRollbackTo(oid) {
    if (!confirm(t('rollbackConfirm'))) return;
    setRollingBack(oid);
    try {
      const res = await browser.runtime.sendMessage({
        type: MESSAGE_TYPES.ROLLBACK_TO,
        payload: { config, oid },
      });
      if (res?.ok) {
        setCommits(null);
        onClose(t('rollbackDone'));
      } else {
        alert(res?.error || t('connectionFail'));
      }
    } catch (err) {
      alert(err.message);
    }
    setRollingBack(null);
  }

  if (loading) {
    return (
      <div class="commit-panel">
        <p class="commit-loading">{t('loadingCommits')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="commit-panel">
        <p class="commit-error">{error}</p>
        <button class="btn-secondary" onClick={loadCommits}>{t('loadCommits')}</button>
      </div>
    );
  }

  if (!commits || commits.length === 0) {
    return (
      <div class="commit-panel">
        <p class="commit-empty">{t('noCommits')}</p>
      </div>
    );
  }

  return (
    <div class="commit-panel">
      <h3 class="commit-title">{t('rollback')}</h3>
      <div class="commit-list">
        {commits.map((c, i) => (
          <div key={c.oid} class={`commit-item ${c.isCurrent ? 'commit-item--current' : ''}`}>
            <div class="commit-info">
              <span class="commit-msg">{c.message}</span>
              <span class="commit-time">{formatDate(c.timestamp)}</span>
            </div>
            <div class="commit-actions">
              {c.isCurrent ? (
                <span class="commit-badge">{t('currentVersion')}</span>
              ) : (
                <button
                  class="btn-small"
                  onClick={() => handleRollbackTo(c.oid)}
                  disabled={rollingBack === c.oid}
                >
                  {rollingBack === c.oid ? '...' : t('rollbackTo')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('secondsAgo');
  if (mins < 60) return t('minutesAgo', String(mins));
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

function Options() {
  const { theme, setTheme } = useContext(ThemeContext);
  const [adapter, setAdapter] = useState(ADAPTERS.WEBDAV);
  const [config, setConfig] = useState({
    webdavUrl: '',
    webdavUser: '',
    webdavPass: '',
    gitRemote: '',
    gitBranch: 'main',
    gitToken: '',
  });
  const [conflictStrategy, setConflictStrategy] = useState(CONFLICT_STRATEGIES.SMART_MERGE);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);
  const [testedAdapter, setTestedAdapter] = useState(null);
  const [saved, setSaved] = useState(false);
  const [lang, setLangState] = useState(getLang());
  const [showCommits, setShowCommits] = useState(false);
  const [rollbackMsg, setRollbackMsg] = useState(null);
  const [branches, setBranches] = useState(['main']);
  const [customBranch, setCustomBranch] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    init().then(() => {
      setLangState(getLang());
      setReady(true);
    });
    // Sync adapter and conflict strategy with popup changes
    const storageHandler = (changes) => {
      if (changes[STORAGE_KEYS.ACTIVE_ADAPTER]) {
        const newAdapter = changes[STORAGE_KEYS.ACTIVE_ADAPTER].newValue;
        if (newAdapter) setAdapter(newAdapter);
      }
      if (changes[STORAGE_KEYS.CONFLICT_RESOLUTION]) {
        const newStrategy = changes[STORAGE_KEYS.CONFLICT_RESOLUTION].newValue;
        if (newStrategy) setConflictStrategy(newStrategy);
      }
    };
    browser.storage.onChanged.addListener(storageHandler);
    browser.storage.local.get([STORAGE_KEYS.SYNC_CONFIG, STORAGE_KEYS.ACTIVE_ADAPTER]).then((result) => {
      const cfg = result[STORAGE_KEYS.SYNC_CONFIG];
      if (cfg) {
        const { adapter: _, conflictResolution: __, ...restCfg } = cfg;
        setConfig((prev) => ({ ...prev, ...restCfg }));
        setConflictStrategy(cfg.conflictResolution || CONFLICT_STRATEGIES.LOCAL_FIRST);
        if (cfg.gitRemote && cfg.gitToken) loadBranches(cfg);
      }
      // Use popup-selected adapter first, then config
      const active = result[STORAGE_KEYS.ACTIVE_ADAPTER];
      console.log('Options load: ACTIVE_ADAPTER=', active, 'cfg.adapter=', cfg?.adapter);
      if (active === ADAPTERS.WEBDAV || active === ADAPTERS.GIT) setAdapter(active);
      else if (cfg?.adapter) setAdapter(cfg.adapter);
    });
  }, []);

  async function loadBranches(cfg) {
    try {
      const resp = await browser.runtime.sendMessage({
        type: MESSAGE_TYPES.LIST_BRANCHES, payload: { config: cfg },
      });
      if (resp?.ok && resp.branches.length > 0) {
        setBranches(resp.branches);
      }
    } catch (_) {}
  }

  function updateConfig(key, value) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function saveConfig() {
    // Exclude 'adapter' from config state — it's tracked separately in `adapter` state
    const { adapter: _a, ...cfgFields } = config;
    const cfg = { adapter, ...cfgFields, conflictResolution: conflictStrategy };
    // Only clear sync state if the git remote URL changed (new repo)
    const old = await browser.storage.local.get(STORAGE_KEYS.SYNC_CONFIG);
    const oldRemote = old[STORAGE_KEYS.SYNC_CONFIG]?.gitRemote || '';
    const newRemote = config.gitRemote || '';
    if (newRemote && newRemote !== oldRemote) {
      await browser.storage.local.remove(STORAGE_KEYS.SYNC_STATE);
    }
    await browser.storage.local.set({
      [STORAGE_KEYS.SYNC_CONFIG]: cfg,
      [STORAGE_KEYS.CONFLICT_RESOLUTION]: conflictStrategy,
    });
    browser.runtime.sendMessage({ type: MESSAGE_TYPES.CONFIG_CHANGED, payload: cfg });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    setTestedAdapter(adapter);
    try {
      const res = await browser.runtime.sendMessage({
        type: MESSAGE_TYPES.TEST_CONNECTION,
        payload: { adapter, config },
      });
      setTestResult(res.ok ? 'ok' : 'fail');
      if (!res.ok) setTestError(res.error || '');
    } catch (e) {
      setTestResult('fail');
      setTestError(e.message || '');
    }
    setTesting(false);
  }

  function handleShowCommits() {
    setShowCommits(!showCommits);
    setRollbackMsg(null);
  }

  function handleCommitClose(msg) {
    setShowCommits(false);
    if (msg) setRollbackMsg(msg);
  }

  async function saveAndReload() {
    const { adapter: _a, ...cfgFields } = config;
    const cfg = { adapter, ...cfgFields, conflictResolution: conflictStrategy };
    const old = await browser.storage.local.get(STORAGE_KEYS.SYNC_CONFIG);
    const oldRemote = old[STORAGE_KEYS.SYNC_CONFIG]?.gitRemote || '';
    if (config.gitRemote && config.gitRemote !== oldRemote) {
      await browser.storage.local.remove(STORAGE_KEYS.SYNC_STATE);
    }
    await browser.storage.local.set({
      [STORAGE_KEYS.SYNC_CONFIG]: cfg,
      [STORAGE_KEYS.CONFLICT_RESOLUTION]: conflictStrategy,
      [STORAGE_KEYS.AUTO_SYNC]: true,
      [STORAGE_KEYS.THEME_PREFERENCE]: theme,
    });
    setSaved(true);
    setTimeout(() => browser.runtime.reload(), 600);
  }

  async function handleLangChange(newLang) {
    await setLang(newLang);
    setLangState(newLang);
  }

  if (!ready) return null;

  return (
    <div class="options">
      <header class="options-header">
        <h1>UniBookmarkSync</h1>
        <p class="subtitle">{t('settings')}</p>
      </header>

      <main class="options-body">
        <section class="card">
          <h2>{t('provider')}</h2>
          <div class="radio-group">
            {[ADAPTERS.WEBDAV, ADAPTERS.GIT].map((a) => (
              <button
                key={a}
                class={`radio-item ${adapter === a ? 'selected' : ''}`}
                onClick={() => { setAdapter(a); setSaved(false); setShowCommits(false); setTestResult(null); setTestError(null); if (a === ADAPTERS.GIT && config.gitRemote) loadBranches(config); }}
              >
                {t(a)}
              </button>
            ))}
          </div>

          {adapter === ADAPTERS.WEBDAV && (
            <div class="adapter-config">
              <div class="form-group">
                <label class="form-label">{t('webdavUrl')}</label>
                <input
                  class="form-input"
                  type="url"
                  value={config.webdavUrl}
                  onInput={(e) => updateConfig('webdavUrl', e.target.value)}
                  placeholder="https://dav.example.com/remote.php/dav/files/user/"
                />
              </div>
              <div class="form-group">
                <label class="form-label">{t('username')}</label>
                <input
                  class="form-input"
                  type="text"
                  value={config.webdavUser}
                  onInput={(e) => updateConfig('webdavUser', e.target.value)}
                />
              </div>
              <div class="form-group">
                <label class="form-label">{t('password')}</label>
                <input
                  class="form-input"
                  type="password"
                  value={config.webdavPass}
                  onInput={(e) => updateConfig('webdavPass', e.target.value)}
                />
              </div>
            </div>
          )}

          {adapter === ADAPTERS.GIT && (
            <div class="adapter-config">
              <div class="form-group">
                <label class="form-label">
                  {t('gitRemote')}
                  <span class="help-icon" title={t('remoteHelp')}>?</span>
                </label>
                <input
                  class="form-input"
                  type="url"
                  value={config.gitRemote}
                  onInput={(e) => updateConfig('gitRemote', e.target.value)}
                  placeholder="https://github.com/user/bookmarks.git"
                />
              </div>
              <div class="form-group">
                <label class="form-label">{t('gitBranch')}</label>
                {customBranch ? (
                  <div class="field-input-wrap">
                    <input class="form-input" type="text" value={config.gitBranch}
                      onInput={(e) => updateConfig('gitBranch', e.target.value)} placeholder="branch name" />
                    <button class="field-input-clear" onClick={() => { setCustomBranch(false); updateConfig('gitBranch', branches[0] || 'main'); }}>✕</button>
                  </div>
                ) : (
                  <select class="form-input" value={branches.includes(config.gitBranch) ? config.gitBranch : '__new__'}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setCustomBranch(true); updateConfig('gitBranch', ''); }
                      else updateConfig('gitBranch', e.target.value);
                    }}>
                    {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    <option value="__new__">+ {t('newBranch')}</option>
                  </select>
                )}
              </div>
              <div class="form-group">
                <label class="form-label">
                  {t('gitToken')}
                  <span class="help-icon" title={t('tokenHelp')}>?</span>
                </label>
                <input
                  class="form-input"
                  type="password"
                  value={config.gitToken}
                  onInput={(e) => updateConfig('gitToken', e.target.value)}
                />
              </div>
              <div class="config-actions">
                <button class="btn-secondary" onClick={handleShowCommits}>
                  {showCommits ? '✕' : ''} {t('rollback')}
                </button>
                {rollbackMsg && (
                  <span class="rollback-msg ok">{rollbackMsg}</span>
                )}
              </div>
              {showCommits && (
                <CommitList config={config} onClose={handleCommitClose} />
              )}
            </div>
          )}

          <div class="config-actions">
            <button class="btn-primary" onClick={saveConfig}>
              {saved ? `✓ ${t('saved')}` : t('save')}
            </button>
            <button
              class="btn-secondary"
              onClick={testConnection}
              disabled={testing}
            >
              {testing ? t('testing') : t('testConnection')}
            </button>
          </div>
          {testResult && testedAdapter === adapter && (
            <p class={`test-result ${testResult}`}>
              {testResult === 'ok' ? t('connectionOk') : t('connectionFail')}
              {testError && <span class="test-error-detail"> — {testError}</span>}
            </p>
          )}
        </section>

        <section class="card">
            <h2>{t('conflictResolution')}</h2>
            <div class="radio-group">
              {[
                [CONFLICT_STRATEGIES.SMART_MERGE, 'smart-merge'],
                [CONFLICT_STRATEGIES.LOCAL_FIRST, 'local-first'],
                [CONFLICT_STRATEGIES.REMOTE_FIRST, 'remote-first'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  class={`radio-item ${conflictStrategy === value ? 'selected' : ''}`}
                  onClick={() => setConflictStrategy(value)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </section>

        <section class="card">
          <h2>{t('langLabel')}</h2>
          <div class="radio-group">
            {[
              ['en', 'English'],
              ['zh_CN', '中文'],
            ].map(([value, label]) => (
              <button
                key={value}
                class={`radio-item ${lang === value ? 'selected' : ''}`}
                onClick={() => handleLangChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section class="card">
          <h2>{t('appearance')}</h2>
          <div class="radio-group">
            {[
              [THEMES.AUTO, 'themeAuto'],
              [THEMES.LIGHT, 'themeLight'],
              [THEMES.DARK, 'themeDark'],
            ].map(([value, label]) => (
              <button
                key={value}
                class={`radio-item ${theme === value ? 'selected' : ''}`}
                onClick={() => setTheme(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </section>

        <section class="card save-card">
          <button class="btn-primary save-reload-btn" onClick={saveAndReload}>
            {saved ? t('saveReloadDone') : t('saveReload')}
          </button>
        </section>

        <section class="card about-card">
          <h2>{t('about')}</h2>
          <p class="about-text">UniBookmarkSync v1.0.0</p>
          <p class="about-text-secondary">{t('aboutDesc')}</p>
          <p class="about-text-secondary">
            MIT License · <a href="https://github.com/humo0818/UniBookmarkSync" target="_blank" rel="noopener">github.com/humo0818/UniBookmarkSync</a>
          </p>
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Options />
    </ThemeProvider>
  );
}

render(<App />, document.getElementById('app'));
