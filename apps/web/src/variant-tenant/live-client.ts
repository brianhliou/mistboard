/**
 * Generic live-room client core for variant tenants — the orchestration layer
 * that was copy-pasted across every live-*.ts client (bootstrap wiring, frame
 * application, renderAll skeleton, fog-safe replay capture, and the
 * two-column move list). One instance per tenant module, created with
 * createTenantLiveClient(config); the route module calls .bootstrap().
 *
 * What stays tenant-owned (via config hooks and setup(ctx)): wire view types,
 * board rendering, click/drag interaction (installed in setup so drops,
 * promotions, and flip actions never leak in here), sounds, move notation,
 * and any snapshot extras (roomMode, pveEngineId, forfeitDeadline) captured
 * through onFrame. Two optional capabilities extend the core without touching
 * tenants that skip them: replayHistory (kernel rebuild of per-ply views from
 * the event log, so reconnects keep full replay stepping — perfect-info
 * tenants only, fog logs are redacted) and moveList.render (a tenant-owned
 * clickable move list replacing the standard two-column one).
 *
 * Composes the existing glue: socket-client (connection state machine),
 * room-chrome (clocks/status/actions), replay-controller (scrub state).
 */

import {
  classifyTimeControl,
  createGameLifecycleTracker,
  type GameLifecycleStatusType,
  maybeGameSpecAnalyticsProps,
  roomModeAnalyticsProps,
} from '../analytics.js';
import { brandedEngineName } from '../game-display.js';
import { createLiveLayout, setLiveLayoutGameSpec } from '../live-layout.js';
import {
  createLiveLifecycleEffects,
  type LiveLifecycleEffects,
} from '../live-lifecycle-effects.js';
import { initLiveSound, resetLiveSoundState } from '../live-sound.js';
import { clearSeatTokenForRoom, type LiveRefs } from '../live-state.js';
import type { ProfileIdentity } from '../profile-link.js';
import { roomIdFromPath } from '../room-url.js';
import { syncMoveListScroll } from './chrome-dom.js';
import {
  createTenantReplayController,
  type TenantReplayController,
  type TenantReplaySnapshot,
} from './replay-controller.js';
import {
  createTenantRoomChrome,
  type TenantRoomChrome,
  type TenantWebView,
  type WebVariantTenant,
} from './room-chrome.js';
import {
  createTenantSocketClient,
  type TenantConnectionState,
  type TenantSocketClient,
  type TenantSocketClientOptions,
} from './socket-client.js';

export type TenantLiveClock<C extends string> = {
  activeColor: C | null;
  incrementMs: number;
  initialMs: number;
  remainingMs: Record<C, number>;
  runningSince: number | null;
};

export type TenantMovePlayed<C extends string, M> = {
  type: 'move-played';
  color: C;
  move: M;
  at: number;
  ply?: number;
};

export type TenantLiveEvent = { type: string; [key: string]: unknown };

export type TenantLiveFrame<C extends string, V> = {
  type: 'hello' | 'snapshot' | 'event-appended';
  clientId?: string;
  seatToken?: string;
  seat: C | 'spectator';
  seats: Partial<Record<C, string>>;
  // Public player names per seat (account/bot/engine); guests omitted.
  seatDisplayNames?: Partial<Record<C, string>>;
  seatProfiles?: Partial<Record<C, ProfileIdentity>>;
  state: V;
  clock?: TenantLiveClock<C> | null;
  connectedSeats?: Record<C, boolean>;
  abortDeadline?: number | null;
  timeControl?: { initialMs: number; incrementMs: number } | null;
  events?: TenantLiveEvent[];
  event?: TenantLiveEvent;
  seq?: number;
  // Tenant snapshot extras (roomMode, pveEngineId, forfeitDeadline, rematch)
  // ride the same frame; tenants read them in onFrame.
  [key: string]: unknown;
};

export type TenantLiveState<C extends string, V> = {
  room: string;
  seat: C | 'spectator' | null;
  view: V | null;
  clock: TenantLiveClock<C> | null;
  timeControl: { initialMs: number; incrementMs: number } | null;
  seats: Partial<Record<C, string>>;
  seatDisplayNames: Partial<Record<C, string>>;
  // Where each seat name links, parallel to seatDisplayNames. A seat with no
  // public page (guest, engine with no bot fronting it) is simply absent.
  seatProfiles: Partial<Record<C, ProfileIdentity>>;
  connectedSeats: Partial<Record<C, boolean>>;
  events: TenantLiveEvent[];
  abortDeadline: number | null;
};

