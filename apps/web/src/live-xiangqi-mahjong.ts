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
  type XmjRoomStatus,
  type XmjSeat,
  type XmjTile,
} from '@mistboard/game';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import { t } from './i18n/catalog.js';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { syncMoveListScroll } from './variant-tenant/chrome-dom.js';
import type { TenantMoveListRenderContext } from './variant-tenant/live-client.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import { adoptLiveHistory } from './variant-tenant/live-history.js';
import type { WebVariantTenant } from './variant-tenant/room-chrome.js';
import './xiangqi-mahjong.css';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { xmjHandLog } from './xiangqi-mahjong-log.js';
import {
  XMJ_TILE_LOOKS,
  xiangqiMahjongTableHtml,
  xmjCountdown,
  xmjFeltFromSearch,
  xmjHandsTableHtml,
  xmjLogHtml,
  xmjReasonPhrase,
  xmjResultLine,
  xmjTileLookFromSearch,
  xmjViewOffersAction,
} from './xiangqi-mahjong-table.js';
import { xmjTerminalSound } from './xiangqi-mahjong-terminal-sound.js';

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
 * discarder there was something to decide. Keyed by the pause it waits out,
 * which is new for every discard.
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
    // The bot by its own name (Misty), as the player strip shows it.
    if (roomMode === 'pve' && own !== 'spectator' && own !== null && own !== undefined) {
      return shown[seat] ?? t('live.xmj.bot');
    }
    return shown[seat] ?? t('live.xmj.guest');
  };
  return { east: name('east'), west: name('west') };
}

/** The next-deal countdown ticks in place; nothing else on the table moves. */
let ticker: ReturnType<typeof setInterval> | null = null;
function tickCountdowns(board: HTMLElement): boolean {
  const now = serverNow();
  const nodes = board.querySelectorAll<HTMLElement>('[data-xmj-deadline]');
  for (const node of nodes) {
    const { secs } = xmjCountdown(Number(node.dataset.xmjDeadline), 1, now);
    // Write only what changed: an unchanged write still dirties the text.
    const text = t('live.xmj.nextHandIn', { count: secs });
    if (node.textContent !== text) node.textContent = text;
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
  metaExtra: (view) => {
    if (!view) return null;
    const block = document.createElement('div');
    block.className = 'xmj-hands-card';
    block.innerHTML = xmjHandsTableHtml(view as XmjPlayerView, seatNames());
    return block;
  },
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
    drawnDiscards: view.drawnDiscards,
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

let lastStatusType: XmjRoomStatus['type'] | null = null;
function maybePlayTerminalSound(): void {
  const status = core?.state.view?.status;
  if (!status) return;
  const result = xmjTerminalSound(lastStatusType, status, core?.state.seat);
  lastStatusType = status.type;
  if (result && status.type === 'finished') playTerminalPlan(result, status.reason);
}

// ── Tiles shown moving: the draw, the discard and the claim ─────────────────

/** Where the viewer's last tap on one of their own tiles was, briefly. */
let tappedTile: { rect: DOMRect; at: number } | null = null;
// A discard tapped once while a self-drawn win is on offer (see armedDiscard).
let armedDiscard: { tile: XmjTile; drawn: boolean; hand: number } | null = null;
const TAP_FRESH_MS = 3000;
/** The counts the table was last drawn with, to tell a move from a redraw. */
let drawnCounts: {
  hand: number;
  wall: number;
  discards: Record<XmjSeat, number>;
  melds: Record<XmjSeat, number>;
} | null = null;
let lastTableHtml = '';

const FLIGHT_EASING = 'cubic-bezier(.2,.7,.3,1)';

interface SeatSources {
  readonly drawn: DOMRect | null;
  readonly middle: DOMRect | null;
  /** The newest tile in this seat's pond: what the other seat would claim. */
  readonly pondLast: DOMRect | null;
}

interface TileSources {
  readonly seats: Record<XmjSeat, SeatSources>;
  /** The wall's next tile: draws take from its left end. */
  readonly wallNext: DOMRect | null;
}

/** Read, before the redraw, every spot a tile can leave from. */
function tileSources(board: HTMLElement): TileSources {
  const read = (seat: XmjSeat): SeatSources => {
    const rack = board.querySelector<HTMLElement>(`[data-xmj-seat="${seat}"] .xmj-concealed`);
    const tiles = rack ? [...rack.children] : [];
    const drawn = rack?.querySelector('.xmj-tile--drawn') ?? null;
    // The middle of the tiles that were not just drawn: for the opponent this
    // is where any hand tile seems to leave from, never its true slot.
    const kept = tiles.filter((tile) => tile !== drawn);
    const middle = kept[Math.floor((kept.length - 1) / 2)] ?? null;
    const pondLast = board.querySelector(`[data-xmj-pond="${seat}"] .xmj-pond > :last-child`);
    return {
      drawn: drawn?.getBoundingClientRect() ?? null,
      middle: middle?.getBoundingClientRect() ?? null,
      pondLast: pondLast?.getBoundingClientRect() ?? null,
    };
  };
  const wallNext = board.querySelector('.xmj-wall .xmj-stack:not([data-h="0"]) > i');
  return {
    seats: { east: read('east'), west: read('west') },
    wallNext: wallNext?.getBoundingClientRect() ?? null,
  };
}

/** Play a tile in from where it was, to the place it was just drawn at. */
function flyIn(target: Element | null, from: DOMRect | null, duration: number, delay = 0): void {
  if (!(target instanceof HTMLElement) || !from || typeof target.animate !== 'function') return;
  const to = target.getBoundingClientRect();
  if (to.width === 0) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = from.width / to.width;
  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: 'translate(0, 0) scale(1)' },
    ],
    { duration, delay, easing: FLIGHT_EASING, fill: 'backwards' },
  );
}

