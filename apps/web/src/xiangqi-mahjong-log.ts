/**
 * The xiangqi mahjong move log, one hand at a time.
 *
 * A chess-style two-column list reads badly for this game: the turns are not
 * strictly alternating, most rows are passes, and the numbering runs on across
 * hands. This groups the public move log into hands and keeps only the rows a
 * player reads: discards (with "draws, discards" when the seat drew first),
 * claims, wins and a wall that ran out. Passes and the between-hands steps are
 * folded away; a pass is what makes the other seat draw, so it shows up as the
 * next row's "draws".
 *
 * Only public facts are used: who discarded which tile and who drew. Which
 * tile a seat drew stays its own secret, so the log never says.
 *
 * Pure (moves in, rows out) so it is tested without a room.
 */

import {
  XMJ_DEALER_TILES,
  XMJ_OTHER_TILES,
  type XmjMove,
  type XmjSeat,
  type XmjTile,
} from '@mistboard/game';

/** The wall at the deal: 32 tiles less both hands. */
const XMJ_WALL_AT_DEAL = 32 - XMJ_DEALER_TILES - XMJ_OTHER_TILES;

export type XmjLogRow =
  | {
      readonly kind: 'discard';
      readonly seat: XmjSeat;
      readonly tile: XmjTile;
      readonly drew: boolean;
      readonly ply: number;
    }
  | {
      readonly kind: 'claim';
      readonly seat: XmjSeat;
      readonly claim: 'pung' | 'chow';
      readonly tile: XmjTile;
      readonly ply: number;
    }
  | { readonly kind: 'win'; readonly seat: XmjSeat; readonly tile: XmjTile; readonly ply: number }
  | { readonly kind: 'self-draw'; readonly seat: XmjSeat; readonly ply: number }
  | { readonly kind: 'exhausted'; readonly ply: number };

export interface XmjLogHand {
  /** 1-based hand number. */
  readonly hand: number;
  readonly rows: readonly XmjLogRow[];
  /** The hand reached a result (a win or an empty wall). */
  readonly ended: boolean;
  /** The first and last ply this hand covers, hidden moves included. */
  readonly firstPly: number;
  readonly lastPly: number;
}

export interface XmjLogMove {
  readonly move: XmjMove;
  readonly ply: number;
}

function other(seat: XmjSeat): XmjSeat {
  return seat === 'east' ? 'west' : 'east';
}

/** Group a match's moves into hands of readable rows. */
export function xmjHandLog(moves: readonly XmjLogMove[]): XmjLogHand[] {
  const hands: XmjLogHand[] = [];
  let rows: XmjLogRow[] = [];
  let firstPly = 0;
  let lastPly = 0;
  let wall = XMJ_WALL_AT_DEAL;
  let inHand = true;
  let ready = new Set<XmjSeat>();
  let lastDiscard: { seat: XmjSeat; tile: XmjTile } | null = null;
  // The seat whose next discard follows a draw.
  let drew: XmjSeat | null = null;

  const close = (ended: boolean) => {
    hands.push({ hand: hands.length + 1, rows, ended, firstPly, lastPly });
    rows = [];
    firstPly = 0;
    lastPly = 0;
  };
  const startHand = () => {
    inHand = true;
    wall = XMJ_WALL_AT_DEAL;
    ready = new Set();
    lastDiscard = null;
    drew = null;
  };

  for (const { move, ply } of moves) {
    if (!inHand) {
      // Between hands: every step is hidden. The next hand deals when both
      // seats are ready, or when the wait runs out.
      if (move.action === 'next-hand') ready.add(move.by);
      if (move.action === 'timeout' || ready.size >= 2) startHand();
      continue;
    }
    if (firstPly === 0) firstPly = ply;
    lastPly = ply;
    switch (move.action) {
      case 'discard':
        rows.push({ kind: 'discard', seat: move.by, tile: move.tile, drew: drew === move.by, ply });
        lastDiscard = { seat: move.by, tile: move.tile };
        drew = null;
        break;
      case 'pass':
      case 'timeout': {
        // The claimant let the discard go: it draws, or the wall is empty.
        const drawer = lastDiscard ? other(lastDiscard.seat) : other(move.by);
        if (wall === 0) {
          rows.push({ kind: 'exhausted', ply });
          close(true);
          inHand = false;
        } else {
          wall -= 1;
          drew = drawer;
        }
        break;
      }
      case 'claim':
        // A claim always answers a discard; a log that says otherwise is skipped.
        if (!lastDiscard) break;
        if (move.kind === 'win') {
          rows.push({ kind: 'win', seat: move.by, tile: lastDiscard.tile, ply });
          close(true);
          inHand = false;
        } else {
          rows.push({
            kind: 'claim',
            seat: move.by,
            claim: move.kind,
            tile: lastDiscard.tile,
            ply,
          });
          drew = null;
        }
        break;
      case 'self-draw':
        rows.push({ kind: 'self-draw', seat: move.by, ply });
        close(true);
        inHand = false;
        break;
      default:
        break;
    }
  }
  if (inHand && firstPly !== 0) close(false);
  return hands;
}
