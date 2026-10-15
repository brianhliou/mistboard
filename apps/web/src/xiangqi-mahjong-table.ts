/**
 * The xiangqi mahjong table, as markup (layout "A, the table", 2026-10-14).
 *
 * Top to bottom: the opponent's seat and tiles, the opponent's discards, a
 * centre plate (or the result card between hands), the viewer's discards, the
 * claim row, the viewer's hand, the viewer's seat. Each player's discards are
 * their own pond of six columns, in order, with the latest discard notched.
 *
 * Every button comes from view.legal, so the client never decides what is
 * allowed; it only draws what the server says this seat may do. The winning
 * hand is grouped from score.shape, the split the score was counted from, so
 * the table runs no decomposition of its own. Nothing groups a hand in play:
 * no set or pair hints.
 *
 * Pure (view and options in, string out) so it can be tested without a room.
 */

import {
  tileColor,
  tilePiece,
  XMJ_CLAIM_WINDOW_MS,
  XMJ_GLYPHS,
  type XmjClaim,
  type XmjMeld,
  type XmjPlayerView,
  type XmjScore,
  type XmjSeat,
  type XmjTile,
  xmjSortTiles,
} from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import type { TenantReasonKey } from './variant-tenant/room-chrome.js';
import { escapeHtml } from './web-utils.js';

export interface XmjTableOptions {
  /** The room's "may act now": live, seated, and something on offer. */
  readonly canAct: boolean;
  /** What to call each seat: "You", the opponent's handle, "Bot". */
  readonly names: Readonly<Record<XmjSeat, string>>;
  /** The server's clock, as well as the client knows it. */
  readonly now: number;
  /** A pass is waiting for the pause to end; the buttons are spent. */
  readonly passQueued?: boolean;
}

/** The felts the table can be laid on (`?felt=`); green is the default. */
export const XMJ_FELTS = ['green', 'wood', 'slate', 'site'] as const;
export type XmjFelt = (typeof XMJ_FELTS)[number];

export function xmjFeltFromSearch(search: string): XmjFelt {
  const felt = new URLSearchParams(search).get('felt') ?? '';
  return (XMJ_FELTS as readonly string[]).includes(felt) ? (felt as XmjFelt) : 'green';
}

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
  return t('live.xmj.tileName', {
    ink: t(tileColor(tile) === 'r' ? 'live.xmj.inkRed' : 'live.xmj.inkBlack'),
    piece: t(`live.xmj.piece.${tilePiece(tile)}` as I18nKey),
  });
}

export function xmjReasonPhrase(reason: string): TenantReasonKey {
  switch (reason) {
    case 'points':
      return 'result.onPoints';
    case 'tie':
      return 'result.drawPhrase';
    case 'timeout':
      return 'result.timeout';
    case 'resignation':
      return 'result.resignation';
    case 'abandonment':
      return 'result.abandonment';
    default:
      return 'result.gameRules';
  }
}

// One whole sentence per reason, so the zh catalogs order it their own way.
type XmjWinLine = readonly [I18nKey, I18nKey];
const XMJ_WIN_LINES: ReadonlyMap<string, XmjWinLine> = new Map<string, XmjWinLine>([
  ['points', ['live.xmj.youWinOnPoints', 'live.xmj.nameWinsOnPoints']],
  ['timeout', ['live.xmj.youWinOnTime', 'live.xmj.nameWinsOnTime']],
  ['resignation', ['live.xmj.youWinByResignation', 'live.xmj.nameWinsByResignation']],
  ['abandonment', ['live.xmj.youWinByAbandonment', 'live.xmj.nameWinsByAbandonment']],
]);
const XMJ_WIN_FALLBACK: XmjWinLine = ['live.xmj.youWin', 'live.xmj.nameWins'];

/**
 * The finished-match line for the room chrome (meta card, the result under the
 * move list, the notice): the winner by player, "You" for the viewer's own seat,
 * never the seat id. East/west only alternate the deal; the table names players.
 */
export function xmjResultLine(
  winner: XmjSeat | null,
  reason: string,
  viewer: unknown,
  nameOf: (seat: XmjSeat) => string,
): string {
  if (winner === null) {
    if (reason === 'tie') return t('live.xmj.drawnOnPoints');
    return t('result.drawByReason', { reason: t(xmjReasonPhrase(reason)) });
  }
  const [youKey, nameKey] = XMJ_WIN_LINES.get(reason) ?? XMJ_WIN_FALLBACK;
  return winner === viewer ? t(youKey) : t(nameKey, { name: nameOf(winner) });
}

