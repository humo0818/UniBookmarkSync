/**
 * Internationalization — custom i18n with storage-backed language preference.
 *
 * Loads messages from _locales/{lang}/messages.json.
 * Falls back to browser.i18n for manifest-referenced keys.
 * Chrome forbids hyphens in i18n keys, so hyphens are normalized
 * to underscores on lookup.
 */
import browser from './browser-polyfill.js';

const messages = {};
let currentLang = 'en';

/** Initialize — load saved language or detect from browser. */
export async function init() {
  const result = await browser.storage.sync.get('lang');
  // Detect browser language; default to 'en' unless Chinese
  let uiLang = 'en';
  try {
    const raw = browser.i18n.getUILanguage();
    uiLang = typeof raw === 'string' ? raw : 'en';
  } catch { /* keep default */ }

  currentLang = result.lang || (uiLang.startsWith('zh') ? 'zh_CN' : 'en');
  await loadMessages(currentLang);
}

/** Switch language and persist preference. */
export async function setLang(lang) {
  currentLang = lang;
  await browser.storage.sync.set({ lang });
  await loadMessages(lang);
}

export function getLang() {
  return currentLang;
}

/** Fetch and cache messages for a language. */
async function loadMessages(lang) {
  try {
    const url = browser.runtime.getURL(`_locales/${lang.replace('-', '_')}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();

    // Clear previous language
    for (const key of Object.keys(messages)) delete messages[key];

    // Load messages, also storing underscore variants for hyphenated key access
    for (const [key, val] of Object.entries(data)) {
      messages[key] = val.message;
      const underscoreKey = key.replace(/-/g, '_');
      if (underscoreKey !== key) messages[underscoreKey] = val.message;
    }
  } catch { /* network error — use browser.i18n fallback */ }
}

/**
 * Translate a key to the current language.
 * Normalizes hyphens to underscores for Chrome i18n compatibility.
 */
export function t(key, substitutions) {
  const normalized = key.replace(/-/g, '_');
  let msg = messages[key] || messages[normalized];

  // Fallback to browser.i18n for manifest-referenced keys
  if (!msg) {
    try { msg = browser.i18n.getMessage(key, substitutions); }
    catch { /* use key as-is */ }
  }
  if (!msg) msg = key;

  // Replace Chrome i18n placeholders ($name$ or $1)
  if (substitutions && typeof substitutions === 'string') {
    msg = msg.replace(/\$[^$]+\$/g, substitutions);
  }
  return msg;
}

export default { init, setLang, getLang, t };
