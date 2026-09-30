import {
  createInitialJieqiState,
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
