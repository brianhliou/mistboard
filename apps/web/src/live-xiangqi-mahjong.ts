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
  type XmjClaimKind,
  type XmjMove,
  type XmjPlayerView,
  type XmjSeat,
} from '@mistboard/game';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import { t } from './i18n/catalog.js';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';
import './xiangqi-mahjong.css';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import {
  xiangqiMahjongTableHtml,
  xmjCountdown,
  xmjFeltFromSearch,
  xmjReasonPhrase,
  xmjResultLine,
  xmjViewOffersAction,
} from './xiangqi-mahjong-table.js';

let core: TenantLiveClientContext<XmjSeat, XmjPlayerView> | null = null;
let roomMode: 'pvp' | 'pve' = 'pve';
let forfeitDeadline: number | null = null;

/**
 * The server's clock, estimated from the times on move events. An event is
 * stamped no later than it is sent, so the largest recent (stamp - arrival)
 * is the closest guess; an answer dated back to a pause end only lowers one
 * sample.
 */
const offsetSamples: number[] = [];
function noteServerTime(at: unknown): void {
  if (typeof at !== 'number' || !Number.isFinite(at)) return;
  offsetSamples.push(at - Date.now());
  if (offsetSamples.length > 8) offsetSamples.shift();
}
function serverNow(): number {
  return Date.now() + (offsetSamples.length > 0 ? Math.max(...offsetSamples) : 0);
}

/**
 * A Pass pressed during the pause after a discard waits for the pause to end:
 * an answer sooner than an empty hand's automatic pass would tell the
 * discarder there was something to decide. Keyed by the window it answers.
 */
let queuedPass: { window: number; timer: ReturnType<typeof setTimeout> } | null = null;
const PASS_MARGIN_MS = 120;

function clearQueuedPass(): void {
  if (queuedPass) clearTimeout(queuedPass.timer);
  queuedPass = null;
}

function seatNames(): Record<XmjSeat, string> {
  const own = core?.state.seat;
  const shown = core?.state.seatDisplayNames ?? {};
  const name = (seat: XmjSeat): string => {
    if (seat === own) return t('live.xmj.you');
    if (roomMode === 'pve' && own !== 'spectator' && own !== null && own !== undefined) {
      return t('live.xmj.bot');
    }
    return shown[seat] ?? t('live.xmj.guest');
  };
  return { east: name('east'), west: name('west') };
}

