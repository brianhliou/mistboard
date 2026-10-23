import assert from 'node:assert/strict';
import test from 'node:test';
import type { EngineTurnRequest, Move } from '@mistboard/game';
import { withKnownEngineFailure } from './engine-known-failures.js';
import { engineTurnPoolPayload, startEngineHttpService } from './engine-service.js';
import { engineCounters } from './obs.js';

const legalMove: Move = { from: 'e2', to: 'e4' };
const xiangqiLegalMove = { from: 'i10', to: 'i9' } as unknown as Move;

test('engine HTTP service requires auth and returns protocol response', async () => {
  let observedComputeBudget = 0;
  let observedTimeout = 0;
  let observedRequest: EngineTurnRequest | null = null;
  const service = await startEngineHttpService({
    port: 0,
    token: 'test-token',
    handler: async (request, watchdogTimeoutMs, computeBudgetMs) => {
      observedRequest = request;
      observedComputeBudget = computeBudgetMs;
      observedTimeout = watchdogTimeoutMs;
      return {
        protocolVersion: '1',
        gameId: request.gameId,
        sessionId: request.sessionId,
        move: legalMove,
        diagnostics: { decisionSource: 'test-handler' },
      };
    },
  });

  try {
    const unauthorized = await fetch(engineUrl(service.port), {
      method: 'POST',
      body: JSON.stringify(sampleRequest),
    });
    assert.equal(unauthorized.status, 401);

    const reservationId = await reserveSeat(service.port);
    const response = await fetch(engineUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-mistboard-engine-reservation-id': reservationId,
        'x-mistboard-engine-compute-budget-ms': '900',
        'x-mistboard-engine-timeout-ms': '2500',
      },
      body: JSON.stringify(sampleRequest),
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.deepEqual(observedRequest, sampleRequest);
    assert.equal(observedComputeBudget, 900);
    assert.equal(observedTimeout, 2500);
    assert.deepEqual(body, {
      protocolVersion: '1',
      gameId: sampleRequest.gameId,
      sessionId: sampleRequest.sessionId,
      move: legalMove,
      diagnostics: { decisionSource: 'test-handler' },
    });
  } finally {
    await service.close();
  }
});

test('engine HTTP service rejects turns without a matching reservation', async () => {
  const service = await startEngineHttpService({
    port: 0,
    token: 'test-token',
    handler: async (request) => ({
      protocolVersion: '1',
      gameId: request.gameId,
      sessionId: request.sessionId,
      move: legalMove,
    }),
  });

  try {
    const missing = await fetch(engineUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(sampleRequest),
    });
    assert.equal(missing.status, 409);

    const wrongColorReservationId = await reserveSeat(service.port, {
      color: 'white',
      engineId: sampleRequest.engineId,
    });
    const wrongColor = await fetch(engineUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-mistboard-engine-reservation-id': wrongColorReservationId,
      },
      body: JSON.stringify(sampleRequest),
    });
    assert.equal(wrongColor.status, 409);
  } finally {
    await service.close();
  }
});

test('engine HTTP service accepts full Xiangqi protocol coordinates', async () => {
  let observedRequest: EngineTurnRequest | null = null;
  const service = await startEngineHttpService({
    port: 0,
    token: 'test-token',
    handler: async (request) => {
      observedRequest = request;
      return {
        protocolVersion: '1',
        gameId: request.gameId,
        sessionId: request.sessionId,
        move: xiangqiLegalMove,
      };
    },
  });

  try {
    const reservationId = await reserveSeat(service.port, {
      color: sampleXiangqiRequest.color,
      engineId: sampleXiangqiRequest.engineId,
    });
    const response = await fetch(engineUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-mistboard-engine-reservation-id': reservationId,
      },
      body: JSON.stringify(sampleXiangqiRequest),
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.deepEqual(observedRequest, sampleXiangqiRequest);
    assert.deepEqual(body.move, xiangqiLegalMove);
  } finally {
    await service.close();
  }
});

