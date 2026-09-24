// Unified review layout. Two things live here:
//
//  1. `createReviewScaffold` — the pure LAYOUT: the hugging left/center/right
//     shell, the review-stage (dominant primary board + click-to-promote
//     secondaries), the underboard region, the eval-gauge column, the rail
//     material rows + strip adoption, the board-zoom grip, the uniboard token
//     grid (shared with the live room), and the viewport-fill sizing. It is
//     navigation-agnostic: the caller supplies the right-rail `navigation`
//     element (a linear scrubber, or a tree nav bar) and drives rendering.
//
//  2. `mountReviewLayout` — the LINEAR controller every variant's /game review
//     rides: an integer-ply scrubber + keyboard over the scaffold. Its adapter is
//     unchanged, so every postgame page keeps working untouched. The interactive
//     analysis board rides the SAME scaffold with a path-based (tree) controller,
//     so both surfaces share one layout and size identically.

import { reviewOpenedProps, track } from '../analytics.js';
import { attachBoardResizeGrip, currentBoardScale, restoreBoardScale } from '../board-resize.js';
import { createGameFavoriteButton } from '../game-favorite.js';
import { t } from '../i18n/catalog.js';
import { createReviewControls, REVIEW_MENU_ICONS } from './review-controls.js';
import { type BoardStageHandle, type BoardStageSlot, createBoardStage } from './review-stage.js';
import '../seat-disc-ink.css';
import './review-shell.css';
import { createReviewShell } from './review-shell.js';

export type ReviewBoardEntry = {
  /** Stable identity (e.g. 'truth' | 'white' | 'black' | 'red'). */
  key: string;
  tier: 'primary' | 'secondary';
  /** The board host element (its own label + board) the variant renders into. */
  el: HTMLElement;
};

export type ReviewRenderContext = {
  ply: number;
  flipped: boolean;
  primaryKey: string;
};

export type ReviewSurface = 'analysis' | 'game' | 'study';

export type ReviewLayoutAdapter = {
  /** Root <main> class hook (e.g. 'dark-xiangqi-review'). */
  pageClassName?: string;
  ariaLabel: string;
  title: string;
  summary: string;
  /** Play again / home / room actions row. Optional on review pages with no local actions. */
  actions?: HTMLElement;
  /** Left-rail details panel (result / clock / date …). Optional. */
  details?: HTMLElement;
  /** Lichess-style game meta card (glyph / time control / players / result).
   *  When present it REPLACES the eyebrow/title/summary info card; the actions
   *  row renders beneath it. Build with review/game-meta-card.ts. */
  metaCard?: HTMLElement;
  /** Right-rail move list container (the layout owns the scrubber below it). */
  moves: HTMLElement;
  /** Controls pinned to the bottom of the right rail (e.g. a Reveal toggle).
   *  Kept out of the left rail so it stays button-free and uniform. */
  railFooter?: HTMLElement;
  enginePanel?: HTMLElement;
  analysisSummary?: HTMLElement;
  underboard?: HTMLElement;
  /** Eval gauge (thin vertical bar) — gets its own grid column between the
   *  board and the tools rail (lichess's gauge area). Hidden on col1. */
  gauge?: HTMLElement;
  /** Optional line right below the move list (lichess "Mistake. X was best."). */
  moveComment?: HTMLElement;
  /** Captured-material rows in the right rail (lichess round: mat-top above
   *  the table, mat-bot below). The variant re-fills them per ply/flip. */
  materialTop?: HTMLElement;
  materialBottom?: HTMLElement;
  /** Show captured material / reserves around the board or in the right rail.
   *  Off by default so every review's center column is board-only. */
  showBoardMaterial?: boolean;
  boards: ReviewBoardEntry[];
  /** Board width / height, e.g. 552 / 612 for xiangqi. Drives the fill sizing. */
  boardAspect: number;
  /** Board columns (files). Sizes captured-material tiles to ≈ one board cell so
   *  they match the on-board pieces. Default 12 (small, generic). */
  boardCols?: number;
  /** Extra vertical px each board host adds beyond the board itself (reserve /
   *  hand / capture strips). Budgeted into the fill sizing so the page still
   *  fits without a vertical scroll. Default 0. */
  boardChromePx?: number;
  /** Width (px) of each click-to-promote secondary board. Default 92. */
  secondaryWidthPx?: number;
  /** Absolute primary-board width cap (px). */
  boardMaxPx?: number;
  maxPly: number;
  /** Re-render every board host for the given ply / flip / primary. */
  renderBoards(ctx: ReviewRenderContext): void;
  /** Optional: re-render an interactive move list for the ply; `jump` moves to a
   *  ply when a move row is clicked. Called on every ply change. */
  renderMoves?(ctx: ReviewRenderContext, jump: (ply: number) => void): void;
};

