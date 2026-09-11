import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyStandardXiangqiMove,
  broadcastRecordsCredit,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
  type StandardXiangqiPlayerView,
  type XiangqiColor,
  type XiangqiMove,
} from '@mistboard/game';
import * as persistence from './../persistence.js';
import {
  pollXiangqiBroadcastSourceOnce,
  type XiangqiBroadcastPollResult,
} from './../xiangqi-broadcast-poller.js';
import { clampXiangqiBroadcastScheduleIntervalMs } from './../xiangqi-broadcast-scheduler.js';
import {
  type HttpApiContext,
  readJsonBody,
  requireAdminSession,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

type BroadcastMoveTimelineEntry = {
  type: 'move-played';
  color: XiangqiColor;
  move: XiangqiMove;
  ply: number;
};

type BroadcastHistorySnapshot = {
  ply: number;
  view: StandardXiangqiPlayerView;
};

type BroadcastStreamEnvelope<T> = {
  version: string;
  payload: T;
};

export type XiangqiBroadcastApiPersistence = {
  listXiangqiBroadcastTours(): ReturnType<typeof persistence.listXiangqiBroadcastTours>;
  getXiangqiBroadcastTour(slug: string): ReturnType<typeof persistence.getXiangqiBroadcastTour>;
  listXiangqiBroadcastRounds(
    tourSlug: string,
  ): ReturnType<typeof persistence.listXiangqiBroadcastRounds>;
  listXiangqiBroadcastBoards(
    roundId: string,
  ): ReturnType<typeof persistence.listXiangqiBroadcastBoards>;
  getXiangqiBroadcastBoard(
    boardId: string,
  ): ReturnType<typeof persistence.getXiangqiBroadcastBoard>;
  listXiangqiBroadcastSyncLogs(
    input: Parameters<typeof persistence.listXiangqiBroadcastSyncLogs>[0],
  ): ReturnType<typeof persistence.listXiangqiBroadcastSyncLogs>;
  recordXiangqiBroadcastSyncLog(
    input: Parameters<typeof persistence.recordXiangqiBroadcastSyncLog>[0],
  ): ReturnType<typeof persistence.recordXiangqiBroadcastSyncLog>;
  setXiangqiBroadcastTourSchedule(
    slug: string,
    schedule: Parameters<typeof persistence.setXiangqiBroadcastTourSchedule>[1],
  ): ReturnType<typeof persistence.setXiangqiBroadcastTourSchedule>;
};

const livePersistence: XiangqiBroadcastApiPersistence = {
  listXiangqiBroadcastTours: () => persistence.listXiangqiBroadcastTours(),
  getXiangqiBroadcastTour: (slug) => persistence.getXiangqiBroadcastTour(slug),
  listXiangqiBroadcastRounds: (tourSlug) => persistence.listXiangqiBroadcastRounds(tourSlug),
  listXiangqiBroadcastBoards: (roundId) => persistence.listXiangqiBroadcastBoards(roundId),
  getXiangqiBroadcastBoard: (boardId) => persistence.getXiangqiBroadcastBoard(boardId),
  listXiangqiBroadcastSyncLogs: (input) => persistence.listXiangqiBroadcastSyncLogs(input),
  recordXiangqiBroadcastSyncLog: (input) => persistence.recordXiangqiBroadcastSyncLog(input),
  setXiangqiBroadcastTourSchedule: (slug, schedule) =>
    persistence.setXiangqiBroadcastTourSchedule(slug, schedule),
};

type XiangqiBroadcastPollSource = typeof pollXiangqiBroadcastSourceOnce;

type ManualPollOptions = {
  allowCorrection: boolean;
  dryRun: boolean;
  timeoutMs: number;
};

type XiangqiBroadcastRoundStats = {
  boardCount: number;
  liveBoardCount: number;
  completeBoardCount: number;
  scheduledBoardCount: number;
};

type SourceHealthState = 'ok' | 'warning' | 'error' | 'unknown' | 'missing_source';

type SourceHealth = {
  state: SourceHealthState;
  label: string;
  lastKind: string | null;
  lastMessage: string | null;
  checkedAt: Date | null;
  buckets: {
    successfulPolls: number;
    fetchFailures: number;
    parseFailures: number;
    dataFailures: number;
    configFailures: number;
    operatorFailures: number;
    corrections: number;
  };
};

export async function xiangqiBroadcastIndexForApi(
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const tours = await deps.listXiangqiBroadcastTours();
  const entries = await Promise.all(
    tours.map(async (tour) => {
      const [rounds, syncLogs] = await Promise.all([
        deps.listXiangqiBroadcastRounds(tour.slug),
        deps.listXiangqiBroadcastSyncLogs({ tourSlug: tour.slug }),
      ]);
      const boardsByRound = await Promise.all(
        rounds.map((round) => deps.listXiangqiBroadcastBoards(round.id)),
      );
      const boards = boardsByRound.flat();
      return {
        tour,
        roundCount: rounds.length,
        boardCount: boards.length,
        liveBoardCount: boards.filter((board) => board.status === 'live').length,
        completeBoardCount: boards.filter((board) => board.status === 'complete').length,
        scheduledBoardCount: boards.filter((board) => board.status === 'scheduled').length,
        totalPlies: boards.reduce((sum, board) => sum + board.plyCount, 0),
        updatedAt: latestDate([
          tour.updatedAt,
          ...rounds.map((round) => round.updatedAt),
          ...boards.map((board) => board.updatedAt),
        ]),
        featuredBoard: featuredXiangqiBroadcastBoard(boards),
        lastSyncLog: syncLogs[0]
          ? {
              severity: syncLogs[0].severity,
              kind: syncLogs[0].kind,
              createdAt: syncLogs[0].createdAt,
            }
          : null,
      };
    }),
  );
  return { tours: entries };
}

// The index page shows one mini-board thumbnail per tour: the most recently
// updated live board, else the latest complete one. The final position is
// replayed server-side so the payload carries a single compact view instead of
// the board's whole move list.
function featuredXiangqiBroadcastBoard(boards: persistence.StoredXiangqiBroadcastBoard[]) {
  const live = boards.filter((board) => board.status === 'live');
  const pool = live.length > 0 ? live : boards.filter((board) => board.status === 'complete');
  if (pool.length === 0) return null;
  const pick = pool.reduce((best, board) =>
    board.updatedAt.getTime() > best.updatedAt.getTime() ? board : best,
  );
  return {
    id: pick.id,
    roundId: pick.roundId,
    boardNumber: pick.boardNumber,
    red: pick.red,
    black: pick.black,
    status: pick.status,
    result: pick.result,
    plyCount: pick.plyCount,
    updatedAt: pick.updatedAt,
    view: finalXiangqiBoardView(pick),
  };
}

// Replay a stored board to its final position. Defensive about moves past a
// terminal state so one bad row degrades to a stale thumbnail instead of a 500.
// Legal moves are dead weight on a non-interactive thumbnail, so they are
// stripped from the shipped view.
function finalXiangqiBoardView(
  board: persistence.StoredXiangqiBroadcastBoard,
): StandardXiangqiPlayerView {
  let state = createInitialXiangqiState(board.id);
  for (const move of board.moves) {
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, move);
  }
  return { ...getStandardXiangqiPlayerView(state, 'red'), legalMoves: [] };
}

