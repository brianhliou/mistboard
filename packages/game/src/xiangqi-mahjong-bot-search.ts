/**
 * Ported from misty-xiangqi-mahjong@966641c (src/xiangqi-mahjong-bot-search.ts).
 *
 * A searching xiangqi mahjong bot.
 *
 * Same contract as the heuristic bot (`xmjBotAction`): it reads only a player
 * view, so the opponent's concealed tiles and the wall order never reach it.
 * What it cannot see it samples: the unseen tiles are dealt into the
 * opponent's hand and the wall (a determinization), with hands that explain
 * the opponent's discards kept more often, each candidate action is played out to the end of the hand on the same sampled deals with the
 * heuristic bot moving for both seats, and the action with the best average
 * result wins. The result is scored as the chance of winning the match from
 * the score it leaves, so the bot plays for tai when level and for safety or
 * for size when the last hands call for it.
 *
 * Deterministic: the sampler is seeded from the visible position, so the same
 * view always gets the same answer.
 *
 * Table 3: whether to declare 聽牌 with the chosen discard is the heuristic
 * bot's public-outs rule (`xmjBotDeclares`); the playouts do not model the
 * lock. A declared seat's own win counts its +1, and a locked hand leaves its
 * non-winning draws to the room's automatic discard.
 */

import {
  tilePiece,
  XMJ_COPIES,
  XMJ_TILE_KINDS,
  type XmjClaim,
  type XmjTile,
} from './xiangqi-mahjong.js';
import { xmjBotAction, xmjBotDiscardAction, xmjBotIsLocked } from './xiangqi-mahjong-bot.js';
import type { XmjAction, XmjPlayerView, XmjSeat } from './xiangqi-mahjong-room.js';

const KINDS = 14;
const COPIES = Int8Array.from(XMJ_TILE_KINDS.map((kind) => XMJ_COPIES[tilePiece(kind)]));
const INDEX = new Map<XmjTile, number>(XMJ_TILE_KINDS.map((kind, i) => [kind, i]));
const RED_GENERAL = 0;
const BLACK_GENERAL = 7;

function idx(tile: XmjTile): number {
  return INDEX.get(tile) as number;
}

/** The six sets: two sequences per colour, and each colour's three soldiers. */
const SETS: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 6, 6],
  [7, 8, 9],
  [10, 11, 12],
  [13, 13, 13],
];
const PAIRS: readonly (readonly number[])[] = [
  ...Array.from({ length: KINDS }, (_, i) => [i, i]),
  [RED_GENERAL, BLACK_GENERAL],
];

/** A target hand as flat (tile, copies) pairs, dropping any the tile set cannot make. */
function target(tiles: readonly number[]): number[] | null {
  const need = new Map<number, number>();
  for (const tile of tiles) need.set(tile, (need.get(tile) ?? 0) + 1);
  const flat: number[] = [];
  for (const [tile, n] of need) {
    if (n > (COPIES[tile] as number)) return null;
    flat.push(tile, n);
  }
  return flat;
}

const TARGETS_FULL: readonly (readonly number[])[] = SETS.flatMap((set) =>
  PAIRS.map((pair) => target([...set, ...pair])),
).filter((t): t is number[] => t !== null);
const TARGETS_PAIR: readonly (readonly number[])[] = PAIRS.map((pair) => target(pair)).filter(
  (t): t is number[] => t !== null,
);

// ------------------------------------------------------------ fast heuristic

let distShort = 0;
let distOuts = 0;

/** The heuristic bot's distance, on tile counts; answers in distShort / distOuts. */
function distance(hand: Int8Array, hasMeld: boolean, unseen: Int8Array) {
  const targets = hasMeld ? TARGETS_PAIR : TARGETS_FULL;
  let short = 99;
  let outs = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i] as readonly number[];
    let missing = 0;
    let live = 0;
    let possible = true;
    for (let j = 0; j < t.length; j += 2) {
      const tile = t[j] as number;
      const lack = (t[j + 1] as number) - (hand[tile] as number);
      if (lack <= 0) continue;
      const free = unseen[tile] as number;
      if (lack > free) {
        possible = false;
        break;
      }
      missing += lack;
      live += free;
    }
    if (!possible || missing > short) continue;
    if (missing < short) {
      short = missing;
      outs = live;
    } else {
      outs += live;
    }
  }
  distShort = short;
  distOuts = outs;
}

