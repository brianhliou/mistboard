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

import { PUZZLE_NEW_PLAYER_RATING, resolvePuzzleShortCode, XIANGQI_SPEC_ID } from '@mistboard/game';
import './puzzles.css';
import {
  type PuzzleAttemptMode,
  type PuzzleAttemptOutcome,
  puzzleAttemptedProps,
  track,
} from './analytics.js';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { pieceAnimationDurationMs } from './board-anim.js';
import { attachBoardResizeGrip, restoreBoardScale } from './board-resize.js';
import { t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import {
  createLiveFinishBadges,
  finishBadgesForResult,
  generalSquareOn,
  type LiveFinishBadges,
} from './live-finish-badges.js';
import { initLiveSound, playSound } from './live-sound.js';
import { createMoveNavBar, type MoveNavBar } from './move-nav-bar.js';
import {
  clonePuzzleState,
  firstPuzzleViewPly,
  isPuzzleComplete,
  isReplayLive,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleMoveMark,
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
  type PuzzleAttempt,
  PuzzlePlayDisabledError,
  reportAttemptRating,
  sendPuzzleQualityEvent,
  setOnAttemptRating,
  setPuzzleRatedPref,
  submitPuzzleAttempt,
  type UserPuzzleRating,
} from './puzzles/api.js';
import { feedbackPanel, puzzlePlayPosition } from './puzzles/detail-panels.js';
import { explorationState, exploreMove } from './puzzles/exploration.js';
import { keepActivePuzzleMoveInView, moveListPanel } from './puzzles/move-list.js';
import { puzzlePhoneMenuHead, puzzlePhoneMenuRows } from './puzzles/phone-menu.js';
import { type QueuePanelProps, renderQueuePanel } from './puzzles/queue-panel.js';
import {
  allPuzzleBoardAdapters,
  type PuzzleVariant,
  puzzleBoardAdapter,
} from './puzzles/registry.js';
import { type PuzzleChipResult, puzzleResultChips } from './puzzles/result-chips.js';
import {
  loadAutoNextEnabled,
  loadPuzzleDifficulty,
  loadRatedEnabled,
  loadSeenPuzzles,
  loadSolvedPuzzleIds,
  puzzleDifficultyAvailability,
  rotatePuzzleOrder,
  saveAutoNextEnabled,
  savePuzzleDifficulty,
  saveRatedEnabled,
  saveSeenPuzzles,
  saveSolvedPuzzleIds,
} from './puzzles/storage.js';
import {
  loadPuzzleTheme,
  type PuzzleThemeOptions,
  parsePuzzleTheme,
  puzzleSummaryTags,
  puzzleThemesLink,
  renderPuzzleThemesIndex,
  savePuzzleTheme,
} from './puzzles/themes.js';
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
// How long the pre-setup position holds before the opponent's setup move
// glides in (#664): long enough for the eye to land on the board.
const SETUP_INTRO_PAUSE_MS = 400;
// After a correct move the board holds on it under its ✓ before the scripted
// reply glides in (lichess), so the verdict reads before the position changes.
const REPLY_PAUSE_MS = 500;
// How long a wrong try stays on the board under its ✗ before it glides back.
const WRONG_HOLD_MS = 700;
// The finish-badge layer's default delay before the mate slash starts drawing.
const MATE_SLASH_DELAY_MS = 250;

// Variants surfaced in the Settings variant picker (order = display order; the
// first is the default view). Standard Xiangqi (the mined real-game corpus,
// the bet variant) is the only surfaced trainer. Jungle stays in the corpus +
// API for direct links, but is hidden from discovery for now.
// Add a spec id here to unhide it.
const PUZZLE_VARIANT_FILTERS: readonly PuzzleVariantFilter[] = [XIANGQI_SPEC_ID];

export async function mountPuzzles(
  root: HTMLElement,
  initialPuzzleId: string | null = null,
): Promise<void> {
  // The existing /puzzles/:id router passes this reserved index slug through.
  if (initialPuzzleId === 'themes') {
    root.replaceChildren(buildNav());
    const list = await fetchPuzzleListWithAttempts();
    root.append(renderPuzzleThemesIndex({ motifs: list.themes, tagCounts: list.tagCounts }));
    return;
  }
  for (const adapter of allPuzzleBoardAdapters()) adapter.installStyles?.();
  initLiveSound();
  setBoardFamily('xiangqi');
  root.classList.add('puzzles-page');
  // Before the first board paints: the scale is shared across every board
  // surface, so a size chosen on the analysis board is already the size this
  // page should open at.
  restoreBoardScale();
  installPuzzleGripFit();

  const { shell, detail, controls } = buildPuzzlesFrame();
  root.replaceChildren(buildNav(), shell);

  if (window.location.pathname.replace(/\/$/, '') === '/puzzles/replay') {
    await mountFailedPuzzleReplay({ shell, detail, controls });
    return;
  }

  if (new URLSearchParams(window.location.search).get('mode') === 'storm') {
    const { mountPuzzleStorm } = await import('./puzzles/storm.js');
    await mountPuzzleStorm({ shell, detail, controls }, (puzzle, opts) =>
      mountPuzzleSolver(detail, puzzle, opts),
    );
    return;
  }

  if (new URLSearchParams(window.location.search).get('mode') === 'streak') {
    const { mountPuzzleStreak } = await import('./puzzles/streak.js');
    await mountPuzzleStreak({ shell, detail, controls }, (puzzle, opts) =>
      mountPuzzleSolver(detail, puzzle, { ...opts, mode: 'streak', analysis: false }),
    );
    return;
  }

  let summaries: PuzzleSummary[] = [];
  let selectedId = initialPuzzleId;
  let variantFilter: PuzzleVariantFilter = PUZZLE_VARIANT_FILTERS[0] ?? XIANGQI_SPEC_ID;
  const themeParam = new URLSearchParams(window.location.search);
  let playerFilter = themeParam.get('player') || null;
  let loadedPlayer: string | null | undefined = playerFilter;
  let queueToken = 0;
  let themeFilter = themeParam.has('theme')
    ? parsePuzzleTheme(themeParam.get('theme'))
    : initialPuzzleId
      ? null
      : playerFilter
        ? null
        : loadPuzzleTheme();
  let themes: PuzzleThemeOptions = { motifs: [], tagCounts: {} };
  if (themeParam.has('theme')) savePuzzleTheme(themeFilter);
  let session: PuzzleSession | null = null;
  // This visit's puzzles, in the order they were finished, for the chip row
  // under the board. The first outcome sticks: a puzzle reopened from its chip
  // and solved clean the second time was still missed the first.
  const sessionResults: PuzzleChipResult[] = [];
  const recordResult = (played: PuzzleSession, leaving: boolean): void => {
    if (sessionResults.some((result) => result.id === played.puzzle.id)) return;
    const complete = isPuzzleComplete(played);
    if (!complete && !(leaving && played.failed)) return;
    sessionResults.push({
      id: played.puzzle.id,
      outcome: played.failed || played.revealed ? 'failed' : 'solved',
    });
  };
  const pickSessionPuzzle = (id: string): void => {
    if (id !== selectedId) void selectPuzzle(id, true);
  };
  const solvedIds = loadSolvedPuzzleIds();
  const seenPuzzles = loadSeenPuzzles();
  const targetRatings = new Map<string, number>();
  let difficulty = loadPuzzleDifficulty();
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

  // Like the variant picker, theme selection preserves this visit's frozen
  // adaptive order. No re-shuffle or request can move a solved session's next.
  const queueSummaries = (): PuzzleSummary[] =>
    filterPuzzlesByVariant(summaries, variantFilter).filter(
      (puzzle) => !themeFilter || puzzleSummaryTags(puzzle).includes(themeFilter),
    );

  const renderEmptyQueue = (): void => {
    const emptyPlayer = playerFilter && summaries.length === 0;
    renderStatus(
      detail,
      t(emptyPlayer ? 'puzzle.noneForPlayer' : themeFilter ? 'puzzle.noneForTheme' : 'puzzle.none'),
    );
    if (emptyPlayer) {
      const all = document.createElement('a');
      all.href = '/puzzles';
      all.className = 'puzzle-quiet-link';
      all.textContent = t('puzzle.allPuzzles');
      const links = document.createElement('span');
      links.className = 'puzzle-empty-links';
      links.append(all);
      detail.querySelector('.puzzles-status')?.append(links);
    } else if (themeFilter) {
      const all = document.createElement('a');
      all.href = `${puzzleUrl(undefined, null)}${playerFilter ? '&' : '?'}theme=`;
      all.textContent = t('puzzle.allThemes');
      const links = document.createElement('span');
      links.className = 'puzzle-empty-links';
      links.append(all, puzzleThemesLink());
      detail.querySelector('.puzzles-status')?.append(links);
    }
  };

  const puzzleUrl = (id?: string, theme = themeFilter): string => {
    const params = new URLSearchParams();
    if (playerFilter) params.set('player', playerFilter);
    if (theme) params.set('theme', theme);
    const query = params.toString();
    return `/puzzles${id ? `/${encodeURIComponent(id)}` : ''}${query ? `?${query}` : ''}`;
  };

  const pushPuzzleUrl = (id: string): void => {
    const nextPath = puzzleUrl(id);
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
  };

  const changeQueue = async (pushUrl = true): Promise<void> => {
    const queue = queueSummaries();
    const nextId =
      selectedId && queue.some((puzzle) => puzzle.id === selectedId)
        ? selectedId
        : (queue[0]?.id ?? null);
    if (nextId && nextId === selectedId && nextId === session?.puzzle.id) {
      // Filtering the queue does not start another attempt at the same puzzle.
      clearAutoNextTimer();
      if (pushUrl) pushPuzzleUrl(nextId);
      renderSession();
    } else if (nextId) await selectPuzzle(nextId, pushUrl);
    else {
      clearAutoNextTimer();
      ++loadToken;
      if (session && !isPuzzleComplete(session)) {
        void sendPuzzleQualityEvent(session.puzzle.id, session.qualitySessionId, 'abandon').catch(
          () => {},
        );
        trackPuzzleAttempted(session, 'abandoned');
      }
      session?.analysis?.dispose();
      forgetPaintedPuzzle();
      selectedId = null;
      session = null;
      if (pushUrl) window.history.pushState(null, '', puzzleUrl());
      renderControls();
      renderEmptyQueue();
    }
  };

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
    const props: QueuePanelProps = {
      queue: queueSummaries(),
      selectedId,
      solvedIds,
      variantFilter,
      variantFilters: PUZZLE_VARIANT_FILTERS,
      theme: {
        id: themeFilter,
        options: themes,
        onChange: async (id) => {
          themeFilter = id;
          savePuzzleTheme(id);
          await changeQueue();
        },
      },
      difficulty: {
        level: difficulty,
        ...puzzleDifficultyAvailability(
          queueSummaries(),
          seenPuzzles,
          targetRatings.get(variantFilter) ?? PUZZLE_NEW_PLAYER_RATING,
          difficulty,
        ),
        onChange: (level) => {
          difficulty = level;
          savePuzzleDifficulty(level);
          clearAutoNextTimer();
          if (userRating) targetRatings.set(variantFilter, userRating.rating);
          const current = summaries.find((puzzle) => puzzle.id === selectedId);
          const ordered = rotatePuzzleOrder(summaries, seenPuzzles, targetRatings, difficulty);
          // Keep the active attempt and its quality session intact; Next starts
          // the newly ordered queue, including after revisiting a result chip.
          summaries = current
            ? [current, ...ordered.filter((puzzle) => puzzle.id !== current.id)]
            : ordered;
          if (session) renderSession();
          else renderControls();
        },
      },
      selectedComplete: session !== null && isPuzzleComplete(session),
      autoNext,
      ratedEnabled,
      userRating,
      ratingDelta,
      selectedSource: session
        ? {
            id: session.puzzle.id,
            sourceGame: session.puzzle.sourceGame,
            credit: session.puzzle.credit,
          }
        : null,
      onVariantChange: async (nextFilter) => {
        variantFilter = nextFilter;
        ratingDelta = null;
        if (nextFilter !== XIANGQI_SPEC_ID) {
          themeFilter = null;
          savePuzzleTheme(null);
        }
        await changeQueue();
        void refreshUserRating();
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
    };
    renderQueuePanel(controls, props);
    // The phone ☰ sheet reads the same props; repaint it if it is open.
    phoneMenu.props = props;
    phoneMenu.refresh?.();
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
    recordResult(session, false);
    const chips = puzzleResultChips(sessionResults, session.puzzle.id, {
      label: t('puzzle.sessionHistory'),
      text: 'mark',
      className: 'puzzle-session-chips',
      onPick: pickSessionPuzzle,
    });
    detail.querySelector('.puzzle-board-panel')?.append(chips);
    // The row scrolls sideways once it is full; keep the puzzle in play in view.
    scrollChipIntoRow(chips);
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
    // A URL or history entry cannot escape the fetched player pool.
    if (playerFilter && !summary) {
      await changeQueue(false);
      window.history.replaceState(null, '', puzzleUrl(session?.puzzle.id));
      return;
    }
    if (summary && !queueSummaries().some((puzzle) => puzzle.id === id)) {
      variantFilter = summary.variant;
      themeFilter = null;
      savePuzzleTheme(null);
    }
    selectedId = id;
    renderControls();
    renderPendingBoard(detail, t('puzzle.loading'));
    const token = ++loadToken;
    const puzzle = await fetchPuzzleDetail(id);
    if (token !== loadToken) return;
    if (!puzzle) {
      session = null;
      renderStatus(detail, t('puzzle.notFound'));
      return;
    }
    if (pushUrl) pushPuzzleUrl(id);
    // Tear down the outgoing puzzle's engine (worker + arrows) before swapping
    // in the next session, so a stale ceval handle does not outlive its board.
    if (session) recordResult(session, true);
    if (session && !isPuzzleComplete(session)) {
      void sendPuzzleQualityEvent(session.puzzle.id, session.qualitySessionId, 'abandon').catch(
        () => {},
      );
      trackPuzzleAttempted(session, 'abandoned');
    }
    session?.analysis?.dispose();
    const opened = createPuzzleSession(puzzle, { history: true });
    session = opened;
    void sendPuzzleQualityEvent(puzzle.id, opened.qualitySessionId, 'view').catch(() => {});
    markPuzzleSeen(id);
    renderSession();
    renderControls();
    playSetupIntro(opened, renderSession, () => session === opened);
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
      (target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
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
  renderPendingBoard(detail, t('puzzle.loading'));
  const puzzleList = await fetchPuzzleListWithAttempts(playerFilter);
  summaries = puzzleList.puzzles;
  themes = { motifs: puzzleList.themes, tagCounts: puzzleList.tagCounts };
  // Merge the server's record of finished puzzles into the local seen-set
  // before rotating. Timestamp 0 sorts them behind anything seen in this
  // browser, so a cross-device visitor sees unseen material first and their
  // most recent local history stays ordered underneath it.
  for (const id of puzzleList.attemptedIds) {
    if (!seenPuzzles.has(id)) seenPuzzles.set(id, 0);
  }
  // Every Next pushes /puzzles/<id>, so a reload lands on the last puzzle
  // opened. When that puzzle is already finished, opening it again repeated
  // it: a visitor who solved a few, reloaded and played on got the solved one
  // back first. A reload past a finished puzzle starts at the head of the
  // fresh queue instead. A link opened from anywhere else is not a reload and
  // still opens the puzzle it names, finished or not.
  let reloadedPastFinished = false;
  if (selectedId && isFirstMountReload()) {
    const fullId = resolveToFullPuzzleId(selectedId, summaries);
    if (solvedIds.has(fullId) || puzzleList.attemptedIds.includes(fullId)) {
      selectedId = null;
      reloadedPastFinished = true;
    }
  }
  await Promise.all(
    [...new Set(summaries.map((puzzle) => puzzle.variant))].map(async (variant) => {
      const rating = await fetchUserPuzzleRating(variant);
      targetRatings.set(variant, rating?.rating ?? PUZZLE_NEW_PLAYER_RATING);
    }),
  );
  // Rotate the queue so both the leading puzzle and the sequence vary between
  // visits instead of being identical every time. Computed once per visit so
  // navigation stays stable while solving; filtering by variant preserves it.
  summaries = rotatePuzzleOrder(summaries, seenPuzzles, targetRatings, difficulty);
  // The deep-link path may be a short code; resolve it to the full id before it
  // drives variant selection and queue matching below.
  if (selectedId) selectedId = resolveToFullPuzzleId(selectedId, summaries);
  const directSummary = selectedId ? summaries.find((puzzle) => puzzle.id === selectedId) : null;
  const outOfScopeLink = playerFilter && selectedId && !directSummary;
  // A normal visit defaults to the surfaced variant (Xiangqi); a direct deep
  // link into any puzzle still resolves so shared/bookmarked URLs keep working.
  if (directSummary) variantFilter = directSummary.variant;
  else if (!summaries.some((puzzle) => puzzle.variant === variantFilter) && summaries[0]) {
    variantFilter = summaries[0].variant;
  }
  if (directSummary && themeFilter && !puzzleSummaryTags(directSummary).includes(themeFilter)) {
    themeFilter = null;
    savePuzzleTheme(null);
  }
  renderControls();
  void refreshUserRating();

  const queue = queueSummaries();
  const firstId =
    selectedId && queue.some((puzzle) => puzzle.id === selectedId)
      ? selectedId
      : (queue[0]?.id ?? null);
  if (firstId) {
    if (reloadedPastFinished || outOfScopeLink) {
      // Replace, not push: Back should not return to the finished puzzle.
      window.history.replaceState(null, '', puzzleUrl(firstId));
    }
    await selectPuzzle(firstId, false);
  } else {
    renderEmptyQueue();
  }

  window.addEventListener('popstate', async () => {
    if (!shell.isConnected) return;
    const token = ++queueToken;
    clearAutoNextTimer();
    ++loadToken;
    const params = new URLSearchParams(window.location.search);
    themeFilter = parsePuzzleTheme(params.get('theme'));
    if (params.has('theme')) savePuzzleTheme(themeFilter);
    const nextPlayer = params.get('player') || null;
    if (nextPlayer !== loadedPlayer) {
      playerFilter = nextPlayer;
      loadedPlayer = undefined;
      summaries = [];
      sessionResults.length = 0;
      if (session && !isPuzzleComplete(session)) {
        void sendPuzzleQualityEvent(session.puzzle.id, session.qualitySessionId, 'abandon').catch(
          () => {},
        );
        trackPuzzleAttempted(session, 'abandoned');
      }
      session?.analysis?.dispose();
      session = null;
      selectedId = null;
      renderControls();
      renderPendingBoard(detail, t('puzzle.loading'));
      try {
        const list = await fetchPuzzleListWithAttempts(playerFilter);
        if (token !== queueToken || !shell.isConnected) return;
        for (const id of list.attemptedIds) {
          if (!seenPuzzles.has(id)) seenPuzzles.set(id, 0);
        }
        summaries = rotatePuzzleOrder(list.puzzles, seenPuzzles, targetRatings, difficulty);
        themes = { motifs: list.themes, tagCounts: list.tagCounts };
        loadedPlayer = playerFilter;
      } catch {
        if (token === queueToken) renderStatus(detail, t('puzzle.loadFailed'));
        return;
      }
    }
    const id = puzzleIdFromPath(window.location.pathname) ?? queueSummaries()[0]?.id ?? null;
    if (id) await selectPuzzle(id, false);
    else await changeQueue(false);
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

// `history`: show the source game's moves before the puzzle in the move list
// (the trainer page and Puzzle Streak). Embeds leave it out: a small frame.
function createPuzzleSession(
  puzzle: PuzzleDetail,
  opts: { history?: boolean; fast?: boolean } = {},
): PuzzleSession {
  const adapter = puzzleBoardAdapter(puzzle.variant);
  // Only behind a setup move the server verified: the history ends one move
  // before it, and the board replays it from the variant's opening.
  const history =
    opts.history && puzzle.setupMove && puzzle.history?.length && adapter.historyStart?.(puzzle)
      ? puzzle.history
      : null;
  // Open one move earlier and glide the opponent's setup move in, lichess
  // style (#664), only when pieces animate at all and the adapter can rebuild
  // that position exactly; otherwise `initial` shows at once, as before.
  const setupIntro =
    !opts.fast && pieceAnimationDurationMs() > 0 ? (adapter.preSetupState?.(puzzle) ?? null) : null;
  return {
    setupIntro,
    ...(history ? { history } : {}),
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
  opts: PuzzleSolverOptions = {},
): void {
  const reopenMenu = phoneMenu.open;
  // Focus inside the open sheet survives the rebuild (a revealed solution
  // re-renders once per animated move): the same element when it is lent
  // again (the engine panel), else the row with the same key, else the sheet.
  const sheetFocus = reopenMenu ? phoneMenuFocus() : null;
  resetPhoneMenu();
  // Focus on the next-puzzle button survives the rebuild too: a solution played
  // out under Game over re-renders once per move and would drop it to <body>.
  if (
    document.activeElement?.closest('[data-puzzle-next="true"]') &&
    host.contains(document.activeElement)
  ) {
    session.focusNext = true;
  }
  host.replaceChildren();

  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  const displayState = puzzleReplayState(session);
  const canExplore =
    opts.analysis !== false &&
    !!adapter.createAnalysis &&
    isPuzzleComplete(session) &&
    !session.locked &&
    session.viewPly >= 0;

  const boardPanel = document.createElement('div');
  boardPanel.className = 'puzzle-board-panel';
  const board = document.createElement('div');
  board.className = 'puzzle-board';
  // Tag the board with the current puzzle so async reveal playback can detect a
  // navigation away (new puzzle = new id) and stop stepping a stale session.
  board.dataset.puzzleId = session.puzzle.id;
  // Whether a move made now would be taken: false while a pause holds the
  // board (the setup glide, the ✓ before a reply, a wrong try's ✗) or the
  // solver is scrubbed back.
  board.dataset.puzzleLive = String(isReplayLive(session) || canExplore);
  const side = document.createElement('aside');
  side.className = 'puzzle-side-panel';

  // Paint the interactive board (+ reserves for drop variants) and wire drag,
  // all owned by the variant adapter.
  adapter.paintBoard(board, {
    session,
    displayState,
    renderSession,
    submitMove: (move) => submitMove(session, move, renderSession, onSolved, opts),
    ...(canExplore
      ? {
          exploreMove: (move: PuzzleMove) => {
            if (exploreMove(session, move, displayState)) {
              renderSession();
              animatePuzzleMove(session, move);
            }
          },
        }
      : {}),
    moveMarks: puzzleMoveMarks(session),
  });
  renderedPuzzleSession = session;

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
    moveListPanel(
      session,
      (viewPly) => jumpPuzzle(session, renderSession, viewPly),
      canExplore
        ? {
            onTry: (ply, move) => {
              session.exploration = null;
              session.viewPly = ply;
              exploreMove(session, move, puzzleReplayState(session));
              renderSession();
            },
            onJump: (cursor) => {
              if (!session.exploration) return;
              session.exploration.cursor = cursor;
              session.selectedSquare = null;
              renderSession();
            },
            onReturn: () => {
              session.exploration = null;
              session.selectedSquare = null;
              renderSession();
            },
          }
        : undefined,
    ),
    opts.feedback?.(session) ??
      feedbackPanel(
        session,
        navigation,
        renderSession,
        {
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
        },
        displayState,
      ),
  );
  const actions = actionPanel(session, renderSession);
  const playPosition = isPuzzleComplete(session) ? puzzlePlayPosition(session, displayState) : null;
  const reportControl = trainer.querySelector<HTMLElement>('.puzzle-solved-panel > .puzzle-report');
  const phoneBar = puzzlePhoneMoveNav(
    puzzleScrubBounds(session),
    (action) => scrubPuzzle(session, renderSession, action),
    {
      // The desktop menu holds secondary actions. On a phone it also lends
      // the engine controls and settings from the sidebar into the sheet.
      blocks: () => [
        ...(window.matchMedia('(max-width: 980px)').matches
          ? [session.analysis?.engineEl, reportControl]
          : []),
        playPosition,
      ],
      head: () =>
        window.matchMedia('(max-width: 980px)').matches && phoneMenu.props
          ? puzzlePhoneMenuHead(phoneMenu.props)
          : null,
      rows: () =>
        window.matchMedia('(max-width: 980px)').matches && phoneMenu.props
          ? puzzlePhoneMenuRows(phoneMenu.props)
          : [],
      signal: phoneMenu.abort?.signal,
    },
  );
  const syncMenuAvailability = (): void => {
    if (!phoneBar.menuButton) return;
    const empty = !window.matchMedia('(max-width: 980px)').matches && !playPosition;
    if (empty) phoneBar.closeMenu();
    phoneBar.menuButton.disabled = empty;
  };
  syncMenuAvailability();
  window.addEventListener('resize', syncMenuAvailability, { signal: phoneMenu.abort?.signal });
  side.append(trainer, actions, phoneBar.el);

  // Post-completion engine analysis (adapters with a client engine): once the
  // puzzle is over (solved or its solution revealed), surface the local-engine
  // panel + board arrows. Gated to non-spoiler states only — a bare wrong move
  // keeps solving open, so the engine stays hidden until the outcome is locked.
  // The controller persists on the session across renders.
  if (opts.analysis !== false && adapter.createAnalysis && isPuzzleComplete(session)) {
    if (!session.analysis) session.analysis = adapter.createAnalysis();
    // Engine bar fuses onto the top of the move list (analyse-table shape);
    // the analysis target joins the footer vote row. Only the move track
    // yields height and scrolls; the engine and completion controls stay put.
    // A browser that cannot run the engine hides its row (engine-panel.ts), so
    // the trainer keeps its two-row shape rather than an empty engine track.
    side.classList.add('puzzle-side-panel--analysis');
    if (!session.analysis.engineEl.hidden) {
      trainer.classList.add('puzzle-trainer-panel--analysis');
      trainer.prepend(session.analysis.engineEl);
    }
    const open = session.analysis.openLinkEl;
    open.classList.add('puzzle-analysis-button');
    open.setAttribute('aria-label', t('puzzle.openInAnalysis'));
    open.title = t('puzzle.openInAnalysis');
    open.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>';
    trainer.querySelector('.puzzle-solved-feedback')?.prepend(open);
    session.analysis.refresh(session, displayState, board);
    if (!session.analysis.engineEl.hidden) {
      trainer.querySelector('.puzzle-moves')?.prepend(puzzleEvalChip(session.analysis.engineEl));
    }
  }

  boardPanel.append(board, side);
  host.append(boardPanel);
  paintMateSlash(board, session, displayState);
  keepActivePuzzleMoveInView(side);
  // A re-render while the menu is open (a step from the bar's own arrows, a
  // vote) keeps it open on the new bar.
  // Focus stays where it is: only a ☰ press moves it into the sheet.
  if (reopenMenu && !phoneBar.menuButton?.disabled) {
    phoneMenu.restoring = true;
    phoneBar.openMenu();
    phoneMenu.restoring = false;
    if (sheetFocus) restorePhoneMenuFocus(phoneBar, sheetFocus);
  }

  // Right after a solve, hand focus to the next-puzzle button (one-shot) so
  // Enter or Space advances; on small screens the CTA is then scrolled just
  // into view at the bottom edge, where the side panel sits below the board. A
  // bare focus() centres it instead, which on a phone took the board and its
  // arrows off the top of the screen right when you might step back through
  // the line (focusPuzzleNext).
  //
  // Not inside an embed. body.embed-body hides the document's overflow, so a
  // focus scroll there is a ONE-WAY door: it moved scrollTop to the bottom of
  // the frame, put the board's top edge at -294px, and left no way to scroll
  // back to it short of a reload. The embed sizes itself to its frame, so
  // there is nothing off screen to scroll to in the first place.
  if (session.focusNext) {
    session.focusNext = false;
    const embedded = document.documentElement.dataset.embed !== undefined;
    const nextButton = host.querySelector<HTMLButtonElement>('[data-puzzle-next="true"]');
    if (nextButton) focusPuzzleNext(nextButton, embedded);
  }
}

/** Focus the next-puzzle button without the browser's centring scroll; outside
 *  an embed, scroll it only as far as the nearest edge. */
export function focusPuzzleNext(button: HTMLElement, embedded: boolean): void {
  button.focus({ preventScroll: true });
  if (!embedded) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export type PuzzleScrub = 'first' | 'previous' | 'next' | 'last';

// Move the replay cursor. Shared by the arrow buttons and the keyboard handler
// so both animate identically. No-op while a submission is in flight or when the
// cursor is already at the requested end.
// The cursor runs from firstPuzzleViewPly (the source game's opening, when
// its history is shown; else `initial`) to the solution's last played ply.
// Held while the opening glide is pending: the board then shows the position
// before the setup move whatever the cursor says.
function scrubPuzzle(session: PuzzleSession, renderSession: () => void, action: PuzzleScrub): void {
  if (session.submitting || session.setupIntro || session.wrongPreview) return;
  if (session.exploration) {
    const line = session.exploration;
    line.cursor =
      action === 'first'
        ? 0
        : action === 'last'
          ? line.moves.length
          : Math.max(0, Math.min(line.moves.length, line.cursor + (action === 'next' ? 1 : -1)));
    session.selectedSquare = null;
    renderSession();
    return;
  }
  const firstPly = firstPuzzleViewPly(session);
  const lastPly = session.playedMoves.length;
  switch (action) {
    case 'first':
      if (session.viewPly <= firstPly) return;
      session.viewPly = firstPly;
      renderSession();
      return;
    case 'previous': {
      if (session.viewPly <= firstPly) return;
      // Reverse-glide the move being undone (replay back-step).
      const undone = puzzleMoveIntoView(session, session.viewPly);
      session.viewPly -= 1;
      renderSession();
      if (undone) animatePuzzleMove(session, undone, { reverse: true });
      return;
    }
    case 'next': {
      if (session.viewPly >= lastPly) return;
      // Glide the move being stepped into (replay forward step).
      session.viewPly += 1;
      const stepped = puzzleMoveIntoView(session, session.viewPly);
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

// A click on a move in the list: show the position after it. One step glides
// like the arrows; a longer jump repaints, as ⏮ and ⏭ do.
function jumpPuzzle(session: PuzzleSession, renderSession: () => void, viewPly: number): void {
  if (session.submitting || session.setupIntro || session.wrongPreview) return;
  if (session.exploration) {
    session.exploration = null;
    session.selectedSquare = null;
    session.viewPly = viewPly;
    renderSession();
    return;
  }
  const target = Math.min(
    session.playedMoves.length,
    Math.max(firstPuzzleViewPly(session), viewPly),
  );
  if (target === session.viewPly) return;
  if (target === session.viewPly + 1) scrubPuzzle(session, renderSession, 'next');
  else if (target === session.viewPly - 1) scrubPuzzle(session, renderSession, 'previous');
  else {
    session.viewPly = target;
    renderSession();
  }
}

// The move that leads into the position at `viewPly`: a solution ply, the setup
// move (0), or a move of the source game's history (< 0; none for its opening).
function puzzleMoveIntoView(session: PuzzleSession, viewPly: number): PuzzleMove | undefined {
  if (viewPly > 0) return session.playedMoves[viewPly - 1];
  if (viewPly === 0) return session.puzzle.initial.lastMove;
  const history = session.history ?? [];
  return history[history.length + viewPly];
}

function puzzleScrubBounds(session: PuzzleSession): { atStart: boolean; atEnd: boolean } {
  const held = session.submitting || session.setupIntro !== null || !!session.wrongPreview;
  if (session.exploration)
    return {
      atStart: session.exploration.cursor === 0 || held,
      atEnd: session.exploration.cursor === session.exploration.moves.length || held,
    };
  return {
    atStart: session.viewPly <= firstPuzzleViewPly(session) || held,
    atEnd: session.viewPly >= session.playedMoves.length || held,
  };
}

/**
 * The page's phone stepper: the shared move-nav bar the review, analysis, study
 * and broadcast boards put under the board (e4823b2b), with its ☰ menu as a
 * bottom sheet over the board, flush on the bar so ☰ stays in reach to close
 * it. The phone page fits one screen (board, bar, move strip, prompt strip), so
 * what used to follow the prompt strip lives in the sheet: a header and
 * one-line setting rows built for it (puzzles/phone-menu.ts), and between them
 * the engine panel (once the puzzle is over) and the analysis link, lent in
 * while it is open and put back when it closes, so they are rendered once. ☰,
 * Escape or a tap outside closes it; ☰ moves focus into the sheet and closing
 * hands it back to ☰. puzzles.css shows the bar only in the page's stacked
 * layout (980px and below) and hides `.puzzle-actions` there, so desktop and
 * the embed card keep their own arrows.
 */
export function puzzlePhoneMoveNav(
  bounds: { atStart: boolean; atEnd: boolean },
  onScrub: (action: PuzzleScrub) => void,
  menu: {
    blocks: () => readonly (HTMLElement | null | undefined)[];
    head?: () => HTMLElement | null;
    rows?: () => readonly HTMLElement[];
    signal?: AbortSignal;
  },
): MoveNavBar {
  const content = document.createElement('div');
  content.className = 'puzzle-phone-menu';
  content.tabIndex = -1;
  content.setAttribute('role', 'dialog');
  content.setAttribute('aria-label', t('review.navMenu'));
  const headSlot = document.createElement('div');
  headSlot.className = 'puzzle-pm-head-slot';
  const rowsSlot = document.createElement('div');
  rowsSlot.className = 'puzzle-pm-rows';
  content.append(headSlot, rowsSlot);

  // Rebuilt on open and on every sidebar render while open (a toggle flips
  // the props); a focused switch keeps focus across the rebuild.
  const paint = (): void => {
    const active = document.activeElement;
    const focusedKey =
      active instanceof HTMLElement && rowsSlot.contains(active) ? active.dataset.puzzleMenu : '';
    const head = menu.head?.();
    headSlot.replaceChildren(...(head ? [head] : []));
    rowsSlot.replaceChildren(...(menu.rows?.() ?? []));
    if (focusedKey) {
      rowsSlot
        .querySelector<HTMLElement>(`[data-puzzle-menu="${focusedKey}"]`)
        ?.focus({ preventScroll: true });
    }
  };

  const bar = createMoveNavBar({
    className: 'puzzle-move-nav',
    menuPlacement: 'up',
    menuContent: content,
    signal: menu.signal,
    onFirst: () => onScrub('first'),
    onPrev: () => onScrub('previous'),
    onNext: () => onScrub('next'),
    onLast: () => onScrub('last'),
    onMenuToggle: (open) => {
      phoneMenu.open = open;
      if (!open) {
        const hadFocus = content.contains(document.activeElement);
        phoneMenu.refresh = null;
        returnPhoneMenuLoans();
        headSlot.replaceChildren();
        rowsSlot.replaceChildren();
        if (hadFocus) bar.menuButton?.focus({ preventScroll: true });
        return;
      }
      paint();
      for (const block of menu.blocks()) lendToPhoneMenu(block, rowsSlot);
      phoneMenu.refresh = paint;
      fitPhoneMenu(bar);
      if (!phoneMenu.restoring) content.focus({ preventScroll: true });
    },
  });
  bar.setBounds(bounds);
  return bar;
}

type PhoneMenuLoan = { el: HTMLElement; mark: Comment };

// Page-level, because renderSession rebuilds the bar on every render: the open
// state survives the rebuild, the loans go home before the old bar is dropped,
// and the old bar's page listeners are aborted. `props` is the sidebar's last
// render, which the sheet's rows are built from.
const phoneMenu: {
  open: boolean;
  restoring: boolean;
  loans: PhoneMenuLoan[];
  abort: AbortController | null;
  evalSync: MutationObserver | null;
  props: QueuePanelProps | null;
  refresh: (() => void) | null;
} = {
  open: false,
  restoring: false,
  loans: [],
  abort: null,
  evalSync: null,
  props: null,
  refresh: null,
};

type PhoneMenuFocus = { el: HTMLElement; key: string };

function phoneMenuFocus(): PhoneMenuFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest('.puzzle-phone-menu')) return null;
  return { el: active, key: active.dataset.puzzleMenu ?? '' };
}

function restorePhoneMenuFocus(bar: MoveNavBar, focus: PhoneMenuFocus): void {
  const content = bar.menu?.querySelector<HTMLElement>('.puzzle-phone-menu');
  if (!content) return;
  const target =
    (content.contains(focus.el) ? focus.el : null) ??
    (focus.key ? content.querySelector<HTMLElement>(`[data-puzzle-menu="${focus.key}"]`) : null) ??
    content;
  target.focus({ preventScroll: true });
}

/** Before the detail host is replaced: loans home, old listeners off. */
function resetPhoneMenu(): void {
  returnPhoneMenuLoans();
  phoneMenu.open = false;
  phoneMenu.refresh = null;
  phoneMenu.abort?.abort();
  phoneMenu.abort = new AbortController();
  phoneMenu.evalSync?.disconnect();
  phoneMenu.evalSync = null;
}

/** Lend a page block into the sheet, just before `before`. */
function lendToPhoneMenu(el: HTMLElement | null | undefined, before: HTMLElement): void {
  if (!el || el.hidden || before.parentElement?.contains(el)) return;
  const mark = document.createComment('puzzle-phone-menu');
  el.replaceWith(mark);
  before.before(el);
  phoneMenu.loans.push({ el, mark });
}

function returnPhoneMenuLoans(): void {
  // A mark whose home was rebuilt is dropped: the render re-places that block.
  for (const { el, mark } of phoneMenu.loans.splice(0)) {
    if (mark.isConnected) mark.replaceWith(el);
    else mark.remove();
  }
}

/** The menu opens up over the board; keep it under the site bar. */
function fitPhoneMenu(bar: MoveNavBar): void {
  if (!bar.menu || !bar.el.isConnected) return;
  const navBottom = document.querySelector('.site-nav')?.getBoundingClientRect().bottom ?? 0;
  const room = bar.el.getBoundingClientRect().top - navBottom - 8;
  bar.menu.style.maxHeight = room > 120 ? `${Math.floor(room)}px` : '';
}

/**
 * The engine's score on the move strip while the engine runs: on the phone the
 * engine panel waits in the ☰ menu, so the strip mirrors its eval label.
 */
export function puzzleEvalChip(engineEl: HTMLElement): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'puzzle-eval-chip';
  const sync = (): void => {
    chip.hidden = !engineEl.classList.contains('engine-panel--on');
    chip.textContent = engineEl.querySelector('.engine-panel__eval')?.textContent ?? '';
  };
  sync();
  phoneMenu.evalSync?.disconnect();
  phoneMenu.evalSync = new MutationObserver(sync);
  phoneMenu.evalSync.observe(engineEl, {
    attributes: true,
    attributeFilter: ['class'],
    characterData: true,
    childList: true,
    subtree: true,
  });
  return chip;
}

function actionPanel(session: PuzzleSession, renderSession: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'puzzle-actions';
  const { atStart, atEnd } = puzzleScrubBounds(session);

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

function trackPuzzleAttempted(session: PuzzleSession, outcome: PuzzleAttemptOutcome): void {
  track(
    'puzzle_attempted',
    puzzleAttemptedProps({
      puzzleId: session.puzzle.id,
      variant: session.puzzle.variant,
      themes: (session.puzzle as { themes?: readonly string[] }).themes,
      rated: getPuzzleRatedPref(),
      mode: session.mode ?? 'session',
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
  opts: PuzzleSolverOptions = {},
): Promise<void> {
  // Once the answer has been shown (or the puzzle is solved), the board is a
  // locked replay: no further moves are submitted.
  if (
    session.locked ||
    session.submitting ||
    session.revealed ||
    session.solved ||
    session.wrongPreview
  )
    return;
  session.setupIntro = null;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.checkingMove') };
  renderSession();
  const beforeCount = puzzlePieceCount(session.state);
  const playedCountBefore = session.playedMoves.length;
  const stateBefore = session.state;
  const nextSolverMoves = [...session.solverMoves, move];
  const submitted = await (opts.submitAttempt ?? submitPuzzleAttempt)(
    session.puzzle.id,
    nextSolverMoves,
    session.qualitySessionId,
  ).catch((error: unknown) => {
    if (session.locked) return null;
    if (error instanceof PuzzlePlayDisabledError) return PLAY_LOCKED;
    session.submitting = false;
    session.feedback = { kind: 'bad', text: t('puzzle.checkFailed') };
    renderSession();
    return null;
  });
  if (!submitted || session.locked) return;
  if (submitted === PLAY_LOCKED) return showPlayLocked(session, renderSession);
  const { attempt, rating } = submitted;
  // A mode submitter can send the line on a terminal miss (streak or replay).
  const { solution } = submitted as { solution?: PuzzleMove[] };
  session.submitting = false;
  session.selectedSquare = null;
  session.selectedDrop = null;
  // A checker failure is retryable, not a missed Storm puzzle. The server
  // leaves its clock and combo alone in this case too.
  if (session.mode === 'storm' && !attempt.ok && attempt.code !== 'incorrect-move') {
    session.feedback = { kind: 'bad', text: t('puzzle.checkFailed') };
    renderSession();
    opts.onAttempt?.(attempt);
    return;
  }
  if (attempt.ok) {
    session.solverMoves = attempt.solverMoves;
    session.playedMoves = attempt.playedMoves;
    session.state = attempt.state;
    session.viewPly = session.playedMoves.length;
    // With a scripted reply, hold on the solver's move (its ✓) first; the reply
    // glides in after REPLY_PAUSE_MS. Input stays blocked until then.
    if (!opts.fast && session.playedMoves.length - playedCountBefore >= 2) session.viewPly -= 1;
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
  } else if (attempt.code === 'incorrect-move' && solution?.length) {
    // A terminal miss whose submitter sends the line (Puzzle Streak): the board
    // stays on this puzzle, keeps the wrong try for the move list and plays
    // the answer out from the ply that went wrong, like a reveal.
    session.failed = true;
    session.wrongMove = { ply: session.playedMoves.length, move: attempt.move };
    if (!opts.fast) session.wrongPreview = wrongPreviewOf(session, stateBefore, attempt.move);
    showSolutionLine(session, solution, session.playedMoves.length);
    session.feedback = { kind: 'bad', text: t('puzzle.tryAnotherMove') };
    playSound('learn-failure');
  } else {
    session.state = attempt.state;
    session.viewPly = session.playedMoves.length;
    if (attempt.code === 'incorrect-move') {
      const ply = session.playedMoves.length;
      session.wrongTries = [...(session.wrongTries ?? []), { ply, move: attempt.move }];
      if (!opts.fast) session.wrongPreview = wrongPreviewOf(session, stateBefore, attempt.move);
    }
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
  if (session.mode === 'storm' && !attempt.ok && attempt.code === 'incorrect-move') {
    session.locked = true;
    trackPuzzleAttempted(session, 'failed');
  }
  if (rating) reportAttemptRating(rating);
  // The solver's own move lands instantly (they just chose it); the scripted
  // reply waits under the ✓, then glides. A wrong try waits under its ✗, then
  // glides back; Streak's ending miss then plays the answer out.
  const reply =
    attempt.ok && session.viewPly < session.playedMoves.length
      ? attempt.playedMoves.at(-1)
      : undefined;
  session.pendingReplyPly = reply ? session.playedMoves.length - 1 : null;
  renderSession();
  if (reply) playPuzzleReply(session, renderSession, reply);
  if (session.wrongPreview) {
    takeBackWrongTry(session, renderSession, () => {
      if (session.wrongMove && session.revealed) playbackSolution(session, renderSession);
    });
  }
  opts.onAttempt?.(attempt);
}

// Highlight the correct piece to move for the current ply (lichess "get a hint").
// The move is computed server-side (the client never holds the solution); the
// hint books a failed rated attempt on the first terminal action (idempotent
// server-side, so it never double-counts a prior wrong-move fail). The user may
// then play the highlighted piece, take the full solution, or move on.
async function requestHint(session: PuzzleSession, renderSession: () => void): Promise<void> {
  if (session.locked || session.submitting || session.revealed || session.solved) return;
  // A wrong try still held under its ✗ is dropped, not glided back.
  session.wrongPreview = null;
  session.setupIntro = null;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.fetchingHint') };
  renderSession();
  const hinted = await fetchPuzzleHint(
    session.puzzle.id,
    session.playedMoves.length,
    session.qualitySessionId,
  ).catch(playLockRefusal);
  if (session.locked) return;
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
  if (session.locked || session.submitting || session.revealed) return;
  // A wrong try still held under its ✗ is dropped, not glided back.
  session.wrongPreview = null;
  session.setupIntro = null;
  session.submitting = true;
  session.feedback = { kind: 'pending', text: t('puzzle.loadingSolution') };
  renderSession();
  const revealed = await fetchPuzzleSolution(session.puzzle.id, session.qualitySessionId).catch(
    playLockRefusal,
  );
  if (session.locked) return;
  if (revealed === PLAY_LOCKED) return showPlayLocked(session, renderSession);
  const { solution, rating } = revealed;
  session.submitting = false;
  if (!solution || solution.length === 0) {
    session.feedback = { kind: 'neutral', text: t('puzzle.noSolution') };
    renderSession();
    return;
  }
  session.failed = true;
  trackPuzzleAttempted(session, 'revealed');
  // Play the answer out from wherever the user got to. Their correct moves are a
  // prefix of the solution, so replaying from that ply matches the board.
  showSolutionLine(session, solution, session.playedMoves.length);
  session.feedback = { kind: 'neutral', text: t('puzzle.solution') };
  if (rating) reportAttemptRating(rating);
  renderSession();
  playbackSolution(session, renderSession);
}

// Lock the board on the full solution line with the replay cursor at
// `fromPly`, ready for playbackSolution to step it forward.
function showSolutionLine(
  session: PuzzleSession,
  solution: readonly PuzzleMove[],
  fromPly: number,
): void {
  session.revealed = true;
  session.revealedFromPly = Math.min(fromPly, solution.length);
  session.selectedSquare = null;
  session.selectedDrop = null;
  session.playedMoves = [...solution];
  session.solverMoves = solution.filter((_, index) => index % 2 === 0);
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  let state = clonePuzzleState(session.puzzle.initial);
  for (const move of solution) {
    state = adapter.applyMove(state, move);
  }
  session.state = state;
  session.viewPly = Math.min(fromPly, solution.length);
}

// Step the replay cursor forward one ply at a time, reusing the scrub-forward
// animation, until the whole solution has been shown. Stops once this session
// is no longer the painted one: another puzzle, or the same puzzle opened again,
// whose fresh session a stale step would paint over (10-31: the new session's
// reply then bailed as unpainted and its board never went live).
function playbackSolution(session: PuzzleSession, renderSession: () => void): void {
  const step = (): void => {
    if (session.solutionPlaybackCancelled) return;
    if (session.locked || !isPaintedPuzzleSession(session)) return;
    if (session.viewPly >= session.playedMoves.length) return;
    scrubPuzzle(session, renderSession, 'next');
    window.setTimeout(step, REVEAL_STEP_MS);
  };
  window.setTimeout(step, REVEAL_STEP_MS);
}

// The painted board inside a .puzzle-board column, across every variant adapter:
// a reserve shell (none since Fortress Xiangqi was retired, 2026-10-11) wraps
// board plus reserves, the rest paint a board element straight in. Falls back to the column so the grip still has something
// to measure if an adapter paints something new.
function paintedPuzzleBoard(column: HTMLElement): HTMLElement {
  return (
    column.querySelector<HTMLElement>(
      '.puzzle-board-shell, .puzzle-xiangqi-board, .jungle-live-svg',
    ) ?? column
  );
}

// Park the resize grip on the painted board's corner rather than the column's.
// The column track carries the height budget, so on a wide screen it is wider
// than the board and the grip would otherwise float in the gutter beside it.
//
// The same measurement hands the board's DRAWN height to the right column
// (--puzzle-board-height, #536). --puzzle-surface-size is only the height
// budget: when the column track is narrower than that budget allows, the 9x10
// board binds on width and draws shorter (616 vs 704 at 1440x900), and a side
// panel sized from the budget ran 88px past the board's bottom edge. The value
// lives on .puzzle-detail, which survives renderSession's repaint, so the next
// render starts from the last measurement instead of flashing the budget.
function fitPuzzleGrip(column: HTMLElement): void {
  requestAnimationFrame(() => {
    if (!column.isConnected) return;
    const painted = paintedPuzzleBoard(column);
    const paintedRect = painted.getBoundingClientRect();
    const gutter = column.getBoundingClientRect().width - paintedRect.width;
    const inset = `${Math.max(0, Math.round(gutter / 2))}px`;
    // On the detail, not the column: the session row under the board is the
    // column's sibling and lines its first chip up with the board's left edge
    // from the same inset. Set on the column it never reached the row, which
    // started in the gutter left of the board.
    const detail = column.closest<HTMLElement>('.puzzle-detail');
    (detail ?? column).style.setProperty('--puzzle-board-inset', inset);
    if (paintedRect.height > 0) {
      detail?.style.setProperty('--puzzle-board-height', `${Math.round(paintedRect.height)}px`);
    }
  });
}

// The session the page last painted. A pause (the reply, a wrong try's
// take-back) checks it before acting, so a timer from a puzzle the solver has
// left never repaints over what replaced it; painting anything else forgets it.
let renderedPuzzleSession: PuzzleSession | null = null;

function isPaintedPuzzleSession(session: PuzzleSession): boolean {
  return renderedPuzzleSession === session;
}

function forgetPaintedPuzzle(): void {
  renderedPuzzleSession = null;
  puzzleFinishBadges?.destroy();
  puzzleFinishBadges = null;
}

// Verdict badges for the painted position: ✗ on a wrong try held before its
// take-back, else ✓ on the move just played when it was the solver's own find.
// Moves of a shown solution (reveal, Streak's miss) get none: they were shown,
// not found, as in the move list.
function puzzleMoveMarks(session: PuzzleSession): PuzzleMoveMark[] {
  if (session.exploration) return [];
  if (session.wrongPreview) return [{ square: session.wrongPreview.move.to, verdict: 'wrong' }];
  if (session.setupIntro || session.viewPly < 1) return [];
  const index = session.viewPly - 1;
  const move = session.playedMoves[index];
  const revealedFrom = session.revealed ? (session.revealedFromPly ?? null) : null;
  const shown = revealedFrom !== null && index >= revealedFrom;
  if (!move || index % 2 !== 0 || shown) return [];
  return [{ square: move.to, verdict: 'right' }];
}

function wrongPreviewOf(
  session: PuzzleSession,
  before: PuzzleState,
  move: PuzzleMove,
): PuzzleSession['wrongPreview'] {
  try {
    return { state: puzzleBoardAdapter(session.puzzle.variant).applyMove(before, move), move };
  } catch {
    // A move the client cannot replay just reads as not taken.
    return null;
  }
}

function playPuzzleReply(
  session: PuzzleSession,
  renderSession: () => void,
  reply: PuzzleMove,
): void {
  const held = session.viewPly;
  window.setTimeout(() => {
    session.pendingReplyPly = null;
    if (session.locked || !isPaintedPuzzleSession(session)) return;
    // A step through the list in the pause leaves the cursor where it was put.
    if (session.viewPly !== held) {
      renderSession();
      return;
    }
    session.viewPly = session.playedMoves.length;
    renderSession();
    animatePuzzleMove(session, reply);
  }, REPLY_PAUSE_MS);
}

function takeBackWrongTry(
  session: PuzzleSession,
  renderSession: () => void,
  then: () => void,
): void {
  const preview = session.wrongPreview;
  if (!preview) return;
  window.setTimeout(() => {
    if (session.wrongPreview !== preview) return;
    session.wrongPreview = null;
    if (session.locked || !isPaintedPuzzleSession(session)) return;
    renderSession();
    animatePuzzleMove(session, preview.move, { reverse: true });
    then();
  }, WRONG_HOLD_MS);
}

// The mated general's slash, the one the game rooms draw (live-finish-badges.ts),
// on a puzzle that ends in mate. The layer sits over the painted board and is
// rebuilt on every render, so the slash starts once and keeps its phase from
// `mateSlashAt`; leaving the mate clears it and stepping back replays it.
let puzzleFinishBadges: LiveFinishBadges | null = null;

function paintMateSlash(column: HTMLElement, session: PuzzleSession, shown: PuzzleState): void {
  puzzleFinishBadges?.destroy();
  puzzleFinishBadges = null;
  const status = shown.status as { type: string; winner?: string | null; reason?: string };
  const atEnd = isReplayLive(session) && status.type === 'finished';
  if (!atEnd || status.reason !== 'checkmate' || !status.winner) {
    session.mateSlashAt = null;
    return;
  }
  const board = shown.board as Record<string, { color: string; role?: string } | undefined>;
  const colors = [
    ...new Set(Object.values(board).flatMap((piece) => (piece ? [piece.color] : []))),
  ];
  const badges = finishBadgesForResult({
    colors,
    winner: status.winner,
    reason: 'checkmate',
    generalSquare: (color) => generalSquareOn(board, color),
  });
  if (badges.length === 0) return;
  session.mateSlashAt ??= Date.now();
  puzzleFinishBadges = createLiveFinishBadges(column, paintedPuzzleBoard(column));
  puzzleFinishBadges.play(session.puzzle.id, badges, {
    delayMs: MATE_SLASH_DELAY_MS - (Date.now() - session.mateSlashAt),
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
// The opening glide (#664): the first render painted the pre-setup position;
// after a short pause, hand over to `initial` and glide the opponent's setup
// move into it, the same glide a scripted reply gets. Input stays blocked until
// then (isReplayLive). A hint or reveal in the pause clears setupIntro, which
// cancels this; so does leaving the puzzle (isCurrent).
function playSetupIntro(
  session: PuzzleSession,
  renderSession: () => void,
  isCurrent: () => boolean,
): void {
  const intro = session.setupIntro;
  const setup = session.puzzle.initial.lastMove;
  if (!intro || !setup) {
    session.setupIntro = null;
    return;
  }
  window.setTimeout(() => {
    if (session.setupIntro !== intro || !isCurrent()) return;
    session.setupIntro = null;
    renderSession();
    animatePuzzleMove(session, setup);
    // The setup move sounds like any other move: a capture if it took a piece.
    playSound(puzzlePieceCount(session.state) < puzzlePieceCount(intro) ? 'capture' : 'move');
  }, SETUP_INTRO_PAUSE_MS);
}

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
  resetPhoneMenu();
  forgetPaintedPuzzle();
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

// True once per document, for the first mount of a page the visitor reloaded.
// Later mounts in the same document (none today) are not reloads.
let firstMountChecked = false;
function isFirstMountReload(): boolean {
  if (firstMountChecked) return false;
  firstMountChecked = true;
  try {
    const entry = performance.getEntriesByType?.('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type === 'reload';
  } catch {
    return false;
  }
}

/** Test hook: let the next mount read the navigation type again. */
export function resetPuzzleReloadCheckForTest(): void {
  firstMountChecked = false;
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
  const explored = explorationState(session);
  if (explored) return explored;
  if (session.wrongPreview) return session.wrongPreview.state;
  if (session.setupIntro) return session.setupIntro;
  if (session.viewPly >= session.playedMoves.length) return session.state;
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  const history = session.history ?? [];
  const start = session.viewPly < 0 ? adapter.historyStart?.(session.puzzle) : null;
  if (start) {
    // The source game: its opening with its first (H + 1 + viewPly) moves.
    let state = start;
    for (const move of history.slice(0, Math.max(0, history.length + 1 + session.viewPly))) {
      state = adapter.applyMove(state, move);
    }
    return state;
  }
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

// The page frame: shell, the screen-reader heading, and the three-column
// layout (sidebar, board, trainer panel). The build-time bake and the client
// mount both build it here, so the baked page already has the trainer's
// geometry and the mount swaps content into the same slots instead of
// replacing an article with a different layout (CLS 0.69 on /puzzles).
function buildPuzzlesFrame(): {
  shell: HTMLElement;
  detail: HTMLElement;
  controls: HTMLElement;
} {
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
  renderPendingBoard(detail, null);
  return { shell, detail, controls };
}

// The board and trainer-panel slots, empty, at the size the painted board will
// take. .puzzle-detail is display: contents, so a bare status line would land in
// the layout grid as its own item: on a wide screen it took the sidebar's
// column and pushed the sidebar one column right, on a narrow one the sidebar
// sat right under it, and both jumped when the board arrived. The stand-in
// carries the xiangqi board's classes so its box is the board's box; it is the
// only surfaced trainer, and a deep link to another variant settles once.
function renderPendingBoard(host: HTMLElement, message: string | null): void {
  resetPhoneMenu();
  forgetPaintedPuzzle();
  const panel = document.createElement('div');
  panel.className = 'puzzle-board-panel puzzle-board-panel--pending';
  const board = document.createElement('div');
  board.className = 'puzzle-board';
  const surface = document.createElement('div');
  surface.className = 'xiangqi-live-board puzzle-xiangqi-board puzzle-board-placeholder';
  surface.setAttribute('aria-hidden', 'true');
  board.append(surface);
  const side = document.createElement('aside');
  side.className = 'puzzle-side-panel';
  if (message) {
    const status = document.createElement('p');
    status.className = 'puzzles-status';
    status.textContent = message;
    side.append(status);
  }
  panel.append(board, side);
  host.replaceChildren(panel);
}

// Build-time prerender of /puzzles. /puzzles is in the sitemap but served the
// bare shell, so a crawler saw a <title> and 27 characters of body. The trainer
// itself needs the API, so the bake is the trainer's empty frame (the same
// buildPuzzlesFrame the client mounts) with the explanation a first-time
// visitor reads in the sidebar slot, where the queue panel lands once the API
// answers. The client mount still replaces all of it (root.replaceChildren),
// so there is no hydration contract to keep, only the shared geometry.
//
// Default locale only, matching /player and /learn/xiangqi: prefixed paths stay
// on the client-rendered shell, so this copy is deliberately not in the catalog.
export function renderPuzzlesShellForPrerender(): string {
  const { shell, controls } = buildPuzzlesFrame();

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

  controls.append(intro);
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
 * hint, reveal, replay arrows). Callers can supply queue navigation and opt
 * into visit tracking for training modes.
 * It is what /embed/puzzle mounts inside someone else's page, and it is the
 * same code path the trainer uses, so a fix to solving lands in both.
 *
 * Attempts are always UNRATED here: a frame on a third party's site must never
 * move the viewer's rating, and the embed never asks who the viewer is.
 */
export type PuzzleSolverOptions = {
  onSolved?: (id: string) => void;
  mode?: PuzzleAttemptMode;
  recordVisit?: boolean;
  navigation?: PuzzleNavigation;
  // Storm defaults to immediate setup/replies/take-backs; other solvers keep
  // their existing pauses unless explicitly opted into fast play.
  fast?: boolean;
  // Storm response.progress: an accepted partial line, including scripted
  // replies. Restoring it sends no request, callbacks, or analytics.
  initialAttempt?: Extract<PuzzleAttempt, { ok: true }> | null;
  analysis?: boolean;
  feedback?: (session: PuzzleSession) => HTMLElement;
  // A replacement attempt submitter. One that also returns `solution` on a
  // terminal wrong move gets the line played out on the locked board.
  submitAttempt?: (
    id: string,
    moves: readonly PuzzleMove[],
    qualitySessionId?: string,
  ) => Promise<Awaited<ReturnType<typeof submitPuzzleAttempt>> & { solution?: PuzzleMove[] }>;
  onAttempt?: (attempt: PuzzleAttempt) => void;
  // Runs after each render of the board panel (streak adds its run chips).
  afterRender?: (host: HTMLElement, session: PuzzleSession) => void;
};

export type PuzzleSolverHandle = {
  dispose(): void;
  // Lock the board (no more moves) and re-render, e.g. when a run ends
  // without a move on the board.
  end(): void;
};

export function mountPuzzleSolver(
  host: HTMLElement,
  puzzle: PuzzleDetail,
  opts: PuzzleSolverOptions = {},
): PuzzleSolverHandle {
  for (const adapter of allPuzzleBoardAdapters()) adapter.installStyles?.();
  setBoardFamily('xiangqi');
  setPuzzleRatedPref(false);
  opts = {
    ...opts,
    fast: opts.fast ?? opts.mode === 'storm',
    analysis: opts.analysis ?? opts.mode !== 'storm',
  };
  if (opts.mode === 'streak' || opts.mode === 'storm' || opts.recordVisit) {
    resetPhoneMenu();
    phoneMenu.props = null;
  }
  restoreBoardScale();
  installPuzzleGripFit();
  const session = createPuzzleSession(puzzle, {
    history: opts.mode === 'streak' || opts.recordVisit,
    fast: opts.fast,
  });
  session.mode = opts.mode ?? 'embed';
  if (opts.initialAttempt) {
    const progress = opts.initialAttempt;
    session.setupIntro = null;
    session.state = clonePuzzleState(progress.state);
    session.solverMoves = [...progress.solverMoves];
    session.playedMoves = [...progress.playedMoves];
    session.viewPly = progress.playedMoves.length;
    session.solved = progress.complete;
  }
  if (opts.mode === 'streak' || opts.recordVisit) {
    void sendPuzzleQualityEvent(puzzle.id, session.qualitySessionId, 'view').catch(() => {});
  }
  // Without a caller's queue, the feedback panel offers no previous/next.
  const navigation = opts.navigation ?? navigationFor([], null, async () => {});
  let disposed = false;
  const renderSession = (): void => {
    if (disposed) return;
    renderPuzzleDetail(host, session, renderSession, navigation, (id) => opts.onSolved?.(id), opts);
    opts.afterRender?.(host, session);
  };
  renderSession();
  playSetupIntro(session, renderSession, () => !disposed && host.isConnected);

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
      disposed = true;
      session.locked = true;
      if (isPaintedPuzzleSession(session)) forgetPaintedPuzzle();
      session.analysis?.dispose();
      window.removeEventListener('keydown', onKeyDown);
    },
    end: () => {
      if (disposed) return;
      session.locked = true;
      session.submitting = false;
      session.revealed = true;
      session.setupIntro = null;
      session.wrongPreview = null;
      session.pendingReplyPly = null;
      session.selectedSquare = null;
      session.selectedDrop = null;
      renderSession();
    },
  };
}

// This small mode keeps its two new messages together in all supported locales;
// the rest of its chrome uses the trainer and Dashboard catalogs.
async function mountFailedPuzzleReplay(frame: ReturnType<typeof buildPuzzlesFrame>): Promise<void> {
  const { shell, detail, controls } = frame;
  const requested = new URLSearchParams(window.location.search).get('days') ?? '30';
  const days = ['1', '2', '3', '7', '10', '14', '21', '30', '60', '90'].includes(requested)
    ? requested
    : '30';
  const copy = {
    en: {
      progress: (n: number, total: number) => `Replay: ${n} of ${total}`,
      done: 'All done',
      title: 'Replay failed puzzles',
    },
    'zh-Hans': {
      progress: (n: number, total: number) => `错题重练：${n} / ${total}`,
      done: '全部完成',
      title: '错题重练',
    },
    'zh-Hant': {
      progress: (n: number, total: number) => `錯題重練：${n} / ${total}`,
      done: '全部完成',
      title: '錯題重練',
    },
  }[currentLocale()];
  const dashboard = (): HTMLAnchorElement => {
    const link = document.createElement('a');
    link.href = `/puzzles/dashboard?days=${days}`;
    link.textContent = t('puzzle.dashboardTitle');
    return link;
  };
  // The left column, as on Lichess: the way back to the Dashboard, then the
  // run's title and how far through it the player is.
  const card = document.createElement('section');
  card.className = 'puzzle-left-card puzzle-replay-side';
  const back = dashboard();
  back.className = 'puzzle-replay-side__back';
  back.textContent = `‹ ${t('puzzle.dashboardTitle')}`;
  const heading = document.createElement('h2');
  heading.className = 'puzzle-replay-side__title';
  heading.textContent = copy.title;
  const bar = document.createElement('div');
  bar.className = 'puzzle-replay-side__bar';
  const fill = document.createElement('span');
  bar.append(fill);
  const count = document.createElement('p');
  count.className = 'puzzle-replay-side__count';
  card.append(back, heading, bar, count);
  card.hidden = true;
  controls.replaceChildren(card);
  /** Puzzles finished so far out of the run; the bar fills as each one is left behind. */
  const showProgress = (done: number, total: number): void => {
    card.hidden = total === 0;
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-label', copy.title);
    fill.style.width = `${total ? (100 * done) / total : 0}%`;
    count.textContent = `${done} / ${total}`;
  };
  setOnAttemptRating(null);
  let failures: { puzzleId: string; failedAt: string }[] = [];
  let index = 0;
  let solver: PuzzleSolverHandle | null = null;
  let timer: number | null = null;
  let busy = false;

  const stopSolver = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    solver?.dispose();
    solver = null;
  };
  const message = (text: string, link: HTMLAnchorElement): void => {
    stopSolver();
    resetPhoneMenu();
    const panel = document.createElement('section');
    panel.className = 'puzzle-left-card puzzle-replay-summary';
    const title = document.createElement('h1');
    title.textContent = text;
    panel.append(title, link);
    shell.replaceChildren(panel);
  };
  const signIn = (): void => {
    const link = document.createElement('a');
    link.href = loginHrefForCurrentPage();
    link.textContent = t('nav.signIn');
    message(t('nav.puzzles'), link);
  };
  const retry = (action: () => Promise<void>): void => {
    renderStatus(detail, t('stats.unavailableBody'));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('puzzle.statusTryAgain');
    button.addEventListener('click', () => void action());
    detail.querySelector('.puzzles-status')!.append(' ', button);
  };
  const advance = (): void => {
    if (busy) return;
    index++;
    void showPuzzle();
  };
  const showPuzzle = async (): Promise<void> => {
    busy = true;
    stopSolver();
    renderPendingBoard(detail, t('puzzle.loading'));
    try {
      let puzzle: PuzzleDetail | null = null;
      // A puzzle removed since the queue loaded can no longer be replayed.
      while (index < failures.length && !puzzle) {
        puzzle = await fetchPuzzleDetail(failures[index]!.puzzleId);
        if (!puzzle) index++;
      }
      if (!puzzle) {
        showProgress(failures.length, failures.length);
        message(copy.done, dashboard());
        return;
      }
      const current = index;
      showProgress(current, failures.length);
      const navigation: PuzzleNavigation = {
        index: current,
        total: failures.length,
        hasPrevious: false,
        hasNext: true,
        goPrevious: () => {},
        goNext: advance,
      };
      solver = mountPuzzleSolver(detail, puzzle, {
        mode: 'session',
        recordVisit: true,
        analysis: false,
        navigation,
        submitAttempt: async (id, moves, sessionId) => {
          const result = await submitPuzzleAttempt(id, moves, sessionId);
          if (!result.attempt.ok && result.attempt.code === 'incorrect-move') {
            const revealed = await fetchPuzzleSolution(id, sessionId);
            return { ...result, ...(revealed.solution ? { solution: revealed.solution } : {}) };
          }
          return result;
        },
        afterRender: (host, session) => {
          const progress = host.querySelector('.puzzle-feedback-title, .puzzle-solved-panel h2');
          if (progress) {
            progress.classList.add('puzzle-replay-progress');
            progress.textContent = copy.progress(current + 1, failures.length);
            progress.setAttribute('aria-live', 'polite');
          }
          // The full answer stays on the board before moving on. No retry of
          // the failed puzzle can accidentally repair it in this visit.
          if (
            (session.solved || session.revealed) &&
            !session.wrongPreview &&
            session.viewPly === session.playedMoves.length &&
            timer === null
          ) {
            timer = window.setTimeout(
              () => {
                timer = null;
                if (
                  index === current &&
                  shell.isConnected &&
                  isPaintedPuzzleSession(session) &&
                  !session.wrongPreview &&
                  session.viewPly === session.playedMoves.length
                )
                  advance();
              },
              session.solved ? AUTO_NEXT_DELAY_MS : REVEAL_STEP_MS * 2,
            );
          }
        },
      });
    } catch {
      retry(showPuzzle);
    } finally {
      busy = false;
    }
  };
  const load = async (): Promise<void> => {
    renderPendingBoard(detail, t('puzzle.loading'));
    try {
      const response = await fetch(`/api/puzzles/failed?days=${days}`, {
        credentials: 'same-origin',
      });
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error('Replay unavailable');
      const result = (await response.json()) as { failures: typeof failures };
      failures = result.failures.sort(
        (a, b) =>
          Date.parse(a.failedAt) - Date.parse(b.failedAt) || a.puzzleId.localeCompare(b.puzzleId),
      );
      await showPuzzle();
    } catch {
      retry(load);
    }
  };
  await load();
}

/** Scroll a one-row chip strip so its current chip is visible, without moving the page. */
export function scrollChipIntoRow(row: HTMLElement): void {
  const current = row.querySelector<HTMLElement>('[aria-current]');
  if (!current) return;
  const overflow = current.offsetLeft + current.offsetWidth - row.clientWidth;
  if (overflow > row.scrollLeft) row.scrollLeft = overflow;
  else if (current.offsetLeft < row.scrollLeft) row.scrollLeft = current.offsetLeft;
}
