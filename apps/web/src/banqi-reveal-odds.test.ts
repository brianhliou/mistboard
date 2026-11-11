import {
  applyBanqiMove,
  applyThreeKingdomsBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  banqiSquareFromIndex,
  createBanqiDeal,
  createInitialBanqiState,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getBanqiLegalMoves,
  getBanqiPlayerView,
  getThreeKingdomsBanqiLegalMoves,
  getThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  banqiBoardAsPlayed,
  banqiFaceDownAtEnd,
  banqiRevealChance,
  banqiRevealOdds,
} from './banqi-reveal-odds.js';

// The banqi reveal odds are an in-game aid in rated play (#542), so they must be
// bookkeeping from the viewer's own view and nothing else (CLAUDE.md "In-game
// aids bar"). The counting tests pin the arithmetic; the hidden-information
// tests swap hidden truth under an identical view and require identical odds.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plays `plies` random legal moves; returns the state and the move log.
function play(deal: BanqiDeal, plies: number, seed: number) {
  const rng = mulberry32(seed);
  let state: BanqiGameState = createInitialBanqiState('odds', deal);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < plies && state.status.type === 'playing'; i += 1) {
    const legal = getBanqiLegalMoves(state);
    const move = legal[Math.floor(rng() * legal.length)];
    if (!move) break;
    state = applyBanqiMove(state, move);
    moves.push(move);
  }
  return { state, moves };
}

function replay(deal: BanqiDeal, moves: readonly BanqiMove[]): BanqiGameState {
  let state: BanqiGameState = createInitialBanqiState('odds', deal);
  for (const move of moves) state = applyBanqiMove(state, move);
  return state;
}

describe('banqiRevealOdds counting', () => {
  it('starts with all 32 face-down: a red soldier is 5 in 32', () => {
    const view = getBanqiPlayerView(
      createInitialBanqiState('odds', createBanqiDeal(mulberry32(1))),
      'red',
    );
    const odds = banqiRevealOdds(view);
    expect(odds.total).toBe(32);
    expect(banqiRevealChance(odds, 'red', 'soldier')).toBeCloseTo(5 / 32);
    expect(banqiRevealChance(odds, 'black', 'general')).toBeCloseTo(1 / 32);
  });

  it('draws both inks from one pool: every chance together sums to 1', () => {
    const { state } = play(createBanqiDeal(mulberry32(2)), 30, 2);
    const odds = banqiRevealOdds(getBanqiPlayerView(state, 'red'));
    const faceDown = Object.values(getBanqiPlayerView(state, 'red').board).filter(
      (e) => e?.faceDown,
    ).length;
    expect(odds.total).toBe(faceDown);
    let sum = 0;
    for (const ink of ['red', 'black'] as const) {
      for (const entry of odds.pool[ink].entries) sum += banqiRevealChance(odds, ink, entry.role);
    }
    expect(sum).toBeCloseTo(1);
  });
});

describe('banqiRevealOdds hidden information', () => {
  it('is the same under two deals the view cannot tell apart', () => {
    const deal = createBanqiDeal(mulberry32(3));
    const { state, moves } = play(deal, 24, 3);
    const flipped = new Set(moves.filter((m) => m.from === m.to).map((m) => m.from));
    // Two still-face-down squares holding different pieces: swap them.
    const hidden = deal
      .map((piece, index) => ({ piece, square: banqiSquareFromIndex(index), index }))
      .filter(({ square }) => !flipped.has(square));
    const a = hidden[0]!;
    const b = hidden.find((h) => h.piece.color !== a.piece.color || h.piece.role !== a.piece.role)!;
    const swapped = [...deal];
    swapped[a.index] = b.piece;
    swapped[b.index] = a.piece;
    const other = replay(swapped, moves);
    // The truth differs; every seat's view, and so the odds, do not.
    expect(other.board[a.square]).not.toEqual(state.board[a.square]);
    for (const seat of ['red', 'black'] as const) {
      const view = getBanqiPlayerView(state, seat);
      const otherView = getBanqiPlayerView(other, seat);
      expect(otherView.board).toEqual(view.board);
      expect(banqiRevealOdds(otherView)).toEqual(banqiRevealOdds(view));
      // The view the odds read carries no face-down identity.
      for (const entry of Object.values(view.board)) {
        if (entry?.faceDown) expect(entry).toEqual({ faceDown: true });
      }
    }
  });
});

