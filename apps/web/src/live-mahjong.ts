/**
 * Live room client for Hong Kong mahjong.
 *
 * What is genuinely this variant's, and lives here, is that the room can be
 * waiting on FOUR people at once. Every other tenant on this core asks one
 * question at a time of one seat; a mahjong discard asks up to three seats
 * whether they want the tile, and the answers arrive in any order.
 *
 * Two consequences run through this file. The client offers actions to a seat
 * whose turn it is not (see the tenant's seatMayAct), and a discard is not the
 * end of a turn: the tile sits under claim until the window settles, so the
 * board has a state that is nobody's move and everybody's decision.
 */

import { MAHJONG_SPEC_ID } from '@mistboard/game';
import {
  MAHJONG_SEATS,
  type MahjongMove,
  type MahjongPlayerView,
  type MahjongSeat,
} from '@mistboard/mahjong';
import { mahjongEnabled } from './feature-flags.js';
import type { LiveRefs } from './live-state.js';
import './mahjong.css';
import { mahjongActionsHtml, mahjongTableHtml } from './mahjong-table.js';
import { mahjongTileName } from './mahjong-tile.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';

let core: TenantLiveClientContext<MahjongSeat, MahjongPlayerView> | null = null;
let roomMode: 'pvp' | 'pve' = 'pve';
let forfeitDeadline: number | null = null;

function isMahjongSeat(value: unknown): value is MahjongSeat {
  return typeof value === 'string' && (MAHJONG_SEATS as readonly string[]).includes(value);
}

function mahjongReasonPhrase(reason: string): string {
  switch (reason) {
    case 'exhausted':
      return 'the wall ran out';
    case 'self-draw':
      return 'won on a self-draw';
    case 'discard':
      return 'won on a discard';
    default:
      return reason.replace(/-/g, ' ');
  }
}

const mahjongWebTenant: WebVariantTenant<MahjongSeat> = {
  displayName: 'Mahjong',
  metaGlyph: '🀄',
  colors: MAHJONG_SEATS,
  isColor: isMahjongSeat,
  // "The seat after", not "the opponent". At a table of four there is no
  // opposite seat, and the chrome only uses this to walk the seating order.
  oppositeColor: (seat) => MAHJONG_SEATS[(MAHJONG_SEATS.indexOf(seat) + 1) % 4] as MahjongSeat,
  // The reason this hook exists. During a claim window every seat that could
  // take the tile may act, and so may the discarder; outside one it is ordinary
  // alternation. Without this, the claim buttons stay dead for exactly the
  // people being asked to answer.
  seatMayAct: (view, seat) => {
    const mahjong = view as MahjongPlayerView;
    if (mahjong.status.type !== 'playing') return false;
    if (mahjong.discardUnderClaim === null) return mahjong.turn === seat;
    return mahjong.awaiting.includes(seat) || mahjong.turn === seat;
  },
  enabled: mahjongEnabled,
  reviewUrl: (roomId) => `/mahjong/game/${encodeURIComponent(roomId)}`,
  reasonPhrase: mahjongReasonPhrase,
  disabledTitle: 'Mahjong disabled',
  disabledBody: 'This client build has the mahjong table off.',
  rejectedBody: 'This mahjong room is not active. Start a new game to play a hand.',
  spectatorBody: 'Watching the table. Hands stay concealed until the hand ends.',
  selectInstruction: 'Click a tile to discard it.',
};

/** Turn a move into the one line the move list shows. */
function notate(move: MahjongMove): string {
  switch (move.action) {
    case 'draw':
      return 'draw';
    case 'discard':
      return mahjongTileName(move.tile);
    case 'claim':
      return move.kind;
    case 'pass':
      return 'pass';
    case 'timeout':
      return 'no claim';
    case 'self-draw':
      return 'self-draw';
    default:
      return '';
  }
}

function isMahjongMoveEvent(
  event: TenantLiveEvent,
): event is TenantMovePlayed<MahjongSeat, MahjongMove> {
  return (event as { type?: unknown }).type === 'move-played';
}

/**
 * A key for everything the viewer can see.
 *
 * The wall count is in it on purpose: two states with identical hands and a
 * different wall are different positions, and a replay that treated them as one
 * would skip the draws.
 */
