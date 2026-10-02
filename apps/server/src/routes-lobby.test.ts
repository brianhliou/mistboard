import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { JIEQI_SPEC_ID, JUNGLE_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import { jieqiEnabled, jungleEnabled } from './feature-flags.js';
import { type HttpApiContext, isAllowedFullTimeControl } from './routes/lib.js';
import { LOBBY_TICKET_STALE_MS, tryHandle } from './routes/lobby.js';
import type { Room } from './server-types.js';
import { registerVariantTenant } from './variant-tenant/registry.js';

const jieqiFlag = 'MISTBOARD_JIEQI_ENABLED';
const jungleFlag = 'MISTBOARD_JUNGLE_ENABLED';

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

function responseJson(response: ResponseCapture): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function lobbyPost(body: Record<string, unknown>): IncomingMessage {
  const json = JSON.stringify(body);
  async function* chunks() {
    yield Buffer.from(json);
  }
  const req = chunks() as unknown as IncomingMessage & Record<string, unknown>;
  req.method = 'POST';
  req.headers = {};
  return req;
}

type CreateRoomCall = unknown[];
type TenantLobbyCall = [RoomTimeControl | undefined, boolean];

// Lobby tenant dispatch goes through the global VariantTenant registry, so the
// test registers fakes under the real kinds/spec ids/flags. The lobby
// createRoom recorders live at module scope and are reset per testContext().
const jieqiCalls: TenantLobbyCall[] = [];
const jungleCalls: TenantLobbyCall[] = [];
let jieqiRoomSeq = 0;
let jungleRoomSeq = 0;

function registerFakeLobbyTenant(options: {
  kind: string;
  gameSpecId: string;
  roomIdPrefix: string;
  errorPrefix: string;
  enabled(): boolean;
  supportsRated: boolean;
  allowsTimeControl(timeControl: RoomTimeControl): boolean;
  createRoom(
    timeControl: RoomTimeControl | undefined,
    rated: boolean,
  ): Promise<{ id: string; region: string }>;
}): void {
  registerVariantTenant({
    kind: options.kind,
    gameSpecId: options.gameSpecId,
    roomIdPrefix: options.roomIdPrefix,
    ownsSpecRouting: true,
    errorPrefix: options.errorPrefix,
    enabled: options.enabled,
    rooms: new Map(),
    activeGameCount: () => 0,
    getOrLoadRoom: async () => null,
    attachWebSocket: async () => {
      throw new Error('unexpected ws attach in lobby test');
    },
    clearRuntimeTimers: () => {},
    pauseOnShutdown: async () => 0,
    clearRooms: () => {},
    http: {
      matchesCreateRequest: () => false,
      handleCreate: async () => {
        throw new Error('unexpected http create in lobby test');
      },
    },
    lobby: {
      supportsRated: options.supportsRated,
      allowsTimeControl: options.allowsTimeControl,
      createRoom: options.createRoom,
    },
    sweepDueDeadline: null,
    createCorrespondenceGameForSeek: null,
  });
}

registerFakeLobbyTenant({
  kind: 'jieqi',
  gameSpecId: JIEQI_SPEC_ID,
  roomIdPrefix: 'jq_',
  errorPrefix: 'jieqi',
  enabled: jieqiEnabled,
  supportsRated: true,
  allowsTimeControl: () => true,
  createRoom: async (timeControl, rated) => {
    jieqiCalls.push([timeControl, rated]);
    jieqiRoomSeq += 1;
    return { id: `jq_lobby_${jieqiRoomSeq}`, region: 'global' };
  },
});

registerFakeLobbyTenant({
  kind: 'jungle',
  gameSpecId: JUNGLE_SPEC_ID,
  roomIdPrefix: 'jgl_',
  errorPrefix: 'jungle',
  enabled: jungleEnabled,
  supportsRated: false,
  allowsTimeControl: isAllowedFullTimeControl,
  createRoom: async (timeControl, rated) => {
    jungleCalls.push([timeControl, rated]);
    jungleRoomSeq += 1;
    return { id: `jgl_lobby_${jungleRoomSeq}`, region: 'global' };
  },
});

function testContext(overrides: Partial<HttpApiContext> = {}): {
  ctx: HttpApiContext;
  chessCalls: CreateRoomCall[];
  jungleCalls: TenantLobbyCall[];
  jieqiCalls: TenantLobbyCall[];
} {
  jieqiCalls.length = 0;
  jungleCalls.length = 0;
  jieqiRoomSeq = 0;
  jungleRoomSeq = 0;
  const chessCalls: CreateRoomCall[] = [];
  let chessRoomSeq = 0;
  const ctx: HttpApiContext = {
    abandonRoom: async () => ({ ok: false, error: 'not_found' }),
    activeGameCount: () => 0,
    annotationsFile: '',
    createRoom: async (...args) => {
      chessCalls.push(args);
      chessRoomSeq += 1;
      return { id: `room_chess_${chessRoomSeq}`, region: 'global' } as unknown as Room;
    },
    databaseRequired: false,
    drainDeadlineMs: () => null,
    inMemoryGameSummary: () => null,
    isDraining: () => false,
    liveClockIncrementMs: 2000,
    liveClockInitialMs: 180000,
    lobbyQueue: [],
    lobbyTickets: new Map(),
    pveBuiltinEngineClientId: 'engine',
    releaseLiveEngineReservation: () => {},
    reserveLiveEngineSeat: async () => null,
    rooms: new Map(),
    ...overrides,
  };
  return { ctx, chessCalls, jungleCalls, jieqiCalls };
}

const tc = { initialMs: 180000, incrementMs: 2000 };

async function post(ctx: HttpApiContext, body: Record<string, unknown>): Promise<ResponseCapture> {
  const response = captureResponse();
  const handled = await tryHandle(ctx, lobbyPost(body), response, '/api/lobby');
  assert.equal(handled, true);
  return response;
}

// ── Chess baseline (must stay identical across the variant-aware refactor) ──

test('lobby: a single chess request waits (202)', async () => {
  const { ctx, chessCalls } = testContext();
  const res = await post(ctx, { timeControl: tc });
  assert.equal(res.status, 202);
  const json = responseJson(res);
  assert.equal(json.status, 'waiting');
  assert.equal(json.gameSpecId, 'dark-chess');
  assert.equal(chessCalls.length, 0);
});

test('lobby: two matching chess requests create one dark-chess room with the exact args', async () => {
  const { ctx, chessCalls } = testContext();
  const first = await post(ctx, { timeControl: tc });
  assert.equal(first.status, 202);
  const second = await post(ctx, { timeControl: tc });
  assert.equal(second.status, 201);
  assert.equal(responseJson(second).status, 'matched');
  assert.equal(responseJson(second).roomId, 'room_chess_1');

  assert.equal(chessCalls.length, 1);
  assert.deepEqual(chessCalls[0], [
    'pvp',
    'dark-chess',
    'engine',
    tc,
    false,
    { randomSeating: true, lobbyMatch: true },
  ]);
});

test('lobby: chess requests with different time controls do not match', async () => {
  const { ctx, chessCalls } = testContext();
  await post(ctx, { timeControl: tc }); // 3+2
  // 1+1 is a different allowed bucket. An off-menu TC like 1+0 is rejected
  // while the official 1+1 / 3+2 / 5+5 controls remain available.
  const other = await post(ctx, { timeControl: { initialMs: 60000, incrementMs: 1000 } });
  assert.equal(other.status, 202);
  assert.equal(chessCalls.length, 0);
  assert.equal(ctx.lobbyQueue.length, 2);
});

test('lobby: chess request with an off-menu time control is rejected', async () => {
  const { ctx } = testContext();
  // 1+0 is not an official playable TC — matchmaking must reject it so the queue
  // can't fragment into off-menu buckets.
  const res = await post(ctx, { timeControl: { initialMs: 60000, incrementMs: 0 } });
  assert.equal(res.status, 400);
  assert.equal(ctx.lobbyQueue.length, 0);
});

test('lobby: Fog Chess accepts the restored 5+5 time control', async () => {
  const { ctx } = testContext();
  const res = await post(ctx, {
    timeControl: { initialMs: 300_000, incrementMs: 5_000 },
  });
  assert.equal(res.status, 202);
  assert.equal(ctx.lobbyQueue.length, 1);
});

test('lobby: rated chess request from a guest is rejected', async () => {
  await withRatedFlag(true, async () => {
    const { ctx } = testContext();
    const res = await post(ctx, { rated: true, timeControl: tc });
    assert.equal(res.status, 401);
    assert.deepEqual(responseJson(res), { error: 'rated_requires_account' });
    assert.equal(ctx.lobbyQueue.length, 0);
  });
});

// ── Jieqi ──────────────────────────────────────────────────────

test('lobby: a single Jieqi request waits (202)', async () => {
  await withFlag(true, async () => {
    const { ctx, jieqiCalls } = testContext();
    const res = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
    assert.equal(res.status, 202);
    assert.equal(responseJson(res).gameSpecId, JIEQI_SPEC_ID);
    assert.equal(jieqiCalls.length, 0);
  });
});

test('lobby: two Jieqi requests match into a Jieqi room', async () => {
  await withFlag(true, async () => {
    const { ctx, jieqiCalls, chessCalls } = testContext();
    const first = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
    assert.equal(first.status, 202);
    const second = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
    assert.equal(second.status, 201);
    assert.equal(responseJson(second).status, 'matched');
    assert.equal(responseJson(second).roomId, 'jq_lobby_1');
    assert.equal(jieqiCalls.length, 1);
    assert.deepEqual(jieqiCalls[0], [tc, false]);
    assert.equal(chessCalls.length, 0, 'chess factory must not be touched');
  });
});

test('lobby: guest Jieqi rated request is rejected', async () => {
  await withFlag(true, async () => {
    await withRatedFlag(true, async () => {
      const { ctx, jieqiCalls } = testContext();
      const res = await post(ctx, {
        gameSpecId: JIEQI_SPEC_ID,
        rated: true,
        timeControl: tc,
      });
      assert.equal(res.status, 401);
      assert.deepEqual(responseJson(res), { error: 'rated_requires_account' });
      assert.equal(jieqiCalls.length, 0);
    });
  });
});

test('lobby: Jieqi requests are disabled when the launch flag is off', async () => {
  await withFlag(false, async () => {
    const { ctx } = testContext();
    const res = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
    assert.equal(res.status, 404);
    assert.deepEqual(responseJson(res), { error: 'jieqi_disabled' });
    assert.equal(ctx.lobbyQueue.length, 0);
  });
});

test('lobby: chess and Jieqi seekers never match each other', async () => {
  await withFlag(true, async () => {
    const { ctx, chessCalls, jieqiCalls } = testContext();
    const chess = await post(ctx, { timeControl: tc });
    const jieqi = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
    assert.equal(chess.status, 202);
    assert.equal(jieqi.status, 202);
    assert.equal(chessCalls.length, 0);
    assert.equal(jieqiCalls.length, 0);
    assert.equal(ctx.lobbyQueue.length, 2);
  });
});

// ── Jungle ───────────────────────────────────────────────────────

test('lobby: a single Jungle request waits (202)', async () => {
  await withJungleFlag(true, async () => {
    const { ctx, jungleCalls } = testContext();
    const res = await post(ctx, { gameSpecId: JUNGLE_SPEC_ID, timeControl: tc });
    assert.equal(res.status, 202);
    assert.equal(responseJson(res).gameSpecId, JUNGLE_SPEC_ID);
    assert.equal(jungleCalls.length, 0);
  });
});

test('lobby: two Jungle requests match into a Jungle room', async () => {
  await withJungleFlag(true, async () => {
    const { ctx, chessCalls, jungleCalls, jieqiCalls } = testContext();
    const first = await post(ctx, { gameSpecId: JUNGLE_SPEC_ID, timeControl: tc });
    assert.equal(first.status, 202);
    const second = await post(ctx, { gameSpecId: JUNGLE_SPEC_ID, timeControl: tc });
    assert.equal(second.status, 201);
    assert.equal(responseJson(second).status, 'matched');
    assert.equal(responseJson(second).roomId, 'jgl_lobby_1');
    assert.equal(jungleCalls.length, 1);
    assert.deepEqual(jungleCalls[0], [tc, false]);
    assert.equal(chessCalls.length, 0, 'chess factory must not be touched');
    assert.equal(jieqiCalls.length, 0, 'Jieqi factory must not be touched');
  });
});

test('lobby: Jungle allows 5+5 and rejects off-menu time controls', async () => {
  await withJungleFlag(true, async () => {
    const { ctx, jungleCalls } = testContext();
    const rapid = await post(ctx, {
      gameSpecId: JUNGLE_SPEC_ID,
      timeControl: { initialMs: 300000, incrementMs: 5000 },
    });
    assert.equal(rapid.status, 202);
    const offMenu = await post(ctx, {
      gameSpecId: JUNGLE_SPEC_ID,
      timeControl: { initialMs: 60000, incrementMs: 0 },
    });
    assert.equal(offMenu.status, 400);
    assert.deepEqual(responseJson(offMenu), { error: 'time_control_unsupported' });
    assert.equal(jungleCalls.length, 0);
  });
});

test('lobby: the 10+5 rung clears the time-control allowlist', async () => {
  // The deliberate-variant rung. A lobby allowlist must accept everything its
  // variant's picker offers, or a menu-listed chip 400s at join time — adding
  // 10+5 to a tenant's timePresetIds without widening ALLOWED_FULL_TIME_CONTROL
  // _IDS would do exactly that. (10+5 is casual-only; the rated gate is a
  // separate flag, covered by the `rated` assertion in the @mistboard/game
  // time-controls test rather than here, where rated mode is switched off.)
  await withJungleFlag(true, async () => {
    const { ctx } = testContext();
    const casual = await post(ctx, {
      gameSpecId: JUNGLE_SPEC_ID,
      timeControl: { initialMs: 600000, incrementMs: 5000 },
    });
    assert.equal(casual.status, 202);
  });
});

test('lobby: Jungle requests are disabled when the launch flag is off', async () => {
  await withJungleFlag(false, async () => {
    const { ctx } = testContext();
    const res = await post(ctx, { gameSpecId: JUNGLE_SPEC_ID, timeControl: tc });
    assert.equal(res.status, 404);
    assert.deepEqual(responseJson(res), { error: 'jungle_disabled' });
    assert.equal(ctx.lobbyQueue.length, 0);
  });
});

test('lobby: chess, Jieqi, and Jungle seekers never match each other', async () => {
  await withFlag(true, async () => {
    await withJungleFlag(true, async () => {
      const { ctx, chessCalls, jungleCalls, jieqiCalls } = testContext();
      const chess = await post(ctx, { timeControl: tc });
      const jieqi = await post(ctx, { gameSpecId: JIEQI_SPEC_ID, timeControl: tc });
      const jungle = await post(ctx, {
        gameSpecId: JUNGLE_SPEC_ID,
        timeControl: tc,
      });
      assert.equal(chess.status, 202);
      assert.equal(jieqi.status, 202);
      assert.equal(jungle.status, 202);
      assert.equal(chessCalls.length, 0);
      assert.equal(jieqiCalls.length, 0);
      assert.equal(jungleCalls.length, 0);
      assert.equal(ctx.lobbyQueue.length, 3);
    });
  });
});

async function withJungleFlag<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[jungleFlag];
  process.env[jungleFlag] = enabled ? 'true' : 'false';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[jungleFlag];
    else process.env[jungleFlag] = previous;
  }
}

