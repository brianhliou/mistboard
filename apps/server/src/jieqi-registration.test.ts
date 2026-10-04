/**
 * Jieqi registration: the tenant is reachable through the shared dispatch layer
 * (registry routing by spec id and room prefix, the POST /api/rooms create flow)
 * and a created room is a real, hydratable live room whose event log carries the
 * server-secret deal.
 */

import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { JIEQI_SPEC_ID } from '@mistboard/game';
import { createJieqiRoom, getOrLoadJieqiRoom, jieqiRooms } from './jieqi-registration.js';
import { handleJieqiCreate, type JieqiCreateContext, requestsJieqi } from './routes/jieqi-rooms.js';
import { variantTenantForRoomId, variantTenantForSpecId } from './variant-tenant/registry.js';

const jieqiFlag = 'MISTBOARD_JIEQI_ENABLED';

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

function createContext(): JieqiCreateContext {
  return {
    databaseRequired: false,
    isDraining: () => false,
    drainDeadlineMs: () => null,
    createJieqiRoom,
  };
}

test('jieqi routes by spec id and room-id prefix through the registry', () => {
  assert.equal(variantTenantForSpecId(JIEQI_SPEC_ID)?.kind, 'jieqi');
  assert.equal(variantTenantForRoomId('jq_whatever')?.kind, 'jieqi');
  assert.equal(variantTenantForRoomId('dmxq_x')?.kind === 'jieqi', false);
});

test('requestsJieqi claims only canonical jieqi spec requests', () => {
  assert.equal(requestsJieqi({ gameSpecId: JIEQI_SPEC_ID }), true);
  assert.equal(requestsJieqi({ variant: JIEQI_SPEC_ID }), false);
  assert.equal(requestsJieqi({ gameSpecId: 'dark-xiangqi' }), false);
});

test('jieqi create works when the launch flag is enabled', async () => {
  await withJieqiFlag(async () => {
    const response = captureResponse();
    await handleJieqiCreate(createContext(), response, {
      gameSpecId: JIEQI_SPEC_ID,
      mode: 'pvp',
    });
    assert.equal(response.status, 201);
    assert.equal(responseJson(response).gameSpecId, JIEQI_SPEC_ID);
    jieqiRooms.clear();
  });
});

test('jieqi create rejects unsupported surfaces before creating a room', async () => {
  await withJieqiFlag(async () => {
    // A bot game is never rated (rated friend rooms: variant-tenant/lobby-rated.test.ts).
    const response = captureResponse();
    await handleJieqiCreate(createContext(), response, {
      gameSpecId: JIEQI_SPEC_ID,
      mode: 'pve',
      rated: true,
    });
    assert.equal(response.status, 501);
    assert.deepEqual(responseJson(response), { error: 'jieqi_unsupported_surface' });
  });
});

test('jieqi create makes a hostable room that hydrates back with its deal', async () => {
  await withJieqiFlag(async () => {
    const response = captureResponse();
    await handleJieqiCreate(createContext(), response, { gameSpecId: JIEQI_SPEC_ID, mode: 'pvp' });
    assert.equal(response.status, 201);
    const body = responseJson(response);
    const roomId = body.roomId as string;
    assert.ok(roomId.startsWith('jq_'));
    assert.equal(body.gameSpecId, JIEQI_SPEC_ID);

    const room = await getOrLoadJieqiRoom(roomId);
    assert.ok(room, 'the created room is live and hydratable');
    const created = room.events[0];
    assert.equal(created.type, 'room-created');
    if (created.type === 'room-created') {
      assert.ok(created.setup, 'the server-secret deal is persisted in the room log');
    }
    jieqiRooms.clear();
  });
});

async function withJieqiFlag(fn: () => Promise<void>): Promise<void> {
  const previous = process.env[jieqiFlag];
  process.env[jieqiFlag] = 'true';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env[jieqiFlag];
    else process.env[jieqiFlag] = previous;
  }
}