/** The heuristic bot's discard: first tile, in kind order, that leaves the hand closest. */
function heuristicDiscard(hand: Int8Array, hasMeld: boolean, unseen: Int8Array): number {
  let best = -1;
  let bestShort = 0;
  let bestOuts = 0;
  for (let tile = 0; tile < KINDS; tile += 1) {
    if (hand[tile] === 0) continue;
    hand[tile] -= 1;
    distance(hand, hasMeld, unseen);
    hand[tile] += 1;
    if (best < 0 || distShort < bestShort || (distShort === bestShort && distOuts > bestOuts)) {
      best = tile;
      bestShort = distShort;
      bestOuts = distOuts;
    }
  }
  return best;
}

function isPair(hand: Int8Array): boolean {
  if (hand[RED_GENERAL] === 1 && hand[BLACK_GENERAL] === 1) return true;
  for (let tile = 0; tile < KINDS; tile += 1) if (hand[tile] === 2) return true;
  return false;
}

/** A winning hand: with a set exposed the two concealed tiles pair; else a set plus a pair. */
function isWin(hand: Int8Array, hasMeld: boolean): boolean {
  if (hasMeld) return isPair(hand);
  for (const set of SETS) {
    const [a, b, c] = set as [number, number, number];
    if (a === b) {
      if ((hand[a] as number) < 3) continue;
      hand[a] -= 3;
      const ok = isPair(hand);
      hand[a] += 3;
      if (ok) return true;
    } else {
      if (hand[a] === 0 || hand[b] === 0 || hand[c] === 0) continue;
      hand[a] -= 1;
      hand[b] -= 1;
      hand[c] -= 1;
      const ok = isPair(hand);
      hand[a] += 1;
      hand[b] += 1;
      hand[c] += 1;
      if (ok) return true;
    }
  }
  return false;
}

/** The current tai table (table 2) for a winning five, outside the flat first-draw hands. */
function scoreWin(
  hand: Int8Array,
  meld: Int8Array | null,
  selfDrawn: boolean,
  lastTile: boolean,
): number {
  let tai = 1 + (selfDrawn ? 2 : 0) + (lastTile ? 1 : 0);
  let red = 0;
  let black = 0;
  const all = SCORE_SCRATCH;
  for (let tile = 0; tile < KINDS; tile += 1) {
    const n = (hand[tile] as number) + (meld ? (meld[tile] as number) : 0);
    all[tile] = n;
    if (tile < 7) red += n;
    else black += n;
  }
  if (red === 0 || black === 0) tai += 1;
  const redGeneral = (all[RED_GENERAL] as number) > 0;
  const blackGeneral = (all[BLACK_GENERAL] as number) > 0;
  // Both generals in a winning hand can only be its pair.
  if (redGeneral && blackGeneral) tai += 2;
  else if (redGeneral || blackGeneral) tai += 1;
  for (let piece = 1; piece <= 5; piece += 1) {
    if ((all[piece] as number) + (all[piece + 7] as number) >= 3) tai += 2;
  }
  if ((all[6] as number) + (all[13] as number) === 5) {
    tai += all[6] === 5 || all[13] === 5 ? 5 : 2;
  }
  return tai;
}
const SCORE_SCRATCH = new Int8Array(KINDS);
const FLAT_FIRST_DRAW = 6;

// ------------------------------------------------------------ one hand, fast

interface Sim {
  readonly hand: [Int8Array, Int8Array];
  readonly meld: [Int8Array | null, Int8Array | null];
  /** Every face-up tile: both discard piles and both exposed sets. */
  readonly pub: Int8Array;
  wall: Int8Array;
  wallAt: number;
  dealer: number;
  claimed: boolean;
  /** Discards each seat has made this hand. */
  readonly made: [number, number];
}

const UNSEEN = new Int8Array(KINDS);
function fillUnseen(sim: Sim, seat: number) {
  const hand = sim.hand[seat] as Int8Array;
  for (let tile = 0; tile < KINDS; tile += 1) {
    const n = (COPIES[tile] as number) - (sim.pub[tile] as number) - (hand[tile] as number);
    UNSEEN[tile] = n > 0 ? n : 0;
  }
}

