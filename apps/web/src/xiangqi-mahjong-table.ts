/**
 * The xiangqi mahjong table, as markup (layout "A, the table", recomposed
 * 2026-10-15).
 *
 * One centred column of fixed width: the opponent's seat and rack at the top,
 * then a middle band (the opponent's discards, the centre with the wall and
 * whatever the viewer may do now, the viewer's discards), then the viewer's
 * rack and seat. The middle band keeps its height for the whole match: the
 * ponds reserve two rows, the centre reserves room for the claim buttons, and
 * the result between hands is an overlay on the band, so nothing below moves
 * when a hand ends. The revealed hands turn face up in their own racks.
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
  XMJ_DEALER_TILES,
  XMJ_OTHER_TILES,
  XMJ_SEATS,
  XMJ_TAI_POINTS,
  type XmjClaim,
  type XmjMeld,
  type XmjPlayerView,
  type XmjScore,
  type XmjSeat,
  type XmjTaiKey,
  type XmjTile,
  type XmjViewResult,
  xmjSortTiles,
} from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import type { TenantReasonKey } from './variant-tenant/room-chrome.js';
import { escapeHtml } from './web-utils.js';
import type { XmjLogHand, XmjLogRow } from './xiangqi-mahjong-log.js';
import {
  renderXiangqiPieceMark,
  type XiangqiPieceSet,
  xiangqiTileBacking,
  xiangqiTileFaceHref,
} from './xiangqi-piece-sets.js';

export interface XmjTableOptions {
  /** The room's "may act now": live, seated, and something on offer. */
  readonly canAct: boolean;
  /** What to call each seat: "You", the opponent's handle, "Bot". */
  readonly names: Readonly<Record<XmjSeat, string>>;
  /** The server's clock, as well as the client knows it. */
  readonly now: number;
  /** A pass is waiting for the pause to end; the buttons are spent. */
  readonly passQueued?: boolean;
  /** The viewer's xiangqi piece set; each tile draws its piece in it. */
  readonly pieceSet?: XiangqiPieceSet;
  /** The tile look (`?tiles=`). */
  readonly tileLook?: XmjTileLook;
  /**
   * A discard tapped while a self-drawn win is on offer: it stands raised and
   * waits for a second tap, so a slip cannot throw the win away. `drawn` says
   * whether it was the drawn tile or a copy in the hand.
   */
  readonly armedDiscard?: { readonly tile: XmjTile; readonly drawn: boolean } | null;
}

/** The wall at the deal: 32 tiles less both hands. */
const XMJ_WALL_AT_DEAL = 32 - XMJ_DEALER_TILES - XMJ_OTHER_TILES;
/** Discards per pond row. Two rows hold any seat's discards in a hand. */
export const XMJ_POND_COLUMNS = 8;
/** The rules section that explains each scoring line. */
export const XMJ_SCORING_HREF = '/rules/xiangqi-mahjong-32#adding-it-up';

// The piece set for the render in progress. The table is one synchronous
// string render, so xiangqiMahjongTableHtml sets it and restores it after.
let activePieceSet: XiangqiPieceSet = 'international';
let activeTileLook: XmjTileLook = 'jade';

const XMJ_ROLES = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  H: 'horse',
  C: 'cannon',
  P: 'soldier',
} as const;

function tilePieceOf(tile: XmjTile) {
  return {
    color: tileColor(tile) === 'r' ? ('red' as const) : ('black' as const),
    role: XMJ_ROLES[tilePiece(tile)],
  };
}

// The piece's figure or character with no disc: the tile is the frame.
function tileArt(tile: XmjTile): string {
  const piece = tilePieceOf(tile);
  return `<svg class="xmj-tile-art" viewBox="0 0 100 100" aria-hidden="true">${renderXiangqiPieceMark(piece, activePieceSet)}</svg>`;
}

// The set's own tile body (its band, its backs, the wall) as the jade custom
// properties, so every rule drawn in jade follows it; empty for Mistboard's sets.
function backingVars(): string {
  const backing = xiangqiTileBacking(activePieceSet);
  if (!backing) return '';
  const [high, mid, low] = backing;
  return `--xmj-jade-high:${high};--xmj-jade:${mid};--xmj-jade-low:${low};`;
}

// A third-party set's disc surface laid over the whole face (lacquer, grain,
// paper), edge to edge in every look, on the set's own body.
function tileFaceStyle(tile: XmjTile): string {
  const href = xiangqiTileFaceHref(activePieceSet, tilePieceOf(tile).color);
  return href ? ` style="background-image:url('${href}');${backingVars()}"` : '';
}

/** The felts the table can be laid on (`?felt=`); green is the default. */
export const XMJ_FELTS = ['green', 'wood', 'slate', 'site'] as const;
export type XmjFelt = (typeof XMJ_FELTS)[number];