function roundBoardStats(
  boards: persistence.StoredXiangqiBroadcastBoard[],
): XiangqiBroadcastRoundStats {
  return {
    boardCount: boards.length,
    liveBoardCount: boards.filter((board) => board.status === 'live').length,
    completeBoardCount: boards.filter((board) => board.status === 'complete').length,
    scheduledBoardCount: boards.filter((board) => board.status === 'scheduled').length,
  };
}

export async function xiangqiBroadcastOpsIndexForApi(
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const tours = await deps.listXiangqiBroadcastTours();
  const entries = await Promise.all(
    tours.map(async (tour) => {
      const [rounds, syncLogs] = await Promise.all([
        deps.listXiangqiBroadcastRounds(tour.slug),
        deps.listXiangqiBroadcastSyncLogs({ tourSlug: tour.slug }),
      ]);
      const boardsByRound = await Promise.all(
        rounds.map((round) => deps.listXiangqiBroadcastBoards(round.id)),
      );
      const boards = boardsByRound.flat();
      return {
        tour,
        sourceUrl: tour.sourceUrl ?? null,
        schedule: {
          pollEnabled: tour.pollEnabled,
          pollIntervalMs: tour.pollIntervalMs,
        },
        roundCount: rounds.length,
        boardCount: boards.length,
        liveBoardCount: boards.filter((board) => board.status === 'live').length,
        completeBoardCount: boards.filter((board) => board.status === 'complete').length,
        scheduledBoardCount: boards.filter((board) => board.status === 'scheduled').length,
        totalPlies: boards.reduce((sum, board) => sum + board.plyCount, 0),
        updatedAt: latestDate([
          tour.updatedAt,
          ...rounds.map((round) => round.updatedAt),
          ...boards.map((board) => board.updatedAt),
        ]),
        sourceHealth: sourceHealthFromLogs(tour.sourceUrl ?? null, syncLogs),
        syncLogs: syncLogs.slice(0, 8).map((log) => ({
          id: log.id,
          tourSlug: log.tourSlug,
          roundId: log.roundId,
          boardId: log.boardId,
          sourceBoardId: log.sourceBoardId,
          severity: log.severity,
          kind: log.kind,
          message: log.message,
          createdAt: log.createdAt,
        })),
      };
    }),
  );
  return { tours: entries };
}

