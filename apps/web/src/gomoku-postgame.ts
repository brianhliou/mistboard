import {
  exportFormatsForVariant,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
} from '@mistboard/game';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { gomokuEnabled } from './feature-flags.js';
import { gameOutcome, variantDisplayLabel } from './game-display.js';
import { gomokuOffered } from './gomoku-access.js';
import { gomokuAnalysisGame, gomokuAnalysisHref } from './gomoku-analysis-import.js';
import { t } from './i18n/catalog.js';
import { profileTargetFor } from './profile-link.js';
import {
  computeGameAnalysis,
  fetchCachedGameAnalysis,
  type GameAnalysis,
  requestGameAnalysis,
} from './review/game-analysis.js';
import { gameExportLinks } from './review/game-export-links.js';
import {
  buildReviewMeta,
  type ReviewMetaPlayer,
  reviewOutcomeLine,
} from './review/game-review-meta.js';
import { mountGomokuReview } from './review/gomoku-review.js';
import { reviewMoveClocks } from './review/move-clocks.js';
import { downloadRow } from './review/underboard-tabs.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav } from './site-shell.js';
import { readTenantWebClock, type TenantWebClock } from './variant-tenant/clock-projection.js';
import './landing.css';
import './game-route.css';

export type GomokuPostgameResponse = {
  game: {
    roomId: string;
    variant: typeof GOMOKU_SPEC_ID;
    mode: string;
    result: string;
    termination: string;
    plyCount: number;
    rated: boolean;
    initialMs: number | null;
    incrementMs: number | null;
    startedAt?: string;
    endedAt?: string;
    players?: ReviewMetaPlayer[];
  };
  state: {
    status: GomokuPlayerView['status'];
    moveNumber: number;
    timeControl?: { initialMs: number; incrementMs: number };
  };
  view: GomokuPlayerView;
  history: {
    truth: Array<{
      ply: number;
      at: number;
      view: GomokuPlayerView;
      clock?: TenantWebClock<GomokuColor>;
    }>;
  };
  timeline: Array<{
    type: string;
    at: number;
    color?: GomokuColor;
    move?: GomokuMove;
    ply?: number;
  }>;
};

