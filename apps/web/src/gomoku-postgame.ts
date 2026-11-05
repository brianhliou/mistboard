import {
  exportFormatsForVariant,
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
  parseGomokuMove,
  winPercentK,
} from '@mistboard/game';
import { reviewOpenedProps, track } from './analytics.js';
import { gomokuEnabled } from './feature-flags.js';
import { variantDisplayLabel } from './game-display.js';
import { gomokuOffered } from './gomoku-access.js';
import { gomokuAnalysisGame, gomokuAnalysisHref } from './gomoku-analysis-import.js';
import type { GomokuBoardMarker } from './gomoku-board.js';
import { t } from './i18n/catalog.js';
import { bootstrapGomokuRecording } from './live-gomoku.js';
import { type AdvantageChart, createAdvantageChart } from './review/advantage-chart.js';
import type { CevalLine } from './review/engine/ceval-types.js';
import { createEnginePanel } from './review/engine/engine-panel.js';
import {
  fetchCachedGameAnalysis,
  type GameAnalysis,
  requestGameAnalysis,
} from './review/game-analysis.js';
import { gameExportLinks } from './review/game-export-links.js';
import { downloadRow } from './review/underboard-tabs.js';
import { isLikelyAdmin } from './signed-in-state.js';
import { buildNav } from './site-shell.js';
import { readTenantWebClock, type TenantWebClock } from './variant-tenant/clock-projection.js';
import type { TenantLiveFrame } from './variant-tenant/live-client.js';
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
    players?: Array<{ color: string; name: string }>;
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

/** A recording uses the server's snapshots, including its stored ply-zero
 * opening. Never deal again: balanced openings are random and the pool changes. */
function recordingFrame(
  postgame: GomokuPostgameResponse,
): TenantLiveFrame<GomokuColor, GomokuPlayerView> {
  return {
    type: 'hello',
    seat: 'spectator',
    seats: {},
    seatDisplayNames: Object.fromEntries(
      (postgame.game.players ?? []).map((player) => [player.color, player.name]),
    ),
    state: postgame.view,
    clock: null,
    timeControl:
      postgame.state.timeControl ??
      (postgame.game.initialMs === null
        ? null
        : {
            initialMs: postgame.game.initialMs,
            incrementMs: postgame.game.incrementMs ?? 0,
          }),
    events: postgame.timeline.filter((entry) => entry.type === 'move-played' && entry.move),
    liveHistory: postgame.history.truth.map(({ ply, view }) => ({ ply, view })),
    roomMode: postgame.game.mode,
    rated: false,
  };
}

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
    const raw = new URLSearchParams(window.location.search).get('ply');
    const initialPly = raw !== null && /^\d+$/.test(raw) ? Math.min(Number(raw), lastPly) : lastPly;
    root.classList.remove('landing-page', 'game-route');
    root.replaceChildren();
    const analysis = isLikelyAdmin() ? createRecordingAnalysis(roomId, lastPly) : null;
    const recording = bootstrapGomokuRecording(
      {
        room: roomId,
        ...(root instanceof HTMLDivElement ? { root } : {}),
        frame: recordingFrame(postgame),
        initialPly,
        analysisHref: (ply) => gomokuAnalysisHref(analysisGame, ply),
        clockAt: (ply) => {
          const clock = readTenantWebClock(history[ply]?.clock, ['black', 'white'] as const);
          return clock ? { remainingMs: clock.remainingMs, active: clock.activeColor } : null;
        },
      },
      analysis?.onPosition,
    );
    const center = root.querySelector('.review-shell__center');
    if (!center) throw new Error('missing gomoku review center');
    // The live center is a horizontal flex row. Use the shared review column
    // so the underboard tools stack below the board instead of squeezing beside it.
    const column = document.createElement('div');
    column.className = 'review-center-column';
    column.append(...center.childNodes);
    center.append(column);
    if (analysis) {
      analysis.attach(recording);
      column.append(analysis.el);
      analysis.loadCached();
      window.addEventListener(
        'pagehide',
        () => {
          analysis.dispose();
          recording.dispose();
        },
        { once: true },
      );
    }
    // The server serves the export only under the flag, not to an admin on
    // prod, so the link waits for the same flag.
    if (gomokuEnabled()) {
      const downloads = document.createElement('div');
      downloads.className = 'review-underboard review-share';
      downloads.append(
        downloadRow(gameExportLinks(roomId, exportFormatsForVariant(GOMOKU_SPEC_ID))),
      );
      column.append(downloads);
    }
    track(
      'review_opened',
      reviewOpenedProps({
        pathname: window.location.pathname,
        referrer: document.referrer,
        origin: window.location.origin,
        reviewSurface: 'game',
        hasAnalysis: true,
      }),
    );
  } catch {
    message(t('replay.postgameUnavailable'), t('replay.gameCouldNotBeLoaded'));
  }
}

