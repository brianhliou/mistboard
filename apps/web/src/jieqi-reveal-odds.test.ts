import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  getJieqiPlayerView,
  getJieqiPublicView,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  jieqiHomeSquares,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  formatRevealPercent,
  jieqiRevealOdds,
  type RevealOdds,
  revealOddsVariantFrom,
} from './jieqi-reveal-odds.js';

// The reveal odds are an in-game aid in rated play, so they must be bookkeeping
// from the viewer's own view and nothing else (CLAUDE.md "In-game aids bar").
// The counting tests pin the arithmetic; the hidden-info tests swap hidden truth
// under an identical view and require identical odds.

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

function sumProbabilities(odds: RevealOdds, ink: JieqiColor): number {
  return odds[ink].entries.reduce((sum, e) => sum + e.probability, 0);
}

function countOf(odds: RevealOdds, ink: JieqiColor, role: string): number {
  return odds[ink].entries.find((e) => e.role === role)?.count ?? 0;
}

// A face-down capture as the kernel records it: which home square was taken,
// by which side. A face-down piece never left its home square (moving reveals
// it), so the square indexes the deal.
type DarkCapture = { owner: JieqiColor; square: string };

// A seeded game that takes face-down pieces when it can, else plays at random.
// The policy reads the true state, which is fine: it only picks a move list.
function playSeeded(deal: JieqiDeal, seed: number, plies: number) {
  const rng = mulberry32(seed);
  let state = createInitialJieqiState('odds-test', deal);
  const moves: JieqiMove[] = [];
  const darkCaptures: DarkCapture[] = [];
  for (let ply = 0; ply < plies && state.status.type === 'playing'; ply += 1) {
    const legal = getJieqiLegalMoves(state);
    if (legal.length === 0) break;
    const takesDark = legal.filter((m) => state.board[m.to]?.faceDown);
    const pool = takesDark.length > 0 ? takesDark : legal;
    const move = pool[Math.floor(rng() * pool.length)];
    const target = state.board[move.to];
    if (target?.faceDown) darkCaptures.push({ owner: target.color, square: move.to });
    state = applyJieqiMove(state, move);
    moves.push(move);
  }
  return { state, moves, darkCaptures };
}

function replay(deal: JieqiDeal, moves: readonly JieqiMove[]): JieqiGameState {
  let state = createInitialJieqiState('odds-test', deal);
  for (const move of moves) {
    const next = applyJieqiMove(state, move);
    expect(next, `move ${move.from}-${move.to} replays under the other deal`).not.toBe(state);
    state = next;
  }
  return state;
}

// Swap the roles of home squares x (taken face-down) and y (still face-down) in
// one ink's deal: the same game, a different hidden truth.
function swapped(deal: JieqiDeal, ink: JieqiColor, x: string, y: string): JieqiDeal {
  const home = jieqiHomeSquares(ink) as string[];
  const roles = [...deal[ink]];
  const i = home.indexOf(x);
  const j = home.indexOf(y);
  [roles[i], roles[j]] = [roles[j], roles[i]];
  return { ...deal, [ink]: roles };
}

// For one ink: a home square the opponent took face-down, and a still face-down
// home square holding a different role, so swapping them changes the truth.
function swapPair(
  deal: JieqiDeal,
  state: JieqiGameState,
  darkCaptures: readonly DarkCapture[],
  ink: JieqiColor,
): { x: string; y: string } | null {
  const home = jieqiHomeSquares(ink) as string[];
  const roleAt = (sq: string) => deal[ink][home.indexOf(sq)];
  for (const { owner, square: x } of darkCaptures) {
    if (owner !== ink) continue;
    const y = home.find((sq) => {
      const piece = state.board[sq as keyof typeof state.board];
      return piece?.color === ink && piece.faceDown && roleAt(sq) !== roleAt(x);
    });
    if (y) return { x, y };
  }
  return null;
}