// A real minus sign (U+2212), not the hyphen: it is as wide as the plus, so a
// column of scores lines up, and the seat rows and the ledger read the same.
export function signed(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `\u2212${-points}`;
  return '0';
}

function tileClass(tile: XmjTile, extra = ''): string {
  const ink = tileColor(tile) === 'r' ? 'xmj-tile--red' : 'xmj-tile--black';
  return `xmj-tile ${ink}${extra ? ` ${extra}` : ''}`;
}

function tileSpan(tile: XmjTile, extra = ''): string {
  return `<span class="${tileClass(tile, extra)}" role="img" aria-label="${xmjTileName(tile)}">${XMJ_GLYPHS[tile]}</span>`;
}

function tileButton(tile: XmjTile, extra = ''): string {
  const cls = tileClass(tile, `xmj-tile--button${extra ? ` ${extra}` : ''}`);
  const label = t('live.xmj.discardTile', { tile: xmjTileName(tile) });
  return `<button type="button" class="${cls}" data-xmj-tile="${tile}" aria-label="${label}">${XMJ_GLYPHS[tile]}</button>`;
}

function backs(count: number): string {
  return Array.from(
    { length: count },
    () => '<span class="xmj-tile xmj-tile--back" aria-hidden="true"></span>',
  ).join('');
}

function meldsHtml(melds: readonly XmjMeld[]): string {
  if (melds.length === 0) return '';
  const html = melds
    .map(
      (meld) =>
        `<span class="xmj-meld">${meld.tiles
          .map((tile) =>
            tileSpan(
              tile,
              tile === meld.claimed ? 'xmj-tile--sm xmj-tile--claimed' : 'xmj-tile--sm',
            ),
          )
          .join('')}</span>`,
    )
    .join('');
  return `<span class="xmj-melds">${html}</span>`;
}

/**
 * Which pond holds the latest discard, if it is still in a pond. In a claim
 * window it is the discarder's. After a draw it is the other seat's last
 * tile; after a claim it went into a meld, so nothing is marked.
 */
function lastDiscardSeat(view: XmjPlayerView): XmjSeat | null {
  const phase = view.phase;
  if (view.between) return null;
  if (phase.type === 'claim') return phase.discarder;
  if (phase.type === 'discard' && phase.mayWin) {
    const seat = other(view.turn);
    return view.discards[seat].length > 0 ? seat : null;
  }
  return null;
}

function bubbleHtml(view: XmjPlayerView, names: Readonly<Record<XmjSeat, string>>): string {
  const phase = view.phase;
  if (phase.type !== 'claim' || view.legal.claims.length === 0) return '';
  const column = (view.discards[phase.discarder].length - 1) % 6;
  const text = t('live.xmj.claimBubble', {
    name: escapeHtml(names[phase.discarder]),
    tile: XMJ_GLYPHS[phase.discard],
  });
  return `<div class="xmj-bubble" role="status" style="--xmj-col:${column}">${text}</div>`;
}

function pondHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  self: boolean,
  names: Readonly<Record<XmjSeat, string>>,
  bubble: string,
): string {
  const tiles = view.discards[seat];
  const marked = lastDiscardSeat(view) === seat;
  const label = self
    ? t('live.xmj.yourDiscards')
    : t('live.xmj.theirDiscards', { name: escapeHtml(names[seat]) });
  const html = tiles
    .map((tile, index) =>
      tileSpan(
        tile,
        marked && index === tiles.length - 1 ? 'xmj-tile--sm xmj-tile--last' : 'xmj-tile--sm',
      ),
    )
    .join('');
  return `<div class="xmj-pond-wrap" data-xmj-pond="${seat}"><div class="xmj-pond-label">${label}</div><div class="xmj-pond">${html}</div>${bubble}</div>`;
}

function seatRowHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const dealer =
    view.dealer === seat
      ? `<span class="xmj-badge xmj-badge--dealer">${t('live.xmj.dealer')}</span>`
      : '';
  const turn =
    view.status.type === 'playing' &&
    !view.between &&
    view.phase.type === 'discard' &&
    view.turn === seat
      ? `<span class="xmj-badge xmj-badge--turn">${t('live.xmj.toDiscard')}</span>`
      : '';
  return `<div class="xmj-seat-row"><span class="xmj-name">${escapeHtml(names[seat])}</span>${dealer}<span class="xmj-points">${t('live.xmj.score', { points: signed(view.scores[seat]) })}</span>${turn}</div>`;
}

function opponentHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const hand = view.hands[seat];
  // Face-down tiles are the size of the viewer's own: the same tiles, turned over.
  const rack =
    hand === null ? backs(view.handCounts[seat]) : hand.map((tile) => tileSpan(tile)).join('');
  return `<section class="xmj-seat xmj-seat--opponent" data-xmj-seat="${seat}">${seatRowHtml(view, seat, names)}<div class="xmj-rack">${rack}${meldsHtml(view.melds[seat])}</div></section>`;
}

function selfHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  you: boolean,
  canAct: boolean,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const hand = view.hands[seat];
  const drawn = view.phase.type === 'discard' && view.turn === seat ? view.phase.drawn : null;
  let rack: string;
  if (hand === null) {
    rack = backs(view.handCounts[seat]);
  } else {
    const legal = new Set(view.legal.discard);
    // The drawn tile sits apart at the right, as it would on a table.
    const rest = [...hand];
    const drawnAt = drawn === null ? -1 : rest.lastIndexOf(drawn);
    if (drawnAt >= 0) rest.splice(drawnAt, 1);
    const draw = (tile: XmjTile, extra = '') =>
      canAct && legal.has(tile) ? tileButton(tile, extra) : tileSpan(tile, extra);
    rack = rest.map((tile) => draw(tile)).join('');
    if (drawn !== null && drawnAt >= 0) rack += draw(drawn, 'xmj-tile--drawn');
  }
  return `<section class="xmj-seat${you ? ' xmj-seat--self' : ''}" data-xmj-seat="${seat}"><div class="xmj-rack">${rack}${meldsHtml(view.melds[seat])}</div>${seatRowHtml(view, seat, names)}</section>`;
}

function claimTiles(claim: XmjClaim, discard: XmjTile): XmjTile[] {
  return xmjSortTiles([...claim.fromHand, discard]);
}

function chips(tiles: readonly XmjTile[], discard: XmjTile): string {
  let marked = false;
  const html = tiles
    .map((tile) => {
      const isDiscard = !marked && tile === discard;
      if (isDiscard) marked = true;
      return tileSpan(tile, isDiscard ? 'xmj-tile--xs xmj-tile--claimed' : 'xmj-tile--xs');
    })
    .join('');
  return `<span class="xmj-chips">${html}</span>`;
}

/** Seconds left, and the bar's share of the span, for one deadline. */
export function xmjCountdown(
  deadline: number,
  spanMs: number,
  now: number,
): { secs: number; width: number } {
  const left = Math.max(0, deadline - now);
  return {
    secs: Math.ceil(left / 1000),
    width: Math.max(0, Math.min(100, (left / spanMs) * 100)),
  };
}

function countdownHtml(label: string, deadline: number, spanMs: number, now: number): string {
  const { secs, width } = xmjCountdown(deadline, spanMs, now);
  return `<div class="xmj-timer-line" data-xmj-deadline="${deadline}" data-xmj-span="${spanMs}"><span class="xmj-timer-label">${label}</span><div class="xmj-timer"><i style="width:${width.toFixed(1)}%"></i></div><span class="xmj-timer-secs" data-xmj-secs>${t('live.xmj.seconds', { count: secs })}</span></div>`;
}

function actionsHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  if (!options.canAct) return '';
  const legal = view.legal;
  const phase = view.phase;
  const spent = options.passQueued === true;
  const disabled = spent ? ' disabled' : '';
  const buttons: string[] = [];
  let timer = '';
  if (phase.type === 'claim' && legal.claims.length > 0) {
    // Win first and widest; then each take, showing the set it completes.
    const ordered = [...legal.claims].sort(
      (a, b) => Number(b.kind === 'win') - Number(a.kind === 'win'),
    );
    for (const claim of ordered) {
      const data = `data-xmj-claim="${claim.kind}" data-xmj-from="${claim.fromHand.join(',')}"`;
      if (claim.kind === 'win') {
        buttons.push(
          `<button type="button" class="xmj-action xmj-action--primary xmj-action--wide" ${data}${disabled}>${t('live.xmj.win')}${chips([phase.discard], phase.discard)}</button>`,
        );
      } else {
        const label = t(claim.kind === 'pung' ? 'live.xmj.takePung' : 'live.xmj.takeChow');
        buttons.push(
          `<button type="button" class="xmj-action" ${data}${disabled}>${label}${chips(claimTiles(claim, phase.discard), phase.discard)}</button>`,
        );
      }
    }
    if (view.windowClosesAt !== null) {
      timer = countdownHtml(
        t('live.xmj.claimPrompt', { tile: XMJ_GLYPHS[phase.discard] }),
        view.windowClosesAt,
        XMJ_CLAIM_WINDOW_MS,
        options.now,
      );
    }
  }
  if (legal.selfDraw) {
    buttons.push(
      `<button type="button" class="xmj-action xmj-action--primary xmj-action--wide" data-xmj-selfdraw>${t('live.xmj.selfDraw')}</button>`,
    );
  }
  if (legal.pass) {
    buttons.push(
      `<button type="button" class="xmj-action" data-xmj-pass${disabled}>${t(spent ? 'live.xmj.passing' : 'live.xmj.pass')}</button>`,
    );
  }
  if (buttons.length === 0) return '';
  return `<div class="xmj-actions">${timer}<div class="xmj-buttons">${buttons.join('')}</div></div>`;
}