export async function manualXiangqiBroadcastPollForApi(
  tourSlug: string,
  options: ManualPollOptions,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
  pollSource: XiangqiBroadcastPollSource = pollXiangqiBroadcastSourceOnce,
): Promise<
  | { ok: true; result: Extract<XiangqiBroadcastPollResult, { ok: true }> }
  | { ok: false; status: 400 | 404 | 502; error: string; result?: XiangqiBroadcastPollResult }
> {
  const tour = await deps.getXiangqiBroadcastTour(tourSlug);
  if (!tour) return { ok: false, status: 404, error: 'broadcast_not_found' };
  if (!tour.sourceUrl) return { ok: false, status: 400, error: 'missing_source_url' };

  const result = await pollSource({
    sourceUrl: tour.sourceUrl,
    allowCorrection: options.allowCorrection,
    dryRun: options.dryRun,
    timeoutMs: options.timeoutMs,
  });
  if (!result.ok) {
    if (!options.dryRun) {
      await deps.recordXiangqiBroadcastSyncLog({
        tourSlug: tour.slug,
        severity: 'error',
        kind: 'manual_poll_failed',
        message: result.message,
        payload: {
          sourceUrl: result.sourceUrl,
          errorKind: result.kind,
          allowCorrection: options.allowCorrection,
        },
      });
    }
    return {
      ok: false,
      status: result.kind === 'source_disallowed' ? 400 : 502,
      error: result.kind,
      result,
    };
  }

  if (!options.dryRun) {
    await deps.recordXiangqiBroadcastSyncLog({
      tourSlug: result.tourSlug,
      severity: result.boardsFailed > 0 || result.sourcesFailed > 0 ? 'warning' : 'info',
      kind: 'manual_poll_ok',
      message: 'manual source poll completed',
      payload: {
        sourceUrl: result.sourceUrl,
        roundsImported: result.roundsImported,
        boardsSeen: result.boardsSeen,
        boardsFailed: result.boardsFailed,
        sourcesSeen: result.sourcesSeen,
        sourcesFailed: result.sourcesFailed,
        allowCorrection: options.allowCorrection,
      },
    });
  }
  return { ok: true, result };
}

export async function manualXiangqiBroadcastSourceImportForApi(
  sourceUrl: unknown,
  options: ManualPollOptions,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
  pollSource: XiangqiBroadcastPollSource = pollXiangqiBroadcastSourceOnce,
): Promise<
  | { ok: true; result: Extract<XiangqiBroadcastPollResult, { ok: true }> }
  | { ok: false; status: 400 | 502; error: string; result?: XiangqiBroadcastPollResult }