describe('jieqiRevealOdds counting', () => {
  it('starts every ink at the full set, 15 face-down, soldiers 5 in 15', () => {
    const view = getJieqiPlayerView(createInitialJieqiState('start'), 'red');
    const odds = jieqiRevealOdds(view);
    for (const ink of ['red', 'black'] as const) {
      expect(odds[ink].faceDown).toBe(15);
      expect(odds[ink].unseen).toBe(15);
      expect(odds[ink].takenUnseen).toBe(0);
      expect(countOf(odds, ink, 'soldier')).toBe(5);
      expect(countOf(odds, ink, 'chariot')).toBe(2);
      expect(odds[ink].entries.some((e) => e.role === 'general')).toBe(false);
      expect(sumProbabilities(odds, ink)).toBeCloseTo(1, 10);
    }
    expect(odds.red.entries.find((e) => e.role === 'soldier')?.probability).toBeCloseTo(5 / 15);
  });

  it('a reveal takes its role out of the pool and leaves one fewer face-down', () => {
    const deal = createJieqiDeal(mulberry32(3));
    let state = createInitialJieqiState('reveal', deal);
    const move = getJieqiLegalMoves(state).find((m) => state.board[m.from]?.faceDown);
    expect(move).toBeDefined();
    const role = state.board[(move as JieqiMove).from]?.role as string;
    state = applyJieqiMove(state, move as JieqiMove);
    const before = jieqiRevealOdds(getJieqiPlayerView(createInitialJieqiState('r', deal), 'black'));
    const odds = jieqiRevealOdds(getJieqiPlayerView(state, 'black'));
    expect(odds.red.faceDown).toBe(14);
    expect(odds.red.unseen).toBe(14);
    expect(countOf(odds, 'red', role)).toBe(countOf(before, 'red', role) - 1);
    expect(sumProbabilities(odds, 'red')).toBeCloseTo(1, 10);
    expect(odds.black.unseen).toBe(15);
  });

  it('a capture is exact for the capturer and a taken-unseen slot for the victim', () => {
    const deal = createJieqiDeal(mulberry32(11));
    const { state, darkCaptures } = playSeeded(deal, 11, 120);
    const redTaken = darkCaptures.filter((c) => c.owner === 'red').length;
    expect(redTaken).toBeGreaterThan(0);
    const asRed = jieqiRevealOdds(getJieqiPlayerView(state, 'red'));
    const asBlack = jieqiRevealOdds(getJieqiPlayerView(state, 'black'));
    // Black took them and was told what they were; red was not.
    expect(asBlack.red.takenUnseen).toBe(0);
    expect(asRed.red.takenUnseen).toBe(redTaken);
    expect(asRed.red.unseen).toBe(asRed.red.faceDown + redTaken);
    expect(asBlack.red.unseen).toBe(asBlack.red.faceDown);
    // Both are distributions over the same face-down pieces.
    for (const odds of [asRed, asBlack]) {
      for (const ink of ['red', 'black'] as const) {
        if (odds[ink].unseen > 0) expect(sumProbabilities(odds, ink)).toBeCloseTo(1, 10);
      }
    }
  });

  it('formats whole percents and reads the variant flag, defaulting to a', () => {
    expect(formatRevealPercent(1 / 3)).toBe('33%');
    expect(formatRevealPercent(0.125)).toBe('13%');
    expect(revealOddsVariantFrom('')).toBe('a');
    expect(revealOddsVariantFrom('?revealOdds=b')).toBe('b');
    expect(revealOddsVariantFrom('?x=1&revealOdds=c')).toBe('c');
    expect(revealOddsVariantFrom('?revealOdds=d')).toBe('a');
    expect(revealOddsVariantFrom('?revealOdds=A')).toBe('a');
  });
});

describe('jieqiRevealOdds hidden information', () => {
  // Find a seeded game where the opponent of `inks` took a face-down piece that
  // can be swapped with a still-hidden one of a different role.
  function findGame(inks: readonly JieqiColor[]) {
    for (let seed = 1; seed < 200; seed += 1) {
      const deal = createJieqiDeal(mulberry32(seed * 7919));
      const game = playSeeded(deal, seed, 100);
      if (game.state.status.type !== 'playing') continue;
      const pairs = inks.map((ink) => swapPair(deal, game.state, game.darkCaptures, ink));
      if (pairs.every(Boolean)) {
        return { deal, game, pairs: pairs as { x: string; y: string }[] };
      }
    }
    throw new Error('no seeded game had the captures this test needs');
  }

  it("a seat's odds are the same under two deals its view cannot tell apart", () => {
    const { deal, game, pairs } = findGame(['red']);
    const dealB = swapped(deal, 'red', pairs[0].x, pairs[0].y);
    const stateB = replay(dealB, game.moves);
    // The truth differs: the still-hidden square holds a different role.
    const y = pairs[0].y as keyof typeof stateB.board;
    expect(stateB.board[y]?.role).not.toBe(game.state.board[y]?.role);
    const viewA = getJieqiPlayerView(game.state, 'red');
    const viewB = getJieqiPlayerView(stateB, 'red');
    expect(viewB).toEqual(viewA);
    const odds = jieqiRevealOdds(viewA);
    expect(jieqiRevealOdds(viewB)).toEqual(odds);
    expect(odds.red.takenUnseen).toBeGreaterThanOrEqual(1);
    // The capturer's view does tell them apart, which is why black is exact.
    expect(getJieqiPlayerView(stateB, 'black')).not.toEqual(
      getJieqiPlayerView(game.state, 'black'),
    );
  });

  it("a spectator's odds are the same under deals swapped on both inks", () => {
    const { deal, game, pairs } = findGame(['red', 'black']);
    const dealB = swapped(
      swapped(deal, 'red', pairs[0].x, pairs[0].y),
      'black',
      pairs[1].x,
      pairs[1].y,
    );
    const stateB = replay(dealB, game.moves);
    const viewA = getJieqiPublicView(game.state);
    const viewB = getJieqiPublicView(stateB);
    expect(viewB).toEqual(viewA);
    const odds = jieqiRevealOdds(viewA);
    expect(jieqiRevealOdds(viewB)).toEqual(odds);
    expect(odds.red.takenUnseen).toBeGreaterThanOrEqual(1);
    expect(odds.black.takenUnseen).toBeGreaterThanOrEqual(1);
    // Neither seat's view survives both swaps: each capturer knows its prize.
    expect(getJieqiPlayerView(stateB, 'red')).not.toEqual(getJieqiPlayerView(game.state, 'red'));
    expect(getJieqiPlayerView(stateB, 'black')).not.toEqual(
      getJieqiPlayerView(game.state, 'black'),
    );
  });
});
