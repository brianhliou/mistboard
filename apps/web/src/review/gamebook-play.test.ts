// The gamebook guess-the-move state machine, against the real xiangqi kernel: a
// correct move advances past the learner's move + the auto opponent reply; a wrong
// (but legal) move is 'bad' then retry returns to 'play'; the line ends at the tip;
// and a play node's authored hint surfaces. Coach text lives on the node the learner
// is AT (the prompt for the move to find).

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { createGameTree, ROOT_PATH } from './game-tree.js';
import { createGamebookSession, type GamebookConfig } from './gamebook-play.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

function build() {
  const s0 = createInitialXiangqiState('fixture');
  const first = getStandardXiangqiLegalMoves(s0);
  const m1 = first[0]!;
  const altFirst = first[1]!;
  const s1 = applyStandardXiangqiMove(s0, m1);
  const m2 = getStandardXiangqiLegalMoves(s1)[0]!;
  const s2 = applyStandardXiangqiMove(s1, m2);
  const m3 = getStandardXiangqiLegalMoves(s2)[0]!;
  const tree = createGameTree(xiangqiTreeAdapter, [m1, m2, m3]);
  return { tree, m1, m2, m3, altFirst };
}

const config = (): GamebookConfig<XiangqiMove, XiangqiGameState> => ({
  moveKey: xiangqiTreeAdapter.moveKey,
  isLegal: xiangqiTreeAdapter.isLegal,
  learner: 'red',
  sideToMove: (truth) => (truth.status.type === 'playing' ? truth.status.turn : null),
  comment: (node) => node.annotations?.comments?.[0]?.text,
  hint: (node) => node.annotations?.gamebook?.hint,
  deviation: (node) => node.annotations?.gamebook?.deviation,
});

describe('gamebook session', () => {
  it('advances on a correct move, auto-plays the opponent reply, and ends at the tip', () => {
    const { tree, m1, m3 } = build();
    const session = createGamebookSession(tree, config());
    expect(session.view().feedback).toBe('play'); // red to move at the start

    expect(session.attempt(m1)).toBe('good');
    // black's reply is auto-played → red to move again at ply 2.
    expect(session.view().feedback).toBe('play');
    expect(session.node().ply).toBe(2);

    expect(session.attempt(m3)).toBe('good');
    expect(session.view().feedback).toBe('end');
  });

  it('marks a wrong (legal) move bad, then retry returns to play', () => {
    const { tree, altFirst } = build();
    const session = createGamebookSession(tree, config());
    expect(session.attempt(altFirst)).toBe('bad');
    expect(session.view().feedback).toBe('bad');
    session.retry();
    expect(session.view().feedback).toBe('play');
  });

  it('keeps the board live after a wrong move: the next attempt is the retry', () => {
    const { tree, altFirst, m1 } = build();
    const session = createGamebookSession(tree, config());
    expect(session.attempt(altFirst)).toBe('bad');
    expect(session.view().awaitingMove).toBe(true);
    expect(session.attempt(altFirst)).toBe('bad');
    expect(session.attempt(m1)).toBe('good');
    expect(session.view().feedback).not.toBe('bad');
  });

  it('surfaces the current play node hint and resets to the top', () => {
    const { tree, m1 } = build();
    tree.annotateAt(ROOT_PATH, { gamebook: { hint: 'Open the cannon.' } });
    const session = createGamebookSession(tree, config());
    expect(session.view().hint).toBe('Open the cannon.');
    session.attempt(m1);
    expect(session.node().ply).toBe(2);
    session.reset();
    expect(session.node().ply).toBe(0);
    expect(session.view().hint).toBe('Open the cannon.');
  });
});