function animateMoves(board: HTMLElement, view: XmjPlayerView, sources: TileSources): void {
  const before = drawnCounts;
  drawnCounts = {
    hand: view.handNumber,
    wall: view.wallCount,
    discards: { east: view.discards.east.length, west: view.discards.west.length },
    melds: { east: view.melds.east.length, west: view.melds.west.length },
  };
  const tap = tappedTile && Date.now() - tappedTile.at < TAP_FRESH_MS ? tappedTile.rect : null;
  tappedTile = null;
  if (!before || before.hand !== view.handNumber) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rack = (seat: XmjSeat) => `[data-xmj-seat="${seat}"]`;
  // A draw: the tile slides off the wall into the drawer's rack.
  if (view.wallCount === before.wall - 1) {
    flyIn(
      board.querySelector(`${rack(view.turn)} .xmj-concealed .xmj-tile--drawn`),
      sources.wallNext,
      400,
    );
  }
  for (const seat of XMJ_SEATS) {
    const other = seat === 'east' ? 'west' : 'east';
    // A claim: the discard leaves the other pond for the new face-up set, and
    // the two tiles that complete it come out of the claimer's hand.
    if (
      view.melds[seat].length === before.melds[seat] + 1 &&
      view.discards[other].length === before.discards[other] - 1
    ) {
      const meld = board.querySelector(`${rack(seat)} .xmj-meld:last-child`);
      for (const tile of meld ? [...meld.children] : []) {
        const claimed = tile.classList.contains('xmj-tile--claimed');
        flyIn(
          tile,
          claimed ? sources.seats[other].pondLast : sources.seats[seat].middle,
          450,
          claimed ? 0 : 120,
        );
      }
    }
    // A discard: the tile leaves the hand for the pond.
    if (view.discards[seat].length === before.discards[seat] + 1) {
      const fromDraw = view.drawnDiscards[seat].at(-1) === true;
      const own = seat === core?.state.seat;
      const from =
        (own ? tap : null) ??
        (fromDraw ? sources.seats[seat].drawn : null) ??
        sources.seats[seat].middle ??
        sources.seats[seat].drawn;
      flyIn(board.querySelector(`[data-xmj-pond="${seat}"] .xmj-pond > :last-child`), from, 450);
    }
  }
}

