import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjMove,
  type XmjRoomState,
  xmjBotAction,
  xmjPendingAction,
  xmjViewFor,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { type XmjLogMove, xmjHandLog } from './xiangqi-mahjong-log.js';

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** A bot move for whoever has one, else the runtime's deadline move. */
function nextMove(state: XmjRoomState): XmjMove {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return { ...action, by: seat, at: 0 };
  }
  const pending = xmjPendingAction(state);
  if (pending) return pending.move;
  throw new Error('nobody can act');
}

/** A whole bot match: its moves, and for each discard whether that seat had just drawn. */
function playMatch(seed: number) {
  let state = createXmjRoomState(createXmjSetup(seeded(seed)), 'xmj_log');
  const moves: XmjLogMove[] = [];
  const drewBeforeDiscard: boolean[] = [];
  while (state.status.type === 'playing' && moves.length < 5000) {
    const move = nextMove(state);
    const phase = state.match.between ? null : state.match.hand.phase;
    if (move.action === 'discard') {
      drewBeforeDiscard.push(phase?.type === 'discard' && phase.drawn !== null);
    }
    const after = applyXmjMove(state, move);
    if (after === state) throw new Error(`illegal move ${JSON.stringify(move)}`);
    state = after;
    moves.push({ move, ply: moves.length + 1 });
  }
  return { state, moves, drewBeforeDiscard };
}

describe('xiangqi mahjong hand log', () => {
  for (const seed of [3, 7, 11, 19]) {
    it(`groups a bot match into its hands, one result row each (seed ${seed})`, () => {
      const { state, moves, drewBeforeDiscard } = playMatch(seed);
      const view = xmjViewFor(state, 'east');
      const log = xmjHandLog(moves);
      expect(log.map((hand) => hand.hand)).toEqual(view.results.map((_, index) => index + 1));
      log.forEach((hand, index) => {
        const result = view.results[index];
        const last = hand.rows.at(-1);
        expect(hand.ended).toBe(true);
        if (result?.winner === null) {
          expect(last?.kind).toBe('exhausted');
        } else if (result?.selfDrawn) {
          expect(last).toMatchObject({ kind: 'self-draw', seat: result.winner });
        } else {
          expect(last).toMatchObject({ kind: 'win', seat: result?.winner });
        }
        // Only the last row ends the hand.
        for (const row of hand.rows.slice(0, -1)) {
          expect(['discard', 'claim']).toContain(row.kind);
        }
      });
      // Every discard is shown once, in order, flagged with whether its seat drew.
      const discards = log.flatMap((hand) => hand.rows.filter((row) => row.kind === 'discard'));
      const played = moves.filter((entry) => entry.move.action === 'discard');
      expect(discards.map((row) => row.ply)).toEqual(played.map((entry) => entry.ply));
      expect(discards.map((row) => row.kind === 'discard' && row.drew)).toEqual(drewBeforeDiscard);
      // Passes and the steps between hands are folded away.
      const shownPlies = new Set(log.flatMap((hand) => hand.rows.map((row) => row.ply)));
      for (const entry of moves) {
        if (entry.move.action === 'next-hand') expect(shownPlies.has(entry.ply)).toBe(false);
      }
    });
  }

  it('names the claimed tile on a claim and a win on a discard', () => {
    const moves: XmjLogMove[] = (
      [
        { by: 'east', at: 0, action: 'discard', tile: 'rR' },
        { by: 'west', at: 0, action: 'claim', kind: 'pung', fromHand: ['rR', 'rR'] },
        { by: 'west', at: 0, action: 'discard', tile: 'bP' },
        { by: 'east', at: 0, action: 'pass' },
        { by: 'east', at: 0, action: 'discard', tile: 'bC' },
        { by: 'west', at: 0, action: 'claim', kind: 'win', fromHand: [] },
      ] satisfies XmjMove[]
    ).map((move, index) => ({ move, ply: index + 1 }));
    const [hand] = xmjHandLog(moves);
    expect(hand?.rows).toEqual([
      { kind: 'discard', seat: 'east', tile: 'rR', drew: false, ply: 1 },
      { kind: 'claim', seat: 'west', claim: 'pung', tile: 'rR', ply: 2 },
      { kind: 'discard', seat: 'west', tile: 'bP', drew: false, ply: 3 },
      { kind: 'discard', seat: 'east', tile: 'bC', drew: true, ply: 5 },
      { kind: 'win', seat: 'west', tile: 'bC', ply: 6 },
    ]);
    expect(hand?.ended).toBe(true);
  });

  it('keeps a hand in play open, and starts the next hand when both seats are ready', () => {
    const moves: XmjLogMove[] = (
      [
        { by: 'east', at: 0, action: 'discard', tile: 'rR' },
        { by: 'west', at: 0, action: 'pass' },
        { by: 'west', at: 0, action: 'self-draw' },
        { by: 'east', at: 0, action: 'next-hand' },
        { by: 'west', at: 0, action: 'next-hand' },
        { by: 'west', at: 0, action: 'discard', tile: 'bP' },
      ] satisfies XmjMove[]
    ).map((move, index) => ({ move, ply: index + 1 }));
    const log = xmjHandLog(moves);
    expect(log.map((hand) => [hand.hand, hand.ended, hand.firstPly, hand.lastPly])).toEqual([
      [1, true, 1, 3],
      [2, false, 6, 6],
    ]);
    expect(log[0]?.rows.at(-1)).toEqual({ kind: 'self-draw', seat: 'west', ply: 3 });
  });
});
