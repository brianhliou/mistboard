/**
 * The variant-agnostic admin artifacts reader.
 *
 * The rule this file pins is the one the xiangqi route gets wrong: an id naming
 * no finished game is a 404, NOT `{artifacts: []}`. An empty 200 for any string
 * you can type collapses "wrong route", "no such game", and "this game predates
 * the instrumentation" into "this engine recorded nothing" — which is how a
 * missing-instrumentation problem got investigated as an engine bug.
 *
 * The second rule is that this route does NOT filter by variant: banqi, jungle,
 * flip jungle, jieqi and fortress all read through it, and a spec-id check here
 * would be the first step back toward five per-variant copies.
 */

import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import test from 'node:test';
import type { GameDebugArtifactPayload, RecentEveGameRecord } from '../persistence.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from '../persistence-game-lifecycle.js';
import {
  type AdminGameArtifactsPersistence,
  adminGameArtifactsForApi,
  tryHandle,
} from './admin-game-artifacts.js';
import type { HttpApiContext } from './lib.js';

const ROOM_ID = 'banqi_artifacts';

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: 'banqi',
    mode: 'pve',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 4,
    startedAt: new Date(1),
    endedAt: new Date(5),
    whiteName: null,
    blackName: null,
    participants: [],
    ...overrides,
  } as RecentEveGameRecord;
}

function artifact(ply: number): GameDebugArtifactPayload {
  return {
    id: 100 + ply,
    gameId: ROOM_ID,
    ply,
    engineColor: null,
    artifactType: LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    payload: { ply, movetime_ms: 8_000, tier_nodes: 1_500_000, search: { nodes: 26_400 } },
    createdAt: new Date(10 + ply),
  } as GameDebugArtifactPayload;
}

function deps(over: Partial<AdminGameArtifactsPersistence> = {}): AdminGameArtifactsPersistence {
  return {
    isPersistenceEnabled: () => true,
    getGameSummary: async () => gameRecord(),
    listArtifacts: async () => [artifact(0), artifact(2)],
    ...over,
  };
}

test('admin artifacts: a finished game returns its queued decisions', async () => {
  const payload = await adminGameArtifactsForApi(
    ROOM_ID,
    LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    deps(),
  );
  assert.ok(payload, 'a real game must not 404');
  assert.equal(payload.roomId, ROOM_ID);
  assert.equal(payload.variant, 'banqi');
  assert.equal(payload.artifactType, LIVE_ENGINE_DECISION_ARTIFACT_TYPE);
  assert.deepEqual(
    payload.artifacts.map((a) => a.ply),
    [0, 2],
  );
  // createdAt is serialized for the wire, not left as a Date.
  assert.equal(typeof payload.artifacts[0]?.createdAt, 'string');
});

test('admin artifacts: any variant reads through the same route', async () => {
  for (const variant of ['jungle', 'jungle-flip', 'jieqi', 'fortress-xiangqi', 'xiangqi']) {
    const payload = await adminGameArtifactsForApi(
      `${variant}_room`,
      LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
      deps({ getGameSummary: async () => gameRecord({ variant }) }),
    );
    assert.ok(payload, `${variant} must be readable through the shared route`);
    assert.equal(payload.variant, variant);
  }
});

test('admin artifacts: an unknown room id is a 404, not an empty list', async () => {
  const payload = await adminGameArtifactsForApi(
    'totally-bogus-room',
    LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    deps({ getGameSummary: async () => null }),
  );
  assert.equal(payload, null);
});

test('admin artifacts: a game with no decisions returns an EMPTY list, not a 404', async () => {
  // The other half of the same rule: 404 means "no such game", so a real game
  // that recorded nothing has to be distinguishable from one that never existed.
  const payload = await adminGameArtifactsForApi(
    ROOM_ID,
    LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    deps({ listArtifacts: async () => [] }),
  );
  assert.ok(payload);
  assert.deepEqual(payload.artifacts, []);
});

test('admin artifacts: an unknown artifact type is refused, never served empty', async () => {
  const unknown = await adminGameArtifactsForApi(ROOM_ID, 'not-a-real-artifact-type', deps());
  assert.equal(unknown, null);
  const empty = await adminGameArtifactsForApi(ROOM_ID, '', deps());
  assert.equal(empty, null);
});

test('admin artifacts: no persistence is a 404 rather than a false empty', async () => {
  const payload = await adminGameArtifactsForApi(
    ROOM_ID,
    LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
    deps({
      isPersistenceEnabled: () => false,
      getGameSummary: async () => {
        throw new Error('persistence must not be queried when disabled');
      },
    }),
  );
  assert.equal(payload, null);
});

test('admin artifacts: anonymous GETs return 401 before type or room-id validation', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    // The malformed type is the planted pre-auth validation regression.
    for (const search of ['', '?type=not-a-real-type', '?type=live-engine-decision']) {
      const request = new IncomingMessage(new Socket());
      request.method = 'GET';
      const response = new ServerResponse(request);
      let body = '';
      response.end = ((chunk: string) => {
        body = chunk;
        return response;
      }) as typeof response.end;
      const pathname = '/api/admin/games/%INVALID/artifacts';
      assert.equal(
        await tryHandle(
          {} as HttpApiContext,
          request,
          response,
          pathname,
          new URL(`https://mistboard.test${pathname}${search}`),
        ),
        true,
      );
      assert.equal(response.statusCode, 401, search);
      assert.deepEqual(JSON.parse(body), { error: 'admin_required' });
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