function renderTable(refs: LiveRefs, view: XmjPlayerView | null): void {
  const felt = xmjFeltFromSearch(window.location.search);
  const look = xmjTileLookFromSearch(window.location.search);
  // A spike (`?size=big`): larger discards and wall, judged live before it is kept.
  const big = new URLSearchParams(window.location.search).get('size') === 'big';
  const className = `board xiangqi-mahjong-live-board${felt === 'green' ? '' : ` xmj-felt--${felt}`}${look === 'jade' ? '' : ` xmj-tiles--${look}`}${big ? ' xmj-size--big' : ''}`;
  if (refs.board.className !== className) refs.board.className = className;
  if (!view) {
    refs.board.innerHTML = '';
    lastTableHtml = '';
    drawnCounts = null;
    startTicker(refs.board);
    return;
  }
  if (queuedPass && view.claimPauseEndsAt !== queuedPass.window) clearQueuedPass();
  if (armedDiscard && (!view.legal.selfDraw || armedDiscard.hand !== view.handNumber)) {
    armedDiscard = null;
  }
  const html = xiangqiMahjongTableHtml(view, {
    canAct: core?.canActNow() === true,
    names: seatNames(),
    now: serverNow(),
    passQueued: queuedPass !== null,
    pieceSet: readStoredXiangqiPieceSet(),
    tileLook: look,
    armedDiscard,
  });
  // The room redraws on every frame and clock tick; most change nothing here.
  if (html === lastTableHtml && refs.board.firstElementChild) {
    startTicker(refs.board);
    return;
  }
  // A scrubbed position is not a move being made: no flight.
  const live = view === core?.state.view;
  const sources = live ? tileSources(refs.board) : null;
  // A result already on screen is redrawn settled: its entrance played once.
  const resultShown = refs.board.querySelector('.xmj-result') !== null;
  refs.board.innerHTML = html;
  lastTableHtml = html;
  if (resultShown) refs.board.querySelector('.xmj-result')?.classList.add('xmj-result--settled');
  if (sources) animateMoves(refs.board, view, sources);
  else drawnCounts = null;
  startTicker(refs.board);
}

// ── The move list, one hand at a time ────────────────────────────────────────

/** Earlier hands the reader opened in the move list. */
const openHands = new Set<number>();
let lastListCtx: TenantMoveListRenderContext<XmjSeat, XmjMove> | null = null;

function renderMoveLog(ctx: TenantMoveListRenderContext<XmjSeat, XmjMove>): void {
  lastListCtx = ctx;
  // Plies count the move events in order, as the replay files them.
  const hands = xmjHandLog(ctx.moves.map((event, index) => ({ move: event.move, ply: index + 1 })));
  const seat = core?.state.seat;
  const look = xmjTileLookFromSearch(window.location.search);
  for (const each of XMJ_TILE_LOOKS) {
    ctx.refs.moveList.classList.toggle(`xmj-tiles--${each}`, each === look && look !== 'jade');
  }
  ctx.refs.moveList.innerHTML = xmjLogHtml(hands, {
    names: seatNames(),
    viewer: seat === 'east' || seat === 'west' ? seat : null,
    results: core?.state.view?.results ?? [],
    activePly: ctx.activePly,
    expanded: openHands,
    hasPly: ctx.hasPly,
    pieceSet: readStoredXiangqiPieceSet(),
    tileLook: look,
  });
  syncMoveListScroll(ctx.refs.moveList, { live: ctx.isLive, plyCount: ctx.latestPly });
}

