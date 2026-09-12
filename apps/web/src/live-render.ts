import { boardFen, mountBoard } from '@mistboard/board-render/interactive';
import type { Color, GameEvent, Move, PlayerView, Square } from '@mistboard/game';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type * as cg from 'chessground/types';
import { readAccountPreferences } from './account-preferences.js';
import {
  classifyTimeControl,
  createGameLifecycleTracker,
  gameSpecAnalyticsProps,
  roomModeAnalyticsProps,
} from './analytics.js';
import { chessgroundAnimation } from './board-anim.js';
import { type I18nKey, t } from './i18n/catalog.js';
import {
  boardHighlightClasses,
  boardResultClass,
  castlingKingDestinationFromView,
  legalDests,
  squareFileIndex,
} from './live-board.js';
import { renderCaptures as renderCaptureRows } from './live-captures.js';
import {
  renderClocks as renderClockRows,
  resetClockState,
  tickClockTimers as tickClockRows,
} from './live-clocks.js';
import { renderDevViews as renderDevViewRows } from './live-dev-views.js';
import {
  renderGameControls as renderGameControlRows,
  updateAbortCountdown as updateGameControlCountdown,
} from './live-game-controls.js';
import { createLiveLayout, setLiveLayoutGameSpec } from './live-layout.js';
import { createLiveLifecycleEffects, type LiveLifecycleEffects } from './live-lifecycle-effects.js';
import { renderReplay, resetMoveListState } from './live-move-list.js';
import { captureFogView, initReplay, isLive, resetReplayState } from './live-replay.js';
import {
  renderRoomActions as renderRoomActionRows,
  shouldShowPostGameRoomActions as shouldShowPostGameRoomActionRows,
} from './live-room-actions.js';
import { initLiveSound, playSound, resetLiveSoundState, soundForOwnMove } from './live-sound.js';
import {
  isPlayableSeat,
  type LiveRefs,
  liveState,
  type PendingPromotion,
  type PromotionRole,
} from './live-state.js';
import {
  actionBody,
  actionTitle,
  actionTone,
  boardStatusLabel,
  boardStatusTone,
  connectionNoticeMode,
  modeLabel,
  reasonPhraseLabel,
  rejectedSignInHref,
  seatLabel,
} from './live-status.js';
import { currentCaptures, currentView } from './live-view.js';
import { createGameMetaCard, seatResultScores } from './review/game-meta-card.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import { activeLiveShellTenant, liveShellTenants } from './variant-tenant/live-shell.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';
import { variantMiniIdForRawVariant } from './variants.js';
import { escapeHtml, isColor } from './web-utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const promotionRoles: PromotionRole[] = ['queen', 'rook', 'bishop', 'knight'];

// ── Module-scope render-only state ────────────────────────────────────────────

let refs!: LiveRefs;
let sendSocket: (payload: unknown) => boolean = () => false;
let reconnectNow: () => void = () => {};
let ground: Api | null = null;
// Which game the board's current right-click annotations belong to.
let drawShapeGameId: string | null = null;
let pendingPromotion: PendingPromotion | null = null;
let orientation: Color = 'white';
let lifecycleEffects: LiveLifecycleEffects | null = null;

const lifecycleTracker = createGameLifecycleTracker();

// ── Init ──────────────────────────────────────────────────────────────────────

export function initRender(
  target: HTMLDivElement,
  callbacks: { sendSocket: (payload: unknown) => boolean; reconnectNow: () => void },
): void {
  sendSocket = callbacks.sendSocket;
  reconnectNow = callbacks.reconnectNow;
  resetReplayState();
  for (const tenant of liveShellTenants()) tenant.resetReplayState();
  initReplay({
    onStateChange: () => {
      reconcileInteractionState();
      render();
    },
  });
  lifecycleTracker.reset();
  resetMoveListState();
  resetClockState();
  refs = createLiveLayout(target, {
    debugRequested: liveState.debugRequested,
    roomId: liveState.room,
  });
  const boardStage = refs.board.closest<HTMLElement>('.board-stage');
  if (!boardStage) throw new Error('missing board stage');
  lifecycleEffects?.destroy();
  lifecycleEffects = createLiveLifecycleEffects(boardStage);
  installSelectionClickAway({
    roots: () => [refs.board, refs.promotion],
    hasSelection: () => pendingPromotion === null && ground !== null,
    clearSelection: () => ground?.selectSquare(null),
  });
  initLiveSound();
  resetLiveSoundState();
}

