// Proves the study persistence primitive: a tree with variations AND user
// annotations (comments / shapes / glyphs / gamebook) survives serialize →
// deserialize → serialize unchanged, positions are rebuilt from UCIs alone (no
// stored board state), mainline order is preserved, and a corrupt/illegal blob
// degrades to its legal prefix instead of throwing. Moves are drawn from the real
// xiangqi kernel so they are guaranteed legal (same pattern as game-tree.test.ts).

import {
  applyFFQBanqiReplayMove,
  applyStandardXiangqiMove,
  createInitialFFQBanqiReplayState,
  createInitialXiangqiState,
  FFQ_BANQI_PUBLIC_REPLAY,
  type FFQBanqiPlayerView,
  type FFQBanqiReplayIdentity,
  type FFQBanqiReplayMove,
  type FFQBanqiReplayState,
  ffqBanqiReplayMoveToUci,
  getFFQBanqiPlayerView,
  getStandardXiangqiLegalMoves,
  parseFFQBanqiReplayMove,
  parseStandardXiangqiFen,
  type XiangqiMove,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { createGameTree, ROOT_PATH, type VariantTreeAdapter } from './game-tree.js';
import { deserializeTree, type SerializedTree, serializeTree } from './tree-serialize.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

function realMoves(): { mainline: XiangqiMove[]; altFirst: XiangqiMove } {
  const s0 = createInitialXiangqiState('fixture');
  const first = getStandardXiangqiLegalMoves(s0);
  const m1 = first[0]!;
  const altFirst = first[1]!;
  const s1 = applyStandardXiangqiMove(s0, m1);
  const m2 = getStandardXiangqiLegalMoves(s1)[0]!;
  const s2 = applyStandardXiangqiMove(s1, m2);
  const m3 = getStandardXiangqiLegalMoves(s2)[0]!;
  return { mainline: [m1, m2, m3], altFirst };
}

// A 3-ply mainline + a root variation, with an annotation on the root, a mainline
// node, and the variation node.
function annotatedTree() {
  const { mainline, altFirst } = realMoves();
  const tree = createGameTree(xiangqiTreeAdapter, mainline);
  const branch = tree.addMove(ROOT_PATH, altFirst)!;
  const firstMainline = [tree.root.children[0]!.id];

  tree.annotateAt(ROOT_PATH, { comments: [{ by: 'u1', text: 'Start position.' }] });
  tree.annotateAt(firstMainline, {
    glyphs: [1],
    shapes: [{ kind: 'arrow', brush: 'green', orig: mainline[0]!.from, dest: mainline[0]!.to }],
    gamebook: { hint: 'Develop a piece.' },
  });
  tree.annotateAt(branch, { comments: [{ by: 'u1', text: 'Also playable.' }] });
  return { tree, mainline, altFirst, firstMainline, branch };
}

describe('tree-serialize', () => {
  it('round-trips a tree with variations and annotations unchanged', () => {
    const { tree } = annotatedTree();
    const s1 = serializeTree(tree, xiangqiTreeAdapter);
    const rebuilt = deserializeTree(xiangqiTreeAdapter, s1);
    const s2 = serializeTree(rebuilt, xiangqiTreeAdapter);
    expect(s2).toEqual(s1);
  });

  it('preserves annotation content across a round trip', () => {
    const { tree, firstMainline } = annotatedTree();
    const rebuilt = deserializeTree(xiangqiTreeAdapter, serializeTree(tree, xiangqiTreeAdapter));

    expect(rebuilt.nodeAt(ROOT_PATH)?.annotations?.comments?.[0]?.text).toBe('Start position.');
    const node = rebuilt.nodeAt(firstMainline);
    expect(node?.annotations?.glyphs).toEqual([1]);
    expect(node?.annotations?.gamebook?.hint).toBe('Develop a piece.');
    expect(node?.annotations?.shapes?.[0]?.kind).toBe('arrow');
  });

  it('rebuilds positions from UCIs alone (no stored board state)', () => {
    const { tree, mainline } = annotatedTree();
    const rebuilt = deserializeTree(xiangqiTreeAdapter, serializeTree(tree, xiangqiTreeAdapter));
    // The mainline reconstructs to full depth and the tip truth is playable.
    expect(rebuilt.last()).toHaveLength(mainline.length);
    const tip = rebuilt.nodeAt(rebuilt.last());
    expect(tip?.ply).toBe(mainline.length);
    expect(rebuilt.project(tip!)).toHaveLength(1); // open variant → single truth view
  });

  it('keeps children[0] as the mainline (variation order preserved)', () => {
    const { tree, mainline, altFirst } = annotatedTree();
    const s1 = serializeTree(tree, xiangqiTreeAdapter);
    expect(s1.root.children).toHaveLength(2);
    expect(s1.root.children[0]?.uci).toBe(xiangqiTreeAdapter.toEngineUci(mainline[0]!));
    expect(s1.root.children[1]?.uci).toBe(xiangqiTreeAdapter.toEngineUci(altFirst));
  });

  it('prunes empty annotations from the blob', () => {
    const { mainline } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    tree.annotateAt([tree.root.children[0]!.id], { comments: [], shapes: [], glyphs: [] });
    const s1 = serializeTree(tree, xiangqiTreeAdapter);
    expect(s1.root.children[0]?.annotations).toBeUndefined();
  });

  it('drops an unparseable or illegal node and its subtree, keeping legal siblings', () => {
    const { mainline } = realMoves();
    const legalUci = xiangqiTreeAdapter.toEngineUci(mainline[0]!);
    const corrupt: SerializedTree = {
      version: 1,
      root: {
        children: [
          { uci: 'z9z9', children: [{ uci: legalUci, children: [] }] }, // unparseable → whole subtree dropped
          { uci: legalUci, children: [] }, // legal → grafted
        ],
      },
    };
    const tree = deserializeTree(xiangqiTreeAdapter, corrupt);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0]?.id).toBe(legalUci);
  });
});

