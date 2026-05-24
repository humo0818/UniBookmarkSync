/**
 * Git Sync Adapter — pushes/pulls bookmark data via GitHub and GitLab REST APIs.
 *
 * Uses the Git Database API for GitHub (blob → tree → commit → ref)
 * and the Repository Files API for GitLab.
 *
 * Both providers support: testConnection (with auto-create), pushLocal,
 * listCommits, rollbackTo, and first-sync README generation.
 */
import * as logger from '../lib/logger.js';
import { AuthError, NetworkError, ConfigError } from '../shared/errors.js';
import { BOOKMARK_TREE_FILENAME } from '../shared/constants.js';
import README_CONTENT from './readme-content.js';

const LOG_TAG = 'git-adapter';
const GITHUB_API = 'https://api.github.com';
const GITLAB_API_TEMPLATE = 'https://{host}/api/v4';

// ── GitAdapter class ────────────────────────────────

export class GitAdapter {
  constructor(config) {
    this.remote = config.gitRemote || '';
    this.branch = config.gitBranch || 'main';
    this.token = config.gitToken || '';
    this._pendingReadmeSha = null;
  }

  // ── Provider detection ────────────────────────────
  _isGitHub() { return this.remote.includes('github.com'); }
  _isGitLab() { return this.remote.includes('gitlab.com') || this.remote.includes('gitlab.'); }

