import { type BanqiGameState, getBanqiLegalMoves, parseBanqiFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { type BanqiReviewStart, makeBanqiTreeAdapter } from './banqi-tree-adapter.js';

// One quiet move short of the 40-move clock: the long chariot-and-horse ending.
function atClock39(): BanqiGameState {
  const parsed = parseBanqiFen('8/7r/Hs6/2h4R b - 39 1');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

function quietMove(state: BanqiGameState) {
  const move = getBanqiLegalMoves(state).find((m) => m.from !== m.to && !state.board[m.to]);
  if (!move) throw new Error('no quiet move');
  return move;
}

describe('banqi tree adapter and the 40-move clock', () => {
  it('a study or analysis tree plays on past the clock', () => {
    const adapter = makeBanqiTreeAdapter('study', null);
    const before = atClock39();
    const after = adapter.applyMove(before, quietMove(before));
    expect(after.noProgressClock).toBe(40);
    expect(after.status.type).toBe('playing');
    // And keeps going: the next quiet move is legal too.
    expect(adapter.isLegal(after, quietMove(after))).toBe(true);
  });

  it("a finished game's review keeps the rule it was played under", () => {
    // applyMove never reads the deal; only initialTruth does.
    const start = { deal: {}, rules: {} } as unknown as BanqiReviewStart;
    const adapter = makeBanqiTreeAdapter('room', start);
    const before = atClock39();
    const after = adapter.applyMove(before, quietMove(before));
    expect(after.status).toEqual({ type: 'finished', winner: null, reason: 'no-progress' });
  });
});
