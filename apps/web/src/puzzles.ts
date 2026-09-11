/**
 * The puzzles trainer page: the variant-agnostic session core. It owns the
 * session state machine (attempt/hint/reveal round-trips, replay scrubbing,
 * solved/failed/revealed flags), the page layout (board panel + trainer side
 * panel + sidebar), navigation/rotation, and keyboard handling.
 *
 * Everything per-variant (board painting, click/drag interaction, move
 * animation, replay move application, labels/icons, engine analysis) lives in
 * a PuzzleBoardAdapter resolved through puzzles/registry.ts. Adding a puzzle
 * variant = a new adapter module + a registry entry; this file does not
 * change. See puzzles/adapter.ts for the contract.
 */

import { resolvePuzzleShortCode, XIANGQI_SPEC_ID } from '@mistboard/game';
import './puzzles.css';
import {
  type PuzzleAttemptMode,
  type PuzzleAttemptOutcome,
  puzzleAttemptedProps,
  track,
} from './analytics.js';
import { attachBoardResizeGrip, restoreBoardScale } from './board-resize.js';
import { t } from './i18n/catalog.js';
import { initLiveSound, playSound } from './live-sound.js';
import {
  clonePuzzleState,
  isPuzzleComplete,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleNavigation,
  type PuzzleSession,
  type PuzzleState,
  type PuzzleSummary,
} from './puzzles/adapter.js';
import {
  fetchPuzzleDetail,
  fetchPuzzleHint,
  fetchPuzzleListWithAttempts,
  fetchPuzzleSolution,
  fetchUserPuzzleRating,
  getPuzzleRatedPref,
  PuzzlePlayDisabledError,
  reportAttemptRating,
  sendPuzzleQualityEvent,
  setOnAttemptRating,
  setPuzzleRatedPref,
  submitPuzzleAttempt,
  type UserPuzzleRating,
} from './puzzles/api.js';
import { feedbackPanel } from './puzzles/detail-panels.js';
import { moveListPanel } from './puzzles/move-list.js';
import { renderQueuePanel } from './puzzles/queue-panel.js';
import {
  allPuzzleBoardAdapters,
  type PuzzleVariant,
  puzzleBoardAdapter,
} from './puzzles/registry.js';
import {
  loadAutoNextEnabled,
  loadRatedEnabled,
  loadSeenPuzzles,
  loadSolvedPuzzleIds,
  rotatePuzzleOrder,
  saveAutoNextEnabled,
  saveRatedEnabled,
  saveSeenPuzzles,
  saveSolvedPuzzleIds,
} from './puzzles/storage.js';
import { buildNav } from './site-shell.js';
import { setBoardFamily, xiangqiAppearanceChangedEvent } from './theme.js';

export { puzzleMoveRowNumber } from './puzzles/move-list.js';
// Re-exported for the existing test surface (puzzles.test.ts) and any callers
// that predate the puzzles/ split.
export { sourceGameLines } from './puzzles/queue-panel.js';

type PuzzleVariantFilter = PuzzleVariant;

const AUTO_NEXT_DELAY_MS = 150;
// Cadence for auto-playing the revealed solution, one ply at a time (each step
// reuses the scrub-forward animation).
const REVEAL_STEP_MS = 650;

// Variants surfaced in the Settings variant picker (order = display order; the
// first is the default view). Standard Xiangqi (the mined real-game corpus,
// the bet variant) is the only surfaced trainer. Fortress and Jungle stay in
// the corpus + API for direct links, but are hidden from discovery for now.
// Mini / Drop Mini follow the same deep-link-only policy. Add a spec id here
// to unhide it.
const PUZZLE_VARIANT_FILTERS: readonly PuzzleVariantFilter[] = [XIANGQI_SPEC_ID];