  /** Parse GitHub URL -> { owner, repo } */
  _parseGitHub() {
    const m = this.remote.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  /** Parse GitLab URL -> { host, projectPath, projectId }. Uses stored path from auto-create if available. */
  _parseGitLab() {
    const hostMatch = this.remote.match(/gitlab\.[^/]+|gitlab\.com/);
    const host = hostMatch?.[0] || 'gitlab.com';
    if (this._glProjectPath) {
      return { host, projectPath: this._glProjectPath, projectId: this._glProjectId };
    }
    const m = this.remote.match(/(gitlab\.[^/]+|gitlab\.com)\/(.+\.git)$/);
    if (!m) return null;
    return { host, projectPath: encodeURIComponent(m[2].replace(/\.git$/, '')) };
  }

  /** Build GitLab API URL. Uses numeric project ID if available (more reliable). */
  _glUrl(gl, path) {
    const id = gl.projectId || gl.projectPath;
    return `https://${gl.host}/api/v4/projects/${id}${path}`;
  }

  // ── HTTP helpers ──────────────────────────────────
  _ghHeaders() {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  }
  _glHeaders() {
    return { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' };
  }

  // ── Encoding ──────────────────────────────────────
  _encodeB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  _decodeB64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ── API helpers ───────────────────────────────────
  async _fetchJson(url, options) {
    const resp = await fetch(url, options);
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }
  _ghUrl(gh, path) { return `${GITHUB_API}/repos/${gh.owner}/${gh.repo}${path}`; }
  _glUrl(gl, path) { return `https://${gl.host}/api/v4/projects/${gl.projectPath}${path}`; }

  // ═══════════════════════════════════════════════════
  // testConnection
  // ═══════════════════════════════════════════════════

  async testConnection() {
    if (!this.remote) return fail('Git remote URL not configured');

    if (this._isGitLab() && this.token) return this._testGitLab();
    if (this._isGitHub() && this.token) return this._testGitHub();

    // Generic Git: probe smart HTTP
    return this._testGenericGit();
  }

  async _testGitHub() {
    const gh = this._parseGitHub();
    if (!gh) return fail('Invalid GitHub URL');

    try {
      let { resp } = await this._fetchJson(this._ghUrl(gh, ''), { headers: this._ghHeaders() });
      if (resp.ok) return ok();

      if (resp.status === 404) {
        // Auto-create repo
        resp = await fetch(`${GITHUB_API}/user/repos`, {
          method: 'POST', headers: this._ghHeaders(),
          body: JSON.stringify({ name: gh.repo, private: true, auto_init: true }),
        });
        if (resp.ok) return ok();
        const e = await resp.json().catch(() => ({}));
        return fail(`Failed to create repo: ${e.message || resp.status}`);
      }
      if (resp.status === 401) return fail('Invalid token');
      return fail(`HTTP ${resp.status}`);
    } catch (e) { return fail(e.message); }
  }

  async _testGitLab() {
    const gl = this._parseGitLab();
    if (!gl) return fail('Invalid GitLab URL');

    try {
      let { resp } = await this._fetchJson(this._glUrl(gl, ''), { headers: this._glHeaders() });
      if (resp.ok) {
        const info = await resp.json().catch(() => ({}));
        if (info.path_with_namespace) this._glProjectPath = encodeURIComponent(info.path_with_namespace);
        if (info.id) this._glProjectId = String(info.id);
        return ok();
      }

      if (resp.status === 404) {
        // Auto-create project with full namespace path
        const fullPath = decodeURIComponent(gl.projectPath); // e.g. "humo/Bookmarks"
        const parts = fullPath.split('/');
        const projectName = parts.pop();
        const namespacePath = parts.length > 0 ? parts.join('/') : null;

        const createBody = { name: projectName, visibility: 'private', initialize_with_readme: true };
        // Only set namespace if URL specifies one (not for user-level repos)
        if (namespacePath) {
          // Find namespace ID
          try {
            const nsResp = await fetch(
              `${GITLAB_API_TEMPLATE.replace('{host}', gl.host)}/namespaces?search=${encodeURIComponent(namespacePath)}`,
              { headers: this._glHeaders() }
            );
            if (nsResp.ok) {
              const namespaces = await nsResp.json();
              const match = namespaces.find(n => n.full_path === namespacePath || n.path === namespacePath);
              if (match) createBody.namespace_id = match.id;
            }
          } catch {}
        }
        resp = await fetch(`${GITLAB_API_TEMPLATE.replace('{host}', gl.host)}/projects`, {
          method: 'POST', headers: this._glHeaders(),
          body: JSON.stringify(createBody),
        });
        if (resp.ok) {
          const created = await resp.json();
          // Store the actual project path for subsequent operations
          if (created.path_with_namespace) {
            this._glProjectPath = encodeURIComponent(created.path_with_namespace);
            logger.info(LOG_TAG, `GitLab project created: ${created.path_with_namespace}`);
          }
          return ok();
        }
        const e = await resp.json().catch(() => ({}));
        return fail(`Failed to create project: ${e.message || resp.status}`);
      }
      if (resp.status === 401) return fail('Invalid token');
      return fail(`HTTP ${resp.status}`);
    } catch (e) { return fail(e.message); }
  }

  async _testGenericGit() {
    try {
      const url = `${this.remote.replace(/\.git$/, '')}/info/refs?service=git-upload-pack`;
      const headers = { Accept: 'application/x-git-upload-pack-advertisement' };
      if (this.token) {
        headers.Authorization = 'Basic ' + btoa(`${this.token}:x-oauth-basic`);
      }
      const resp = await fetch(url, { headers });
      if (resp.ok) return ok();
      const text = await resp.text();
      if (text.includes('service=git-upload-pack') || text.startsWith('001e')) return ok();
      return fail(`HTTP ${resp.status}`);
    } catch (e) { return fail(`Cannot reach ${this.remote}`); }
  }

  // ═══════════════════════════════════════════════════
  // pushLocal
  // ═══════════════════════════════════════════════════

  async pushLocal(tree, options = {}) {
    if (!this.remote) throw new ConfigError('Git remote URL not configured');
    if (!this.token) throw new ConfigError('Token required');

    if (this._isGitLab()) return this._pushToGitLab(tree, options);
    if (this._isGitHub()) return this._pushToGitHub(tree, options);

    throw new ConfigError('Only GitHub and GitLab are supported');
  }

  // ── GitHub push (Git Database API) ────────────────

  async _pushToGitHub(tree, options) {
    // Ensure repo exists (auto-create if needed)
    await this._testGitHub();
    const gh = this._parseGitHub();
    const base = this._ghUrl(gh, '');
    const content = JSON.stringify(tree, null, 2);
    const contentB64 = this._encodeB64(this._sanitizeForGitHub(content));
    const msg = this._buildCommitMsg(options);

    // README only on first sync to a new repo
    if (options.isFirstSync) await this._createReadmeBlob(base);

    // Create bookmark blob
    const { data: blobData, resp: blobResp } = await this._fetchJson(`${base}/git/blobs`, {
      method: 'POST', headers: this._ghHeaders(),
      body: JSON.stringify({ content: contentB64, encoding: 'base64' }),
    });
    if (!blobResp.ok) throw new NetworkError(`Blob: ${blobResp.status} ${blobData.message || ''}`);
    logger.info(LOG_TAG, `Blob: ${blobData.sha.slice(0, 7)}`);

    // Get branch ref
    const { parentSha, baseTreeSha } = await this._getGitHubRef(base);

    // Build tree items
    const treeItems = [{ path: BOOKMARK_TREE_FILENAME, mode: '100644', type: 'blob', sha: blobData.sha }];
    if (this._pendingReadmeSha) {
      treeItems.push({ path: 'README.md', mode: '100644', type: 'blob', sha: this._pendingReadmeSha });
      this._pendingReadmeSha = null;
    }

    // Create tree
    const { data: treeData, resp: treeResp } = await this._fetchJson(`${base}/git/trees`, {
      method: 'POST', headers: this._ghHeaders(),
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeResp.ok) throw new NetworkError(`Tree: ${treeResp.status} ${treeData.message || ''}`);

    // Create commit
    const commitBody = { message: msg, tree: treeData.sha, parents: parentSha ? [parentSha] : [] };
    const { data: commitData, resp: commitResp } = await this._fetchJson(`${base}/git/commits`, {
      method: 'POST', headers: this._ghHeaders(), body: JSON.stringify(commitBody),
    });
    if (!commitResp.ok) throw new NetworkError(`Commit: ${commitResp.status}`);

    // Update branch ref (force push)
    await this._updateGitHubRef(base, parentSha, commitData.sha);
    logger.info(LOG_TAG, 'GitHub push OK');
  }

  async _getGitHubRef(base) {
    const { resp, data } = await this._fetchJson(`${base}/git/ref/heads/${this.branch}`, { headers: this._ghHeaders() });
    if (!resp.ok) return { parentSha: null, baseTreeSha: null };

    const parentSha = data.object.sha;
    const { data: commitData } = await this._fetchJson(`${base}/git/commits/${parentSha}`, { headers: this._ghHeaders() });
    return { parentSha, baseTreeSha: commitData.tree?.sha || null };
  }

  async _updateGitHubRef(base, parentSha, commitSha) {
    let { resp } = await this._fetchJson(`${base}/git/refs/heads/${this.branch}`, {
      method: parentSha ? 'PATCH' : 'POST',
      headers: this._ghHeaders(),
      body: JSON.stringify(parentSha
        ? { sha: commitSha, force: true }
        : { ref: `refs/heads/${this.branch}`, sha: commitSha }),
    });

    // Retry on 422 (non-fast-forward) — re-fetch parent and recreate commit
    if (!resp.ok && resp.status === 422) {
      const { data: refData } = await this._fetchJson(`${base}/git/refs/heads/${this.branch}`, { headers: this._ghHeaders() });
      if (!refData.object) throw new NetworkError('Ref update: branch not found');
      parentSha = refData.object.sha;

      const { resp: retryResp } = await this._fetchJson(`${base}/git/refs/heads/${this.branch}`, {
        method: 'PATCH', headers: this._ghHeaders(),
        body: JSON.stringify({ sha: commitSha, force: true }),
      });
      resp = retryResp;
    }

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new NetworkError(`Ref: ${resp.status} ${e.message || ''}`);
    }
  }

  async _createReadmeBlob(base) {
    try {
      const readmeB64 = this._encodeB64(README_CONTENT);
      const { resp, data } = await this._fetchJson(`${base}/git/blobs`, {
        method: 'POST', headers: this._ghHeaders(),
        body: JSON.stringify({ content: readmeB64, encoding: 'base64' }),
      });
      if (resp.ok) this._pendingReadmeSha = data.sha;
    } catch (e) { logger.warn(LOG_TAG, 'README blob failed', e.message); }
  }

  // ── GitLab push (Repository Files API) ────────────

  async _pushToGitLab(tree, options) {
    // Ensure we have the correct project path (may have been auto-created)
    await this._testGitLab();
    const gl = this._parseGitLab();
    logger.info(LOG_TAG, `GitLab push: host=${gl?.host} project=${gl?.projectPath} stored=${this._glProjectPath || 'none'}`);
    if (!gl) throw new ConfigError('Invalid GitLab URL');
    const content = JSON.stringify(tree, null, 2);
    const contentB64 = this._encodeB64(this._sanitizeForGitHub(content));
    const msg = this._buildCommitMsg(options);
    const filePath = encodeURIComponent(BOOKMARK_TREE_FILENAME);

    // Get last commit for update
    let lastCommitId = null;
    try {
      const { resp, data } = await this._fetchJson(
        `${this._glUrl(gl, '/repository')}/commits?ref_name=${this.branch}&path=${BOOKMARK_TREE_FILENAME}&per_page=1`,
        { headers: this._glHeaders() }
      );
      if (resp.ok && data.length > 0) lastCommitId = data[0].id;
    } catch { /* file may not exist yet */ }

    // README only on first sync to a new repo
    if (options.isFirstSync) await this._pushGitLabReadme(gl);

    // Push bookmarks
    const body = { branch: this.branch, content: contentB64, commit_message: msg, encoding: 'base64' };
    if (lastCommitId) body.last_commit_id = lastCommitId;

    const apiUrl = `${this._glUrl(gl, '/repository')}/files/${filePath}`;
    const method = lastCommitId ? 'PUT' : 'POST';
    logger.info(LOG_TAG, `GitLab Files API ${method} ${apiUrl}`);
    let { resp } = await this._fetchJson(apiUrl, {
      method, headers: this._glHeaders(), body: JSON.stringify(body),
    });

    // Fallback to Git Database API if Files API not available
    if (!resp.ok && (resp.status === 405 || resp.status === 404 || resp.status === 400)) {
      logger.info(LOG_TAG, 'Falling back to GitLab Database API');
      return this._pushToGitLabDB(tree, options, gl);
    }

    // Retry: if PUT failed because file doesn't exist, try POST
    if (!resp.ok && resp.status === 400 && lastCommitId) {
      delete body.last_commit_id;
      resp = (await this._fetchJson(apiUrl, { method: 'POST', headers: this._glHeaders(), body: JSON.stringify(body) })).resp;
    }

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      if (resp.status === 401 || resp.status === 403) throw new AuthError('Token invalid');
      throw new NetworkError(`GitLab: ${e.message || resp.status}`);
    }
    logger.info(LOG_TAG, 'GitLab push OK');
  }

  // ── GitLab Database API fallback (for GitLab < 13.5) ──

  async _pushToGitLabDB(tree, options, gl) {
    const content = JSON.stringify(tree, null, 2);
    const contentB64 = this._encodeB64(this._sanitizeForGitHub(content));
    const msg = this._buildCommitMsg(options);
    const base = `${this._glUrl(gl, '/repository')}`;

    // Get current branch info; create branch if it doesn't exist
    let parentSha = null;
    try {
      const { data, resp } = await this._fetchJson(`${base}/branches/${encodeURIComponent(this.branch)}`, { headers: this._glHeaders() });
      if (resp.ok) {
        parentSha = data?.commit?.id || null;
      } else {
        // Branch doesn't exist — create it from the default branch or from scratch
        logger.info(LOG_TAG, `Branch ${this.branch} not found, creating...`);
        await this._fetchJson(`${base}/branches`, {
          method: 'POST', headers: this._glHeaders(),
          body: JSON.stringify({ branch: this.branch, ref: 'main' }),
        });
      }
    } catch {}
    logger.info(LOG_TAG, `GitLab DB push, parent=${parentSha ? parentSha.slice(0,7) : 'none'}`);

    // Check if file already exists to decide create vs update
    let fileAction = 'create';
    try {
      const { resp } = await this._fetchJson(
        `${base}/files/${encodeURIComponent(BOOKMARK_TREE_FILENAME)}?ref=${encodeURIComponent(this.branch)}`,
        { headers: this._glHeaders() }
      );
      if (resp.ok) fileAction = 'update';
    } catch {}

    const actions = [{
      action: fileAction,
      file_path: BOOKMARK_TREE_FILENAME,
      content: contentB64,
      encoding: 'base64',
    }];

    // Create commit
    let { resp, data } = await this._fetchJson(`${base}/commits`, {
      method: 'POST', headers: this._glHeaders(),
      body: JSON.stringify({ branch: this.branch, commit_message: msg, actions }),
    });

    // Retry with opposite action if needed
    if (!resp.ok && data.message?.includes('already exists')) {
      actions[0].action = 'update';
      ({ resp, data } = await this._fetchJson(`${base}/commits`, {
        method: 'POST', headers: this._glHeaders(),
        body: JSON.stringify({ branch: this.branch, commit_message: msg, actions }),
      }));
    } else if (!resp.ok && data.message?.includes("doesn't exist")) {
      actions[0].action = 'create';
      ({ resp, data } = await this._fetchJson(`${base}/commits`, {
        method: 'POST', headers: this._glHeaders(),
        body: JSON.stringify({ branch: this.branch, commit_message: msg, actions }),
      }));
    }

    if (!resp.ok) {
      throw new NetworkError(`GitLab DB: ${resp.status} ${data.message || ''}`);
    }
    logger.info(LOG_TAG, 'GitLab DB push OK');

    // README only on first sync
    if (options.isFirstSync) {
      try { await this._pushGitLabReadmeDB(gl); }
      catch (e) { logger.warn(LOG_TAG, 'GitLab DB README failed', e.message); }
    }
  }

  async _pushGitLabReadmeDB(gl) {
    const readmeB64 = this._encodeB64(README_CONTENT);
    const base = `${this._glUrl(gl, '/repository')}`;

    // Check if README already exists on this branch
    let action = 'create';
    try {
      const { resp } = await this._fetchJson(
        `${base}/files/${encodeURIComponent('README.md')}?ref=${encodeURIComponent(this.branch)}`,
        { headers: this._glHeaders() }
      );
      if (resp.ok) action = 'update';
    } catch {}

    const { resp } = await this._fetchJson(`${base}/commits`, {
      method: 'POST', headers: this._glHeaders(),
      body: JSON.stringify({
        branch: this.branch,
        commit_message: 'Update README with UniBookmarkSync docs',
        actions: [{ action, file_path: 'README.md', content: readmeB64, encoding: 'base64' }],
      }),
    });
    if (resp.ok) logger.info(LOG_TAG, 'GitLab DB README OK');
  }

  // ── GitLab README (Files API) ────────────────────

  async _pushGitLabReadme(gl) {
    try {
      const readmeB64 = this._encodeB64(README_CONTENT);
      const rPath = encodeURIComponent('README.md');
      const base = `${this._glUrl(gl, '/repository')}/files/${rPath}`;

      // Check if README exists
      let lastCommitId = null;
      try {
        const { resp, data } = await this._fetchJson(
          `${this._glUrl(gl, '/repository')}/commits?ref_name=${this.branch}&path=README.md&per_page=1`,
          { headers: this._glHeaders() }
        );
        if (resp.ok && data.length > 0) lastCommitId = data[0].id;
      } catch {}

      const body = { branch: this.branch, content: readmeB64, commit_message: 'Update README', encoding: 'base64' };
      if (lastCommitId) body.last_commit_id = lastCommitId;

      await fetch(base, {
        method: lastCommitId ? 'PUT' : 'POST',
        headers: this._glHeaders(), body: JSON.stringify(body),
      });
    } catch (e) { logger.warn(LOG_TAG, 'GitLab README failed', e.message); }
  }

  // ═══════════════════════════════════════════════════
  // listCommits
  // ═══════════════════════════════════════════════════

  async listCommits() {
    if (this._isGitLab() && this.token) return this._listGitLabCommits();
    return this._listGitHubCommits();
  }

  async _listGitHubCommits() {
    const gh = this._parseGitHub();
    if (!gh || !this.token) return { ok: false, error: 'GitHub required', commits: [] };
    try {
      const { resp, data } = await this._fetchJson(
        `${this._ghUrl(gh, '')}/commits?path=${BOOKMARK_TREE_FILENAME}&sha=${this.branch}&per_page=20`,
        { headers: this._ghHeaders() }
      );
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, commits: [] };
      return { ok: true, commits: data.map((c, i) => ({
        oid: c.sha, message: c.commit.message,
        timestamp: c.commit.committer.date, isCurrent: i === 0,
      })) };
    } catch (err) { return { ok: false, error: err.message, commits: [] }; }
  }