> {
  if (typeof sourceUrl !== 'string' || sourceUrl.length === 0 || sourceUrl.length > 2048) {
    return { ok: false, status: 400, error: 'invalid_source_url' };
  }

  const result = await pollSource({
    sourceUrl,
    allowCorrection: options.allowCorrection,
    dryRun: options.dryRun,
    timeoutMs: options.timeoutMs,
  });
  if (!result.ok) {
    if (!options.dryRun) {
      await deps.recordXiangqiBroadcastSyncLog({
        severity: 'error',
        kind: 'manual_poll_failed',
        message: result.message,
        payload: {
          sourceUrl: result.sourceUrl,
          errorKind: result.kind,
          allowCorrection: options.allowCorrection,
          via: 'source_import',
        },
      });
    }
    return {
      ok: false,
      status: result.kind === 'source_disallowed' ? 400 : 502,
      error: result.kind,
      result,
    };
  }

  if (!options.dryRun) {
    await deps.recordXiangqiBroadcastSyncLog({
      tourSlug: result.tourSlug,
      severity: result.boardsFailed > 0 || result.sourcesFailed > 0 ? 'warning' : 'info',
      kind: 'manual_poll_ok',
      message: 'manual source import completed',
      payload: {
        sourceUrl: result.sourceUrl,
        roundsImported: result.roundsImported,
        boardsSeen: result.boardsSeen,
        boardsFailed: result.boardsFailed,
        sourcesSeen: result.sourcesSeen,
        sourcesFailed: result.sourcesFailed,
        allowCorrection: options.allowCorrection,
        via: 'source_import',
      },
    });
  }
  return { ok: true, result };
}

export async function xiangqiBroadcastScheduleUpdateForApi(
  tourSlug: string,
  body: Record<string, unknown>,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
): Promise<
  | { ok: true; schedule: { pollEnabled: boolean; pollIntervalMs: number } }
  | { ok: false; status: 400 | 404; error: string }
> {
  if (typeof body.enabled !== 'boolean') {
    return { ok: false, status: 400, error: 'invalid_schedule' };
  }
  if (body.intervalMs !== undefined && !Number.isInteger(body.intervalMs)) {
    return { ok: false, status: 400, error: 'invalid_schedule' };
  }
  const tour = await deps.getXiangqiBroadcastTour(tourSlug);
  if (!tour) return { ok: false, status: 404, error: 'broadcast_not_found' };
  if (body.enabled && !tour.sourceUrl) {
    return { ok: false, status: 400, error: 'missing_source_url' };
  }

  const updated = await deps.setXiangqiBroadcastTourSchedule(tourSlug, {
    pollEnabled: body.enabled,
    pollIntervalMs: clampXiangqiBroadcastScheduleIntervalMs(
      body.intervalMs !== undefined ? body.intervalMs : tour.pollIntervalMs,
    ),
  });
  if (!updated) return { ok: false, status: 404, error: 'broadcast_not_found' };
  return {
    ok: true,
    schedule: { pollEnabled: updated.pollEnabled, pollIntervalMs: updated.pollIntervalMs },
  };
}

export async function xiangqiBroadcastTourForApi(
  tourSlug: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const [tour, rounds] = await Promise.all([
    deps.getXiangqiBroadcastTour(tourSlug),
    deps.listXiangqiBroadcastRounds(tourSlug),
  ]);
  if (!tour) return null;
  // Per-round board counts drive the status icons on the tour page rows.
  const boardsByRound = await Promise.all(
    rounds.map((round) => deps.listXiangqiBroadcastBoards(round.id)),
  );
  return {
    tour,
    // Who to credit for the records, derived from the boards we already loaded
    // for the counts. The tour payload carries no boards, so the client cannot
    // work this out for itself -- which is why the tour PAGE credited nobody
    // while every round page did, on a tour whose 61 games all came from one
    // volunteer archive. It is also the page an outside link points at.
    recordsSource: broadcastRecordsCredit(boardsByRound.flat()),
    rounds: rounds.map((round, index) => ({
      ...round,
      ...roundBoardStats(boardsByRound[index] ?? []),
    })),
  };
}

export async function xiangqiBroadcastRoundForApi(
  tourSlug: string,
  roundId: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const [tour, rounds, boards] = await Promise.all([
    deps.getXiangqiBroadcastTour(tourSlug),
    deps.listXiangqiBroadcastRounds(tourSlug),
    deps.listXiangqiBroadcastBoards(roundId),
  ]);
  if (!tour) return null;
  const round = rounds.find((entry) => entry.id === roundId);
  if (!round) return null;
  // Sibling rounds with stats power the round switcher on the round and board
  // pages. The current round reuses the boards already fetched above; the SSE
  // poller shares this path, so the extra queries scale with round count.
  const boardsByRound = await Promise.all(
    rounds.map((entry) =>
      entry.id === roundId ? Promise.resolve(boards) : deps.listXiangqiBroadcastBoards(entry.id),
    ),
  );
  return {
    tour,
    round,
    boards,
    rounds: rounds.map((entry, index) => ({
      ...entry,
      ...roundBoardStats(boardsByRound[index] ?? []),
    })),
  };
}