/** The two hand tiles that would join `tile` in a claimed set, or -1 in claimA. */
let claimA = -1;
let claimB = -1;
function findMeldClaim(hand: Int8Array, tile: number) {
  claimA = -1;
  const piece = tile % 7;
  if (piece === 6) {
    if ((hand[tile] as number) >= 2) {
      claimA = tile;
      claimB = tile;
    }
    return;
  }
  const base = tile - piece + (piece < 3 ? 0 : 3);
  let a = -1;
  let b = -1;
  for (let other = base; other < base + 3; other += 1) {
    if (other === tile) continue;
    if (hand[other] === 0) return;
    if (a < 0) a = other;
    else b = other;
  }
  claimA = a;
  claimB = b;
}

/** The heuristic bot's claim rule: take the set only when it brings the hand strictly closer. */
function heuristicClaims(sim: Sim, seat: number): boolean {
  const hand = sim.hand[seat] as Int8Array;
  fillUnseen(sim, seat);
  distance(hand, false, UNSEEN);
  const now = distShort;
  hand[claimA] -= 1;
  hand[claimB] -= 1;
  const discard = heuristicDiscard(hand, true, UNSEEN);
  hand[discard] -= 1;
  distance(hand, true, UNSEEN);
  hand[discard] += 1;
  hand[claimA] += 1;
  hand[claimB] += 1;
  return distShort < now;
}

function applyMeldClaim(sim: Sim, seat: number, tile: number, a: number, b: number) {
  const hand = sim.hand[seat] as Int8Array;
  hand[a] -= 1;
  hand[b] -= 1;
  sim.pub[a] += 1;
  sim.pub[b] += 1;
  const meld = new Int8Array(KINDS);
  meld[a] += 1;
  meld[b] += 1;
  meld[tile] += 1;
  sim.meld[seat] = meld;
  sim.claimed = true;
}

const PHASE_DISCARD = 0;
const PHASE_CLAIM = 1;

/**
 * Play a hand out with the heuristic bot in both seats. Returns the tai swing
 * for seat `me`: what it wins, minus what the other seat wins, 0 on an
 * exhausted wall.
 *
 * In PHASE_DISCARD `seat` holds a full hand and must discard; in PHASE_CLAIM
 * `seat` has just discarded `tile` (already face up) and the other seat answers.
 */
function playOut(
  sim: Sim,
  me: number,
  phase: number,
  seat: number,
  mayWin: boolean,
  tile: number,
  drew: boolean,
): number {
  for (;;) {
    if (phase === PHASE_DISCARD) {
      const hand = sim.hand[seat] as Int8Array;
      const hasMeld = sim.meld[seat] !== null;
      if (mayWin && isWin(hand, hasMeld)) {
        const untouched = !sim.claimed && sim.made[0] + sim.made[1] === 0;
        const heavenly = seat === sim.dealer && !drew && untouched;
        const earthly = seat !== sim.dealer && !sim.claimed && sim.made[seat] === 0;
        const tai =
          heavenly || earthly
            ? FLAT_FIRST_DRAW
            : scoreWin(
                hand,
                sim.meld[seat] as Int8Array | null,
                true,
                drew && sim.wallAt >= sim.wall.length,
              );
        return seat === me ? tai : -tai;
      }
      fillUnseen(sim, seat);
      tile = heuristicDiscard(hand, hasMeld, UNSEEN);
      hand[tile] -= 1;
      sim.pub[tile] += 1;
      sim.made[seat] += 1;
      phase = PHASE_CLAIM;
      continue;
    }
    const other = 1 - seat;
    const hand = sim.hand[other] as Int8Array;
    const meld = sim.meld[other] as Int8Array | null;
    hand[tile] += 1;
    if (isWin(hand, meld !== null)) {
      const tai = scoreWin(hand, meld, false, false);
      return other === me ? tai : -tai;
    }
    hand[tile] -= 1;
    seat = other;
    phase = PHASE_DISCARD;
    if (meld === null) {
      findMeldClaim(hand, tile);
      if (claimA >= 0) {
        const a = claimA;
        const b = claimB;
        if (heuristicClaims(sim, seat)) {
          applyMeldClaim(sim, seat, tile, a, b);
          mayWin = false;
          drew = false;
          continue;
        }
      }
    }
    if (sim.wallAt >= sim.wall.length) return 0;
    hand[sim.wall[sim.wallAt] as number] += 1;
    sim.wallAt += 1;
    mayWin = true;
    drew = true;
  }
}

function cloneSim(sim: Sim): Sim {
  return {
    hand: [sim.hand[0].slice(), sim.hand[1].slice()],
    meld: [sim.meld[0], sim.meld[1]],
    pub: sim.pub.slice(),
    wall: sim.wall,
    wallAt: sim.wallAt,
    dealer: sim.dealer,
    claimed: sim.claimed,
    made: [sim.made[0], sim.made[1]],
  };
}