// ── Main render ───────────────────────────────────────────────────────────────

export function render(): void {
  setLiveLayoutGameSpec(refs.board.closest('#app') ?? document.body, liveState.gameSpecId);
  const shellTenant = activeLiveShellTenant();
  updateLifecycleEffects(shellTenant?.isReplayLive() ?? isLive());
  if (shellTenant) {
    destroyChessBoardForAlternateRenderer();
    captureFogView();
    shellTenant.render(refs, { sendSocket, reconnectNow });
    return;
  }
  captureFogView();
  const view = currentView();
  trackGameLifecycle(view);
  // For seated players, lock orientation to their own seat regardless of what
  // the view's perspective field says — fog history views can carry a stale or
  // mismatched perspective if the server state was captured before the seat was
  // confirmed. Spectators fall back to the view's perspective.
  const nextOrientation = isColor(liveState.seat) ? liveState.seat : (view?.perspective ?? 'white');
  orientation = nextOrientation;

  if (liveState.debugRequested) refs.roomMeta.innerHTML = roomMetaHtml();
  renderBoardStatus(view);

  renderActionStatus(view);
  renderGameInfo(view);
  renderClockRows(refs, view);
  renderCaptureRows(refs, view);
  renderRoomActionRows(refs, { sendSocket });
  renderGameControlRows(refs, view, sendSocket);
  renderDevViewRows(refs);
  renderReplay(refs);
  renderBoard(view);
  renderBoardResult(view);
  renderPromotion();
}

function updateLifecycleEffects(replayIsLive: boolean): void {
  const view = liveState.state;
  if (!lifecycleEffects || !view) return;
  const seated = isPlayableSeat(liveState.seat);
  const opponentConnected =
    seated &&
    Object.entries(liveState.connectedSeats).some(
      ([color, connected]) => color !== liveState.seat && connected === true,
    );
  const correspondence =
    liveState.roomMode === 'correspondence' || liveState.timeControl?.daysPerMove !== undefined;
  const ready =
    !correspondence &&
    (liveState.solo || liveState.roomMode !== 'pvp' || view.moveNumber >= 2 || opponentConnected);
  lifecycleEffects.update({
    gameId: view.id,
    status: view.status.type,
    moveNumber: view.moveNumber,
    ready,
    seated,
    isLive: replayIsLive,
    seat: seated ? liveState.seat : null,
    winner: view.status.type === 'finished' ? view.status.winner : null,
  });
}

function trackGameLifecycle(view: PlayerView | null): void {
  if (!view || !isLive()) return;
  const statusType = view.status.type;
  const baseProps = {
    gameId: view.id,
    variant: view.variant,
    ...gameSpecAnalyticsProps({ variant: view.variant }),
    rated: liveState.rated,
    ...roomModeAnalyticsProps(liveState.roomMode),
    initialMs: view.clock?.initialMs ?? null,
    incrementMs: view.clock?.incrementMs ?? null,
    time_class:
      view.clock != null ? classifyTimeControl(view.clock.initialMs, view.clock.incrementMs) : null,
  };
  const outcome =
    statusType === 'finished'
      ? (() => {
          const finished = view.status as {
            type: 'finished';
            winner: 'white' | 'black' | null;
            reason: string;
          };
          return { winner: finished.winner, reason: finished.reason, moveNumber: view.moveNumber };
        })()
      : null;
  lifecycleTracker.update({ statusType, baseProps, outcome });
}