export async function xiangqiBroadcastRoundStreamForApi(
  tourSlug: string,
  roundId: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const payload = await xiangqiBroadcastRoundForApi(tourSlug, roundId, deps);
  if (!payload) return null;
  return {
    version: versionKey([
      payload.tour.updatedAt,
      payload.round.updatedAt,
      ...payload.boards.map((board) =>
        versionKey([board.id, board.updatedAt, board.plyCount, board.status, board.result]),
      ),
    ]),
    payload,
  };
}

export async function xiangqiBroadcastBoardForApi(
  boardId: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const board = await deps.getXiangqiBroadcastBoard(boardId);
  if (!board) return null;
  return buildXiangqiBroadcastBoardReplay(board);
}

export async function xiangqiBroadcastBoardStreamForApi(
  boardId: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const payload = await xiangqiBroadcastBoardForApi(boardId, deps);
  if (!payload) return null;
  return {
    version: versionKey([
      payload.board.id,
      payload.board.updatedAt,
      payload.board.plyCount,
      payload.board.status,
      payload.board.result,
      payload.state.status.type,
    ]),
    payload,
  };
}

export async function xiangqiBroadcastBoardExportForApi(
  boardId: string,
  deps: XiangqiBroadcastApiPersistence = livePersistence,
) {
  const board = await deps.getXiangqiBroadcastBoard(boardId);
  if (!board) return null;
  return {
    schema: board.schema,
    id: board.id,
    tourSlug: board.tourSlug,
    roundId: board.roundId,
    sourceBoardId: board.sourceBoardId,
    boardNumber: board.boardNumber,
    red: board.red,
    black: board.black,
    status: board.status,
    result: board.result,
    moves: board.moves,
    ...(board.sourceUrl ? { sourceUrl: board.sourceUrl } : {}),
  };
}

function buildXiangqiBroadcastBoardReplay(board: persistence.StoredXiangqiBroadcastBoard) {
  let state = createInitialXiangqiState(board.id);
  const timeline: BroadcastMoveTimelineEntry[] = [];
  const truth: BroadcastHistorySnapshot[] = [
    { ply: 0, view: getStandardXiangqiPlayerView(state, 'red') },
  ];

  for (const [index, move] of board.moves.entries()) {
    if (state.status.type !== 'playing') {
      throw new Error(`stored broadcast board ${board.id} has moves after terminal state`);
    }
    const color = state.status.turn;
    state = applyStandardXiangqiMove(state, move);
    const ply = index + 1;
    timeline.push({ type: 'move-played', color, move, ply });
    truth.push({ ply, view: getStandardXiangqiPlayerView(state, 'red') });
  }

  return {
    board: {
      id: board.id,
      tourSlug: board.tourSlug,
      roundId: board.roundId,
      sourceBoardId: board.sourceBoardId,
      boardNumber: board.boardNumber,
      red: board.red,
      black: board.black,
      status: board.status,
      result: board.result,
      plyCount: board.plyCount,
      finalStatus: board.finalStatus,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      ...(board.sourceUrl ? { sourceUrl: board.sourceUrl } : {}),
    },
    state: {
      status: state.status,
      moveNumber: state.moveNumber,
    },
    timeline,
    view: getStandardXiangqiPlayerView(state, 'red'),
    views: {
      truth: getStandardXiangqiPlayerView(state, 'red'),
    },
    history: { truth },
  };
}

function latestDate(values: Date[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!latest || value.getTime() > latest.getTime()) latest = value;
  }
  return latest;
}