/**
 * One whole hand from a 32-tile wall with the heuristic bot in both seats: the
 * tai swing for the dealer. Exported so a test can hold the fast rules and the
 * fast heuristic to the real ones.
 */
export function xmjFastHeuristicHand(wall: readonly XmjTile[], dealer: 0 | 1): number {
  const tiles = Int8Array.from(wall.map(idx));
  const hand: [Int8Array, Int8Array] = [new Int8Array(KINDS), new Int8Array(KINDS)];
  for (let i = 0; i < 5; i += 1) (hand[dealer] as Int8Array)[tiles[i] as number] += 1;
  for (let i = 5; i < 9; i += 1) (hand[1 - dealer] as Int8Array)[tiles[i] as number] += 1;
  const sim: Sim = {
    hand,
    meld: [null, null],
    pub: new Int8Array(KINDS),
    wall: tiles,
    wallAt: 9,
    dealer,
    claimed: false,
    made: [0, 0],
  };
  return playOut(sim, dealer, PHASE_DISCARD, dealer, true, -1, false);
}

// ------------------------------------------------------------ match value

/**
 * How one hand between two heuristic bots moves the score, from the dealer's
 * side: tai swing and its frequency over 120,000 self-play hands
 * (`scripts/hand-delta-dist.ts`).
 */
const DEALER_SWING: readonly (readonly [number, number])[] = [
  [-9, 0.0003],
  [-7, 0.00047],
  [-6, 0.00705],
  [-5, 0.08719],
  [-4, 0.09804],
  [-3, 0.13736],
  [-2, 0.08106],
  [-1, 0.05842],
  [0, 0.00388],
  [1, 0.06341],
  [2, 0.08771],
  [3, 0.15418],
  [4, 0.11198],
  [5, 0.10081],
  [6, 0.00732],
  [7, 0.00044],
  [9, 0.00036],
];
const SWING_TOTAL = DEALER_SWING.reduce((sum, [, p]) => sum + p, 0);

const MAX_LEAD = 80;
const valueCache = new Map<number, Float64Array>();

/** Chance of winning the match (a tie counts half) by lead, with `hands` left to play. */
function matchValues(hands: number, dealsNext: boolean): Float64Array {
  const key = hands * 2 + (dealsNext ? 1 : 0);
  const cached = valueCache.get(key);
  if (cached) return cached;
  const out = new Float64Array(2 * MAX_LEAD + 1);
  if (hands === 0) {
    for (let lead = -MAX_LEAD; lead <= MAX_LEAD; lead += 1) {
      out[lead + MAX_LEAD] = lead > 0 ? 1 : lead === 0 ? 0.5 : 0;
    }
  } else {
    const next = matchValues(hands - 1, !dealsNext);
    for (let lead = -MAX_LEAD; lead <= MAX_LEAD; lead += 1) {
      let value = 0;
      for (const [swing, p] of DEALER_SWING) {
        const after = Math.max(-MAX_LEAD, Math.min(MAX_LEAD, lead + (dealsNext ? swing : -swing)));
        value += p * (next[after + MAX_LEAD] as number);
      }
      out[lead + MAX_LEAD] = value / SWING_TOTAL;
    }
  }
  valueCache.set(key, out);
  return out;
}

// ------------------------------------------------------------ the search

export interface XmjSearchOptions {
  /** Sampled deals per decision. */
  readonly samples?: number;
  /**
   * Read the opponent's hand from its discards: sampled hands are weighted by
   * how well they explain what the opponent threw and what it kept. Off, every
   * unseen tile is equally likely to be in its hand.
   */
  readonly inference?: boolean;
  /** How likely the opponent is to make a discard the heuristic bot would not. */
  readonly slip?: number;
  /** Hands drawn per sampled deal before weighting keeps the likely ones. */
  readonly oversample?: number;
  /** 'match' plays for the chance of winning the match, 'tai' for points in the hand. */
  readonly goal?: 'match' | 'tai';
}

interface Settings {
  readonly samples: number;
  readonly inference: boolean;
  readonly slip: number;
  readonly oversample: number;
  readonly goal: 'match' | 'tai';
}

const DEFAULT_SAMPLES = 160;
/** Tai still counts when the match value cannot tell two results apart. */
const TAI_TIEBREAK = 0.002;

