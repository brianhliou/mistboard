import { boardFen, pieceFen } from '@mistboard/board-render/interactive';
import {
  algebraicMoveLabels,
  type Color,
  clockRemainingMs,
  coordinateMoveLabel,
  darkChessVariant,
  type GameEvent,
  type GameState,
  type PieceRole,
  replayGameEvents,
} from '@mistboard/game';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './game-shell.css';
import './replay-analysis.css';
import {
  type Annotation,
  type AnnotationContext,
  buildAnnotationFromForm,
  loadAnnotations,
  saveAnnotation,
  updateAnnotation,
} from './annotations.js';
// belief-panel is type-only here so it stays out of the replay bundle every
// game view loads; the implementation is dynamically imported below, only when
// belief data is present (dev / admin-gated engine review — never normal play).
import type { BeliefConfig, BeliefPanelHandle } from './belief-panel.js';
import { chessgroundAnimation } from './board-anim.js';
import { computeCaptures } from './captures.js';
import { t } from './i18n/catalog.js';
import {
  type AnnotationConfig,
  type AnnotationPanelHandle,
  type AnnotFormValues,
  createAnnotationPanel,
  renderAnnotationPanel,
} from './replay-annotations.js';
import {
  createBoard,
  createPane,
  renderPaneCaptures,
  renderSplitPaneCaptures,
  renderTruthCaptures,
  revealKingCaptureForLoser,
  setBoardFromState,
  setBoardFromView,
  squareFromCgBoardClick,
} from './replay-board.js';
import {
  createClockPanel,
  createCompactClockSpacer,
  type ReplayThinkingBudgetState,
  renderClockPanel,
  replayClockDisplayAt,
  setClockPanelNames,
} from './replay-clocks.js';
import {
  createAnalysisToolToggleBar,
  createEnginePanelDock,
  type EngineReviewPanels,
} from './replay-engine-panels.js';
import {
  createGameHeaderStrip,
  createGameMetaPanel,
  createShareButton,
  deriveThinkingBudgetMsFromEvents,
  type GameMeta,
  playerViewLabel,
  renderGameHeader,
  renderGameMetaPanel,
  thinkingBudgetMsFromMeta,
} from './replay-meta.js';
import { createReplayMovesPanel, renderReplayMovesPanel } from './replay-moves-panel.js';
import { delayForPly, moveEventAtPly, thinkingDurationForPly } from './replay-playback.js';
import {
  compactReplayClockSidesForOrientation,
  DEFAULT_BETWEEN_GAME_DELAY_MS,
  DEFAULT_WALL_CLOCK_TICK_MS,
  FALLBACK_PLAY_MS,
  positiveMs,
  resolveWallClockReplayPosition,
  resolveWallClockThinkingElapsedMs,
  type WallClockReplayLoop,
  type WallClockReplayPosition,
} from './replay-wall-clock.js';
import type { MoveListEntry } from './review/move-list.js';
import { escapeHtml } from './web-utils.js';

const replayAbortControllers = new WeakMap<HTMLElement, AbortController>();

export type { AnnotationConfig } from './replay-annotations.js';
export type { EngineReviewPanels } from './replay-engine-panels.js';
export type { GameMeta } from './replay-meta.js';
export type {
  WallClockReplayLoop,
  WallClockReplayLoopSample,
  WallClockReplayPosition,
  WallClockReplayTiming,
} from './replay-wall-clock.js';
export {
  compactReplayClockSidesForOrientation,
  resolveWallClockReplayPosition,
  resolveWallClockThinkingElapsedMs,
} from './replay-wall-clock.js';

export type ReplayOptions = {
  autoplay?: boolean;
  /** Initial move count to show. Clamped to the loaded game's ply count. */
  initialPly?: number;
  /** Called whenever the displayed ply changes after a game loads. */
  onPlyChange?: (ply: number, maxPly: number) => void;
  /** When false, white/black panes stay on their last fogged view at game-end. Truth always reveals. */
  revealOnFinish?: boolean;
  /** When false, the prev/next/play control bar is hidden (autoplay-only mode). */
  showControls?: boolean;
  /**
   * When false, the document-level keyboard handler (Arrow prev/next, `f` flip,
   * `a` annotate) is not registered. Defaults to true. The landing hero turns
   * this off so arrow keys don't hijack the homepage into a board scrubber.
   */
  keyboardNav?: boolean;
  /** Render transport as the room-page side panel or the legacy inline bar. Defaults to inline. */
  controlsMode?: 'bar' | 'panel';
  /** Initial board orientation for all replay panes. Defaults to White's perspective. */
  orientation?: Color;
  /** Optional per-game board orientation. Applied whenever a new sample loads. */
  orientationForId?: (sampleId: string, meta: GameMeta | undefined) => Color | null | undefined;
  /** @deprecated Use orientation. Kept for older callers. */
  blackOrientation?: Color;
  /** When set, after each game finishes the next sample loads automatically. */
  loopSamples?: string[];
  /**
   * When true, clamp every per-move autoplay delay to the watchable
   * [MIN_PLAY_MS, MAX_PLAY_MS] band. PvP (recorded `at`-deltas) and the
   * `compute_ms` path are already clamped; this only bounds the raw
   * `thinkTimeMs` path so flat-budget EvE games (literal 5s/move) play back
   * as a bounded pace instead of a slow metronome. Used by the landing hero;
   * the full game viewer leaves it off to keep faithful think times.
   */
  clampPace?: boolean;
  /** When set, replay position is derived from wall-clock time across the sample corpus. */
  wallClockLoop?: WallClockReplayLoop;
  /** Pause length on the reveal frame before cycling to the next loop sample. */
  betweenGameDelayMs?: number;
  /**
   * Override URL construction for sample ids. Default loads from
   * `/replay-samples/<safe-id>.jsonl`. Bakeoff browser uses this to point
   * at `/bakeoff/<path>` without the safe-id sanitization that would mangle
   * filenames containing slashes or dots.
   */
  urlForId?: (sampleId: string) => string;
  /**
   * Custom loader. Bypasses urlForId entirely — for callers that fetch
   * events from a JSON API rather than a static JSONL file.
   */
  loaderForId?: (sampleId: string) => Promise<GameEvent[]>;
  /**
   * Per-game metadata to display in a header bar above the boards. Keyed
   * by sampleId. When absent, no bar renders.
   */
  metadataByRoomId?: Record<string, GameMeta>;
  /**
   * 'full' (default): left-rail meta card + clocks docked under panes + floating time pill.
   * 'compact': landing-hero single-pane mode (clocks above/below the visible pane).
   * 'header': horizontal header strip above the boards (title · result · end · time · plies)
   *           with player+clock cells on each end. Used by the review page; lets the boards
   *           own the full content width with only the moves rail to their right.
   */
  metadataMode?: 'full' | 'compact' | 'header';
  /**
   * Which panes to render. 'all' (default) shows white | truth | black.
   * Provide a resolver to pick a single pane per sample — used by the
   * landing hero, which shows one player's POV instead of the review triptych.
   * Returning 'all' from the resolver shows all three.
   */
  panes?:
    | 'all'
    | { resolver: (sampleId: string, meta: GameMeta | undefined) => 'white' | 'black' | 'all' };
  /** When true, suppress the compact-mode game id pill (room slug). */
  hideGameIdPill?: boolean;
  /** When false, do not render captured-piece strips under replay boards. */
  showCaptures?: boolean;
  /** Split captured pieces above and below POV boards instead of one strip below. */
  captureLayout?: 'single' | 'split';
  /** Compact-mode clock placement. Defaults to the historical board-edge rows. */
  compactClockLayout?: 'board-edges' | 'stacked' | 'captures';
  /** End-result placement. Defaults to pane footer labels. */
  endStatusMode?: 'pane' | 'clock';
  /**
   * When set, enables the annotation tooling. Press `a` at any ply to open
   * the modal pre-filled with the move just played. Annotations persist via
   * POST /api/annotations (handled by the Vite dev plugin in development).
   */
  annotation?: AnnotationConfig;
  belief?: BeliefConfig;
  enginePanels?: EngineReviewPanels;
  /**
   * Called whenever the active sample changes (initial mount and every loop
   * transition). Lets a host keep out-of-band controls pointed at the game
   * currently showing.
   */
  onSampleChange?: (sampleId: string) => void;
  /**
   * Called once after a game reaches its final ply under autoplay (after the
   * betweenGameDelayMs hold), when NO loopSamples pool is set. Lets an outer
   * showcase controller drive cross-variant cycling — mount one game, advance
   * on end. Ignored while loopSamples is set (the internal loop owns
   * advancement).
   */
  onGameEnd?: () => void;
};

