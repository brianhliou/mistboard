import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { DARK_MINI_XIANGQI_SPEC_ID } from '@mistboard/game';
import type { DarkMiniXiangqiRuntimeRoom } from './dark-mini-xiangqi-runtime.js';
import { DEFAULT_ACCOUNT_PREFERENCES, type UserAccount } from './persistence.js';
import {
  type DarkMiniXiangqiCreateContext,
  darkMiniXiangqiPveHumanColor,
  handleDarkMiniXiangqiCreate,
  requestsDarkMiniXiangqi,
} from './routes/dark-mini-xiangqi-rooms.js';

const darkMiniXiangqiFlag = 'MISTBOARD_DARK_MINI_XIANGQI_ENABLED';
const ratedFlag = 'MISTBOARD_RATED_ENABLED';

type ResponseCapture = {
  body: string;
  headers: Record<string, string>;
  status: number | null;
};

test('Dark Mini Xiangqi room route only claims canonical Dark Mini Xiangqi game spec requests', () => {
  assert.equal(requestsDarkMiniXiangqi({ gameSpecId: DARK_MINI_XIANGQI_SPEC_ID }), true);
  assert.equal(requestsDarkMiniXiangqi({ variant: DARK_MINI_XIANGQI_SPEC_ID }), false);
  assert.equal(requestsDarkMiniXiangqi({ gameSpecId: 'dark-xiangqi' }), false);
  assert.equal(requestsDarkMiniXiangqi({ variant: 'dark-chess' }), false);
});

test('Dark Mini Xiangqi room route returns disabled when the launch flag is off', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  delete process.env[darkMiniXiangqiFlag];
  try {
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(testContext(), response, {
      gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      mode: 'pvp',
    });

    assert.equal(response.status, 404);
    assert.deepEqual(responseJson(response), { error: 'dark_mini_xiangqi_disabled' });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route rejects legacy variant requests when the flag is on', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(testContext(), response, {
      mode: 'pvp',
      variant: DARK_MINI_XIANGQI_SPEC_ID,
    });

    assert.equal(response.status, 501);
    assert.deepEqual(responseJson(response), { error: 'dark_mini_xiangqi_not_integrated' });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route rejects unsupported create surfaces before room creation', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'bogus' },
    );

    assert.equal(response.status, 501);
    assert.deepEqual(responseJson(response), {
      error: 'dark_mini_xiangqi_unsupported_surface',
    });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route rejects rated requests while rated is disabled', async () => {
  const beforeDmx = process.env[darkMiniXiangqiFlag];
  const beforeRated = process.env[ratedFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  delete process.env[ratedFlag];
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pvp', rated: true },
      testUser(),
    );

    assert.equal(response.status, 403);
    assert.deepEqual(responseJson(response), { error: 'rated_disabled' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(beforeDmx);
    restoreRatedFlag(beforeRated);
  }
});