function hashView(view: XmjPlayerView, seat: XmjSeat): number {
  const text = JSON.stringify([
    seat,
    view.handNumber,
    view.scores,
    view.dealer,
    view.wallCount,
    view.hands[seat],
    view.melds,
    view.discards,
    view.phase.type,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Root {
  readonly me: number;
  readonly sim: Sim;
  /** Unseen tiles, one entry per copy: the opponent's hand and the wall, in some order. */
  readonly pool: Int8Array;
  readonly opponentTiles: number;
  readonly values: Float64Array;
  readonly lead: number;
  readonly settings: Settings;
  /** The opponent's discard pile in order, and whether each was the tile just drawn. */
  readonly theirPile: Int8Array;
  readonly theirDrawn: readonly boolean[];
  /** Face-up tiles as they stood before each of the opponent's discards. */
  readonly pubBefore: readonly Int8Array[];
  readonly theyDeal: boolean;
}

function buildRoot(view: XmjPlayerView, seat: XmjSeat, settings: Settings): Root | null {
  const mine = view.hands[seat];
  if (!mine) return null;
  const me = seat === 'east' ? 0 : 1;
  const opponent: XmjSeat = seat === 'east' ? 'west' : 'east';
  const hand: [Int8Array, Int8Array] = [new Int8Array(KINDS), new Int8Array(KINDS)];
  for (const tile of mine) (hand[me] as Int8Array)[idx(tile)] += 1;
  const pub = new Int8Array(KINDS);
  const meld: [Int8Array | null, Int8Array | null] = [null, null];
  for (const side of ['east', 'west'] as const) {
    for (const tile of view.discards[side]) pub[idx(tile)] += 1;
    for (const set of view.melds[side]) {
      const counts = new Int8Array(KINDS);
      for (const tile of set.tiles) {
        counts[idx(tile)] += 1;
        pub[idx(tile)] += 1;
      }
      meld[side === 'east' ? 0 : 1] = counts;
    }
  }
  const pool: number[] = [];
  for (let tile = 0; tile < KINDS; tile += 1) {
    const left =
      (COPIES[tile] as number) - (pub[tile] as number) - ((hand[me] as Int8Array)[tile] as number);
    for (let i = 0; i < left; i += 1) pool.push(tile);
  }
  const opponentTiles = view.handCounts[opponent];
  // The view must account for every tile, or the sampled deals would be wrong.
  if (pool.length !== opponentTiles + view.wallCount) return null;
  const left = view.handsInMatch - view.handNumber;
  const dealerIndex = view.dealer === 'east' ? 0 : 1;
  const theirPile = Int8Array.from(view.discards[opponent].map(idx));
  const myPile = view.discards[seat].map(idx);
  const theyDeal = dealerIndex !== me;
  // The piles alternate from the dealer's first discard. A claimed discard has
  // left its pile, so after a claim this timeline is approximate.
  const base = new Int8Array(KINDS);
  for (const side of ['east', 'west'] as const) {
    for (const set of view.melds[side]) for (const tile of set.tiles) base[idx(tile)] += 1;
  }
  const pubBefore: Int8Array[] = [];
  for (let t = 0; t < theirPile.length; t += 1) {
    const before = base.slice();
    for (let i = 0; i < t; i += 1) before[theirPile[i] as number] += 1;
    const mineBefore = Math.min(myPile.length, theyDeal ? t : t + 1);
    for (let i = 0; i < mineBefore; i += 1) before[myPile[i] as number] += 1;
    pubBefore.push(before);
  }
  return {
    settings,
    theirPile,
    theirDrawn: view.drawnDiscards[opponent],
    pubBefore,
    theyDeal,
    me,
    sim: {
      hand,
      meld,
      pub,
      wall: new Int8Array(0),
      wallAt: 0,
      dealer: dealerIndex,
      claimed: view.melds.east.length + view.melds.west.length > 0,
      made: [view.discards.east.length, view.discards.west.length],
    },
    pool: Int8Array.from(pool),
    opponentTiles,
    // The deal alternates every hand, so the next dealer is the seat not dealing now.
    values: matchValues(left, dealerIndex !== me),
    lead: view.scores[seat] - view.scores[opponent],
  };
}

function utility(root: Root, swing: number): number {
  if (root.settings.goal === 'tai') return swing;
  const lead = Math.max(-MAX_LEAD, Math.min(MAX_LEAD, root.lead + swing));
  return (root.values[lead + MAX_LEAD] as number) + TAI_TIEBREAK * swing;
}

function shuffle(tiles: Int8Array, random: () => number) {
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = tiles[i] as number;
    tiles[i] = tiles[j] as number;
    tiles[j] = a;
  }
}

const WEIGH_HAND = new Int8Array(KINDS);
const WEIGH_UNSEEN = new Int8Array(KINDS);

/**
 * How well a guessed opponent hand explains the opponent's discards, most
 * recent first. Each discard is replayed backwards: the hand it was thrown
 * from is rebuilt, and the guess keeps its weight when the heuristic bot would
 * have thrown the same tile from it, or is cut by `slip` when it would not.
 * Whether a discard was the tile just drawn is public, and says whether the
 * hand changed on that turn; when it did, which kept tile was the new one is
 * itself guessed.
 *
 * Only public facts and the guess go in: the piles, the drawn marks, the
 * exposed sets.
 */
function weighGuess(root: Root, pool: Int8Array, random: () => number): number {
  const hand = WEIGH_HAND;
  hand.fill(0);
  for (let i = 0; i < root.opponentTiles; i += 1) hand[pool[i] as number] += 1;
  const slip = root.settings.slip;
  const hasMeld = root.sim.meld[1 - root.me] !== null;
  let weight = 1;
  for (let t = root.theirPile.length - 1; t >= 0; t -= 1) {
    const thrown = root.theirPile[t] as number;
    const pub = root.pubBefore[t] as Int8Array;
    hand[thrown] += 1;
    for (let tile = 0; tile < KINDS; tile += 1) {
      const n = (COPIES[tile] as number) - (pub[tile] as number) - (hand[tile] as number);
      WEIGH_UNSEEN[tile] = n > 0 ? n : 0;
    }
    if (heuristicDiscard(hand, hasMeld, WEIGH_UNSEEN) !== thrown) weight *= slip;
    const drawnBack = root.theirDrawn[t] === true;
    if (hasMeld) {
      // Before a kept draw the one concealed tile was the thrown one: nothing
      // more to learn about the guess, and the claim itself may be next.
      hand[thrown] -= 1;
      if (!drawnBack) break;
      continue;
    }
    if (root.theyDeal && t === 0) break;
    if (drawnBack) {
      hand[thrown] -= 1;
      continue;
    }
    // The drawn tile was kept: it is one of the tiles still held, of another face.
    let choices = 0;
    for (let tile = 0; tile < KINDS; tile += 1)
      if (tile !== thrown) choices += hand[tile] as number;
    if (choices === 0) {
      hand[thrown] -= 1;
      weight *= slip;
      continue;
    }
    weight *= choices / 4;
    let pick = Math.floor(random() * choices);
    for (let tile = 0; tile < KINDS; tile += 1) {
      if (tile === thrown) continue;
      pick -= hand[tile] as number;
      if (pick < 0) {
        hand[tile] -= 1;
        break;
      }
    }
  }
  return weight;
}

/**
 * The sampled deals for one decision: the unseen tiles dealt into the
 * opponent's hand and then the wall in draw order. With inference on, more
 * hands are drawn than needed and the deals are resampled by weight.
 */
function sampleDeals(root: Root, random: () => number): Int8Array[] {
  const { samples, inference, oversample } = root.settings;
  const informative = inference && root.theirPile.length > 0 && root.opponentTiles > 0;
  if (!informative) {
    return Array.from({ length: samples }, () => {
      const pool = root.pool.slice();
      shuffle(pool, random);
      return pool;
    });
  }
  const drawn = samples * oversample;
  const pools: Int8Array[] = [];
  const weights = new Float64Array(drawn);
  let total = 0;
  for (let i = 0; i < drawn; i += 1) {
    const pool = root.pool.slice();
    shuffle(pool, random);
    pools.push(pool);
    const weight = weighGuess(root, pool, random);
    weights[i] = weight;
    total += weight;
  }
  // Systematic resampling: one random offset, evenly spaced picks.
  const out: Int8Array[] = [];
  const step = total / samples;
  let at = random() * step;
  let seen = 0;
  let i = 0;
  let last = -1;
  for (let k = 0; k < samples; k += 1) {
    while (i < drawn - 1 && seen + (weights[i] as number) < at) {
      seen += weights[i] as number;
      i += 1;
    }
    // A hand picked again keeps its tiles and gets a fresh wall: the weight
    // judged only the hand, and the wall behind it is any order of the rest.
    const pool = pools[i] as Int8Array;
    if (i === last) {
      const again = pool.slice();
      for (let x = again.length - 1; x > root.opponentTiles; x -= 1) {
        const y = root.opponentTiles + Math.floor(random() * (x - root.opponentTiles + 1));
        const tile = again[x] as number;
        again[x] = again[y] as number;
        again[y] = tile;
      }
      out.push(again);
    } else {
      out.push(pool);
    }
    last = i;
    at += step;
  }
  return out;
}

function dealFrom(root: Root, pool: Int8Array): Sim {
  const sim = cloneSim(root.sim);
  const opponent = sim.hand[1 - root.me] as Int8Array;
  opponent.fill(0);
  for (let i = 0; i < root.opponentTiles; i += 1) opponent[pool[i] as number] += 1;
  sim.wall = pool;
  sim.wallAt = root.opponentTiles;
  return sim;
}

/** Average utility of each discard in `options` over the sampled deals. */
function rateDiscards(root: Root, options: readonly number[], random: () => number): number[] {
  const totals = options.map(() => 0);
  const samples = root.settings.samples;
  for (const pool of sampleDeals(root, random)) {
    const deal = dealFrom(root, pool);
    for (let i = 0; i < options.length; i += 1) {
      const tile = options[i] as number;
      const sim = cloneSim(deal);
      (sim.hand[root.me] as Int8Array)[tile] -= 1;
      sim.pub[tile] += 1;
      sim.made[root.me] += 1;
      totals[i] += utility(root, playOut(sim, root.me, PHASE_CLAIM, root.me, false, tile, false));
    }
  }
  return totals.map((total) => total / samples);
}

function bestIndex(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) > (values[best] as number)) best = i;
  }
  return best;
}

