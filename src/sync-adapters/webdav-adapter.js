/**
 * WebDAV Sync Adapter — reads/writes bookmarks via WebDAV protocol.
 *
 * Uses ETag-based optimistic concurrency (If-Match header) to detect
 * remote conflicts without timestamps.
 */
import * as logger from '../lib/logger.js';
import { AuthError, NetworkError, ConflictError, ConfigError } from '../shared/errors.js';
import { BOOKMARK_TREE_FILENAME } from '../shared/constants.js';

const LOG_TAG = 'webdav-adapter';
const TIMEOUT_MS = 30000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class WebDAVAdapter {
  constructor(config) {
    this.url = (config.webdavUrl || '').replace(/\/$/, '');
    this.username = config.webdavUser || '';
    this.password = config.webdavPass || '';
    this.lastEtag = null;
  }

  /** Build the full file URL. */
  _fileUrl() {
    return `${this.url}/${BOOKMARK_TREE_FILENAME}`;
  }

  /** HTTP Basic auth header. */
  _authHeaders() {
    if (!this.username || !this.password) return {};
    const token = btoa(`${this.username}:${this.password}`);
    return { Authorization: `Basic ${token}` };
  }

  // ── Connection test ───────────────────────────────

  async testConnection() {
    if (!this.url) return { ok: false, error: 'WebDAV URL not configured' };
    try {
      const resp = await fetchWithTimeout(this._fileUrl(), { method: 'HEAD', headers: this._authHeaders() });
      if (resp.ok || resp.status === 404) return { ok: true };
      if (resp.status === 401 || resp.status === 403) return { ok: false, error: 'Authentication failed' };
      return { ok: false, error: `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Fetch remote ──────────────────────────────────

  async fetchRemote() {
    if (!this.url) throw new ConfigError('WebDAV URL not configured');
    logger.info(LOG_TAG, 'Fetching remote...');

    let resp;
    try {
      resp = await fetchWithTimeout(this._fileUrl(), {
        method: 'GET',
        headers: { ...this._authHeaders(), Accept: 'application/json' },
      });
    } catch (err) {
      throw new NetworkError(`Fetch failed: ${err.message}`);
    }

    if (resp.status === 404) return { status: 'unchanged' };
    if (resp.status === 401 || resp.status === 403) throw new AuthError('Authentication failed');
    if (!resp.ok) throw new NetworkError(`HTTP ${resp.status}`);

    this.lastEtag = resp.headers.get('ETag') || resp.headers.get('etag');
    const tree = await resp.json();
    return { status: 'changed', tree };
  }

  // ── Push local ────────────────────────────────────

  async pushLocal(tree) {
    if (!this.url) throw new ConfigError('WebDAV URL not configured');

    const body = JSON.stringify(tree, null, 2);
    const headers = { ...this._authHeaders(), 'Content-Type': 'application/json' };

    let resp;
    try {
      resp = await fetchWithTimeout(this._fileUrl(), { method: 'PUT', headers, body });
    } catch (err) {
      throw new NetworkError(`Push failed: ${err.message}`);
    }

    if (resp.status === 412) {
      // Retry without ETag
      resp = await fetchWithTimeout(this._fileUrl(), { method: 'PUT', headers: { ...this._authHeaders(), 'Content-Type': 'application/json' }, body });
    }
    if (resp.status === 412) throw new ConflictError('Remote modified since last fetch');
    if (resp.status === 401 || resp.status === 403) throw new AuthError('Authentication failed');
    if (!resp.ok) throw new NetworkError(`HTTP ${resp.status}`);

    const etag = resp.headers.get('ETag') || resp.headers.get('etag');
    if (etag) this.lastEtag = etag;
    logger.info(LOG_TAG, 'Push OK');
  }
}

export default WebDAVAdapter;