test('Dark Mini Xiangqi room route creates a rated PvP room for a signed-in player', async () => {
  const beforeDmx = process.env[darkMiniXiangqiFlag];
  const beforeRated = process.env[ratedFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  process.env[ratedFlag] = 'true';
  try {
    let requestedRated: boolean | undefined;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async (_timeControl, _creatorPreference, _engine, rated) => {
          requestedRated = rated;
          return {
            ok: true,
            room: { ...darkMiniXiangqiRoom('dmxq_rated'), rated: rated === true },
          };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pvp', rated: true },
      testUser(),
    );

    assert.equal(requestedRated, true);
    assert.equal(response.status, 201);
    assert.equal(responseJson(response).rated, true);
  } finally {
    restoreFlag(beforeDmx);
    restoreRatedFlag(beforeRated);
  }
});

test('Dark Mini Xiangqi PvE color selection honors random and explicit black', () => {
  assert.equal(darkMiniXiangqiPveHumanColor(undefined), 'red');
  assert.equal(darkMiniXiangqiPveHumanColor('red'), 'red');
  assert.equal(darkMiniXiangqiPveHumanColor('black'), 'black');
  assert.equal(darkMiniXiangqiPveHumanColor('random', 0), 'red');
  assert.equal(darkMiniXiangqiPveHumanColor('random', 255), 'black');
});

test('Dark Mini Xiangqi PvE route seats the engine opposite the human and echoes mode pve', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let requestedEngine: unknown;
    let reservedColor: string | undefined;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async (_engineId, color) => {
          reservedColor = color;
          return 'reservation-abc';
        },
        createDarkMiniXiangqiRoom: async (_timeControl, _creatorPreference, engine) => {
          requestedEngine = engine;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_pve') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pve', preferredColor: 'red' },
    );

    // Human picked red → engine takes black (the white slot is reserved); default
    // DMX engine when none given; the reservation id flows into the room.
    assert.equal(reservedColor, 'black');
    assert.deepEqual(requestedEngine, {
      engineId: 'python-dmx-v1.0',
      seat: 'black',
      reservationId: 'reservation-abc',
    });
    assert.equal(response.status, 201);
    assert.equal(responseJson(response).mode, 'pve');
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi PvE route carries bot id into engine room creation', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let requestedEngine: unknown;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async () => 'reservation-bot',
        createDarkMiniXiangqiRoom: async (_timeControl, _creatorPreference, engine) => {
          requestedEngine = engine;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_bot_pve') };
        },
      }),
      response,
      {
        botId: 'misty-dmx',
        engineId: 'python-dmx-v1.0',
        gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
        mode: 'pve',
        preferredColor: 'red',
      },
    );

    assert.deepEqual(requestedEngine, {
      engineId: 'python-dmx-v1.0',
      seat: 'black',
      reservationId: 'reservation-bot',
      botId: 'misty-dmx',
    });
    assert.equal(response.status, 201);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi PvE route seats the engine opposite explicit human black', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let requestedEngine: unknown;
    let reservedColor: string | undefined;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async (_engineId, color) => {
          reservedColor = color;
          return 'reservation-black';
        },
        createDarkMiniXiangqiRoom: async (_timeControl, _creatorPreference, engine) => {
          requestedEngine = engine;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_pve_black') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pve', preferredColor: 'black' },
    );

    assert.equal(reservedColor, 'white');
    assert.deepEqual(requestedEngine, {
      engineId: 'python-dmx-v1.0',
      seat: 'red',
      reservationId: 'reservation-black',
    });
    assert.equal(response.status, 201);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi PvE route returns 503 when no engine seat is available', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async () => null, // capacity full
        createDarkMiniXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pve' },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(responseJson(response), { error: 'engine_unavailable' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi PvE route rejects an unknown engineId before room creation', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pve', engineId: 'not-a-dmx-engine' },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(responseJson(response), { error: 'invalid_engine' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route creates a direct PvP room response', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let requestedPreference: unknown;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async (_timeControl, creatorPreference) => {
          requestedPreference = creatorPreference;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_route') };
        },
      }),
      response,
      {
        gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
        mode: 'pvp',
        preferredColor: 'black',
      },
    );

    assert.equal(requestedPreference, 'black');
    assert.equal(response.status, 201);
    assert.deepEqual(responseJson(response), {
      roomId: 'dmxq_route',
      url: '/room/dmxq_route',
      mode: 'pvp',
      gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      rated: false,
      region: 'global',
    });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route forwards a valid time control and echoes it', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let requestedTimeControl: unknown;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async (timeControl) => {
          requestedTimeControl = timeControl;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_timed') };
        },
      }),
      response,
      {
        gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
        mode: 'pvp',
        timeControl: { initialMs: 60_000, incrementMs: 1_000 },
      },
    );

    assert.deepEqual(requestedTimeControl, { initialMs: 60_000, incrementMs: 1_000 });
    assert.equal(response.status, 201);
    assert.deepEqual(responseJson(response), {
      roomId: 'dmxq_timed',
      url: '/room/dmxq_timed',
      mode: 'pvp',
      gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      rated: false,
      region: 'global',
      timeControl: { initialMs: 60_000, incrementMs: 1_000 },
    });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route rejects an invalid time control', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkMiniXiangqiCreate(
      testContext({
        createDarkMiniXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkMiniXiangqiRoom('dmxq_unreachable') };
        },
      }),
      response,
      {
        gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
        mode: 'pvp',
        timeControl: { initialMs: 'lots', incrementMs: 2_000 },
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(responseJson(response), { error: 'invalid_time_control' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Mini Xiangqi room route maps room factory failures', async () => {
  const before = process.env[darkMiniXiangqiFlag];
  process.env[darkMiniXiangqiFlag] = 'true';
  try {
    for (const { error, status } of [
      { error: 'dark_mini_xiangqi_disabled' as const, status: 404 },
      { error: 'persistence_failure' as const, status: 503 },
      { error: 'room_id_collision' as const, status: 500 },
    ]) {
      const response = captureResponse();
      await handleDarkMiniXiangqiCreate(
        testContext({
          createDarkMiniXiangqiRoom: async () => ({ ok: false, error }),
        }),
        response,
        { gameSpecId: DARK_MINI_XIANGQI_SPEC_ID, mode: 'pvp' },
      );

      assert.equal(response.status, status);
      assert.deepEqual(responseJson(response), { error });
    }
  } finally {
    restoreFlag(before);
  }
});

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {},
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
  return capture as ServerResponse & ResponseCapture;
}