function searchDiscard(view: XmjPlayerView, seat: XmjSeat, root: Root): XmjAction | null {
  const options = view.legal.discard.map(idx);
  const random = mulberry32(hashView(view, seat));
  if (view.legal.selfDraw) {
    const hand = root.sim.hand[root.me] as Int8Array;
    const untouched = !root.sim.claimed && root.sim.made[0] + root.sim.made[1] === 0;
    const drew = view.phase.type === 'discard' && view.phase.drawn !== null;
    const heavenly = root.me === root.sim.dealer && !drew && untouched;
    const earthly =
      root.me !== root.sim.dealer && !root.sim.claimed && root.sim.made[root.me] === 0;
    const tai =
      heavenly || earthly
        ? FLAT_FIRST_DRAW
        : scoreWin(
            hand,
            root.sim.meld[root.me] as Int8Array | null,
            true,
            drew && view.wallCount === 0,
          ) + declaredBonus(view, seat);
    // A win that still loses the match is the one win worth weighing against playing on.
    const last = view.handNumber >= view.handsInMatch;
    if (!last || root.lead + tai > 0 || options.length === 0) return { action: 'self-draw' };
    const rated = rateDiscards(root, options, random);
    const best = bestIndex(rated);
    if (utility(root, tai) >= (rated[best] as number)) return { action: 'self-draw' };
    return { action: 'discard', tile: XMJ_TILE_KINDS[options[best] as number] as XmjTile };
  }
  // A locked hand throws its draw by the room's automatic discard.
  if (options.length === 0 || xmjBotIsLocked(view, seat)) return null;
  if (options.length === 1) {
    return xmjBotDiscardAction(view, seat, XMJ_TILE_KINDS[options[0] as number] as XmjTile);
  }
  const rated = rateDiscards(root, options, random);
  return xmjBotDiscardAction(
    view,
    seat,
    XMJ_TILE_KINDS[options[bestIndex(rated)] as number] as XmjTile,
  );
}