function withRatedFlag(value: boolean, fn: () => Promise<void>): Promise<void> {
  const before = process.env.MISTBOARD_RATED_ENABLED;
  if (value) process.env.MISTBOARD_RATED_ENABLED = 'true';
  else delete process.env.MISTBOARD_RATED_ENABLED;
  return fn().finally(() => {
    if (before === undefined) delete process.env.MISTBOARD_RATED_ENABLED;
    else process.env.MISTBOARD_RATED_ENABLED = before;
  });
}

function withFlag(value: boolean, fn: () => Promise<void>): Promise<void> {
  const before = process.env[jieqiFlag];
  if (value) process.env[jieqiFlag] = 'true';
  else delete process.env[jieqiFlag];
  return fn().finally(() => {
    if (before === undefined) delete process.env[jieqiFlag];
    else process.env[jieqiFlag] = before;
  });
}

export { post, responseJson, tc, testContext, withFlag };

// ── Ticket liveness ──────────────────────────────────────────────
//
// A seek is only as alive as the tab behind it. The seeker's page polls GET
// /api/lobby/:id every pollAfterMs; a closed tab or a backgrounded phone stops
// polling without ever sending the DELETE. Before liveness, such a ticket stayed
// on the open list (and matchable) for the full 5-minute TTL, and whoever took
// it landed in a room its creator never entered (prod, 2026-10-02, jieqi).