function responseJson(response: ResponseCapture): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function testContext(
  overrides: Partial<DarkMiniXiangqiCreateContext> = {},
): DarkMiniXiangqiCreateContext {
  return {
    createDarkMiniXiangqiRoom: async () => ({
      ok: true,
      room: darkMiniXiangqiRoom('dmxq_route'),
    }),
    databaseRequired: false,
    drainDeadlineMs: () => null,
    isDraining: () => false,
    reserveLiveEngineSeat: async () => null,
    ...overrides,
  };
}

function darkMiniXiangqiRoom(roomId: string): DarkMiniXiangqiRuntimeRoom {
  return {
    kind: 'dark-mini-xiangqi',
    id: roomId,
    clients: new Set(),
    events: [
      {
        type: 'room-created',
        at: 1,
        roomId,
        gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      },
    ],
    projection: {
      roomId,
      gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
      rated: false,
      state: {
        id: roomId,
        board: {},
        status: { type: 'playing', turn: 'red' },
        moveNumber: 1,
        progressClock: 0,
        positionCounts: {},
      },
      seats: {},
    },
    gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
    rated: false,
    abortTimer: null,
    abortDeadline: null,
    abortPhase: null,
    clockTimer: null,
    forfeitTimer: null,
    actionTimer: null,
    forfeitDeadline: null,
    forfeitSeat: null,
    gameEndRecorded: false,
    pendingWrites: Promise.resolve(),
    seatTokens: {},
    rematch: { offers: {} },
    engineTimer: null,
    engineReservationId: null,
    pveBotId: null,
  };
}

function restoreRatedFlag(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[ratedFlag];
  } else {
    process.env[ratedFlag] = value;
  }
}

function testUser(): UserAccount {
  const now = new Date('2026-06-07T00:00:00.000Z');
  return {
    id: 'user_dmx_rated',
    email: 'rated@example.com',
    emailVerifiedAt: now,
    handle: 'rated-player',
    handleChangedAt: null,
    displayName: 'Rated Player',
    displayNameChangedAt: null,
    bio: '',
    location: '',
    profileLinks: [],
    displayPreferences: {},
    accountPreferences: DEFAULT_ACCOUNT_PREFERENCES,
    profileVisibility: 'public',
    accountRole: 'player',
    playDisabledAt: null,
    title: null,
    flair: null,
    locale: null,
    dmPolicy: 'always',
    eloRating: 1500,
    patronSince: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
}

function restoreFlag(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[darkMiniXiangqiFlag];
  } else {
    process.env[darkMiniXiangqiFlag] = value;
  }
}
