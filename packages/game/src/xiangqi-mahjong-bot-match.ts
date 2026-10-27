/** Reproducible, paired six-hand measurement; no production registration. */
import {
  XMJ_MATCH_HANDS,
  XMJ_TAI_TABLE,
  type XmjHandResult,
  type XmjTile,
  xmjMatchWinner,
  xmjShuffle,
} from './xiangqi-mahjong.js';
import { xmjBotAction as baseline } from './xiangqi-mahjong-bot-baseline.js';
import { xmjDefensiveAction } from './xiangqi-mahjong-defensive-bot.js';
import {
  applyXmjMove,
  createXmjRoomState,
  type XmjAction,
  type XmjPlayerView,
  type XmjSeat,
  xmjIsLegalMove,
  xmjPendingAction,
  xmjSeatName,
  xmjViewFor,
} from './xiangqi-mahjong-room.js';

export type XmjBotPolicy = (view: XmjPlayerView, seat: XmjSeat) => XmjAction | null;

function checkSeed(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Seed must be a uint32');
  }
}

/** Mulberry32, frozen here so measurement seeds stay reproducible. */
export function xmjMatchWalls(seed: number): XmjTile[][] {
  checkSeed(seed);
  let a = seed;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: XMJ_MATCH_HANDS }, () => xmjShuffle(random));
}

export interface XmjBotMatchResult {
  readonly seed: number;
  readonly tai: readonly [number, number];
  readonly winner: 0 | 1 | null;
  /** By losing seat; self-draws are not deal-ins. */
  readonly dealIns: readonly [number, number];
  readonly exhaustedWalls: number;
  readonly results: readonly XmjHandResult[];
}

export function xmjPlayBotMatch(
  seed: number,
  policies: readonly [XmjBotPolicy, XmjBotPolicy],
): XmjBotMatchResult {
  let state = createXmjRoomState(
    { walls: xmjMatchWalls(seed), firstDealer: 'east', taiTable: XMJ_TAI_TABLE },
    `xmj-bench-${seed}`,
  );
  let steps = 0;
  let at = 0;
  while (!state.match.over) {
    if (++steps > 512) throw new Error(`Seed ${seed}: match exceeded transition limit`);
    if (state.match.between) {
      const pending = xmjPendingAction(state);
      if (!pending) throw new Error(`Seed ${seed}: no next-hand runtime move`);
      const next = applyXmjMove(state, pending.move);
      if (next === state) throw new Error(`Seed ${seed}: next hand made no progress`);
      state = next;
      at = Math.max(at, pending.at);
      continue;
    }
    const phase = state.match.hand.phase;
    const index = phase.type === 'claim' ? (phase.discarder === 0 ? 1 : 0) : state.match.hand.turn;
    const seat = xmjSeatName(index);
    // Policies receive only the same redacted view as a player, never the wall
    // or the opponent's concealed hand. The kernel owns legality and scoring.
    const action = policies[index](xmjViewFor(state, seat), seat);
    // A live-room claim window without a legal claim is passed by its runtime.
    const pending = action === null ? xmjPendingAction(state) : null;
    at = Math.max(at + 2_000, pending?.at ?? 0);
    const move = action ? { ...action, by: seat, at } : pending ? { ...pending.move, at } : null;
    if (!move) throw new Error(`Seed ${seed}: no bot or runtime move`);
    if (!xmjIsLegalMove(state, move)) throw new Error(`Seed ${seed}: illegal ${seat} action`);
    const next = applyXmjMove(state, move);
    if (next === state) throw new Error(`Seed ${seed}: action made no progress`);
    state = next;
  }
  const { match } = state;
  const dealIns: [number, number] = [0, 0];
  let exhaustedWalls = 0;
  for (const result of match.results) {
    if (result.winner === null) exhaustedWalls += 1;
    else if (!result.selfDrawn) dealIns[result.winner === 0 ? 1 : 0] += 1;
  }
  return {
    seed,
    tai: match.scores,
    winner: xmjMatchWinner(match),
    dealIns,
    exhaustedWalls,
    results: match.results,
  };
}

export interface XmjBotSeedPair {
  readonly seed: number;
  readonly challengerEast: XmjBotMatchResult;
  readonly challengerWest: XmjBotMatchResult;
  readonly matchScore: number;
  readonly taiDifference: number;
}

function matchPoint(winner: 0 | 1 | null, challengerSeat: 0 | 1) {
  return winner === null ? 0.5 : winner === challengerSeat ? 1 : 0;
}

export function xmjRunBotPairs(
  firstSeed: number,
  pairs: number,
  challenger: XmjBotPolicy = xmjDefensiveAction,
  opponent: XmjBotPolicy = baseline,
  onPair?: (pair: XmjBotSeedPair) => void,
): XmjBotSeedPair[] {
  checkSeed(firstSeed);
  if (!Number.isInteger(pairs) || pairs < 1 || firstSeed + pairs - 1 > 0xffffffff) {
    throw new RangeError('Pairs must be positive and seeds must fit uint32');
  }
  const out: XmjBotSeedPair[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const seed = firstSeed + i;
    const challengerEast = xmjPlayBotMatch(seed, [challenger, opponent]);
    const challengerWest = xmjPlayBotMatch(seed, [opponent, challenger]);
    const pair: XmjBotSeedPair = {
      seed,
      challengerEast,
      challengerWest,
      matchScore: (matchPoint(challengerEast.winner, 0) + matchPoint(challengerWest.winner, 1)) / 2,
      taiDifference:
        challengerEast.tai[0] -
        challengerEast.tai[1] +
        challengerWest.tai[1] -
        challengerWest.tai[0],
    };
    out.push(pair);
    onPair?.(pair);
  }
  return out;
}

export function xmjSummarizeBotPairs(pairs: readonly XmjBotSeedPair[]) {
  if (pairs.length === 0) throw new RangeError('Cannot summarize zero seed pairs');
  let wins = 0;
  let draws = 0;
  const dealIns = { challenger: 0, baseline: 0 };
  let exhaustedWalls = 0;
  for (const pair of pairs) {
    for (const [match, seat] of [
      [pair.challengerEast, 0],
      [pair.challengerWest, 1],
    ] as const) {
      if (match.winner === null) draws += 1;
      else if (match.winner === seat) wins += 1;
      dealIns.challenger += match.dealIns[seat];
      dealIns.baseline += match.dealIns[seat === 0 ? 1 : 0];
      exhaustedWalls += match.exhaustedWalls;
    }
  }
  const matches = pairs.length * 2;
  const matchScore = pairs.reduce((sum, pair) => sum + pair.matchScore, 0) / pairs.length;
  // Distribution-free two-sided 95% Hoeffding interval on independent seed-pair
  // means in [0,1]. Seats within a pair are never treated as independent samples.
  // Unlike a normal/bootstrap interval, all wins cannot collapse it to [1,1].
  const radius = Math.sqrt(Math.log(40) / (2 * pairs.length));
  const paired95: readonly [number, number] | null =
    pairs.length < 2 ? null : [Math.max(0, matchScore - radius), Math.min(1, matchScore + radius)];
  return {
    seedPairs: pairs.length,
    matches,
    wins,
    draws,
    losses: matches - wins - draws,
    matchScore,
    taiDifference: pairs.reduce((sum, pair) => sum + pair.taiDifference, 0),
    dealIns,
    exhaustedWalls,
    paired95,
    intervalMethod: 'paired Hoeffding (two-sided 95%)',
    promote: matchScore >= 0.55 && paired95 !== null && paired95[0] > 0.5,
  };
}