type ReplayLoadOptions = {
  initialPly?: number;
  startAutoplay?: boolean;
};

export type ReplayHandle = {
  activeSampleId: () => string;
  destroy: () => void;
  loadGame: (sampleId: string, options?: ReplayLoadOptions) => Promise<void>;
  /** Optionally warm the next game's move data while the current one plays, so a
   *  cross-game advance is instant. Best-effort: a renderer that doesn't implement
   *  it, or a failed prefetch, just falls back to loadGame's normal fetch. */
  prefetchGame?: (sampleId: string) => void;
  /** Replace the auto-loop pool (homepage adaptive refresh). By default the
   *  currently playing game finishes and the next loop pick comes from the new
   *  pool. Pass `{ jumpNow: true }` to cut the current game short and load a
   *  fresh pick immediately — used when the static placeholder is on screen and
   *  real games have just arrived. New ids must already have their metadata/POV
   *  registered by the caller. */
  updateLoopPool: (sampleIds: string[], options?: { jumpNow?: boolean }) => void;
  /** Pause autoplay and jump to `ply`, re-rendering (which fires onPlyChange).
   *  OPTIONAL so existing callers (showcase, review) are unaffected; the /watch
   *  right-rail move list + scrubber drive the board through it. */
  jumpToPly?: (ply: number) => void;
  /** Total plies (played moves) in the loaded game. OPTIONAL; paired with
   *  jumpToPly for the scrubber bounds. */
  plyCount?: () => number;
  /** A variant-agnostic move list for the loaded game (one entry per played move,
   *  `ply` 1-based). OPTIONAL; empty when a path can't derive labels cleanly. */
  moveEntries?: () => MoveListEntry[];
  /** Switch which perspective the board shows at the CURRENT ply, without
   *  restarting playback: a side's own (now-public) fogged view or the truth
   *  board. OPTIONAL — the /watch fog-perspective toggle drives it; showcase +
   *  review never call it. Only meaningful for asymmetric fog games (the chess
   *  triptych, or a per-color tenant); a no-op path can omit it. */
  setPov?: (kind: 'white' | 'truth' | 'black') => void;
  /** The perspectives {@link setPov} can switch to for the loaded game, in
   *  white → truth → black order. OPTIONAL; watch-route uses `length > 1` to
   *  decide whether the perspective toggle is meaningful. A single-view path
   *  returns `['truth']` or omits it. */
  availablePovs?: () => Array<'white' | 'truth' | 'black'>;
  /** Each seat's remaining clock AT THE CURRENT PLY, so a rail clock tracks the
   *  scrubber instead of freezing on a final time. OPTIONAL — /watch's rail is the
   *  only caller; showcase + review never read it. Null when the game is untimed or
   *  the path cannot reconstruct a series, which callers must render as "no clock"
   *  rather than zero. */
  clockAtPly?: () => ReplayClockReadout | null;
  /** Which move-order seat the board is drawn for (sits at the bottom). OPTIONAL;
   *  the embed card reads it to put its own seat rows the right way up. */
  bottomSeat?: () => 'first' | 'second';
};

/** A per-ply clock snapshot, keyed by move order rather than colour so it carries across
 *  variants (red/white both being "first"). /watch seats the second mover above the board
 *  and the first mover below it. */
export type ReplayClockReadout = {
  /** Remaining ms for the first mover (red/white). */
  first: number;
  /** Remaining ms for the second mover (black). */
  second: number;
  /** Whose clock is live at this ply; null once the game has ended. */
  toMove: 'first' | 'second' | null;
};

