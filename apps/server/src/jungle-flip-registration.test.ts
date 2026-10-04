/**
 * Flip Jungle registration: the symmetric hidden-identity tenant is reachable through
 * the shared dispatch layer (registry routing by spec id and room prefix, the POST
 * /api/rooms create flow) and a created room is a real, hydratable live room whose
 * event log carries the server-secret deal, with all 16 tiles face-down at the start.
 */

import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { JUNGLE_FLIP_SPEC_ID } from '@mistboard/game';
import {
  createJungleFlipRoom,
  getOrLoadJungleFlipRoom,
  jungleFlipRooms,
} from './jungle-flip-registration.js';
import {
  handleJungleFlipCreate,
  type JungleFlipCreateContext,
  requestsJungleFlip,
} from './routes/jungle-flip-rooms.js';
import { variantTenantForRoomId, variantTenantForSpecId } from './variant-tenant/registry.js';

const flag = 'MISTBOARD_JUNGLE_FLIP_ENABLED';

type ResponseCapture = { body: string; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
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

function createContext(): JungleFlipCreateContext {
  return {
    databaseRequired: false,
    isDraining: () => false,
    drainDeadlineMs: () => null,
    createJungleFlipRoom,
  };
}

test('flip jungle routes by spec id and room-id prefix through the registry', () => {
  assert.equal(variantTenantForSpecId(JUNGLE_FLIP_SPEC_ID)?.kind, 'jungle-flip');
  assert.equal(variantTenantForRoomId('jgf_whatever')?.kind, 'jungle-flip');
  assert.equal(variantTenantForRoomId('jgl_x')?.kind === 'jungle-flip', false);
});

test('requestsJungleFlip claims only canonical flip-jungle spec requests', () => {
  assert.equal(requestsJungleFlip({ gameSpecId: JUNGLE_FLIP_SPEC_ID }), true);
  assert.equal(requestsJungleFlip({ variant: JUNGLE_FLIP_SPEC_ID }), false);
  assert.equal(requestsJungleFlip({ gameSpecId: 'jungle' }), false);
});

test('flip jungle create is gated off by default', async () => {
  const previous = process.env[flag];
  delete process.env[flag];
  try {
    const response = captureResponse();
    await handleJungleFlipCreate(createContext(), response, {
      gameSpecId: JUNGLE_FLIP_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(response.status, 404);
    assert.deepEqual(responseJson(response), { error: 'jungle_flip_disabled' });
  } finally {
    if (previous !== undefined) process.env[flag] = previous;
  }
});

test('flip jungle create rejects a rated bot game', async () => {
  await withFlag(async () => {
    // Rated friend rooms are covered for every tenant in variant-tenant/lobby-rated.test.ts.
    const response = captureResponse();
    await handleJungleFlipCreate(createContext(), response, {
      gameSpecId: JUNGLE_FLIP_SPEC_ID,
      mode: 'pve',
      rated: true,
    });
    assert.equal(response.status, 501);
    assert.deepEqual(responseJson(response), { error: 'jungle_flip_unsupported_surface' });
  });
});

test('flip jungle PvE seats the MistyJungleFlip engine opposite the human', async () => {
  await withFlag(async () => {
    const response = captureResponse();
    // Human takes 'red' (first mover), so the engine takes 'black'.
    await handleJungleFlipCreate(createContext(), response, {
      gameSpecId: JUNGLE_FLIP_SPEC_ID,
      mode: 'pve',
      preferredColor: 'red',
    });
    assert.equal(response.status, 201);
    const roomId = responseJson(response).roomId as string;
    const room = await getOrLoadJungleFlipRoom(roomId);
    assert.ok(room, 'the PvE room is live and hydratable');
    assert.equal(room.projection.seats.black, 'misty-jungle-flip');
    assert.notEqual(room.projection.seats.red, 'misty-jungle-flip');
  });
});

test('flip jungle PvE rejects an unknown engine id', async () => {
  await withFlag(async () => {
    const response = captureResponse();
    await handleJungleFlipCreate(createContext(), response, {
      gameSpecId: JUNGLE_FLIP_SPEC_ID,
      mode: 'pve',
      engineId: 'not-a-real-engine',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(responseJson(response), { error: 'invalid_engine' });
  });
});

test('flip jungle create makes a hostable room that hydrates back with its deal, all face-down', async () => {
  await withFlag(async () => {
    const response = captureResponse();
    await handleJungleFlipCreate(createContext(), response, {
      gameSpecId: JUNGLE_FLIP_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(response.status, 201);
    const body = responseJson(response);
    const roomId = body.roomId as string;
    assert.ok(roomId.startsWith('jgf_'));
    assert.equal(body.gameSpecId, JUNGLE_FLIP_SPEC_ID);

    const room = await getOrLoadJungleFlipRoom(roomId);
    assert.ok(room, 'the created room is live and hydratable');
    const created = room.events[0];
    assert.equal(created.type, 'room-created');
    if (created.type === 'room-created') {
      assert.ok(created.setup, 'the server-secret deal is persisted in the room log');
    }
    const board = room.projection.state.board;
    assert.equal(Object.keys(board).length, 16);
    assert.ok(
      Object.values(board).every((p) => p?.faceDown),
      'all 16 tiles start face-down',
    );
    jungleFlipRooms.clear();
  });
});

async function withFlag(fn: () => Promise<void>): Promise<void> {
  const previous = process.env[flag];
  process.env[flag] = 'true';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env[flag];
    else process.env[flag] = previous;
  }
}