describe('Fanfanqi public replay metadata', () => {
  const opening: FFQBanqiReplayIdentity[] = [
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'advisor' },
  ];
  // Exercise the persistence seam without adding study dispatch in this slice.
  const adapter: VariantTreeAdapter<FFQBanqiReplayMove, FFQBanqiReplayState, FFQBanqiPlayerView> = {
    mode: 'perfect-info',
    initialTruth: () => createInitialFFQBanqiReplayState('study', opening),
    isLegal: (state, move) => {
      try {
        applyFFQBanqiReplayMove(state, move);
        return true;
      } catch {
        return false;
      }
    },
    applyMove: applyFFQBanqiReplayMove,
    project: (state) => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        view: getFFQBanqiPlayerView(state, 'observer'),
      },
    ],
    moveLabel: ffqBanqiReplayMoveToUci,
    moveKey: ffqBanqiReplayMoveToUci,
    toEngineUci: ffqBanqiReplayMoveToUci,
    fromUci: parseFFQBanqiReplayMove,
  };
  const meta = { replay: FFQ_BANQI_PUBLIC_REPLAY, initialRevealed: opening } as const;

  it('round-trips complete observed outcomes, branches, annotations and public opening only', () => {
    const tree = createGameTree(adapter);
    const first = tree.addMove([], {
      from: 6,
      to: 4,
      capturedHidden: { color: 'red', role: 'general' },
    })!;
    tree.addMove(first, { from: 0, to: 0, revealed: { color: 'black', role: 'cannon' } });
    tree.addMove([], { from: 1, to: 1, revealed: { color: 'red', role: 'advisor' } });
    tree.annotateAt(first, { comments: [{ by: 'u1', text: 'Public covered capture.' }] });
    const blob = serializeTree(tree, adapter, meta);
    const rebuilt = deserializeTree(adapter, JSON.parse(JSON.stringify(blob)));
    expect(JSON.parse(JSON.stringify(serializeTree(rebuilt, adapter, meta)))).toEqual({
      version: 1,
      ...meta,
      root: {
        children: [
          {
            uci: 'c1a1x:G',
            annotations: { comments: [{ by: 'u1', text: 'Public covered capture.' }] },
            children: [{ uci: '@a0:c', children: [] }],
          },
          { uci: '@b0:A', children: [] },
        ],
      },
    });
    expect(JSON.stringify(blob)).not.toMatch(/rootFen|board|deal|seed/);
    expect(rebuilt.nodeAt(first)?.truth.hp).toEqual({ red: 30, black: 60 });
    expect(tree.addMove([], { from: 2, to: 2 })).toBeNull();
  });

  it('rejects dealt roots, missing or impossible opening identities, and misplaced opening metadata', () => {
    const tree = createGameTree(adapter);
    for (const rootFen of ['secret', '']) {
      expect(() => serializeTree(tree, adapter, { ...meta, rootFen })).toThrow(/dealt root/);
      expect(() =>
        deserializeTree(adapter, { version: 1, root: { children: [] }, ...meta, rootFen }),
      ).toThrow(/dealt root/);
    }
    expect(() => serializeTree(tree, adapter, { replay: FFQ_BANQI_PUBLIC_REPLAY })).toThrow();
    expect(() =>
      serializeTree(tree, adapter, {
        ...meta,
        initialRevealed: Array(4).fill({ color: 'red', role: 'general' }),
      }),
    ).toThrow();
    expect(() => serializeTree(tree, adapter, { initialRevealed: opening })).toThrow();
    const blob = serializeTree(tree, adapter, meta);
    blob.root.children = [{ uci: '@a0:G', children: [{ uci: '@b0:G', children: [] }] }];
    expect(deserializeTree(adapter, blob).mainlinePath()).toHaveLength(1);
  });
});