// Everything a tenant's interaction/setup code needs from the core. Handed to
// setup(ctx) once per bootstrap, after the layout and chrome exist but before
// the socket connects.
export type TenantLiveClientContext<C extends string, V> = {
  state: TenantLiveState<C, V>;
  refs: LiveRefs;
  replay: TenantReplayController<V>;
  chrome: TenantRoomChrome;
  send(payload: unknown): boolean;
  connection(): TenantConnectionState;
  renderAll(): void;
  /** The replay-aware view currently on screen. */
  displayedView(): V | null;
  /** Live (not scrubbed) + seated + this seat's turn. */
  canActNow(): boolean;
  orientation(): C;
};

// Everything a tenant-owned move-list renderer needs from the core. `moves`
// is the (fog-redacted) move-event slice of the event log this client holds.
export type TenantMoveListRenderContext<C extends string, M> = {
  refs: LiveRefs;
  moves: readonly TenantMovePlayed<C, M>[];
  /** Scrubbed ply for the active-move highlight, or null when live. */
  activePly: number | null;
  latestPly: number;
  isLive: boolean;
  /** Scrub to a ply (the latest ply returns to live) and re-render the room. */
  jumpToPly(ply: number): void;
};

export type TenantMoveListConfig<C extends string, M> = {
  /** Class list for each move row (e.g. 'move-row xiangqi-move-row'). */
  rowClass: string;
  /** Class prefix for the number/cell spans (e.g. 'xiangqi-move-row'). */
  cellPrefix: string;
  /** Extra class applied once to the <ol> host, if any. */
  listClass?: string;
  /** Fog tenants mask redacted plies and trim the list to the scrubbed ply. */
  masked: boolean;
  /**
   * Row window during a replay scrub: 'visible' trims to the scrubbed ply,
   * 'all' keeps every row and only moves the active highlight. Defaults to
   * 'visible' when masked, else 'all'. Dark Xiangqi is masked-but-'all'.
   */
  plyWindow?: 'visible' | 'all';
  notate(move: M): string;
  isMoveEvent(event: TenantLiveEvent): event is TenantMovePlayed<C, M>;
  /** Optional banner row above the list (e.g. the parachute bounce note). */
  banner?(): { className: string; text: string } | null;
  /**
   * OPTIONAL full replacement for the standard two-column list (Crossroads:
   * clickable ply-jump buttons). Owns everything inside refs.moveList; the
   * core still renders the replay shell (meta line + scrub buttons) and
   * applies listClass. Tenants without it keep the standard list unchanged.
   */
  render?(ctx: TenantMoveListRenderContext<C, M>): void;
};

export type TenantReplayHistoryConfig<C extends string, V> = {
  /**
   * OPTIONAL replay-history injection: rebuild the full per-ply view list
   * (ply 0 = initial position through the latest ply) from the event log the
   * client already legitimately holds. Runs after every hello/snapshot frame
   * — mount, reconnect, and seq-gap resync all arrive as one of those — so
   * replay stepping works after a reconnect, when only the final view was
   * captured live (#80). The core keeps the server-sent view for the latest
   * ply (kernel replay cannot derive non-move endings like resignation).
   *
   * HIDDEN-INFO INVARIANT: only perfect-information tenants may implement
   * this. The input is the same PlayerView event stream the server already
   * sent this client — nothing new crosses the wire. Fog tenants receive
   * redacted logs (opponent moves are omitted or stripped), CANNOT rebuild,
   * and must stay on incremental capture; never infer hidden state here.
   * Return null to keep the captured history (e.g. when an event fails to
   * replay through the kernel).
   */
  rebuild(ctx: {
    events: readonly TenantLiveEvent[];
    view: V;
    state: TenantLiveState<C, V>;
  }): TenantReplaySnapshot<V>[] | null;
};