export async function mountPuzzles(
  root: HTMLElement,
  initialPuzzleId: string | null = null,
): Promise<void> {
  for (const adapter of allPuzzleBoardAdapters()) adapter.installStyles?.();
  initLiveSound();
  setBoardFamily('xiangqi');
  root.classList.add('puzzles-page');
  // Before the first board paints: the scale is shared across every board
  // surface, so a size chosen on the analysis board is already the size this
  // page should open at.
  restoreBoardScale();
  installPuzzleGripFit();

  const shell = document.createElement('main');
  shell.className = 'site-section puzzles-shell';
  const header = document.createElement('div');
  header.className = 'puzzles-header';
  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = t('puzzle.heading');
  header.append(title);

  const layout = document.createElement('div');
  layout.className = 'puzzles-layout';
  const detail = document.createElement('section');
  detail.className = 'puzzle-detail';
  const controls = document.createElement('aside');
  controls.className = 'puzzles-sidebar';
  layout.append(detail, controls);
  shell.append(header, layout);
  root.replaceChildren(buildNav(), shell);

  let summaries: PuzzleSummary[] = [];
  let selectedId = initialPuzzleId;
  let variantFilter: PuzzleVariantFilter = PUZZLE_VARIANT_FILTERS[0] ?? XIANGQI_SPEC_ID;
  let session: PuzzleSession | null = null;
  const solvedIds = loadSolvedPuzzleIds();
  const seenPuzzles = loadSeenPuzzles();
  // Record a puzzle as seen (for the next visit's rotation) without disturbing
  // this visit's already-frozen queue order.
  const markPuzzleSeen = (id: string): void => {
    seenPuzzles.set(id, Date.now());
    saveSeenPuzzles(seenPuzzles);
  };
  let autoNext = loadAutoNextEnabled();
  let ratedEnabled = loadRatedEnabled();
  let userRating: UserPuzzleRating | null = null;
  let ratingDelta: number | null = null;
  let autoNextTimer: number | null = null;
  let loadToken = 0;
  let ratingToken = 0;
  setPuzzleRatedPref(ratedEnabled);

  const queueSummaries = (): PuzzleSummary[] => filterPuzzlesByVariant(summaries, variantFilter);

  // Refresh the signed-in user's rating for the current variant. Guarded by a
  // token so a slow response for an old variant can't overwrite a newer one.
  const refreshUserRating = async (): Promise<void> => {
    const token = ++ratingToken;
    const next = await fetchUserPuzzleRating(variantFilter);
    if (token !== ratingToken) return;
    userRating = next;
    renderControls();
  };

  // A rated attempt just resolved: show the delta and re-sync the authoritative
  // rating + counts from the server.
  setOnAttemptRating(async (rating) => {
    ratingDelta = rating.ratingChanged ? rating.delta : null;
    const token = ++ratingToken;
    const next = await fetchUserPuzzleRating(variantFilter);
    if (token !== ratingToken) return;
    userRating = next;
    renderControls();
  });

  const renderControls = (): void => {
    renderQueuePanel(controls, {
      queue: queueSummaries(),
      selectedId,
      solvedIds,
      variantFilter,
      variantFilters: PUZZLE_VARIANT_FILTERS,
      autoNext,
      ratedEnabled,
      userRating,
      ratingDelta,
      onVariantChange: async (nextFilter) => {
        variantFilter = nextFilter;
        ratingDelta = null;
        const queue = queueSummaries();
        const nextId =
          selectedId && queue.some((puzzle) => puzzle.id === selectedId)
            ? selectedId
            : (queue[0]?.id ?? null);
        renderControls();
        void refreshUserRating();
        if (nextId) {
          await selectPuzzle(nextId, true);
        } else {
          selectedId = null;
          session = null;
          renderStatus(detail, t('puzzle.none'));
        }
      },
      onAutoNextChange: (enabled) => {
        autoNext = enabled;
        saveAutoNextEnabled(enabled);
        renderControls();
      },
      onRatedChange: (enabled) => {
        ratedEnabled = enabled;
        setPuzzleRatedPref(enabled);
        saveRatedEnabled(enabled);
        renderControls();
      },
    });
  };

  const clearAutoNextTimer = (): void => {
    if (autoNextTimer === null) return;
    window.clearTimeout(autoNextTimer);
    autoNextTimer = null;
  };

  const scheduleAutoNext = (navigation: PuzzleNavigation): void => {
    if (!autoNext || !navigation.hasNext) return;
    clearAutoNextTimer();
    autoNextTimer = window.setTimeout(() => {
      autoNextTimer = null;
      navigation.goNext();
    }, AUTO_NEXT_DELAY_MS);
  };

  const renderSession = (): void => {
    if (!session) return;
    const navigation = navigationFor(queueSummaries(), selectedId, selectPuzzle);
    renderPuzzleDetail(detail, session, renderSession, navigation, (id) => {
      solvedIds.add(id);
      saveSolvedPuzzleIds(solvedIds);
      markPuzzleSeen(id);
      renderControls();
      scheduleAutoNext(navigation);
    });
    renderControls();
  };

  const selectPuzzle = async (id: string, pushUrl: boolean): Promise<void> => {
    clearAutoNextTimer();
    ratingDelta = null;
    // A deep link (or popstate) may carry a short code (Puzzle #bMpKA) instead
    // of the full id. Normalize to the full id up front so selection, queue
    // matching, the pushed URL, and solved-state keys all use the canonical id.
    id = resolveToFullPuzzleId(id, summaries);
    const summary = summaries.find((puzzle) => puzzle.id === id);
    if (summary && !queueSummaries().some((puzzle) => puzzle.id === id)) {
      variantFilter = summary.variant;
    }
    selectedId = id;
    renderControls();
    renderStatus(detail, t('puzzle.loading'));
    const token = ++loadToken;
    const puzzle = await fetchPuzzleDetail(id);
    if (token !== loadToken) return;
    if (!puzzle) {
      session = null;
      renderStatus(detail, t('puzzle.notFound'));
      return;
    }
    const nextPath = `/puzzles/${encodeURIComponent(id)}`;
    if (pushUrl && window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
    // Tear down the outgoing puzzle's engine (worker + arrows) before swapping
    // in the next session, so a stale ceval handle does not outlive its board.
    if (session && !isPuzzleComplete(session)) {
      void sendPuzzleQualityEvent(session.puzzle.id, session.qualitySessionId, 'abandon').catch(
        () => {},
      );
      trackPuzzleAttempted(session, 'abandoned');
    }
    session?.analysis?.dispose();
    session = createPuzzleSession(puzzle);
    void sendPuzzleQualityEvent(puzzle.id, session.qualitySessionId, 'view').catch(() => {});
    markPuzzleSeen(id);
    renderSession();
    renderControls();
  };

  // Arrow-key replay scrubbing (lichess-style): up/down jump to the first/last
  // move, left/right step one ply. Attached to window so it works without
  // focusing the board; self-removes once this page is navigated away (the shell
  // detaches from the document).
  const onPuzzleKeyDown = (event: KeyboardEvent): void => {
    if (!shell.isConnected) {
      window.removeEventListener('keydown', onPuzzleKeyDown);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const action: PuzzleScrub | null =
      event.key === 'ArrowUp'
        ? 'first'
        : event.key === 'ArrowDown'
          ? 'last'
          : event.key === 'ArrowLeft'
            ? 'previous'
            : event.key === 'ArrowRight'
              ? 'next'
              : null;
    if (!action || !session) return;
    event.preventDefault();
    scrubPuzzle(session, renderSession, action);
  };
  window.addEventListener('keydown', onPuzzleKeyDown);

  renderStatus(controls, t('puzzle.loading'));
  renderStatus(detail, t('puzzle.loading'));
  const puzzleList = await fetchPuzzleListWithAttempts();
  summaries = puzzleList.puzzles;
  // Merge the server's record of finished puzzles into the local seen-set
  // before rotating. Timestamp 0 sorts them behind anything seen in this
  // browser, so a cross-device visitor sees unseen material first and their
  // most recent local history stays ordered underneath it.
  for (const id of puzzleList.attemptedIds) {
    if (!seenPuzzles.has(id)) seenPuzzles.set(id, 0);
  }
  const targetRatings = new Map<string, number>();
  await Promise.all(
    [...new Set(summaries.map((puzzle) => puzzle.variant))].map(async (variant) => {
      const rating = await fetchUserPuzzleRating(variant);
      targetRatings.set(variant, rating?.rating ?? 1500);
    }),
  );
  // Rotate the queue so both the leading puzzle and the sequence vary between
  // visits instead of being identical every time. Computed once per visit so
  // navigation stays stable while solving; filtering by variant preserves it.
  summaries = rotatePuzzleOrder(summaries, seenPuzzles, targetRatings);
  // The deep-link path may be a short code; resolve it to the full id before it
  // drives variant selection and queue matching below.
  if (selectedId) selectedId = resolveToFullPuzzleId(selectedId, summaries);
  const directSummary = selectedId ? summaries.find((puzzle) => puzzle.id === selectedId) : null;
  // A normal visit defaults to the surfaced variant (Fortress); a direct deep
  // link into any puzzle still resolves so shared/bookmarked URLs keep working.
  if (directSummary) variantFilter = directSummary.variant;
  else if (!summaries.some((puzzle) => puzzle.variant === variantFilter) && summaries[0]) {
    variantFilter = summaries[0].variant;
  }
  renderControls();
  void refreshUserRating();

  const queue = queueSummaries();
  const firstId =
    selectedId && queue.some((puzzle) => puzzle.id === selectedId)
      ? selectedId
      : (queue[0]?.id ?? null);
  if (firstId) {
    await selectPuzzle(firstId, false);
  } else {
    renderStatus(detail, t('puzzle.none'));
  }

  window.addEventListener('popstate', () => {
    const id = puzzleIdFromPath(window.location.pathname) ?? queueSummaries()[0]?.id ?? null;
    if (id) void selectPuzzle(id, false);
  });

  window.addEventListener('pagehide', () => {
    if (!session || isPuzzleComplete(session)) return;
    void sendPuzzleQualityEvent(session.puzzle.id, session.qualitySessionId, 'abandon').catch(
      () => {},
    );
    trackPuzzleAttempted(session, 'abandoned');
  });

  // The variant boards render pieces as inline SVG, so a live piece-set or
  // board-theme change (from the appearance menu) must re-render to pick up the
  // new set — matching every other xiangqi surface (replay, postgame, live).
  window.addEventListener(xiangqiAppearanceChangedEvent, () => {
    if (session) renderSession();
    else renderControls();
  });
}

function createPuzzleSession(puzzle: PuzzleDetail): PuzzleSession {
  return {
    qualitySessionId: globalThis.crypto.randomUUID(),
    puzzle,
    state: clonePuzzleState(puzzle.initial),
    playedMoves: [],
    solverMoves: [],
    viewPly: 0,
    selectedSquare: null,
    selectedDrop: null,
    draggingFrom: null,
    feedback: { kind: 'neutral', text: t('puzzle.findBestMove') },
    submitting: false,
    solved: false,
    failed: false,
    revealed: false,
    focusNext: false,
    vote: null,
  };
}

function renderPuzzleDetail(
  host: HTMLElement,
  session: PuzzleSession,
  renderSession: () => void,
  navigation: PuzzleNavigation,
  onSolved: (id: string) => void,
): void {
  host.replaceChildren();

  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  const displayState = puzzleReplayState(session);

  const boardPanel = document.createElement('div');
  boardPanel.className = 'puzzle-board-panel';
  const board = document.createElement('div');
  board.className = 'puzzle-board';
  // Tag the board with the current puzzle so async reveal playback can detect a
  // navigation away (new puzzle = new id) and stop stepping a stale session.
  board.dataset.puzzleId = session.puzzle.id;
  const side = document.createElement('aside');
  side.className = 'puzzle-side-panel';

  // Paint the interactive board (+ reserves for drop variants) and wire drag,
  // all owned by the variant adapter.
  adapter.paintBoard(board, {
    session,
    displayState,
    renderSession,
    submitMove: (move) => submitMove(session, move, renderSession, onSolved),
  });

  // Board zoom, same grip and same persisted --uni-board-scale as the room,
  // review and analysis boards. Attached per render because renderSession
  // repaints this whole panel; the grip's own drag teardown already covers being
  // replaced mid-drag. The grip measures the painted board rather than the
  // column, which is wider than the board on a large screen.
  attachBoardResizeGrip(board, () => paintedPuzzleBoard(board));
  fitPuzzleGrip(board);

  const trainer = document.createElement('div');
  trainer.className = 'puzzle-trainer-panel';
  trainer.append(
    moveListPanel(session),
    feedbackPanel(session, navigation, renderSession, {
      onHint: () => void requestHint(session, renderSession),
      onReveal: () => void revealSolution(session, renderSession),
      onVote: (vote) => {
        void sendPuzzleQualityEvent(
          session.puzzle.id,
          session.qualitySessionId,
          'vote',
          vote,
        ).catch(() => {});
      },
    }),
  );
  const actions = actionPanel(session, renderSession);
  side.append(trainer, actions);

  // Post-completion engine analysis (adapters with a client engine): once the
  // puzzle is over (solved or its solution revealed), surface the local-engine
  // panel + board arrows. Gated to non-spoiler states only — a bare wrong move
  // keeps solving open, so the engine stays hidden until the outcome is locked.
  // The controller persists on the session across renders.
  if (adapter.createAnalysis && isPuzzleComplete(session)) {
    if (!session.analysis) session.analysis = adapter.createAnalysis();
    // Engine bar fuses onto the top of the move list (analyse-table shape);
    // the jump-out link sits below the scrub controls, centered. The column
    // grows past its fixed two-row shape, so let it scroll instead of clipping.
    side.classList.add('puzzle-side-panel--analysis');
    trainer.classList.add('puzzle-trainer-panel--analysis');
    trainer.prepend(session.analysis.engineEl);
    side.append(session.analysis.openLinkEl);
    session.analysis.refresh(session, displayState, board);
  }

  boardPanel.append(board, side);
  host.append(boardPanel);

  // Right after a solve, hand focus to the next-puzzle button (one-shot) so
  // Enter or Space advances; on small screens this also scrolls the CTA into
  // view, where the side panel sits below the board.
  //
  // Not inside an embed. body.embed-body hides the document's overflow, so a
  // focus scroll there is a ONE-WAY door: it moved scrollTop to the bottom of
  // the frame, put the board's top edge at -294px, and left no way to scroll
  // back to it short of a reload. The embed sizes itself to its frame, so
  // there is nothing off screen to scroll to in the first place.
  if (session.focusNext) {
    session.focusNext = false;
    const embedded = document.documentElement.dataset.embed !== undefined;
    host
      .querySelector<HTMLButtonElement>('[data-puzzle-next="true"]')
      ?.focus({ preventScroll: embedded });
  }
}

type PuzzleScrub = 'first' | 'previous' | 'next' | 'last';

// Move the replay cursor. Shared by the arrow buttons and the keyboard handler
// so both animate identically. No-op while a submission is in flight or when the
// cursor is already at the requested end.
function scrubPuzzle(session: PuzzleSession, renderSession: () => void, action: PuzzleScrub): void {
  if (session.submitting) return;
  const lastPly = session.playedMoves.length;
  switch (action) {
    case 'first':
      if (session.viewPly <= 0) return;
      session.viewPly = 0;
      renderSession();
      return;
    case 'previous': {
      if (session.viewPly <= 0) return;
      // Reverse-glide the move being undone (replay back-step).
      const undone = session.playedMoves[session.viewPly - 1];
      session.viewPly -= 1;
      renderSession();
      if (undone) animatePuzzleMove(session, undone, { reverse: true });
      return;
    }
    case 'next': {
      if (session.viewPly >= lastPly) return;
      // Glide the move being stepped into (replay forward step).
      const stepped = session.playedMoves[session.viewPly];
      session.viewPly += 1;
      renderSession();
      if (stepped) animatePuzzleMove(session, stepped);
      return;
    }
    case 'last':
      if (session.viewPly >= lastPly) return;
      session.viewPly = lastPly;
      renderSession();
      return;
  }
}

function actionPanel(session: PuzzleSession, renderSession: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'puzzle-actions';
  const atStart = session.viewPly <= 0 || session.submitting;
  const atEnd = session.viewPly >= session.playedMoves.length || session.submitting;

  const scrub = (action: PuzzleScrub) => () => scrubPuzzle(session, renderSession, action);
  const first = actionButton(
    'puzzleReplayFirst',
    ICON_FIRST,
    t('puzzle.firstMove'),
    atStart,
    scrub('first'),
  );
  const previous = actionButton(
    'puzzleReplayPrevious',
    ICON_PREV,
    t('puzzle.previousMove'),
    atStart,
    scrub('previous'),
  );
  const next = actionButton(
    'puzzleReplayNext',
    ICON_NEXT,
    t('puzzle.nextMove'),
    atEnd,
    scrub('next'),
  );
  const last = actionButton(
    'puzzleReplayLast',
    ICON_LAST,
    t('puzzle.lastMove'),
    atEnd,
    scrub('last'),
  );
  panel.append(first, previous, next, last);
  return panel;
}

function actionButton(
  dataKey: string,
  glyph: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'puzzle-button';
  button.dataset[dataKey] = 'true';
  if (glyph.startsWith('<')) button.innerHTML = glyph;
  else button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

// The three solving actions (submit, hint, reveal) all call a route that books
// a puzzle attempt, so all three can be refused by the per-account play lock.
// One shared landing so the board says why instead of sitting on its pending
// message; any other failure still propagates.
const PLAY_LOCKED = Symbol('play-locked');

function playLockRefusal(error: unknown): typeof PLAY_LOCKED {
  if (error instanceof PuzzlePlayDisabledError) return PLAY_LOCKED;
  throw error;
}

function showPlayLocked(session: PuzzleSession, renderSession: () => void): void {
  session.submitting = false;
  session.feedback = { kind: 'bad', text: t('puzzle.playDisabled') };
  renderSession();
}

// Which host mounted the solver: the /puzzles page or a third-party embed
// frame. The two never share a document, so a module flag is enough.
let puzzleAnalyticsMode: PuzzleAttemptMode = 'session';

function trackPuzzleAttempted(session: PuzzleSession, outcome: PuzzleAttemptOutcome): void {
  track(
    'puzzle_attempted',
    puzzleAttemptedProps({
      puzzleId: session.puzzle.id,
      variant: session.puzzle.variant,
      themes: (session.puzzle as { themes?: readonly string[] }).themes,
      rated: getPuzzleRatedPref(),
      mode: puzzleAnalyticsMode,
      outcome,
      clean: outcome === 'solved' && !session.failed,
    }),
  );
}

async function submitMove(
  session: PuzzleSession,
  move: PuzzleMove,
  renderSession: () => void,
  onSolved?: (id: string) => void,
): Promise<void> {
  // Once the answer has been shown (or the puzzle is solved), the board is a
  // locked replay: no further moves are submitted.
  if (session.revealed || session.solved) return;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.checkingMove') };
  renderSession();
  const beforeCount = puzzlePieceCount(session.state);
  const playedCountBefore = session.playedMoves.length;
  const nextSolverMoves = [...session.solverMoves, move];
  const submitted = await submitPuzzleAttempt(
    session.puzzle.id,
    nextSolverMoves,
    session.qualitySessionId,
  ).catch(playLockRefusal);
  if (submitted === PLAY_LOCKED) return showPlayLocked(session, renderSession);
  const { attempt, rating } = submitted;
  session.submitting = false;
  session.selectedSquare = null;
  session.selectedDrop = null;
  if (attempt.ok) {
    session.solverMoves = attempt.solverMoves;
    session.playedMoves = attempt.playedMoves;
    session.state = attempt.state;
    session.viewPly = session.playedMoves.length;
    if (attempt.complete) {
      session.solved = true;
      session.focusNext = true;
      trackPuzzleAttempted(session, 'solved');
      onSolved?.(session.puzzle.id);
    }
    // A solve by a mate we did not store says so. Silently reading it as the
    // stored solution would hide the one thing the solver would want to know.
    const alternativeMate = 'alternativeMate' in attempt && attempt.alternativeMate === true;
    session.feedback = attempt.complete
      ? {
          kind: 'good',
          text: alternativeMate ? t('puzzle.solvedAlternativeMate') : t('puzzle.solved'),
        }
      : { kind: 'good', text: t('puzzle.correct') };
    // A solve gets its own warm confirmation cue. A correct-but-incomplete move
    // sounds like the move it was (capture if the line reduced piece count,
    // otherwise a step).
    playSound(
      attempt.complete
        ? 'puzzle-solved'
        : puzzlePieceCount(session.state) < beforeCount
          ? 'capture'
          : 'move',
    );
  } else {
    session.state = attempt.state;
    session.viewPly = session.playedMoves.length;
    // Persist the failed state so the escape hatches (hint / view solution /
    // next) survive the piece-select feedback reset on the next render.
    session.failed = true;
    session.feedback = { kind: 'bad', text: t('puzzle.tryAnotherMove') };
    // A wrong try is NOT a lost game: 'lose' is the full defeat sting (a second
    // of falling pitch on the file sets), which is both too heavy for a miss and
    // punishing when you probe several moves in a row. 'learn-failure' is the
    // short "not quite" the lesson surface already uses, and no sound set files
    // it, so it stays the same brief cue everywhere.
    playSound('learn-failure');
  }
  if (rating) reportAttemptRating(rating);
  renderSession();
  // A correct move lands the solver's move AND the engine reply in the same
  // render; glide ONLY the reply (the user just chose their own move, so it
  // reads fine landing instantly — the reply is what teleported before).
  if (attempt.ok && attempt.playedMoves.length - playedCountBefore >= 2) {
    const reply = attempt.playedMoves.at(-1);
    if (reply) animatePuzzleMove(session, reply);
  }
}

// Highlight the correct piece to move for the current ply (lichess "get a hint").
// The move is computed server-side (the client never holds the solution); the
// hint books a failed rated attempt on the first terminal action (idempotent
// server-side, so it never double-counts a prior wrong-move fail). The user may
// then play the highlighted piece, take the full solution, or move on.
async function requestHint(session: PuzzleSession, renderSession: () => void): Promise<void> {
  if (session.submitting || session.revealed || session.solved) return;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.fetchingHint') };
  renderSession();
  const hinted = await fetchPuzzleHint(
    session.puzzle.id,
    session.playedMoves.length,
    session.qualitySessionId,
  ).catch(playLockRefusal);
  if (hinted === PLAY_LOCKED) return showPlayLocked(session, renderSession);
  const { move, rating } = hinted;
  session.submitting = false;
  if (!move) {
    session.feedback = { kind: 'neutral', text: t('puzzle.noHint') };
    renderSession();
    return;
  }
  session.failed = true;
  // Drop the replay cursor back to the live position so the highlight paints.
  session.viewPly = session.playedMoves.length;
  if ('drop' in move) {
    session.selectedDrop = move.drop;
    session.selectedSquare = null;
  } else {
    session.selectedSquare = move.from;
    session.selectedDrop = null;
  }
  session.feedback = { kind: 'neutral', text: t('puzzle.hintMoveHighlighted') };
  if (rating) reportAttemptRating(rating);
  renderSession();
}

// Fetch the full solution line, play it out, and lock solving (lichess "view
// solution"). Spoiler-gated: nothing is fetched until this runs. Books a failed
// rated attempt on the first terminal action (idempotent server-side).
async function revealSolution(session: PuzzleSession, renderSession: () => void): Promise<void> {
  if (session.submitting || session.revealed) return;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.loadingSolution') };
  renderSession();
  const revealed = await fetchPuzzleSolution(session.puzzle.id, session.qualitySessionId).catch(
    playLockRefusal,
  );
  if (revealed === PLAY_LOCKED) return showPlayLocked(session, renderSession);
  const { solution, rating } = revealed;
  session.submitting = false;
  if (!solution || solution.length === 0) {
    session.feedback = { kind: 'neutral', text: t('puzzle.noSolution') };
    renderSession();
    return;
  }
  session.failed = true;
  session.revealed = true;
  trackPuzzleAttempted(session, 'revealed');
  session.selectedSquare = null;
  session.selectedDrop = null;
  // Play the answer out from wherever the user got to. Their correct moves are a
  // prefix of the solution, so replaying from that ply matches the board.
  const startPly = Math.min(session.playedMoves.length, solution.length);
  session.playedMoves = solution;
  session.solverMoves = solution.filter((_, index) => index % 2 === 0);
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  let state = clonePuzzleState(session.puzzle.initial);
  for (const move of solution) {
    state = adapter.applyMove(state, move);
  }
  session.state = state;
  session.viewPly = startPly;
  session.feedback = { kind: 'neutral', text: t('puzzle.solution') };
  if (rating) reportAttemptRating(rating);
  renderSession();
  playbackSolution(session, renderSession);
}

// Step the replay cursor forward one ply at a time, reusing the scrub-forward
// animation, until the whole solution has been shown. Stops early if the user
// navigated to another puzzle (the board's puzzle id no longer matches).
function playbackSolution(session: PuzzleSession, renderSession: () => void): void {
  const puzzleId = session.puzzle.id;
  const step = (): void => {
    const board = document.querySelector<HTMLElement>('.puzzle-board');
    if (!board || board.dataset.puzzleId !== puzzleId) return;
    if (session.viewPly >= session.playedMoves.length) return;
    scrubPuzzle(session, renderSession, 'next');
    window.setTimeout(step, REVEAL_STEP_MS);
  };
  window.setTimeout(step, REVEAL_STEP_MS);
}

// The painted board inside a .puzzle-board column, across every variant adapter:
// the drop/fortress shells wrap board plus reserves, the rest paint a board
// element straight in. Falls back to the column so the grip still has something
// to measure if an adapter paints something new.
function paintedPuzzleBoard(column: HTMLElement): HTMLElement {
  return (
    column.querySelector<HTMLElement>(
      '.puzzle-board-shell, .puzzle-xiangqi-board, .mini-xq-board, .jungle-live-svg',
    ) ?? column
  );
}

// Park the resize grip on the painted board's corner rather than the column's.
// The column track carries the height budget, so on a wide screen it is wider
// than the board and the grip would otherwise float in the gutter beside it.
function fitPuzzleGrip(column: HTMLElement): void {
  requestAnimationFrame(() => {
    if (!column.isConnected) return;
    const painted = paintedPuzzleBoard(column);
    const gutter = column.getBoundingClientRect().width - painted.getBoundingClientRect().width;
    column.style.setProperty('--puzzle-board-inset', `${Math.max(0, Math.round(gutter / 2))}px`);
  });
}

// Both widths move with the viewport AND with the zoom scale (applyBoardScale
// dispatches a resize), so the inset is re-measured on resize. One listener for
// the page, not one per render: renderSession repaints the board on every move,
// and a per-render listener would pile up over a session.
function installPuzzleGripFit(): void {
  window.addEventListener('resize', () => {
    const column = document.querySelector<HTMLElement>('.puzzle-board');
    if (column) fitPuzzleGrip(column);
  });
}

// Glide a board move on the mounted puzzle board. One puzzle page mounts at a
// time (module invariant, see the rating singletons in puzzles/api.ts), so the
// .puzzle-board query is unambiguous. Called AFTER renderSession painted the
// final position. Drop moves have no origin square and stay discrete. Moves
// come from the server attempt payload or the local playedMoves history,
// never from diffing board states.
function animatePuzzleMove(
  session: PuzzleSession,
  move: PuzzleMove,
  opts: { reverse?: boolean } = {},
): void {
  if (!('from' in move) || typeof move.from !== 'string') return;
  const board = document.querySelector<HTMLElement>('.puzzle-board');
  if (!board) return;
  puzzleBoardAdapter(session.puzzle.variant).animateMove(board, session, move, opts);
}

// Occupied-square count across any puzzle variant's board (all PuzzleState shapes
// carry a `board` square→piece map). Used only to pick a capture vs move sound.
function puzzlePieceCount(state: PuzzleState): number {
  return Object.keys(state.board).length;
}

function renderStatus(host: HTMLElement, message: string): void {
  const status = document.createElement('p');
  status.className = 'puzzles-status';
  status.textContent = message;
  host.replaceChildren(status);
}

function filterPuzzlesByVariant(
  puzzles: readonly PuzzleSummary[],
  variant: PuzzleVariantFilter,
): PuzzleSummary[] {
  return puzzles.filter((puzzle) => puzzle.variant === variant);
}

function navigationFor(
  puzzles: readonly PuzzleSummary[],
  selectedId: string | null,
  selectPuzzle: (id: string, pushUrl: boolean) => Promise<void>,
): PuzzleNavigation {
  const index = Math.max(
    0,
    puzzles.findIndex((puzzle) => puzzle.id === selectedId),
  );
  const total = puzzles.length;
  const hasPrevious = total > 0 && index > 0;
  // The queue is frozen for the visit (rotation happens once on mount), so
  // "next" wraps at the end instead of dead-ending the trainer on the last
  // puzzle with a disabled button.
  const hasNext = total > 1;
  return {
    index,
    total,
    hasPrevious,
    hasNext,
    goPrevious: () => {
      if (!hasPrevious) return;
      void selectPuzzle(puzzles[index - 1]!.id, true);
    },
    goNext: () => {
      if (!hasNext) return;
      void selectPuzzle(puzzles[(index + 1) % total]!.id, true);
    },
  };
}

// The replay-aware state to display: the live state when the cursor sits at the
// tip, else the initial state with the first viewPly moves re-applied.
function puzzleReplayState(session: PuzzleSession): PuzzleState {
  if (session.viewPly >= session.playedMoves.length) return session.state;
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  let state: PuzzleState = clonePuzzleState(session.puzzle.initial);
  const visibleMoves = session.playedMoves.slice(0, Math.max(0, session.viewPly));
  for (const move of visibleMoves) {
    state = adapter.applyMove(state, move);
  }
  return state;
}

function puzzleIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/puzzles\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

// The URL slug is normally the full puzzle id, but the info-card code link and
// hand-typed short URLs may carry a lichess-style short code. Resolve a code
// against the loaded summaries; pass through anything that already is a full id
// (or does not resolve, so selectPuzzle can surface "Puzzle not found").
function resolveToFullPuzzleId(idOrCode: string, summaries: readonly PuzzleSummary[]): string {
  if (summaries.some((puzzle) => puzzle.id === idOrCode)) return idOrCode;
  return (
    resolvePuzzleShortCode(
      idOrCode,
      summaries.map((puzzle) => puzzle.id),
    ) ?? idOrCode
  );
}

// Build-time prerender of the puzzles landing frame: nav, heading, and the
// static explainer. /puzzles is in the sitemap but served the bare shell, so a
// crawler saw a <title> and 27 characters of body. The trainer itself needs the
// API, so what bakes here is the explanation a first-time visitor reads; the
// client mount replaces all of it on takeover (mountPuzzles calls
// root.replaceChildren), so there is no hydration contract to keep.
//
// Default locale only, matching /player and /learn/xiangqi: prefixed paths stay
// on the client-rendered shell, so this copy is deliberately not in the catalog.
export function renderPuzzlesShellForPrerender(): string {
  const shell = document.createElement('main');
  shell.className = 'site-section puzzles-shell';

  // Not .puzzles-header: that one is clipped to 1px for screen readers because
  // the live trainer shows the board instead. The baked page is what a no-JS
  // visitor actually reads, so its heading is visible.
  const header = document.createElement('div');
  header.className = 'puzzles-intro-header';
  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = t('puzzle.heading');
  header.append(title);

  const intro = document.createElement('section');
  intro.className = 'puzzles-intro';
  const lead = document.createElement('p');
  lead.className = 'puzzles-intro-lead';
  lead.textContent =
    'Xiangqi tactics training on positions taken from real games. Every puzzle has one winning line. Find it move by move, and the trainer plays the defence against you.';
  intro.append(lead);

  const sections = [
    {
      heading: 'How it works',
      items: [
        'Each position comes from a game that was actually played, then gets checked by an engine so the solution is forced rather than merely strong.',
        'You play the attacking side. The defence answers with its toughest reply, so a line only completes if every move you pick is the right one.',
        'Puzzles are rated and so are you. Only your first attempt on a puzzle moves either rating, and asking for a hint counts as a miss.',
      ],
    },
    {
      heading: 'What you will practise',
      items: [
        'Forced mates in two, three and four moves, where the general has no escape.',
        'Winning-advantage puzzles, where the reward is decisive material rather than mate.',
        'Middlegame and endgame positions across the full range of difficulty.',
      ],
    },
  ];
  for (const section of sections) {
    const heading = document.createElement('h2');
    heading.textContent = section.heading;
    const list = document.createElement('ul');
    for (const item of section.items) {
      const entry = document.createElement('li');
      entry.textContent = item;
      list.append(entry);
    }
    intro.append(heading, list);
  }

  const link = (href: string, text: string): HTMLAnchorElement => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    return anchor;
  };
  const footer = document.createElement('p');
  footer.className = 'puzzles-intro-footer';
  footer.append(
    document.createTextNode('New to the game? Read the '),
    link('/rules/xiangqi', 'rules of xiangqi'),
    document.createTextNode(' or work through the '),
    link('/learn/xiangqi', 'beginner course'),
    document.createTextNode('. To study a position of your own, open the '),
    link('/analysis', 'analysis board'),
    document.createTextNode('.'),
  );
  intro.append(footer);

  shell.append(header, intro);
  return `${buildNav().outerHTML}${shell.outerHTML}`;
}

const ICON_FIRST =
  '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M4 3.5h1.7v9H4zM13 3.5v9L6.5 8z" fill="currentColor"/></svg>';
const ICON_LAST =
  '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M10.3 3.5H12v9h-1.7zM3 3.5v9L9.5 8z" fill="currentColor"/></svg>';
const ICON_PREV =
  '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M11 3.5v9L5 8z" fill="currentColor"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M5 3.5v9L11 8z" fill="currentColor"/></svg>';

/**
 * One puzzle as a standalone solver: the board and the trainer panel (feedback,
 * hint, reveal, replay arrows) and nothing else. No queue, no nav, no auto-next.
 * It is what /embed/puzzle mounts inside someone else's page, and it is the
 * same code path the trainer uses, so a fix to solving lands in both.
 *
 * Attempts are always UNRATED here: a frame on a third party's site must never
 * move the viewer's rating, and the embed never asks who the viewer is.
 */
export function mountPuzzleSolver(
  host: HTMLElement,
  puzzle: PuzzleDetail,
  opts: { onSolved?: (id: string) => void } = {},
): { dispose(): void } {
  for (const adapter of allPuzzleBoardAdapters()) adapter.installStyles?.();
  setBoardFamily('xiangqi');
  setPuzzleRatedPref(false);
  puzzleAnalyticsMode = 'embed';
  restoreBoardScale();
  installPuzzleGripFit();
  const session = createPuzzleSession(puzzle);
  // An empty queue: the feedback panel then offers no previous/next.
  const navigation = navigationFor([], null, async () => {});
  const renderSession = (): void => {
    renderPuzzleDetail(host, session, renderSession, navigation, (id) => opts.onSolved?.(id));
  };
  renderSession();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!host.isConnected) {
      window.removeEventListener('keydown', onKeyDown);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const action: PuzzleScrub | null =
      event.key === 'ArrowUp'
        ? 'first'
        : event.key === 'ArrowDown'
          ? 'last'
          : event.key === 'ArrowLeft'
            ? 'previous'
            : event.key === 'ArrowRight'
              ? 'next'
              : null;
    if (!action) return;
    event.preventDefault();
    scrubPuzzle(session, renderSession, action);
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    dispose: () => {
      session.analysis?.dispose();
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
