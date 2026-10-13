/**
 * Live room client for xiangqi mahjong (象棋麻將, two players, 32 tiles).
 *
 * Copied in shape from the Hong Kong mahjong client rather than shared with
 * it, so either can be deleted without the other. Two seats, and the room is
 * not strictly alternating: after a discard the OTHER seat answers the claim
 * window, and between hands either seat may say it is ready. seatMayAct reads
 * view.legal for that, which the server filled for this seat.
 */

import {
  isXmjSeat,
  XIANGQI_MAHJONG_SPEC_ID,
  XMJ_GLYPHS,
  XMJ_SEATS,
  type XmjMove,
  type XmjPlayerView,
  type XmjSeat,
} from '@mistboard/game';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { TenantReasonKey, WebVariantTenant } from './variant-tenant/room-chrome.js';
import './xiangqi-mahjong.css';
import { xiangqiMahjongTableHtml, xmjViewOffersAction } from './xiangqi-mahjong-table.js';

let core: TenantLiveClientContext<XmjSeat, XmjPlayerView> | null = null;
let roomMode: 'pvp' | 'pve' = 'pve';
let forfeitDeadline: number | null = null;

function xmjReasonPhrase(reason: string): TenantReasonKey {
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

const xmjWebTenant: WebVariantTenant<XmjSeat> = {
  displayName: 'variant.xiangqiMahjong.name',
  colors: XMJ_SEATS,
  isColor: isXmjSeat,
  oppositeColor: (seat) => (seat === 'east' ? 'west' : 'east'),
  seatMayAct: (view, seat) => xmjViewOffersAction(view as XmjPlayerView, seat),
  enabled: xiangqiMahjongEnabled,
  // No review page exists, so no link: the postgame panel drops an empty href.
  reviewUrl: () => '',
  reasonPhrase: xmjReasonPhrase,
  rejectedBody: 'live.xiangqiMahjongRoomNotActive',
  liveGameRejectedBody: 'live.roomLiveHandSeatedOnly',
  spectatorBody: 'live.spectatorXiangqiMahjong',
  selectInstruction: 'live.selectXiangqiMahjong',
};

function notate(move: XmjMove): string {
  switch (move.action) {
    case 'discard':
      return XMJ_GLYPHS[move.tile];
    case 'claim':
      return move.kind;
    case 'self-draw':
      return 'self-draw';
    case 'pass':
      return 'pass';
    case 'next-hand':
      return 'ready';
    case 'timeout':
      return 'no claim';
    default:
      return '';
  }
}

function isXmjMoveEvent(event: TenantLiveEvent): event is TenantMovePlayed<XmjSeat, XmjMove> {
  return (event as { type?: unknown }).type === 'move-played';
}

function replayPositionKey(view: XmjPlayerView): string {
  return JSON.stringify({
    hand: view.handNumber,
    hands: view.hands,
    counts: view.handCounts,
    melds: view.melds,
    discards: view.discards,
    wall: view.wallCount,
    turn: view.turn,
    phase: view.phase,
    between: view.between,
    ready: view.ready,
  });
}

function soundForEvent(event: unknown, seat: unknown): void {
  const played = event as { type?: string; color?: string; move?: { action?: string } } | undefined;
  if (played?.type !== 'move-played') return;
  const action = played.move?.action;
  if (action === 'discard') playSound(played.color === seat ? 'move' : 'captured');
  else if (action === 'claim' || action === 'self-draw') playSound('capture');
}

let lastStatusType: string | null = null;
function maybePlayTerminalSound(): void {
  const status = core?.state.view?.status;
  if (!status || status.type === lastStatusType) return;
  lastStatusType = status.type;
  if (status.type !== 'finished') return;
  const seat = core?.state.seat;
  const result = status.winner === null ? 'draw' : status.winner === seat ? 'win' : 'lose';
  playTerminalPlan(result, status.reason ?? null);
}

function renderTable(refs: LiveRefs, view: XmjPlayerView | null): void {
  refs.board.className = 'board xiangqi-mahjong-live-board';
  if (!view) {
    refs.board.innerHTML = '';
    return;
  }
  refs.board.innerHTML = xiangqiMahjongTableHtml(view, core?.canActNow() === true);
}

const client = createTenantLiveClient<XmjSeat, XmjPlayerView, XmjMove>({
  tenant: xmjWebTenant,
  gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
  defaultRoomId: 'xmj_dev',
  boardClass: 'xiangqi-mahjong-live-board',
  chrome: {
    roomMode: () => roomMode,
    forfeitDeadline: () => forfeitDeadline,
  },
  playAgainRequestBody: (state) => ({
    mode: 'pve',
    gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
    preferredColor: 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
    forfeitDeadline = typeof frame.forfeitDeadline === 'number' ? frame.forfeitDeadline : null;
    soundForEvent(frame.event, frame.seat);
    maybePlayTerminalSound();
  },
  resetState: () => {
    lastStatusType = null;
    roomMode = 'pve';
    forfeitDeadline = null;
  },
  renderBoard: renderTable,
  setup: (ctx) => {
    core = ctx;
    installTableInteraction(ctx);
  },
  moveList: {
    rowClass: 'move-row xiangqi-mahjong-move-row',
    cellPrefix: 'xiangqi-mahjong-move-row',
    masked: false,
    notate,
    isMoveEvent: isXmjMoveEvent,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    plyForView: (view, ctx) => {
      const ply = ctx.positionChanged ? ctx.latestPly + 1 : ctx.latestPly;
      // Earlier plies cannot be rebuilt client-side (the walls stay a server
      // secret), so a finished match is filed at its move count.
      if (view.status.type !== 'finished') return ply;
      return Math.max(ply, ctx.events.filter(isXmjMoveEvent).length);
    },
  },
});

/** One delegated listener: the table is re-rendered from markup on every frame. */
function installTableInteraction(ctx: TenantLiveClientContext<XmjSeat, XmjPlayerView>): void {
  ctx.refs.board.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-xmj-tile], [data-xmj-claim], [data-xmj-pass], [data-xmj-selfdraw], [data-xmj-next]',
    );
    if (!target || !ctx.canActNow()) return;
    const data = target.dataset;
    if (data.xmjSelfdraw !== undefined) ctx.send({ type: 'move', action: 'self-draw' });
    else if (data.xmjPass !== undefined) ctx.send({ type: 'move', action: 'pass' });
    else if (data.xmjNext !== undefined) ctx.send({ type: 'move', action: 'next-hand' });
    else if (data.xmjClaim) {
      const tiles = (data.xmjFrom ?? '').split(',').filter(Boolean);
      ctx.send({ type: 'move', action: data.xmjClaim, tiles });
    } else if (data.xmjTile) {
      // Tiles of one kind are interchangeable, so the kind is the whole move.
      ctx.send({ type: 'move', action: 'discard', tiles: [data.xmjTile] });
    }
  });
}

export function bootstrapXiangqiMahjongLiveRoom(): void {
  client.bootstrap();
}
