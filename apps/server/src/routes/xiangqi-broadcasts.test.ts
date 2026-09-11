import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  replayXiangqiBroadcastBoard,
  type XiangqiBroadcastBoard,
  type XiangqiBroadcastRound,
  type XiangqiBroadcastTour,
} from '@mistboard/game';
import type { StoredXiangqiBroadcastBoard } from '../persistence.js';
import {
  manualXiangqiBroadcastPollForApi,
  manualXiangqiBroadcastSourceImportForApi,
  tryHandle,
  type XiangqiBroadcastApiPersistence,
  xiangqiBroadcastBoardExportForApi,
  xiangqiBroadcastBoardForApi,
  xiangqiBroadcastBoardStreamForApi,
  xiangqiBroadcastIndexForApi,
  xiangqiBroadcastOpsIndexForApi,
  xiangqiBroadcastRoundForApi,
  xiangqiBroadcastRoundStreamForApi,
  xiangqiBroadcastScheduleUpdateForApi,
  xiangqiBroadcastTourForApi,
} from './xiangqi-broadcasts.js';

const FIXTURE_DIR = new URL(
  '../../../../packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample/',
  import.meta.url,
);

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, FIXTURE_DIR)), 'utf-8')) as T;
}

const tour = readJson<XiangqiBroadcastTour>('tour.json');
const rounds = readJson<XiangqiBroadcastRound[]>('rounds.json');
const board = readJson<XiangqiBroadcastBoard[]>('boards.json')[0]!;
const replay = replayXiangqiBroadcastBoard(board);
assert.equal(replay.ok, true);
if (!replay.ok) throw new Error('fixture replay failed');

