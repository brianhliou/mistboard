/**
 * A simple xiangqi mahjong bot.
 *
 * It reads only a player view, so it cannot see the opponent's tiles or the
 * wall by construction. The plan is a distance count: with five tiles to a
 * winning hand (one set plus a pair), how many tiles is this hand short of the
 * nearest winning hand whose missing tiles are still unseen? It always wins
 * when it can, claims a set only when that brings it strictly closer, and
 * discards the tile whose loss leaves it closest, preferring more live outs.
 *
 * On table 3 it declares 聽牌 when that same discard leaves a ready hand with
 * enough live winning tiles (`xmjBotDeclares`), and a declared hand leaves
 * its non-winning draws to the room's automatic discard, as a person's does.
 */

import {
  isXmjPair,
  meldKindOf,
  tilePiece,
  XMJ_COPIES,
  XMJ_TILE_KINDS,
  type XmjClaim,
  type XmjMeld,
  type XmjTile,
  xmjWinShape,
} from './xiangqi-mahjong.js';
import type { XmjAction, XmjPlayerView, XmjSeat } from './xiangqi-mahjong-room.js';

type Counts = Map<XmjTile, number>;

function countOf(tiles: readonly XmjTile[]): Counts {
  const counts: Counts = new Map();
  for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  return counts;
}

function allTriples(): XmjTile[][] {
  const out: XmjTile[][] = [];
  const kinds = XMJ_TILE_KINDS;
  for (let i = 0; i < kinds.length; i += 1) {
    for (let j = i; j < kinds.length; j += 1) {
      for (let k = j; k < kinds.length; k += 1) {
        const set = [kinds[i], kinds[j], kinds[k]] as XmjTile[];
        if (meldKindOf(set)) out.push(set);
      }
    }
  }
  return out;
}

function allPairs(): XmjTile[][] {
  const out: XmjTile[][] = [];
  const kinds = XMJ_TILE_KINDS;
  for (let i = 0; i < kinds.length; i += 1) {
    for (let j = i; j < kinds.length; j += 1) {
      const a = kinds[i] as XmjTile;
      const b = kinds[j] as XmjTile;
      if (isXmjPair(a, b)) out.push([a, b]);
    }
  }
  return out;
}

const TRIPLES = allTriples();
const PAIRS = allPairs();

export interface XmjDistance {
  /** Tiles short of a winning hand; Infinity when no target is still live. */
  readonly short: number;
  /** Unseen copies of the tiles the nearest targets need (more is better). */
  readonly outs: number;
}

/**
 * How far concealed tiles plus any exposed set are from a winning hand, given
 * how many of each tile are still unseen.
 */
export function xmjDistance(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
  unseen: ReadonlyMap<XmjTile, number>,
): XmjDistance {
  const have = countOf(concealed);
  const targets: XmjTile[][] =
    melds.length > 0 ? PAIRS : TRIPLES.flatMap((set) => PAIRS.map((pair) => [...set, ...pair]));
  let short = Number.POSITIVE_INFINITY;
  let outs = 0;
  for (const target of targets) {
    const need = countOf(target);
    let missing = 0;
    let live = 0;
    let possible = true;
    for (const [tile, n] of need) {
      if (n > XMJ_COPIES[tilePiece(tile)]) {
        possible = false;
        break;
      }
      const lack = Math.max(0, n - (have.get(tile) ?? 0));
      if (lack > (unseen.get(tile) ?? 0)) {
        possible = false;
        break;
      }
      missing += lack;
      if (lack > 0) live += unseen.get(tile) ?? 0;
    }
    if (!possible) continue;
    if (missing < short) {
      short = missing;
      outs = live;
    } else if (missing === short) {
      outs += live;
    }
  }
  return { short, outs };
}

/** Copies of each tile this seat has not seen anywhere. */
export function xmjUnseen(view: XmjPlayerView, seat: XmjSeat): Map<XmjTile, number> {
  const seen: XmjTile[] = [...(view.hands[seat] ?? [])];
  for (const side of ['east', 'west'] as const) {
    seen.push(...view.discards[side]);
    for (const meld of view.melds[side]) seen.push(...meld.tiles);
  }
  // An open discard is already the last tile of its discarder's pile.
  const seenCounts = countOf(seen);
  const unseen = new Map<XmjTile, number>();
  for (const kind of XMJ_TILE_KINDS) {
    unseen.set(kind, Math.max(0, XMJ_COPIES[tilePiece(kind)] - (seenCounts.get(kind) ?? 0)));
  }
  return unseen;
}

function better(a: XmjDistance, b: XmjDistance): boolean {
  return a.short < b.short || (a.short === b.short && a.outs > b.outs);
}

