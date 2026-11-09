import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BANQI_SPEC_ID, STANDARD_BANQI_DEAL } from '@mistboard/game';
import { banqiEngineBinaryAvailable } from '../banqi-engine.js';
import type { BanqiEvent } from '../banqi-runtime.js';
import { findPendingAnalysisJob } from '../game-analysis-jobs.js';
import { logger } from '../obs.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  type BanqiPostgamePersistence,
  banqiPostgameForApi,
  createBanqiAnalysisRoutes,
} from './banqi-games.js';

const ROOM_ID = 'bq_postgame';

function captureResponse(): ServerResponse & { status: number | null; body: string } {
  const capture = {
    status: null as number | null,
    body: '',
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(body = '') {
      capture.body = body;
      return capture;
    },
  };
  return capture as unknown as ServerResponse & typeof capture;
}

test('Banqi analysis and decisions reject unavailable nets before persistence or enqueue limits', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'banqi-route-net-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const net = join(dir, 'net.bqnn');
  const empty = join(dir, 'empty.bqnn');
  writeFileSync(net, 'stub net');
  writeFileSync(empty, '');
  const previous = {
    MISTBOARD_BANQI_ENABLED: process.env.MISTBOARD_BANQI_ENABLED,
    MISTBOARD_BANQI_ENGINE_PATH: process.env.MISTBOARD_BANQI_ENGINE_PATH,
    MISTBOARD_BANQI_NET: process.env.MISTBOARD_BANQI_NET,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.MISTBOARD_BANQI_ENABLED = 'true';
  process.env.MISTBOARD_BANQI_ENGINE_PATH = process.execPath;
  process.env.MISTBOARD_BANQI_NET = net;
  assert.equal(banqiEngineBinaryAvailable(), true);
  const error = t.mock.method(logger, 'error', () => {});
  let limitChecks = 0;
  const handler = createBanqiAnalysisRoutes({
    currentUser: async () => ({ id: 'banqi-net-account' }),
    enqueueLimiter: {
      check: () => {
        limitChecks += 1;
        return false;
      },
    },
  });
  const post = { method: 'POST', headers: {} } as IncomingMessage;
  for (const endpoint of ['analysis', 'decisions'] as const) {
    for (const path of [undefined, join(dir, 'missing.bqnn'), empty, dir]) {
      await t.test(`${endpoint}: ${path === undefined ? 'unset' : path}`, async () => {
        if (path === undefined) delete process.env.MISTBOARD_BANQI_NET;
        else process.env.MISTBOARD_BANQI_NET = path;
        const response = captureResponse();
        assert.equal(
          await handler(post, response, `/api/banqi/games/${ROOM_ID}/${endpoint}`),
          true,
        );
        assert.equal(response.status, 503);
        assert.deepEqual(JSON.parse(response.body), { error: 'analysis_engine_unavailable' });
        assert.deepEqual(error.mock.calls.at(-1)?.arguments[0], {
          kind: `banqi_${endpoint}_engine_unavailable`,
        });
        assert.equal(findPendingAnalysisJob('banqi', ROOM_ID, endpoint), null);
        assert.equal(limitChecks, 0);
      });
    }
    // A usable net passes the engine gate; GET remains a cache read even without it.
    for (const method of ['POST', 'GET']) {
      if (method === 'POST') process.env.MISTBOARD_BANQI_NET = net;
      else delete process.env.MISTBOARD_BANQI_NET;
      const response = captureResponse();
      await handler(
        { ...post, method } as IncomingMessage,
        response,
        `/api/banqi/games/${ROOM_ID}/${endpoint}`,
      );
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(response.body), { error: 'persistence_disabled' });
    }
  }
});

// Red (the first seat) flips a1 — binding its ink to the revealed red general —
// then Black resigns. Banqi is symmetric: a face-down tile is hidden from both
// equally and every capture is of an already-revealed piece, so there is no
// private per-seat knowledge. The postgame is a SINGLE truth review surface.
function finishedFlipEvents(): BanqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM_ID,
      gameSpecId: BANQI_SPEC_ID,
      setup: STANDARD_BANQI_DEAL,
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
    { type: 'move-played', at: 4, roomId: ROOM_ID, color: 'red', move: { from: 'a1', to: 'a1' } },
    { type: 'seat-resigned', at: 5, roomId: ROOM_ID, color: 'black' },
  ];
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: BANQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 1,
    startedAt: new Date(1),
    endedAt: new Date(5),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
    ...overrides,
  };
}

function deps(
  record: RecentEveGameRecord | null,
  events: BanqiEvent[] | null,
): BanqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