  async _listGitLabCommits() {
    const gl = this._parseGitLab();
    if (!gl) return { ok: false, error: 'Invalid GitLab URL', commits: [] };
    try {
      const { resp, data } = await this._fetchJson(
        `${this._glUrl(gl, '/repository')}/commits?path=${BOOKMARK_TREE_FILENAME}&ref_name=${this.branch}&per_page=20`,
        { headers: this._glHeaders() }
      );
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, commits: [] };
      return { ok: true, commits: data.map((c, i) => ({
        oid: c.id, message: c.title,
        timestamp: c.committed_date, isCurrent: i === 0,
      })) };
    } catch (err) { return { ok: false, error: err.message, commits: [] }; }
  }

  // ═══════════════════════════════════════════════════
  // rollbackTo
  // ═══════════════════════════════════════════════════

  async rollbackTo(oid) {
    if (this._isGitLab() && this.token) return this._rollbackGitLab(oid);
    return this._rollbackGitHub(oid);
  }

  async _rollbackGitHub(oid) {
    const gh = this._parseGitHub();
    if (!gh || !this.token) return { ok: false, error: 'GitHub required' };
    const base = this._ghUrl(gh, '');

    try {
      // Read old content
      const { resp, data } = await this._fetchJson(`${base}/contents/${BOOKMARK_TREE_FILENAME}?ref=${oid}`, { headers: this._ghHeaders() });
      if (!resp.ok) return { ok: false, error: `Read: HTTP ${resp.status}` };

      const restoredTree = JSON.parse(this._decodeB64(data.content));
      const restoredB64 = data.content;

      // Create blob
      const { data: blobData } = await this._fetchJson(`${base}/git/blobs`, {
        method: 'POST', headers: this._ghHeaders(),
        body: JSON.stringify({ content: restoredB64, encoding: 'base64' }),
      });

      // Get current ref
      const { parentSha, baseTreeSha } = await this._getGitHubRef(base);
      if (!parentSha) return { ok: false, error: 'Branch not found' };

      // Create tree
      const { data: treeData } = await this._fetchJson(`${base}/git/trees`, {
        method: 'POST', headers: this._ghHeaders(),
        body: JSON.stringify({ base_tree: baseTreeSha, tree: [{ path: BOOKMARK_TREE_FILENAME, mode: '100644', type: 'blob', sha: blobData.sha }] }),
      });

      // Create commit
      const { data: commitData } = await this._fetchJson(`${base}/git/commits`, {
        method: 'POST', headers: this._ghHeaders(),
        body: JSON.stringify({ message: `rollback: ${oid.slice(0, 7)}`, tree: treeData.sha, parents: [parentSha] }),
      });

      // Update ref
      const { resp: refResp } = await this._fetchJson(`${base}/git/refs/heads/${this.branch}`, {
        method: 'PATCH', headers: this._ghHeaders(),
        body: JSON.stringify({ sha: commitData.sha, force: true }),
      });
      if (!refResp.ok) return { ok: false, error: `Ref: HTTP ${refResp.status}` };

      return { ok: true, tree: restoredTree };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async _rollbackGitLab(oid) {
    const gl = this._parseGitLab();
    if (!gl) return { ok: false, error: 'Invalid GitLab URL' };
    const base = this._glUrl(gl, '/repository');

    try {
      const { resp, data } = await this._fetchJson(
        `${base}/files/${encodeURIComponent(BOOKMARK_TREE_FILENAME)}?ref=${oid}`,
        { headers: this._glHeaders() }
      );
      if (!resp.ok) return { ok: false, error: `Read: HTTP ${resp.status}` };

      const restoredTree = JSON.parse(this._decodeB64(data.content));

      // Get last commit for update
      let lastCommitId = null;
      try {
        const { data: commits } = await this._fetchJson(
          `${base}/commits?ref_name=${this.branch}&path=${BOOKMARK_TREE_FILENAME}&per_page=1`,
          { headers: this._glHeaders() }
        );
        if (commits.length > 0) lastCommitId = commits[0].id;
      } catch {}

      const body = {
        branch: this.branch, content: data.content,
        commit_message: `rollback: ${oid.slice(0, 7)}`, encoding: 'base64',
      };
      if (lastCommitId) body.last_commit_id = lastCommitId;

      const { resp: putResp } = await this._fetchJson(
        `${base}/files/${encodeURIComponent(BOOKMARK_TREE_FILENAME)}`,
        { method: 'PUT', headers: this._glHeaders(), body: JSON.stringify(body) }
      );
      if (!putResp.ok) return { ok: false, error: `Push: HTTP ${putResp.status}` };

      return { ok: true, tree: restoredTree };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  // ═══════════════════════════════════════════════════
  // getCurrentVersion — latest commit message for the bookmark file
  // ═══════════════════════════════════════════════════

  async getCurrentVersion() {
    try {
      if (this._isGitLab() && this.token) {
        const gl = this._parseGitLab();
        if (!gl) return null;
        const { resp, data } = await this._fetchJson(
          `${this._glUrl(gl, '/repository')}/commits?path=${BOOKMARK_TREE_FILENAME}&ref_name=${this.branch}&per_page=1`,
          { headers: this._glHeaders() }
        );
        if (resp.ok && data.length > 0) return { message: data[0].title, sha: data[0].id, date: data[0].committed_date };
      }
      if (this._isGitHub() && this.token) {
        const gh = this._parseGitHub();
        if (!gh) return null;
        const { resp, data } = await this._fetchJson(
          `${this._ghUrl(gh, '')}/commits?path=${BOOKMARK_TREE_FILENAME}&sha=${this.branch}&per_page=1`,
          { headers: this._ghHeaders() }
        );
        if (resp.ok && data.length > 0) return { message: data[0].commit.message, sha: data[0].sha, date: data[0].commit.committer.date };
      }
      return null;
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════
  // listBranches
  // ═══════════════════════════════════════════════════

  async listBranches() {
    try {
      let url, headers;
      if (this._isGitLab() && this.token) {
        const gl = this._parseGitLab();
        if (!gl) return [];
        url = `${this._glUrl(gl, '/repository')}/branches?per_page=100`;
        headers = this._glHeaders();
      } else if (this._isGitHub() && this.token) {
        const gh = this._parseGitHub();
        if (!gh) return [];
        url = `${this._ghUrl(gh, '')}/branches?per_page=100`;
        headers = this._ghHeaders();
      } else {
        return [];
      }
      const resp = await fetch(url, { headers });
      const data = await resp.json();
      logger.info(LOG_TAG, `Branches: status=${resp.status} type=${typeof data} isArray=${Array.isArray(data)} count=${Array.isArray(data) ? data.length : 0}`);
      if (!resp.ok || !Array.isArray(data)) return [];
      return data.map(b => b.name).filter(Boolean);
    } catch { return []; }
  }

  // ═══════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════

  /** Build a descriptive commit message from change summary. */
  _buildCommitMsg(options) {
    const { totalBookmarks, added, removed } = options.changeSummary || {};
    const addedList = options.addedList || [];
    const removedList = options.removedList || [];
    const modifiedList = options.modifiedList || [];
    const userDesc = options.description || '';
    const isFirst = options.isFirstSync;

    const parts = [];
    if (isFirst) {
      parts.push(`Initial sync: ${totalBookmarks} bookmarks`);
    } else {
      if (addedList.length > 0) {
        const names = addedList.slice(0, 5).join(', ');
        parts.push(`Added: ${names}${addedList.length > 5 ? ` +${addedList.length - 5} more` : ''}`);
      }
      if (removedList.length > 0) {
        const names = removedList.slice(0, 3).join(', ');
        parts.push(`Removed: ${names}${removedList.length > 3 ? ` +${removedList.length - 3} more` : ''}`);
      }
      if (modifiedList.length > 0) {
        const names = modifiedList.slice(0, 3).join(', ');
        parts.push(`Modified: ${names}${modifiedList.length > 3 ? ` +${modifiedList.length - 3} more` : ''}`);
      }
    }
    const desc = parts.join('; ') || `Sync ${totalBookmarks || '?'} bookmarks`;
    return userDesc ? `${userDesc} | ${desc}` : desc;
  }

  /** Sanitize bookmark data to avoid GitHub secret scanning rejection. */
  _sanitizeForGitHub(content) {
    let sanitized = content;

    // Redact credential-like query/fragment params
    sanitized = sanitized.replace(
      /([?&#](?:token|access_token|api_key|apikey|key|secret|password|passwd|auth|credential|jwt|bearer|private_key|client_secret|refresh_token|accesskey|sensitive))=[^&\s"'<]+/gi,
      '$1=REDACTED'
    );

    // Redact long alphanumeric query param values (likely tokens)
    sanitized = sanitized.replace(
      /([?&][a-zA-Z_][a-zA-Z0-9_-]*)=([A-Za-z0-9+/=_-]{25,})/g,
      (match, param, value) => (/[0-9]/.test(value) && /[A-Za-z]/.test(value)) ? `${param}=REDACTED` : match
    );

    // Redact known token formats
    const patterns = [
      /ghp_[A-Za-z0-9]{30,}/g, /github_pat_[A-Za-z0-9_]{20,}/g,
      /gho_[A-Za-z0-9]{30,}/g, /ghu_[A-Za-z0-9]{30,}/g, /ghs_[A-Za-z0-9]{30,}/g,
      /glpat-[A-Za-z0-9_-]{20,}/g, /sk-[A-Za-z0-9]{30,}/g, /AKIA[0-9A-Z]{16}/g,
      /xox[bpras]-[A-Za-z0-9-]+/g, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
      /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END \1?PRIVATE KEY-----/g,
    ];
    for (const p of patterns) sanitized = sanitized.replace(p, 'REDACTED');

    return sanitized;
  }
}

// ── Utility functions ──────────────────────────────

function ok() { return { ok: true }; }
function fail(error) { return { ok: false, error }; }

export default GitAdapter;
