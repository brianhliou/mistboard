// The jieqi platform article embeds a real site game (jq_96f40ebb). Its data
// ships in the page bundle, so it is held to the finished-game rule: a piece
// captured face-down is known only to its capturer, and a piece that never
// moved is known to nobody (CLAUDE.md, hidden information in the data). The
// deal must be the game's public deal, which is a fixed point of
// jieqiPublicDeal; the real deal named five such pieces.

import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiMove,
  type JieqiSquare,
  jieqiMovedOrigins,
  jieqiPublicDeal,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { JIEQI_PLATFORM_GAME } from './jieqi-platform-game.js';

const moves: JieqiMove[] = JIEQI_PLATFORM_GAME.moves
  .trim()
  .split(/\s+/)
  .map((token) => {
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
    if (!match) throw new Error(`bad move token ${token}`);
    return { from: match[1] as JieqiSquare, to: match[2] as JieqiSquare };
  });

describe('jieqi platform article game', () => {
  it('carries only the public deal: nothing about a piece that never moved', () => {
    expect(JIEQI_PLATFORM_GAME.deal).toEqual(jieqiPublicDeal(JIEQI_PLATFORM_GAME.deal, moves));
    const moved = jieqiMovedOrigins(moves);
    const undetermined = [
      ...(JIEQI_PLATFORM_GAME.deal.undetermined?.red ?? []),
      ...(JIEQI_PLATFORM_GAME.deal.undetermined?.black ?? []),
    ];
    expect(undetermined.length).toBeGreaterThan(0);
    for (const square of undetermined) expect(moved.has(square)).toBe(false);
  });

  it('still replays to the result the article states', () => {
    let state = createInitialJieqiState('jieqi-platform-test', JIEQI_PLATFORM_GAME.deal);
    for (const move of moves) {
      state = applyJieqiMove(state, move, { noCaptureClockLimit: Number.POSITIVE_INFINITY });
    }
    expect(moves).toHaveLength(146);
    expect(state.status).toEqual({ type: 'finished', winner: 'black', reason: 'checkmate' });
  });
});