test('Banqi postgame returns a full-truth view revealing every identity', async () => {
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
  assert.ok(payload);

  assert.equal(payload.game.variant, BANQI_SPEC_ID);
  assert.equal(payload.game.result, 'red-wins');
  assert.equal(payload.game.termination, 'resignation');
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'resignation',
  });

  // Truth view: all 32 tiles revealed (faceDown:false), even the ones never
  // flipped during play — the deal is fully known to the server postgame.
  const entries = Object.entries(payload.view.board);
  assert.equal(entries.length, 32);
  for (const [square, entry] of entries) {
    assert.equal(entry?.faceDown, false, `truth square ${square} must be revealed`);
  }
  // a1 was dealt the red general (deal index 0) and flipped on the opening move.
  assert.deepEqual(payload.view.board.a1, { color: 'red', role: 'general', faceDown: false });
});

// ── Symmetric-info contract: NO per-seat split ──────────────────────────────
test('Banqi postgame ships a single truth surface, not per-seat views', async () => {
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
  assert.ok(payload);

  // Banqi has no private knowledge, so the route omits the jieqi-style per-color
  // views entirely; the web review renders the single truth board.
  assert.equal('views' in payload, false);
  assert.equal(payload.view.perspective, 'red');
});

test('Banqi postgame history masks unflipped tiles per ply', async () => {
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
  assert.ok(payload);

  // Initial position (ply 0) + one snapshot for the single move played.
  assert.deepEqual(
    payload.history.truth?.map((snapshot) => snapshot.ply),
    [0, 1],
  );
  // The replay reproduces the actual flips: at ply 0 every tile is still face-down
  // (nothing has been revealed), and a1 only turns over at ply 1 when it is flipped.
  // Without the mask the whole deal would show from move 0, defeating the replay.
  const startBoard = payload.history.truth?.[0]?.view.board ?? {};
  for (const [square, entry] of Object.entries(startBoard)) {
    assert.equal(entry?.faceDown, true, `ply-0 square ${square} must be face-down`);
  }
  assert.equal(payload.history.truth?.[1]?.view.board.a1?.faceDown, false);
  assert.deepEqual(payload.history.truth?.[1]?.view.board.a1, {
    color: 'red',
    role: 'general',
    faceDown: false,
  });
});

test('Banqi postgame ships a parallel revealed history spoiling every ply', async () => {
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
  assert.ok(payload);

  // The reveal overlay mirrors the masked history ply-for-ply but unmasks the
  // whole deal at every snapshot, including ply 0 where the as-played board is
  // still entirely face-down. This is what the review's Reveal toggle swaps in.
  assert.deepEqual(
    payload.history.revealed?.map((snapshot) => snapshot.ply),
    [0, 1],
  );
  const startBoard = payload.history.revealed?.[0]?.view.board ?? {};
  const startEntries = Object.entries(startBoard);
  assert.equal(startEntries.length, 32);
  for (const [square, entry] of startEntries) {
    assert.equal(entry?.faceDown, false, `revealed ply-0 square ${square} must be unmasked`);
  }
  // a1 holds the red general (deal index 0) from move 0 in the revealed track,
  // even though it is only flipped at ply 1 in the masked track.
  assert.deepEqual(payload.history.revealed?.[0]?.view.board.a1, {
    color: 'red',
    role: 'general',
    faceDown: false,
  });
});

test('Banqi postgame builds a move-and-terminal timeline', async () => {
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
  assert.ok(payload);

  assert.deepEqual(
    payload.timeline.map((entry) => entry.type),
    ['move-played', 'seat-resigned'],
  );
  const terminal = payload.timeline.at(-1);
  assert.equal(terminal?.type, 'seat-resigned');
  assert.equal(terminal && 'winner' in terminal ? terminal.winner : null, 'red');
});

test('Banqi postgame returns null for an unfinished game', async () => {
  const events = finishedFlipEvents().slice(0, -1); // drop the resignation
  const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), events));
  assert.equal(payload, null);
});

test('Banqi postgame rejects a non-banqi variant record', async () => {
  const payload = await banqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord({ variant: 'jieqi' }), finishedFlipEvents()),
  );
  assert.equal(payload, null);
});

test('Banqi postgame returns null when there is no game or event log', async () => {
  assert.equal(await banqiPostgameForApi(ROOM_ID, deps(null, finishedFlipEvents())), null);
  assert.equal(await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('Banqi postgame does not require launch env flags', async () => {
  const previous = process.env.MISTBOARD_BANQI_ENABLED;
  delete process.env.MISTBOARD_BANQI_ENABLED;
  try {
    const payload = await banqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedFlipEvents()));
    assert.ok(payload);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_BANQI_ENABLED;
    else process.env.MISTBOARD_BANQI_ENABLED = previous;
  }
});