test('engine HTTP service bounds admitted live engine seats', async () => {
  const service = await startEngineHttpService({
    liveEngineSeats: 1,
    poolSize: 1,
    port: 0,
    reservationTtlMs: 60_000,
    token: 'test-token',
    handler: async (request) => ({
      protocolVersion: '1',
      gameId: request.gameId,
      sessionId: request.sessionId,
      move: legalMove,
    }),
  });

  try {
    const first = await fetch(reservationsUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ engineId: sampleRequest.engineId, color: sampleRequest.color }),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(firstBody.capacity.activeSeats, 1);
    assert.equal(firstBody.capacity.maxSeats, 1);

    const second = await fetch(reservationsUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ engineId: sampleRequest.engineId, color: sampleRequest.color }),
    });
    assert.equal(second.status, 429);
    const secondBody = await second.json();
    assert.equal(secondBody.error, 'engine_capacity_full');
    assert.equal(secondBody.capacity.activeEngineSeats, 1);
    assert.equal(secondBody.capacity.availableEngineSeats, 0);

    await fetch(`${reservationsUrl(service.port)}/${firstBody.reservationId}/release`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'test' }),
    });

    const afterRelease = await fetch(capacityUrl(service.port), {
      headers: { authorization: 'Bearer test-token' },
    });
    assert.equal(afterRelease.status, 200);
    const capacity = await afterRelease.json();
    assert.equal(capacity.activeEngineSeats, 0);
    assert.equal(capacity.availableEngineSeats, 1);
  } finally {
    await service.close();
  }
});

