/**
 * The table: four seats, what each is showing, and what the viewer can do.
 *
 * Markup rather than DOM, so the hidden-information rules can be asserted in a
 * test without a browser. That matters more here than on any other surface in
 * this repo: three of the four hands are secret, and the failure mode is not a
 * visual glitch but a page whose SOURCE contains the tiles.
 *
 * The viewer always sits at the bottom. A mahjong player reads the table from
 * their own seat and the winds go anticlockwise from there, so the other three
 * are placed right, top, left in turn order rather than by fixed compass point.
 */

import type { MahjongPlayerView, MahjongSeat, MahjongSeatView } from '@mistboard/mahjong';
import { MAHJONG_SEATS } from '@mistboard/mahjong';
import { mahjongTileFace, mahjongTileName } from './mahjong-tile.js';

const SEAT_WINDS: Record<MahjongSeat, string> = {
  east: '東',
  south: '南',
  west: '西',
  north: '北',
};

const SEAT_LABELS: Record<MahjongSeat, string> = {
  east: 'East',
  south: 'South',
  west: 'West',
  north: 'North',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One tile.
 *
 * `interactive` drives whether it is a button or a plain span. A tile nobody
 * can click should not be focusable, or keyboard users tab through fifty-odd
 * dead stops to reach the one control that does something.
 */
export function mahjongTileHtml(
  tile: number | null,
  options: { size?: 'sm'; interactive?: boolean; index?: number; selected?: boolean } = {},
): string {
  const face = mahjongTileFace(tile);
  const classes = ['mj-tile', ...face.classes];
  if (options.size === 'sm') classes.push('mj-tile-sm');
  if (options.selected) classes.push('mj-tile-selected');
  const label = escapeHtml(face.label);
  if (!options.interactive) {
    return `<span class="${classes.join(' ')}" role="img" aria-label="${label}">${face.inner}</span>`;
  }
  return `<button type="button" class="${classes.join(' ')}" data-mj-tile="${options.index ?? tile}" title="${label}" aria-label="Discard ${label}">${face.inner}</button>`;
}

function meldsHtml(seat: MahjongSeatView): string {
  if (seat.melds.length === 0) return '';
  const melds = seat.melds.map((meld) => {
    if (meld.tile === null) {
      // Another seat's concealed kong: four backs, because the tile is not ours
      // to show. See the note on MahjongMeldView.
      const backs = [null, null, null, null]
        .map((t) => mahjongTileHtml(t, { size: 'sm' }))
        .join('');
      return `<span class="mj-meld mj-meld-concealed" aria-label="concealed kong">${backs}</span>`;
    }
    const count = meld.kind === 'kong' ? 4 : 3;
    const tiles =
      meld.kind === 'chow'
        ? [meld.tile, meld.tile + 1, meld.tile + 2]
        : Array.from({ length: count }, () => meld.tile as number);
    const inner = tiles.map((tile) => mahjongTileHtml(tile, { size: 'sm' })).join('');
    return `<span class="mj-meld" aria-label="${meld.kind} of ${escapeHtml(mahjongTileName(meld.tile))}">${inner}</span>`;
  });
  return `<div class="mj-melds" aria-label="declared sets">${melds.join('')}</div>`;
}

function discardsHtml(seat: MahjongSeatView, underClaim: number | null): string {
  const tiles = seat.discards.map((tile, index) => {
    const isLast = index === seat.discards.length - 1;
    const highlight = isLast && underClaim !== null && tile === underClaim;
    return `<span class="mj-pond-tile${highlight ? ' mj-pond-tile-claimable' : ''}">${mahjongTileHtml(tile, { size: 'sm' })}</span>`;
  });
  if (tiles.length === 0) return '<div class="mj-pond mj-pond-empty"></div>';
  return `<div class="mj-pond" aria-label="discards">${tiles.join('')}</div>`;
}

/**
 * Another player.
 *
 * Their concealed hand is a RACK of narrow slivers, not a row of tiles. Drawn
 * full size it is ten to thirteen identical blank rectangles per opponent,
 * thirty-nine of them around the table, and they carry exactly one bit of
 * information between them: how many. At full size they out-weigh the melds and
 * the pond, which are the things actually worth reading, and the table becomes
 * a wall of green.
 *
 * Melds and the pond are then separated deliberately, because in the first
 * version they were both rows of small tiles and nobody could tell which was
 * which: a meld is a set this player OWNS, the pond is what they have thrown
 * away, and confusing the two misreads the whole hand.
 */
function opponentHtml(
  seat: MahjongSeatView,
  view: MahjongPlayerView,
  position: 'right' | 'top' | 'left',
): string {
  const isTurn = view.turn === seat.seat && view.status.type === 'playing';
  const thinking = view.awaiting.includes(seat.seat);
  const classes = ['mj-seat', `mj-seat-${position}`];
  if (isTurn) classes.push('mj-seat-turn');
  if (thinking) classes.push('mj-seat-thinking');
  const rack = Array.from({ length: seat.handSize }, () => '<span class="mj-sliver"></span>').join(
    '',
  );
  return `
    <div class="${classes.join(' ')}" data-mj-seat="${seat.seat}">
      ${seatHeadHtml(seat, isTurn, thinking)}
      <div class="mj-rack" role="img" aria-label="${seat.handSize} concealed tiles">${rack}</div>
      ${meldsHtml(seat)}
      ${discardsHtml(seat, view.discardUnderClaim)}
    </div>`;
}

/**
 * The seat's name row, and where whose-turn-it-is is actually said.
 *
 * A colour change on the label was too quiet to find on a dark table, so the
 * turn is structural: a marker in the row, a class the stylesheet can put a bar
 * against, and the tile count beside the name so "they are one away" is legible
 * without counting slivers.
 */
function seatHeadHtml(seat: MahjongSeatView, isTurn: boolean, thinking: boolean): string {
  return `
    <div class="mj-seat-head">
      ${isTurn ? '<span class="mj-turn-dot" aria-hidden="true"></span>' : ''}
      <span class="mj-seat-wind">${SEAT_WINDS[seat.seat]}</span>
      <span class="mj-seat-name">${SEAT_LABELS[seat.seat]}</span>
      ${isTurn ? '<span class="mj-seat-turn-label">to play</span>' : ''}
      ${thinking ? '<span class="mj-seat-status">deciding</span>' : ''}
      <span class="mj-seat-count" title="tiles in hand">${seat.handSize}</span>
    </div>`;
}

/**
 * The viewer's own seat: the one hand whose faces are drawn.
 *
 * The action bar lives HERE, immediately above the hand, rather than in the
 * room's side column. That column is laid out as two player boxes because every
 * variant before this had two seats, and a claim prompt put there is both
 * cramped and nowhere near the tiles it is about. A claim window is six seconds
 * long: the buttons have to be where the eyes already are.
 */
function ownSeatHtml(seat: MahjongSeatView, view: MahjongPlayerView, canDiscard: boolean): string {
  const tiles = (seat.hand ?? [])
    .map((tile, index) => mahjongTileHtml(tile, { interactive: canDiscard, index }))
    .join('');
  const isTurn = view.turn === seat.seat && view.status.type === 'playing';
  return `
    <div class="mj-seat mj-seat-self${isTurn ? ' mj-seat-turn' : ''}" data-mj-seat="${seat.seat}">
      ${discardsHtml(seat, view.discardUnderClaim)}
      ${seatHeadHtml(seat, isTurn, view.awaiting.includes(seat.seat))}
      ${mahjongActionsHtml(view)}
      <div class="mj-hand-row">
        <div class="mj-hand" role="group" aria-label="your hand">${tiles}</div>
        ${ownMeldsHtml(seat)}
      </div>
    </div>`;
}

/**
 * Your own declared sets, beside your hand rather than off with your discards.
 *
 * They rendered up next to the pond, which reads as a second row of hand tiles
 * that will not respond to a click: a claimed set LEAVES the concealed hand and
 * can never be discarded, which is correct mahjong and looks exactly like a bug
 * when the tiles sit where a hand is. At a table they sit face up beside you,
 * so they sit there here, behind a divider and labelled.
 */
function ownMeldsHtml(seat: MahjongSeatView): string {
  if (seat.melds.length === 0) return '';
  return `
    <div class="mj-own-melds">
      <span class="mj-own-melds-label">declared</span>
      ${meldsHtml(seat)}
    </div>`;
}

/** The middle of the table: wall count, round wind, and the tile under claim. */
function centreHtml(view: MahjongPlayerView): string {
  const claimed =
    view.discardUnderClaim === null
      ? ''
      : `<div class="mj-centre-claim">${mahjongTileHtml(view.discardUnderClaim)}<span class="mj-centre-claim-label">under claim</span></div>`;
  return `
    <div class="mj-centre">
      <div class="mj-centre-wind" aria-label="round wind">${SEAT_WINDS[MAHJONG_SEATS[view.roundWind - 27] ?? 'east']}</div>
      <div class="mj-centre-wall">${view.wallRemaining}<span class="mj-centre-wall-label">tiles left</span></div>
      ${claimed}
    </div>`;
}

/**
 * Seats in reading order from the viewer: self, then right, top, left.
 *
 * Turn order at a mahjong table runs anticlockwise, so the seat that plays
 * after you sits to your right. A spectator gets east's view of the table,
 * which is the conventional way a hand is written down.
 */
export function mahjongSeatOrder(perspective: MahjongSeat | 'spectator'): MahjongSeat[] {
  const anchor = perspective === 'spectator' ? 'east' : perspective;
  const start = MAHJONG_SEATS.indexOf(anchor);
  return [0, 1, 2, 3].map((offset) => MAHJONG_SEATS[(start + offset) % 4] as MahjongSeat);
}

export function mahjongTableHtml(view: MahjongPlayerView, canDiscard: boolean): string {
  const [self, right, top, left] = mahjongSeatOrder(view.perspective);
  const seatOf = (seat: MahjongSeat) =>
    view.seats.find((candidate) => candidate.seat === seat) as MahjongSeatView;
  const selfSeat = seatOf(self as MahjongSeat);
  // A spectator has no hand to draw, so the bottom seat renders as an opponent.
  const bottom =
    view.perspective === 'spectator'
      ? opponentHtml(selfSeat, view, 'top')
      : ownSeatHtml(selfSeat, view, canDiscard);
  return `
    <div class="mj-table" data-mj-perspective="${view.perspective}">
      ${opponentHtml(seatOf(top as MahjongSeat), view, 'top')}
      <div class="mj-table-middle">
        ${opponentHtml(seatOf(left as MahjongSeat), view, 'left')}
        ${centreHtml(view)}
        ${opponentHtml(seatOf(right as MahjongSeat), view, 'right')}
      </div>
      ${bottom}
    </div>`;
}

/**
 * What the viewer can do right now, beyond discarding.
 *
 * Two quite different things share this bar. A claim answers somebody else's
 * discard and is on a six-second timer; a self-drawn win answers nothing and
 * has no timer at all, which is exactly why it needs a button: no window opens
 * for it, so without one a self-drawn hand can never be declared. It was not
 * declarable until this existed.
 */
export function mahjongActionsHtml(view: MahjongPlayerView): string {
  const buttons: string[] = [];

  if (view.ownSelfDraw) {
    buttons.push(
      '<button type="button" class="mj-action mj-action-win mj-action-selfdraw" data-mj-selfdraw="1">\u81ea\u6478 declare win</button>',
    );
  }

  if (view.ownClaims.length > 0 && view.discardUnderClaim !== null) {
    const seen = new Set<string>();
    for (const claim of view.ownClaims) {
      const key = `${claim.kind}:${claim.fromHand.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      buttons.push(
        `<button type="button" class="mj-action mj-action-${claim.kind}" data-mj-claim="${claim.kind}" data-mj-from="${claim.fromHand.join(',')}">${CLAIM_LABELS[claim.kind] ?? claim.kind}</button>`,
      );
    }
    // Passing is a button like any other. Declining should read as a decision
    // rather than as letting the clock run out.
    buttons.push(
      '<button type="button" class="mj-action mj-action-pass" data-mj-pass="1">pass</button>',
    );
  }

  if (buttons.length === 0) return '';
  return `<div class="mj-actions" role="group" aria-label="your options">${buttons.join('')}</div>`;
}

/** The Cantonese name first, since that is what a player at a table says. */
const CLAIM_LABELS: Record<string, string> = {
  win: '\u98df\u7cca win',
  kong: '\u69d3 kong',
  pung: '\u78b0 pung',
  chow: '\u4e0a chow',
};