const storedBoard: StoredXiangqiBroadcastBoard = {
  ...board,
  plyCount: replay.plies,
  finalStatus: replay.finalStatus,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const storedTour = {
  ...tour,
  pollEnabled: false,
  pollIntervalMs: 30_000,
  createdAt: new Date(0),
  updatedAt: new Date(1_000),
};

function deps(
  overrides: Partial<XiangqiBroadcastApiPersistence> = {},
): XiangqiBroadcastApiPersistence {
  return {
    listXiangqiBroadcastTours: async () => [storedTour],
    getXiangqiBroadcastTour: async (slug) => (slug === tour.slug ? storedTour : null),
    listXiangqiBroadcastRounds: async (tourSlug) =>
      tourSlug === tour.slug
        ? rounds.map((round) => ({ ...round, createdAt: new Date(0), updatedAt: new Date(2_000) }))
        : [],
    listXiangqiBroadcastBoards: async (roundId) => (roundId === board.roundId ? [storedBoard] : []),
    getXiangqiBroadcastBoard: async (boardId) => (boardId === board.id ? storedBoard : null),
    listXiangqiBroadcastSyncLogs: async (input) =>
      input.tourSlug === tour.slug
        ? [
            {
              id: 1,
              tourSlug: tour.slug,
              roundId: null,
              boardId: null,
              sourceBoardId: null,
              severity: 'info',
              kind: 'poll_ok',
              message: 'source snapshot imported',
              payload: {},
              createdAt: new Date(3_000),
            },
          ]
        : [],
    recordXiangqiBroadcastSyncLog: async () => {},
    setXiangqiBroadcastTourSchedule: async (slug, schedule) =>
      slug === tour.slug
        ? {
            slug,
            sourceUrl: tour.sourceUrl ?? null,
            pollEnabled: schedule.pollEnabled,
            pollIntervalMs: schedule.pollIntervalMs,
          }
        : null,
    ...overrides,
  };
}

test('broadcast index API summarizes tournaments and sync status', async () => {
  const payload = await xiangqiBroadcastIndexForApi(deps());

  assert.equal(payload.tours.length, 1);
  const entry = payload.tours[0]!;
  assert.equal(entry.tour.slug, tour.slug);
  assert.equal(entry.roundCount, 1);
  assert.equal(entry.boardCount, 1);
  assert.equal(entry.liveBoardCount, 0);
  assert.equal(entry.completeBoardCount, 1);
  assert.equal(entry.scheduledBoardCount, 0);
  assert.equal(entry.totalPlies, board.moves.length);
  assert.deepEqual(entry.updatedAt, new Date(2_000));
  assert.equal(entry.lastSyncLog?.kind, 'poll_ok');
  assert.equal(Object.hasOwn(entry.lastSyncLog ?? {}, 'payload'), false);
  assert.equal(Object.hasOwn(entry.lastSyncLog ?? {}, 'message'), false);
});

test('broadcast ops API exposes source and operator sync log detail', async () => {
  const payload = await xiangqiBroadcastOpsIndexForApi(deps());

  assert.equal(payload.tours.length, 1);
  const entry = payload.tours[0]!;
  assert.equal(entry.tour.slug, tour.slug);
  assert.equal(entry.sourceUrl, tour.sourceUrl ?? null);
  assert.equal(entry.boardCount, 1);
  assert.equal(entry.sourceHealth.state, 'ok');
  assert.equal(entry.sourceHealth.lastKind, 'poll_ok');
  assert.equal(entry.sourceHealth.buckets.successfulPolls, 1);
  assert.equal(entry.syncLogs.length, 1);
  assert.equal(entry.syncLogs[0]?.kind, 'poll_ok');
  assert.equal(entry.syncLogs[0]?.message, 'source snapshot imported');
  assert.equal(Object.hasOwn(entry.syncLogs[0] ?? {}, 'payload'), false);
});

test('broadcast ops API derives source health buckets from sync logs', async () => {
  const payload = await xiangqiBroadcastOpsIndexForApi(
    deps({
      listXiangqiBroadcastSyncLogs: async () => [
        {
          id: 7,
          tourSlug: tour.slug,
          roundId: null,
          boardId: null,
          sourceBoardId: null,
          severity: 'error',
          kind: 'source_timeout',
          message: 'source timed out after 1000ms',
          payload: { sourceUrl: tour.sourceUrl },
          createdAt: new Date(7_000),
        },
        {
          id: 6,
          tourSlug: tour.slug,
          roundId: null,
          boardId: null,
          sourceBoardId: null,
          severity: 'error',
          kind: 'source_malformed',
          message: 'source.boards must be an array',
          payload: {},
          createdAt: new Date(6_000),
        },
        {
          id: 5,
          tourSlug: tour.slug,
          roundId: null,
          boardId: board.id,
          sourceBoardId: board.sourceBoardId ?? null,
          severity: 'error',
          kind: 'illegal_move',
          message: 'illegal move in source board',
          payload: {},
          createdAt: new Date(5_000),
        },
        {
          id: 4,
          tourSlug: tour.slug,
          roundId: null,
          boardId: null,
          sourceBoardId: null,
          severity: 'error',
          kind: 'source_disallowed',
          message: 'source URL host is not allowed',
          payload: {},
          createdAt: new Date(4_000),
        },
        {
          id: 3,
          tourSlug: tour.slug,
          roundId: null,
          boardId: null,
          sourceBoardId: null,
          severity: 'error',
          kind: 'manual_poll_failed',
          message: 'source answered HTTP 500',
          payload: {},
          createdAt: new Date(3_000),
        },
        {
          id: 2,
          tourSlug: tour.slug,
          roundId: null,
          boardId: board.id,
          sourceBoardId: board.sourceBoardId ?? null,
          severity: 'info',
          kind: 'corrected',
          message: 'source correction applied',
          payload: {},
          createdAt: new Date(2_000),
        },
        {
          id: 1,
          tourSlug: tour.slug,
          roundId: null,
          boardId: null,
          sourceBoardId: null,
          severity: 'info',
          kind: 'manual_poll_ok',
          message: 'manual source poll completed',
          payload: {},
          createdAt: new Date(1_000),
        },
      ],
    }),
  );

  const health = payload.tours[0]?.sourceHealth;
  assert.equal(health?.state, 'error');
  assert.equal(health?.label, 'Source needs attention');
  assert.equal(health?.lastKind, 'source_timeout');
  assert.equal(health?.lastMessage, 'source timed out after 1000ms');
  assert.deepEqual(health?.checkedAt, new Date(7_000));
  assert.deepEqual(health?.buckets, {
    successfulPolls: 1,
    fetchFailures: 1,
    parseFailures: 1,
    dataFailures: 1,
    configFailures: 1,
    operatorFailures: 1,
    corrections: 1,
  });
  assert.equal(Object.hasOwn(payload.tours[0]?.syncLogs[0] ?? {}, 'payload'), false);
});

test('manual broadcast poll uses configured tour source and records operator result', async () => {
  const recorded: unknown[] = [];
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: true, dryRun: false, timeoutMs: 750 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: true,
      sourceUrl: input.sourceUrl,
      dryRun: false,
      tourSlug: tour.slug,
      roundsImported: 1,
      boardsSeen: 3,
      boardsFailed: 1,
      sourcesSeen: 1,
      sourcesFailed: 0,
      updates: [],
      sources: [],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.result.sourceUrl : '', tour.sourceUrl);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    tourSlug: tour.slug,
    severity: 'warning',
    kind: 'manual_poll_ok',
    message: 'manual source poll completed',
    payload: {
      sourceUrl: tour.sourceUrl,
      roundsImported: 1,
      boardsSeen: 3,
      boardsFailed: 1,
      sourcesSeen: 1,
      sourcesFailed: 0,
      allowCorrection: true,
    },
  });
});