function plateHtml(
  view: XmjPlayerView,
  self: XmjSeat,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const phase = view.phase;
  const seated = view.perspective !== 'spectator';
  let message: string;
  if (phase.type === 'claim') {
    const tile = tileSpan(phase.discard, 'xmj-tile--xs');
    message =
      seated && phase.discarder === self
        ? t('live.xmj.waitingOn', { tile, name: escapeHtml(names[other(self)]) })
        : t('live.xmj.discarded', { name: escapeHtml(names[phase.discarder]), tile });
  } else if (seated && view.turn === self) {
    message = view.legal.selfDraw ? t('live.xmj.yourTurnMayWin') : t('live.xmj.yourTurn');
  } else {
    message = t('live.xmj.theirTurn', { name: escapeHtml(names[view.turn]) });
  }
  return `<div class="xmj-plate"><div class="xmj-plate__facts"><span>${t('live.xmj.wall', { count: view.wallCount })}</span></div><p class="xmj-message">${message}</p></div>`;
}

function groupHtml(tiles: readonly XmjTile[], caption: string, winning: XmjTile | null): string {
  let marked = false;
  const html = tiles
    .map((tile) => {
      const win = winning !== null && !marked && tile === winning;
      if (win) marked = true;
      return tileSpan(tile, win ? 'xmj-tile--win' : '');
    })
    .join('');
  return `<div class="xmj-group"><div class="xmj-group__tiles">${html}</div><div class="xmj-group__cap">${caption}</div></div>`;
}

/** The winning hand as the score read it: the set and the pair, or five soldiers. */
function winningHandHtml(score: XmjScore, winning: XmjTile): string {
  const { meld, pair } = score.shape;
  if (score.lines.some((line) => line.key === 'five-soldiers')) {
    return groupHtml([...meld, ...pair], t('live.xmj.fiveSoldiers'), winning);
  }
  // The won tile is outlined once, in a group it belongs to.
  const inMeld = meld.includes(winning);
  return (
    groupHtml(meld, t('live.xmj.set'), inMeld ? winning : null) +
    groupHtml(pair, t('live.xmj.pair'), inMeld ? null : winning)
  );
}

function taiHtml(score: XmjScore): string {
  const lines = score.lines
    .map(
      (line) =>
        `<li><span>${t(`live.xmj.tai.${line.key}` as I18nKey)}</span><span>${t('live.xmj.taiCount', { count: line.tai })}</span></li>`,
    )
    .join('');
  return `<ul class="xmj-tai">${lines}<li class="xmj-tai__total"><span>${t('live.xmj.handTotal')}</span><span>${t('live.xmj.taiCount', { count: score.total })}</span></li></ul>`;
}

