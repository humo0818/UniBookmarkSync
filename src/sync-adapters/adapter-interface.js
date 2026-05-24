/**
 * Adapter Interface (JSDoc contract)
 *
 * Every sync adapter must implement:
 *
 * - fetchRemote(): Promise<{ status: 'unchanged' } | { status: 'changed', tree, hash, etag? }>
 *     Fetch the remote bookmark tree. Return 'unchanged' if remote matches last known state.
 *
 * - pushLocal(tree, hash, options?): Promise<void>
 *     Push the local bookmark tree to remote. Throws ConflictError on conflict.
 *
 * - testConnection(): Promise<{ ok: boolean, error?: string }>
 *     Verify the connection is working.
 *
 * Config shapes:
 *   WebDAV: { adapter: 'webdav', webdavUrl, webdavUser, webdavPass }
 *   Git:    { adapter: 'git', gitRemote, gitBranch, gitToken }
 */

/**
 * Factory function for creating adapter instance from config.
 */
export function createAdapter(config) {
  switch (config?.adapter) {
    case 'webdav':
      return new WebDAVAdapter(config);
    case 'git':
      return new GitAdapter(config);
    default:
      throw new Error(`Unknown adapter: ${config?.adapter}`);
  }
}
