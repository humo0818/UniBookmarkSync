import { defineConfig } from 'vite';
import webExtension from '@samrum/vite-plugin-web-extension';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const TARGET = process.env.BROWSER || 'chrome';

const base = JSON.parse(
  readFileSync(resolve('manifest.base.json'), 'utf-8')
);

let overrides = {};
switch (TARGET) {
  case 'firefox':
    overrides = JSON.parse(
      readFileSync(resolve('src/manifest/firefox.overrides.json'), 'utf-8')
    );
    break;
  case 'safari':
    overrides = JSON.parse(
      readFileSync(resolve('src/manifest/safari.overrides.json'), 'utf-8')
    );
    break;
  default:
    overrides = JSON.parse(
      readFileSync(resolve('src/manifest/chrome.overrides.json'), 'utf-8')
    );
}

const manifest = { ...base, ...overrides };

export default defineConfig({
  plugins: [
    preact(),
    webExtension({
      manifest,
      useDynamicUrlWebAccessibleResources: TARGET !== 'firefox',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve('src'),
      'browser': resolve('node_modules/webextension-polyfill/dist/browser-polyfill.min.js'),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: `dist/${TARGET}`,
  },
});