function renderActionStatus(view: PlayerView | null): void {
  refs.actionStatus.replaceChildren();
  refs.actionSection.hidden = false;
  // While the player is mid-game we keep this panel hidden and let the board +
  // clocks carry the state. A reconnect only un-hides it once it has escalated
  // to the 'banner' tier; below that the own-seat presence dot is the signal, so
  // a sub-second blip never pops (and re-collapses) the panel. See
  // connectionNoticeMode().
  const showBanner = connectionNoticeMode() === 'banner';
  if (view?.status.type === 'playing' && isLive() && isColor(liveState.seat) && !showBanner) {
    refs.actionSection.hidden = true;
    return;
  }
  const notice = document.createElement('div');
  const tone = actionTone(view);
  notice.className = `action-notice ${tone}`;

  const title = document.createElement('strong');
  title.textContent = actionTitle(view);
  const body = document.createElement('span');
  body.textContent = actionBody(view);
  notice.append(title, body);

  if (
    showBanner &&
    (liveState.connectionState === 'disconnected' || liveState.connectionState === 'reconnecting')
  ) {
    const reconnect = document.createElement('button');
    reconnect.type = 'button';
    reconnect.textContent = t('live.reconnectNow');
    reconnect.addEventListener('click', reconnectNow);
    notice.append(reconnect);
  }

  if (showBanner && liveState.connectionState === 'rejected') {
    const signInHref = rejectedSignInHref();
    if (signInHref) {
      const signIn = document.createElement('a');
      signIn.href = signInHref;
      signIn.textContent = t('live.signInTakeSeat');
      notice.append(signIn);
    }
  }

  refs.actionStatus.append(notice);
}