describe('banqiFaceDownAtEnd (#544)', () => {
  it('recovers from the truth view and the move log the tiles still face-down at the end', () => {
    const { state, moves } = play(createBanqiDeal(mulberry32(4)), 20, 4);
    const asPlayed = getBanqiPlayerView(state, 'red');
    // What a finished room serves: every tile face up.
    const truth = {
      ...asPlayed,
      board: Object.fromEntries(
        Object.entries(state.board).map(([sq, p]) => [
          sq,
          { color: p.color, role: p.role, faceDown: false as const },
        ]),
      ),
    };
    expect(banqiRevealOdds(truth).total).toBe(0);
    const atEnd = banqiFaceDownAtEnd(truth, moves);
    expect(atEnd?.board).toEqual(asPlayed.board);
    expect(banqiRevealOdds(atEnd!).total).toBe(banqiRevealOdds(asPlayed).total);
  });

  it('keeps a piece face up on the square it moved to after its flip', () => {
    // Long games, so flipped pieces walk and capture before the end. Banqi's
    // full 4x8 deal means a piece can only step onto a square already turned,
    // so this held before the TK fix too; it guards the shared function.
    for (const seed of [6, 7, 8, 9]) {
      const { state, moves } = play(createBanqiDeal(mulberry32(seed)), 160, seed);
      expect(moves.some((m) => m.from !== m.to)).toBe(true);
      const asPlayed = getBanqiPlayerView(state, 'red');
      const truth = {
        ...asPlayed,
        board: Object.fromEntries(
          Object.entries(state.board).map(([sq, p]) => [
            sq,
            { color: p.color, role: p.role, faceDown: false as const },
          ]),
        ),
      };
      // From the truth view and from the already-masked view alike, the board
      // is exactly the one play left, so a face-up piece is never drawn down.
      expect(banqiFaceDownAtEnd(truth, moves)?.board).toEqual(asPlayed.board);
      expect(banqiFaceDownAtEnd(asPlayed, moves)?.board).toEqual(asPlayed.board);
    }
  });

  it('gives up rather than guess when the log is short of the game', () => {
    const { state, moves } = play(createBanqiDeal(mulberry32(5)), 10, 5);
    const view = getBanqiPlayerView(state, 'red');
    expect(banqiFaceDownAtEnd(view, moves.slice(1))).toBeNull();
  });
});

describe('banqiBoardAsPlayed on a finished Three Kingdoms room', () => {
  it('draws the served final board as played, moved face-up pieces included', () => {
    // Played to the end: the served final view is the masked one (the server
    // keeps never-turned tiles covered), and the last frame must show it
    // unchanged. Before the fix every piece that moved after its flip turned
    // back into a green disc on the final ply only.
    for (const seed of [11, 12, 13]) {
      const rng = mulberry32(seed);
      let state = createThreeKingdomsBanqiStateFromSetup('tk', createThreeKingdomsBanqiSetup(rng));
      const moves: ThreeKingdomsBanqiMove[] = [];
      while (state.status.type === 'playing' && moves.length < 600) {
        const legal = getThreeKingdomsBanqiLegalMoves(state);
        const move = legal[Math.floor(rng() * legal.length)];
        if (!move) break;
        state = applyThreeKingdomsBanqiMove(state, move);
        moves.push(move);
      }
      expect(state.status.type).toBe('finished');
      const served = getThreeKingdomsBanqiPlayerView(state, 'red');
      const faceUp = Object.values(served.board).filter((e) => e && !e.faceDown).length;
      expect(faceUp).toBeGreaterThan(0);
      const drawn = banqiBoardAsPlayed<ThreeKingdomsBanqiSquare, typeof served>(served, moves);
      expect(drawn.board).toEqual(served.board);
    }
  });
});