export async function mountGomokuPostgame(root: HTMLElement, roomId: string): Promise<void> {
  const variant = variantDisplayLabel(GOMOKU_SPEC_ID);
  const message = (title: string, body?: string): void => {
    const main = document.createElement('main');
    main.className = 'game-shell';
    const heading = document.createElement('h1');
    heading.textContent = title;
    main.append(heading);
    if (body) {
      const detail = document.createElement('p');
      detail.textContent = body;
      main.append(detail);
    }
    root.replaceChildren(buildNav(), main);
  };
  root.classList.add('landing-page', 'game-route');
  if (!gomokuOffered()) {
    message(t('replay.variantUnavailable', { variant }), t('replay.routeNotEnabled'));
    return;
  }
  message(t('replay.loadingGame'));
  try {
    const response = await fetch(`/api/gomoku/games/${encodeURIComponent(roomId)}`);
    if (!response.ok) {
      message(
        t(response.status === 404 ? 'replay.gameNotFound' : 'replay.postgameUnavailable'),
        response.status === 404
          ? t('replay.variantGameUnavailable', { variant })
          : t('replay.postgameServiceUnavailable'),
      );
      return;
    }
    const postgame = (await response.json()) as GomokuPostgameResponse;
    const history = postgame.history?.truth;
    if (
      postgame.game?.roomId !== roomId ||
      postgame.game.variant !== GOMOKU_SPEC_ID ||
      postgame.view?.status.type !== 'finished' ||
      !Array.isArray(history) ||
      history.length === 0 ||
      !history.every(
        (snapshot, index) => snapshot.ply === index && snapshot.view?.board.length === 225,
      )
    ) {
      throw new Error('invalid gomoku recording');
    }
    const lastPly = history.length - 1;
    const opening = history[0]!.view.opening ?? { stones: [], turn: 'black' };
    const moves = postgame.timeline
      .filter((entry) => entry.type === 'move-played')
      .map((entry) => entry.move?.to);
    const analysisGame = gomokuAnalysisGame(opening, moves);
    if (!analysisGame || moves.length !== lastPly) throw new Error('invalid gomoku mainline');
    const status = reviewOutcomeLine(
      gameOutcome(postgame.game.result, GOMOKU_SPEC_ID),
      postgame.game.termination,
      GOMOKU_SPEC_ID,
    );
    const { metaCard, details } = buildReviewMeta({
      gameSpecId: GOMOKU_SPEC_ID,
      variantName: variant,
      game: postgame.game,
      status,
      firstMoverColor: opening.turn,
    });
    const black = postgame.game.players?.find((player) => player.color === 'black');
    const white = postgame.game.players?.find((player) => player.color === 'white');
    const moveEvents = postgame.timeline.filter(
      (entry) => entry.type === 'move-played' && entry.move,
    );
    let prevAt = postgame.timeline[0]?.at ?? moveEvents[0]?.at ?? 0;
    const moveTimes = moveEvents.map((entry) => {
      const elapsed = Math.max(0, entry.at - prevAt);
      prevAt = entry.at;
      return elapsed;
    });
    // Prefer the recorded clocks, including resignation/timeout deductions after
    // the last placement. Shared review slots are Black, then White, even when
    // an odd-stone opening makes White the first recorded mover.
    const recordedClocks = history.map((snapshot) =>
      readTenantWebClock(snapshot.clock, ['black', 'white'] as const),
    );
    const reconstructed = reviewMoveClocks(postgame);
    const moveClocks = recordedClocks.every((clock) => clock !== null)
      ? recordedClocks.map((clock) => ({
          first: clock.remainingMs.black,
          second: clock.remainingMs.white,
        }))
      : opening.turn === 'white'
        ? reconstructed?.map((clock) => ({ first: clock.second, second: clock.first }))
        : reconstructed;
    const checkedAnalysis = (analysis: GameAnalysis): GameAnalysis => {
      if (
        analysis.evals.length !== lastPly + 1 ||
        analysis.evals.some((point, i) => point.ply !== i)
      )
        throw new Error('analysis_incomplete');
      if (analysis.evals.every((point) => point.cp === null && point.mate === null))
        throw new Error('analysis_engine_unavailable');
      return computeGameAnalysis(
        { engineId: analysis.engineId, depth: analysis.depth, plies: analysis.evals },
        {
          firstMover: opening.turn === 'white' ? 'black' : 'red',
        },
      );
    };
    const signedIn = isLikelySignedIn();
    root.replaceChildren(buildNav());
    const review = mountGomokuReview(root, {
      pageClassName: 'gomoku-review',
      ariaLabel: t('replay.postgameReview'),
      title: variant,
      summary: status,
      metaCard,
      details,
      phoneInfoSheet: true,
      opening: analysisGame.opening,
      moves: analysisGame.moves,
      moveTimes,
      firstMover: opening.turn === 'white' ? 'black' : 'red',
      moveClocks,
      seatLabels: true,
      players: { red: black?.name, black: white?.name },
      playerProfiles: {
        red: black ? profileTargetFor(black) : null,
        black: white ? profileTargetFor(white) : null,
      },
      urlPly: true,
      analyseFromHere: (truth) =>
        gomokuAnalysisHref(analysisGame, truth.ply - opening.stones.length),
      // The export endpoint still requires the public flag, even for an admin.
      shareExtra: gomokuEnabled()
        ? [downloadRow(gameExportLinks(roomId, exportFormatsForVariant(GOMOKU_SPEC_ID)))]
        : undefined,
      // Admission above matches both engine endpoints: flag on, or an admin.
      analysis: {
        requestLabel: signedIn
          ? t('replay.requestComputerAnalysis')
          : t('replay.signInToRequestAnalysis'),
        requestHref: signedIn ? undefined : loginHrefForCurrentPage(),
        fetchCached: async (options) => {
          const cached = await fetchCachedGameAnalysis('gomoku', roomId, options);
          return cached ? checkedAnalysis(cached) : null;
        },
        run: async (_progress, signal, onStatus) =>
          checkedAnalysis(await requestGameAnalysis('gomoku', roomId, { signal, onStatus })),
      },
    });
    const onPageHide = (event: PageTransitionEvent): void => {
      // A back/forward-cache entry resumes this same review without remounting.
      // Keep its board and keyboard listeners alive until a permanent departure.
      if (event.persisted) return;
      review.destroy();
      window.removeEventListener('pagehide', onPageHide);
    };
    window.addEventListener('pagehide', onPageHide);
  } catch {
    message(t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
  }
}
