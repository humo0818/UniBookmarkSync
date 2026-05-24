/**
 * Conflict Resolver — merges local and remote bookmark trees.
 *
 * Three strategies:
 *   local-first  — local always wins
 *   remote-first — remote always wins
 *   smart-merge  — three-way merge using last common ancestor
 */
import { CONFLICT_STRATEGIES } from '../shared/constants.js';
import { ConflictError } from '../shared/errors.js';
import diff from '../lib/bookmark-diff.js';

export async function resolve(localTree, remoteTree, lcaTree, strategy) {
  switch (strategy) {
    case CONFLICT_STRATEGIES.REMOTE_FIRST:
      return { tree: remoteTree, resolution: 'remote' };

    case CONFLICT_STRATEGIES.SMART_MERGE:
      if (!lcaTree) return { tree: localTree, resolution: 'local', fallback: 'no-lca' };
      return threeWayMerge(localTree, remoteTree, lcaTree);

    case CONFLICT_STRATEGIES.LOCAL_FIRST:
    default:
      return { tree: localTree, resolution: 'local' };
  }
}

// ── Three-way merge implementation ──────────────────

function threeWayMerge(localTree, remoteTree, lcaTree) {
  const localDiff = diff(lcaTree, localTree);
  const remoteDiff = diff(lcaTree, remoteTree);

  if (!localDiff.hasChanges) return { tree: remoteTree, resolution: 'remote' };
  if (!remoteDiff.hasChanges) return { tree: localTree, resolution: 'local' };

  // Check for overlapping changes to same nodes
  const localIds = collectChangedIds(localDiff);
  const remoteIds = collectChangedIds(remoteDiff);
  const overlapping = [...localIds].filter((id) => remoteIds.has(id));

  if (overlapping.length === 0) {
    // No overlap — auto-merge safely
    return { tree: mergeTrees(lcaTree, localDiff, remoteDiff), resolution: 'merged' };
  }

  // True conflict — requires manual resolution
  throw new ConflictError(
    `Conflicting changes to ${overlapping.length} bookmark(s)`,
    localTree,
    remoteTree
  );
}

function collectChangedIds(diffResult) {
  return new Set([
    ...diffResult.added.map((e) => e.id),
    ...diffResult.removed.map((e) => e.id),
    ...diffResult.modified.map((e) => e.id),
  ]);
}

// ── Tree merge helpers ──────────────────────────────

function mergeTrees(base, localDiff, remoteDiff) {
  const tree = structuredClone(base);
  // Apply remote first, then local (local wins for non-overlapping changes)
  applyDiff(tree, remoteDiff);
  applyDiff(tree, localDiff);
  return tree;
}

function applyDiff(tree, diffResult) {
  for (const entry of diffResult.added) addNode(tree.roots, entry.id, entry.node);
  for (const entry of diffResult.removed) removeNode(tree.roots, entry.id);
  for (const entry of diffResult.modified) updateNode(tree.roots, entry.id, entry.new);
}

// ── Tree node operations ────────────────────────────

function addNode(roots, stableId, node) {
  const [rootName, ...rest] = stableId.split('/').map(decodeURIComponent);
  if (!roots[rootName]) return;
  insertAtPath(roots[rootName], rest, node);
}

function removeNode(roots, stableId) {
  const [rootName, ...rest] = stableId.split('/').map(decodeURIComponent);
  if (!roots[rootName]) return;
  deleteAtPath(roots[rootName], rest);
}

function updateNode(roots, stableId, newNode) {
  const [rootName, ...rest] = stableId.split('/').map(decodeURIComponent);
  if (!roots[rootName]) return;
  const target = findAtPath(roots[rootName], rest);
  if (target) {
    if (newNode.title !== undefined) target.title = newNode.title;
    if (newNode.url !== undefined) target.url = newNode.url;
  }
}

function findAtPath(node, segments) {
  if (segments.length === 0) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    if (child.title === segments[0]) return findAtPath(child, segments.slice(1));
  }
  return null;
}

function insertAtPath(node, segments, newNode) {
  if (segments.length === 1) {
    if (!node.children) node.children = [];
    node.children.push(newNode);
    node.children.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return;
  }
  if (!node.children) node.children = [];
  let target = node.children.find((c) => c.title === segments[0]);
  if (!target) {
    target = { title: segments[0], children: [] };
    node.children.push(target);
  }
  insertAtPath(target, segments.slice(1), newNode);
}

function deleteAtPath(node, segments) {
  if (segments.length === 1) {
    if (node.children) node.children = node.children.filter((c) => c.title !== segments[0]);
    return;
  }
  if (!node.children) return;
  const child = node.children.find((c) => c.title === segments[0]);
  if (child) {
    deleteAtPath(child, segments.slice(1));
    // Prune empty folders
    if (child.children && child.children.length === 0 && !child.url) {
      node.children = node.children.filter((c) => c !== child);
    }
  }
}
