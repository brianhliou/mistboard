/**
 * The xiangqi mahjong table, as markup.
 *
 * Two seats, so the table is two rows facing each other: the opponent across
 * the top, the viewer at the bottom, and a centre strip for whatever the table
 * is asking right now. Every button comes from view.legal, so the client never
 * decides what is allowed; it only draws what the server says this seat may do.
 *
 * Pure (view in, string out) so it can be tested without a room.
 */

import {
  tileColor,
  tilePiece,
  XMJ_GLYPHS,
  XMJ_PIECE_NAMES,
  type XmjMeld,
  type XmjPlayerView,
  type XmjScore,
  type XmjSeat,
  type XmjTile,
} from '@mistboard/game';

const SEAT_LABEL: Readonly<Record<XmjSeat, string>> = { east: 'East', west: 'West' };
const SEAT_GLYPH: Readonly<Record<XmjSeat, string>> = { east: '東', west: '西' };

function other(seat: XmjSeat): XmjSeat {
  return seat === 'east' ? 'west' : 'east';
}

/** Any action at all on offer to this seat: the room's seatMayAct. The
 *  server fills view.legal for the viewer, so this is the whole decision.  */
export function xmjViewOffersAction(view: XmjPlayerView, seat: XmjSeat): boolean {
  if (view.status.type !== 'playing' || view.perspective !== seat) return false;
  const legal = view.legal;
  return (
    legal.discard.length > 0 ||
    legal.selfDraw ||
    legal.pass ||
    legal.nextHand ||
    legal.claims.length > 0
  );
}

export function xmjTileName(tile: XmjTile): string {
  return `${tileColor(tile) === 'r' ? 'Red' : 'Black'} ${XMJ_PIECE_NAMES[tilePiece(tile)]}`;
}

function tileClass(tile: XmjTile, extra = ''): string {
  const ink = tileColor(tile) === 'r' ? 'xmj-tile--red' : 'xmj-tile--black';
  return `xmj-tile ${ink}${extra ? ` ${extra}` : ''}`;
}

function tileSpan(tile: XmjTile, extra = ''): string {
  return `<span class="${tileClass(tile, extra)}" role="img" aria-label="${xmjTileName(tile)}">${XMJ_GLYPHS[tile]}</span>`;
}

function tileButton(tile: XmjTile, extra = ''): string {
  return `<button type="button" class="${tileClass(tile, `xmj-tile--button ${extra}`.trim())}" data-xmj-tile="${tile}" aria-label="Discard ${xmjTileName(tile)}">${XMJ_GLYPHS[tile]}</button>`;
}

function backs(count: number): string {
  return Array.from(
    { length: count },
    () => '<span class="xmj-tile xmj-tile--back" aria-hidden="true"></span>',
  ).join('');
}

function meldsHtml(melds: readonly XmjMeld[]): string {
  if (melds.length === 0) return '';
  return melds
    .map(
      (meld) =>
        `<span class="xmj-meld" aria-label="${meld.kind}">${meld.tiles
          .map((tile) => tileSpan(tile, tile === meld.claimed ? 'xmj-tile--claimed' : ''))
          .join('')}</span>`,
    )
    .join('');
}

function pondHtml(tiles: readonly XmjTile[], openDiscard: boolean): string {
  if (tiles.length === 0) return '<div class="xmj-pond xmj-pond--empty">No discards</div>';
  return `<div class="xmj-pond">${tiles
    .map((tile, index) =>
      tileSpan(
        tile,
        openDiscard && index === tiles.length - 1 ? 'xmj-tile--sm xmj-tile--open' : 'xmj-tile--sm',
      ),
    )
    .join('')}</div>`;
}

function scoreHtml(score: XmjScore): string {
  const lines = score.lines
    .map((line) => `<li><span>${line.label}</span><span>${line.tai} 台</span></li>`)
    .join('');
  return `<ul class="xmj-score">${lines}<li class="xmj-score__total"><span>Total</span><span>${score.total}</span></li></ul>`;
}

function headHtml(view: XmjPlayerView, seat: XmjSeat, you: boolean): string {
  const dealer = view.dealer === seat ? '<span class="xmj-badge">Dealer 莊</span>' : '';
  const turn =
    view.status.type === 'playing' && !view.between && view.turn === seat
      ? '<span class="xmj-badge xmj-badge--turn">To play</span>'
      : '';
  return `<div class="xmj-head"><span class="xmj-wind">${SEAT_GLYPH[seat]}</span><span class="xmj-name">${SEAT_LABEL[seat]}${you ? ' (you)' : ''}</span><span class="xmj-points">${view.scores[seat]} pts</span>${dealer}${turn}</div>`;
}