/**
 * One-shot board-animation intent, drained by the render that follows it:
 *   - 'live': a move event just applied (color = the mover). The move comes
 *     straight from the wire payload, so animating it can never reveal more
 *     than the server already sent this client — the fog-safety invariant is
 *     that tenants ONLY animate from this payload, never from board diffs.
 *   - 'scrub': the replay controller stepped by exactly one ply; prevView is
 *     the previously displayed view (for back-steps, the undone move's view).
 */
export type TenantPendingAnimation<C extends string, V, M> =
  | { kind: 'live'; move: M; color: C }
  | { kind: 'scrub'; direction: 'forward' | 'back'; prevView: V | null };

export type TenantReplayCaptureConfig<C extends string, V> = {
  /** Stable serialization of everything the viewer can see in this view. */
  positionKey(view: V): string;
  /**
   * The ply to record for a new snapshot. `positionChanged` compares against
   * the previous captured key; `latestPly` is the replay history's current
   * ceiling. Perfect-info tenants typically count move events; fog tenants
   * derive from moveNumber + turn.
   */
  plyForView(
    view: V,
    ctx: { positionChanged: boolean; latestPly: number; events: readonly TenantLiveEvent[] },
  ): number;
};

export type TenantLiveClientConfig<C extends string, V extends TenantWebView<C>, M> = {
  tenant: WebVariantTenant<C>;
  gameSpecId: string;
  /**
   * Set only by a tenant that emits `game_started`/`game_finished` itself, to
   * stop this client emitting them a second time. Crossroads Chess is the one
   * such tenant: it kept its own tracker through the migration to this client,
   * and its version reports a real `rated: false` where this one can only say
   * null. Anything else leaves this alone and gets the shared funnel.
   */
  emitsOwnLifecycleAnalytics?: boolean;
  /**
   * Layout sizing spec override when a variant reuses another's board layout
   * (Dark Crossroads renders the crossroads-chess 6x8 board). Defaults to
   * gameSpecId.
   */
  layoutGameSpecId?: string;
  /** Dev fallback room id when the URL carries none (e.g. 'jgl_dev'). */
  defaultRoomId: string;
  /** Board host class (e.g. 'jungle-live-board'); '--disabled' is appended for the off state. */
  boardClass: string;
  playAgainRequestBody(state: TenantLiveState<C, V>): Record<string, unknown>;
  /** Render the board for the displayed (replay-aware) view. */
  renderBoard(refs: LiveRefs, view: V | null): void;
  /**
   * OPTIONAL animation hook, called after renderBoard/renderExtras/move list on
   * every renderAll. `takePendingAnimation()` is one-shot: it returns the move
   * event or single-ply scrub that triggered this render (or null) and drains
   * the channel. Tenants that do not opt in behave byte-identically.
   */
  animateBoard?(
    refs: LiveRefs,
    view: V | null,
    takePendingAnimation: () => TenantPendingAnimation<C, V, M> | null,
  ): void;
  /** Between board and move list: hands, promotion pickers, etc. */
  renderExtras?(refs: LiveRefs, view: V | null): void;
  /** Extra teardown when the tenant flag is off (captures strips, selection). */
  onDisabled?(refs: LiveRefs): void;
  /** Capture tenant snapshot extras from every frame (roomMode, forfeitDeadline...). */
  onFrame?(frame: TenantLiveFrame<C, V>): void;
  /** After a snapshot/event frame applied (sound hooks). */
  onSnapshotApplied?(): void;
  onEventApplied?(): void;
  onServerMessage?(message: { type: string; [key: string]: unknown }): void;
  onRematchState?(message: Record<string, unknown>): void;
  /** Reset tenant sound state at bootstrap (initLiveSound/resetLiveSoundState already run). */
  resetSounds?(): void;
  /** Reset tenant module state (selection, pending promotion...) at bootstrap. */
  resetState?(): void;
  /** Install interactions and tenant listeners; runs once per bootstrap. */
  setup(ctx: TenantLiveClientContext<C, V>): void;
  /** Viewer's bottom-of-board color. Default: seat, else view.perspective, else colors[0]. */
  orientation?(state: TenantLiveState<C, V>): C;
  moveList: TenantMoveListConfig<C, M>;
  replayCapture: TenantReplayCaptureConfig<C, V>;
  replayHistory?: TenantReplayHistoryConfig<C, V>;
  chrome?: {
    forfeitDeadline?(): number | null;
    roomMode?(): string;
    debugRequested?(): boolean;
    rematchControls?(sendSocket: (payload: unknown) => boolean): HTMLElement | null;
    variantDetail?(): string | null;
  };
  /** Test seam: replaces createTenantSocketClient so tests can feed frames. */
  socketFactory?(options: TenantSocketClientOptions): TenantSocketClient;
};