test('manual broadcast poll dry run previews without recording sync logs', async () => {
  const recorded: unknown[] = [];
  const pollInputs: Array<{ dryRun?: boolean }> = [];
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: false, dryRun: true, timeoutMs: 750 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => {
      pollInputs.push({ dryRun: input.dryRun });
      return {
        ok: true,
        sourceUrl: input.sourceUrl,
        dryRun: true,
        tourSlug: tour.slug,
        roundsImported: 1,
        boardsSeen: 3,
        boardsFailed: 0,
        sourcesSeen: 1,
        sourcesFailed: 0,
        updates: [],
        sources: [],
      };
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.result.dryRun : false, true);
  assert.deepEqual(pollInputs, [{ dryRun: true }]);
  assert.deepEqual(recorded, []);
});

test('manual broadcast poll dry run failure skips the operator failure log', async () => {
  const recorded: unknown[] = [];
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: false, dryRun: true, timeoutMs: 750 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: false,
      sourceUrl: input.sourceUrl,
      dryRun: true,
      kind: 'source_http_error',
      message: 'source answered HTTP 500',
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok ? 0 : result.status, 502);
  assert.deepEqual(recorded, []);
});

test('manual broadcast poll reports missing source before polling', async () => {
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: false, dryRun: false, timeoutMs: 5_000 },
    deps({
      getXiangqiBroadcastTour: async (slug) =>
        slug === tour.slug ? { ...storedTour, sourceUrl: undefined } : null,
    }),
    async () => {
      throw new Error('poller should not run');
    },
  );

  assert.deepEqual(result, { ok: false, status: 400, error: 'missing_source_url' });
});

test('manual broadcast poll records tour-scoped source failures', async () => {
  const recorded: unknown[] = [];
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: false, dryRun: false, timeoutMs: 1_000 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: false,
      sourceUrl: input.sourceUrl,
      dryRun: false,
      kind: 'source_http_error',
      message: 'source answered HTTP 500',
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.status, 502);
  assert.deepEqual(recorded, [
    {
      tourSlug: tour.slug,
      severity: 'error',
      kind: 'manual_poll_failed',
      message: 'source answered HTTP 500',
      payload: {
        sourceUrl: tour.sourceUrl,
        errorKind: 'source_http_error',
        allowCorrection: false,
      },
    },
  ]);
});