const NAV_AND_PADDING_PX = 122; // site nav + shell top/bottom padding
const VIEWPORT_CHROME_PX = 108;
const RAILS_AND_GUTTERS_PX = 640;
// Where a full-page review's cluster starts (site nav + shell top padding): an
// embedded review below a taller host header gives the difference back.
const EMBED_BASE_TOP_PX = 76;
const EMBED_MIN_BOARD_H_PX = 440;
// Matches the embedded shell's two-column container query (review-shell.css).
const EMBED_TWO_COLUMN_MIN_PX = 640;
const PRIMARY_LABEL_PX = 30;
const STACK_GAP_PX = 16;
const SECONDARY_LABEL_PX = 24;
const SECONDARY_WIDTH_PX = 92;
const FLANK_GAP_PX = 8;
// Eval gauge footprint beside the board: bar width 20 + gap 8 (eval-bar.ts).
const EVAL_GAUGE_PX = 28;

// ─────────────────────────────────────────────────────────────────────────────
// Scaffold — the shared, navigation-agnostic layout.
// ─────────────────────────────────────────────────────────────────────────────

/** Sizing inputs shared by applyBoardSizing / fitPrimaryToViewport. */
type SizingInput = {
  boards: ReviewBoardEntry[];
  boardAspect: number;
  boardCols?: number;
  boardChromePx?: number;
  secondaryWidthPx?: number;
  boardMaxPx?: number;
};

export type ReviewScaffoldConfig = SizingInput & {
  /** Stops the resize work when the review is destroyed. */
  signal?: AbortSignal;
  /** Board and moves only, inside a host page's column (review-shell.ts). */
  embedded?: boolean;
  /** Product surface using the shared scaffold. Analysis and game reviews share
   *  the same board/rail alignment contract; studies keep their document UI. */
  reviewSurface: ReviewSurface;
  ariaLabel: string;
  pageClassName?: string;
  /** Info-card eyebrow when no metaCard ('Game review' / 'Analysis'). */
  eyebrow?: string;
  title: string;
  summary: string;
  actions?: HTMLElement;
  details?: HTMLElement;
  metaCard?: HTMLElement;
  underboard?: HTMLElement;
  enginePanel?: HTMLElement;
  moves: HTMLElement;
  moveComment?: HTMLElement;
  /** Study annotation controls (glyph picker + comment editor), below the move
   *  list and above navigation in the rail box. Absent = a read-only review. */
  annotations?: HTMLElement;
  /** The right-rail navigation element: a linear scrubber or a tree nav bar. */
  navigation: HTMLElement;
  /** Panel that opens over the rail from a control-bar tool (the opening
   *  explorer). Sits directly above navigation, so the tool that toggles it is
   *  adjacent to what it opens. */
  railPanel?: HTMLElement;
  analysisSummary?: HTMLElement;
  /** Controls pinned to the bottom of the right rail (e.g. a Reveal toggle). */
  railFooter?: HTMLElement;
  gauge?: HTMLElement;
  materialTop?: HTMLElement;
  materialBottom?: HTMLElement;
  /** Show captured material / reserves around the board or in the right rail.
   *  Off by default so the primary board determines all three column heights. */
  showBoardMaterial?: boolean;
  /** Lichess analyse behavior: the underboard (advantage chart) lives below the
   *  fold instead of shrinking the board to keep everything above it. The board
   *  fills the viewport; the page scrolls to the chart. */
  underboardOverflows?: boolean;
  /** Fires after a secondary board is promoted; the caller re-renders (the
   *  scaffold re-fits afterward). */
  onPromote?(): void;
};

