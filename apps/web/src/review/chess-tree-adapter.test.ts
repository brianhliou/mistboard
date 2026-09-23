import { describe, expect, it } from 'vitest';
import { chessTreeAdapter } from './chess-tree-adapter.js';
import { deserializeTree, type SerializedNode, type SerializedTree } from './tree-serialize.js';

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

// The open-chess sibling of the #451 regression: the standard kernel lists both
// castling spellings as legal, so a chapter in either replays past the castle.
describe('chessTreeAdapter castling spellings', () => {
  const line = (short: string, long: string) => [
    'e2e4',
    'd7d6',
    'g1f3',
    'c8e6',
    'f1c4',
    'b8c6',
    short,
    'd8d7',
    'b1c3',
    long,
    'd2d3',
  ];

  for (const [short, long] of [
    ['e1g1', 'e8c8'],
    ['e1h1', 'e8a8'],
  ] as const) {
    it(`replays ${short} / ${long} past both castles`, () => {
      const tree = deserializeTree(chessTreeAdapter, linearTree(line(short, long)));
      const tip = tree.nodeAt(tree.mainlinePath())!;
      expect(tip.ply).toBe(11);
      expect(tip.truth.board.g1).toEqual({ color: 'white', role: 'king' });
      expect(tip.truth.board.f1).toEqual({ color: 'white', role: 'rook' });
      expect(tip.truth.board.c8).toEqual({ color: 'black', role: 'king' });
      expect(tip.truth.board.d8).toEqual({ color: 'black', role: 'rook' });
    });
  }
});