export async function mountReplay(
  root: HTMLElement,
  initialSampleId: string,
  options: ReplayOptions = {},
): Promise<ReplayHandle> {
  const reveal = options.revealOnFinish !== false;
  const showControls = options.showControls !== false;
  const keyboardNav = options.keyboardNav !== false;
  const controlsMode = options.controlsMode ?? 'bar';
  let boardOrientation = options.orientation ?? options.blackOrientation ?? 'white';
  const orientationForId = options.orientationForId;
  const wallClockLoop = options.wallClockLoop;
  const wallClockInitial = currentWallClockPosition();
  const initialReplaySampleId = wallClockInitial?.sampleId ?? initialSampleId;
  let wallClockPosition = wallClockInitial;
  let loopSamples = wallClockLoop ? undefined : options.loopSamples;
  const betweenGameDelayMs = options.betweenGameDelayMs ?? DEFAULT_BETWEEN_GAME_DELAY_MS;
  const onGameEnd = options.onGameEnd;
  const clampPace = options.clampPace === true;
  const autoplay = !wallClockLoop && (options.autoplay === true || loopSamples !== undefined);
  const urlForId = options.urlForId ?? defaultUrlForId;
  const loaderForId = options.loaderForId;
  const metadataByRoomId = options.metadataByRoomId;
  const metadataMode = options.metadataMode ?? 'full';
  const panesResolver = typeof options.panes === 'object' ? options.panes.resolver : null;
  const hideGameIdPill = options.hideGameIdPill === true;
  const showCaptures = options.showCaptures !== false;
  const captureLayout = options.captureLayout ?? 'single';
  const splitCaptures = showCaptures && captureLayout === 'split';
  const compactClockLayout = options.compactClockLayout ?? 'board-edges';
  const endStatusMode = options.endStatusMode ?? 'pane';
  const onPlyChange = options.onPlyChange;
  const initialMeta = metadataByRoomId?.[initialReplaySampleId];
  const initialOrientation = orientationForId?.(initialReplaySampleId, initialMeta);
  if (initialOrientation) boardOrientation = initialOrientation;

  function currentWallClockPosition(): WallClockReplayPosition | null {
    if (!wallClockLoop) return null;
    return resolveWallClockReplayPosition(
      wallClockLoop.samples,
      wallClockLoop.now ? wallClockLoop.now() : Date.now(),
      wallClockLoop,
    );
  }

  // If mountReplay is called again on the same root (e.g. switching games
  // in the bakeoff browser), abort any keyboard listeners from the prior
  // mount so we don't leak handlers.
  const priorAbort = replayAbortControllers.get(root);
  if (priorAbort) priorAbort.abort();
  const abortController = new AbortController();
  replayAbortControllers.set(root, abortController);

  root.replaceChildren();
  root.classList.add('replay-page');
  root.classList.toggle('replay-compact', metadataMode === 'compact');
  root.classList.toggle('replay-meta-header', metadataMode === 'header');

  const gameHeader = metadataMode === 'header' ? createGameHeaderStrip() : null;
  if (gameHeader) root.append(gameHeader.el);

  const layout = document.createElement('div');
  layout.className = 'replay-layout';

  // Base labels are recomputed from meta in applyMetadata() so we can fold
  // the player name into the board label ("Guest's view"). Default fallbacks
  // are used until meta arrives.
  let whiteBaseLabel = "White's view";
  let blackBaseLabel = "Black's view";

  const whitePane = createPane(whiteBaseLabel, 'white', showCaptures, captureLayout);
  const truthPane = createPane(t('watch.truth'), 'truth', showCaptures, captureLayout);
  const blackPane = createPane(blackBaseLabel, 'black', showCaptures, captureLayout);
  let layoutOrder: 'white-first' | 'black-first' = 'white-first';
  layout.append(whitePane.el, truthPane.el, blackPane.el);
  // Apply the pane choice synchronously so the triptych doesn't flash before
  // loadGame() finishes its async fetch and calls applyMetadata().
  if (panesResolver) {
    const initialMeta = metadataByRoomId?.[initialReplaySampleId];
    const initialChoice = panesResolver(initialReplaySampleId, initialMeta);
    layout.classList.add(
      initialChoice === 'white'
        ? 'replay-layout-single-white'
        : initialChoice === 'black'
          ? 'replay-layout-single-black'
          : 'replay-layout-all',
    );
  }
  root.append(layout);

  const firstBtn = controlButton('|<', t('replay.firstPosition'));
  const prevBtn = controlButton('<', t('watch.previousMove'));
  const playBtn = controlButton(t('replay.playButton'), t('watch.play'));
  const nextBtn = controlButton('>', t('watch.nextMove'));
  const lastBtn = controlButton('>|', t('replay.latestPosition'));
  const flipBtn = controlButton(t('replay.flip'), t('replay.flipAllBoards'));
  const plyLabel = document.createElement('span');
  plyLabel.className = 'replay-ply-label';
  const movesPanel = showControls && controlsMode === 'panel' ? createReplayMovesPanel() : null;

  // 'header' mode renders metadata as a horizontal strip above the boards instead
  // of as a side-rail panel, so the boards can use the full content width.
  const gameMetaPanel =
    metadataByRoomId && metadataMode !== 'header'
      ? createGameMetaPanel(metadataMode === 'compact' ? 'compact' : 'full', { hideGameIdPill })
      : null;
  if (gameMetaPanel) root.append(gameMetaPanel.el);
  if (movesPanel) root.append(movesPanel.el);
  const clockPanel = createClockPanel();
  // In compact + single-POV mode (landing hero) the truth pane is CSS-hidden,
  // so clocks hosted on truth would also be hidden. Track the current host
  // pane so we can move the clock rows when the visible pane changes across
  // looped games.
  let compactClockHost: { boardEl: HTMLDivElement; clockSlot: HTMLDivElement } | null = null;
  let compactClockTopColor: Color | null = null;
  const compactClockTopName = document.createElement('div');
  compactClockTopName.className = 'replay-clock-stack-name replay-clock-stack-name-top';
  const compactClockBottomName = document.createElement('div');
  compactClockBottomName.className = 'replay-clock-stack-name replay-clock-stack-name-bottom';
  // The 'captures' layout hosts each player's name + clock in a cell beside that
  // player's captures row (homepage hero), instead of a single side rail.
  const compactClockTopCell = document.createElement('div');
  compactClockTopCell.className = 'replay-clock-cell replay-clock-cell-top';
  const compactClockBottomCell = document.createElement('div');
  compactClockBottomCell.className = 'replay-clock-cell replay-clock-cell-bottom';
  function relocateCompactClockRows(host: {
    boardEl: HTMLDivElement;
    clockSlot: HTMLDivElement;
    el: HTMLDivElement;
  }): void {
    const clockSides = compactReplayClockSidesForOrientation(boardOrientation);
    if (compactClockHost === host && compactClockTopColor === clockSides.top) return;
    clockPanel.blackRow.remove();
    clockPanel.whiteRow.remove();
    const topRow = clockSides.top === 'white' ? clockPanel.whiteRow : clockPanel.blackRow;
    const bottomRow = clockSides.bottom === 'white' ? clockPanel.whiteRow : clockPanel.blackRow;
    topRow.classList.add('replay-clock-row-top');
    topRow.classList.remove('replay-clock-row-bottom');
    bottomRow.classList.add('replay-clock-row-bottom');
    bottomRow.classList.remove('replay-clock-row-top');
    if (compactClockLayout === 'stacked') {
      compactClockTopName.remove();
      compactClockBottomName.remove();
      updateCompactClockNames(clockSides);
      host.clockSlot.append(compactClockTopName, topRow, bottomRow, compactClockBottomName);
    } else if (compactClockLayout === 'captures') {
      updateCompactClockNames(clockSides);
      compactClockTopCell.replaceChildren(compactClockTopName, topRow);
      compactClockBottomCell.replaceChildren(compactClockBottomName, bottomRow);
      host.el.append(compactClockTopCell, compactClockBottomCell);
    } else {
      host.boardEl.before(topRow);
      host.clockSlot.append(bottomRow);
    }
    compactClockHost = host;
    compactClockTopColor = clockSides.top;
  }
  function updateCompactClockNames(
    clockSides = compactReplayClockSidesForOrientation(boardOrientation),
    resultByColor?: Partial<Record<Color, 'draw' | 'loss' | 'win'>>,
  ): void {
    renderCompactClockName(compactClockTopName, clockSides.top, resultByColor?.[clockSides.top]);
    renderCompactClockName(
      compactClockBottomName,
      clockSides.bottom,
      resultByColor?.[clockSides.bottom],
    );
  }
  function renderCompactClockName(
    target: HTMLDivElement,
    color: Color,
    result: 'draw' | 'loss' | 'win' | undefined,
  ): void {
    target.classList.toggle('result-win', result === 'win');
    target.classList.toggle('result-loss', result === 'loss');
    target.classList.toggle('result-draw', result === 'draw');
    const baseName =
      color === 'white' ? clockPanel.whiteLabel.textContent : clockPanel.blackLabel.textContent;
    if (!result) {
      target.textContent = baseName;
      return;
    }
    const resultChip = document.createElement('span');
    resultChip.className = 'replay-clock-stack-result';
    resultChip.textContent = result === 'win' ? 'won' : result === 'loss' ? 'lost' : 'draw';
    target.replaceChildren(document.createTextNode(baseName ?? ''), resultChip);
  }
  function paneForChoice(choice: 'white' | 'black' | 'all'): {
    boardEl: HTMLDivElement;
    clockSlot: HTMLDivElement;
    el: HTMLDivElement;
  } {
    return choice === 'white' ? whitePane : choice === 'black' ? blackPane : truthPane;
  }
  if (metadataMode === 'compact') {
    // Un-hide clock rows immediately so the host column reserves the same
    // vertical space as the side panes' spacers from first paint; otherwise
    // the board sits ~42px higher until clocks render, then jumps when
    // renderClockPanel un-hides them.
    clockPanel.blackRow.hidden = false;
    clockPanel.whiteRow.hidden = false;
    clockPanel.blackTime.textContent = '—';
    clockPanel.whiteTime.textContent = '—';

    if (panesResolver) {
      // Single-POV layout: the only visible pane hosts the clocks (and
      // player names live inside the clock rows via setClockPanelNames).
      // The hidden panes don't need spacers since they contribute nothing
      // to layout.
      const initialChoice = panesResolver(initialSampleId, initialMeta);
      relocateCompactClockRows(paneForChoice(initialChoice));
    } else {
      // Triptych: clocks on truth, spacers on side panes so all three
      // board tops align.
      whitePane.boardEl.before(createCompactClockSpacer());
      blackPane.boardEl.before(createCompactClockSpacer());
      whitePane.clockSlot.append(createCompactClockSpacer());
      blackPane.clockSlot.append(createCompactClockSpacer());
      relocateCompactClockRows(truthPane);
    }
  } else if (metadataMode === 'header' && gameHeader) {
    // Header strip hosts the clocks in the player cells; the floating
    // "Time" pill is suppressed entirely.
    gameHeader.whiteCell.append(clockPanel.whiteRow);
    gameHeader.blackCell.append(clockPanel.blackRow);
    if (showControls) {
      gameHeader.actions.append(createShareButton());
      flipBtn.classList.add('replay-game-header-action', 'replay-game-header-action-secondary');
      flipBtn.innerHTML = `${ICON_FLIP}<span class="replay-game-header-action-label">${escapeHtml(
        t('replay.flip'),
      )}</span>`;
      flipBtn.title = t('replay.flipAllBoardsShortcut');
      flipBtn.setAttribute('aria-label', t('replay.flipAllBoards'));
      gameHeader.actions.append(flipBtn);
    }
  } else {
    whitePane.clockSlot.append(clockPanel.whiteRow);
    blackPane.clockSlot.append(clockPanel.blackRow);
    root.append(clockPanel.el);
  }

  if (showControls && controlsMode === 'bar') {
    const controls = document.createElement('div');
    controls.className = 'replay-control-bar';
    controls.append(firstBtn, prevBtn, playBtn, nextBtn, lastBtn, flipBtn);
    // Keep the ply / result caption on its own line below the buttons. Its text
    // length varies by ply (e.g. "Ply 0 / 31" vs "Ply 31 / 31 — white wins
    // (king-captured)"), so inlining it in the centered button row would shift
    // the buttons as you scrub. A dedicated line with reserved height holds the
    // buttons steady.
    const plyLine = document.createElement('div');
    plyLine.className = 'replay-ply-line';
    plyLine.append(plyLabel);
    root.append(controls, plyLine);
  }

  const whiteCg = createBoard(whitePane.boardEl, boardOrientation);
  const truthCg = createBoard(truthPane.boardEl, boardOrientation);
  const blackCg = createBoard(blackPane.boardEl, boardOrientation);

  const annotation = options.annotation;
  const belief = options.belief;
  const enginePanelDock = createEnginePanelDock(options.enginePanels);
  const toolsRow = belief || annotation || enginePanelDock ? document.createElement('div') : null;
  const toolsToggleBar = toolsRow ? createAnalysisToolToggleBar() : null;
  if (toolsRow) {
    toolsRow.className = 'replay-tools-row';
    root.append(toolsRow);
    if (toolsToggleBar) toolsRow.append(toolsToggleBar.el);
  }
  let beliefPanel: BeliefPanelHandle | null = null;
  let beliefPanelVisible = Boolean(belief);
  let annotationPanelVisible = Boolean(annotation);
  if (enginePanelDock) toolsRow?.append(enginePanelDock.el);
  if (belief) {
    const { createBeliefPanel } = await import('./belief-panel.js');
    beliefPanel = createBeliefPanel();
    toolsRow?.append(beliefPanel.el);
  }

  let annotPanel: AnnotationPanelHandle | null = null;
  if (annotation) {
    annotPanel = createAnnotationPanel({
      onSave: handleAnnotSave,
    });
    toolsRow?.append(annotPanel.el);
  }

  if (toolsToggleBar) {
    if (beliefPanel) {
      toolsToggleBar.addToggle('belief', t('replay.beliefToggle'), true, (visible) => {
        beliefPanelVisible = visible;
        syncAnalysisToolVisibility();
      });
    }
    if (annotPanel) {
      toolsToggleBar.addToggle('annotation', t('replay.annotateToggle'), true, (visible) => {
        annotationPanelVisible = visible;
        syncAnalysisToolVisibility();
      });
    }
  }
  syncAnalysisToolVisibility();

  let activeSample = initialReplaySampleId;
  let events: GameEvent[] = [];
  let moveCount = 0;
  let currentPly = 0;
  let shouldApplyInitialPly = !wallClockLoop && Number.isFinite(options.initialPly);
  let playTimer: number | null = null;
  let loopTimer: number | null = null;
  let wallClockTimer: number | null = null;
  let wallClockLoadPromise: Promise<void> | null = null;
  let clockTickTimer: number | null = null;
  let finishedAck = false;
  let annotationsForGame: Annotation[] = [];
  let lastNotifiedPly: number | null = null;
  let renderedClockState: GameState | null = null;
  let renderedClockEvents: GameEvent[] | null = null;
  // Per-move budget recovered from a clockless game's move events when its
  // stored metadata carries no time control (e.g. imported engine bakeoff
  // games). Cached per sample so the count-up denominator is the run's real
  // budget (5s, 13s, ...) instead of a blank or an assumed constant.
  const derivedTimeControlByRoomId: Record<string, Record<string, unknown>> = {};

  function render(): void {
    root.dataset.sampleId = activeSample;
    root.dataset.ply = String(currentPly);
    const sliced = sliceToPly(events, currentPly);
    const projection = replayGameEvents(sliced);
    const state = projection.state;
    const captures = showCaptures ? computeCaptures(sliced) : null;
    const finished = state.status.type === 'finished';
    renderClockState(state, sliced);
    clearClockEndGameState();

    // Fog-safe animation (#158): the truth pane sees everything, so it animates
    // every move. A POV pane animates ONLY its own side's move — gliding the
    // fogged opponent's piece would imply an origin square the server redacted.
    // `animBase` folds in the user's animation preference (0 => disabled).
    const animBase = chessgroundAnimation().enabled;
    const moverColor = lastMovePlayedColor(sliced);

    setBoardFromState(truthCg, state, animBase);

    if (finished && reveal) {
      // Postgame reveal: collapse the POV panes to truth so the viewer sees
      // the full board they couldn't see during play.
      setBoardFromState(whiteCg, state, animBase);
      setBoardFromState(blackCg, state, animBase);
    } else {
      let whiteView = darkChessVariant.getPlayerView(state, 'white');
      let blackView = darkChessVariant.getPlayerView(state, 'black');
      if (
        finished &&
        state.status.type === 'finished' &&
        state.status.reason === 'king-captured' &&
        state.lastMove
      ) {
        // The loser saw their king die — the attacker becomes visible to them
        // on the king-capture square at that moment.
        const loser = state.status.winner === 'white' ? 'black' : 'white';
        const attacker = state.board[state.lastMove.to];
        if (attacker) {
          if (loser === 'black') {
            blackView = revealKingCaptureForLoser(blackView, state.lastMove, attacker);
          } else {
            whiteView = revealKingCaptureForLoser(whiteView, state.lastMove, attacker);
          }
        }
      }
      setBoardFromView(whiteCg, whiteView, boardOrientation, animBase && moverColor === 'white');
      setBoardFromView(blackCg, blackView, boardOrientation, animBase && moverColor === 'black');
    }

    const showRevealLabels = finished && reveal;
    whitePane.labelEl.textContent = showRevealLabels
      ? `${whiteBaseLabel} — revealed`
      : whiteBaseLabel;
    blackPane.labelEl.textContent = showRevealLabels
      ? `${blackBaseLabel} — revealed`
      : blackBaseLabel;
    whitePane.el.classList.toggle('revealed', showRevealLabels);
    blackPane.el.classList.toggle('revealed', showRevealLabels);
    if (captures) {
      if (splitCaptures) {
        renderSplitPaneCaptures(whitePane, captures, boardOrientation);
        renderSplitPaneCaptures(blackPane, captures, boardOrientation);
        renderSplitPaneCaptures(truthPane, captures, boardOrientation);
      } else {
        renderPaneCaptures(whitePane.capturesEl, captures.white, 'black');
        renderPaneCaptures(blackPane.capturesEl, captures.black, 'white');
        renderTruthCaptures(truthPane.capturesEl, captures);
      }
    }

    if (showControls) {
      const annotMark = annotation && annotationsAtPly(currentPly).length > 0 ? ' ★' : '';
      plyLabel.textContent = `${t('replay.plyOfTotal', {
        current: currentPly,
        total: moveCount,
      })}${gameOverSuffix(state)}${annotMark}`;
      firstBtn.disabled = currentPly === 0;
      prevBtn.disabled = currentPly === 0;
      nextBtn.disabled = currentPly >= moveCount;
      lastBtn.disabled = currentPly >= moveCount;
      movesPanel &&
        renderReplayMovesPanel(movesPanel, {
          activePly: currentPly,
          eventIndex: currentReplayEventIndex(),
          events,
          moveCount,
          onJump: (ply) => {
            stopPlay();
            clearLoopTimer();
            finishedAck = false;
            setCurrentPly(ply);
            render();
          },
        });
    }

    if (finished) {
      applyEndGameState(state);
    } else {
      whitePane.el.classList.remove('winner', 'loser');
      blackPane.el.classList.remove('winner', 'loser');
      truthPane.el.classList.remove('finished');
      whitePane.statusEl.textContent = '';
      blackPane.statusEl.textContent = '';
      truthPane.statusEl.textContent = '';
    }

    if (finished && !finishedAck) {
      finishedAck = true;
      scheduleLoopIfNeeded();
    }

    renderAnnotPanel();
    beliefPanel?.render(currentPly);
    syncAnalysisToolVisibility();
    notifyPlyChange();
  }

  function notifyPlyChange(): void {
    if (!onPlyChange || lastNotifiedPly === currentPly) return;
    lastNotifiedPly = currentPly;
    onPlyChange(currentPly, moveCount);
  }

  function syncAnalysisToolVisibility(): void {
    if (beliefPanel) beliefPanel.el.hidden = !beliefPanelVisible;
    if (annotPanel) annotPanel.el.hidden = !annotationPanelVisible;
    toolsToggleBar?.setPressed('belief', beliefPanelVisible);
    toolsToggleBar?.setPressed('annotation', annotationPanelVisible);
    const hasVisibleAnalysis = Boolean(
      (beliefPanel && beliefPanelVisible) || (annotPanel && annotationPanelVisible),
    );
    root.classList.toggle('analysis-tools-open', hasVisibleAnalysis);
    root.classList.toggle('analysis-tools-collapsed', !hasVisibleAnalysis);
    root.classList.toggle('analysis-belief-open', Boolean(beliefPanel && beliefPanelVisible));
    root.classList.toggle(
      'analysis-annotation-open',
      Boolean(annotPanel && annotationPanelVisible),
    );
    if (toolsRow) {
      toolsRow.classList.toggle('analysis-tools-collapsed', !hasVisibleAnalysis);
      toolsRow.classList.toggle('analysis-belief-open', Boolean(beliefPanel && beliefPanelVisible));
      toolsRow.classList.toggle(
        'analysis-annotation-open',
        Boolean(annotPanel && annotationPanelVisible),
      );
    }
  }

  function annotationsAtPly(ply: number): Annotation[] {
    return annotationsForGame.filter((a) => a.ply === ply);
  }

  function currentAnnotContext(): AnnotationContext | null {
    if (!annotation) return null;
    if (currentPly < 1) return null;
    const moveEvent = moveEventAtPly(events, currentPly);
    if (moveEvent?.type !== 'move-played') return null;

    const gameIndex = annotation.gameIndexForSampleId(activeSample);
    const tier1Color = annotation.tier1ColorForSampleId(activeSample);
    if (gameIndex === null) return null;

    const sliced = sliceToPly(events, currentPly);
    const projection = replayGameEvents(sliced);
    const fenAfter = boardFen(projection.state.board);
    const moveColor = (moveEvent as { color: Color }).color;
    const moveObj = (moveEvent as { move: { from: string; to: string; promotion?: string } }).move;
    const promotion = moveObj.promotion ? pieceFen(moveObj.promotion as PieceRole, 'black') : '';
    const uci = `${moveObj.from}${moveObj.to}${promotion}`;

    return {
      manifestUrl: annotation.manifestUrl,
      gamePath: activeSample,
      gameIndex,
      ply: currentPly,
      movePlayedUci: uci,
      movePlayedColor: moveColor,
      isTier1Move: tier1Color !== null && moveColor === tier1Color,
      boardFenAfter: fenAfter,
    };
  }

  function renderAnnotPanel(): void {
    if (!annotation) return;
    renderAnnotationPanel(annotPanel, {
      annotations: annotationsForGame,
      context: currentAnnotContext(),
      currentPly,
      onDeleted(a) {
        annotationsForGame = annotationsForGame.filter((x) => x.id !== a.id);
        render();
        annotation.onSaved?.();
      },
      onEdit(a, form) {
        stopPlay();
        clearLoopTimer();
        finishedAck = false;
        setCurrentPly(a.ply);
        // Enter edit mode BEFORE render() so the form's edit state is set
        // when renderAnnotationPanel's setContext call runs.
        form.loadForEdit(a);
        render();
      },
      onJump(ply) {
        stopPlay();
        clearLoopTimer();
        finishedAck = false;
        setCurrentPly(ply);
        render();
      },
    });
  }

  async function handleAnnotSave(
    formValues: AnnotFormValues,
    editing: Annotation | null,
  ): Promise<void> {
    if (editing) {
      const updated: Annotation = {
        ...editing,
        severity: formValues.severity,
        suggested_move_uci: formValues.better.trim() || null,
        note: formValues.note.trim(),
      };
      await updateAnnotation(updated);
      annotationsForGame = annotationsForGame.map((a) => (a.id === editing.id ? updated : a));
    } else {
      const ctx = currentAnnotContext();
      if (!ctx) return;
      const annot = buildAnnotationFromForm(ctx, formValues);
      await saveAnnotation(annot);
      annotationsForGame = [...annotationsForGame, annot];
    }
    annotPanel?.form.clearAfterSave();
    render();
    annotation?.onSaved?.();
  }

  async function reloadAnnotations(): Promise<void> {
    if (!annotation) return;
    const idx = annotation.gameIndexForSampleId(activeSample);
    if (idx === null) {
      annotationsForGame = [];
      return;
    }
    const all = await loadAnnotations();
    annotationsForGame = all.filter(
      (a) =>
        a.game_index === idx &&
        a.game_path === activeSample &&
        a.manifest_url === annotation.manifestUrl,
    );
  }

  function scheduleLoopIfNeeded(): void {
    if (loopTimer !== null) return;
    // Two end-of-game modes: the internal loop pool (homepage legacy / chess-only
    // cycling) or a single-game showcase where an outer controller advances via
    // onGameEnd. With neither, the game just holds on its final frame.
    if ((!loopSamples || loopSamples.length === 0) && !onGameEnd) return;
    loopTimer = window.setTimeout(() => {
      loopTimer = null;
      // Re-read the pool at fire time so an adaptive updateLoopPool() swap is
      // picked up for the next pick.
      const pool = loopSamples;
      if (pool && pool.length > 0) {
        const next = pickNextSample(pool, activeSample);
        loadGame(next).catch((err) =>
          console.warn('[replay loop] failed to load game, skipping:', next, err),
        );
        return;
      }
      // No pool: hand control back to the outer showcase controller so it can
      // pick the next game (possibly a different variant / renderer kind).
      onGameEnd?.();
    }, betweenGameDelayMs);
  }

  function clearLoopTimer(): void {
    if (loopTimer !== null) {
      window.clearTimeout(loopTimer);
      loopTimer = null;
    }
  }

  function startWallClockLoop(): void {
    if (!wallClockLoop || wallClockTimer !== null) return;
    syncWallClockLoop();
    wallClockTimer = window.setInterval(
      syncWallClockLoop,
      positiveMs(wallClockLoop.tickMs, DEFAULT_WALL_CLOCK_TICK_MS),
    );
  }

  function clearWallClockTimer(): void {
    if (wallClockTimer !== null) {
      window.clearInterval(wallClockTimer);
      wallClockTimer = null;
    }
  }

  function syncWallClockLoop(): void {
    const target = currentWallClockPosition();
    if (!target) return;
    wallClockPosition = target;

    if (target.sampleId !== activeSample) {
      if (wallClockLoadPromise) return;
      let loaded = false;
      wallClockLoadPromise = loadGame(target.sampleId, {
        initialPly: target.ply,
        startAutoplay: false,
      })
        .then(() => {
          loaded = true;
        })
        .catch((err) => console.warn('[replay wall-clock loop] failed to load game:', err))
        .finally(() => {
          wallClockLoadPromise = null;
          if (loaded) syncWallClockLoop();
        });
      return;
    }

    if (target.ply === currentPly) {
      renderWallClockClockOnly();
      return;
    }
    setCurrentPly(target.ply);
    render();
  }

  function renderClockState(state: GameState, slicedEvents: GameEvent[]): void {
    renderedClockState = state;
    renderedClockEvents = slicedEvents;
    const displayAt = replayClockDisplayAt(slicedEvents, state);
    renderClockPanel(
      clockPanel,
      state.clock,
      state,
      currentMeta(),
      displayAt ?? undefined,
      wallClockThinkingState(state),
    );
  }

  function renderWallClockClockOnly(): void {
    if (!wallClockLoop) return;
    if (!renderedClockState || !renderedClockEvents) return;
    renderClockState(renderedClockState, renderedClockEvents);
    clearClockEndGameState();
    if (renderedClockState.status.type === 'finished') applyEndGameState(renderedClockState);
  }

  function wallClockThinkingState(state: GameState): ReplayThinkingBudgetState | null {
    if (!wallClockLoop || !wallClockPosition || wallClockPosition.sampleId !== activeSample) {
      return null;
    }
    if (state.clock || state.status.type !== 'playing') return null;
    const budgetMs = thinkingBudgetMsFromMeta(currentMeta()?.timeControl);
    if (budgetMs === null) return null;

    const plyMs = positiveMs(wallClockLoop.plyMs, FALLBACK_PLAY_MS);
    const nextPly = currentPly + 1;
    const thinkMs = thinkingDurationForPly(events, nextPly) ?? plyMs;
    // Already real elapsed time (plyElapsedMs), so the rate was never wrong on this path.
    // The budget cap is new: the row now counts the budget DOWN, and an engine that
    // overshoots its budget must read 0.0s rather than a negative remainder.
    const elapsedMs = Math.min(
      resolveWallClockThinkingElapsedMs(wallClockPosition.plyElapsedMs, thinkMs),
      budgetMs,
    );
    return {
      activeColor: state.status.turn,
      budgetMs,
      elapsedMs,
    };
  }

  function stopPlay(): void {
    if (playTimer !== null) {
      window.clearTimeout(playTimer);
      playTimer = null;
    }
    clearClockTickTimer();
    playBtn.textContent = t('replay.playButton');
  }

  function startPlay(): void {
    if (playTimer !== null) return;
    playBtn.textContent = t('replay.pauseButton');
    scheduleNextPly();
  }

  function scheduleNextPly(): void {
    const nextPly = currentPly + 1;
    if (nextPly > moveCount) {
      stopPlay();
      scheduleLoopIfNeeded();
      return;
    }
    const delay = delayForPly(
      events,
      nextPly,
      thinkingBudgetMsFromMeta(currentMeta()?.timeControl),
      clampPace,
    );
    playTimer = window.setTimeout(() => {
      clearClockTickTimer();
      setCurrentPly(nextPly);
      render();
      scheduleNextPly();
    }, delay);
    startClockTickTimer(nextPly, delay);
  }

  function clearClockTickTimer(): void {
    if (clockTickTimer !== null) {
      window.clearInterval(clockTickTimer);
      clockTickTimer = null;
    }
  }

  function startClockTickTimer(nextPly: number, delay: number): void {
    clearClockTickTimer();
    if (delay <= 0) return;
    const sliced = sliceToPly(events, currentPly);
    const projection = replayGameEvents(sliced);
    const state = projection.state;
    const meta = currentMeta();
    if (state.status.type !== 'playing') return;
    const activeColor = state.status.turn;
    const nextEvent = moveEventAtPly(events, nextPly);
    if (nextEvent?.type !== 'move-played') return;
    const startWall = performance.now();

    // A timed game's clock is NOT animated during playback: render() parks it on the ply's
    // recorded value and it stays there until the next move lands. This used to walk the
    // displayed instant from the mover's clock start to the next move's timestamp across
    // `delay` — but clampPace squeezes `delay` into [700, 2500] ms while the timestamps span
    // the real think, so the countdown ran at gap/delay rather than at one second per second
    // (measured 1.00x-7.60x on one homepage game). See the doctrine note in
    // watch-tenant-replay.ts before reinstating anything here.
    if (state.clock) return;

    // A clockless engine game has no clock to park, so its per-move BUDGET is the clock:
    // the row counts that allowance down while the engine thinks. The budget is a fixed
    // per-move quantity that does not depend on how long this move actually took, which is
    // what lets this animate honestly where the old count-up could not -- it counted up to
    // the move's REAL think time across the clamped playback window, so a 14.5 s think ran
    // at 5.78x (measured over the 200-move bakeoff-g21 sample; median 1.14x, 82/200 above
    // 1.5x). Elapsed is real wall time here, never a fraction of `delay`.
    //
    // Two caps, both meaningful. thinkMs stops the countdown where the engine actually
    // moved, so the row reads how much budget was left when it did; budgetMs keeps an
    // overshoot (Misty routinely exceeds its budget) pinned at 0.0s instead of going
    // negative. Whichever the playback window reaches first is where it stops.
    const budgetMs = thinkingBudgetMsFromMeta(meta?.timeControl);
    const thinkMs = thinkingDurationForPly(events, nextPly) ?? delay;
    if (budgetMs === null || thinkMs <= 0) return;
    const tick = (): void => {
      const elapsedMs = Math.min(performance.now() - startWall, thinkMs, budgetMs);
      renderClockPanel(clockPanel, undefined, state, meta, undefined, {
        activeColor,
        budgetMs,
        elapsedMs,
      });
    };
    tick();
    clockTickTimer = window.setInterval(tick, 100);
  }

  function setCurrentPly(ply: number): void {
    currentPly = Math.min(Math.max(ply, 0), moveCount);
  }

  function currentReplayEventIndex(): number {
    if (events.length === 0) return 0;
    return sliceToPly(events, currentPly).length;
  }

  // Single-entry prefetch cache: the showcase cycler warms the next game's events
  // while the current one plays. A miss or failure falls back to a fresh fetch, and
  // it fetches the exact same (POV-safe) events loadGame would, so it can never show
  // the wrong game or leak hidden info.
  let prefetchedEvents: { id: string; promise: Promise<GameEvent[]> } | null = null;
  const fetchEvents = (id: string): Promise<GameEvent[]> =>
    loaderForId ? loaderForId(id) : loadEvents(id, urlForId);

  async function loadGame(sampleId: string, loadOptions: ReplayLoadOptions = {}): Promise<void> {
    stopPlay();
    clearLoopTimer();
    let nextEvents: GameEvent[];
    if (prefetchedEvents && prefetchedEvents.id === sampleId) {
      const cached = prefetchedEvents.promise;
      prefetchedEvents = null;
      try {
        nextEvents = await cached;
      } catch {
        nextEvents = await fetchEvents(sampleId);
      }
    } else {
      prefetchedEvents = null; // discard a stale prefetch (e.g. a jumpNow pool swap)
      nextEvents = await fetchEvents(sampleId);
    }
    activeSample = sampleId;
    options.onSampleChange?.(sampleId);
    annotationsForGame = [];
    events = nextEvents;
    moveCount = events.filter((e) => e.type === 'move-played').length;
    maybeDeriveThinkingBudget(sampleId);
    beliefPanel?.setRows(belief?.rowsForSampleId(sampleId) ?? []);
    beliefPanel?.setTraceRows(belief?.traceRowsForSampleId?.(sampleId) ?? []);
    if (typeof loadOptions.initialPly === 'number') {
      currentPly = Math.min(Math.max(Math.floor(loadOptions.initialPly), 0), moveCount);
    } else if (shouldApplyInitialPly && typeof options.initialPly === 'number') {
      currentPly = Math.min(Math.max(Math.floor(options.initialPly), 0), moveCount);
      shouldApplyInitialPly = false;
    } else {
      currentPly = 0;
    }
    lastNotifiedPly = null;
    finishedAck = false;
    applyMetadata();
    applyPerspective();
    if (annotation) await reloadAnnotations();
    render();
    if (autoplay && loadOptions.startAutoplay !== false) startPlay();
  }

  function applyPerspective(): void {
    const tier1Color = annotation?.tier1ColorForSampleId(activeSample) ?? null;
    const resolvedOrientation = orientationForId?.(activeSample, currentMeta()) ?? tier1Color;
    if (resolvedOrientation) boardOrientation = resolvedOrientation;
    applyBoardOrientation();
    const nextLayoutOrder = tier1Color === 'black' ? 'black-first' : 'white-first';
    if (nextLayoutOrder !== layoutOrder && nextLayoutOrder === 'black-first') {
      layout.replaceChildren(blackPane.el, truthPane.el, whitePane.el);
      layoutOrder = nextLayoutOrder;
    } else if (nextLayoutOrder !== layoutOrder) {
      layout.replaceChildren(whitePane.el, truthPane.el, blackPane.el);
      layoutOrder = nextLayoutOrder;
    }
    if (metadataMode === 'compact') {
      const choice = panesResolver?.(activeSample, currentMeta()) ?? 'all';
      relocateCompactClockRows(paneForChoice(choice));
    }
  }

  // Attach click-to-pick on the truth board's inner cg-board element. cg-board
  // is the actual square-grid (full width of cg-wrap); the outer .replay-board
  // parent can be larger, which broke the prior coordinate math. Click events
  // bubble up from cg-board through pieces (which have pointer-events:none)
  // and squares to here, so a single listener on the parent works.
  if (annotation && annotPanel) {
    truthPane.boardEl.style.cursor = 'crosshair';
    truthPane.boardEl.addEventListener('click', (e) => {
      const sq = squareFromCgBoardClick(truthPane.boardEl, e, boardOrientation);
      if (sq) annotPanel?.form.appendPickedSquare(sq);
    });
  }

  function applyMetadata(): void {
    const meta = currentMeta();
    whitePane.nameEl.textContent = '';
    blackPane.nameEl.textContent = '';
    setClockPanelNames(clockPanel, meta);
    if (
      metadataMode === 'compact' &&
      (compactClockLayout === 'stacked' || compactClockLayout === 'captures')
    ) {
      updateCompactClockNames();
    }
    renderGameMetaPanel(gameMetaPanel, meta, activeSample);
    renderGameHeader(gameHeader, meta);
    whiteBaseLabel = playerViewLabel(meta?.whiteName, 'white');
    blackBaseLabel = playerViewLabel(meta?.blackName, 'black');
    whitePane.labelEl.textContent = whiteBaseLabel;
    blackPane.labelEl.textContent = blackBaseLabel;
    if (panesResolver) {
      const choice = panesResolver(activeSample, meta);
      layout.classList.remove(
        'replay-layout-single-white',
        'replay-layout-single-black',
        'replay-layout-all',
      );
      layout.classList.add(
        choice === 'white'
          ? 'replay-layout-single-white'
          : choice === 'black'
            ? 'replay-layout-single-black'
            : 'replay-layout-all',
      );
      if (metadataMode === 'compact') {
        // Move clock rows onto the now-visible pane so clocks + names stay
        // attached to the only board the viewer sees.
        relocateCompactClockRows(paneForChoice(choice));
      }
    }
    // Reset any prior end-game state (returning to ply 0).
    whitePane.el.classList.remove('winner', 'loser');
    blackPane.el.classList.remove('winner', 'loser');
    truthPane.el.classList.remove('finished');
    whitePane.statusEl.textContent = '';
    blackPane.statusEl.textContent = '';
    truthPane.statusEl.textContent = '';
  }

  // Recover a clockless engine game's per-move budget from its events when the
  // stored metadata has none. Games with a real clock (PvP/PvE) and games whose
  // metadata already carries a budget are skipped. A clocked game tracks time as
  // remaining time, and its first two plies sit frozen (clock unarmed) until both
  // sides have moved; synthesizing a per-move budget for one made those frozen
  // plies animate a phantom "0.x / 1s" count-up (PvE move events carry the
  // engine's `thinkTimeMs`, so the derivation does NOT no-op for them — only the
  // clock check below excludes them). Only clockless engine self-play (EvE, which
  // has no clock state) should derive a budget.
  function maybeDeriveThinkingBudget(sampleId: string): void {
    if (derivedTimeControlByRoomId[sampleId]) return;
    const baseMeta = metadataByRoomId?.[sampleId];
    if (thinkingBudgetMsFromMeta(baseMeta?.timeControl) !== null) return;
    if (replayGameEvents(events).state.clock) return;
    const budgetMs = deriveThinkingBudgetMsFromEvents(events);
    if (budgetMs !== null) {
      derivedTimeControlByRoomId[sampleId] = { kind: 'per-move', milliseconds: budgetMs };
    }
  }

  function currentMeta(): GameMeta | undefined {
    const meta = metadataByRoomId?.[activeSample];
    const derived = derivedTimeControlByRoomId[activeSample];
    return meta && derived ? { ...meta, timeControl: derived } : meta;
  }

  function applyEndGameState(state: GameState): void {
    if (state.status.type !== 'finished') return;
    const winner = state.status.winner;
    const reasonLabel = endGameReasonLabel(state.status.reason);

    if (winner === 'white') {
      whitePane.el.classList.add('winner');
      blackPane.el.classList.add('loser');
      if (endStatusMode === 'clock') {
        applyClockEndGameState('white');
      } else {
        whitePane.statusEl.textContent = t('replay.winnerBadge');
        blackPane.statusEl.textContent = t('replay.lostBadge');
      }
    } else if (winner === 'black') {
      blackPane.el.classList.add('winner');
      whitePane.el.classList.add('loser');
      if (endStatusMode === 'clock') {
        applyClockEndGameState('black');
      } else {
        blackPane.statusEl.textContent = t('replay.winnerBadge');
        whitePane.statusEl.textContent = t('replay.lostBadge');
      }
    } else {
      // Draw — neither side gets winner/loser visual state.
      if (endStatusMode === 'clock') {
        applyClockEndGameState(null);
      } else {
        whitePane.statusEl.textContent = t('replay.drawBadge');
        blackPane.statusEl.textContent = t('replay.drawBadge');
      }
    }
    truthPane.el.classList.add('finished');
    truthPane.statusEl.textContent = endStatusMode === 'clock' ? '' : reasonLabel;
  }

  function clearClockEndGameState(): void {
    if (endStatusMode !== 'clock') return;
    clockPanel.whiteRow.classList.remove('result-win', 'result-loss', 'result-draw');
    clockPanel.blackRow.classList.remove('result-win', 'result-loss', 'result-draw');
    compactClockTopName.classList.remove('result-win', 'result-loss', 'result-draw');
    compactClockBottomName.classList.remove('result-win', 'result-loss', 'result-draw');
    updateCompactClockNames();
  }

  function applyClockEndGameState(winner: Color | null): void {
    // The clock times give way to the result (1 / 0 / ½) at the final ply, so a
    // viewer catching the end-of-game hold sees who won. Runs after render()'s
    // renderClockState, and ticking has stopped by then, so nothing overwrites it;
    // scrubbing back re-renders the real times and clearClockEndGameState resets.
    clockPanel.whiteTime.textContent = winner === null ? '½' : winner === 'white' ? '1' : '0';
    clockPanel.blackTime.textContent = winner === null ? '½' : winner === 'black' ? '1' : '0';
    if (winner === null) {
      clockPanel.whiteRow.classList.add('result-draw');
      clockPanel.blackRow.classList.add('result-draw');
      updateCompactClockNames(undefined, { black: 'draw', white: 'draw' });
      return;
    }
    const winnerRow = winner === 'white' ? clockPanel.whiteRow : clockPanel.blackRow;
    const loserRow = winner === 'white' ? clockPanel.blackRow : clockPanel.whiteRow;
    winnerRow.classList.add('result-win');
    loserRow.classList.add('result-loss');
    updateCompactClockNames(undefined, {
      [winner]: 'win',
      [winner === 'white' ? 'black' : 'white']: 'loss',
    });
  }

  if (showControls) {
    firstBtn.addEventListener('click', () => {
      stopPlay();
      clearLoopTimer();
      finishedAck = false;
      setCurrentPly(0);
      render();
    });
    prevBtn.addEventListener('click', () => {
      stopPlay();
      clearLoopTimer();
      finishedAck = false;
      if (currentPly > 0) {
        setCurrentPly(currentPly - 1);
        render();
      }
    });
    nextBtn.addEventListener('click', () => {
      stopPlay();
      clearLoopTimer();
      if (currentPly < moveCount) {
        setCurrentPly(currentPly + 1);
        render();
      }
    });
    lastBtn.addEventListener('click', () => {
      stopPlay();
      clearLoopTimer();
      setCurrentPly(moveCount);
      render();
    });
    playBtn.addEventListener('click', () => {
      if (playTimer !== null) {
        stopPlay();
      } else if (currentPly >= moveCount) {
        finishedAck = false;
        setCurrentPly(0);
        render();
        startPlay();
      } else {
        startPlay();
      }
    });
    flipBtn.addEventListener('click', () => {
      boardOrientation = boardOrientation === 'white' ? 'black' : 'white';
      applyBoardOrientation();
      render();
    });
  }

  if (keyboardNav) {
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          stopPlay();
          clearLoopTimer();
          finishedAck = false;
          if (currentPly > 0) {
            setCurrentPly(currentPly - 1);
            render();
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          stopPlay();
          clearLoopTimer();
          if (currentPly < moveCount) {
            setCurrentPly(currentPly + 1);
            render();
          }
        } else if (e.key === 'a' && annotation && annotPanel) {
          e.preventDefault();
          stopPlay();
          clearLoopTimer();
          annotPanel.form.focus();
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          boardOrientation = boardOrientation === 'white' ? 'black' : 'white';
          applyBoardOrientation();
          render();
        }
      },
      { signal: abortController.signal },
    );
  }
  abortController.signal.addEventListener(
    'abort',
    () => {
      stopPlay();
      clearLoopTimer();
      clearWallClockTimer();
      if (replayAbortControllers.get(root) === abortController) {
        replayAbortControllers.delete(root);
      }
    },
    { once: true },
  );

  // If the initial sample fails to load (e.g. a DB game with no events endpoint),
  // fall through to the next available loop sample rather than crashing the mount.
  try {
    await loadGame(initialReplaySampleId, {
      initialPly: wallClockInitial?.ply,
      startAutoplay: !wallClockLoop,
    });
  } catch (err) {
    const fallback =
      loopSamples?.find((id) => id !== initialReplaySampleId) ??
      wallClockLoop?.samples.find((sample) => sample.sampleId !== initialReplaySampleId)?.sampleId;
    if (fallback) {
      await loadGame(fallback);
    } else {
      throw err;
    }
  }
  startWallClockLoop();

  function applyBoardOrientation(): void {
    whiteCg.set({ orientation: boardOrientation });
    truthCg.set({ orientation: boardOrientation });
    blackCg.set({ orientation: boardOrientation });
  }

  return {
    activeSampleId: () => activeSample,
    destroy: () => abortController.abort(),
    loadGame,
    // A manual jump pauses autoplay (and the loop timer), mirroring the moves
    // panel's onJump; render() fires notifyPlyChange so the /watch move list
    // re-highlights.
    jumpToPly: (ply: number) => {
      stopPlay();
      clearLoopTimer();
      finishedAck = false;
      setCurrentPly(ply);
      render();
    },
    plyCount: () => moveCount,
    moveEntries: () => buildChessMoveEntries(events),
    // The clocks read off the same state (and the same instant) the docked clock panel
    // draws from: the ply's recorded value, which holds until the next move lands. Null for
    // an untimed game (no ClockState) so the rail shows no clock rather than a bogus zero.
    clockAtPly: () => {
      const state = renderedClockState;
      const clock = state?.clock;
      if (!state || !clock) return null;
      const at = replayClockDisplayAt(renderedClockEvents ?? [], state) ?? clock.runningSince ?? 0;
      return {
        first: clockRemainingMs(clock, 'white', at),
        second: clockRemainingMs(clock, 'black', at),
        // Mid-replay the side to move owns the running clock; a finished/pregame position
        // parks both.
        toMove:
          state.status.type === 'playing'
            ? state.status.turn === 'white'
              ? 'first'
              : 'second'
            : null,
      };
    },
    // Switch the visible pane via a data-attr on the replay root; watch-route.css
    // maps data-watch-pov -> which of the already-rendered white/truth/black panes
    // shows. No re-render needed: all three panes render every ply (watch sets
    // revealOnFinish:false, so white/black hold each side's own fogged view while
    // truth reveals). HIDDEN-INFO NOTE: watch only ever serves COMPLETED games, so
    // a side's now-public past fogged view leaks nothing the reveal gate hasn't
    // already opened — this only chooses which public board to look at.
    setPov: (kind: 'white' | 'truth' | 'black') => {
      root.dataset.watchPov = kind;
    },
    availablePovs: () => ['white', 'truth', 'black'],
    bottomSeat: () => (boardOrientation === 'white' ? 'first' : 'second'),
    prefetchGame: (sampleId: string) => {
      if (
        abortController.signal.aborted ||
        activeSample === sampleId ||
        prefetchedEvents?.id === sampleId
      ) {
        return;
      }
      const promise = fetchEvents(sampleId);
      void promise.catch(() => undefined);
      prefetchedEvents = { id: sampleId, promise };
    },
    // Swap the loop pool in place. By default the active game keeps playing and
    // pickNextSample reads loopSamples live, so the next pick comes from the new
    // pool — no reschedule, which would cut the current game short. With
    // { jumpNow }, load a fresh pick immediately: the static placeholder plays
    // ~3 min before the loop would rotate, so we don't make a visitor wait it out
    // once real games exist.
    updateLoopPool: (sampleIds: string[], options?: { jumpNow?: boolean }) => {
      if (wallClockLoop) return;
      loopSamples = sampleIds;
      if (!options?.jumpNow || sampleIds.length === 0) return;
      const next = pickNextSample(sampleIds, activeSample);
      void loadGame(next).catch((err) => {
        console.warn('[replay loop] jump-to-pool load failed, recovering:', next, err);
        // loadGame stops play + clears the loop timer before it can throw, so the
        // board would otherwise freeze. Reschedule the loop to pick another game.
        scheduleLoopIfNeeded();
      });
    },
  };
}