export type ReviewScaffold = {
  stage: BoardStageHandle;
  /** Re-measure and size the primary board to fill the viewport. Call once after
   *  the first render, and whenever the underboard region changes height. */
  refit(): void;
  /** Update the board width/height ratio after an appearance change, then refit. */
  setBoardAspect(aspect: number): void;
  /** Host for a panel that rises over the BOTTOM of the moves box and sits on
   *  the board's bottom line (the explorer's overlay grammar, sized to content):
   *  retro mode's box lives here while it is open. Empty = nothing drawn. */
  railFooter: HTMLElement;
};

/** Build the shared review layout into `root`. The caller renders board/move
 *  content and drives navigation; the scaffold owns the shell, stage, sizing,
 *  gauge, material rows, and zoom grip. */
export function createReviewScaffold(
  root: HTMLElement,
  config: ReviewScaffoldConfig,
): ReviewScaffold {
  // Both review controllers (linear and tree) build their chrome here, so this
  // is the one place a game review open can be counted. Studies and the
  // analysis board are other surfaces and stay out of the funnel.
  if (config.reviewSurface === 'game') {
    track(
      'review_opened',
      reviewOpenedProps({
        pathname: window.location.pathname,
        referrer: document.referrer,
        origin: window.location.origin,
        reviewSurface: config.reviewSurface,
        hasAnalysis: Boolean(config.analysisSummary || config.enginePanel),
        pageClassName: config.pageClassName ?? null,
      }),
    );
  }
  let boardAspect = config.boardAspect;
  const sizingConfig = (): SizingInput => ({ ...config, boardAspect });
  const slots: BoardStageSlot[] = config.boards.map((board) => ({
    key: board.key,
    el: board.el,
    tier: board.tier,
  }));

  const stage = createBoardStage(slots, {
    onPromote: () => {
      config.onPromote?.();
      refit();
    },
  });

  const showBoardMaterial = config.showBoardMaterial ?? false;
  stage.el.classList.toggle('review-stage--board-only', !showBoardMaterial);

  // Material is intentionally absent from the standardized review for now. Keep
  // the old adoption path behind an explicit switch so a future material rework
  // can restore it without changing variant replay adapters.
  let adoptedMaterialTop: HTMLElement | undefined;
  let adoptedMaterialBottom: HTMLElement | undefined;
  const stripsAdopted =
    showBoardMaterial && !config.materialTop && !config.materialBottom && slots.length === 1;
  if (stripsAdopted && slots[0]) {
    const strips = [...slots[0].el.querySelectorAll<HTMLElement>(':scope > .captures-strip')];
    const top = strips.find(
      (strip) =>
        strip.classList.contains('replay-captures-top') ||
        strip.classList.contains('captures-strip-top'),
    );
    const bottom = strips.find((strip) => strip !== top);
    adoptedMaterialTop = top;
    adoptedMaterialBottom = bottom;
  }
  const materialTop = showBoardMaterial ? (config.materialTop ?? adoptedMaterialTop) : undefined;
  const materialBottom = showBoardMaterial
    ? (config.materialBottom ?? adoptedMaterialBottom)
    : undefined;

  applyBoardSizing(
    stage.el,
    sizingConfig(),
    !showBoardMaterial || stripsAdopted,
    !showBoardMaterial,
  );

  const favoriteGameId = root.dataset.favoriteGameId;
  if (favoriteGameId && config.metaCard) {
    config.metaCard.append(createGameFavoriteButton(favoriteGameId, { compact: true }));
  }
  const actions =
    favoriteGameId && !config.metaCard
      ? reviewActionsWithFavorite(config.actions, favoriteGameId)
      : config.actions;
  const left = config.embedded ? [] : infoRail({ ...config, actions });
  // Right rail, lichess order: material-top · [analyse table: engine panel ·
  // move list · advice · navigation] · summary · material-bottom. The analyse
  // table is ONE visually connected box (lichess's analyse tools) whose bottom
  // tracks the board bottom; the summary sits below it.
  materialTop?.classList.add('review-material-row');
  materialBottom?.classList.add('review-material-row');
  const railMain = document.createElement('div');
  railMain.className = 'review-rail-main';
  // The box that tracks the board's bottom is MOVES ONLY (engine head + move list +
  // advice + any study annotations). Playback controls live BELOW it (lichess
  // analyse), so the box bottom lines up with the board and the controls sit under
  // both — see config.navigation's position in the rail group below.
  //
  // A study is the exception: its rail carries no analysis summary, so the box IS
  // the bottom of the column, and unfused controls left a dead gap between the box
  // and the board line. There the controls become the box's last strip, and the box
  // bottom lands on the board bottom. Fusing requires no rail panel: the opening
  // explorer overlays railMain and would cover controls fused inside it.
  // Material rows change where the controls belong. With a pocket, the box that
  // tracks the board is [top pocket · moves · bottom pocket] and the controls sit
  // BELOW it (lichess crazyhouse), so fusing them into the moves strip would
  // sandwich them above the bottom pocket instead.
  const hasPocketBox = Boolean(materialTop || materialBottom);
  const fuseNavigation = config.reviewSurface === 'study' && !config.railPanel && !hasPocketBox;
  railMain.append(
    ...[
      config.enginePanel,
      config.moves,
      config.moveComment,
      config.annotations,
      fuseNavigation ? config.navigation : null,
    ].filter((el): el is HTMLElement => el != null),
  );
  // The rail panel (opening explorer) OVERLAYS the moves region rather than
  // pushing it: a positioned wrapper holds railMain, and the panel absolutely
  // fills it when open, scrolling on its own. Navigation stays a sibling below,
  // so the scrub controls remain usable with the explorer open.
  const railMainWrap = document.createElement('div');
  railMainWrap.className = 'review-rail-mainwrap';
  railMainWrap.append(railMain);
  if (config.railPanel) {
    config.railPanel.classList.add('review-rail-overlay');
    railMainWrap.append(config.railPanel);
  }
  const railFooter = document.createElement('div');
  railFooter.className = 'review-rail-footer';
  railMainWrap.append(railFooter);
  // Drop-variant pockets are part of the analysis box, not rail rows floating
  // above and below it: lichess fuses [pocket · tools · pocket] into one panel
  // whose top and bottom land on the board's top and bottom. Wrapping the three
  // gives them a single gapless container to size against the board (CSS pins
  // its height); the moves region inside flexes, so the pockets stay pinned to
  // the box edges while the list absorbs the difference.
  let boardTrackingBox: HTMLElement = railMainWrap;
  if (hasPocketBox) {
    const pocketBox = document.createElement('div');
    pocketBox.className = 'review-rail-pocketbox';
    pocketBox.append(
      ...[materialTop, railMainWrap, materialBottom].filter((el): el is HTMLElement => el != null),
    );
    boardTrackingBox = pocketBox;
  }
  const right = railGroup(
    [
      boardTrackingBox,
      fuseNavigation ? null : config.navigation,
      config.analysisSummary,
      config.railFooter,
    ].filter((el): el is HTMLElement => el != null),
  );
  const center = config.underboard ? centerColumn(stage.el, config.underboard) : stage.el;

  const shell = createReviewShell({
    ariaLabel: config.ariaLabel,
    pageClassName: [config.pageClassName, `review-shell--${config.reviewSurface}`]
      .filter(Boolean)
      .join(' '),
    left,
    center,
    right,
    embedded: config.embedded,
  });
  if (config.gauge) {
    const cluster = shell.querySelector<HTMLElement>('.review-shell__cluster');
    if (cluster) {
      cluster.classList.add('review-shell__cluster--gauge');
      const gaugeCol = document.createElement('div');
      gaugeCol.className = 'review-shell__gauge';
      gaugeCol.append(config.gauge);
      cluster.append(gaugeCol);
    }
  }
  root.append(shell);

  // Board zoom: restore the persisted scale and glue the drag grip to the primary
  // slot's bottom-right corner (re-anchored after every refit).
  restoreBoardScale();
  const grip = attachBoardResizeGrip(stage.el, () =>
    stage.el.querySelector<HTMLElement>('.review-stage__slot--primary'),
  );
  const GRIP_SIZE_PX = 15;
  const GRIP_INSET_PX = 3;
  const positionGrip = (): void => {
    const slot = stage.el.querySelector<HTMLElement>('.review-stage__slot--primary');
    if (!slot) return;
    const slotRect = slot.getBoundingClientRect();
    const stageRect = stage.el.getBoundingClientRect();
    if (slotRect.width === 0 || stageRect.width === 0) return;
    // Tuck the handle just INSIDE the board's bottom-right corner (lichess), not
    // hanging off the outside edge.
    grip.style.right = `${Math.max(0, stageRect.right - slotRect.right) + GRIP_INSET_PX}px`;
    grip.style.bottom = 'auto';
    grip.style.top = `${slotRect.bottom - stageRect.top - GRIP_SIZE_PX - GRIP_INSET_PX}px`;
  };

  function refit(): void {
    applyBoardSizing(
      stage.el,
      sizingConfig(),
      !showBoardMaterial || stripsAdopted,
      !showBoardMaterial,
    );
    fitPrimaryToViewport(stage.el, boardAspect, config.boardMaxPx, {
      underboardOverflows: config.underboardOverflows,
    });
    setTimeout(positionGrip, 60);
  }

  function setBoardAspect(aspect: number): void {
    boardAspect = aspect;
    refit();
  }

  const signal = config.signal;
  const refitUnlessDestroyed = () => {
    if (!signal?.aborted) refit();
  };
  setTimeout(refitUnlessDestroyed, 60);
  setTimeout(refitUnlessDestroyed, 260);
  window.addEventListener('resize', refit, signal ? { signal } : undefined);
  if (typeof ResizeObserver !== 'undefined') {
    let lastViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const observer = new ResizeObserver(() => {
      if (window.innerHeight === lastViewportHeight) return;
      lastViewportHeight = window.innerHeight;
      refit();
    });
    observer.observe(stage.el);
    signal?.addEventListener('abort', () => observer.disconnect(), { once: true });
  }

  return { stage, refit, setBoardAspect, railFooter };
}

