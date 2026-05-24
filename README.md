# UniBookmarkSync

Cross-browser bookmark synchronization extension — sync your bookmarks across Chrome, Edge, Firefox, and Safari via WebDAV or Git (GitHub / GitLab).

## Features

- **Two Sync Backends** — WebDAV (any WebDAV-compatible server) and Git (GitHub & GitLab REST APIs)
- **Auto-Sync** — automatically push bookmark changes to the remote on create, update, move, or delete
- **Version History** — every sync creates a snapshot; browse history and rollback to any previous version
- **Conflict Resolution** — three strategies: Smart Merge (three-way merge), Local First, Remote First
- **Cross-Browser Stable IDs** — path-based bookmark IDs ensure the same bookmark is recognized across browsers
- **Per-Adapter Independence** — WebDAV and Git operate as separate modules with isolated auto-sync, conflict resolution, and state
- **Internationalization** — English and Chinese (zh_CN) with full i18n coverage
- **Dark / Light Theme** — auto-detects `prefers-color-scheme`, with manual override in settings
- **Privacy** — no third-party servers; your data stays on your own WebDAV server or Git repository

## Installation

### From Source

```bash
git clone https://github.com/humo0818/UniBookmarkSync.git
cd UniBookmarkSync
npm install
```

Build for your target browser:

```bash
npm run build:chrome    # Chrome / Chromium-based browsers
npm run build:firefox   # Firefox
npm run build:edge      # Microsoft Edge
npm run build:safari    # Safari
npm run build:all       # All browsers
```

Load the extension:

| Browser | Steps |
|----------|-------|
| **Chrome / Edge** | Go to `chrome://extensions`, enable "Developer mode", click "Load unpacked", select `dist/chrome/` |
| **Firefox** | Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", select `dist/firefox/manifest.json` |
| **Safari** | Use `xcrun safari-web-extension-converter` to convert the extension, then build with Xcode |

## Usage

### Initial Setup

1. Open the extension popup and select a sync mode tab: **WebDAV** or **Git**
2. Click **Settings** (or "Go to Settings" if not yet configured)
3. Fill in your connection details:
   - **WebDAV**: Server URL, username, password
   - **Git**: Remote repository URL (GitHub or GitLab HTTPS), branch, personal access token
4. Click **Test Connection** to verify, then **Save**

### Sync

- Click **Sync Now** in the popup to manually push bookmarks
- Toggle **Auto-sync** ON to automatically sync on every bookmark change

### Git Mode — Branch Management

- **Auto-sync ON**: branch dropdown shows remote branches (read-only)
- **Auto-sync OFF**: branch dropdown includes a **+ New branch...** option to type a custom branch name; you can also write a custom commit description

### Version History & Rollback

1. In Settings → Git section, click **Version History**
2. Browse the commit list — each entry shows the auto-generated change summary
3. Click **Rollback to this** on any past version to restore bookmarks locally and push a new revert commit

### Token Setup

| Provider | Path | Required Scope |
|----------|------|----------------|
| **GitHub** | Settings → Developer settings → Personal access tokens → Tokens (classic) | `repo` (private repo) or `public_repo` |
| **GitLab** | Settings → Access Tokens | `api` |

## Architecture

### Directory Structure

```
unibookmarksync/
├── public/
│   ├── _locales/
│   │   ├── en/messages.json          # English i18n strings
│   │   └── zh_CN/messages.json       # Chinese i18n strings
│   └── icons/                        # Extension icons
├── src/
│   ├── background/                   # Service worker (MV3 background)
│   │   ├── index.js                  # Entry point
│   │   ├── sync-manager.js           # Core orchestrator: change detection, sync dispatch, status broadcast
│   │   ├── storage.js                # browser.storage.local abstraction (per-adapter sync state)
│   │   ├── bookmark-monitor.js       # Bookmark event listeners (create/update/move/remove)
│   │   ├── sync-queue.js             # Serialized operation queue with retry
│   │   └── conflict-resolver.js      # Three-way merge (last-common-ancestor) conflict resolution
│   ├── sync-adapters/
│   │   ├── adapter-interface.js      # Adapter contract (testConnection, pushLocal, fetchRemote, listCommits, etc.)
│   │   ├── adapter-registry.js       # Factory: creates WebDAV or Git adapter from config
│   │   ├── webdav-adapter.js         # WebDAV implementation (HTTP PUT/GET with AbortController timeout)
│   │   ├── git-adapter.js            # GitHub & GitLab REST API implementation (Git Database + Commits API)
│   │   └── readme-content.js         # First-sync README.md template for the Git repository
│   ├── lib/
│   │   ├── bookmark-tree.js          # Bookmark tree serialization / deserialization / restore
│   │   ├── bookmark-diff.js          # Stable-ID-based tree diff (added / removed / modified)
│   │   ├── hash.js                   # SHA-256 hashing with timestamp stripping for stable comparison
│   │   ├── i18n.js                   # Custom i18n loader (Chrome + Firefox compatible)
│   │   ├── browser-polyfill.js       # webextension-polyfill wrapper (Promise-based browser.* APIs)
│   │   ├── debounce.js               # Debounce utility for auto-sync
│   │   └── logger.js                 # Debug-level logging with tag prefix
│   ├── shared/
│   │   ├── constants.js              # Adapters, storage keys, message types, sync status enums
│   │   └── errors.js                 # Custom error classes (AuthError, NetworkError, ConfigError, ConflictError)
│   └── ui/
│       ├── components/
│       │   ├── ThemeProvider.jsx      # CSS custom properties theme context (auto / light / dark)
│       │   └── StatusIndicator.jsx    # Cloud icon with sync status (synced / syncing / error / not configured)
│       ├── pages/
│       │   ├── popup/
│       │   │   ├── index.html
│       │   │   ├── popup.jsx          # Dual-tab popup (WebDAV / Git) with independent controls
│       │   │   └── popup.css
│       │   └── options/
│       │       ├── index.html
│       │       ├── options.jsx         # Settings page: adapter config, conflict resolution, version history, theme
│       │       └── options.css
│       └── styles/
│           ├── tokens.css             # CSS custom properties (colors, spacing, typography)
│           └── base.css               # Global reset and form element styles
├── vite.config.js                     # Vite config with @samrum/vite-plugin-web-extension
├── package.json
└── README.md
```

