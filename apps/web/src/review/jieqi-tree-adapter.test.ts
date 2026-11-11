import {
  createInitialJieqiState,
  jieqiHomeSquares,
  jieqiStateToDealtFen,
  jieqiTruthView,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { makeJieqiTreeAdapter, recoverJieqiDeal } from './jieqi-tree-adapter.js';

// An imported game's truth view marks the pieces its source never dealt as
// `unknown` (apps/server/src/engine-match-import.ts). The review must keep them
// unknown: in its own Reveal view and in the analyse-from-here hand-off.
describe('recoverJieqiDeal with never-revealed pieces', () => {
  const served = jieqiTruthView(
    createInitialJieqiState('jq_imported', {
      ...STANDARD_JIEQI_DEAL,
      undetermined: { red: ['a1', 'e4'], black: ['i10'] },
    }),
  );

  it('rebuilds a whole deal and lists the unknown squares as undetermined', () => {
    expect(served.board.a1).toEqual({ color: 'red', faceDown: true, unknown: true });
    const deal = recoverJieqiDeal(served, () => 0);
    expect(deal.undetermined).toEqual({ red: ['a1', 'e4'], black: ['i10'] });
    expect(deal.red).toHaveLength(15);
    expect(deal.black).toHaveLength(15);
    // Known squares keep the served role.
    expect(deal.red[deal.red.length - 1]).toBe(STANDARD_JIEQI_DEAL.red.at(-1));
  });

  it('keeps them unknown in the Reveal view and hands them to analysis as ?', () => {
    const deal = recoverJieqiDeal(served);
    const adapter = makeJieqiTreeAdapter('jq_imported', deal, { revealAll: () => true });
    const truth = adapter.initialTruth();
    const revealed = adapter.project(truth)[0]!.view;
    expect(revealed.board.a1).toEqual({ color: 'red', faceDown: true, unknown: true });
    expect(revealed.board.i10).toEqual({ color: 'black', faceDown: true, unknown: true });
    expect(revealed.board.i1).toEqual({ color: 'red', role: 'chariot', faceDown: false });
    const hidden = jieqiStateToDealtFen(truth).split(' ')[5]!;
    expect([...hidden].filter((ch) => ch === '?')).toHaveLength(3);
  });

  it('still refuses a truth board with a plain face-down piece', () => {
    const masked = { ...served, board: { ...served.board, c1: { color: 'red', faceDown: true } } };
    expect(() => recoverJieqiDeal(masked as typeof served)).toThrow(/not revealed/);
  });
});

// The review's captured pool is the same on every ply. It used to come from the
// side-to-move's masked view, so a face-down capture flipped between a disc (the
// victim to move) and a role (the capturer to move), and on a finished game's
// public deal that role was a random placeholder drawn for the undetermined square.
describe('review captured pool', () => {
  // Red's face-down cannon b3 jumps the face-down b8 and takes b10 (face-down);
  // black replies, so the capturer is to move on the second ply.
  const capture = { from: 'b3', to: 'b10' } as const;
  const reply = { from: 'a7', to: 'a6' } as const;
  const capturedAt = (deal: Parameters<typeof makeJieqiTreeAdapter>[1], revealAll = false) => {
    const adapter = makeJieqiTreeAdapter('jq_pool', deal, { revealAll: () => revealAll });
    const afterCapture = adapter.applyMove(adapter.initialTruth(), capture);
    const afterReply = adapter.applyMove(afterCapture, reply);
    return [afterCapture, afterReply].map((truth) => adapter.project(truth)[0]!.view.captured);
  };
  const publicDeal = { ...STANDARD_JIEQI_DEAL, undetermined: { red: [], black: ['b10' as const] } };

  it("keeps a finished game's dark capture a disc on every ply, never its placeholder", () => {
    const [atCapture, nextPly] = capturedAt(publicDeal);
    expect(atCapture).toEqual([{ owner: 'black', role: null }]);
    expect(nextPly).toEqual([{ owner: 'black', role: null }]);
    // The Reveal toggle does not invent it either.
    expect(capturedAt(publicDeal, true)).toEqual([atCapture, nextPly]);
  });

  it('does not flip a known dark capture with the side to move', () => {
    const [atCapture, nextPly] = capturedAt(STANDARD_JIEQI_DEAL);
    expect(nextPly).toEqual(atCapture);
    expect(atCapture).toEqual([{ owner: 'black', role: null }]);
  });

  it('names a determined dark capture from its capture ply once revealed', () => {
    const role = STANDARD_JIEQI_DEAL.black[jieqiHomeSquares('black').indexOf('b10')]!;
    const [atCapture, nextPly] = capturedAt(STANDARD_JIEQI_DEAL, true);
    // Marked as taken face-down, so the row draws it shaded.
    expect(atCapture).toEqual([{ owner: 'black', role, takenFaceDown: true }]);
    expect(nextPly).toEqual([{ owner: 'black', role, takenFaceDown: true }]);
  });

  it('names a face-up capture plainly, Reveal on or off', () => {
    // Red's a4 piece steps to a5 and black's a7 piece to a6, both revealing;
    // then red's now face-up a5 piece takes the face-up one on a6.
    let revealed = false;
    const adapter = makeJieqiTreeAdapter('jq_pool_up', STANDARD_JIEQI_DEAL, {
      revealAll: () => revealed,
    });
    let truth = adapter.initialTruth();
    for (const move of [
      { from: 'a4', to: 'a5' },
      { from: 'a7', to: 'a6' },
      { from: 'a5', to: 'a6' },
    ] as const) {
      truth = adapter.applyMove(truth, move);
    }
    expect(truth.captures).toEqual([
      expect.objectContaining({ owner: 'black', revealedAtCapture: true }),
    ]);
    const masked = adapter.project(truth)[0]!.view.captured;
    revealed = true;
    const shown = adapter.project(truth)[0]!.view.captured;
    expect(masked).toEqual(shown);
    expect(masked[0]?.takenFaceDown).toBeUndefined();
    expect(masked[0]?.role).not.toBeNull();
  });
});
