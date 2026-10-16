import type { Move } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { darkChessTreeAdapter } from './dark-chess-tree-adapter.js';
import { deserializeTree, type SerializedNode, type SerializedTree } from './tree-serialize.js';

// Web-side half of the fog hidden-info guarantee for Fog Chess: the adapter projects
// a FULLY REVEALED truth board plus each seat's fogged POV. Dark-chess fog masks by
// ABSENCE — a POV board omits every square the seat cannot see, so it can never leak
// a hidden piece's identity or existence.

const uci = (s: string): Move => {
  const m = darkChessTreeAdapter.fromUci(s, darkChessTreeAdapter.initialTruth());
  if (!m) throw new Error(`bad uci ${s}`);
  return m;
};

/** Truth after a short opening (1.e4 e5 2.Nf3). */
function sampleTruth() {
  let truth = darkChessTreeAdapter.initialTruth();
  for (const m of ['e2e4', 'e7e5', 'g1f3']) {
    truth = darkChessTreeAdapter.applyMove(truth, uci(m));
  }
  return truth;
}

describe('darkChessTreeAdapter.project', () => {
  it('projects the triptych: one primary truth board + two secondary POV boards', () => {
    const views = darkChessTreeAdapter.project(sampleTruth());
    expect(views.map((v) => v.key)).toEqual(['truth', 'white', 'black']);
    expect(views.map((v) => v.tier)).toEqual(['primary', 'secondary', 'secondary']);
  });

  it('reveals the whole board on the truth projection', () => {
    const truth = sampleTruth();
    const truthView = darkChessTreeAdapter.project(truth).find((v) => v.key === 'truth')!.view;
    // No captures in the sample line, so all 32 pieces are on the truth board, and
    // the whole board is "visible" so the fog layer paints nothing.
    expect(Object.keys(truthView.board)).toHaveLength(32);
    expect(truthView.visibleSquares.length).toBe(64);
  });

  it('hides unseen enemy pieces on the POV boards (fog masks by absence)', () => {
    const truth = sampleTruth();
    const views = darkChessTreeAdapter.project(truth);
    const truthBoard = views.find((v) => v.key === 'truth')!.view.board;

    for (const key of ['white', 'black'] as const) {
      const view = views.find((v) => v.key === key)!.view;
      const visible = new Set(view.visibleSquares);
      // Every piece the seat sees is a real piece at a square it can actually see.
      for (const [square, piece] of Object.entries(view.board)) {
        expect(visible.has(square as never)).toBe(true);
        expect(piece).toBeTruthy();
      }
      // Fog actually hides something: fewer pieces than the full truth board.
      expect(Object.keys(view.board).length).toBeLessThan(Object.keys(truthBoard).length);
      // The seat always sees its own pieces (16 at the start of this line).
      const own = Object.values(view.board).filter((p) => p?.color === key).length;
      expect(own).toBe(16);
    }
  });

  it('labels moves in SAN and round-trips move UCI', () => {
    const truth = darkChessTreeAdapter.initialTruth();
    expect(darkChessTreeAdapter.moveLabel(uci('e2e4'), truth)).toBe('e4');
    expect(darkChessTreeAdapter.moveLabel(uci('g1f3'), truth)).toBe('Nf3');
    const move = uci('e7e8q');
    expect(darkChessTreeAdapter.moveKey(move)).toBe('e7e8q');
    expect(darkChessTreeAdapter.fromUci('e7e8q', truth)).toEqual({
      from: 'e7',
      to: 'e8',
      promotion: 'queen',
    });
  });
});

/** A linear chapter tree (children[0] chains) from a UCI list. */
function linearTree(moves: string[]): SerializedTree {
  let node: SerializedNode = { children: [] };
  const root = node;
  for (const uci of moves) {
    const child: SerializedNode = { uci, children: [] };
    node.children.push(child);
    node = child;
  }
  return { version: 1, root };
}

// White castles short, Black castles long, then one more move so "replays past
// the castle" means past BOTH of them.
const CASTLING_LINE = [
  'e2e4',
  'd7d6',
  'g1f3',
  'c8e6',
  'f1c4',
  'b8c6',
  'e1g1', // O-O, standard UCI
  'd8d7',
  'b1c3',
  'e8c8', // O-O-O, standard UCI
  'd2d3',
];

describe('darkChessTreeAdapter castling spellings (#451)', () => {
  it('replays a chapter written in standard UCI castling (e1g1, e8c8) past the castle', () => {
    const tree = deserializeTree(darkChessTreeAdapter, linearTree(CASTLING_LINE));
    const tip = tree.nodeAt(tree.mainlinePath())!;
    expect(tip.ply).toBe(CASTLING_LINE.length);
    const board = tip.truth.board;
    expect(board.g1).toEqual({ color: 'white', role: 'king' });
    expect(board.f1).toEqual({ color: 'white', role: 'rook' });
    expect(board.c8).toEqual({ color: 'black', role: 'king' });
    expect(board.d8).toEqual({ color: 'black', role: 'rook' });
    expect(board.e1).toBeUndefined();
    expect(board.h1).toBeUndefined();
    expect(board.a8).toBeUndefined();
  });

  it('keys both spellings to the board form, so they land on one node', () => {
    const standard = deserializeTree(darkChessTreeAdapter, linearTree(CASTLING_LINE));
    const kingOntoRook = deserializeTree(
      darkChessTreeAdapter,
      linearTree(CASTLING_LINE.map((m) => (m === 'e1g1' ? 'e1h1' : m === 'e8c8' ? 'e8a8' : m))),
    );
    const ids = (tree: typeof standard) => tree.mainlinePath();
    expect(ids(standard)).toEqual(ids(kingOntoRook));
    expect(ids(standard)).toContain('e1h1');
    expect(ids(standard)).toContain('e8a8');
    const castle = standard.nodeAt(ids(standard).slice(0, 7))!;
    expect(castle.label).toBe('O-O');
  });

  it('leaves a non-castling king move alone', () => {
    const truth = darkChessTreeAdapter.initialTruth();
    expect(darkChessTreeAdapter.fromUci('e1f1', truth)).toEqual({ from: 'e1', to: 'f1' });
  });
});