/** The discard that leaves the hand closest to winning. */
export function xmjBotDiscard(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
  options: readonly XmjTile[],
  unseen: ReadonlyMap<XmjTile, number>,
): XmjTile {
  let best: XmjTile = options[0] as XmjTile;
  let bestDistance: XmjDistance | null = null;
  for (const tile of options) {
    const rest = [...concealed];
    rest.splice(rest.indexOf(tile), 1);
    const distance = xmjDistance(rest, melds, unseen);
    if (bestDistance === null || better(distance, bestDistance)) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

function chooseClaim(view: XmjPlayerView, seat: XmjSeat): XmjClaim | null {
  const claims = view.legal.claims;
  const win = claims.find((claim) => claim.kind === 'win');
  if (win) return win;
  if (view.phase.type !== 'claim') return null;
  const concealed = view.hands[seat] ?? [];
  const melds = view.melds[seat];
  const unseen = xmjUnseen(view, seat);
  const now = xmjDistance(concealed, melds, unseen);
  let pick: XmjClaim | null = null;
  let pickDistance = now;
  for (const claim of claims) {
    const rest = [...concealed];
    for (const tile of claim.fromHand) rest.splice(rest.indexOf(tile), 1);
    const kind = meldKindOf([...claim.fromHand, view.phase.discard]);
    if (!kind) continue;
    const meld: XmjMeld = { kind, tiles: [...claim.fromHand, view.phase.discard] };
    const discard = xmjBotDiscard(rest, [meld], [...new Set(rest)], unseen);
    const kept = [...rest];
    kept.splice(kept.indexOf(discard), 1);
    const after = xmjDistance(kept, [meld], unseen);
    // Strictly closer only: claiming spends the draw and exposes the hand.
    if (after.short < pickDistance.short) {
      pick = claim;
      pickDistance = after;
    }
  }
  return pick;
}

/**
 * Fewest live winning tiles a bot declares on. A declared hand can no longer
 * change its wait or claim a set, so a wait on one tile stays open instead.
 */
export const XMJ_BOT_DECLARE_MIN_OUTS = 2;

/**
 * Copies of the tiles that would complete this ready hand that the seat has
 * not seen: its own tiles and the public table only, never the wall or the
 * opponent's hand.
 */
export function xmjLiveWinningOuts(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
  unseen: ReadonlyMap<XmjTile, number>,
): number {
  let outs = 0;
  for (const tile of XMJ_TILE_KINDS) {
    const left = unseen.get(tile) ?? 0;
    if (left > 0 && xmjWinShape([...concealed, tile], melds) !== null) outs += left;
  }
  return outs;
}

/** True when this seat has a locked (declared) hand. */
export function xmjBotIsLocked(view: XmjPlayerView, seat: XmjSeat): boolean {
  return view.declared?.[seat] === true;
}

/**
 * Whether to declare 聽牌 with this discard: the room must offer it (table 3,
 * a wait still physically possible), and the ready hand it leaves must have at
 * least XMJ_BOT_DECLARE_MIN_OUTS winning tiles this seat has not seen.
 */
export function xmjBotDeclares(view: XmjPlayerView, seat: XmjSeat, tile: XmjTile): boolean {
  if (!view.legal.declareReady?.includes(tile)) return false;
  const kept = [...(view.hands[seat] ?? [])];
  const at = kept.indexOf(tile);
  if (at < 0) return false;
  kept.splice(at, 1);
  return (
    xmjLiveWinningOuts(kept, view.melds[seat], xmjUnseen(view, seat)) >= XMJ_BOT_DECLARE_MIN_OUTS
  );
}

/** A discard, declared when `xmjBotDeclares` says so. */
export function xmjBotDiscardAction(view: XmjPlayerView, seat: XmjSeat, tile: XmjTile): XmjAction {
  return xmjBotDeclares(view, seat, tile)
    ? { action: 'declare-ready', tile }
    : { action: 'discard', tile };
}

/** The action this seat's bot takes from its view, or null if it has none. */
export function xmjBotAction(view: XmjPlayerView, seat: XmjSeat): XmjAction | null {
  const legal = view.legal;
  if (legal.nextHand) return { action: 'next-hand' };
  if (legal.selfDraw) return { action: 'self-draw' };
  if (legal.pass) {
    const claim = chooseClaim(view, seat);
    return claim === null
      ? { action: 'pass' }
      : { action: 'claim', kind: claim.kind, fromHand: claim.fromHand };
  }
  // A locked hand throws its draw by the room's automatic discard.
  if (xmjBotIsLocked(view, seat)) return null;
  if (legal.discard.length > 0) {
    const concealed = view.hands[seat] ?? [];
    const tile = xmjBotDiscard(concealed, view.melds[seat], legal.discard, xmjUnseen(view, seat));
    return xmjBotDiscardAction(view, seat, tile);
  }
  return null;
}