function installMoveLogInteraction(list: HTMLElement): void {
  list.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-xmj-ply], [data-xmj-hand]',
    );
    if (!target || !lastListCtx) return;
    const hand = Number(target.dataset.xmjHand);
    if (Number.isInteger(hand) && hand > 0) {
      if (openHands.has(hand)) openHands.delete(hand);
      else openHands.add(hand);
      renderMoveLog(lastListCtx);
      return;
    }
    const ply = Number(target.dataset.xmjPly);
    if (Number.isInteger(ply) && ply > 0) lastListCtx.jumpToPly(ply);
  });
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
    lastTableHtml = '';
    drawnCounts = null;
    openHands.clear();
    roomMode = 'pve';
    forfeitDeadline = null;
    offsetSamples.length = 0;
    clearQueuedPass();
  },
  renderBoard: renderTable,
  setup: (ctx) => {
    core = ctx;
    installTableInteraction(ctx);
    installMoveLogInteraction(ctx.refs.moveList);
    // A piece-set change in the appearance picker redraws the tiles.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
  },
  moveList: {
    rowClass: 'move-row xiangqi-mahjong-move-row',
    cellPrefix: 'xiangqi-mahjong-move-row',
    listClass: 'xmj-log',
    masked: false,
    notate,
    isMoveEvent: isXmjMoveEvent,
    render: renderMoveLog,
  },
  replayCapture: {
    positionKey: replayPositionKey,
    // A view is filed at the move count it follows, the same ply the move
    // list's rows jump to: every move is a ply here, passes and deadlines
    // included, whether or not the table looks different after it.
    plyForView: (_view, ctx) => Math.max(ctx.latestPly, ctx.events.filter(isXmjMoveEvent).length),
  },
  // The walls stay a server secret, so the log cannot be replayed here. The
  // hello carries this viewer's own per-ply views instead, live or finished
  // (the server's liveHistoryWhenFinished), installed as sent: a reload or a
  // finished-game link can still step back through every hand.
  replayHistory: {
    rebuild: ({ events, view, frame }) =>
      adoptLiveHistory(frame.liveHistory, view, events.filter(isXmjMoveEvent).length, {
        finished: true,
        boardless: true,
      }),
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
      // Tiles of one kind are interchangeable, so the kind is the whole move;
      // what is public is whether it was the tile just drawn. A copy of the
      // drawn tile played from the hand says so, and the opponent sees it
      // leave the hand rather than the drawn slot.
      const view = ctx.state.view;
      const phase = view?.phase;
      const drawn = phase?.type === 'discard' ? phase.drawn : null;
      const tile = data.xmjTile as XmjTile;
      const fromDrawnSlot = target.classList.contains('xmj-tile--drawn');
      const fromHand = drawn === tile && !fromDrawnSlot;
      // With a win on offer, the first tap only raises the tile: a slip next
      // to the Win button must not throw the hand away.
      if (view?.legal.selfDraw && !target.classList.contains('xmj-tile--armed')) {
        armedDiscard = { tile, drawn: fromDrawnSlot, hand: view.handNumber };
        ctx.renderAll();
        return;
      }
      armedDiscard = null;
      tappedTile = { rect: target.getBoundingClientRect(), at: Date.now() };
      ctx.send({
        type: 'move',
        action: fromHand ? 'discard-hand' : 'discard',
        tiles: [tile],
      });
    }
  });
}

function sendPass(ctx: TenantLiveClientContext<XmjSeat, XmjPlayerView>): void {
  const view = ctx.state.view;
  const pauseEnd = view?.claimPauseEndsAt ?? null;
  const wait = pauseEnd === null ? 0 : pauseEnd + PASS_MARGIN_MS - serverNow();
  if (wait <= 0 || pauseEnd === null) {
    ctx.send({ type: 'move', action: 'pass' });
    return;
  }
  if (queuedPass) return;
  queuedPass = {
    window: pauseEnd,
    timer: setTimeout(() => {
      const still =
        queuedPass?.window === pauseEnd && ctx.state.view?.claimPauseEndsAt === pauseEnd;
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