function lobbyGet(): IncomingMessage {
  return { method: 'GET', headers: {} } as unknown as IncomingMessage;
}

async function getPath(ctx: HttpApiContext, pathname: string): Promise<ResponseCapture> {
  const response = captureResponse();
  const handled = await tryHandle(ctx, lobbyGet(), response, pathname);
  assert.equal(handled, true);
  return response;
}

async function openRequests(ctx: HttpApiContext): Promise<unknown[]> {
  const res = await getPath(ctx, '/api/lobby');
  assert.equal(res.status, 200);
  return responseJson(res).requests as unknown[];
}

function clockedContext(): {
  ctx: HttpApiContext;
  chessCalls: CreateRoomCall[];
  advance(ms: number): void;
} {
  let now = 1_000_000;
  const { ctx, chessCalls } = testContext({ now: () => now });
  return {
    ctx,
    chessCalls,
    advance(ms: number) {
      now += ms;
    },
  };
}

test('lobby liveness: the server asks for polls well inside the staleness window', async () => {
  const { ctx } = clockedContext();
  const res = await post(ctx, { timeControl: tc });
  const pollAfterMs = responseJson(res).pollAfterMs as number;
  assert.equal(LOBBY_TICKET_STALE_MS, 10_000);
  assert.ok(pollAfterMs * 3 <= LOBBY_TICKET_STALE_MS, `pollAfterMs ${pollAfterMs} too slow`);
});

