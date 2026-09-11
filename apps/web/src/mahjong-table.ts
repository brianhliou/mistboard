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
  return `<div class="mj-melds">${melds.join('')}</div>`;
}

function discardsHtml(seat: MahjongSeatView, underClaim: number | null): string {
  const tiles = seat.discards.map((tile, index) => {
    const isLast = index === seat.discards.length - 1;
    const highlight = isLast && underClaim !== null && tile === underClaim;
    return `<span class="mj-pond-tile${highlight ? ' mj-pond-tile-claimable' : ''}">${mahjongTileHtml(tile, { size: 'sm' })}</span>`;
  });
  return `<div class="mj-pond">${tiles.join('')}</div>`;
}

/** Another player: what they are showing, and how many tiles they hold. */
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
  // Backs, not tiles. The view does not carry their hand, and this is the last
  // place it could accidentally be printed even if it did.
  const backs = Array.from({ length: seat.handSize }, () =>
    mahjongTileHtml(null, { size: 'sm' }),
  ).join('');
  return `
    <div class="${classes.join(' ')}" data-mj-seat="${seat.seat}">
      <div class="mj-seat-name">
        <span class="mj-seat-wind">${SEAT_WINDS[seat.seat]}</span>
        <span>${SEAT_LABELS[seat.seat]}</span>
        ${thinking ? '<span class="mj-seat-status">thinking</span>' : ''}
      </div>
      <div class="mj-seat-hand mj-seat-hand-hidden" aria-label="${seat.handSize} concealed tiles">${backs}</div>
      ${meldsHtml(seat)}
      ${discardsHtml(seat, view.discardUnderClaim)}
    </div>`;
}

/** The viewer's own seat: the one hand whose faces are drawn. */
function ownSeatHtml(seat: MahjongSeatView, view: MahjongPlayerView, canDiscard: boolean): string {
  const tiles = (seat.hand ?? [])
    .map((tile, index) => mahjongTileHtml(tile, { interactive: canDiscard, index }))
    .join('');
  const isTurn = view.turn === seat.seat && view.status.type === 'playing';
  return `
    <div class="mj-seat mj-seat-self${isTurn ? ' mj-seat-turn' : ''}" data-mj-seat="${seat.seat}">
      ${discardsHtml(seat, view.discardUnderClaim)}
      ${meldsHtml(seat)}
      <div class="mj-seat-name">
        <span class="mj-seat-wind">${SEAT_WINDS[seat.seat]}</span>
        <span>${SEAT_LABELS[seat.seat]}</span>
      </div>
      <div class="mj-hand" role="group" aria-label="your hand">${tiles}</div>
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

/** The buttons an open claim window offers this viewer. */
export function mahjongActionsHtml(view: MahjongPlayerView): string {
  if (view.ownClaims.length === 0) return '';
  const seen = new Set<string>();
  const buttons = view.ownClaims
    .filter((claim) => {
      const key = `${claim.kind}:${claim.fromHand.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(
      (claim) =>
        `<button type="button" class="mj-action mj-action-${claim.kind}" data-mj-claim="${claim.kind}" data-mj-from="${claim.fromHand.join(',')}">${claim.kind}</button>`,
    );
  // Passing is always offered alongside, because a window that only offers the
  // claim makes declining feel like a timeout rather than a decision.
  buttons.push(
    '<button type="button" class="mj-action mj-action-pass" data-mj-pass="1">pass</button>',
  );
  return `<div class="mj-actions" role="group" aria-label="claim the discard">${buttons.join('')}</div>`;
}