export type TenantLiveClient<C extends string, V> = {
  bootstrap(): void;
  state: TenantLiveState<C, V>;
  renderAll(): void;
  send(payload: unknown): boolean;
  connection(): TenantConnectionState;
  replay: TenantReplayController<V>;
};

export function createTenantLiveClient<C extends string, V extends TenantWebView<C>, M>(
  config: TenantLiveClientConfig<C, V, M>,
): TenantLiveClient<C, V> {
  const { tenant, moveList } = config;

  const state: TenantLiveState<C, V> = {
    room: '',
    seat: null,
    view: null,
    clock: null,
    timeControl: null,
    seats: {},
    seatDisplayNames: {},
    seatProfiles: {},
    connectedSeats: {},
    events: [],
    abortDeadline: null,
  };

  let socket: TenantSocketClient | null = null;
  let refs: LiveRefs | null = null;
  let lastCapturedView: V | null = null;
  let lastCapturedKey: string | null = null;
  // One-shot animation channel (see TenantPendingAnimation). A live move event
  // stashes here; the next renderAll drains it into the animateBoard hook.
  let pendingLiveAnimation: { move: M; color: C } | null = null;
  // The view the previous renderAll displayed — a scrub back-step animates the
  // move that view carried (its lastMove), which the new view no longer has.
  let lastDisplayedView: V | null = null;
  let lifecycleEffects: LiveLifecycleEffects | null = null;

  const replay = createTenantReplayController<V>();

  function send(payload: unknown): boolean {
    return socket?.send(payload) ?? false;
  }

  function connection(): TenantConnectionState {
    return socket?.connection() ?? 'connecting';
  }

  function orientation(): C {
    if (config.orientation) return config.orientation(state);
    if (tenant.isColor(state.seat)) return state.seat;
    const perspective = (state.view as { perspective?: unknown } | null)?.perspective;
    return tenant.isColor(perspective) ? perspective : tenant.colors[0];
  }

  function displayedView(): V | null {
    return replay.currentView(state.view);
  }

  function canActNow(): boolean {
    const view = state.view;
    if (!view || !replay.isLive() || !tenant.isColor(state.seat)) return false;
    return view.status.type === 'playing' && view.status.turn === state.seat;
  }

  const chrome = createTenantRoomChrome(tenant, {
    view: () => state.view,
    seat: () => state.seat,
    connectionState: () => connection(),
    closeReason: () => socket?.closeReason() ?? '',
    clock: () => state.clock,
    timeControl: () => state.timeControl,
    connectedSeats: () => state.connectedSeats,
    seatDisplayNames: () => state.seatDisplayNames,
    seatProfiles: () => state.seatProfiles,
    abortDeadline: () => state.abortDeadline,
    forfeitDeadline: config.chrome?.forfeitDeadline ?? (() => null),
    roomMode: config.chrome?.roomMode ?? (() => 'pvp'),
    room: () => state.room,
    debugRequested: config.chrome?.debugRequested ?? (() => false),
    isReplayLive: () => replay.isLive(),
    orientation,
    playAgainRequestBody: () => config.playAgainRequestBody(state),
    rematchControls: config.chrome?.rematchControls ?? (() => null),
    ...(config.chrome?.variantDetail ? { variantDetail: config.chrome.variantDetail } : {}),
  });

  // ── Frame application ──────────────────────────────────────────────────────

  function applyFrame(frame: TenantLiveFrame<C, V>): void {
    state.seat = frame.seat;
    state.view = frame.state;
    state.clock = frame.clock ?? null;
    state.timeControl = frame.timeControl ?? state.timeControl;
    state.seats = frame.seats ?? state.seats;
    // Branded on the way in, not at each render site: the room paints these
    // names into the meta card, the clock rows, and the seat labels, and an
    // engine seat should read "Misty" in all three rather than "Misty DXQ 1.1"
    // in whichever one was missed.
    state.seatDisplayNames = frame.seatDisplayNames
      ? brandSeatDisplayNames(frame.seatDisplayNames)
      : state.seatDisplayNames;
    // Kept in lockstep with the names above: a frame that carries one carries
    // the other, so a re-branded name never keeps a stale seat's link.
    state.seatProfiles = frame.seatDisplayNames ? (frame.seatProfiles ?? {}) : state.seatProfiles;
    if (frame.connectedSeats) state.connectedSeats = frame.connectedSeats;
    state.abortDeadline = frame.abortDeadline ?? null;
    if (frame.events) state.events = frame.events;
    config.onFrame?.(frame);
  }

  // Replay-history injection (#80): after a hello/snapshot — mount, reconnect,
  // seq-gap resync — the client holds only the latest view, so scrubbing has a
  // single ply. Tenants that can replay their event log through the variant
  // kernel (perfect information only; fog logs are redacted) rebuild the full
  // per-ply history here. Event-appended frames keep the incremental capture
  // path — the server view that rides each event is captured as its ply.
  function rebuildReplayHistory(): void {
    const view = state.view;
    if (!config.replayHistory || !view) return;
    const snapshots = config.replayHistory.rebuild({ events: state.events, view, state });
    if (!snapshots || snapshots.length === 0) return;
    // The server-sent view is authoritative for the latest ply: kernel replay
    // cannot derive non-move endings (resignation, timeout, abandonment).
    const rebuilt = [...snapshots];
    const last = rebuilt[rebuilt.length - 1];
    rebuilt[rebuilt.length - 1] = { ply: last.ply, view };
    replay.replaceHistory(rebuilt);
    lastCapturedView = view;
    lastCapturedKey = config.replayCapture.positionKey(view);
  }

  function applyEventFrame(frame: TenantLiveFrame<C, V>): void {
    const events = state.events;
    applyFrame(frame);
    state.events = events;
    if (frame.event) {
      state.events = [...events, frame.event];
      // Fog safety: the ONLY live-animation source is a move event the server
      // chose to send this client (isMoveEvent gates the shape). Redacted or
      // non-move events never arm the channel, and nothing here diffs boards.
      if (moveList.isMoveEvent(frame.event)) {
        pendingLiveAnimation = { move: frame.event.move, color: frame.event.color };
      }
    }
    config.onEventApplied?.();
  }

  // Drain both animation sources into the one-shot union the hook consumes.
  // Called once per renderAll so a stale live move can never outlive the render
  // that followed its event (scrubs/reconnects drop it).
  function consumePendingAnimation(prevView: V | null): TenantPendingAnimation<C, V, M> | null {
    const live = pendingLiveAnimation;
    pendingLiveAnimation = null;
    const step = replay.takeLastStep();
    if (step && Math.abs(step.toPly - step.fromPly) === 1) {
      return {
        kind: 'scrub',
        direction: step.toPly > step.fromPly ? 'forward' : 'back',
        prevView,
      };
    }
    if (step) return null; // multi-ply jump: render discretely
    return live ? { kind: 'live', ...live } : null;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  function bootstrap(): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) throw new Error('missing #app');

    const params = new URLSearchParams(window.location.search);
    const room =
      roomIdFromPath(window.location.pathname) ?? params.get('room') ?? config.defaultRoomId;
    state.room = room;
    lastCapturedView = null;
    lastCapturedKey = null;
    pendingLiveAnimation = null;
    lastDisplayedView = null;
    lifecycleEffects?.destroy();
    lifecycleEffects = null;
    replay.reset();
    chrome.resetState();
    initLiveSound();
    resetLiveSoundState();
    config.resetSounds?.();
    config.resetState?.();

    if (params.get('reset') === '1') {
      clearSeatTokenForRoom(room);
      params.delete('reset');
      const search = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    }

    refs = createLiveLayout(app, { debugRequested: false, roomId: room });
    const boardStage = refs.board.closest<HTMLElement>('.board-stage');
    if (!boardStage) throw new Error('missing board stage');
    lifecycleEffects = createLiveLifecycleEffects(boardStage);
    setLiveLayoutGameSpec(app, config.layoutGameSpecId ?? config.gameSpecId);
    chrome.setRenderTarget(refs, {
      sendSocket: send,
      reconnectNow: () => socket?.connect(),
    });

    config.setup({
      state,
      refs,
      replay,
      chrome,
      send,
      connection,
      renderAll,
      displayedView,
      canActNow,
      orientation,
    });

    const createSocket = config.socketFactory ?? createTenantSocketClient;
    socket = createSocket({
      room,
      applyHello: (frame) => {
        applyFrame(frame as TenantLiveFrame<C, V>);
        rebuildReplayHistory();
      },
      applySnapshot: (frame) => {
        applyFrame(frame as TenantLiveFrame<C, V>);
        rebuildReplayHistory();
        config.onSnapshotApplied?.();
      },
      applyEvent: (frame) => applyEventFrame(frame as TenantLiveFrame<C, V>),
      ...(config.onServerMessage ? { onServerMessage: config.onServerMessage } : {}),
      ...(config.onRematchState ? { onRematchState: config.onRematchState } : {}),
      render: renderAll,
    });
    socket.connect();
    socket.startPing();
    window.setInterval(() => {
      chrome.tickClocks();
      chrome.tickCountdowns();
    }, 100);
    document.addEventListener('keydown', (event) => replay.handleKeyboard(event, renderAll));
    renderAll();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderAll(): void {
    if (!refs) return;
    chrome.resetHostPanels();
    chrome.renderMeta();
    chrome.renderClocks();

    const view = state.view;
    captureReplayView(view);
    const displayed = replay.currentView(view);
    updateLifecycleEffects(view);
    trackGameLifecycle(view);
    // Drain the animation channel on EVERY render (even disabled/hook-less
    // paths) so nothing stale carries into a later, unrelated render.
    const pendingAnimation = consumePendingAnimation(lastDisplayedView);
    lastDisplayedView = displayed;
    if (moveList.listClass) refs.moveList.classList.add(moveList.listClass);
    replay.renderShell(refs, renderAll);
    refs.boardStatus.hidden = view !== null;
    chrome.renderActionStatus();
    chrome.renderGameControls();
    chrome.renderRoomActions();

    if (!tenant.enabled()) {
      refs.board.className = `board ${config.boardClass} ${config.boardClass}--disabled`;
      refs.board.replaceChildren();
      config.onDisabled?.(refs);
      return;
    }

    config.renderBoard(refs, displayed);
    config.renderExtras?.(refs, displayed);
    renderMoveList(refs);
    if (config.animateBoard) {
      let taken: TenantPendingAnimation<C, V, M> | null = pendingAnimation;
      config.animateBoard(refs, displayed, () => {
        const value = taken;
        taken = null;
        return value;
      });
    }
  }

  // Start/finish funnel for every tenant variant. Until 2026-08-28 this fired
  // only from live-render.ts (the legacy chess stack) and Dark Mini Xiangqi, so
  // banqi, jieqi, xiangqi, fortress, fog xiangqi and jungle emitted no game
  // events at all. Ninety days of `game_started` was 24 events, every one of
  // them fog chess, which reads as "nobody plays the tenant variants" and
  // actually meant "nobody measures them".
  //
  // It lives here rather than in each room module for the same reason the board
  // -coordinates preference got one accessor: N call sites is N chances for the
  // next variant to be the one that misses.
  const lifecycleTracker = createGameLifecycleTracker();
  // Resolved once. The id comes from route config and does not change for the
  // life of a client.
  const lifecycleSpecProps = maybeGameSpecAnalyticsProps(config.gameSpecId);

  // 'setup' is this stack's name for what the legacy stack calls 'pregame'.
  // Mapped rather than passed through so one event schema describes both.
  function lifecycleStatusType(status: V['status']['type']): GameLifecycleStatusType {
    return status === 'setup' ? 'pregame' : (status as GameLifecycleStatusType);
  }

  // The seat the viewer is not sitting in. In a bot room that is the engine,
  // already collapsed to its brand by brandSeatDisplayNames, so the funnel can
  // say which bot a first game was played against.
  function opponentSeatName(): string | null {
    // A spectator has no opponent: without the seat we cannot tell which name
    // is the engine, and guessing would put a human account in bot_name.
    if (state.seat === null || state.seat === 'spectator') return null;
    for (const [color, name] of Object.entries(state.seatDisplayNames)) {
      if (color !== state.seat && typeof name === 'string') return name;
    }
    return null;
  }

  function trackGameLifecycle(view: V | null): void {
    if (config.emitsOwnLifecycleAnalytics) return;
    // Scrubbing a replay is not playing, and re-entering a finished room must
    // not re-emit its finish.
    if (!view || !replay.isLive()) return;
    const timeControl = state.timeControl ?? state.clock;
    const baseProps = {
      gameId: view.id,
      variant: config.gameSpecId,
      ...(lifecycleSpecProps ?? {}),
      // The tenant stack carries no per-room rated flag, so this is unknown
      // here rather than false. Do not substitute a guess: the legacy stack
      // reports a real value and a fabricated one would silently pool with it.
      rated: null,
      ...roomModeAnalyticsProps(config.chrome?.roomMode?.() ?? 'pvp', opponentSeatName()),
      initialMs: timeControl?.initialMs ?? null,
      incrementMs: timeControl?.incrementMs ?? null,
      time_class: timeControl
        ? classifyTimeControl(timeControl.initialMs, timeControl.incrementMs)
        : null,
    };
    const status = view.status;
    lifecycleTracker.update({
      statusType: lifecycleStatusType(status.type),
      baseProps,
      outcome:
        status.type === 'finished'
          ? { winner: status.winner, reason: status.reason, moveNumber: view.moveNumber }
          : null,
    });
  }

  function updateLifecycleEffects(view: V | null): void {
    if (!lifecycleEffects || !view) return;
    const seated = tenant.isColor(state.seat);
    const opponentConnected =
      seated &&
      Object.entries(state.connectedSeats).some(
        ([color, connected]) => color !== state.seat && connected === true,
      );
    const roomMode = config.chrome?.roomMode?.() ?? 'pvp';
    const ready =
      roomMode !== 'correspondence' &&
      (roomMode !== 'pvp' || view.moveNumber >= 2 || opponentConnected);
    lifecycleEffects.update({
      gameId: view.id,
      status: view.status.type,
      moveNumber: view.moveNumber,
      ready,
      seated,
      isLive: replay.isLive(),
      seat: seated ? state.seat : null,
      winner: view.status.type === 'finished' ? view.status.winner : null,
    });
  }

  // ── Move list (two-column, first mover left) ───────────────────────────────

  type MoveRow = { fullMove: number } & Partial<Record<C, string>>;

  function renderMoveList(liveRefs: LiveRefs): void {
    const moves = state.events.filter(moveList.isMoveEvent);
    // A tenant-owned renderer (clickable ply-jump lists) replaces the standard
    // two-column list wholesale; the replay shell above it is already rendered.
    if (moveList.render) {
      moveList.render({
        refs: liveRefs,
        moves,
        activePly: replay.activePly(),
        latestPly: replay.latestPly(),
        isLive: replay.isLive(),
        jumpToPly: (ply) => {
          replay.jumpToPly(ply);
          renderAll();
        },
      });
      return;
    }
    // Fog tenants trim to the scrubbed ply (a fog replay only shows what had
    // been received by then); perfect-info tenants keep the full list and rely
    // on the active-ply highlight. plyWindow overrides the default coupling.
    const window = moveList.plyWindow ?? (moveList.masked ? 'visible' : 'all');
    const plyCount = window === 'visible' ? replay.visiblePlyCount() : replay.latestPly();
    liveRefs.moveList.replaceChildren();
    const banner = moveList.banner?.();
    if (banner) {
      const item = document.createElement('li');
      item.className = banner.className;
      item.textContent = banner.text;
      liveRefs.moveList.append(item);
    }
    // Zero moves renders an empty list (lichess parity): no placeholder row.
    if (plyCount === 0) return;
    const activePly = replay.activePly();
    for (const row of visibleMoveRows(moves, plyCount)) {
      const item = document.createElement('li');
      item.className = moveList.rowClass;
      const number = document.createElement('span');
      number.className = `${moveList.cellPrefix}__number`;
      number.textContent = `${row.fullMove}.`;
      item.append(
        number,
        moveCell(row[tenant.colors[0]], row.fullMove * 2 - 1, activePly, plyCount),
        moveCell(row[tenant.colors[1]], row.fullMove * 2, activePly, plyCount),
      );
      liveRefs.moveList.append(item);
    }
    syncMoveListScroll(liveRefs.moveList, { live: replay.isLive(), plyCount: replay.latestPly() });
  }

  function moveCell(
    text: string | undefined,
    ply: number,
    activePly: number | null,
    plyCount: number,
  ): HTMLElement {
    // A ply within the played range with no notation is a redacted opponent
    // move (fog): render the masked placeholder, never the move.
    const masked = moveList.masked && !text && ply <= plyCount;
    const played = ply <= plyCount;
    // Only a ply this client can actually display is a jump target, matching the
    // chess shell (live-move-list.ts): a masked ply is one the server never sent
    // and an unplayed cell is empty, so offering either as a control would
    // promise a position that does not exist here. The jump itself is fog-safe
    // by construction — jumpToPly picks an index in the captured snapshot
    // history and never reconstructs a view the server withheld.
    const jumpable = played && !masked && !!text;
    const cell = document.createElement(jumpable ? 'button' : 'span');
    cell.className = [
      `${moveList.cellPrefix}__move`,
      jumpable ? 'move-jump' : '',
      masked ? 'masked' : '',
      activePly === ply ? 'active' : '',
    ]
      .filter(Boolean)
      .join(' ');
    cell.textContent = played ? (text ?? '...') : '';
    if (cell instanceof HTMLButtonElement) {
      cell.type = 'button';
      cell.title = `Move ${Math.ceil(ply / 2)}`;
      cell.addEventListener('click', () => {
        replay.jumpToPly(ply);
        renderAll();
      });
    }
    return cell;
  }

  function visibleMoveRows(moves: readonly TenantMovePlayed<C, M>[], plyCount: number): MoveRow[] {
    const rows = new Map<number, MoveRow>();
    for (let fullMove = 1; fullMove <= Math.ceil(plyCount / 2); fullMove += 1) {
      rows.set(fullMove, { fullMove } as MoveRow);
    }
    moves.forEach((event, index) => {
      const ply = eventPly(event, index);
      if (ply > plyCount) return;
      const fullMove = Math.floor((ply - 1) / 2) + 1;
      const row = rows.get(fullMove) ?? ({ fullMove } as MoveRow);
      row[event.color] = moveList.notate(event.move) as MoveRow[C];
      rows.set(fullMove, row);
    });
    return [...rows.values()].sort((a, b) => a.fullMove - b.fullMove);
  }

  function eventPly(event: TenantMovePlayed<C, M>, fallbackIndex: number): number {
    return Number.isInteger(event.ply) && event.ply && event.ply > 0
      ? event.ply
      : fallbackIndex + 1;
  }

  // ── Replay capture ─────────────────────────────────────────────────────────
  // Pushes each distinct received view keyed by its derived ply. Fog clients
  // only ever hold their OWN per-seat views, so scrubbing can never surface
  // hidden state.

  function captureReplayView(view: V | null): void {
    if (!view || view === lastCapturedView) return;
    const key = config.replayCapture.positionKey(view);
    const changed = key !== lastCapturedKey;
    const ply = config.replayCapture.plyForView(view, {
      positionChanged: changed,
      latestPly: replay.latestPly(),
      events: state.events,
    });
    if (!changed && ply <= replay.latestPly()) {
      lastCapturedView = view;
      return;
    }
    replay.push({ ply, view });
    lastCapturedView = view;
    lastCapturedKey = key;
  }

  return { bootstrap, state, renderAll, send, connection, replay };
}

/** Seat names as the room should show them: engine builds collapse to the brand. */
function brandSeatDisplayNames<C extends string>(
  names: Partial<Record<C, string>>,
): Partial<Record<C, string>> {
  const branded: Partial<Record<C, string>> = {};
  for (const [color, name] of Object.entries(names) as [C, string | undefined][]) {
    if (name === undefined) continue;
    branded[color] = brandedEngineName(name) ?? name;
  }
  return branded;
}