/** The countdowns tick in place; nothing else on the table moves. */
let ticker: ReturnType<typeof setInterval> | null = null;
function tickCountdowns(board: HTMLElement): boolean {
  const now = serverNow();
  const nodes = board.querySelectorAll<HTMLElement>('[data-xmj-deadline]');
  for (const node of nodes) {
    const deadline = Number(node.dataset.xmjDeadline);
    const span = Number(node.dataset.xmjSpan ?? 0);
    const { secs, width } = xmjCountdown(deadline, span > 0 ? span : 1, now);
    if (node.dataset.xmjText === 'nextHandIn') {
      node.textContent = t('live.xmj.nextHandIn', { count: secs });
      continue;
    }
    const bar = node.querySelector<HTMLElement>('.xmj-timer i');
    if (bar) bar.style.width = `${width.toFixed(1)}%`;
    const label = node.querySelector<HTMLElement>('[data-xmj-secs]');
    if (label) label.textContent = t('live.xmj.seconds', { count: secs });
  }
  return nodes.length > 0;
}
function startTicker(board: HTMLElement): void {
  if (!tickCountdowns(board)) {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    return;
  }
  if (ticker !== null) return;
  ticker = setInterval(() => {
    if (!tickCountdowns(board) && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }, 250);
}

// A seat by its player, for the room chrome around the table (player rows, the
// finished line): "You" for the viewer's own seat, else the server's name for the
// seat (handle, the bot's name), else the table's own word. Never "East"/"West":
// the seat id only alternates the deal.
function xmjPlayerName(seat: XmjSeat): string {
  if (seat === core?.state.seat) return t('live.xmj.you');
  return core?.state.seatDisplayNames?.[seat] ?? seatNames()[seat];
}

function xmjFinishedLine(winner: XmjSeat | null, reason: string): string {
  return xmjResultLine(winner, reason, core?.state.seat ?? null, xmjPlayerName);
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
  seatPlayerName: xmjPlayerName,
  finishedLine: xmjFinishedLine,
  rejectedBody: 'live.xiangqiMahjongRoomNotActive',
  liveGameRejectedBody: 'live.roomLiveHandSeatedOnly',
  spectatorBody: 'live.spectatorXiangqiMahjong',
  selectInstruction: 'live.selectXiangqiMahjong',
};

const CLAIM_LABEL: Readonly<
  Record<XmjClaimKind, 'live.xmj.win' | 'live.xmj.takePung' | 'live.xmj.takeChow'>
> = {
  win: 'live.xmj.win',
  pung: 'live.xmj.takePung',
  chow: 'live.xmj.takeChow',
};

function notate(move: XmjMove): string {
  switch (move.action) {
    case 'discard':
      return XMJ_GLYPHS[move.tile];
    case 'claim':
      return t(CLAIM_LABEL[move.kind]);
    case 'self-draw':
      return t('live.xmj.selfDraw');
    // A pass and a window that ran out read the same: neither says why.
    case 'pass':
    case 'timeout':
      return t('live.xmj.pass');
    case 'next-hand':
      return t('live.xmj.ready');
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
  const felt = xmjFeltFromSearch(window.location.search);
  refs.board.className = `board xiangqi-mahjong-live-board${felt === 'green' ? '' : ` xmj-felt--${felt}`}`;
  if (!view) {
    refs.board.innerHTML = '';
    startTicker(refs.board);
    return;
  }
  if (queuedPass && view.windowClosesAt !== queuedPass.window) clearQueuedPass();
  refs.board.innerHTML = xiangqiMahjongTableHtml(view, {
    canAct: core?.canActNow() === true,
    names: seatNames(),
    now: serverNow(),
    passQueued: queuedPass !== null,
    pieceSet: readStoredXiangqiPieceSet(),
  });
  startTicker(refs.board);
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
    noteServerTime((frame.event as { at?: unknown } | undefined)?.at);
    soundForEvent(frame.event, frame.seat);
    maybePlayTerminalSound();
  },
  resetState: () => {
    lastStatusType = null;
    roomMode = 'pve';
    forfeitDeadline = null;
    offsetSamples.length = 0;
    clearQueuedPass();
  },
  renderBoard: renderTable,
  setup: (ctx) => {
    core = ctx;
    installTableInteraction(ctx);
    // A piece-set change in the appearance picker redraws the tiles.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
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
    else if (data.xmjPass !== undefined) sendPass(ctx);
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

function sendPass(ctx: TenantLiveClientContext<XmjSeat, XmjPlayerView>): void {
  const view = ctx.state.view;
  const pauseEnd = view?.claimPauseEndsAt ?? null;
  const closesAt = view?.windowClosesAt ?? null;
  const wait = pauseEnd === null ? 0 : pauseEnd + PASS_MARGIN_MS - serverNow();
  if (wait <= 0 || closesAt === null) {
    ctx.send({ type: 'move', action: 'pass' });
    return;
  }
  if (queuedPass) return;
  queuedPass = {
    window: closesAt,
    timer: setTimeout(() => {
      const still = queuedPass?.window === closesAt && ctx.state.view?.windowClosesAt === closesAt;
      queuedPass = null;
      if (still && ctx.canActNow()) ctx.send({ type: 'move', action: 'pass' });
      ctx.renderAll();
    }, wait),
  };
  ctx.renderAll();
}

export function bootstrapXiangqiMahjongLiveRoom(): void {
  client.bootstrap();
}