test('engine HTTP service exposes unauthenticated health check', async () => {
  const service = await startEngineHttpService({
    port: 0,
    token: 'test-token',
    handler: async (request) => ({
      protocolVersion: '1',
      gameId: request.gameId,
      sessionId: request.sessionId,
      move: legalMove,
    }),
  });

  try {
    const response = await fetch(`http://127.0.0.1:${service.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'engine-worker' });
  } finally {
    await service.close();
  }
});

// Known failure signatures (engine-known-failures.ts) are counted, not paged: the
// worker names the signature in its 500 body and leaves the turns-failed counter
// (a critical alert on the next obs tick) alone.
async function failTurn(
  request: EngineTurnRequest,
  thrown: Error,
): Promise<{ status: number; body: unknown; turnsFailed: number; knownFailures: number }> {
  const service = await startEngineHttpService({
    port: 0,
    token: 'test-token',
    handler: async () => {
      throw thrown;
    },
  });
  const turnsFailedBefore = engineCounters.totalTurnsFailed;
  const knownBefore = engineCounters.totalKnownFailures;
  try {
    const reservationId = await reserveSeat(service.port, {
      color: request.color,
      engineId: request.engineId,
    });
    const response = await fetch(engineUrl(service.port), {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-mistboard-engine-reservation-id': reservationId,
      },
      body: JSON.stringify(request),
    });
    return {
      status: response.status,
      body: await response.json(),
      turnsFailed: engineCounters.totalTurnsFailed - turnsFailedBefore,
      knownFailures: engineCounters.totalKnownFailures - knownBefore,
    };
  } finally {
    await service.close();
  }
}

test('a pool-tagged Fog Xiangqi failure answers 500 with known_failure and does not page', async () => {
  // The incident's last error: the retry landed on the worker the timeout killed.
  const thrown = withKnownEngineFailure(
    new Error('worker 0 exited code=null'),
    'fog-xiangqi-belief-timeout',
  );
  const result = await failTurn(fogRequest, thrown);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: 'internal_error',
    known_failure: 'fog-xiangqi-belief-timeout',
  });
  assert.equal(result.turnsFailed, 0);
  assert.equal(result.knownFailures, 1);
});

test('a Fog Xiangqi timeout outside the pool is classified by the turn handler', async () => {
  const result = await failTurn(fogRequest, new Error('pool request timeout 60000ms'));
  assert.deepEqual(result.body, {
    error: 'internal_error',
    known_failure: 'fog-xiangqi-belief-timeout',
  });
  assert.equal(result.turnsFailed, 0);
  assert.equal(result.knownFailures, 1);
});

test('the same timeout on another variant still counts as a failed turn', async () => {
  const result = await failTurn(sampleRequest, new Error('pool request timeout 60000ms'));
  assert.deepEqual(result.body, { error: 'internal_error' });
  assert.equal(result.turnsFailed, 1);
  assert.equal(result.knownFailures, 0);
});

test('a Fog Xiangqi crash with no timeout still counts as a failed turn', async () => {
  const result = await failTurn(fogRequest, new Error('worker 0 exited code=1'));
  assert.deepEqual(result.body, { error: 'internal_error' });
  assert.equal(result.turnsFailed, 1);
  assert.equal(result.knownFailures, 0);
});

const sampleRequest: EngineTurnRequest = {
  protocolVersion: '1',
  gameId: 'game-1',
  engineId: 'python-tier1-v0.9.5',
  sessionId: 'game-1:python-tier1-v0.9.5:black',
  color: 'black',
  ply: 4,
  engineSeed: 123,
  clock: { remaining_ms: 180_000, increment_ms: 2_000 },
  legalMoves: [legalMove],
  observationTranscript: [],
};

const sampleXiangqiRequest: EngineTurnRequest = {
  protocolVersion: '1',
  gameId: 'dxq-game-1',
  engineId: 'python-fdx-v1.0',
  sessionId: 'dxq-game-1:python-fdx-v1.0:black',
  color: 'black',
  ply: 0,
  engineSeed: 321,
  clock: { remaining_ms: 180_000, increment_ms: 2_000 },
  legalMoves: [xiangqiLegalMove],
  observationTranscript: [],
};

const fogRequest: EngineTurnRequest = { ...sampleXiangqiRequest, gameSpecId: 'dark-xiangqi' };

function engineUrl(port: number): string {
  return `http://127.0.0.1:${port}/internal/engine/turn`;
}

function reservationsUrl(port: number): string {
  return `http://127.0.0.1:${port}/internal/engine/reservations`;
}

function capacityUrl(port: number): string {
  return `http://127.0.0.1:${port}/internal/engine/capacity`;
}

async function reserveSeat(
  port: number,
  input: { color: 'white' | 'black'; engineId: string } = {
    color: sampleRequest.color,
    engineId: sampleRequest.engineId,
  },
): Promise<string> {
  const response = await fetch(reservationsUrl(port), {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(typeof body.reservationId, 'string');
  return body.reservationId;
}

// The worker derives its wall deadline from the payload, and its usable pick
// window is that value minus ~1450ms of guards, vetoed below a 3000ms floor. When
// the deadline was sourced from the COMPUTE budget, any compute budget under
// ~4450ms sent every move to an unsearched deadline-guard — at 3+2, any clock
// under ~29.8s. Keep the two quantities on two fields.
test('pool payload separates the transport deadline from the compute budget', () => {
  const payload = engineTurnPoolPayload(sampleRequest, 15_100, 5_100);

  assert.equal(payload.workerDeadlineMs, 15_100, 'deadline must be the transport bound');
  assert.equal(payload.computeBudgetMs, 5_100);
  // Legacy key keeps its historical meaning (the compute budget) so a worker that
  // has not been redeployed is unaffected. engine-worker does not auto-deploy, so
  // the two sides must be able to ship in either order.
  assert.equal(payload.watchdogTimeoutMs, 5_100);
  assert.equal(payload.engineTurnRequest, sampleRequest);
});

test('pool payload never lets the compute budget become the deadline', () => {
  // A late-game 3+2 move: ~25s on the clock yields a ~4.05s compute budget, which
  // is below the old ~4450ms cliff.
  const payload = engineTurnPoolPayload(sampleRequest, 14_050, 4_050);
  const GUARDS_MS = 1_200 + 250; // DEADLINE_GUARD_MS + PICK_DEADLINE_GUARD_MS
  const MIN_PICK_MS = 3_000; // MIN_STRATEGY_PICK_BUDGET_MS
  const pickWindowMs = (payload.workerDeadlineMs as number) - GUARDS_MS;

  assert.ok(
    pickWindowMs > MIN_PICK_MS,
    `pick window ${pickWindowMs}ms must clear the ${MIN_PICK_MS}ms floor; deriving it from ` +
      `the ${payload.computeBudgetMs}ms compute budget yields ` +
      `${(payload.computeBudgetMs as number) - GUARDS_MS}ms, which vetoes the search`,
  );
});
