/**
 * SHA-256 hash utility for bookmark change detection.
 *
 * Hashes only the semantic bookmark structure (id, title, url, children),
 * NOT timestamps — so unchanged bookmarks produce stable hashes.
 */
export async function sha256(input) {
  let obj;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { obj = input; }
  } else {
    obj = input;
  }

  // Strip timestamps for stable comparison
  const canonical = obj.roots
    ? { version: obj.version, roots: stripTimestamps(obj.roots) }
    : obj;

  const data = new TextEncoder().encode(JSON.stringify(canonical));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Remove date fields from tree nodes for canonical hashing. */
function stripTimestamps(roots) {
  const cleaned = {};
  for (const [key, root] of Object.entries(roots)) {
    cleaned[key] = stripNodeDates(root);
  }
  return cleaned;
}

function stripNodeDates(node) {
  const entry = { id: node.id, title: node.title || '' };
  if (node.url) entry.url = node.url;
  if (node.children && node.children.length > 0) {
    entry.children = node.children.map(stripNodeDates);
  }
  return entry;
}

export default sha256;