test('lobby liveness: a seeker that stops polling leaves the open list after 10 s', async () => {
  const { ctx, advance } = clockedContext();
  await post(ctx, { timeControl: tc });
  assert.equal((await openRequests(ctx)).length, 1);
  advance(LOBBY_TICKET_STALE_MS - 1);
  assert.equal((await openRequests(ctx)).length, 1, 'still inside the window');
  advance(2);
  assert.equal((await openRequests(ctx)).length, 0, 'a dead seeker must not be listed');
});

test('lobby liveness: a new seek never pairs with a ticket that stopped polling', async () => {
  const { ctx, chessCalls, advance } = clockedContext();
  await post(ctx, { timeControl: tc });
  advance(LOBBY_TICKET_STALE_MS + 1);
  // No list read in between: matching itself has to refuse the dead ticket.
  const joiner = await post(ctx, { timeControl: tc });
  assert.equal(joiner.status, 202);
  assert.equal(responseJson(joiner).status, 'waiting');
  assert.equal(chessCalls.length, 0, 'no room may be created against a dead seeker');
  const listed = await openRequests(ctx);
  assert.equal(listed.length, 1, 'only the fresh joiner is listed');
  assert.equal((listed[0] as { waitingMs: number }).waitingMs, 0);
});

test('lobby liveness: a seeker polling every second stays listed and matchable', async () => {
  const { ctx, chessCalls, advance } = clockedContext();
  const seek = await post(ctx, { timeControl: tc });
  const ticketId = responseJson(seek).ticketId as string;
  for (let second = 0; second < 30; second += 1) {
    advance(1_000);
    const poll = await getPath(ctx, `/api/lobby/${ticketId}`);
    assert.equal(poll.status, 200);
    assert.equal(responseJson(poll).status, 'waiting');
  }
  assert.equal((await openRequests(ctx)).length, 1);
  const joiner = await post(ctx, { timeControl: tc });
  assert.equal(joiner.status, 201);
  assert.equal(chessCalls.length, 1);
  // The seeker learns of the match on its next poll.
  advance(1_000);
  const matched = await getPath(ctx, `/api/lobby/${ticketId}`);
  assert.equal(responseJson(matched).status, 'matched');
});

test('lobby liveness: a matched ticket is not reaped for going quiet', async () => {
  // Staleness is about seeks; a matched ticket is how a backgrounded seeker
  // finds its room when it comes back, so it keeps the TTL.
  const { ctx, advance } = clockedContext();
  const seek = await post(ctx, { timeControl: tc });
  const ticketId = responseJson(seek).ticketId as string;
  await post(ctx, { timeControl: tc });
  advance(LOBBY_TICKET_STALE_MS * 3);
  const late = await getPath(ctx, `/api/lobby/${ticketId}`);
  assert.equal(late.status, 200);
  assert.equal(responseJson(late).status, 'matched');
});

test('lobby liveness: polling does not extend the 5-minute cap', async () => {
  const { ctx, advance } = clockedContext();
  const seek = await post(ctx, { timeControl: tc });
  const ticketId = responseJson(seek).ticketId as string;
  let status: number | null = 200;
  for (let second = 0; second < 5 * 60 && status === 200; second += 1) {
    advance(1_000);
    status = (await getPath(ctx, `/api/lobby/${ticketId}`)).status;
  }
  assert.equal(status, 404, 'the ticket must expire at the TTL even while polled');
  assert.equal((await openRequests(ctx)).length, 0);
});