function pickNextSample(pool: string[], current: string): string {
  if (pool.length <= 1) return pool[0] ?? current;
  const others = pool.filter((id) => id !== current);
  return others[Math.floor(Math.random() * others.length)] ?? pool[0];
}

// Lucide arrow-down-up (ISC): swap-orientation glyph, same 24-grid / 2px round
// spec as the share icon and landing CTAs so every outline icon is one family.
const ICON_FLIP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>';

function controlButton(text: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'replay-button';
  btn.textContent = text;
  btn.title = title;
  return btn;
}

function sliceToPly(events: GameEvent[], ply: number): GameEvent[] {
  const result: GameEvent[] = [];
  let moves = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      if (moves >= ply) break;
      result.push(event);
      moves += 1;
    } else {
      result.push(event);
    }
  }
  return result;
}

// A variant-agnostic move list for the /watch right-rail: one entry per
// move-played event, `ply` 1-based to match currentPly. Prefer SAN (from the
// shared algebraic labeler) and fall back to from-to coordinates. Mirrors
// dark-chess-postgame's buildMoveEntries so both surfaces read the same.
function buildChessMoveEntries(events: GameEvent[]): MoveListEntry[] {
  const labels = algebraicMoveLabels(events, events[0]?.roomId ?? 'replay');
  const entries: MoveListEntry[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type !== 'move-played') continue;
    entries.push({
      ply: entries.length + 1,
      label: labels.get(index + 1) ?? coordinateMoveLabel(event.move),
    });
  }
  return entries;
}