function reviewActionsWithFavorite(existing: HTMLElement | undefined, roomId: string): HTMLElement {
  const actions = existing ?? document.createElement('div');
  actions.classList.add('review-actions');
  actions.append(createGameFavoriteButton(roomId));
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Linear controller — every /game review page. Unchanged behavior.
// ─────────────────────────────────────────────────────────────────────────────

export function mountReviewLayout(root: HTMLElement, adapter: ReviewLayoutAdapter): void {
  let ply = adapter.maxPly;
  let flipped = false;

  // Shared lichess control bar (nav + menu overlay), the SAME component the
  // xiangqi tree surface uses — so every /game review page carries identical
  // chrome. Playback stays integer-ply over server snapshots; only the chrome is
  // standardized. The muted placeholders were cut 2026-07-23 (see tree-review.ts
  // for the reasoning); this controller replays server snapshots and owns no
  // tree, so it cannot offer Study or Clear moves either. Flip is what it has.
  const controls = createReviewControls({
    onFirst: () => go(0),
    onPrevious: () => go(ply - 1),
    onNext: () => go(ply + 1),
    onLast: () => go(adapter.maxPly),
    menuItems: [
      { label: t('review.flipBoard'), icon: REVIEW_MENU_ICONS.flip, onClick: () => flip() },
    ],
  });
  const scaffold = createReviewScaffold(root, {
    reviewSurface: 'game',
    ariaLabel: adapter.ariaLabel,
    pageClassName: adapter.pageClassName,
    eyebrow: 'Game review',
    title: adapter.title,
    summary: adapter.summary,
    actions: adapter.actions,
    details: adapter.details,
    metaCard: adapter.metaCard,
    boards: adapter.boards,
    boardAspect: adapter.boardAspect,
    boardCols: adapter.boardCols,
    boardChromePx: adapter.boardChromePx,
    secondaryWidthPx: adapter.secondaryWidthPx,
    boardMaxPx: adapter.boardMaxPx,
    underboard: adapter.underboard,
    enginePanel: adapter.enginePanel,
    moves: adapter.moves,
    moveComment: adapter.moveComment,
    navigation: controls.el,
    analysisSummary: adapter.analysisSummary,
    railFooter: adapter.railFooter,
    gauge: adapter.gauge,
    materialTop: adapter.materialTop,
    materialBottom: adapter.materialBottom,
    showBoardMaterial: adapter.showBoardMaterial,
    onPromote: () => render(),
  });

  function render(): void {
    const ctx = { ply, flipped, primaryKey: scaffold.stage.primaryKey() };
    adapter.renderBoards(ctx);
    adapter.renderMoves?.(ctx, go);
    controls.setBounds({ atStart: ply <= 0, atEnd: ply >= adapter.maxPly });
  }

  const go = (target: number): void => {
    ply = Math.max(0, Math.min(adapter.maxPly, target));
    render();
  };
  const flip = (): void => {
    flipped = !flipped;
    render();
  };

  installReviewKeyboard({
    stepBack: () => go(ply - 1),
    stepForward: () => go(ply + 1),
    toStart: () => go(0),
    toEnd: () => go(adapter.maxPly),
    flip,
  });

  render();
  scaffold.refit();
}

// Global playback keys (arrows anywhere on the page, lichess-style), ignoring
// typing targets. Shared by the linear scrubber and the tree nav.
export function installReviewKeyboard(
  handlers: {
    stepBack(): void;
    stepForward(): void;
    toStart(): void;
    toEnd(): void;
    /** Optional: `f` flips the board. Surfaces without a flip (Mistboard TV,
     *  whose only orientation control is the fog POV toggle) omit it, and `f`
     *  keeps its default behavior there. */
    flip?(): void;
    /** Optional: when this returns false the whole listener stands down for that
     *  keypress, so arrows keep scrolling the page on a surface with nothing to
     *  step through (TV's live-follow board owns no ply). */
    enabled?(): boolean;
    /** Optional: dismiss a transient chooser (the tree surface's variation picker). */
    escape?(): void;
    /** Optional: `a` toggles the engine's on-board arrows (lichess parity). Only
     *  the tree surface draws them, so the linear controller omits this. */
    toggleArrows?(): void;
    /** Optional: Space plays the current local engine's top move. Returns false
     *  while the engine is off or has no legal fresh result, preserving normal
     *  Space behavior in those states. */
    playBestMove?(): boolean;
  },
  /** Optional abort signal to remove the listener (e.g. when a surface re-mounts). */
  signal?: AbortSignal,
): void {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (handlers.enabled && !handlers.enabled()) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlers.stepBack();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handlers.stepForward();
      } else if (event.key === 'ArrowUp' || event.key === 'Home') {
        event.preventDefault();
        handlers.toStart();
      } else if (event.key === 'ArrowDown' || event.key === 'End') {
        event.preventDefault();
        handlers.toEnd();
      } else if ((event.key === 'f' || event.key === 'F') && handlers.flip) {
        event.preventDefault();
        handlers.flip();
      } else if ((event.key === 'a' || event.key === 'A') && handlers.toggleArrows) {
        event.preventDefault();
        handlers.toggleArrows();
      } else if (
        (event.key === ' ' || event.code === 'Space') &&
        !event.repeat &&
        handlers.playBestMove &&
        // Let focused controls keep native Space activation (notably the engine
        // switch and settings gear). Inputs/selects already returned above.
        !target?.closest('button, a, [role="button"]') &&
        handlers.playBestMove()
      ) {
        event.preventDefault();
      } else if (event.key === 'Escape' && handlers.escape) {
        event.preventDefault();
        handlers.escape();
      }
    },
    { signal },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board sizing (viewport-fill). Shared by every scaffold consumer.