export function xmjFeltFromSearch(search: string): XmjFelt {
  const felt = new URLSearchParams(search).get('felt') ?? '';
  return (XMJ_FELTS as readonly string[]).includes(felt) ? (felt as XmjFelt) : 'green';
}

/**
 * The tile looks (`?tiles=`): ivory on jade by default; a thin printed card;
 * ivory on bamboo.
 */
export const XMJ_TILE_LOOKS = ['jade', 'card', 'bamboo'] as const;
export type XmjTileLook = (typeof XMJ_TILE_LOOKS)[number];

export function xmjTileLookFromSearch(search: string): XmjTileLook {
  const look = new URLSearchParams(search).get('tiles') ?? '';
  return (XMJ_TILE_LOOKS as readonly string[]).includes(look) ? (look as XmjTileLook) : 'jade';
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

/** "1 point", "5 points"; the zh catalogs count in 台. */
export function xmjPoints(count: number): string {
  return count === 1 ? t('live.xmj.onePoint') : t('live.xmj.points', { count });
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

// ── Tiles ────────────────────────────────────────────────────────────────────

function tileClass(tile: XmjTile, extra = ''): string {
  const ink = tileColor(tile) === 'r' ? 'xmj-tile--red' : 'xmj-tile--black';
  const faced = tileFaceStyle(tile) ? ' xmj-tile--faced' : '';
  return `xmj-tile ${ink}${faced}${extra ? ` ${extra}` : ''}`;
}

function tileSpan(tile: XmjTile, extra = '', label = xmjTileName(tile), tip = false): string {
  const title = tip ? ` title="${label}"` : '';
  return `<span class="${tileClass(tile, extra)}"${tileFaceStyle(tile)} role="img" aria-label="${label}"${title}>${tileArt(tile)}</span>`;
}

function tileButton(tile: XmjTile, extra = '', armed = false): string {
  if (armed) extra = extra ? `${extra} xmj-tile--armed` : 'xmj-tile--armed';
  const cls = tileClass(tile, `xmj-tile--button${extra ? ` ${extra}` : ''}`);
  const label = t('live.xmj.discardTile', { tile: xmjTileName(tile) });
  return `<button type="button" class="${cls}"${tileFaceStyle(tile)} data-xmj-tile="${tile}" aria-label="${label}">${tileArt(tile)}</button>`;
}

function back(extra = ''): string {
  const vars = backingVars();
  return `<span class="xmj-tile xmj-tile--back${extra ? ` ${extra}` : ''}"${vars ? ` style="${vars}"` : ''} aria-hidden="true"></span>`;
}

/**
 * The sets made by claiming a discard: face up for both players, so each sits
 * on its own tray with a caption saying so, apart from the hand. The claimed
 * tile lies sideways, as at a mahjong table; in a set of three Soldiers only
 * one of them does.
 */
/** The claimed tile in a set: marked for the fly-in, and lying sideways. */
const CLAIMED_TILE_CLASS = 'xmj-tile--claimed xmj-tile--sideways';

function meldsHtml(melds: readonly XmjMeld[]): string {
  if (melds.length === 0) return '';
  const caption = t('live.xmj.meldShown');
  const title = t('live.xmj.meldShownTitle');
  const html = melds
    .map((meld) => {
      const turned = meld.claimed ? meld.tiles.indexOf(meld.claimed) : -1;
      const tiles = meld.tiles
        .map((tile, i) => tileSpan(tile, i === turned ? CLAIMED_TILE_CLASS : ''))
        .join('');
      return `<span class="xmj-meld" title="${title}"><span class="xmj-meld__tiles">${tiles}</span><span class="xmj-meld__cap">${caption}</span></span>`;
    })
    .join('');
  return `<span class="xmj-melds">${html}</span>`;
}

/**
 * Whether a seat holds a tile it just drew. Public: everyone saw the draw,
 * only the drawer knows which tile. The dealer's opening turn has no draw.
 */
function seatJustDrew(view: XmjPlayerView, seat: XmjSeat): boolean {
  const phase = view.phase;
  if (view.between || phase.type !== 'discard' || view.turn !== seat) return false;
  if (phase.drawn !== null) return true;
  return phase.mayWin && view.wallCount < XMJ_WALL_AT_DEAL;
}

// ── Seats ────────────────────────────────────────────────────────────────────

/**
 * A seat's two badges, either side of its hand: the dealer on the left, the
 * seat to discard on the right. Names sit outside the felt (the room's clock
 * column, the homepage viewer's seat rows), as every other variant's board.
 */
function rackHtml(view: XmjPlayerView, seat: XmjSeat, concealed: string): string {
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
  return `<div class="xmj-rack"><span class="xmj-rack__tag xmj-rack__tag--start">${dealer}</span><span class="xmj-rack__hand"><span class="xmj-concealed">${concealed}</span>${meldsHtml(view.melds[seat])}</span><span class="xmj-rack__tag xmj-rack__tag--end">${turn}</span></div>`;
}

function opponentHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const hand = view.hands[seat];
  let concealed: string;
  if (hand === null) {
    // Face-down tiles are the size of the viewer's own: the same tiles, turned
    // over. A tile just drawn stands apart, as the viewer's own does.
    const count = view.handCounts[seat];
    const drew = seatJustDrew(view, seat) && count > 0;
    concealed =
      Array.from({ length: drew ? count - 1 : count }, () => back()).join('') +
      (drew ? back('xmj-tile--drawn') : '');
  } else {
    // A revealed hand (a finished match's review) sets its drawn tile apart too.
    const drawn =
      seatJustDrew(view, seat) && view.phase.type === 'discard' ? view.phase.drawn : null;
    const rest = [...hand];
    const drawnAt = drawn === null ? -1 : rest.lastIndexOf(drawn);
    if (drawnAt >= 0) rest.splice(drawnAt, 1);
    concealed =
      rest.map((tile) => tileSpan(tile)).join('') +
      (drawn !== null && drawnAt >= 0 ? tileSpan(drawn, 'xmj-tile--drawn') : '');
  }
  return `<section class="xmj-seat xmj-seat--opponent" data-xmj-seat="${seat}" aria-label="${escapeHtml(names[seat])}">${rackHtml(view, seat, concealed)}</section>`;
}

function selfHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  you: boolean,
  canAct: boolean,
  names: Readonly<Record<XmjSeat, string>>,
  armed: XmjTableOptions['armedDiscard'] = null,
): string {
  const hand = view.hands[seat];
  const drawn = view.phase.type === 'discard' && view.turn === seat ? view.phase.drawn : null;
  let concealed: string;
  if (hand === null) {
    concealed = Array.from({ length: view.handCounts[seat] }, () => back()).join('');
  } else {
    const legal = new Set(view.legal.discard);
    // The drawn tile sits apart at the right, as it would on a table.
    const rest = [...hand];
    const drawnAt = drawn === null ? -1 : rest.lastIndexOf(drawn);
    if (drawnAt >= 0) rest.splice(drawnAt, 1);
    // One copy is raised when armed: the drawn tile, or the first in the hand.
    let armedLeft = armed !== null && !armed.drawn;
    const draw = (tile: XmjTile, extra = '', fromDraw = false) => {
      if (!(canAct && legal.has(tile))) return tileSpan(tile, extra);
      let raise = false;
      if (armed?.tile === tile && armed.drawn === fromDraw && (fromDraw || armedLeft)) {
        raise = true;
        if (!fromDraw) armedLeft = false;
      }
      return tileButton(tile, extra, raise);
    };
    concealed = rest.map((tile) => draw(tile)).join('');
    if (drawn !== null && drawnAt >= 0) concealed += draw(drawn, 'xmj-tile--drawn', true);
  }
  return `<section class="xmj-seat xmj-seat--self${you ? ' xmj-seat--you' : ''}" data-xmj-seat="${seat}" aria-label="${escapeHtml(names[seat])}">${rackHtml(view, seat, concealed)}</section>`;
}