function replayPositionKey(view: MahjongPlayerView): string {
  return JSON.stringify({
    seats: view.seats.map((seat) => [seat.seat, seat.handSize, seat.discards, seat.melds]),
    hand: view.seats.find((seat) => seat.seat === view.perspective)?.hand ?? null,
    wall: view.wallRemaining,
    turn: view.turn,
    phase: view.phase,
  });
}

function renderTable(refs: LiveRefs, view: MahjongPlayerView | null): void {
  refs.board.className = 'board mahjong-live-board';
  if (!view) {
    refs.board.innerHTML = '';
    return;
  }
  const canDiscard = core?.canActNow() === true && view.phase === 'discard';
  refs.board.innerHTML = mahjongTableHtml(view, canDiscard);
}

function renderActions(refs: LiveRefs, view: MahjongPlayerView | null): void {
  const host = refs.actionStatus;
  // Only offer claims while this seat is actually being waited on. A stale
  // button after the window settles would send a move the server rejects, and
  // the player would read the silence as the site being broken.
  const offer =
    view &&
    core?.canActNow() === true &&
    view.ownClaims.length > 0 &&
    view.discardUnderClaim !== null;
  host.innerHTML = offer ? mahjongActionsHtml(view as MahjongPlayerView) : '';
}

const client = createTenantLiveClient<MahjongSeat, MahjongPlayerView, MahjongMove>({
  tenant: mahjongWebTenant,
  gameSpecId: MAHJONG_SPEC_ID,
  defaultRoomId: 'mj_dev',
  boardClass: 'mahjong-live-board',
  chrome: {
    roomMode: () => roomMode,
    forfeitDeadline: () => forfeitDeadline,
  },
  playAgainRequestBody: (state) => ({
    mode: 'pve',
    gameSpecId: MAHJONG_SPEC_ID,
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    forfeitDeadline = typeof frame.forfeitDeadline === 'number' ? frame.forfeitDeadline : null;
  },
  resetState: () => {
    roomMode = 'pve';
    forfeitDeadline = null;
  },
  renderBoard: (refs, view) => renderTable(refs, view),
  renderExtras: (refs, view) => renderActions(refs, view),
  onDisabled: (refs) => renderActions(refs, null),
  setup: (ctx) => {
    core = ctx;
    installTableInteraction(ctx);
  },
  moveList: {
    rowClass: 'move-row mahjong-move-row',
    cellPrefix: 'mahjong-move-row',
    masked: false,
    notate,
    isMoveEvent: isMahjongMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (_view, ctx) => (ctx.positionChanged ? ctx.latestPly + 1 : ctx.latestPly),
  },
});

/**
 * One delegated listener for the whole table.
 *
 * Delegated rather than per-tile, because the board is re-rendered from markup
 * on every frame: listeners attached to tiles would be thrown away and rebuilt
 * several times a second, and a click landing mid-render would go nowhere.
 */
function installTableInteraction(
  ctx: TenantLiveClientContext<MahjongSeat, MahjongPlayerView>,
): void {
  const onClick = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-mj-tile], [data-mj-claim], [data-mj-pass]',
    );
    if (!target || !ctx.canActNow()) return;

    if (target.dataset.mjPass !== undefined) {
      ctx.send({ type: 'move', action: 'pass' });
      return;
    }
    const claim = target.dataset.mjClaim;
    if (claim) {
      const from = (target.dataset.mjFrom ?? '').split(',').filter(Boolean);
      ctx.send({ type: 'move', action: claim, tiles: from });
      return;
    }
    const tile = target.dataset.mjTile;
    if (tile !== undefined) {
      const view = ctx.displayedView();
      // The button carries the tile's INDEX IN THE HAND, not the tile id: a
      // hand holds duplicates, and clicking the second 3萬 must not be read as
      // clicking the first.
      const hand = view?.seats.find((seat) => seat.seat === view.perspective)?.hand ?? [];
      const chosen = hand[Number(tile)];
      if (chosen === undefined) return;
      ctx.send({ type: 'move', action: 'discard', tiles: [String(chosen)] });
    }
  };
  ctx.refs.board.addEventListener('click', onClick);
  ctx.refs.actionStatus.addEventListener('click', onClick);
}

export function bootstrapMahjongLiveRoom(): void {
  client.bootstrap();
}