function sourceHealthFromLogs(
  sourceUrl: string | null,
  logs: Awaited<ReturnType<typeof persistence.listXiangqiBroadcastSyncLogs>>,
): SourceHealth {
  const buckets = {
    successfulPolls: 0,
    fetchFailures: 0,
    parseFailures: 0,
    dataFailures: 0,
    configFailures: 0,
    operatorFailures: 0,
    corrections: 0,
  };

  for (const log of logs) {
    if (log.kind === 'manual_poll_ok' || log.kind === 'poll_ok') buckets.successfulPolls += 1;
    if (
      log.kind === 'source_http_error' ||
      log.kind === 'source_fetch_error' ||
      log.kind === 'source_timeout'
    ) {
      buckets.fetchFailures += 1;
    }
    if (log.kind === 'source_malformed' || log.kind === 'source_frames_skipped') {
      buckets.parseFailures += 1;
    }
    if (log.kind === 'illegal_move' || log.kind === 'incompatible_update') {
      buckets.dataFailures += 1;
    }
    if (log.kind === 'source_disallowed') buckets.configFailures += 1;
    if (log.kind === 'manual_poll_failed') buckets.operatorFailures += 1;
    if (log.kind === 'corrected') buckets.corrections += 1;
  }

  if (!sourceUrl) {
    return {
      state: 'missing_source',
      label: 'No source configured',
      lastKind: null,
      lastMessage: null,
      checkedAt: null,
      buckets,
    };
  }

  const latest = logs[0] ?? null;
  if (!latest) {
    return {
      state: 'unknown',
      label: 'No source checks yet',
      lastKind: null,
      lastMessage: null,
      checkedAt: null,
      buckets,
    };
  }

  const state: SourceHealthState =
    latest.severity === 'error' ? 'error' : latest.severity === 'warning' ? 'warning' : 'ok';
  return {
    state,
    label:
      state === 'error'
        ? 'Source needs attention'
        : state === 'warning'
          ? 'Source has warnings'
          : 'Source healthy',
    lastKind: latest.kind,
    lastMessage: latest.message,
    checkedAt: latest.createdAt,
    buckets,
  };
}

function versionKey(values: Array<Date | string | number | null | undefined>): string {
  return values
    .map((value) => {
      if (value instanceof Date) return value.toISOString();
      return value ?? '';
    })
    .join('|');
}

function parseEventPollMs(parsedUrl: URL): number {
  const raw = parsedUrl.searchParams.get('pollMs');
  if (!raw) return 1_500;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1_500;
  return Math.min(Math.max(parsed, 250), 30_000);
}

function parseManualPollOptions(body: Record<string, unknown>): ManualPollOptions {
  const rawTimeoutMs = body.timeoutMs;
  const timeoutMs =
    typeof rawTimeoutMs === 'number' && Number.isInteger(rawTimeoutMs)
      ? Math.min(Math.max(rawTimeoutMs, 250), 30_000)
      : 5_000;
  return {
    allowCorrection: body.allowCorrection === true,
    dryRun: body.dryRun === true,
    timeoutMs,
  };
}

