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
  XMJ_CLAIM_WINDOW_MS,
  XMJ_DEALER_TILES,
  XMJ_OTHER_TILES,
  type XmjClaim,
  type XmjMeld,
  type XmjPlayerView,
  type XmjScore,
  type XmjSeat,
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
export const XMJ_SCORING_HREF = '/rules/xiangqi-mahjong-32#winning-hands-and-their-score';

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

// A real minus sign (U+2212), not the hyphen: it is as wide as the plus, so a
// column of scores lines up, and the seat rows and the ledger read the same.
export function signed(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${-points}`;
  return '0';
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
    concealed = hand.map((tile) => tileSpan(tile)).join('');
  }
  return `<section class="xmj-seat xmj-seat--opponent" data-xmj-seat="${seat}">${seatRowHtml(view, seat, names)}<div class="xmj-rack"><span class="xmj-concealed">${concealed}</span>${meldsHtml(view.melds[seat])}</div></section>`;
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
  return `<section class="xmj-seat xmj-seat--self${you ? ' xmj-seat--you' : ''}" data-xmj-seat="${seat}"><div class="xmj-rack"><span class="xmj-concealed">${concealed}</span>${meldsHtml(view.melds[seat])}</div>${seatRowHtml(view, seat, names)}</section>`;
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
  const column = (view.discards[phase.discarder].length - 1) % XMJ_POND_COLUMNS;
  const text = t('live.xmj.claimBubble', {
    name: escapeHtml(names[phase.discarder]),
    tile: xmjTileName(phase.discard),
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
        t('live.xmj.claimPrompt', { tile: xmjTileName(phase.discard) }),
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
  const status = handOver ? '' : actions || messageHtml(view, self, options.names);
  return `<div class="xmj-centre"><div class="xmj-centre__facts">${handLine}${wallHtml(view.wallCount)}</div><div class="xmj-centre__status">${status}</div></div>`;
}

// ── The result, between hands ────────────────────────────────────────────────

function groupHtml(tiles: readonly XmjTile[], caption: string, winning: XmjTile | null): string {
  let marked = false;
  const html = tiles
    .map((tile) => {
      const win = winning !== null && !marked && tile === winning;
      if (win) marked = true;
      return tileSpan(tile, win ? 'xmj-tile--sm xmj-tile--win' : 'xmj-tile--sm');
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
 * Each scoring line, their sum, and who pays it: the line a player reads to
 * see why their own score moved.
 */
function breakdownHtml(
  score: XmjScore,
  winner: XmjSeat,
  names: Readonly<Record<XmjSeat, string>>,
): string {
  const lines = score.lines
    .map(
      (line) =>
        `<li><span>${t(`live.xmj.tai.${line.key}` as I18nKey)}</span><b>${line.tai}</b></li>`,
    )
    .join('');
  const sum = `<li class="xmj-breakdown__sum"><span>${t('live.xmj.ledgerTotal')}</span><b>${score.total}</b></li>`;
  const paid = t('live.xmj.paidBy', {
    winner: escapeHtml(names[winner]),
    gain: signed(score.total),
    loser: escapeHtml(names[other(winner)]),
    loss: signed(-score.total),
  });
  const how = `<a class="xmj-result__how" href="${localizedHref(XMJ_SCORING_HREF)}">${t('live.xmj.howScoring')}</a>`;
  return `<div class="xmj-breakdown"><ul>${lines}${sum}</ul><p class="xmj-breakdown__paid">${paid}</p>${how}</div>`;
}

function outcomeText(result: XmjViewResult, names: Readonly<Record<XmjSeat, string>>): string {
  if (result.winner === null) return t('live.xmj.resultNone');
  return t(result.selfDrawn ? 'live.xmj.resultSelfDraw' : 'live.xmj.resultDiscard', {
    name: escapeHtml(names[result.winner]),
  });
}

/**
 * Hand by hand, what each player gained or lost in it, and the match total
 * underneath. A won hand is zero-sum: the winner's gain is the other's loss.
 */
function ledgerHtml(view: XmjPlayerView, names: Readonly<Record<XmjSeat, string>>): string {
  if (view.results.length === 0) return '';
  const seats: readonly XmjSeat[] = ['east', 'west'];
  const total: Record<XmjSeat, number> = { east: 0, west: 0 };
  const rows = view.results
    .map((result, index) => {
      const winner = result.winner;
      const points = winner === null ? 0 : (result.score?.total ?? 0);
      const cells = seats
        .map((seat) => {
          const delta = winner === null ? 0 : seat === winner ? points : -points;
          total[seat] += delta;
          return `<td class="xmj-ledger__n">${winner === null ? '0' : signed(delta)}</td>`;
        })
        .join('');
      const now = index === view.results.length - 1 ? ' class="xmj-ledger__now"' : '';
      return `<tr${now}><td>${index + 1}</td><td>${outcomeText(result, names)}</td>${cells}</tr>`;
    })
    .join('');
  const heads = seats
    .map((seat) => `<th class="xmj-ledger__n">${escapeHtml(names[seat])}</th>`)
    .join('');
  const totals = seats
    .map((seat) => `<td class="xmj-ledger__n">${signed(total[seat])}</td>`)
    .join('');
  return `<table class="xmj-ledger"><thead><tr><th>${t('live.xmj.ledgerHand')}</th><th>${t('live.xmj.ledgerResult')}</th>${heads}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td></td><td>${t('live.xmj.ledgerTotal')}</td>${totals}</tr></tfoot></table>`;
}

/** The one sentence the result leads with. */
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
  // The match ended mid-hand (resignation, timeout): the foot names how.
  return t('live.xmj.handUnfinished', { hand });
}

/** Finished reasons the match score decides; any other names how it ended. */
const ON_POINTS: ReadonlySet<string> = new Set(['points', 'tie']);

function resultHtml(view: XmjPlayerView, options: XmjTableOptions): string {
  const names = options.names;
  const phase = view.phase;
  const title = xmjResultTitle(view, names);
  const body =
    phase.type === 'won'
      ? `<div class="xmj-result__win"><div class="xmj-won">${winningHandHtml(phase.score, phase.winningTile)}</div>${breakdownHtml(phase.score, phase.winner, names)}</div>`
      : '';
  let foot: string;
  if (view.status.type === 'finished' && !ON_POINTS.has(view.status.reason)) {
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
        ? t('live.xmj.matchDrawn', {
            east: signed(view.scores.east),
            west: signed(view.scores.west),
          })
        : t('live.xmj.matchWon', {
            name: escapeHtml(names[winner]),
            winner: signed(view.scores[winner]),
            loser: signed(view.scores[other(winner)]),
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
  return `<div class="xmj-result" role="region" aria-label="${title}"><h3 class="xmj-result__title">${title}</h3>${body}${ledgerHtml(view, names)}${foot}</div>`;
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
  const middle = `<div class="xmj-middle${handOver ? ' xmj-middle--result' : ''}">${pondHtml(view, opponent, false, names, claimBubble)}${centreHtml(view, self, options, handOver)}${pondHtml(view, self, you, names, '')}${result}</div>`;
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
  /** Earlier hands the reader opened. */
  readonly expanded: ReadonlySet<number>;
  /** Whether a row's ply can be shown (the client holds that snapshot). */
  readonly hasPly: (ply: number) => boolean;
  readonly pieceSet?: XiangqiPieceSet;
  readonly tileLook?: XmjTileLook;
}

function logRowText(row: XmjLogRow, options: XmjLogOptions): string {
  const you = 'seat' in row && row.seat === options.viewer;
  const name = 'seat' in row ? escapeHtml(options.names[row.seat]) : '';
  const tile = (value: XmjTile) => tileSpan(value, 'xmj-tile--xs');
  switch (row.kind) {
    case 'discard':
      if (row.drew) {
        return you
          ? t('live.xmj.log.youDrawDiscard', { tile: tile(row.tile) })
          : t('live.xmj.log.nameDrawsDiscards', { name, tile: tile(row.tile) });
      }
      return you
        ? t('live.xmj.log.youDiscard', { tile: tile(row.tile) })
        : t('live.xmj.log.nameDiscards', { name, tile: tile(row.tile) });
    case 'claim':
      return you
        ? t('live.xmj.log.youClaim', { tile: tile(row.tile) })
        : t('live.xmj.log.nameClaims', { name, tile: tile(row.tile) });
    case 'win':
      return you
        ? t('live.xmj.log.youWinOn', { tile: tile(row.tile) })
        : t('live.xmj.log.nameWinsOn', { name, tile: tile(row.tile) });
    case 'self-draw':
      return you ? t('live.xmj.log.youWinSelfDraw') : t('live.xmj.log.nameWinsSelfDraw', { name });
    case 'exhausted':
      return t('live.xmj.log.wallEmpty');
  }
}

function logRowsHtml(hand: XmjLogHand, options: XmjLogOptions, activeRow: number | null): string {
  return hand.rows
    .map((row) => {
      const active = activeRow === row.ply;
      const ends = row.kind === 'win' || row.kind === 'self-draw' || row.kind === 'exhausted';
      const cls = `xmj-log__row${active ? ' active' : ''}${ends ? ' xmj-log__row--end' : ''}`;
      const text = logRowText(row, options);
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
 * The log: the latest hand in full, each earlier hand one line that opens.
 * A hand holding the scrubbed ply opens by itself, so the highlight shows.
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
        const open = latest || holdsActive || options.expanded.has(hand.hand);
        const summary = logSummary(hand, options);
        const head = latest
          ? `<div class="xmj-log__head">${summary}</div>`
          : `<button type="button" class="xmj-log__head xmj-log__toggle" data-xmj-hand="${hand.hand}" aria-expanded="${open}">${summary}</button>`;
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
