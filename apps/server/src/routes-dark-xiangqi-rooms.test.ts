import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { DARK_XIANGQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import type { DarkXiangqiRuntimeRoom } from './dark-xiangqi-runtime.js';
import {
  type DarkXiangqiCreateContext,
  darkXiangqiPveHumanColor,
  handleDarkXiangqiCreate,
  requestsDarkXiangqi,
} from './routes/dark-xiangqi-rooms.js';

const darkXiangqiFlag = 'MISTBOARD_DARK_XIANGQI_ENABLED';

type ResponseCapture = {
  body: string;
  headers: Record<string, string>;
  status: number | null;
};

test('Dark Xiangqi room route only claims canonical Dark Xiangqi game spec requests', () => {
  assert.equal(requestsDarkXiangqi({ gameSpecId: DARK_XIANGQI_SPEC_ID }), true);
  assert.equal(requestsDarkXiangqi({ variant: DARK_XIANGQI_SPEC_ID }), false);
  assert.equal(requestsDarkXiangqi({ gameSpecId: 'dark-chess' }), false);
  assert.equal(requestsDarkXiangqi({ variant: 'dark-chess' }), false);
});

test('Dark Xiangqi room route returns disabled when the launch flag is off', async () => {
  const before = process.env[darkXiangqiFlag];
  delete process.env[darkXiangqiFlag];
  try {
    const response = captureResponse();
    await handleDarkXiangqiCreate(testContext(), response, {
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      mode: 'pvp',
    });

    assert.equal(response.status, 404);
    assert.deepEqual(responseJson(response), { error: 'dark_xiangqi_disabled' });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route rejects legacy variant requests when the flag is on', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    const response = captureResponse();
    await handleDarkXiangqiCreate(testContext(), response, {
      mode: 'pvp',
      variant: DARK_XIANGQI_SPEC_ID,
    });

    assert.equal(response.status, 501);
    assert.deepEqual(responseJson(response), { error: 'dark_xiangqi_not_integrated' });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route rejects unsupported create surfaces before room creation', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    for (const body of [
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'bogus' },
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pvp', rated: true },
      { engineId: 'engine', gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pvp' },
    ]) {
      let createCalls = 0;
      const response = captureResponse();
      await handleDarkXiangqiCreate(
        testContext({
          createDarkXiangqiRoom: async () => {
            createCalls += 1;
            return { ok: true, room: darkXiangqiRoom('dxq_unreachable') };
          },
        }),
        response,
        body,
      );

      assert.equal(response.status, 501);
      assert.deepEqual(responseJson(response), { error: 'dark_xiangqi_unsupported_surface' });
      assert.equal(createCalls, 0);
    }
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi PvE color selection honors random and explicit black', () => {
  assert.equal(darkXiangqiPveHumanColor(undefined), 'red');
  assert.equal(darkXiangqiPveHumanColor('red'), 'red');
  assert.equal(darkXiangqiPveHumanColor('black'), 'black');
  assert.equal(darkXiangqiPveHumanColor('random', 0), 'red');
  assert.equal(darkXiangqiPveHumanColor('random', 255), 'black');
});

