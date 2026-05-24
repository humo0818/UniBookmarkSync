import browser from './browser-polyfill.js';

export const ROOT_NAMES = ['bookmark_bar', 'other', 'mobile'];

export function makeStableId(pathSegments) {
  return pathSegments.map((s) => encodeURIComponent(s)).join('/');
}

export function parseStableId(stableId) {
  return stableId.split('/').map((s) => decodeURIComponent(s));
}

export async function serialize() {
  const tree = await browser.bookmarks.getTree();
  // tree[0] is hidden root, tree[0].children are visible roots
  const visibleRoots = tree[0].children;
  const roots = {};
  for (let i = 0; i < ROOT_NAMES.length; i++) {
    const rootName = ROOT_NAMES[i];
    const root = visibleRoots[i];
    if (!root) continue;
    const converted = convertNode(root, [rootName], true);
    roots[rootName] = converted;
  }
  const out = { version: 1, roots };
  out.hash = await hashTree(out);
  out.timestamp = new Date().toISOString();
  return out;
}

function convertNode(node, pathSegments, isRoot) {
  const stableId = makeStableId(pathSegments);
  const item = {
    id: stableId,
    title: node.title || '',
    dateAdded: node.dateAdded,
    dateGroupModified: node.dateGroupModified,
  };
  if (!isRoot && node.url) {
    item.url = node.url;
  }
  if (node.children && node.children.length > 0) {
    item.children = node.children.map((child) => {
      const childSegments = [...pathSegments, child.title || child.url || 'untitled'];
      return convertNode(child, childSegments, false);
    });
  }
  return item;
}

export async function deserialize(treeData) {
  const tree = await browser.bookmarks.getTree();
  const localRoots = tree[0].children;
  for (let i = 0; i < ROOT_NAMES.length; i++) {
    const rootName = ROOT_NAMES[i];
    const remoteRoot = treeData.roots[rootName];
    if (!remoteRoot) continue;
    const localRoot = localRoots[i];
    if (!localRoot) continue;
    await applyNode(remoteRoot, localRoot.id, [rootName]);
  }
}

export async function restoreTree(treeData) {
  const tree = await browser.bookmarks.getTree();
  const localRoots = tree[0].children;
  for (let i = 0; i < ROOT_NAMES.length; i++) {
    const rootName = ROOT_NAMES[i];
    const remoteRoot = treeData.roots[rootName];
    if (!remoteRoot) continue;
    const localRoot = localRoots[i];
    if (!localRoot) continue;
    await clearFolder(localRoot.id);
    for (const child of (remoteRoot.children || [])) {
      await createNode(child, localRoot.id, [rootName]);
    }
  }
}

async function clearFolder(parentId) {
  const children = await browser.bookmarks.getChildren(parentId);
  for (const child of children.reverse()) {
    try {
      await browser.bookmarks.removeTree(child.id);
    } catch (e) {
      // Some items may be protected; skip them
      console.warn('clearFolder skip:', child.title, e.message);
    }
  }
}

async function createNode(remoteNode, localParentId, pathSegments) {
  if (remoteNode.url) {
    await browser.bookmarks.create({
      parentId: localParentId,
      title: remoteNode.title,
      url: remoteNode.url,
    });
    return;
  }
  // Folder
  const created = await browser.bookmarks.create({
    parentId: localParentId,
    title: remoteNode.title,
  });
  if (remoteNode.children) {
    for (const child of remoteNode.children) {
      await createNode(child, created.id, [...pathSegments, child.title || 'untitled']);
    }
  }
}

async function applyNode(remoteNode, localParentId, pathSegments) {
  const existing = await browser.bookmarks.search({ title: remoteNode.title });
  const sameTitle = existing.filter((b) => b.parentId === localParentId);

  if (remoteNode.url) {
    if (sameTitle.length === 0) {
      await browser.bookmarks.create({
        parentId: localParentId,
        title: remoteNode.title,
        url: remoteNode.url,
      });
    }
    return;
  }

  // Folder
  let folderId;
  if (sameTitle.length > 0 && !sameTitle[0].url) {
    folderId = sameTitle[0].id;
  } else {
    const created = await browser.bookmarks.create({
      parentId: localParentId,
      title: remoteNode.title,
    });
    folderId = created.id;
  }

  if (remoteNode.children) {
    for (const child of remoteNode.children) {
      const childSegments = [...pathSegments, child.title || 'untitled'];
      await applyNode(child, folderId, childSegments);
    }
  }
}

async function hashTree(treeData) {
  const str = JSON.stringify({ version: treeData.version, roots: treeData.roots });
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { hashTree };