/** Table 3's 聽牌 line, for a win by a seat that has declared. */
function declaredBonus(view: XmjPlayerView, seat: XmjSeat): number {
  return xmjBotIsLocked(view, seat) ? 1 : 0;
}

function searchClaim(view: XmjPlayerView, seat: XmjSeat, root: Root): XmjAction {
  const samples = root.settings.samples;
  if (view.phase.type !== 'claim') return { action: 'pass' };
  const me = root.me;
  const tile = idx(view.phase.discard);
  const random = mulberry32(hashView(view, seat));
  const claims = view.legal.claims;
  const win = claims.find((claim) => claim.kind === 'win');
  const sets = claims.filter((claim) => claim.kind !== 'win');

  // Each set claim is followed by a discard; rate every (claim, discard) pair.
  const plans: { claim: XmjClaim; a: number; b: number; discard: number }[] = [];
  for (const claim of sets) {
    const [a, b] = claim.fromHand.map(idx) as [number, number];
    const rest = (root.sim.hand[me] as Int8Array).slice();
    rest[a] -= 1;
    rest[b] -= 1;
    for (let t = 0; t < KINDS; t += 1) {
      if ((rest[t] as number) > 0) plans.push({ claim, a, b, discard: t });
    }
  }
  let passTotal = 0;
  const planTotals = plans.map(() => 0);
  for (const pool of sampleDeals(root, random)) {
    const deal = dealFrom(root, pool);
    {
      const sim = cloneSim(deal);
      let swing = 0;
      if (sim.wallAt < sim.wall.length) {
        (sim.hand[me] as Int8Array)[sim.wall[sim.wallAt] as number] += 1;
        sim.wallAt += 1;
        swing = playOut(sim, me, PHASE_DISCARD, me, true, -1, true);
      }
      passTotal += utility(root, swing);
    }
    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i] as (typeof plans)[number];
      const sim = cloneSim(deal);
      applyMeldClaim(sim, me, tile, plan.a, plan.b);
      (sim.hand[me] as Int8Array)[plan.discard] -= 1;
      sim.pub[plan.discard] += 1;
      sim.made[me] += 1;
      planTotals[i] += utility(root, playOut(sim, me, PHASE_CLAIM, me, false, plan.discard, false));
    }
  }
  let bestValue = passTotal / samples;
  let best: XmjAction = { action: 'pass' };
  for (let i = 0; i < plans.length; i += 1) {
    const value = (planTotals[i] as number) / samples;
    if (value > bestValue) {
      bestValue = value;
      const claim = (plans[i] as (typeof plans)[number]).claim;
      best = { action: 'claim', kind: claim.kind, fromHand: claim.fromHand };
    }
  }
  if (win) {
    const hand = (root.sim.hand[me] as Int8Array).slice();
    hand[tile] += 1;
    const tai =
      scoreWin(hand, root.sim.meld[me] as Int8Array | null, false, false) +
      declaredBonus(view, seat);
    if (utility(root, tai) >= bestValue) {
      return { action: 'claim', kind: win.kind, fromHand: win.fromHand };
    }
  }
  return best;
}