test('Dark Xiangqi PvE route seats the default engine opposite the human', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let requestedEngine: unknown;
    let reservedColor: string | undefined;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async (_engineId, color) => {
          reservedColor = color;
          return 'reservation-dxq';
        },
        createDarkXiangqiRoom: async (_timeControl, _creatorPreference, engine) => {
          requestedEngine = engine;
          return { ok: true, room: darkXiangqiRoom('dxq_pve') };
        },
      }),
      response,
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pve', preferredColor: 'red' },
    );

    assert.equal(reservedColor, 'black');
    assert.deepEqual(requestedEngine, {
      engineId: 'python-fdx-v1.2',
      seat: 'black',
      reservationId: 'reservation-dxq',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(responseJson(response), {
      roomId: 'dxq_pve',
      url: '/room/dxq_pve',
      mode: 'pve',
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      region: 'global',
      // The request named no pace, so the bot default supplied one and the
      // response reports it instead of staying silent about the clock.
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi PvE route carries bot id and seats engine opposite human black', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let requestedEngine: unknown;
    let reservedColor: string | undefined;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async (_engineId, color) => {
          reservedColor = color;
          return 'reservation-red';
        },
        createDarkXiangqiRoom: async (_timeControl, _creatorPreference, engine) => {
          requestedEngine = engine;
          return { ok: true, room: darkXiangqiRoom('dxq_pve_black') };
        },
      }),
      response,
      {
        botId: 'misty-dxq',
        engineId: 'python-fdx-v1.0',
        gameSpecId: DARK_XIANGQI_SPEC_ID,
        mode: 'pve',
        preferredColor: 'black',
      },
    );

    assert.equal(reservedColor, 'white');
    assert.deepEqual(requestedEngine, {
      engineId: 'python-fdx-v1.0',
      seat: 'red',
      reservationId: 'reservation-red',
      botId: 'misty-dxq',
    });
    assert.equal(response.status, 201);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi PvE route returns 503 when no engine seat is available', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        reserveLiveEngineSeat: async () => null,
        createDarkXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkXiangqiRoom('dxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pve' },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(responseJson(response), { error: 'engine_unavailable' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi PvE route rejects an unknown engineId before room creation', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        createDarkXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkXiangqiRoom('dxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pve', engineId: 'not-dxq' },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(responseJson(response), { error: 'invalid_engine' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route accepts valid PvP time controls', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let requestedTimeControl: unknown;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        createDarkXiangqiRoom: async (timeControl) => {
          requestedTimeControl = timeControl;
          return { ok: true, room: darkXiangqiRoom('dxq_clocked') };
        },
      }),
      response,
      {
        gameSpecId: DARK_XIANGQI_SPEC_ID,
        mode: 'pvp',
        timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      },
    );

    assert.equal(response.status, 201);
    assert.deepEqual(requestedTimeControl, { initialMs: 180_000, incrementMs: 2_000 });
    assert.deepEqual(responseJson(response), {
      roomId: 'dxq_clocked',
      url: '/room/dxq_clocked',
      mode: 'pvp',
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      region: 'global',
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route rejects invalid time controls before room creation', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    let createCalls = 0;
    const response = captureResponse();
    await handleDarkXiangqiCreate(
      testContext({
        createDarkXiangqiRoom: async () => {
          createCalls += 1;
          return { ok: true, room: darkXiangqiRoom('dxq_unreachable') };
        },
      }),
      response,
      { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pvp', timeControl: { id: '3m2' } },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(responseJson(response), { error: 'invalid_time_control' });
    assert.equal(createCalls, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route creates a direct PvP room response', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    const response = captureResponse();
    await handleDarkXiangqiCreate(testContext(), response, {
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      mode: 'pvp',
    });

    assert.equal(response.status, 201);
    assert.deepEqual(responseJson(response), {
      roomId: 'dxq_route',
      url: '/room/dxq_route',
      mode: 'pvp',
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      region: 'global',
    });
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route maps room factory failures', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    for (const { error, status } of [
      { error: 'dark_xiangqi_disabled' as const, status: 404 },
      { error: 'persistence_failure' as const, status: 503 },
      { error: 'room_id_collision' as const, status: 500 },
    ]) {
      const response = captureResponse();
      await handleDarkXiangqiCreate(
        testContext({
          createDarkXiangqiRoom: async () => ({ ok: false, error }),
        }),
        response,
        { gameSpecId: DARK_XIANGQI_SPEC_ID, mode: 'pvp' },
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

test('Dark Xiangqi room route refuses a bot game at a pace the engine cannot honor', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    // Fog engines have a per-move floor a 1s or 2s increment cannot cover, so
    // they lose on time in long games (#283); PvE needs a 5s increment until
    // the floor is bounded. Rejected BEFORE the engine seat reservation, so a
    // refused request never holds one.
    let reservations = 0;
    const ctx = testContext({
      reserveLiveEngineSeat: async () => {
        reservations += 1;
        return 'reservation';
      },
    });
    for (const timeControl of [
      { initialMs: 180_000, incrementMs: 2_000 },
      { initialMs: 60_000, incrementMs: 1_000 },
    ]) {
      const response = captureResponse();
      await handleDarkXiangqiCreate(ctx, response, {
        gameSpecId: DARK_XIANGQI_SPEC_ID,
        mode: 'pve',
        timeControl,
      });

      assert.equal(response.status, 400);
      assert.deepEqual(responseJson(response), { error: 'engine_time_control_unsupported' });
    }
    assert.equal(reservations, 0);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi PvE with no named pace starts at the bot default, not the house default', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    // Same resolution as the fog chess route: an omitted pace must not fall
    // through to the room factory's default clock, which is the house 3+2 (#283).
    const startedPaces: (RoomTimeControl | undefined)[] = [];
    const ctx = testContext({
      reserveLiveEngineSeat: async () => 'reservation',
      createDarkXiangqiRoom: async (timeControl) => {
        startedPaces.push(timeControl);
        return { ok: true, room: darkXiangqiRoom('dxq_defaulted') };
      },
    });

    const response = captureResponse();
    await handleDarkXiangqiCreate(ctx, response, {
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      mode: 'pve',
    });
    assert.equal(response.status, 201);
    // The response echoes the effective pace, so a caller that named none can
    // see what it actually got.
    assert.deepEqual(responseJson(response).timeControl, {
      initialMs: 600_000,
      incrementMs: 5_000,
    });

    // A human game with no named pace keeps the room factory default.
    const human = captureResponse();
    await handleDarkXiangqiCreate(ctx, human, {
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(human.status, 201);

    assert.deepEqual(startedPaces, [{ initialMs: 600_000, incrementMs: 5_000 }, undefined]);
  } finally {
    restoreFlag(before);
  }
});

test('Dark Xiangqi room route admits paces that clear the floor and leaves human games alone', async () => {
  const before = process.env[darkXiangqiFlag];
  process.env[darkXiangqiFlag] = 'true';
  try {
    const startedPaces: (RoomTimeControl | undefined)[] = [];
    const ctx = testContext({
      reserveLiveEngineSeat: async () => 'reservation',
      createDarkXiangqiRoom: async (timeControl) => {
        startedPaces.push(timeControl);
        return { ok: true, room: darkXiangqiRoom('dxq_paced') };
      },
    });

    for (const initialMs of [300_000, 600_000]) {
      const floored = captureResponse();
      await handleDarkXiangqiCreate(ctx, floored, {
        gameSpecId: DARK_XIANGQI_SPEC_ID,
        mode: 'pve',
        timeControl: { initialMs, incrementMs: 5_000 },
      });
      assert.equal(floored.status, 201, `${initialMs}+5000`);
    }

    // The same pace the bot is refused, between humans: the floor belongs to
    // the engine, not to the variant.
    const human = captureResponse();
    await handleDarkXiangqiCreate(ctx, human, {
      gameSpecId: DARK_XIANGQI_SPEC_ID,
      mode: 'pvp',
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    });
    assert.equal(human.status, 201);

    assert.deepEqual(startedPaces, [
      { initialMs: 300_000, incrementMs: 5_000 },
      { initialMs: 600_000, incrementMs: 5_000 },
      { initialMs: 180_000, incrementMs: 2_000 },
    ]);
  } finally {
    restoreFlag(before);
  }
});

function testContext(overrides: Partial<DarkXiangqiCreateContext> = {}): DarkXiangqiCreateContext {
  return {
    createDarkXiangqiRoom: async () => ({ ok: true, room: darkXiangqiRoom('dxq_route') }),
    databaseRequired: false,
    drainDeadlineMs: () => null,
    isDraining: () => false,
    reserveLiveEngineSeat: async () => null,
    ...overrides,
  };
}

function darkXiangqiRoom(id: string): DarkXiangqiRuntimeRoom {
  return {
    id,
    gameSpecId: DARK_XIANGQI_SPEC_ID,
  } as DarkXiangqiRuntimeRoom;
}

function restoreFlag(value: string | undefined): void {
  if (value === undefined) {
    delete process.env[darkXiangqiFlag];
    return;
  }
  process.env[darkXiangqiFlag] = value;
}