// ── Ponds ────────────────────────────────────────────────────────────────────

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
  // The raw index too: a phone lays the pond out twelve wide (xiangqi-mahjong.css).
  const index = view.discards[phase.discarder].length - 1;
  const column = index % XMJ_POND_COLUMNS;
  const text = t('live.xmj.claimBubble', {
    name: escapeHtml(names[phase.discarder]),
    tile: xmjTileName(phase.discard),
  });
  return `<div class="xmj-bubble" role="status" style="--xmj-col:${column};--xmj-i:${index}">${text}</div>`;
}

function pondHtml(
  view: XmjPlayerView,
  seat: XmjSeat,
  self: boolean,
  names: Readonly<Record<XmjSeat, string>>,
  bubble: string,
): string {
  const tiles = view.discards[seat];
  const fromDraw = view.drawnDiscards[seat];
  const marked = lastDiscardSeat(view) === seat;
  const label = self
    ? t('live.xmj.yourDiscards')
    : t('live.xmj.theirDiscards', { name: escapeHtml(names[seat]) });
  const html = tiles
    .map((tile, index) => {
      const classes = ['xmj-tile--sm'];
      if (marked && index === tiles.length - 1) classes.push('xmj-tile--last');
      // Discarded straight after drawing it: dimmed (the Tenhou convention), and
      // said in words on hover and to a screen reader.
      const drew = fromDraw[index] === true;
      if (drew) classes.push('xmj-tile--fromdraw');
      const name = xmjTileName(tile);
      return tileSpan(
        tile,
        classes.join(' '),
        drew ? t('live.xmj.drawnDiscard', { tile: name }) : name,
        drew,
      );
    })
    .join('');
  return `<div class="xmj-pond-wrap" data-xmj-pond="${seat}"><div class="xmj-pond" role="group" aria-label="${label}">${html}</div>${bubble}</div>`;
}

