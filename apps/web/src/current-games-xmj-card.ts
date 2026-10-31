// The /games "Just finished" card for Xiangqi Mahjong: both final hands face
// up on the table's felt, the top seat's hand at the top and the bottom seat's
// at the bottom, and between them the match score, each seat's points in its
// own half, with how the match ended on the centre line. A match often ends
// mid-hand (on time, by resignation), so the hands alone read as an unfinished
// deal; the score and the ending say who won the match and how. A finished
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

/** What the card draws: both final hands and the match score. */
export type XmjFinalView = Pick<XmjPlayerView, 'hands' | 'melds' | 'scores'>;

/** The finished-match read: the view, and the status reason it ended on. */
export type XmjFinal = { view: XmjFinalView; reason: string };

// The drawing's own units; its ratio is a xiangqi board's (552 / 612), so the
// card sits level with the xiangqi cards beside it.
const VIEW_W = 300;
const VIEW_H = Math.round((VIEW_W * 612) / 552);
const PAD_X = 14;
const PAD_Y = 16;
const HAND_SCALE = 1.1;
const SCORE_SIZE = 40;
const SCORE_GAP = 28;
const PILL_H = 36;
const PILL_SIZE = 21;
const MELD_GAP = 14;
const FELT = '#1f5c45';
const FELT_EDGE = '#164634';
const RIM = 'rgb(255 255 255 / 0.12)';
const PILL_FILL = '#123a2b';
const SCORE_WON = '#f2c95c';
const SCORE_OTHER = 'rgb(255 255 255 / 0.6)';

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

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// SVG text cannot measure itself before layout, so the pill is sized from the
// label: a CJK character is about one em wide, a Latin one a little over half.
function labelWidth(label: string): number {
  let em = 0;
  for (const ch of label) em += ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.56;
  return em * PILL_SIZE;
}

// The centre line, broken by a pill naming how the match ended when there is
// a label for it.
function centreLineSvg(ending: string | null): string {
  const y = VIEW_H / 2;
  const line = `<line x1="${PAD_X + 10}" x2="${VIEW_W - PAD_X - 10}" y1="${y}" y2="${y}" stroke="${FELT_EDGE}" stroke-width="1.5"/>`;
  if (!ending) return line;
  const w = round(labelWidth(ending) + 30);
  return [
    line,
    `<g class="xmj-card-ending">`,
    `<rect x="${round((VIEW_W - w) / 2)}" y="${round(y - PILL_H / 2)}" width="${w}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${PILL_FILL}" stroke="${RIM}"/>`,
    `<text x="${VIEW_W / 2}" y="${round(y)}" text-anchor="middle" dominant-baseline="central" font-size="${PILL_SIZE}" font-weight="600" fill="#f1f5f2">${escapeXml(ending)}</text>`,
    '</g>',
  ].join('');
}

// A seat's match points in its half of the felt, beside the centre line.
function scoreSvg(seat: XmjSeat, points: number, above: boolean, highlight: boolean): string {
  const y = above ? VIEW_H / 2 - SCORE_GAP : VIEW_H / 2 + SCORE_GAP + SCORE_SIZE * 0.72;
  return `<text class="xmj-card-score" data-seat="${seat}" x="${VIEW_W / 2}" y="${round(y)}" text-anchor="middle" font-size="${SCORE_SIZE}" font-weight="700" fill="${highlight ? SCORE_WON : SCORE_OTHER}">${points}</text>`;
}

/**
 * The card's picture. `bottom` is the seat whose name sits under the card's
 * board; `winner` dims the other seat's hand and lights its score. `ending` is
 * the localized way the match ended, or null for no pill. Concealed tiles a
 * viewer may not see arrive as null and draw nothing.
 */
export function xmjFinalHandsSvg(
  view: XmjFinalView,
  bottom: XmjSeat,
  winner: XmjSeat | null,
  pieceSet: XiangqiPieceSet,
  title: string,
  ending: string | null = null,
): string {
  const top: XmjSeat = bottom === 'east' ? 'west' : 'east';
  const handH = (XMJ_TILE_H + XMJ_TILE_DEPTH) * HAND_SCALE;
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
  return [
    `<svg class="xmj-card-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="${FELT}"/>`,
    `<rect x="6.5" y="6.5" width="${VIEW_W - 13}" height="${VIEW_H - 13}" rx="10" fill="none" stroke="${RIM}"/>`,
    centreLineSvg(ending),
    scoreSvg(top, view.scores[top] ?? 0, true, winner === top),
    scoreSvg(bottom, view.scores[bottom] ?? 0, false, winner === bottom),
    hand(top, PAD_Y),
    hand(bottom, VIEW_H - PAD_Y - handH),
    '</svg>',
  ].join('');
}

export const XMJ_CARD_ASPECT = VIEW_W / VIEW_H;

/** The finished match, or null when the server will not show it (live, gone). */
export async function loadXmjFinal(roomId: string): Promise<XmjFinal | null> {
  const resp = await fetch(finishedHandsUrl(roomId));
  if (!resp.ok) return null;
  const body = (await resp.json()) as {
    view?: XmjFinalView;
    state?: { status?: { reason?: unknown } };
  } | null;
  const view = body?.view;
  if (!view?.hands || !view.melds || !view.scores) return null;
  const reason = body?.state?.status?.reason;
  return { view, reason: typeof reason === 'string' ? reason : '' };
}