/** A search bot with its own settings. */
export function createXmjSearchBot(options: XmjSearchOptions = {}) {
  const settings: Settings = {
    samples: options.samples ?? DEFAULT_SAMPLES,
    inference: options.inference ?? true,
    slip: options.slip ?? 0.1,
    oversample: options.oversample ?? 16,
    goal: options.goal ?? 'match',
  };
  return (view: XmjPlayerView, seat: XmjSeat): XmjAction | null => {
    const legal = view.legal;
    if (legal.nextHand) return { action: 'next-hand' };
    const root = buildRoot(view, seat, settings);
    // A view this bot cannot account for tile by tile is played by the heuristic.
    if (!root) return xmjBotAction(view, seat);
    if (legal.pass) return searchClaim(view, seat, root);
    if (legal.selfDraw || legal.discard.length > 0) return searchDiscard(view, seat, root);
    return null;
  };
}

/** The action this seat's search bot takes from its view, or null if it has none. */
export const xmjSearchBotAction = createXmjSearchBot();

/**
 * The share of sampled deals in which the opponent wins on this seat's discard
 * of `tile`. For measuring how well the sampler reads the opponent's hand; the
 * bot itself does not call it.
 */
export function xmjSearchDealInChance(
  view: XmjPlayerView,
  seat: XmjSeat,
  tile: XmjTile,
  options: XmjSearchOptions = {},
): number | null {
  const settings: Settings = {
    samples: options.samples ?? DEFAULT_SAMPLES,
    inference: options.inference ?? true,
    slip: options.slip ?? 0.1,
    oversample: options.oversample ?? 16,
    goal: options.goal ?? 'match',
  };
  const root = buildRoot(view, seat, settings);
  if (!root) return null;
  const hasMeld = root.sim.meld[1 - root.me] !== null;
  const thrown = idx(tile);
  let wins = 0;
  for (const pool of sampleDeals(root, mulberry32(hashView(view, seat)))) {
    const hand = dealFrom(root, pool).hand[1 - root.me] as Int8Array;
    hand[thrown] += 1;
    if (isWin(hand, hasMeld)) wins += 1;
  }
  return wins / settings.samples;
}