// ── The centre: wall, status and actions ─────────────────────────────────────

/**
 * The wall as tile backs, stacked two high, drawn from the left end. Each
 * stack keeps its place as the wall shrinks, so the wall shortens from one
 * end and nothing beside it moves.
 */
function wallHtml(count: number): string {
  const stacks = Math.ceil(XMJ_WALL_AT_DEAL / 2);
  const left = Math.max(0, Math.min(XMJ_WALL_AT_DEAL, count));
  const html: string[] = [];
  const vars = backingVars();
  const stackStyle = vars ? ` style="${vars}"` : '';
  // The last stack of an odd wall is a single tile; draws take from the left.
  for (let index = 0; index < stacks; index += 1) {
    const fromRight = stacks - 1 - index;
    const height = Math.max(0, Math.min(2, left - fromRight * 2));
    html.push(
      `<span class="xmj-stack" data-h="${height}"${stackStyle}>${height > 0 ? '<i></i>'.repeat(height) : ''}</span>`,
    );
  }
  const label = t('live.xmj.wall', { count: left });
  return `<div class="xmj-wall" role="img" aria-label="${label}"><span class="xmj-wall__stacks" aria-hidden="true">${html.join('')}</span><span class="xmj-wall__count" aria-hidden="true">${label}</span></div>`;
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
      return tileSpan(tile, isDiscard ? `xmj-tile--xs ${CLAIMED_TILE_CLASS}` : 'xmj-tile--xs');
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
    // No countdown: the decision runs on the claimant's own clock.
    timer = `<p class="xmj-actions__hint">${t('live.xmj.claimPrompt', { tile: xmjTileName(phase.discard) })}</p>`;
  }
  if (legal.selfDraw) {
    buttons.push(
      `<button type="button" class="xmj-action xmj-action--primary xmj-action--wide" data-xmj-selfdraw>${t('live.xmj.selfDraw')}</button>`,
    );
    const armed = options.armedDiscard;
    timer = `<p class="xmj-actions__hint">${
      armed
        ? t('live.xmj.confirmDiscard', { tile: xmjTileName(armed.tile) })
        : t('live.xmj.yourTurnMayWin')
    }</p>`;
  }
  if (legal.pass) {
    buttons.push(
      `<button type="button" class="xmj-action" data-xmj-pass${disabled}>${t(spent ? 'live.xmj.passing' : 'live.xmj.pass')}</button>`,
    );
  }
  if (buttons.length === 0) return '';
  return `<div class="xmj-actions">${timer}<div class="xmj-buttons">${buttons.join('')}</div></div>`;
}

function messageHtml(
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
  return `<p class="xmj-message">${message}</p>`;
}

function centreHtml(
  view: XmjPlayerView,
  self: XmjSeat,
  options: XmjTableOptions,
  handOver: boolean,
): string {
  // Where the match stands: handsInMatch is the server's
  // min(XMJ_MATCH_HANDS, walls dealt), so a short test match reads true too.
  const handLine = `<span class="xmj-hand-line">${t('live.xmj.handOf', {
    hand: Math.min(view.handNumber, view.handsInMatch),
    hands: view.handsInMatch,
  })}</span>`;
  const you = view.perspective !== 'spectator';
  const actions = handOver || !you ? '' : actionsHtml(view, options);
  // Between hands the result covers the centre; an empty line the height of a
  // message (one with a tile in it) keeps the table from shrinking under it.
  const status = handOver
    ? `<p class="xmj-message xmj-message--held" aria-hidden="true"><span class="xmj-message__strut"></span></p>`
    : actions || messageHtml(view, self, options.names);
  return `<div class="xmj-centre"><div class="xmj-centre__facts">${handLine}${wallHtml(view.wallCount)}</div><div class="xmj-centre__status">${status}</div></div>`;
}

// ── The result, between hands ────────────────────────────────────────────────

/** One group of the winning hand, at the hand's own size; the won tile stands raised. */
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

/**
 * The panel's rows: the rules page's lines, with the two 之才 lines and the
 * five three-of-a-piece lines each sharing a row, so the table stays two
 * columns of five. A hand can score at most one line of a shared row.
 */