function seatHtml(view: XmjPlayerView, seat: XmjSeat, you: boolean, canDiscard: boolean): string {
  const hand = view.hands[seat];
  const openDiscard = view.phase.type === 'claim' && view.phase.discarder === seat;
  const drawn = view.phase.type === 'discard' && view.turn === seat ? view.phase.drawn : null;
  let rack: string;
  if (hand === null) {
    rack = backs(view.handCounts[seat]);
  } else {
    const legal = new Set(view.legal.discard);
    // The drawn tile sits apart at the right, as it would on a table.
    const rest = [...hand];
    if (drawn !== null && rest.includes(drawn)) rest.splice(rest.lastIndexOf(drawn), 1);
    const draw = (tile: XmjTile, extra = '') =>
      canDiscard && legal.has(tile) ? tileButton(tile, extra) : tileSpan(tile, extra);
    rack = rest.map((tile) => draw(tile)).join('');
    if (drawn !== null && rest.length < hand.length) rack += draw(drawn, 'xmj-tile--drawn');
  }
  const melds = meldsHtml(view.melds[seat]);
  return `<section class="xmj-seat${you ? ' xmj-seat--self' : ''}" aria-label="${SEAT_LABEL[seat]}">${headHtml(view, seat, you)}<div class="xmj-rack">${rack}${melds ? `<span class="xmj-melds">${melds}</span>` : ''}</div>${pondHtml(view.discards[seat], openDiscard)}</section>`;
}

function centreHtml(view: XmjPlayerView, self: XmjSeat): string {
  const legal = view.legal;
  const buttons: string[] = [];
  for (const claim of legal.claims) {
    const tiles = claim.fromHand.map((tile) => XMJ_GLYPHS[tile]).join('');
    const label =
      claim.kind === 'win' ? 'Win 胡' : `${claim.kind === 'pung' ? 'Pung 碰' : 'Chow 吃'} ${tiles}`;
    buttons.push(
      `<button type="button" class="xmj-action xmj-action--primary" data-xmj-claim="${claim.kind}" data-xmj-from="${claim.fromHand.join(',')}">${label}</button>`,
    );
  }
  if (legal.selfDraw) {
    buttons.push(
      '<button type="button" class="xmj-action xmj-action--primary" data-xmj-selfdraw>Self-draw win 自摸</button>',
    );
  }
  if (legal.pass)
    buttons.push('<button type="button" class="xmj-action" data-xmj-pass>Pass</button>');
  if (legal.nextHand) {
    buttons.push(
      '<button type="button" class="xmj-action xmj-action--primary" data-xmj-next>Next hand</button>',
    );
  }

  let message = '';
  const phase = view.phase;
  if (view.status.type === 'finished') {
    const winner = view.status.winner;
    message =
      winner === null
        ? `Match drawn, ${view.scores.east} to ${view.scores.west}.`
        : `${SEAT_LABEL[winner]} wins the match, ${view.scores[winner]} to ${view.scores[other(winner)]}.`;
  } else if (phase.type === 'won') {
    message = `${SEAT_LABEL[phase.winner]} wins the hand ${phase.selfDrawn ? 'by self-draw' : 'on a discard'} with ${tileSpan(phase.winningTile, 'xmj-tile--sm')}`;
  } else if (phase.type === 'exhausted') {
    message = 'The wall ran out. No winner this hand (流局).';
  } else if (phase.type === 'claim') {
    message =
      phase.discarder === self
        ? `You discarded ${tileSpan(phase.discard, 'xmj-tile--sm')}. Waiting on ${SEAT_LABEL[other(self)]}.`
        : `${SEAT_LABEL[phase.discarder]} discarded ${tileSpan(phase.discard, 'xmj-tile--sm')}. Claim it or pass.`;
  } else if (view.turn === self && view.perspective === self) {
    message = phase.mayWin
      ? 'You can win. Declare it or discard.'
      : 'Your turn. Click a tile to discard it.';
  } else {
    message = `${SEAT_LABEL[view.turn]} to discard.`;
  }

  const waiting =
    view.between && view.status.type === 'playing'
      ? `<p class="xmj-note">${view.ready.length > 0 ? `Ready: ${view.ready.map((seat) => SEAT_LABEL[seat]).join(', ')}.` : ''} The next hand deals when both are ready.</p>`
      : '';
  const score = phase.type === 'won' ? scoreHtml(phase.score) : '';
  return `<div class="xmj-centre"><div class="xmj-status"><span>Hand ${Math.min(view.handNumber, view.handsInMatch)} of ${view.handsInMatch}</span><span>Wall ${view.wallCount}</span></div><p class="xmj-message">${message}</p>${score}${waiting}${buttons.length > 0 ? `<div class="xmj-actions">${buttons.join('')}</div>` : ''}</div>`;
}

function resultsHtml(view: XmjPlayerView): string {
  if (view.results.length === 0) return '';
  const rows = view.results
    .map((result, index) => {
      const outcome =
        result.winner === null
          ? '流局 (no winner)'
          : `${SEAT_LABEL[result.winner]}${result.selfDrawn ? ' 自摸' : ''}`;
      return `<tr><td>${index + 1}</td><td>${SEAT_LABEL[result.dealer]}</td><td>${outcome}</td><td>${result.score?.total ?? 0}</td></tr>`;
    })
    .join('');
  return `<table class="xmj-results"><thead><tr><th>Hand</th><th>Dealer</th><th>Result</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The whole table for one view. `canDiscard` is the room's "may act now". */
export function xiangqiMahjongTableHtml(view: XmjPlayerView, canDiscard: boolean): string {
  const self: XmjSeat = view.perspective === 'spectator' ? 'east' : view.perspective;
  const you = view.perspective !== 'spectator';
  return `<div class="xmj-table">${seatHtml(view, other(self), false, false)}${centreHtml(view, self)}${seatHtml(view, self, you, canDiscard && you)}${resultsHtml(view)}</div>`;
}
