/**
 * Jungle registration: the perfect-information tenant is reachable through the
 * shared dispatch layer (registry routing by spec id and room prefix, the POST
 * /api/rooms create flow) and a created room is a real, hydratable live room that
 * starts from the canonical Jungle position with red (the first mover) to move.
 */

import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { JUNGLE_SPEC_ID } from '@mistboard/game';
import { createJungleRoom, getOrLoadJungleRoom, jungleRooms } from './jungle-registration.js';
import {
  handleJungleCreate,
  type JungleCreateContext,
  requestsJungle,
} from './routes/jungle-rooms.js';
import { JUNGLE_RETIRED_ENGINE_IDS } from './server-jungle-engine.js';
import { variantTenantForRoomId, variantTenantForSpecId } from './variant-tenant/registry.js';

const jungleFlag = 'MISTBOARD_JUNGLE_ENABLED';

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

function createContext(): JungleCreateContext {
  return {
    databaseRequired: false,
    isDraining: () => false,
    drainDeadlineMs: () => null,
    createJungleRoom,
  };
}

test('jungle routes by spec id and room-id prefix through the registry', () => {
  assert.equal(variantTenantForSpecId(JUNGLE_SPEC_ID)?.kind, 'jungle');
  assert.equal(variantTenantForRoomId('jgl_whatever')?.kind, 'jungle');
  assert.equal(variantTenantForRoomId('jq_x')?.kind === 'jungle', false);
});

test('requestsJungle claims only canonical jungle spec requests', () => {
  assert.equal(requestsJungle({ gameSpecId: JUNGLE_SPEC_ID }), true);
  assert.equal(requestsJungle({ variant: JUNGLE_SPEC_ID }), false);
  assert.equal(requestsJungle({ gameSpecId: 'banqi' }), false);
});

test('jungle create is gated off by default', async () => {
  const previous = process.env[jungleFlag];
  delete process.env[jungleFlag];
  try {
    const response = captureResponse();
    await handleJungleCreate(createContext(), response, {
      gameSpecId: JUNGLE_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(response.status, 404);
    assert.deepEqual(responseJson(response), { error: 'jungle_disabled' });
  } finally {
    if (previous !== undefined) process.env[jungleFlag] = previous;
  }
});

test('jungle create rejects a rated bot game but accepts PvE vs the bot', async () => {
  await withJungleFlag(async () => {
    const rated = captureResponse();
    await handleJungleCreate(createContext(), rated, {
      gameSpecId: JUNGLE_SPEC_ID,
      mode: 'pve',
      rated: true,
    });
    assert.equal(rated.status, 501);
    assert.deepEqual(responseJson(rated), { error: 'jungle_unsupported_surface' });

    const badEngine = captureResponse();
    await handleJungleCreate(createContext(), badEngine, {
      gameSpecId: JUNGLE_SPEC_ID,
      mode: 'pve',
      engineId: 'not-a-jungle-engine',
    });
    assert.equal(badEngine.status, 400);
    assert.deepEqual(responseJson(badEngine), { error: 'invalid_engine' });

    // Retired rungs are the case that matters: they are still REAL engine ids the
    // runtime recognises for finished games, so a create gate keyed on "is this an
    // engine?" would happily seat one. Jungle ships one bot; the API must say so, not
    // just the picker.
    for (const retired of JUNGLE_RETIRED_ENGINE_IDS) {
      const response = captureResponse();
      await handleJungleCreate(createContext(), response, {
        gameSpecId: JUNGLE_SPEC_ID,
        mode: 'pve',
        engineId: retired,
      });
      assert.equal(response.status, 400, `${retired} must not be creatable`);
      assert.deepEqual(responseJson(response), { error: 'invalid_engine' });
    }

    const pve = captureResponse();
    await handleJungleCreate(createContext(), pve, { gameSpecId: JUNGLE_SPEC_ID, mode: 'pve' });
    assert.equal(pve.status, 201);
    assert.equal(responseJson(pve).mode, 'pve');
    jungleRooms.clear();
  });
});

test('jungle create makes a hostable room that hydrates back at the start position', async () => {
  await withJungleFlag(async () => {
    const response = captureResponse();
    await handleJungleCreate(createContext(), response, {
      gameSpecId: JUNGLE_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(response.status, 201);
    const body = responseJson(response);
    const roomId = body.roomId as string;
    assert.ok(roomId.startsWith('jgl_'));
    assert.equal(body.gameSpecId, JUNGLE_SPEC_ID);

    const room = await getOrLoadJungleRoom(roomId);
    assert.ok(room, 'the created room is live and hydratable');
    assert.equal(room.events[0]?.type, 'room-created');
    // Perfect-information tenant: no server-secret setup in the log.
    if (room.events[0]?.type === 'room-created') {
      assert.equal(room.events[0].setup, undefined);
    }
    // The projection holds the canonical opening position, red to move.
    assert.deepEqual(room.projection.state.status, { type: 'playing', turn: 'red' });
    assert.deepEqual(room.projection.state.board.a1, { color: 'red', role: 'lion' });
    assert.equal(Object.keys(room.projection.state.board).length, 16);
    jungleRooms.clear();
  });
});

async function withJungleFlag(fn: () => Promise<void>): Promise<void> {
  const previous = process.env[jungleFlag];
  process.env[jungleFlag] = 'true';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env[jungleFlag];
    else process.env[jungleFlag] = previous;
  }
}