const PANEL_ROWS: readonly (readonly [I18nKey, readonly XmjTaiKey[]])[] = [
  ['live.xmj.tai.win', ['win']],
  ['live.xmj.tai.one-colour', ['one-colour']],
  ['live.xmj.tai.one-general', ['black-general', 'red-general']],
  ['live.xmj.tai.generals-pair', ['generals-pair']],
  [
    'live.xmj.tai.three-of',
    ['three-advisors', 'three-elephants', 'three-chariots', 'three-horses', 'three-cannons'],
  ],
  ['live.xmj.tai.mixed-soldiers', ['mixed-soldiers']],
  ['live.xmj.tai.five-soldiers', ['five-soldiers']],
  ['live.xmj.tai.self-draw', ['self-draw']],
  ['live.xmj.tai.last-tile', ['last-tile']],
  ['live.xmj.tai.heavenly', ['heavenly']],
];

/**
 * The rules page's scoring table, all of it, with the lines this hand scored
 * lit and the rest left dim: the reader learns the table by seeing which rows
 * a real hand hits. Same order and wording as "Adding it up", which the "?"
 * opens. The total is the big number in the head, so it is not said again. A
 * game scored on the old table (`XmjTaiTable` 1) also lists the 莊家 or 地胡
 * line it scored.
 */
function scoringHtml(score: XmjScore): string {
  const scored = new Map(score.lines.map((line) => [line.key, line.tai]));
  const row = (label: I18nKey, keys: readonly XmjTaiKey[]) => {
    const hit = keys.find((key) => scored.has(key));
    const key = hit ?? (keys[0] as XmjTaiKey);
    const points = XMJ_TAI_POINTS[key];
    // A line that is the whole score (the win, the special hands) is a flat
    // number; the rest add to it.
    const flat = key === 'win' || key === 'heavenly' || key === 'earthly';
    const name = t(hit && keys.length > 1 ? (`live.xmj.tai.${hit}` as I18nKey) : label);
    const mark = hit ? `<span class="xmj-sr">${t('live.xmj.taiScored')}</span>` : '';
    return `<li${hit ? ' class="xmj-line--on"' : ''}><span>${name}${mark}</span><b>${flat ? points : `+${points}`}</b></li>`;
  };
  const listed = new Set(PANEL_ROWS.flatMap(([, keys]) => keys));
  const rows = [
    ...PANEL_ROWS.map(([label, keys]) => row(label, keys)),
    ...XMJ_TAI_ORDER_LEGACY.filter((key) => scored.has(key) && !listed.has(key)).map((key) =>
      row(`live.xmj.tai.${key}` as I18nKey, [key]),
    ),
  ].join('');
  const how = t('live.xmj.howScoring');
  const link = `<a class="xmj-result__how" href="${localizedHref(XMJ_SCORING_HREF)}" title="${how}" aria-label="${how}">?</a>`;
  return `<div class="xmj-scoring"><ol class="xmj-lines" aria-label="${t('live.xmj.taiTable')}">${rows}</ol>${link}</div>`;
}

/** Table 1's lines that table 2 dropped, for a game scored before the change. */
const XMJ_TAI_ORDER_LEGACY: readonly XmjTaiKey[] = ['dealer', 'earthly'];

function outcomeText(result: XmjViewResult, names: Readonly<Record<XmjSeat, string>>): string {
  if (result.winner === null) return t('live.xmj.resultNone');
  return t(result.selfDrawn ? 'live.xmj.resultSelfDraw' : 'live.xmj.resultDiscard', {
    name: escapeHtml(names[result.winner]),
  });
}

/**
 * The match's points by hand for the room's meta card: a column per hand of the
 * match, a row per seat in the card's player order, the hand in play marked and
 * unplayed hands a dot. Points only accumulate, so a won hand gives its winner
 * the hand's points and the other player nothing; the total is the match score.
 */
