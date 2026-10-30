// The /games "Just finished" card for Xiangqi Mahjong: both final hands face
// up on the table's felt, the top seat's hand at the top and the bottom seat's
// at the bottom, each seat's discards in the pond between them. A finished
// match is open to everyone (the postgame review shows both hands); the hands
// come from the server's finished-match read, which answers only once the log
// replays to 'finished', so this card never decides on its own what a live
// match may reveal (current-games-model.ts finishedTileKind).

import type { XmjMeld, XmjPlayerView, XmjSeat, XmjTile } from '@mistboard/game';
import { finishedHandsUrl } from './current-games-model.js';
import {
  XMJ_TILE_DEPTH,
  XMJ_TILE_GAP,
  XMJ_TILE_H,
  XMJ_TILE_W,
  xmjTileSvg,
} from './xiangqi-mahjong-tile-svg.js';
import type { XiangqiPieceSet } from './xiangqi-piece-sets.js';

/** What the card draws: the finished view's public tiles, both hands up. */
export type XmjFinalView = Pick<XmjPlayerView, 'hands' | 'melds' | 'discards'>;

// The drawing's own units; its ratio is a xiangqi board's (552 / 612), so the
// card sits level with the xiangqi cards beside it.
const VIEW_W = 300;
const VIEW_H = Math.round((VIEW_W * 612) / 552);
const PAD_X = 14;
const PAD_Y = 16;
const HAND_SCALE = 1.1;
const POND_SCALE = 0.42;
const POND_ROW_GAP = 8;
const MELD_GAP = 14;
const FELT = '#1f5c45';
const FELT_EDGE = '#164634';
const RIM = 'rgb(255 255 255 / 0.12)';

type Laid = { tile: XmjTile; x: number; sideways: boolean };

// A row of tiles: the concealed hand, then each meld laid down after a gap, a
// claimed tile lying sideways as on the table.
function layRow(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
): {
  laid: Laid[];
  width: number;
} {
  const laid: Laid[] = [];
  let x = 0;
  const place = (tile: XmjTile, sideways: boolean) => {
    laid.push({ tile, x, sideways });
    x += (sideways ? XMJ_TILE_H : XMJ_TILE_W) + XMJ_TILE_GAP;
  };
  for (const tile of concealed) place(tile, false);
  for (const meld of melds) {
    if (laid.length > 0) x += MELD_GAP - XMJ_TILE_GAP;
    let claimedShown = false;
    for (const tile of meld.tiles) {
      const sideways = !claimedShown && meld.claimed === tile;
      if (sideways) claimedShown = true;
      place(tile, sideways);
    }
  }
  return { laid, width: Math.max(0, x - XMJ_TILE_GAP) };
}

// One row centred at `top`, scaled down to fit the felt and never above `scale`.
function rowSvg(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
  top: number,
  scale: number,
  pieceSet: XiangqiPieceSet,
  extraAttrs = '',
): string {
  const { laid, width } = layRow(concealed, melds);
  if (laid.length === 0) return '';
  const s = Math.min(scale, (VIEW_W - 2 * PAD_X) / width);
  const left = (VIEW_W - width * s) / 2;
  const tiles = laid
    .map(({ tile, x, sideways }) =>
      // A sideways tile lines up on the upright tiles' bottom edge.
      xmjTileSvg(tile, x, sideways ? XMJ_TILE_H - XMJ_TILE_W : 0, pieceSet, {
        sideways,
        name: false,
      }),
    )
    .join('');
  return `<g transform="translate(${round(left)} ${round(top)}) scale(${round(s)})"${extraAttrs}>${tiles}</g>`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The card's picture. `bottom` is the seat whose name sits under the card's
 * board; `winner` dims the other seat's hand. Concealed tiles a viewer may not
 * see arrive as null and draw nothing.
 */
export function xmjFinalHandsSvg(
  view: XmjFinalView,
  bottom: XmjSeat,
  winner: XmjSeat | null,
  pieceSet: XiangqiPieceSet,
  title: string,
): string {
  const top: XmjSeat = bottom === 'east' ? 'west' : 'east';
  const handH = (XMJ_TILE_H + XMJ_TILE_DEPTH) * HAND_SCALE;
  const pondH = (XMJ_TILE_H + XMJ_TILE_DEPTH) * POND_SCALE;
  const pondTop = (VIEW_H - (2 * pondH + POND_ROW_GAP)) / 2;
  const dim = (seat: XmjSeat) =>
    winner && winner !== seat
      ? ` opacity="0.78" data-result="lost"`
      : ` data-result="${winner === seat ? 'won' : 'none'}"`;
  const hand = (seat: XmjSeat, y: number) =>
    rowSvg(
      view.hands[seat] ?? [],
      view.melds[seat] ?? [],
      y,
      HAND_SCALE,
      pieceSet,
      `${dim(seat)} data-seat="${seat}" class="xmj-card-hand"`,
    );
  const pond = (seat: XmjSeat, y: number) =>
    rowSvg(
      view.discards[seat] ?? [],
      [],
      y,
      POND_SCALE,
      pieceSet,
      ` data-seat="${seat}" class="xmj-card-pond"`,
    );
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<svg class="xmj-card-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${safeTitle}">`,
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="${FELT}"/>`,
    `<rect x="6.5" y="6.5" width="${VIEW_W - 13}" height="${VIEW_H - 13}" rx="10" fill="none" stroke="${RIM}"/>`,
    `<line x1="${PAD_X + 10}" x2="${VIEW_W - PAD_X - 10}" y1="${VIEW_H / 2}" y2="${VIEW_H / 2}" stroke="${FELT_EDGE}" stroke-width="1.5"/>`,
    hand(top, PAD_Y),
    pond(top, pondTop),
    pond(bottom, pondTop + pondH + POND_ROW_GAP),
    hand(bottom, VIEW_H - PAD_Y - handH),
    '</svg>',
  ].join('');
}

export const XMJ_CARD_ASPECT = VIEW_W / VIEW_H;

/** The finished view, or null when the server will not show it (live, gone). */
export async function loadXmjFinalView(roomId: string): Promise<XmjFinalView | null> {
  const resp = await fetch(finishedHandsUrl(roomId));
  if (!resp.ok) return null;
  const body = (await resp.json()) as { view?: XmjFinalView } | null;
  const view = body?.view;
  if (!view?.hands || !view.melds || !view.discards) return null;
  return view;
}
