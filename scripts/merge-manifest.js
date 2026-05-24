import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const target = process.env.BROWSER || 'chrome';

const base = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.base.json'), 'utf-8')
);

let overrides = {};
if (target === 'firefox') {
  overrides = JSON.parse(
    fs.readFileSync(path.join(root, 'src/manifest/firefox.overrides.json'), 'utf-8')
  );
} else if (target === 'safari') {
  overrides = JSON.parse(
    fs.readFileSync(path.join(root, 'src/manifest/safari.overrides.json'), 'utf-8')
  );
} else {
  // Chrome, Edge, and other Chromium-based browsers
  overrides = JSON.parse(
    fs.readFileSync(path.join(root, 'src/manifest/chrome.overrides.json'), 'utf-8')
  );
}

const merged = { ...base, ...overrides };

const outDir = path.join(root, 'dist', target);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(merged, null, 2)
);

console.log(`Manifest merged for ${target} -> dist/${target}/manifest.json`);