describe('rootFen (hand-set start positions)', () => {
  // Red cannon + soldier vs bare general — unreachable from the standard start,
  // so a wrongly-rooted rebuild would reject the seeded move as illegal.
  const COMPOSITION_FEN = '3k5/4P4/9/9/9/9/9/4C4/9/4K4 r - - 0 1';

  function compositionState() {
    const parsed = parseStandardXiangqiFen(COMPOSITION_FEN);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.state;
  }

  it('createGameTree roots at the provided truth and accepts its legal moves', () => {
    const state = compositionState();
    const tree = createGameTree(xiangqiTreeAdapter, [], state);
    expect(tree.root.truth.board.e9).toEqual({ color: 'red', role: 'soldier' });
    // e9-e10 is legal ONLY from the composition (from the standard start e9 is empty).
    const path = tree.addMove(ROOT_PATH, { from: 'e9', to: 'e10' });
    expect(path).not.toBeNull();
  });

  it('serialize carries rootFen and deserialize replays from the resolved root', () => {
    const state = compositionState();
    const tree = createGameTree(xiangqiTreeAdapter, [], state);
    tree.addMove(ROOT_PATH, { from: 'e9', to: 'e10' });
    const blob = serializeTree(tree, xiangqiTreeAdapter, { rootFen: COMPOSITION_FEN });
    expect(blob.rootFen).toBe(COMPOSITION_FEN);

    // Loader resolves rootFen → truth (the adapter has no FEN hook), then rebuilds.
    const parsed = parseStandardXiangqiFen(blob.rootFen!);
    if (!parsed.ok) throw new Error(parsed.error);
    const rebuilt = deserializeTree(xiangqiTreeAdapter, blob, parsed.state);
    expect(rebuilt.root.children).toHaveLength(1);
    expect(rebuilt.root.children[0]!.id).toBe('e9e10');

    // Without the resolved root the move is illegal from the standard start and
    // the blob degrades to its prefix — the regression this field prevents.
    const wrongRoot = deserializeTree(xiangqiTreeAdapter, blob);
    expect(wrongRoot.root.children).toHaveLength(0);
  });

  it('a blob without rootFen keeps the standard start', () => {
    const { mainline } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    const blob = serializeTree(tree, xiangqiTreeAdapter);
    expect(blob.rootFen).toBeUndefined();
  });
});