/** Color of the most recent move in a ply slice (null before any move). */
function lastMovePlayedColor(events: GameEvent[]): Color | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === 'move-played') return event.color;
  }
  return null;
}

function defaultUrlForId(sampleId: string): string {
  const safeId = sampleId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error(`invalid replay id: ${sampleId}`);
  return `/replay-samples/${safeId}.jsonl`;
}

async function loadEvents(
  sampleId: string,
  urlForId: (id: string) => string = defaultUrlForId,
): Promise<GameEvent[]> {
  const url = urlForId(sampleId);
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`failed to load replay sample ${sampleId} at ${url}: ${resp.status}`);
  const text = await resp.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GameEvent);
}

function gameOverSuffix(state: GameState): string {
  if (state.status.type !== 'finished') return '';
  const winner = state.status.winner;
  const reason = endGameReasonLabel(state.status.reason);
  if (!winner) return t('replay.drawnBySuffix', { reason });
  return t('replay.colorWinsSuffix', {
    color: winner === 'white' ? t('setup.white') : t('setup.black'),
    reason,
  });
}

function endGameReasonLabel(reason: string): string {
  if (reason === 'king-captured') return t('replay.endKingCaptured');
  if (reason === 'timeout') return t('replay.endTimeout');
  if (reason === 'checkmate') return t('replay.endCheckmate');
  if (reason === 'draw') return t('replay.endDraw');
  return reason;
}
