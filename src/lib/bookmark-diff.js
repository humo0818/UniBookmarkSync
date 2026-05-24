/**
 * Bookmark Tree Diff — computes additions, removals, and modifications
 * between two serialized bookmark trees.
 */
export function diff(oldTree, newTree) {
  const added = [];
  const removed = [];
  const modified = [];

  const oldMap = flattenTree(oldTree.roots);
  const newMap = flattenTree(newTree.roots);

  // Find added and modified nodes
  for (const [id, newNode] of newMap) {
    if (!oldMap.has(id)) {
      added.push({ id, node: newNode });
    } else {
      const oldNode = oldMap.get(id);
      if (nodeChanged(oldNode, newNode)) {
        modified.push({ id, old: oldNode, new: newNode });
      }
    }
  }

  // Find removed nodes
  for (const [id, oldNode] of oldMap) {
    if (!newMap.has(id)) {
      removed.push({ id, node: oldNode });
    }
  }

  const hasChanges = added.length + removed.length + modified.length > 0;
  return { added, removed, modified, hasChanges };
}

// ── Helpers ─────────────────────────────────────────

/** Flatten a nested tree into a Map<stableId, flatNode>. */
function flattenTree(roots) {
  const map = new Map();
  for (const rootNode of Object.values(roots)) {
    walkTree(rootNode, map);
  }
  return map;
}

function walkTree(node, map) {
  map.set(node.id, {
    title: node.title,
    url: node.url || null,
    hasChildren: node.children ? true : false,
  });
  if (node.children) {
    for (const child of node.children) walkTree(child, map);
  }
}

function nodeChanged(a, b) {
  return a.title !== b.title || a.url !== b.url;
}

export default diff;