// ─────────────────────────────────────────────────────────────────────────────

function fitPrimaryToViewport(
  stageEl: HTMLElement,
  aspect: number,
  maxPx?: number,
  opts?: { underboardOverflows?: boolean },
): void {
  scheduleAnimationFrame(() => {
    if (typeof window === 'undefined') return;
    const centerCol = stageEl.parentElement;
    const underboard = centerCol?.classList.contains('review-center-column')
      ? centerCol.querySelector<HTMLElement>('.review-underboard')
      : null;
    // Below-the-fold underboards (lichess analyse chart) don't shrink the board:
    // they contribute 0 to the height budget and the page scrolls to them.
    const underboardPx =
      underboard && !opts?.underboardOverflows
        ? underboard.getBoundingClientRect().height + STACK_GAP_PX
        : 0;
    const cluster = stageEl.closest<HTMLElement>('.review-shell__cluster');
    // An embedded review starts below its host's header, not under the site
    // nav, so the board fits the height left beneath that header, never less
    // than a readable board.
    // One column (a phone) scrolls past the header to a full-width board.
    const embeddedShell = cluster?.closest<HTMLElement>('.review-shell--embedded');
    const hostHeaderPx =
      cluster && embeddedShell && embeddedShell.clientWidth >= EMBED_TWO_COLUMN_MIN_PX
        ? Math.round(
            Math.min(
              Math.max(0, cluster.getBoundingClientRect().top + window.scrollY - EMBED_BASE_TOP_PX),
              Math.max(0, window.innerHeight - VIEWPORT_CHROME_PX - EMBED_MIN_BOARD_H_PX),
            ),
          )
        : 0;
    if (cluster) {
      const baseChrome = Number(cluster.dataset.uniBaseChrome ?? '0') || 0;
      cluster.style.setProperty(
        '--uni-board-chrome-h',
        `${baseChrome + Math.round(underboardPx) + hostHeaderPx}px`,
      );
    }
    const available = window.innerHeight - VIEWPORT_CHROME_PX - underboardPx - hostHeaderPx;
    const slot = stageEl.querySelector<HTMLElement>('.review-stage__slot--primary');
    if (available <= 0 || !slot) return;
    const visibleStageRows = [...stageEl.children].filter(
      (child) => child.getBoundingClientRect().height > 0,
    );
    const gaps = Math.max(0, visibleStageRows.length - 1) * STACK_GAP_PX;
    const contentHeight =
      visibleStageRows.reduce((h, child) => h + child.getBoundingClientRect().height, 0) + gaps;
    const currentWidth = slot.getBoundingClientRect().width;
    const flankBoard = slot.querySelector<HTMLElement>('.review-flank__board');
    const boardWidth = flankBoard ? flankBoard.getBoundingClientRect().width : currentWidth;
    const flankCols = flankBoard
      ? [...slot.querySelectorAll<HTMLElement>('.review-flank__col')]
      : [];
    const flankPx = flankCols.reduce(
      (width, col) => width + col.getBoundingClientRect().width + FLANK_GAP_PX,
      0,
    );
    const nonBoardChrome = Math.max(0, contentHeight - boardWidth / aspect);
    const centerEl = stageEl.closest<HTMLElement>('.review-shell__center');
    const gaugePx = stageEl.querySelector('.review-eval-bar') ? EVAL_GAUGE_PX : 0;
    const measuredCap = centerEl ? centerEl.getBoundingClientRect().width - gaugePx : 0;
    const widthCap =
      measuredCap > 0 ? measuredCap : Math.max(240, window.innerWidth - RAILS_AND_GUTTERS_PX);
    const targetBoardWidth = Math.floor(
      (available - nonBoardChrome - 6) * aspect * currentBoardScale(),
    );
    const targetWidth = Math.max(
      160,
      Math.min(widthCap, maxPx ?? Number.POSITIVE_INFINITY, targetBoardWidth + flankPx),
    );
    stageEl.style.setProperty('--review-stage-primary-max', `${targetWidth}px`);
    stageEl
      .closest<HTMLElement>('.review-shell__cluster')
      ?.style.setProperty('--uni-board-fit-w', `${targetWidth}px`);
  });
}

