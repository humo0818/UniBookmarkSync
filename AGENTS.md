# AGENTS.md — UniBookmarkSync

## Build & Dev

- `npm run build:{chrome|firefox|edge|safari}` — production builds, output to `dist/{browser}/`
- `npm run dev:{chrome|firefox}` — watch mode via `cross-env BROWSER=... vite build --watch`
- `npm run build:all` — builds all 4 browsers sequentially
- No `dev:edge` or `dev:safari` scripts exist — use build and reload manually

## Tech Stack (Surprising)

- **Preact** (not React) — import from `preact` and `preact/hooks`; JSX pragma auto via @preact/preset-vite
- **Pure JavaScript** — no TypeScript, no typecheck, no lint step
- **No test suite** — no jest, vitest, or any test framework configured
- **CSS** — plain CSS custom properties (no preprocessor); theme via `[data-theme]` attribute on `<html>`

## Vite Aliases

- `@/` → `src/`
- `browser` → `webextension-polyfill/dist/browser-polyfill.min.js` (resolved at build time)

## Architecture

```
src/background/       — MV3 service worker entrypoint (index.js → sync-manager.js)
src/sync-adapters/    — WebDAV and Git adapter implementations
src/lib/              — Shared utilities (bookmark-tree, hash, diff, i18n, logger)
src/shared/           — Constants, enums, error classes
src/ui/               — Preact popup + options pages + components
public/_locales/      — i18n messages.json (8 languages)
public/icons/         — Extension icons
```

## Import Conventions

- Always import `browser` from `../lib/browser-polyfill.js` (Promise-based webextension-polyfill wrapper) — never import `webextension-polyfill` directly
- Use `import * as logger` for logging; calls: `logger.info('tag', 'msg', data)`
- Shared constants from `../shared/constants.js`; error classes from `../shared/errors.js`

## Manifest & Browser Overrides

- Base manifest: `manifest.base.json`
- Per-browser overrides: `src/manifest/{chrome,firefox,safari}.overrides.json`
- Merged at build time in `vite.config.js` (no separate merge step needed)
- Chrome/Edge: `service_worker`; Firefox: `scripts` array + `browser_specific_settings.gecko.id`
- `.gitignore` explicitly ignores `CLAUDE.md` — do not create or rely on it

## i18n Quirks

- Chrome forbids hyphens in `chrome.i18n.getMessage()` keys
- Custom i18n (`src/lib/i18n.js`) normalizes hyphens → underscores on lookup
- Use `t('key-name')` for UI strings; call `await init()` before first render

## Sync State Model (Critical)

- **Per-adapter independence** — WebDAV and Git each have separate:
  - Auto-sync toggle (`autoSync_webdav` / `autoSync_git` storage keys)
  - Conflict resolution strategy (`conflictResolution_webdav` / `conflictResolution_git`)
  - Sync status (idle / syncing / error / conflict)
- Popup tab selection (`activeAdapter` in storage) determines which adapter syncs
- `pendingSyncFlags` (`{ branch, description, force }`) are passed via manual-sync message; cleared after use

## MV3 Service Worker Notes

- Service worker can be terminated at any time — state is persisted to `browser.storage.local`
- Popup uses `browser.runtime.connect({ name: 'popup' })` for persistent communication; reconnects on disconnect
- `sync-manager.js` `init()` clears stale SYNCING/ERROR status on startup

## Storage

- Configs, sync state → `browser.storage.local`
- Theme preference, language → `browser.storage.sync`
- All keys defined in `src/shared/constants.js` → `STORAGE_KEYS`
