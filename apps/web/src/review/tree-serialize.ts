// Serialize a GameTree to plain JSON and back — the persistence primitive for
// studies (S0 of the study track; see docs-private/study-track.md). The blob
// carries only the canonical UCI of each move plus its user annotations; positions
// (truth / fen / view) are NOT stored — they are rebuilt by replaying the UCIs
// through the variant adapter on load. That keeps the blob small and
// variant-portable (no per-node board state serialized), and is what lets a study
// chapter be a single JSONB column (Decision B). children[0] stays the mainline
// across a round trip.
//
// Robustness mirrors the seed path in game-tree.ts: an unparseable or now-illegal
// UCI does not throw — it drops that node and its subtree, so a corrupt or
// cross-variant blob degrades to its legal prefix rather than crashing on load.

import {
  createInitialFFQBanqiReplayState,
  FFQ_BANQI_FACE_UP_SQUARES,
  FFQ_BANQI_PUBLIC_REPLAY,
  type FFQBanqiReplayIdentity,
  type PublicReplayFormat,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
} from '@mistboard/game';
import {
  createGameTree,
  type GameTree,
  type GameTreeNode,
  type NodeAnnotations,
  ROOT_PATH,
  type TreePath,
  type VariantTreeAdapter,
} from './game-tree.js';

/** One node in the serialized form. The root omits `uci` (it has no move); every
 *  other node carries the move's canonical UCI. `annotations` is omitted when
 *  empty. `children[0]` is the mainline; the rest are variations in promote order. */
export interface SerializedNode {
  uci?: string;
  annotations?: NodeAnnotations;
  children: SerializedNode[];
}

/** A serialized tree with a format version so the reader can migrate older blobs.
 *  `rootFen` is present only for trees rooted at a hand-set position (a
 *  composition); absent = the variant's standard start. Positions still rebuild
 *  by replay — the FEN only relocates the root, and the loader resolves it to a
 *  truth state before deserializing (the adapter has no FEN hook). */
export interface SerializedTree {
  version: 1;
  root: SerializedNode;
  rootFen?: string;
  /** Observed-outcome replay. Covered tiles have no identity. Three Kingdoms
   * starts fully covered; Fanfanqi has four public opening pieces below.
   * No rootFen, covered-square identities or sampled deal. */
  replay?: PublicReplayFormat;
  /** Fanfanqi's four public opening identities in setup-square order.
   * Covered opening tiles have no identity in this format. */
  initialRevealed?: readonly FFQBanqiReplayIdentity[];
}

function publicOpening(meta: Pick<SerializedTree, 'replay' | 'rootFen' | 'initialRevealed'>) {
  if (meta.replay !== undefined) {
    if (![THREE_KINGDOMS_BANQI_PUBLIC_REPLAY, FFQ_BANQI_PUBLIC_REPLAY].includes(meta.replay))
      throw new Error('Unknown public replay format.');
    if (meta.rootFen !== undefined) throw new Error('A public replay cannot carry a dealt root.');
  }
  if (meta.replay === FFQ_BANQI_PUBLIC_REPLAY) {
    const state = createInitialFFQBanqiReplayState('study', meta.initialRevealed!);
    return FFQ_BANQI_FACE_UP_SQUARES.map((square) => {
      const piece = state.board[square]!;
      if (piece.faceDown) throw new Error('Missing public opening piece.');
      return { color: piece.color, role: piece.role };
    });
  }
  if (meta.initialRevealed !== undefined) throw new Error('Unexpected public opening pieces.');
  return undefined;
}

/** True when at least one annotation field carries real content. Empty arrays and
 *  an empty gamebook object are treated as "none" so they prune out of the blob
 *  (and a round trip stays stable). */
function hasAnnotations(a: NodeAnnotations | undefined): a is NodeAnnotations {
  if (!a) return false;
  return (
    (a.comments?.length ?? 0) > 0 ||
    (a.shapes?.length ?? 0) > 0 ||
    (a.glyphs?.length ?? 0) > 0 ||
    a.gamebook?.hint !== undefined ||
    a.gamebook?.deviation !== undefined
  );
}

function serializeNode<M, T, V>(
  node: GameTreeNode<M, T>,
  adapter: VariantTreeAdapter<M, T, V>,
  skip?: (node: GameTreeNode<M, T>) => boolean,
): SerializedNode {
  const out: SerializedNode = {
    children: node.children
      .filter((child) => !skip?.(child))
      .map((child) => serializeNode(child, adapter, skip)),
  };
  if (node.move) out.uci = adapter.toEngineUci(node.move);
  if (hasAnnotations(node.annotations)) out.annotations = node.annotations;
  return out;
}

/** Snapshot a tree to a plain-JSON structure (safe to JSON.stringify + persist).
 *  `skip` prunes a node (and its subtree) from the blob — the tree surface uses it
 *  to keep ephemeral computer-injected refutation lines out of a saved study. */
export function serializeTree<M, T, V>(
  tree: GameTree<M, T, V>,
  adapter: VariantTreeAdapter<M, T, V>,
  opts?: {
    skip?: (node: GameTreeNode<M, T>) => boolean;
    rootFen?: string;
    replay?: SerializedTree['replay'];
    initialRevealed?: SerializedTree['initialRevealed'];
  },
): SerializedTree {
  const opening = publicOpening(opts ?? {});
  const out: SerializedTree = { version: 1, root: serializeNode(tree.root, adapter, opts?.skip) };
  if (opts?.replay) {
    out.replay = opts.replay;
  }
  if (opening) out.initialRevealed = opening;
  if (opts?.rootFen) out.rootFen = opts.rootFen;
  return out;
}

/** Rebuild a live GameTree from a serialized blob, replaying each UCI through the
 *  adapter to reconstruct positions. Unparseable / illegal nodes (and their
 *  subtrees) are skipped rather than throwing. */
export function deserializeTree<M, T, V>(
  adapter: VariantTreeAdapter<M, T, V>,
  serialized: SerializedTree,
  rootTruth?: T,
): GameTree<M, T, V> {
  publicOpening(serialized);
  const tree = createGameTree<M, T, V>(adapter, [], rootTruth);
  if (serialized.root.annotations) tree.annotateAt(ROOT_PATH, serialized.root.annotations);

  const graft = (children: SerializedNode[], parentPath: TreePath): void => {
    for (const child of children) {
      if (child.uci === undefined) continue; // non-root nodes must carry a move
      const parent = tree.nodeAt(parentPath);
      if (!parent) continue;
      const move = adapter.fromUci(child.uci, parent.truth);
      if (!move) continue; // unparseable token → drop this subtree
      const childPath = tree.addMove(parentPath, move);
      if (!childPath) continue; // illegal from this position → drop this subtree
      if (child.annotations) tree.annotateAt(childPath, child.annotations);
      graft(child.children, childPath);
    }
  };
  graft(serialized.root.children, ROOT_PATH);
  return tree;
}
