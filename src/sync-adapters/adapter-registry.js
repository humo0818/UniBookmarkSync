/**
 * Adapter Registry — maps adapter IDs to constructors.
 *
 * Add new sync backends here by registering them with an ID.
 */
import { ADAPTERS } from '../shared/constants.js';
import { WebDAVAdapter } from './webdav-adapter.js';
import { GitAdapter } from './git-adapter.js';

const registry = {
  [ADAPTERS.WEBDAV]: WebDAVAdapter,
  [ADAPTERS.GIT]: GitAdapter,
};

/** Create an adapter instance from config. */
export function createAdapter(config) {
  const AdapterClass = registry[config?.adapter];
  if (!AdapterClass) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown adapter '${config?.adapter}'. Available: ${available}`);
  }
  return new AdapterClass(config);
}

/** Register a custom adapter (for extensibility). */
export function registerAdapter(id, adapterClass) {
  registry[id] = adapterClass;
}

export function getAvailableAdapters() {
  return Object.keys(registry);
}

export default { createAdapter, registerAdapter, getAvailableAdapters };