function scheduleAnimationFrame(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function applyBoardSizing(
  stageEl: HTMLElement,
  config: SizingInput,
  materialOutsideBoard = false,
  primaryChromeHidden = false,
): void {
  const aspect = config.boardAspect;
  const extraPerBoard = materialOutsideBoard ? 0 : (config.boardChromePx ?? 0);
  const secondaryWidth = config.secondaryWidthPx ?? SECONDARY_WIDTH_PX;
  const hasSecondaries = config.boards.some((board) => board.tier === 'secondary');
  const secondaryStackPx = hasSecondaries
    ? STACK_GAP_PX + SECONDARY_LABEL_PX + Math.round(secondaryWidth / aspect) + extraPerBoard
    : 0;
  const primaryChromePx = primaryChromeHidden ? 0 : PRIMARY_LABEL_PX;
  const chromePx = NAV_AND_PADDING_PX + primaryChromePx + extraPerBoard + secondaryStackPx;
  const cluster = stageEl.closest<HTMLElement>('.review-shell__cluster');
  if (cluster) {
    cluster.style.setProperty('--uni-board-aspect', aspect.toFixed(4));
    const baseChrome = Math.max(0, chromePx - VIEWPORT_CHROME_PX);
    cluster.dataset.uniBaseChrome = String(baseChrome);
    cluster.style.setProperty('--uni-board-chrome-h', `${baseChrome}px`);
    cluster.style.removeProperty('--uni-board-fit-w');
  }
  stageEl.style.setProperty(
    '--review-stage-primary-max',
    `calc(min(max(240px, calc(100vw - ${RAILS_AND_GUTTERS_PX}px)), calc((100svh - ${chromePx}px) * ${aspect.toFixed(4)})) * var(--uni-board-scale, 1))`,
  );
  stageEl.style.setProperty('--review-stage-secondary-max', `${secondaryWidth}px`);
  stageEl.style.setProperty('--capture-cols', String(config.boardCols ?? 12));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rail composition.
// ─────────────────────────────────────────────────────────────────────────────

/* Returns the left rail's groups in order. `details` (the spectator chat) comes
   back as its OWN group rather than a third card in the primary one: on col1 the
   shell splits the two, so "who played, who won" lands under the board while the
   chat drops past the move list. Same visual stack on desktop (the rail is a
   12px-gap flex column either way). */
function infoRail(config: {
  metaCard?: HTMLElement;
  eyebrow?: string;
  title: string;
  summary: string;
  actions?: HTMLElement;
  details?: HTMLElement;
}): HTMLElement[] {
  const deferred = config.details ? [deferredRailGroup([config.details])] : [];
  if (config.metaCard) {
    const actions = config.actions;
    const actionsCard = actions ? document.createElement('div') : null;
    if (actionsCard && actions) {
      actionsCard.className = 'review-actions review-actions--rail';
      actionsCard.append(actions);
    }
    return [railGroup([config.metaCard, ...(actionsCard ? [actionsCard] : [])]), ...deferred];
  }
  const card = document.createElement('section');
  card.className = 'review-info-card';
  // An explicitly empty eyebrow ('') suppresses the row (the study page leads
  // with its title); undefined keeps the default label.
  if (config.eyebrow !== '') {
    const eyebrow = document.createElement('p');
    eyebrow.className = 'review-info-card__eyebrow';
    eyebrow.textContent = config.eyebrow ?? 'Game review';
    card.append(eyebrow);
  }
  const title = document.createElement('h1');
  title.className = 'review-info-card__title';
  title.textContent = config.title;
  const summary = document.createElement('p');
  summary.className = 'review-info-card__summary';
  summary.textContent = config.summary;
  card.append(title, summary);
  if (config.actions) card.append(config.actions);
  return [railGroup([card]), ...deferred];
}

function railGroup(children: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'review-rail-group';
  group.append(...children);
  return group;
}

/** A rail group the phone stack pushes below the move list. */
function deferredRailGroup(children: HTMLElement[]): HTMLElement {
  const group = railGroup(children);
  group.classList.add('review-rail-group--deferred');
  return group;
}

function centerColumn(stageEl: HTMLElement, underboard: HTMLElement): HTMLElement {
  const col = document.createElement('div');
  col.className = 'review-center-column';
  underboard.classList.add('review-underboard');
  col.append(stageEl, underboard);
  return col;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation bars.
// ─────────────────────────────────────────────────────────────────────────────

function scrubButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-scrubber__button';
  button.setAttribute('aria-label', label);
  button.textContent = text;
  return button;
}

/** A scrubber-styled nav bar for a non-linear (tree) controller: the same
 *  |< < > >| Flip chrome as the postgame, with a free-form status label. */
export function createReviewNavBar(handlers: {
  first(): void;
  previous(): void;
  next(): void;
  last(): void;
  flip(): void;
}): {
  el: HTMLElement;
  status: HTMLElement;
  setBounds(state: { atStart: boolean; atEnd: boolean }): void;
} {
  const el = document.createElement('div');
  el.className = 'review-scrubber';
  const status = document.createElement('span');
  status.className = 'review-scrubber__status';
  status.setAttribute('aria-live', 'polite');
  const first = scrubButton('|<', 'First move');
  const previous = scrubButton('<', 'Previous move');
  const next = scrubButton('>', 'Next move');
  const last = scrubButton('>|', 'End of line');
  const flip = scrubButton('Flip', t('review.flipBoard'));
  flip.title = `${t('review.flipBoard')} (f)`;
  first.addEventListener('click', handlers.first);
  previous.addEventListener('click', handlers.previous);
  next.addEventListener('click', handlers.next);
  last.addEventListener('click', handlers.last);
  flip.addEventListener('click', handlers.flip);
  el.append(status, first, previous, next, last, flip);
  return {
    el,
    status,
    setBounds({ atStart, atEnd }) {
      first.disabled = atStart;
      previous.disabled = atStart;
      next.disabled = atEnd;
      last.disabled = atEnd;
    },
  };
}
