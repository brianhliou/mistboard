/** Offline stage-2 challenger. Never import canonical hidden state into search. */
import {
  type XmjHandState,
  type XmjTile,
  xmjClaim,
  xmjClaimsOpen,
  xmjDeal,
  xmjDiscard,
  xmjHandOver,
  xmjPass,
  xmjSelfDraw,
  xmjShuffle,
  xmjSortTiles,
} from './xiangqi-mahjong.js';
import { xmjBotAction as baseline, xmjUnseen } from './xiangqi-mahjong-bot-baseline.js';
import type { XmjBotPolicy } from './xiangqi-mahjong-bot-match.js';
import { xmjDefensiveAction } from './xiangqi-mahjong-defensive-bot.js';
import {
  type XmjAction,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  xmjSeatIndex,
  xmjSeatName,
  xmjViewFor,
} from './xiangqi-mahjong-room.js';

export const XMJ_SEARCH_SAMPLES = 64;
const DEFAULT_SEED = 0x6762026;
const POLICIES = [baseline, xmjDefensiveAction] as const;

function randomFor(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Search seed must be a uint32');
  }
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(value: unknown): number {
  let h = 2166136261;
  for (const c of JSON.stringify(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Uniform physical-copy prior; the opponent's actual hand is never read. */
export function xmjSampleHand(view: XmjPlayerView, seat: XmjSeat, seed: number): XmjHandState {
  const own = view.hands[seat];
  if (!own || (view.phase.type !== 'discard' && view.phase.type !== 'claim')) {
    throw new RangeError('Sampling requires an active seat with its own tiles');
  }
  const opponent = seat === 'east' ? 'west' : 'east';
  const pool = [...xmjUnseen(view, seat)].flatMap(([tile, count]) =>
    Array<XmjTile>(count).fill(tile),
  );
  if (
    pool.length !== view.wallCount + view.handCounts[opponent] ||
    own.length !== view.handCounts[seat]
  ) {
    throw new RangeError('Inconsistent visible tiles, concealed counts or unseen pool');
  }
  const shuffled = xmjShuffle(randomFor(seed), pool);
  const hidden = xmjSortTiles(shuffled.slice(0, view.handCounts[opponent]));
  const hands = seat === 'east' ? ([own, hidden] as const) : ([hidden, own] as const);
  // A claimed discard leaves its pond. Tile conservation recovers draw counts
  // from both exposed meld counts, preserving earthly/heavenly kernel scoring.
  const draws = (s: XmjSeat, other: XmjSeat) =>
    view.handCounts[s] +
    view.discards[s].length +
    view.melds[other].length +
    2 * view.melds[s].length -
    (s === view.dealer ? 5 : 4);
  return {
    dealer: xmjSeatIndex(view.dealer),
    turn: xmjSeatIndex(view.turn),
    hands,
    wall: shuffled.slice(view.handCounts[opponent]),
    melds: [view.melds.east, view.melds.west],
    discards: [view.discards.east, view.discards.west],
    drawnDiscards: [view.drawnDiscards.east, view.drawnDiscards.west],
    draws: [draws('east', 'west'), draws('west', 'east')],
    claimed: view.melds.east.length + view.melds.west.length > 0,
    phase:
      view.phase.type === 'claim'
        ? { ...view.phase, discarder: xmjSeatIndex(view.phase.discarder) }
        : view.phase,
  };
}

function transition(hand: XmjHandState, action: XmjAction | null): XmjHandState {
  let next = hand;
  if (action === null) {
    // Live rooms pass a window with no legal claim through their runtime.
    if (hand.phase.type === 'claim' && xmjClaimsOpen(hand).length === 0) next = xmjPass(hand);
  } else {
    switch (action.action) {
      case 'discard':
        next = xmjDiscard(hand, action.tile, action.handCopy);
        break;
      case 'claim':
        next = xmjClaim(hand, action);
        break;
      case 'pass':
        next = xmjPass(hand);
        break;
      case 'self-draw':
        next = xmjSelfDraw(hand);
        break;
    }
  }
  if (next === hand) throw new Error(`Illegal rollout action: ${action?.action ?? 'null'}`);
  return next;
}

/** Rollout policies get the real room projector, never a hand-state argument. */
export function xmjRolloutHand(initial: XmjHandState, policy: XmjBotPolicy): XmjHandState {
  let hand = initial;
  let steps = 0;
  while (!xmjHandOver(hand)) {
    if (++steps > 128) throw new Error('XMJ rollout exceeded transition limit');
    const index = hand.phase.type === 'claim' ? (hand.phase.discarder === 0 ? 1 : 0) : hand.turn;
    const seat = xmjSeatName(index);
    // The frozen policies are hand-local and score-independent. This wrapper
    // supplies exactly the same legal actions and redaction as a live room.
    const room: XmjRoomState = {
      id: 'xmj-rollout',
      status: { type: 'playing', turn: xmjSeatName(hand.turn) },
      moveNumber: steps,
      ready: [],
      nextHandAt: null,
      match: {
        hand,
        walls: [[]],
        handIndex: 0,
        scores: [0, 0],
        results: [],
        between: false,
        over: false,
      },
    };
    hand = transition(hand, policy(xmjViewFor(room, seat), seat));
  }
  return hand;
}

function margin(hand: XmjHandState): number {
  return hand.phase.type === 'won'
    ? (hand.phase.winner === 0 ? 1 : -1) * hand.phase.score.total
    : 0;
}

function matchPoint(gap: number): number {
  return gap > 0 ? 1 : gap < 0 ? 0 : 0.5;
}

/** Match outcome includes comeback risk; bounded tai breaks finite-sample ties. */
export function xmjScoreRaceValue(finalGap: number): number {
  return matchPoint(finalGap) + (0.001 * finalGap) / (1 + Math.abs(finalGap));
}

// Future hands are independent of the current action. Both frozen rollout
// policies ignore the score, so their per-hand margins can be shared exactly
// across candidates and decisions. This fixed common bank is a Monte Carlo
// estimate of future comeback chances, not privileged future match walls.
const futureCache = new Map<string, readonly number[]>();
function futureMargins(
  handNumber: number,
  dealer: 0 | 1,
  samples: number,
  seed: number,
  policyIndex: number,
) {
  const key = `${handNumber}:${dealer}:${samples}:${seed}:${policyIndex}`;
  const cached = futureCache.get(key);
  if (cached) return cached;
  const margins = Array.from({ length: samples }, (_, sample) => {
    const wall = xmjShuffle(randomFor(hash(['future', seed, handNumber, dealer, sample])));
    return margin(xmjRolloutHand(xmjDeal(wall, dealer), POLICIES[policyIndex]));
  });
  if (futureCache.size >= 64) futureCache.delete(futureCache.keys().next().value as string);
  futureCache.set(key, margins);
  return margins;
}

export interface XmjSearchOptions {
  readonly samples?: number;
  readonly seed?: number;
}

export interface XmjActionValue {
  readonly action: XmjAction;
  readonly value: number;
  readonly matchScore: number;
  readonly taiDifference: number;
}

export interface XmjSearchDecision {
  readonly action: XmjAction | null;
  readonly samples: number;
  readonly values: readonly XmjActionValue[];
}

export function xmjSampledDecision(
  view: XmjPlayerView,
  seat: XmjSeat,
  options: XmjSearchOptions = {},
): XmjSearchDecision {
  const samples = options.samples ?? XMJ_SEARCH_SAMPLES;
  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(samples) || samples < 1)
    throw new RangeError('Samples must be a positive integer');
  randomFor(seed);
  const forced = (action: XmjAction | null): XmjSearchDecision => ({
    action,
    samples: 0,
    values: [],
  });
  if (view.legal.nextHand) return forced({ action: 'next-hand' });
  if (view.legal.selfDraw) return forced({ action: 'self-draw' });
  const win = view.legal.claims.find((claim) => claim.kind === 'win');
  if (win) return forced({ action: 'claim', ...win });
  const actions: XmjAction[] = view.legal.pass
    ? [
        { action: 'pass' },
        ...view.legal.claims.map((claim): XmjAction => ({ action: 'claim', ...claim })),
      ]
    : view.legal.discard.map((tile) => ({ action: 'discard', tile }));
  if (actions.length === 0) return forced(null);
  if (actions.length === 1 && actions[0].action === 'pass') return forced(actions[0]);
  const opponent = seat === 'east' ? 'west' : 'east';
  const sign = seat === 'east' ? 1 : -1;
  const currentGap = view.scores[seat] - view.scores[opponent];
  // Hash only information known to this seat. Identity, timing, hidden hand and
  // canonical walls cannot influence the common samples or tie ordering.
  const decisionSeed = hash([
    seed,
    seat,
    view.handNumber,
    view.handsInMatch,
    view.scores,
    view.dealer,
    view.turn,
    view.wallCount,
    view.hands[seat],
    view.handCounts,
    view.melds,
    view.discards,
    view.drawnDiscards,
    view.phase,
  ]);
  const totals = actions.map((action) => ({ action, value: 0, matchScore: 0, taiDifference: 0 }));
  const continuations = POLICIES.map((_, policyIndex) => {
    const gaps = Array<number>(samples).fill(0);
    let dealer = xmjSeatIndex(view.dealer);
    for (let number = view.handNumber + 1; number <= view.handsInMatch; number += 1) {
      dealer = dealer === 0 ? 1 : 0;
      const future = futureMargins(number, dealer, samples, seed, policyIndex);
      for (let sample = 0; sample < samples; sample += 1) gaps[sample] += future[sample] * sign;
    }
    return gaps;
  });
  for (let sample = 0; sample < samples; sample += 1) {
    const hand = xmjSampleHand(view, seat, hash([decisionSeed, sample]));
    for (let policyIndex = 0; policyIndex < POLICIES.length; policyIndex += 1) {
      for (const total of totals) {
        const end = xmjRolloutHand(transition(hand, total.action), POLICIES[policyIndex]);
        const finalGap = currentGap + margin(end) * sign + continuations[policyIndex][sample];
        total.value += xmjScoreRaceValue(finalGap);
        total.matchScore += matchPoint(finalGap);
        total.taiDifference += finalGap;
      }
    }
  }
  const values = totals.map((total) => ({
    action: total.action,
    value: total.value / (samples * POLICIES.length),
    matchScore: total.matchScore / (samples * POLICIES.length),
    taiDifference: total.taiDifference / (samples * POLICIES.length),
  }));
  const best = values.reduce((a, b) => (b.value > a.value ? b : a));
  return { action: best.action, samples, values };
}

export function xmjSampledAction(
  view: XmjPlayerView,
  seat: XmjSeat,
  options: XmjSearchOptions = {},
): XmjAction | null {
  return xmjSampledDecision(view, seat, options).action;
}
