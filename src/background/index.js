/**
 * Background Service Worker entry point.
 * Initializes the sync manager and handles install/update events.
 */
import browser from '../lib/browser-polyfill.js';
import * as logger from '../lib/logger.js';
import { init } from './sync-manager.js';

logger.info('background', 'UniBookmarkSync starting...');

browser.runtime.onInstalled.addListener(() => {
  logger.info('background', 'Extension installed/updated');
});

init();
