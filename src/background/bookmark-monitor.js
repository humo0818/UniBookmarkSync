/**
 * Bookmark Monitor — listens for browser bookmark change events.
 * Suppresses events during bulk import (Chrome only).
 */
import browser from '../lib/browser-polyfill.js';
import * as logger from '../lib/logger.js';

const LOG_TAG = 'bookmark-monitor';

let importInProgress = false;

export function startMonitoring(onChange) {
  browser.bookmarks.onCreated.addListener((id, bookmark) => {
    if (importInProgress) return;
    logger.debug(LOG_TAG, 'Created:', bookmark.title);
    onChange({ type: 'created', id, info: bookmark });
  });

  browser.bookmarks.onChanged.addListener((id, changeInfo) => {
    if (importInProgress) return;
    logger.debug(LOG_TAG, 'Changed:', id);
    onChange({ type: 'changed', id, info: changeInfo });
  });

  browser.bookmarks.onRemoved.addListener((id, removeInfo) => {
    if (importInProgress) return;
    logger.debug(LOG_TAG, 'Removed:', id);
    onChange({ type: 'removed', id, info: removeInfo });
  });

  browser.bookmarks.onMoved.addListener((id, moveInfo) => {
    if (importInProgress) return;
    logger.debug(LOG_TAG, 'Moved:', id);
    onChange({ type: 'moved', id, info: moveInfo });
  });

  // Chrome-only: pause monitoring during bulk import
  if (browser.bookmarks.onImportBegan) {
    browser.bookmarks.onImportBegan.addListener(() => {
      logger.info(LOG_TAG, 'Import began — pausing');
      importInProgress = true;
    });
    browser.bookmarks.onImportEnded.addListener(() => {
      logger.info(LOG_TAG, 'Import ended — resuming');
      importInProgress = false;
      onChange({ type: 'import-ended', id: null, info: null });
    });
  }

  logger.info(LOG_TAG, 'Monitoring started');
}

export function isImporting() {
  return importInProgress;
}
