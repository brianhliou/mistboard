import {
  type BanqiGameState,
  getBanqiLegalMoves,
  LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT,
  parseBanqiFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { type BanqiReviewStart, makeBanqiTreeAdapter } from './banqi-tree-adapter.js';

// The long chariot-and-horse ending with `clock` quiet plies already played.
function atClock(clock: number): BanqiGameState {
  const parsed = parseBanqiFen(`8/7r/Hs6/2h4R b - ${clock} 1`);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

function quietMove(state: BanqiGameState) {
  const move = getBanqiLegalMoves(state).find((m) => m.from !== m.to && !state.board[m.to]);
  if (!move) throw new Error('no quiet move');
  return move;
}

describe('banqi tree adapter and the no-progress clock', () => {
  it('a study or analysis tree plays on past the clock', () => {
    const adapter = makeBanqiTreeAdapter('study', null);
    const before = atClock(59);
    const after = adapter.applyMove(before, quietMove(before));
    expect(after.noProgressClock).toBe(60);
    expect(after.status.type).toBe('playing');
    // And keeps going: the next quiet move is legal too.
    expect(adapter.isLegal(after, quietMove(after))).toBe(true);
  });

  it("a finished game's review keeps the rule it was played under", () => {
    // applyMove never reads the deal; only initialTruth does.
    const start = { deal: {}, rules: {} } as unknown as BanqiReviewStart;
    const adapter = makeBanqiTreeAdapter('room', start);
    const drawn = { type: 'finished', winner: null, reason: 'no-progress' };
    // A game created since 2026-10-17 draws at 60, not at 40.
    const at39 = atClock(39);
    expect(adapter.applyMove(at39, quietMove(at39)).status.type).toBe('playing');
    const at59 = atClock(59);
    expect(adapter.applyMove(at59, quietMove(at59)).status).toEqual(drawn);
    // An older game's truth carries its 40-ply limit (stamped by initialTruth).
    const old = { ...atClock(39), noProgressLimit: LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT };
    expect(adapter.applyMove(old, quietMove(old)).status).toEqual(drawn);
  });
});