### Data Flow

```
[Bookmark API events]
        │
        ▼
[bookmark-monitor.js] ──debounce──▶ [sync-manager.js]
                                        │
                          ┌─────────────┼─────────────┐
                          ▼                           ▼
                   [webdav-adapter]            [git-adapter]
                   HTTP PUT/GET                GitHub/GitLab REST API
                          │                           │
                          ▼                           ▼
                    WebDAV Server              GitHub / GitLab Repo
```

1. **Change Detection**: `bookmark-monitor.js` listens for `bookmarks.onCreated/onChanged/onMoved/onRemoved` events and triggers a debounced sync
2. **Tree Serialization**: `bookmark-tree.js` serializes the full bookmark tree with path-based stable IDs (e.g., `bookmark_bar/folder_name/bookmark_title`)
3. **Hash Comparison**: `hash.js` computes a SHA-256 hash of the serialized tree (timestamps stripped); if unchanged, sync is skipped
4. **Change Diff**: `bookmark-diff.js` compares the previous and current trees to produce an `{ added, removed, modified }` summary for commit messages
5. **Sync Dispatch**: `sync-manager.js` routes to the active adapter based on popup selection
6. **Status Broadcast**: sync state is persisted to `browser.storage.local` and broadcast to all connected popup ports

### Git Sync Implementation

The Git adapter uses REST APIs directly — no Git binary or isomorphic-git dependency.

**GitHub** — Git Database API:
1. `POST /repos/:owner/:repo/git/blobs` — create a blob with the bookmark JSON
2. `GET /repos/:owner/:repo/git/ref/heads/:branch` — get the branch's current commit SHA
3. `POST /repos/:owner/:repo/git/trees` — create a tree pointing to the blob
4. `POST /repos/:owner/:repo/git/commits` — create a commit with the tree
5. `PATCH /repos/:owner/:repo/git/refs/heads/:branch` — update the branch ref

**GitLab** — Repository Files API (primary) + Commits API (fallback):
1. `GET /api/v4/projects/:id/repository/files/bookmarks.json` — fetch current file with `last_commit_id`
2. `PUT /api/v4/projects/:id/repository/files/bookmarks.json` — push with `last_commit_id` for optimistic locking
3. Falls back to Commits API (`POST .../repository/commits` with `actions` array) on older GitLab instances

**Secret Sanitization**: bookmark URLs are scanned for credential patterns (JWTs, tokens, API keys, private keys) before pushing to GitHub to avoid secret-scanning push rejections.

### WebDAV Sync Implementation

- `HEAD` request — test connection
- `GET` with `Accept: application/json` — fetch remote bookmarks (30s AbortController timeout)
- `PUT` — push local bookmarks (no ETag / If-Match for simplicity; retries once on 412)

### Conflict Resolution

Three strategies available per adapter:
- **Smart Merge** (default): finds the last common ancestor and performs a three-way merge — new bookmarks from both sides are kept, conflicts on the same bookmark favor the chosen strategy
- **Local First**: always overwrites remote with local
- **Remote First**: always overwrites local with remote

### Port Reconnection

In Manifest V3, the service worker can be terminated at any time. The popup establishes a persistent connection via `browser.runtime.connect()`. On disconnect, it automatically reconnects and re-fetches state to stay in sync.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Preact (3 KB) |
| **Build** | Vite + `@samrum/vite-plugin-web-extension` |
| **Cross-Browser** | `webextension-polyfill` (Promise-based `browser.*` APIs) |
| **Manifest** | Manifest V3 |
| **State** | `browser.storage.local` |
| **Messaging** | `browser.runtime.connect` (port-based) + `browser.runtime.sendMessage` |
| **Styling** | CSS custom properties (no preprocessor) |
| **I18n** | Custom loader + `_locales/{lang}/messages.json` |

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome / Chromium | Full support (Manifest V3) |
| Microsoft Edge | Full support (Manifest V3) |
| Firefox | Full support (Manifest V3, `webextension-polyfill`) |
| Safari | Supported via `safari-web-extension-converter` |

## Privacy

[Privacy Policy](https://github.com/humo0818/UniBookmarkSync/blob/master/PRIVACY.md)

## License

[MIT License](https://github.com/humo0818/UniBookmarkSync/blob/master/LICENSE.md)

---

*Developed by ClaudeCode --- Cost 6$*
