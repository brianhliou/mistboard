/**
 * Which Fog Xiangqi engine failures page and which are only counted.
 *
 * Lives in its own file because `engine-alert-email.ts` reads its config at module
 * load: the env has to be set before the first import, and node's test runner
 * gives each file its own process.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

process.env.RESEND_API_KEY = 'test-key-not-a-secret';
process.env.MISTBOARD_ALERT_EMAIL_FROM = 'ops@example.test';
process.env.MISTBOARD_ALERT_EMAIL_TO = 'oncall@example.test';
process.env.MISTBOARD_DARK_XIANGQI_ENABLED = 'true';

const { darkXiangqiTenant } = await import('./dark-xiangqi-tenant.js');
const { engineCounters } = await import('./obs.js');
const { playDarkXiangqiEngineMoveIfReady } = await import('./server-dark-xiangqi-engine.js');
const { appendTenantRuntimeEvent, createTenantRuntimeRoom } = await import(
  './variant-tenant/runtime.js'
);
type DarkXiangqiLiveRoom = import('./server-ws-dark-xiangqi.js').DarkXiangqiLiveRoom;
type DarkXiangqiEngineContext = import('./server-dark-xiangqi-engine.js').DarkXiangqiEngineContext;

// The incident's 500 body: the worker timed out on a 20M-position belief set.
const KNOWN_BODY = { error: 'internal_error', known_failure: 'fog-xiangqi-belief-timeout' };
const UNKNOWN_BODY = { error: 'internal_error' };

test('a known Fog Xiangqi belief timeout forfeits without paging, and is counted', async () => {
  const result = await runFailedTurn('dxq_known', KNOWN_BODY);
  assert.equal(result.lastEvent, 'seat-forfeited', 'the bot still forfeits');
  assert.equal(result.emails, 0, 'no alert email');
  assert.equal(result.fallbacks, 0, 'no fallback, so no critical engine alert on the tick');
  assert.equal(result.knownFailures, 1);
});

test('any other Fog Xiangqi engine 500 still pages', async () => {
  const result = await runFailedTurn('dxq_unknown', UNKNOWN_BODY);
  assert.equal(result.lastEvent, 'seat-forfeited');
  assert.equal(result.emails, 1, 'the forfeit email is sent');
  assert.equal(result.fallbacks, 1);
  assert.equal(result.knownFailures, 0);
});

async function runFailedTurn(
  roomId: string,
  body: Record<string, unknown>,
): Promise<{
  lastEvent: string | undefined;
  emails: number;
  fallbacks: number;
  knownFailures: number;
}> {
  const service = createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await listen(service);
  const realFetch = globalThis.fetch;
  let emails = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).startsWith('https://api.resend.com/')) {
      emails += 1;
      return new Response('{}', { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  process.env.MISTBOARD_INTERNAL_ENGINE_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  process.env.MISTBOARD_INTERNAL_ENGINE_TOKEN = 'test-token';
  const fallbacksBefore = engineCounters.totalFallbacks;
  const knownBefore = engineCounters.totalKnownFailures;
  try {
    const room = pveRoom(roomId);
    await playDarkXiangqiEngineMoveIfReady(engineCtx(room), room);
    // The forfeit email is fire-and-forget; let it reach fetch.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      lastEvent: room.events.at(-1)?.type,
      emails,
      fallbacks: engineCounters.totalFallbacks - fallbacksBefore,
      knownFailures: engineCounters.totalKnownFailures - knownBefore,
    };
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => service.close(() => resolve()));
  }
}

function pveRoom(roomId: string): DarkXiangqiLiveRoom {
  const created = createTenantRuntimeRoom(darkXiangqiTenant, roomId);
  if (!created.ok) throw new Error('room create failed');
  const room = created.room;
  appendTenantRuntimeEvent(darkXiangqiTenant, room, {
    type: 'seat-assigned',
    at: 1,
    roomId: room.id,
    clientId: 'python-fdx-v1.2',
    seat: 'red',
  });
  appendTenantRuntimeEvent(darkXiangqiTenant, room, {
    type: 'seat-assigned',
    at: 2,
    roomId: room.id,
    clientId: 'human',
    seat: 'black',
  });
  return room as DarkXiangqiLiveRoom;
}

function engineCtx(room: DarkXiangqiLiveRoom): DarkXiangqiEngineContext {
  return {
    appendEvent: async (_room, event) => appendTenantRuntimeEvent(darkXiangqiTenant, room, event),
    broadcastEventAppended: () => {},
    now: () => 1_000,
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}
