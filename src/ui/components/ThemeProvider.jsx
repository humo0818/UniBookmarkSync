import { createContext } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import browser from '../../lib/browser-polyfill.js';
import { THEMES, STORAGE_KEYS } from '../../shared/constants.js';

export const ThemeContext = createContext(THEMES.AUTO);

/**
 * Provides theme state (auto/light/dark) to the component tree.
 * Persists preference to storage and syncs across extension pages.
 */
export default function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(THEMES.AUTO);

  useEffect(() => {
    // Load saved preference
    browser.storage.sync.get(STORAGE_KEYS.THEME_PREFERENCE).then((result) => {
      const pref = result[STORAGE_KEYS.THEME_PREFERENCE] || THEMES.AUTO;
      setThemeState(pref);
      applyTheme(pref);
    });

    // Listen for changes from other pages
    const handler = (changes) => {
      if (changes[STORAGE_KEYS.THEME_PREFERENCE]) {
        const pref = changes[STORAGE_KEYS.THEME_PREFERENCE].newValue || THEMES.AUTO;
        setThemeState(pref);
        applyTheme(pref);
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }, []);

  function setTheme(pref) {
    setThemeState(pref);
    applyTheme(pref);
    browser.storage.sync.set({ [STORAGE_KEYS.THEME_PREFERENCE]: pref });
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Set data-theme attribute on <html> for CSS to react. */
function applyTheme(pref) {
  if (pref === THEMES.LIGHT) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else if (pref === THEMES.DARK) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme'); // auto: follow OS
  }
}