test('manual broadcast poll reports disallowed source as a configuration error', async () => {
  const recorded: unknown[] = [];
  const result = await manualXiangqiBroadcastPollForApi(
    tour.slug,
    { allowCorrection: false, dryRun: false, timeoutMs: 1_000 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: false,
      sourceUrl: input.sourceUrl,
      dryRun: false,
      kind: 'source_disallowed',
      message: 'source URL host is not allowed',
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.status, 400);
  assert.equal(result.ok ? '' : result.error, 'source_disallowed');
  assert.deepEqual(recorded, [
    {
      tourSlug: tour.slug,
      severity: 'error',
      kind: 'manual_poll_failed',
      message: 'source URL host is not allowed',
      payload: {
        sourceUrl: tour.sourceUrl,
        errorKind: 'source_disallowed',
        allowCorrection: false,
      },
    },
  ]);
});

test('manual source import polls an arbitrary URL and records the result', async () => {
  const recorded: unknown[] = [];
  const result = await manualXiangqiBroadcastSourceImportForApi(
    'https://fixture.invalid/new-event.html',
    { allowCorrection: false, dryRun: false, timeoutMs: 5_000 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: true,
      sourceUrl: input.sourceUrl,
      dryRun: false,
      tourSlug: 'new-event',
      roundsImported: 2,
      boardsSeen: 4,
      boardsFailed: 0,
      sourcesSeen: 2,
      sourcesFailed: 0,
      updates: [],
      sources: [],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.result.tourSlug : '', 'new-event');
  assert.equal(recorded.length, 1);
  assert.equal((recorded[0] as { kind: string }).kind, 'manual_poll_ok');
  assert.equal((recorded[0] as { tourSlug: string }).tourSlug, 'new-event');
});

test('manual source import dry run records nothing and rejects bad URLs', async () => {
  const recorded: unknown[] = [];
  const dry = await manualXiangqiBroadcastSourceImportForApi(
    'https://fixture.invalid/new-event.html',
    { allowCorrection: false, dryRun: true, timeoutMs: 5_000 },
    deps({
      recordXiangqiBroadcastSyncLog: async (input) => {
        recorded.push(input);
      },
    }),
    async (input) => ({
      ok: true,
      sourceUrl: input.sourceUrl,
      dryRun: true,
      tourSlug: 'new-event',
      roundsImported: 1,
      boardsSeen: 2,
      boardsFailed: 0,
      sourcesSeen: 1,
      sourcesFailed: 0,
      updates: [],
      sources: [],
    }),
  );
  assert.equal(dry.ok, true);
  assert.deepEqual(recorded, []);

  const missing = await manualXiangqiBroadcastSourceImportForApi(
    undefined,
    { allowCorrection: false, dryRun: false, timeoutMs: 5_000 },
    deps(),
    async () => {
      throw new Error('poller should not run');
    },
  );
  assert.deepEqual(missing, { ok: false, status: 400, error: 'invalid_source_url' });

  const oversized = await manualXiangqiBroadcastSourceImportForApi(
    `https://fixture.invalid/${'x'.repeat(2048)}`,
    { allowCorrection: false, dryRun: false, timeoutMs: 5_000 },
    deps(),
    async () => {
      throw new Error('poller should not run');
    },
  );
  assert.deepEqual(oversized, { ok: false, status: 400, error: 'invalid_source_url' });
});

test('schedule update validates input and persists the clamped schedule', async () => {
  const saved: unknown[] = [];
  const result = await xiangqiBroadcastScheduleUpdateForApi(
    tour.slug,
    { enabled: true, intervalMs: 1_000 },
    deps({
      setXiangqiBroadcastTourSchedule: async (slug, schedule) => {
        saved.push({ slug, ...schedule });
        return {
          slug,
          sourceUrl: tour.sourceUrl ?? null,
          pollEnabled: schedule.pollEnabled,
          pollIntervalMs: schedule.pollIntervalMs,
        };
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    schedule: { pollEnabled: true, pollIntervalMs: 5_000 },
  });
  assert.deepEqual(saved, [{ slug: tour.slug, pollEnabled: true, pollIntervalMs: 5_000 }]);

  const badBody = await xiangqiBroadcastScheduleUpdateForApi(tour.slug, { enabled: 'yes' }, deps());
  assert.deepEqual(badBody, { ok: false, status: 400, error: 'invalid_schedule' });

  const badInterval = await xiangqiBroadcastScheduleUpdateForApi(
    tour.slug,
    { enabled: true, intervalMs: 'fast' },
    deps(),
  );
  assert.deepEqual(badInterval, { ok: false, status: 400, error: 'invalid_schedule' });

  const unknownTour = await xiangqiBroadcastScheduleUpdateForApi(
    'missing-tour',
    { enabled: false },
    deps(),
  );
  assert.deepEqual(unknownTour, { ok: false, status: 404, error: 'broadcast_not_found' });

  const noSource = await xiangqiBroadcastScheduleUpdateForApi(
    tour.slug,
    { enabled: true },
    deps({
      getXiangqiBroadcastTour: async (slug) =>
        slug === tour.slug ? { ...storedTour, sourceUrl: undefined } : null,
    }),
  );
  assert.deepEqual(noSource, { ok: false, status: 400, error: 'missing_source_url' });
});

test('broadcast index API features the latest live board, else the latest complete one', async () => {
  // Fixture has a single complete board: it is the featured pick, shipped as a
  // final position with no move list and no legal moves.
  const completeOnly = await xiangqiBroadcastIndexForApi(deps());
  const featured = completeOnly.tours[0]?.featuredBoard;
  assert.ok(featured);
  assert.equal(featured.id, board.id);
  assert.equal(featured.status, 'complete');
  assert.equal(Object.hasOwn(featured, 'moves'), false);
  assert.ok(Object.keys(featured.view.board).length > 0);
  assert.deepEqual(featured.view.legalMoves, []);

  // A live board beats the complete one regardless of update recency ordering
  // among complete boards.
  const liveBoard: StoredXiangqiBroadcastBoard = {
    ...storedBoard,
    id: `${board.id}-live`,
    boardNumber: board.boardNumber + 1,
    status: 'live',
    result: '*',
    moves: storedBoard.moves.slice(0, 4),
    plyCount: 4,
    updatedAt: new Date(5_000),
  };
  const withLive = await xiangqiBroadcastIndexForApi(
    deps({
      listXiangqiBroadcastBoards: async (roundId) =>
        roundId === board.roundId ? [storedBoard, liveBoard] : [],
    }),
  );
  assert.equal(withLive.tours[0]?.featuredBoard?.id, liveBoard.id);
  assert.equal(withLive.tours[0]?.featuredBoard?.status, 'live');
  assert.equal(withLive.tours[0]?.featuredBoard?.plyCount, 4);
});

test('broadcast index API omits the featured board when nothing is live or complete', async () => {
  const scheduledBoard: StoredXiangqiBroadcastBoard = {
    ...storedBoard,
    status: 'scheduled',
    result: '*',
    moves: [],
    plyCount: 0,
  };
  const payload = await xiangqiBroadcastIndexForApi(
    deps({
      listXiangqiBroadcastBoards: async (roundId) =>
        roundId === board.roundId ? [scheduledBoard] : [],
    }),
  );
  assert.equal(payload.tours[0]?.featuredBoard, null);
});

test('broadcast tour API returns tour detail with rounds', async () => {
  const payload = await xiangqiBroadcastTourForApi(tour.slug, deps());

  assert.ok(payload);
  assert.equal(payload.tour.slug, tour.slug);
  assert.equal(payload.rounds.length, 1);
  assert.equal(payload.rounds[0]?.id, 'men-r1');
});

test('broadcast tour API credits the records source, which the payload has no boards for', async () => {
  // The tour payload carries rounds, not boards, so a client cannot derive this
  // for itself. Without it the tour PAGE credited nobody while every round page
  // did -- on a tour whose games all came from one volunteer archive, and on the
  // page an outside link points at.
  const sourced = await xiangqiBroadcastTourForApi(
    tour.slug,
    deps({
      listXiangqiBroadcastBoards: async (roundId) =>
        roundId === board.roundId
          ? [
              {
                ...storedBoard,
                sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_142519.html',
              },
            ]
          : [],
    }),
  );
  assert.ok(sourced);
  assert.deepEqual(sourced.recordsSource, { host: 'dpxq.com', href: 'http://www.dpxq.com' });

  // Boards with no provenance credit nobody, rather than crediting us.
  const unsourced = await xiangqiBroadcastTourForApi(tour.slug, deps());
  assert.equal(unsourced?.recordsSource, null);
});

test('broadcast tour API rounds carry board status counts for status icons', async () => {
  const payload = await xiangqiBroadcastTourForApi(tour.slug, deps());

  assert.ok(payload);
  assert.equal(payload.rounds[0]?.boardCount, 1);
  assert.equal(payload.rounds[0]?.completeBoardCount, 1);
  assert.equal(payload.rounds[0]?.liveBoardCount, 0);
  assert.equal(payload.rounds[0]?.scheduledBoardCount, 0);
});

test('broadcast round API returns only boards under the requested round', async () => {
  const payload = await xiangqiBroadcastRoundForApi(tour.slug, 'men-r1', deps());

  assert.ok(payload);
  assert.equal(payload.round.id, 'men-r1');
  assert.equal(payload.boards.length, 1);
  assert.equal(payload.boards[0]?.id, board.id);
});

test('broadcast round API lists sibling rounds with stats for the round switcher', async () => {
  const payload = await xiangqiBroadcastRoundForApi(tour.slug, 'men-r1', deps());

  assert.ok(payload);
  assert.equal(payload.rounds.length, 1);
  assert.equal(payload.rounds[0]?.id, 'men-r1');
  assert.equal(payload.rounds[0]?.boardCount, 1);
  assert.equal(payload.rounds[0]?.completeBoardCount, 1);
});

test('broadcast round stream includes a stable version for reconnect comparisons', async () => {
  const payload = await xiangqiBroadcastRoundStreamForApi(tour.slug, 'men-r1', deps());

  assert.ok(payload);
  assert.equal(payload.payload.round.id, 'men-r1');
  assert.match(payload.version, /2025-wxc-sample-men-r1-b01/);
  assert.match(payload.version, /complete/);
});

test('broadcast board API builds replay-compatible timeline and history', async () => {
  const payload = await xiangqiBroadcastBoardForApi(board.id, deps());

  assert.ok(payload);
  assert.equal(payload.board.id, board.id);
  assert.equal(payload.board.plyCount, board.moves.length);
  assert.equal(payload.timeline.length, board.moves.length);
  assert.equal(payload.timeline[0]?.color, 'red');
  assert.equal(payload.timeline[1]?.color, 'black');
  assert.equal(payload.history.truth.length, board.moves.length + 1);
  assert.deepEqual(payload.timeline[0]?.move, board.moves[0]);
  assert.equal(payload.views.truth.id, board.id);
  assert.deepEqual(payload.board.updatedAt, storedBoard.updatedAt);
});

test('broadcast board stream version changes when persisted state changes', async () => {
  const first = await xiangqiBroadcastBoardStreamForApi(board.id, deps());
  const updatedBoard = {
    ...storedBoard,
    moves: storedBoard.moves.slice(0, 2),
    plyCount: 2,
    updatedAt: new Date(10_000),
  };
  const next = await xiangqiBroadcastBoardStreamForApi(
    board.id,
    deps({
      getXiangqiBroadcastBoard: async (boardId) => (boardId === board.id ? updatedBoard : null),
    }),
  );

  assert.ok(first);
  assert.ok(next);
  assert.notEqual(first.version, next.version);
  assert.equal(next.payload.timeline.length, 2);
});

test('broadcast board export returns canonical coordinate JSON', async () => {
  const payload = await xiangqiBroadcastBoardExportForApi(board.id, deps());

  assert.ok(payload);
  assert.equal(payload.schema, board.schema);
  assert.equal(payload.id, board.id);
  assert.deepEqual(payload.moves, board.moves);
});

test('broadcast APIs return null for unknown records', async () => {
  assert.equal(await xiangqiBroadcastTourForApi('missing', deps()), null);
  assert.equal(await xiangqiBroadcastRoundForApi(tour.slug, 'missing', deps()), null);
  assert.equal(await xiangqiBroadcastBoardForApi('missing', deps()), null);
  assert.equal(await xiangqiBroadcastBoardExportForApi('missing', deps()), null);
});

test('admin broadcast ops route requires admin before persistence in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = captureResponse();
    const handled = await tryHandle(
      emptyCtx(),
      { method: 'GET', headers: {} } as IncomingMessage,
      response,
      '/api/admin/xiangqi/broadcasts',
      new URL('http://test.local/api/admin/xiangqi/broadcasts'),
    );

    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { error: 'admin_required' });
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

function emptyCtx() {
  return {
    rooms: new Map(),
    lobbyTickets: new Map(),
    lobbyQueue: [],
    databaseRequired: false,
    pveBuiltinEngineClientId: 'random-engine',
    annotationsFile: '',
    liveClockInitialMs: 60_000,
    liveClockIncrementMs: 0,
    createRoom: async () => {
      throw new Error('unused');
    },
    reserveLiveEngineSeat: async () => null,
    releaseLiveEngineReservation: () => {},
    abandonRoom: async () => ({ ok: false, error: 'not_found' as const }),
    inMemoryGameSummary: () => null,
    isDraining: () => false,
    drainDeadlineMs: () => null,
    activeGameCount: () => 0,
  };
}

type ResponseCapture = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
};

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: '',
    writeHead(statusCode: number, headers: Record<string, string | string[]> = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
      return this;
    },
    write(chunk: string) {
      this.body += chunk;
      return true;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
