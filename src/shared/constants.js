/**
 * Shared constants — used across background, adapters, and UI.
 */

// Sync timing
export const SYNC_DEBOUNCE_MS = 500;
export const SYNC_HEARTBEAT_MINUTES = 15;
export const SYNC_TIMEOUT_MS = 30000;

// Retry config
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_BASE_MS = 1000;

// Bookmark tree
export const BOOKMARK_TREE_FILENAME = 'bookmarks.json';
export const SCHEMA_VERSION = 1;

// Sync providers
export const ADAPTERS = {
  WEBDAV: 'webdav',
  GIT: 'git',
};

// Conflict resolution strategies
export const CONFLICT_STRATEGIES = {
  LOCAL_FIRST: 'local-first',
  REMOTE_FIRST: 'remote-first',
  SMART_MERGE: 'smart-merge',
};

// UI theme
export const THEMES = {
  AUTO: 'auto',
  LIGHT: 'light',
  DARK: 'dark',
};

// Storage keys (browser.storage)
export const STORAGE_KEYS = {
  SYNC_CONFIG: 'syncConfig',
  SYNC_STATE: 'syncState',
  CONFLICT_RESOLUTION: 'conflictResolution',
  THEME_PREFERENCE: 'themePreference',
  AUTO_SYNC_WEBDAV: 'autoSync_webdav',
  AUTO_SYNC_GIT: 'autoSync_git',
  CONFLICT_RESOLUTION_WEBDAV: 'conflictResolution_webdav',
  CONFLICT_RESOLUTION_GIT: 'conflictResolution_git',
  ACTIVE_ADAPTER: 'activeAdapter',
};

// Message types for popup/options ↔ background communication
export const MESSAGE_TYPES = {
  MANUAL_SYNC: 'manual-sync',
  CONFIG_CHANGED: 'config-changed',
  SYNC_STATUS: 'sync-status',
  GET_STATUS: 'get-status',
  TEST_CONNECTION: 'test-connection',
  ROLLBACK: 'rollback',
  LIST_COMMITS: 'list-commits',
  ROLLBACK_TO: 'rollback-to',
  LIST_BRANCHES: 'list-branches',
  GET_VERSION: 'get-version',
  ADAPTER_CHANGED: 'adapter-changed',
};

// Sync status states
export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
  CONFLICT: 'conflict',
};