export function xmjHandsTableHtml(
  view: XmjPlayerView,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const hands = Math.max(view.handsInMatch, view.results.length);
  const live = view.status.type === 'playing' && !view.between;
  const now = live ? view.handNumber - 1 : -1;
  const heads = Array.from({ length: hands }, (_, index) => {
    const cls = index === now ? ' class="xmj-hands__now"' : '';
    return `<th scope="col"${cls} title="${t('live.xmj.log.hand', { hand: index + 1 })}">${index + 1}</th>`;
  }).join('');
  const rows = XMJ_SEATS.map((seat) => {
    const cells = Array.from({ length: hands }, (_, index) => {
      const result = view.results[index];
      const classes: string[] = [];
      if (index === now) classes.push('xmj-hands__now');
      // A hand not yet played is a blank cell, like an unplayed frame on a
      // scoreboard; a void hand still shows its zeros.
      let text = '';
      if (result) {
        const won = result.winner === seat;
        text = String(won ? (result.score?.total ?? 0) : 0);
        if (won) classes.push('xmj-hands__win');
      }
      const cls = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
      return `<td${cls}>${text}</td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(names[seat])}</th>${cells}<td class="xmj-hands__total">${view.scores[seat]}</td></tr>`;
  }).join('');
  return `<table class="xmj-hands" aria-label="${t('live.xmj.handsTable')}"><thead><tr><td class="xmj-hands__corner"></td>${heads}<th scope="col" class="xmj-hands__total">${t('live.xmj.handsTotal')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The one sentence the result leads with, for a screen reader and the log. */
export function xmjResultTitle(
  view: XmjPlayerView,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const phase = view.phase;
  // The hand in play, not the count of finished ones: a match lost on time in
  // hand 3 has two results and names hand 3.
  const hand = view.handNumber;
  if (phase.type === 'won') {
    const you = view.perspective === phase.winner;
    const key = phase.selfDrawn
      ? you
        ? 'live.xmj.youWonSelfDraw'
        : 'live.xmj.nameWonSelfDraw'
      : you
        ? 'live.xmj.youWonDiscard'
        : 'live.xmj.nameWonDiscard';
    return t(key, {
      hand,
      name: escapeHtml(names[phase.winner]),
      points: xmjPoints(phase.score.total),
    });
  }
  if (phase.type === 'exhausted') return t('live.xmj.exhausted', { hand });
  // The match ended mid-hand (resignation, timeout): how it ended is the news,
  // and the head's small line names the hand.
  if (view.status.type === 'finished') {
    return xmjResultLine(view.status.winner, view.status.reason, view.perspective, (seat) =>
      escapeHtml(names[seat]),
    );
  }
  return xmjHandEnded(view);
}

/**
 * The result's head: who won and how on the left, the hand's points large on
 * the right. A hand nobody won is its one sentence.
 */
function resultHeadHtml(
  view: XmjPlayerView,
  names: Readonly<Record<XmjSeat, string>>,
  title: string,
): string {
  const phase = view.phase;
  if (phase.type === 'exhausted') {
    return `<div class="xmj-result__head"><h3 class="xmj-result__title">${title}</h3></div>`;
  }
  if (phase.type !== 'won') {
    return `<div class="xmj-result__head"><div><h3 class="xmj-result__title">${title}</h3><p class="xmj-result__sub">${xmjHandEnded(view)}</p></div></div>`;
  }
  const you = view.perspective === phase.winner;
  const who = you
    ? t('live.xmj.youWinHand')
    : t('live.xmj.nameWinsHand', { name: escapeHtml(names[phase.winner]) });
  const how = t(phase.selfDrawn ? 'live.xmj.handSelfDraw' : 'live.xmj.handDiscard', {
    hand: view.handNumber,
    hands: Math.max(view.handsInMatch, view.handNumber),
  });
  const total = phase.score.total;
  const unit = t(total === 1 ? 'live.xmj.pointUnit' : 'live.xmj.pointsUnit');
  const tone = you
    ? ' xmj-result--yours'
    : view.perspective === 'spectator'
      ? ''
      : ' xmj-result--theirs';
  return `<div class="xmj-result__head${tone}"><div><h3 class="xmj-result__title">${who}</h3><p class="xmj-result__sub">${how}</p></div><p class="xmj-result__total"><b>${total}</b><span>${unit}</span></p></div>`;
}

/** "Ended during hand 3 of 6": the hand a match stopped in mid-play. */
function xmjHandEnded(view: XmjPlayerView): string {
  return t('live.xmj.handUnfinished', {
    hand: view.handNumber,
    hands: Math.max(view.handsInMatch, view.handNumber),
  });
}

/** Finished reasons the match score decides; any other names how it ended. */
const ON_POINTS: ReadonlySet<string> = new Set(['points', 'tie']);

function resultHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const names = options.names;
  const phase = view.phase;
  const title = xmjResultTitle(view, names);
  const body =
    phase.type === 'won'
      ? `<div class="xmj-won">${winningHandHtml(phase.score, phase.winningTile)}</div>${scoringHtml(phase.score)}`
      : '';
  let foot: string;
  if (phase.type !== 'won' && phase.type !== 'exhausted' && view.status.type === 'finished') {
    // Ended mid-hand: the head already says how, and which hand.
    foot = '';
  } else if (view.status.type === 'finished' && !ON_POINTS.has(view.status.reason)) {
    // Ended by the clock, a resignation or abandonment: the score says nothing
    // about why (often +0 to +0), so the line names how instead.
    const line = xmjResultLine(view.status.winner, view.status.reason, view.perspective, (seat) =>
      escapeHtml(names[seat]),
    );
    foot = `<div class="xmj-result__foot"><p class="xmj-note xmj-note--strong">${line}.</p></div>`;
  } else if (view.status.type !== 'playing') {
    const winner = view.status.type === 'finished' ? view.status.winner : null;
    const line =
      winner === null
        ? t('live.xmj.matchDrawn', { points: view.scores.east })
        : t('live.xmj.matchWon', {
            name: escapeHtml(names[winner]),
            winner: view.scores[winner],
            loser: view.scores[other(winner)],
          });
    foot = `<div class="xmj-result__foot"><p class="xmj-note xmj-note--strong">${line}</p></div>`;
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
  // A hand nobody won is a sentence and how it ended: a small card over the
  // centre, the discards left in view, rather than a panel over the band.
  const brief = phase.type === 'won' ? '' : ' xmj-result--brief';
  return `<div class="xmj-result${brief}" role="region" aria-label="${title}">${resultHeadHtml(view, names, title)}${body}${foot}</div>`;
}

// ── The table ────────────────────────────────────────────────────────────────

/** The whole table for one view. */
export function xiangqiMahjongTableHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const previous = [activePieceSet, activeTileLook] as const;
  activePieceSet = options.pieceSet ?? 'international';
  activeTileLook = options.tileLook ?? 'jade';
  try {
    return tableHtml(view, options);
  } finally {
    [activePieceSet, activeTileLook] = previous;
  }
}

function tableHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const you = view.perspective !== 'spectator';
  const self: XmjSeat = view.perspective === 'spectator' ? 'east' : view.perspective;
  const opponent = other(self);
  const names = options.names;
  const handOver = view.between || view.status.type === 'finished';
  const claimBubble = you && !handOver ? bubbleHtml(view, names) : '';
  const result = handOver ? resultHtml(view, options) : '';
  const band = handOver
    ? view.phase.type === 'won'
      ? ' xmj-middle--result'
      : ' xmj-middle--result xmj-middle--brief'
    : '';
  const middle = `<div class="xmj-middle${band}">${pondHtml(view, opponent, false, names, claimBubble)}${centreHtml(view, self, options, handOver)}${pondHtml(view, self, you, names, '')}${result}</div>`;
  return `<div class="xmj-table">${opponentHtml(view, opponent, names)}${middle}${selfHtml(view, self, you, options.canAct && you, names, options.armedDiscard ?? null)}</div>`;
}

// ── The move log, one hand at a time ─────────────────────────────────────────

export interface XmjLogOptions {
  readonly names: Readonly<Record<XmjSeat, string>>;
  /** The viewer's seat, worded "You"; a spectator has none. */
  readonly viewer: XmjSeat | null;
  /** Each finished hand's result, from the live view. */
  readonly results: readonly XmjViewResult[];
  /** The ply on show while scrubbing, or null when live. */
  readonly activePly: number | null;
  /** Hands the reader opened. */
  readonly expanded: ReadonlySet<number>;
  /** Hands the reader closed, the latest or the one holding the scrubbed ply included. */
  readonly collapsed?: ReadonlySet<number>;
  /** Whether a row's ply can be shown (the client holds that snapshot). */
  readonly hasPly: (ply: number) => boolean;
  readonly pieceSet?: XiangqiPieceSet;
  readonly tileLook?: XmjTileLook;
}

/** A row's words; the tile, when the row has one, is set apart by logRowHtml. */
function logRowText(row: XmjLogRow, options: XmjLogOptions): string {
  const you = 'seat' in row && row.seat === options.viewer;
  const name = 'seat' in row ? escapeHtml(options.names[row.seat]) : '';
  switch (row.kind) {
    case 'discard':
      if (row.drew) {
        return you
          ? t('live.xmj.log.youDrawDiscard')
          : t('live.xmj.log.nameDrawsDiscards', { name });
      }
      return you ? t('live.xmj.log.youDiscard') : t('live.xmj.log.nameDiscards', { name });
    case 'claim':
      if (row.claim === 'chow') {
        return you
          ? t('live.xmj.log.youClaimSequence')
          : t('live.xmj.log.nameClaimsSequence', { name });
      }
      return you
        ? t('live.xmj.log.youClaimTriplet')
        : t('live.xmj.log.nameClaimsTriplet', { name });
    case 'win':
      return you ? t('live.xmj.log.youWinOn') : t('live.xmj.log.nameWinsOn', { name });
    case 'self-draw':
      return you ? t('live.xmj.log.youWinSelfDraw') : t('live.xmj.log.nameWinsSelfDraw', { name });
    case 'exhausted':
      return t('live.xmj.log.wallEmpty');
  }
}

/**
 * The words on the left, the tile in a fixed column on the right, every row
 * alike (the win included), so the tiles read down the hand as one column.
 */
function logRowHtml(row: XmjLogRow, options: XmjLogOptions, winningTile: XmjTile | null): string {
  const words = `<span class="xmj-log__text">${logRowText(row, options)}</span>`;
  // A self-drawn win's tile is public once the hand is over; the hand's result
  // carries it, since the move itself never named the drawn tile.
  const shown = row.kind === 'self-draw' ? winningTile : row.kind === 'exhausted' ? null : row.tile;
  const tile = shown ? tileSpan(shown, 'xmj-tile--xs') : '';
  return `${words}<span class="xmj-log__tile">${tile}</span>`;
}

/**
 * Move numbers within a hand, chess style: a turn is a seat's rows in a row (a
 * claim and the discard after it are one turn), turns alternate from the
 * dealer, and each dealer turn plus the reply is one numbered move. The number
 * sits on the first row of the dealer's turn; every other row keeps the
 * column empty so the tiles stay aligned.
 */
function logMoveNumbers(rows: readonly XmjLogRow[]): (number | null)[] {
  let turn = -1;
  let last: XmjSeat | null = null;
  return rows.map((row) => {
    if (!('seat' in row) || row.seat === last) return null;
    last = row.seat;
    turn += 1;
    return turn % 2 === 0 ? turn / 2 + 1 : null;
  });
}

function logRowsHtml(hand: XmjLogHand, options: XmjLogOptions, activeRow: number | null): string {
  const numbers = logMoveNumbers(hand.rows);
  return hand.rows
    .map((row, index) => {
      const active = activeRow === row.ply;
      const ends = row.kind === 'win' || row.kind === 'self-draw' || row.kind === 'exhausted';
      // A seated reader's own turns read at full strength, the other player's
      // a step back, so the two hands alternate at a glance without colours.
      const theirs = options.viewer !== null && 'seat' in row && row.seat !== options.viewer;
      const cls = `xmj-log__row${active ? ' active' : ''}${ends ? ' xmj-log__row--end' : ''}${theirs ? ' xmj-log__row--theirs' : ''}`;
      const number = numbers[index];
      const text = `<span class="xmj-log__num">${number === null || number === undefined ? '' : `${number}.`}</span>${logRowHtml(row, options, options.results[hand.hand - 1]?.winningTile ?? null)}`;
      // A row is a jump only when this client holds that position.
      return options.hasPly(row.ply)
        ? `<li><button type="button" class="${cls} move-jump" data-xmj-ply="${row.ply}">${text}</button></li>`
        : `<li><span class="${cls}">${text}</span></li>`;
    })
    .join('');
}

function logSummary(hand: XmjLogHand, options: XmjLogOptions): string {
  const result = options.results[hand.hand - 1];
  const parts = [t('live.xmj.log.hand', { hand: hand.hand })];
  if (result) {
    parts.push(outcomeText(result, options.names));
    if (result.winner !== null && result.score) parts.push(xmjPoints(result.score.total));
  }
  return parts.map((part) => `<span>${part}</span>`).join('');
}

/**
 * The row a scrubbed position belongs to: the last shown row at or before it.
 * Passes and the steps between hands have no row, so stepping onto one keeps
 * the move before it lit instead of lighting nothing.
 */
function activeRowPly(hands: readonly XmjLogHand[], activePly: number | null): number | null {
  if (activePly === null) return null;
  let found: number | null = null;
  for (const hand of hands) {
    for (const row of hand.rows) {
      if (row.ply > activePly) return found;
      found = row.ply;
    }
  }
  return found;
}

/**
 * A click on a hand's heading: flip it from what the reader saw. A hand open
 * by default (the latest, or the one holding the scrubbed ply) closes through
 * `collapsed`; any other opens through `expanded`.
 */
export function toggleXmjLogHand(
  hand: number,
  wasOpen: boolean,
  expanded: Set<number>,
  collapsed: Set<number>,
): void {
  if (wasOpen) {
    expanded.delete(hand);
    collapsed.add(hand);
  } else {
    collapsed.delete(hand);
    expanded.add(hand);
  }
}

/**
 * The log: the latest hand in full, each earlier hand one line that opens.
 * A hand holding the scrubbed ply opens by itself, so the highlight shows.
 * Every heading folds, the latest hand's too.
 */
export function xmjLogHtml(hands: readonly XmjLogHand[], options: XmjLogOptions): string {
  const activeRow = activeRowPly(hands, options.activePly);
  const previous = [activePieceSet, activeTileLook] as const;
  activePieceSet = options.pieceSet ?? 'international';
  activeTileLook = options.tileLook ?? 'jade';
  try {
    return hands
      .map((hand, index) => {
        const latest = index === hands.length - 1;
        const holdsActive = hand.rows.some((row) => row.ply === activeRow);
        const open =
          !options.collapsed?.has(hand.hand) &&
          (latest || holdsActive || options.expanded.has(hand.hand));
        const summary = logSummary(hand, options);
        const head = `<button type="button" class="xmj-log__head xmj-log__toggle" data-xmj-hand="${hand.hand}" aria-expanded="${open}">${summary}</button>`;
        const rows = open
          ? `<ol class="xmj-log__rows">${logRowsHtml(hand, options, activeRow)}</ol>`
          : '';
        return `<li class="xmj-log__hand${open ? ' xmj-log__hand--open' : ''}">${head}${rows}</li>`;
      })
      .join('');
  } finally {
    [activePieceSet, activeTileLook] = previous;
  }
}