/** The room keeps its recorded snapshots and clocks. Both engine consumers
 * follow the room stepper; neither can place a stone in the finished game. */
function createRecordingAnalysis(roomId: string, lastPly: number) {
  const el = document.createElement('section');
  el.className = 'review-underboard';
  el.dataset.seatInkFamily = 'gomoku';
  const plot = document.createElement('div');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'xiangqi-review__analyse';
  button.dataset.gomokuAnalyse = '';
  button.textContent = t('replay.analyse');
  plot.append(button);
  let disposed = false;
  let recording: ReturnType<typeof bootstrapGomokuRecording> | null = null;
  let chart: AdvantageChart | null = null;
  let selectedPly = lastPly;
  let positionKey = '';
  let lines: CevalLine[] | null = null;
  let showIndicators = true;
  const paintMarkers = () => {
    const moves: GomokuMove[] = [];
    for (const uci of showIndicators ? (lines?.[0]?.pvUci ?? []) : []) {
      const move = parseGomokuMove(uci);
      if (!move) break;
      moves.push(move);
    }
    const markers: GomokuBoardMarker[] = moves.length
      ? [
          { kind: 'pv', moves },
          { kind: 'best', square: moves[0]!.to },
        ]
      : [];
    recording?.setMarkers(markers);
  };
  // Same Rapfi panel, switch, score/PV parser and board overlays as s-d032.
  const engine = createEnginePanel({
    variant: 'gomoku',
    onLines: (next) => {
      lines = next;
      paintMarkers();
    },
    onShowArrowsChange: (on) => {
      showIndicators = on;
      paintMarkers();
    },
  });
  el.append(engine.el, plot);
  const apply = (analysis: GameAnalysis) => {
    if (disposed || !el.isConnected) return;
    if (analysis.evals.length !== lastPly + 1 || analysis.evals.some((point, i) => point.ply !== i))
      throw new Error('analysis_incomplete');
    if (analysis.evals.every((point) => point.cp === null && point.mate === null))
      throw new Error('analysis_engine_unavailable');
    chart = createAdvantageChart(analysis.evals, {
      seatColors: { red: 'black', black: 'white' },
      winK: winPercentK(analysis.engineId),
      onJump: (ply) => recording?.jumpToPly(ply),
    });
    chart.setPly(selectedPly);
    plot.replaceChildren(chart.el);
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = t('replay.analysingWholeGame');
    try {
      apply(await requestGameAnalysis('gomoku', roomId));
    } catch (error) {
      if (disposed) return;
      button.disabled = false;
      button.textContent =
        error instanceof Error && error.message.includes('analysis_engine_unavailable')
          ? t('engine.unavailable', { error: 'Rapfi' })
          : t('replay.analysisFailed');
    }
  });
  return {
    el,
    attach(handle: ReturnType<typeof bootstrapGomokuRecording>) {
      recording = handle;
    },
    onPosition(ply: number, view: GomokuPlayerView) {
      selectedPly = ply;
      chart?.setPly(ply);
      const position = JSON.stringify({
        turn: view.status.type === 'playing' && view.status.turn === 'white' ? 2 : 1,
        stones: view.board.flatMap((color, i) =>
          color ? [{ x: i % 15, y: Math.floor(i / 15), player: color === 'black' ? 1 : 2 }] : [],
        ),
      });
      if (position === positionKey) return;
      positionKey = position;
      engine.setPosition([], position, view.status.type === 'playing');
    },
    loadCached() {
      void fetchCachedGameAnalysis('gomoku', roomId)
        .then((cached) => {
          if (cached) apply(cached);
        })
        .catch(() => {
          /* The request button remains available. */
        });
    },
    dispose() {
      disposed = true;
      engine.dispose();
    },
  };
}
