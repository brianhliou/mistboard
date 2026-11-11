import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { BANQI_SPEC_ID, STANDARD_BANQI_DEAL } from '@mistboard/game';
import { createBanqiFinalRevealRoutes } from './banqi-final-reveal.js';
import type { BanqiEvent } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';

const id = 'bq_reveal';
const events: BanqiEvent[] = [
  {
    type: 'room-created',
    at: 1,
    roomId: id,
    gameSpecId: BANQI_SPEC_ID,
    setup: STANDARD_BANQI_DEAL,
  },
  { type: 'seat-assigned', at: 2, roomId: id, clientId: 'r', seat: 'red' },
  { type: 'seat-assigned', at: 3, roomId: id, clientId: 'b', seat: 'black' },
  { type: 'move-played', at: 4, roomId: id, color: 'red', move: { from: 'a1', to: 'a1' } },
  { type: 'seat-resigned', at: 5, roomId: id, color: 'black' },
];
function record(log = events): RecentEveGameRecord {
  const hydrated = createTenantRuntimeRoomFromEvents(banqiTenant, log);
  assert.ok(hydrated.ok);
  return {
    ...buildTenantGameSummary(banqiTenant, hydrated.room),
    roomId: id,
    mode: 'pvp',
    rated: false,
    visibility: 'public',
    participants: [],
    initialMs: null,
    incrementMs: null,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
  };
}
async function request(
  game = record() as RecentEveGameRecord | null,
  log: BanqiEvent[] | null = events,
  method = 'GET',
) {
  const handler = createBanqiFinalRevealRoutes({
    enabled: () => true,
    persistenceReady: () => true,
    store: { getGameSummary: async () => game, loadRoomEvents: async () => log },
  });
  const response = {
    status: 0,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead(status: number) {
      this.status = status;
      return this;
    },
    end(body = '') {
      this.body = body;
      return this;
    },
  };
  assert.equal(
    await handler(
      { method } as IncomingMessage,
      response as unknown as ServerResponse,
      `/api/banqi/games/${id}/reveal`,
    ),
    true,
  );
  return response;
}
test('final reveal requires consistent persisted finalization and exposes only one final view', async () => {
  const head = await request(record(), events, 'HEAD');
  assert.equal(head.status, 204);
  assert.equal(head.body, '');
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const payload = JSON.parse(response.body);
  assert.deepEqual(Object.keys(payload).sort(), ['finalizedAt', 'roomId', 'view']);
  assert.equal(payload.view.id, id);
  assert.equal(payload.view.status.type, 'finished');
  assert.equal(Object.keys(payload.view.board).length, 32);
  for (const piece of Object.values(payload.view.board) as { faceDown: boolean; role: string }[]) {
    assert.equal(piece.faceDown, false);
    assert.equal(typeof piece.role, 'string');
  }
  assert.doesNotMatch(response.body, /"setup"|"history"|"events"/);
});
test('summary and event-log races, private provider games and mismatches never disclose identities', async () => {
  const badRecords: (RecentEveGameRecord | null)[] = [
    null,
    { ...record(), visibility: 'private' },
    { ...record(), result: 'draw' },
    { ...record(), termination: 'other' },
    { ...record(), endedAt: new Date(6) },
    { ...record(), plyCount: 0 },
    { ...record(), roomId: 'other' },
  ];
  for (const game of badRecords) {
    const response = await request(game);
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
    const head = await request(game, events, 'HEAD');
    assert.equal(head.status, 404);
    assert.equal(head.body, '');
  }
  for (const log of [events.slice(0, -1), null, []]) {
    const response = await request(record(), log);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.body, /"role"|"color"|"board"|"setup"/);
  }
  assert.equal((await request(record(), events, 'POST')).status, 405);
});
test('summary uses production ending anchor and tolerates later non-game metadata', async () => {
  const metadata: BanqiEvent = {
    type: 'seat-assigned',
    roomId: id,
    at: 6,
    clientId: 'r2',
    seat: 'red',
  };
  const recorded = [...events, metadata];
  const game = record(recorded);
  assert.equal(game.endedAt.getTime(), 6);
  const later: BanqiEvent = { ...metadata, at: 7, clientId: 'r3' };
  assert.equal((await request(game, [...recorded, later])).status, 200);
});
test('a natural terminal move is finalized without a synthetic ending event', async () => {
  const natural = readFileSync(
    new URL('../fixtures/variant-postgame/banqi.jsonl', import.meta.url),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => ({ ...JSON.parse(line), roomId: id })) as BanqiEvent[];
  assert.equal(natural.at(-1)?.type, 'move-played');
  const game = record(natural);
  assert.equal((await request(game, natural)).status, 200);
  const later: BanqiEvent = {
    type: 'seat-assigned',
    roomId: id,
    at: game.endedAt.getTime() + 1,
    clientId: 'r2',
    seat: 'red',
  };
  assert.equal((await request(game, [...natural, later])).status, 200);
});