// Lichess-style meta card (mirrors the tenant room-chrome renderMeta): time
// control + mode headline, variant name, seats as player rows, stateful
// bottom line. Degraded-connection detail moves to a small trailing row.
function renderGameInfo(view: PlayerView | null): void {
  const fmt = formatLabel(view);
  const timeLabel = timeControlLabel(view);
  const modeEntry = modeDetailEntry();
  const status = view?.status ?? null;

  let subline: string | null = null;
  let statusLine: string | null = null;
  if (status?.type === 'finished') {
    // The reason used to render its own wire value here ('king captured' via a
    // dash strip); it now goes through the same keyed phrases as live-status.
    const reason = reasonPhraseLabel(status.reason);
    statusLine = status.winner
      ? t('result.colorVictorious', {
          color: status.winner === 'white' ? t('setup.white') : t('setup.black'),
          reason: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`,
        })
      : t('result.drawByReason', { reason });
  } else if (status?.type === 'aborted') {
    statusLine = t('live.statusGameAborted');
  } else if (status?.type === 'playing') {
    subline = t('live.playingRightNow');
  }

  // The status line above names the winning COLOUR; these score the ROWS, so a
  // finished game reads without a hop back to the discs.
  const seats = ['white', 'black'] as const;
  const scores = seatResultScores(
    status?.type === 'finished' ? (status.winner ? `${status.winner}-wins` : 'draw') : null,
    seats,
  );

  const card = createGameMetaCard({
    // Same finalized marker the picker/watch/review surfaces use; the ♔ glyph
    // stays only as the fallback for a variant string we can't map.
    markerId: metaMarkerId(view) ?? undefined,
    glyph: '♔',
    headline: [timeLabel, modeEntry ? modeEntry[1] : t('live.modeCasual')],
    variantName: fmt,
    subline,
    players: seats.map((color, index) => {
      const colorName = color === 'white' ? t('setup.white') : t('setup.black');
      return {
        color,
        name: liveState.seat === color ? t('live.youAre', { color: colorName }) : colorName,
        score: scores[index] ?? null,
      };
    }),
    status: statusLine,
  });
  refs.gameInfo.replaceChildren(card.el);
  // Connection only surfaces when degraded — green-path "Connected · 1ms" is noise.
  // The wrapper carries the .game-info styling the row expects (the region
  // itself no longer has it, so it can't mangle the meta card).
  if (liveState.connectionState !== 'connected') {
    const connLabel = connectionDetailLabel();
    if (connLabel) {
      const wrap = document.createElement('div');
      wrap.className = 'game-info';
      wrap.append(infoItem(t('live.connectionLabel'), connLabel));
      refs.gameInfo.append(wrap);
    }
  }
}

// Marker for the meta card's icon box. Mirrors formatLabel's variant resolution
// (view → snapshot → requested).
function metaMarkerId(view: PlayerView | null): VariantMiniId | null {
  const variant = view?.variant ?? liveState.state?.variant ?? liveState.variantRequested;
  return variantMiniIdForRawVariant(variant ?? 'dark-chess');
}

function formatLabel(view: PlayerView | null): string {
  const variant = view?.variant ?? liveState.state?.variant ?? liveState.variantRequested;
  return variant === 'dark-chess' ? t('live.variantFogChess') : capitalize(variant ?? 'dark chess');
}

function timeControlLabel(view: PlayerView | null): string | null {
  // Day-scale rooms label by their per-move allowance; minutes+increment and
  // the live time classes are meaningless at days cadence.
  const daysPerMove = liveState.timeControl?.daysPerMove;
  if (typeof daysPerMove === 'number' && daysPerMove > 0) {
    const days =
      daysPerMove === 1
        ? t('live.oneDayPerMove')
        : t('live.daysPerMoveCount', { count: daysPerMove });
    return t('live.perMoveCorrespondence', { days });
  }
  let initialMs: number | null = null;
  let incrementMs: number | null = null;
  if (view?.clock) {
    initialMs = view.clock.initialMs;
    incrementMs = view.clock.incrementMs;
  } else {
    const roomCreated = liveState.events.find(
      (e): e is Extract<GameEvent, { type: 'room-created' }> => e.type === 'room-created',
    );
    if (roomCreated?.timeControl) {
      initialMs = roomCreated.timeControl.initialMs;
      incrementMs = roomCreated.timeControl.incrementMs;
    }
  }
  if (initialMs === null || incrementMs === null) return null;
  const minutes = Math.round(initialMs / 60_000);
  const incSec = Math.round(incrementMs / 1000);
  const compact = incSec > 0 ? `${minutes}+${incSec}` : `${minutes}+0`;
  const klass = classifyTimeControl(initialMs, incrementMs);
  return klass
    ? t('live.timeControlWithClass', { control: compact, timeClass: t(TIME_CLASS_KEYS[klass]) })
    : compact;
}

const TIME_CLASS_KEYS: Record<ReturnType<typeof classifyTimeControl>, I18nKey> = {
  blitz: 'live.timeClassBlitz',
  bullet: 'live.timeClassBullet',
  classical: 'live.timeClassClassical',
  rapid: 'live.timeClassRapid',
};

function modeDetailLabel(): string {
  if (liveState.solo) return t('live.modeSoloDev');
  if (liveState.roomMode === 'pve') {
    const engine = liveState.pveEngineName ?? t('live.engineFallbackName');
    return t('live.modeVsEngine', { engine });
  }
  if (liveState.roomMode === 'eve') return t('live.modeEngineVsEngine');
  if (liveState.roomMode === 'imported') return t('live.modeImportedGame');
  if (liveState.roomMode === 'manual') return t('live.modeManualSetup');
  return liveState.rated ? t('live.modeRated') : t('live.modeCasual');
}

function modeDetailEntry(): [string, string] | null {
  if (liveState.roomMode === 'pve') return null;
  return [t('live.modeLabel'), modeDetailLabel()];
}

function connectionDetailLabel(): string | null {
  switch (liveState.connectionState) {
    case 'connected':
      return liveState.latencyMs !== null
        ? t('live.connConnectedWithLatency', { latency: liveState.latencyMs })
        : t('live.connConnected');
    case 'connecting':
      return t('live.statusConnecting');
    case 'reconnecting':
      return t('live.connReconnectingAttempt', { attempt: liveState.reconnectAttempt });
    case 'disconnected':
      return t('live.connDisconnected');
    case 'displaced':
      return t('live.statusSessionMoved');
    case 'rejected':
      return t('live.connRejected');
    default:
      return null;
  }
}

export function updateAbortCountdown(): void {
  updateGameControlCountdown(refs);
}

// ── Room actions ──────────────────────────────────────────────────────────────

export function shouldShowPostGameRoomActions(view: PlayerView | null): boolean {
  return shouldShowPostGameRoomActionRows(view);
}

export function tickClockTimers(view: PlayerView | null): void {
  tickClockRows(refs, view);
}

// ── Board ─────────────────────────────────────────────────────────────────────

function renderBoard(view: PlayerView | null): void {
  const moveColor = activeMoveColor();
  const ownSeat = isColor(liveState.seat) ? liveState.seat : null;
  const paused = liveState.paused === true && view?.status.type === 'playing';
  // Displaced/rejected are terminal: the socket is closed and will not
  // reconnect, so any move the board accepts can never be sent or reconciled
  // against the true game. Lock the board to view-only in these states.
  const connectionLost =
    liveState.connectionState === 'displaced' || liveState.connectionState === 'rejected';
  const canInteractWithOwnPieces =
    !connectionLost &&
    isLive() &&
    view?.status.type === 'playing' &&
    !paused &&
    (liveState.solo || ownSeat !== null) &&
    pendingPromotion === null;
  const boardIsLive = canInteractWithOwnPieces && moveColor !== null;
  const movableColor = boardIsLive ? moveColor : ownSeat;
  const premovesEnabled = readAccountPreferences().premoves;
  if (!premovesEnabled) ground?.cancelPremove();
  const dests = view ? legalDests(view) : new Map<cg.Key, cg.Key[]>();
  // Chessground wipes state.drawable.shapes on any set() carrying a fen, and this
  // config always carries one, so the board must hand its own arrows/circles back
  // or every render erases them. Client-only: nothing reaches the server.
  const shapeGame = drawShapeGameOf(view);
  const keepShapes = shapeGame !== null && shapeGame === drawShapeGameId;
  drawShapeGameId = shapeGame;
  refs.board.classList.toggle('finished-board', view?.status.type === 'finished');
  refs.board.classList.toggle('paused-board', paused);
  renderPausedOverlay(paused);
  const config = {
    // Rebuilt on every render, so a pieceAnimation pref change applies live.
    // Fog chess (dark-chess) forces animation off: a glide would imply a
    // hidden origin/destination the server redacted.
    animation: chessgroundAnimation({ fog: view?.variant === 'dark-chess' }),
    autoCastle: true,
    coordinates: false,
    coordinatesOnSquares: false,
    drawable: { shapes: keepShapes && ground ? [...ground.state.drawable.shapes] : [] },
    fen: view ? boardFen(view.board) : '8/8/8/8/8/8/8/8',
    highlight: {
      custom: view ? boardHighlightClasses(view, orientation) : new Map(),
      lastMove: true,
    },
    lastMove: view?.lastMove ? ([view.lastMove.from, view.lastMove.to] as cg.Key[]) : undefined,
    movable: {
      color: movableColor ?? undefined,
      dests,
      free: false,
      rookCastle: true,
      showDests: true,
      events: {
        after: (from: cg.Key, to: cg.Key) => sendBoardMove(from, to),
      },
    },
    orientation,
    premovable: {
      castle: true,
      customDests: dests,
      enabled: shouldEnablePremoves({
        preferenceEnabled: premovesEnabled,
        canInteractWithOwnPieces,
        boardIsLive,
        hasSeat: ownSeat !== null,
      }),
      showDests: true,
    },
    selectable: { enabled: canInteractWithOwnPieces },
    draggable: { enabled: true, showGhost: true },
    turnColor: view?.status.type === 'playing' ? view.status.turn : undefined,
    viewOnly: false,
  } satisfies Config;

  if (ground) {
    ground.set(config);
    ensureDragGhostElement();
    maybePlayPremove();
    return;
  }

  ground = mountBoard(refs.board, config);
  liveState.ground = ground;
  installInkPreservation();
  ensureDragGhostElement();
  maybePlayPremove();
}

// Chessground erases every drawn shape on the first left press of a move
// (draw.clear, from drag.start). Its `eraseOnClick` flag only narrows that to
// empty squares, so there is no config that turns it off outright — and we want
// it off outright: a shape goes away when the player re-draws it, and not
// because they played a move. So mirror the ink just before the press and put it
// back straight after.
//
// pointerdown always precedes mousedown, and this mousedown listener sits on the
// wrapper while chessground's sits on the inner <cg-board>, so ours runs after
// its clear within the same event. Nothing paints in between, so there is no
// flash.
function installInkPreservation(): void {
  let inkBeforePress: DrawShape[] = [];
  refs.board.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && ground) inkBeforePress = [...ground.state.drawable.shapes];
  });
  refs.board.addEventListener('mousedown', () => {
    if (!ground || inkBeforePress.length === 0) return;
    if (ground.state.drawable.shapes.length === 0) ground.setShapes(inkBeforePress);
    inkBeforePress = [];
  });
}

/** Which game owns the board's right-click annotations: they are per-game
 *  working memory, kept across turns inside one playing game and dropped when it
 *  ends or a rematch swaps in a new id. Null means nothing to carry. */
export function drawShapeGameOf(view: PlayerView | null): string | null {
  return view?.status.type === 'playing' ? view.id : null;
}

export function shouldEnablePremoves(input: {
  preferenceEnabled: boolean;
  canInteractWithOwnPieces: boolean;
  boardIsLive: boolean;
  hasSeat: boolean;
}): boolean {
  return (
    input.preferenceEnabled && input.canInteractWithOwnPieces && !input.boardIsLive && input.hasSeat
  );
}

function ensureDragGhostElement(): void {
  if (!ground || refs.board.querySelector('piece.ghost')) return;
  ground.redrawAll();
}

function maybePlayPremove(): void {
  if (
    !ground ||
    !readAccountPreferences().premoves ||
    activeMoveColor() === null ||
    pendingPromotion !== null
  ) {
    return;
  }
  ground.playPremove();
}

function renderPausedOverlay(paused: boolean): void {
  refs.boardPaused.hidden = !paused;
  if (!paused) return;
  const title = refs.boardPaused.querySelector<HTMLElement>('[data-board-paused-title]');
  const body = refs.boardPaused.querySelector<HTMLElement>('[data-board-paused-body]');
  if (liveState.pauseReason === 'engine-error') {
    if (title) title.textContent = t('live.pausedEngineStopped');
    if (body) body.textContent = t('live.pausedEngineStoppedBody');
    return;
  }
  if (title) title.textContent = t('live.pausedTitle');
  if (body) body.textContent = t('live.pausedBody');
}

function renderBoardResult(view: PlayerView | null): void {
  const nextClass = boardResultClass(view);
  for (const className of ['king-celebrating-white', 'king-celebrating-black']) {
    refs.board.classList.toggle(className, className === nextClass);
  }
}

// ── Interaction state ─────────────────────────────────────────────────────────

export function reconcileInteractionState(): void {
  const shellTenant = activeLiveShellTenant();
  if (shellTenant) {
    shellTenant.reconcileInteractionState();
    return;
  }
  const view = currentView();
  if (!isLive() || !view || view.status.type !== 'playing') {
    pendingPromotion = null;
    ground?.cancelMove();
    ground?.cancelPremove();
    return;
  }

  if (pendingPromotion && !promotionMovesFor(pendingPromotion.from, pendingPromotion.to).length) {
    pendingPromotion = null;
    ground?.cancelMove();
    ground?.cancelPremove();
  }
}

function sendBoardMove(from: cg.Key, to: cg.Key): void {
  const view = currentView();
  const fromSquare = from as Square;
  const toSquare = to as Square;
  const promotions = promotionMovesFor(fromSquare, toSquare);
  if (promotions.length > 1) {
    pendingPromotion = {
      color: view?.board[fromSquare]?.color ?? activeMoveColor() ?? 'white',
      from: fromSquare,
      moves: promotions,
      to: toSquare,
    };
    renderBoard(view);
    renderPromotion();
    return;
  }

  const move = promotions[0] ?? bestMove(fromSquare, toSquare);
  if (!move) {
    renderBoard(view);
    return;
  }
  submitBoardMove(move, view);
}

function submitBoardMove(move: Move, view: PlayerView | null): void {
  if (!sendSocket({ type: 'move', ...move })) return;
  playSound(soundForOwnMove(view, move));
}

// Dev-only hook for browser-driven verification (synthetic chessground events
// are rejected because trustAllEvents is off). Remove or wall behind a stricter
// guard before flipping production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __mbDev?: object }).__mbDev = {
    move: (from: Square, to: Square, promotion?: PromotionRole) =>
      submitBoardMove({ from, to, ...(promotion ? { promotion } : {}) }, currentView()),
    view: () => currentView(),
    captures: () => currentCaptures(),
    events: () => liveState.events,
    render: () => render(),
  };
}

function bestMove(from: Square, to: Square) {
  return movesFor(from, to)[0];
}

function promotionMovesFor(from: Square, to: Square): Move[] {
  return movesFor(from, to).filter((move) => move.promotion);
}

function movesFor(from: Square, to: Square): Move[] {
  const view = currentView();
  if (!view) return [];
  const castlingAlias = view.legalMoves.filter(
    (move) => move.from === from && castlingKingDestinationFromView(view, move) === to,
  );
  if (castlingAlias.length > 0) return castlingAlias;
  return view.legalMoves.filter((move) => move.from === from && move.to === to);
}

// ── Promotion picker ──────────────────────────────────────────────────────────

function renderPromotion(): void {
  refs.promotion.replaceChildren();
  refs.promotion.hidden = pendingPromotion === null;
  refs.promotion.onclick = null;
  if (!pendingPromotion) return;

  refs.promotion.className = `promotion-picker cg-wrap ${pendingPromotion.color}`;
  refs.promotion.setAttribute('aria-label', t('live.choosePromotionPiece'));
  refs.promotion.onclick = (event) => {
    if (event.target !== refs.promotion) return;
    pendingPromotion = null;
    refs.promotion.hidden = true;
    renderBoard(currentView());
  };

  const fileIndex = squareFileIndex(pendingPromotion.to);
  const visualFile = orientation === 'white' ? fileIndex : 7 - fileIndex;
  const startsAtTop = pendingPromotion.color === orientation;

  for (const [index, role] of promotionRoles.entries()) {
    const move = pendingPromotion.moves.find((candidate) => candidate.promotion === role);
    if (!move) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promotion-choice';
    button.title = role;
    button.setAttribute('aria-label', `Promote to ${role}`);
    button.style.left = `${visualFile * 12.5}%`;
    button.style.top = `${(startsAtTop ? index : 7 - index) * 12.5}%`;
    button.append(promotionLabel(role, pendingPromotion.color));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      pendingPromotion = null;
      refs.promotion.hidden = true;
      submitBoardMove(move, currentView());
    });
    refs.promotion.append(button);
  }
}

function promotionLabel(role: PromotionRole, color: Color): HTMLElement {
  const label = document.createElement('piece');
  label.className = `promotion-piece ${role} ${color}`;
  label.setAttribute('aria-hidden', 'true');
  return label;
}

// ── View helpers ──────────────────────────────────────────────────────────────

function activeMoveColor(): Color | null {
  const status = currentView()?.status;
  if (status?.type !== 'playing') return null;
  if (liveState.solo) return status.turn;
  return liveState.seat === status.turn ? liveState.seat : null;
}

// ── Labels ────────────────────────────────────────────────────────────────────

function roomMetaHtml(): string {
  const mode = escapeHtml(modeLabel());
  const seat = isColor(liveState.seat)
    ? ` · Playing as ${escapeHtml(seatLabel(liveState.seat))}`
    : liveState.seat === 'spectator'
      ? ' · Spectating'
      : '';
  const replayLabel = isLive() ? '' : ' · replay';
  return `${mode}${seat}${replayLabel}`;
}

function renderBoardStatus(view: PlayerView | null): void {
  refs.boardStatus.hidden = view !== null;
  refs.boardStatus.dataset.tone = boardStatusTone();
  const label = refs.boardStatus.querySelector<HTMLParagraphElement>('[data-board-status-label]');
  if (label) label.textContent = boardStatusLabel();
  const spinner = refs.boardStatus.querySelector<HTMLSpanElement>('[data-board-status-spinner]');
  if (spinner) {
    const showSpinner =
      liveState.connectionState === 'connecting' ||
      liveState.connectionState === 'reconnecting' ||
      liveState.connectionState === 'disconnected';
    spinner.hidden = !showSpinner;
  }
}

// ── Small utilities ───────────────────────────────────────────────────────────

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function infoItem(label: string, value: string): HTMLDivElement {
  const item = document.createElement('div');
  const key = document.createElement('span');
  const val = document.createElement('strong');
  key.textContent = label;
  val.textContent = value;
  item.append(key, val);
  return item;
}

function destroyChessBoardForAlternateRenderer(): void {
  if (!ground) return;
  ground.destroy();
  ground = null;
  drawShapeGameId = null;
  liveState.ground = null;
}