function writeSseEvent<T>(
  response: ServerResponse,
  event: string,
  envelope: BroadcastStreamEnvelope<T>,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(envelope)}\n\n`);
}

function streamSnapshotEvents<T>(
  request: IncomingMessage,
  response: ServerResponse,
  input: {
    event: string;
    pollMs: number;
    initial: BroadcastStreamEnvelope<T>;
    load(): Promise<BroadcastStreamEnvelope<T> | null>;
  },
): void {
  let closed = false;
  let polling = false;
  let lastVersion = input.initial.version;

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.flushHeaders?.();
  writeSseEvent(response, input.event, input.initial);

  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      const next = await input.load();
      if (next && next.version !== lastVersion) {
        lastVersion = next.version;
        writeSseEvent(response, input.event, next);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.write(`event: stream-error\n`);
      response.write(`data: ${JSON.stringify({ message })}\n\n`);
    } finally {
      polling = false;
    }
  };

  const interval = setInterval(() => {
    void poll();
  }, input.pollMs);
  interval.unref?.();

  const close = () => {
    closed = true;
    clearInterval(interval);
  };
  request.on('close', close);
  response.on('close', close);
}

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/admin/xiangqi/broadcasts') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await xiangqiBroadcastOpsIndexForApi());
    return true;
  }

  if (pathname === '/api/admin/xiangqi/broadcasts/import') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const body = await readJsonBody(request);
    const result = await manualXiangqiBroadcastSourceImportForApi(
      body.sourceUrl,
      parseManualPollOptions(body),
    );
    if (!result.ok) {
      writeJson(response, result.status, {
        error: result.error,
        ...(result.result ? { result: result.result } : {}),
      });
      return true;
    }
    writeJson(response, 200, { result: result.result });
    return true;
  }

  const adminDeleteMatch = pathname.match(/^\/api\/admin\/xiangqi\/broadcasts\/([^/]+)$/);
  if (adminDeleteMatch && request.method === 'DELETE') {
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const slug = decodeURIComponent(adminDeleteMatch[1]!);
    const deleted = await persistence.deleteXiangqiBroadcastTour(slug);
    if (!deleted) {
      writeJson(response, 404, { error: 'tour_not_found' });
      return true;
    }
    writeJson(response, 200, { deleted: true, slug });
    return true;
  }

  const adminScheduleMatch = pathname.match(
    /^\/api\/admin\/xiangqi\/broadcasts\/([^/]+)\/schedule$/,
  );
  if (adminScheduleMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const body = await readJsonBody(request);
    const result = await xiangqiBroadcastScheduleUpdateForApi(
      decodeURIComponent(adminScheduleMatch[1]!),
      body,
    );
    if (!result.ok) {
      writeJson(response, result.status, { error: result.error });
      return true;
    }
    writeJson(response, 200, { schedule: result.schedule });
    return true;
  }

  const adminPollMatch = pathname.match(/^\/api\/admin\/xiangqi\/broadcasts\/([^/]+)\/poll$/);
  if (adminPollMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const body = await readJsonBody(request);
    const result = await manualXiangqiBroadcastPollForApi(
      decodeURIComponent(adminPollMatch[1]!),
      parseManualPollOptions(body),
    );
    if (!result.ok) {
      writeJson(response, result.status, {
        error: result.error,
        ...(result.result ? { result: result.result } : {}),
      });
      return true;
    }
    writeJson(response, 200, { result: result.result });
    return true;
  }

  const boardEventsMatch = pathname.match(/^\/api\/xiangqi\/broadcasts\/boards\/([^/]+)\/events$/);
  if (boardEventsMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const boardId = decodeURIComponent(boardEventsMatch[1]!);
    const initial = await xiangqiBroadcastBoardStreamForApi(boardId);
    if (!initial) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    streamSnapshotEvents(request, response, {
      event: 'board',
      pollMs: parseEventPollMs(_parsedUrl),
      initial,
      load: () => xiangqiBroadcastBoardStreamForApi(boardId),
    });
    return true;
  }

  const boardExportMatch = pathname.match(/^\/api\/xiangqi\/broadcasts\/boards\/([^/]+)\/export$/);
  if (boardExportMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const payload = await xiangqiBroadcastBoardExportForApi(
      decodeURIComponent(boardExportMatch[1]!),
    );
    if (!payload) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, payload);
    return true;
  }

  const boardMatch = pathname.match(/^\/api\/xiangqi\/broadcasts\/boards\/([^/]+)$/);
  if (boardMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const payload = await xiangqiBroadcastBoardForApi(decodeURIComponent(boardMatch[1]!));
    if (!payload) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, payload);
    return true;
  }

  const roundEventsMatch = pathname.match(
    /^\/api\/xiangqi\/broadcasts\/([^/]+)\/rounds\/([^/]+)\/events$/,
  );
  if (roundEventsMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const tourSlug = decodeURIComponent(roundEventsMatch[1]!);
    const roundId = decodeURIComponent(roundEventsMatch[2]!);
    const initial = await xiangqiBroadcastRoundStreamForApi(tourSlug, roundId);
    if (!initial) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    streamSnapshotEvents(request, response, {
      event: 'round',
      pollMs: parseEventPollMs(_parsedUrl),
      initial,
      load: () => xiangqiBroadcastRoundStreamForApi(tourSlug, roundId),
    });
    return true;
  }

  const roundMatch = pathname.match(/^\/api\/xiangqi\/broadcasts\/([^/]+)\/rounds\/([^/]+)$/);
  if (roundMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const payload = await xiangqiBroadcastRoundForApi(
      decodeURIComponent(roundMatch[1]!),
      decodeURIComponent(roundMatch[2]!),
    );
    if (!payload) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, payload);
    return true;
  }

  if (pathname === '/api/xiangqi/broadcasts') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await xiangqiBroadcastIndexForApi());
    return true;
  }

  const tourMatch = pathname.match(/^\/api\/xiangqi\/broadcasts\/([^/]+)$/);
  if (!tourMatch) return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;
  const payload = await xiangqiBroadcastTourForApi(decodeURIComponent(tourMatch[1]!));
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}