function ledgerHtml(view: XmjPlayerView, names: Readonly<Record<XmjSeat, string>>): string {
  const seats: readonly XmjSeat[] = ['east', 'west'];
  const rows = view.results
    .map((result, index) => {
      const winner = result.winner;
      const outcome =
        winner === null
          ? t('live.xmj.resultNone')
          : t(result.selfDrawn ? 'live.xmj.resultSelfDraw' : 'live.xmj.resultDiscard', {
              name: escapeHtml(names[winner]),
            });
      const points = result.score?.total ?? 0;
      const cells = seats
        .map((seat) => {
          const delta = winner === null ? 0 : winner === seat ? points : -points;
          return `<td class="xmj-ledger__n">${signed(delta)}</td>`;
        })
        .join('');
      const now = index === view.results.length - 1 ? ' class="xmj-ledger__now"' : '';
      return `<tr${now}><td>${index + 1}</td><td>${escapeHtml(names[result.dealer])}</td><td>${outcome}</td>${cells}</tr>`;
    })
    .join('');
  const heads = seats
    .map((seat) => `<th class="xmj-ledger__n">${escapeHtml(names[seat])}</th>`)
    .join('');
  const totals = seats
    .map((seat) => `<td class="xmj-ledger__n">${signed(view.scores[seat])}</td>`)
    .join('');
  return `<table class="xmj-ledger"><thead><tr><th>${t('live.xmj.ledgerHand')}</th><th>${t('live.xmj.ledgerDealer')}</th><th>${t('live.xmj.ledgerResult')}</th>${heads}</tr></thead><tbody>${rows}<tr class="xmj-ledger__total"><td colspan="3">${t('live.xmj.ledgerMatch')}</td>${totals}</tr></tbody></table>`;
}

function resultHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const names = options.names;
  const phase = view.phase;
  const hand = Math.max(1, view.results.length);
  let title: string;
  let body = '';
  if (phase.type === 'won') {
    title = t(phase.selfDrawn ? 'live.xmj.wonSelfDraw' : 'live.xmj.wonDiscard', {
      hand,
      name: escapeHtml(names[phase.winner]),
    });
    body = `<div class="xmj-won">${winningHandHtml(phase.score, phase.winningTile)}</div>${taiHtml(phase.score)}`;
  } else {
    title = t('live.xmj.exhausted', { hand });
  }
  let foot: string;
  if (view.status.type !== 'playing') {
    const winner = view.status.type === 'finished' ? view.status.winner : null;
    const line =
      winner === null
        ? t('live.xmj.matchDrawn', {
            east: signed(view.scores.east),
            west: signed(view.scores.west),
          })
        : t('live.xmj.matchWon', {
            name: escapeHtml(names[winner]),
            winner: signed(view.scores[winner]),
            loser: signed(view.scores[other(winner)]),
          });
    foot = `<p class="xmj-note xmj-note--strong">${line}</p>`;
  } else {
    const parts: string[] = [];
    if (view.legal.nextHand && options.canAct) {
      parts.push(
        `<button type="button" class="xmj-action xmj-action--primary" data-xmj-next>${t('live.xmj.nextHand')}</button>`,
      );
    }
    if (view.ready.length > 0) {
      const ready = view.ready.map((seat) => escapeHtml(names[seat])).join(', ');
      parts.push(`<span>${t('live.xmj.readyList', { names: ready })}</span>`);
    }
    if (view.nextHandAt !== null) {
      const secs = Math.max(0, Math.ceil((view.nextHandAt - options.now) / 1000));
      parts.push(
        `<span class="xmj-note" data-xmj-deadline="${view.nextHandAt}" data-xmj-text="nextHandIn">${t('live.xmj.nextHandIn', { count: secs })}</span>`,
      );
    }
    foot = `<div class="xmj-result__foot">${parts.join('')}</div>`;
  }
  return `<div class="xmj-result"><h3 class="xmj-result__title">${title}</h3>${body}${ledgerHtml(view, names)}${foot}</div>`;
}

/** The whole table for one view. */
export function xiangqiMahjongTableHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const you = view.perspective !== 'spectator';
  const self: XmjSeat = view.perspective === 'spectator' ? 'east' : view.perspective;
  const opponent = other(self);
  const names = options.names;
  const handOver = view.between || view.status.type === 'finished';
  const centre = handOver ? resultHtml(view, options) : plateHtml(view, self, names);
  const claimBubble = you ? bubbleHtml(view, names) : '';
  const actions = handOver || !you ? '' : actionsHtml(view, options);
  // Where the match stands, above everything: handsInMatch is the server's
  // min(XMJ_MATCH_HANDS, walls dealt), so a short test match reads true too.
  const handLine = `<p class="xmj-hand-line">${t('live.xmj.handOf', {
    hand: Math.min(view.handNumber, view.handsInMatch),
    hands: view.handsInMatch,
  })}</p>`;
  return `<div class="xmj-table">${handLine}${opponentHtml(view, opponent, names)}${pondHtml(view, opponent, false, names, claimBubble)}${centre}${pondHtml(view, self, you, names, '')}${actions}${selfHtml(view, self, you, options.canAct && you, names)}</div>`;
}
