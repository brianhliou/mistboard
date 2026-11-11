import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  createInitialBanqiState,
  getBanqiLegalMoves,
} from '@mistboard/game';
import { banqiProviderForLive } from './banqi-provider-live.js';
import { providerResponse } from './banqi-provider-protocol.js';
import { playBanqiEngineMoveIfReady } from './server-banqi-engine.js';
import type { TenantClockState } from './variant-tenant/tenant.js';

function fixture(
  state = createInitialBanqiState('provider-live', undefined, {
    noProgressLimit: 60,
    chaseRule: 'repetition',
  }),
) {
  const appended: Array<{ type: string; move?: BanqiMove }> = [];
  const room = {
    id: state.id,
    events: [],
    projection: {
      state,
      seats: { red: 'misty-banqi', black: 'human' },
      clock: null as TenantClockState<'red' | 'black'> | null,
    },
  };
  const ctx = {
    appendEvent: async (_room: unknown, event: { type: string; move?: BanqiMove }) => {
      appended.push(event);
      if (event.move) room.projection.state = applyBanqiMove(room.projection.state, event.move);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  return { room, ctx, appended };
}

test('a move-only provider reaches the existing live event seam with genuine kernel legality', async () => {
  const { room, ctx, appended } = fixture();
  const provider = banqiProviderForLive(
    {
      turn: async (request) => providerResponse(request, request.legalMoves[0]!),
    },
    'outside-test-1',
  );
  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.type, 'move-played');
  assert.equal(room.projection.state.ply, 1);
  const artifacts = (
    room as typeof room & { pendingDebugArtifacts: Array<{ payload: Record<string, unknown> }> }
  ).pendingDebugArtifacts;
  assert.equal((artifacts[0]?.payload.search as Record<string, unknown>)?.cp, null);
  assert.equal(artifacts[0]?.payload.engine_version, 'outside-test-1');
});

test('strict provider drops a stale reply even when two plies restore the same engine seat', async () => {
  const { room, ctx, appended } = fixture();
  const provider = banqiProviderForLive(
    {
      turn: async (request) => {
        for (let ply = 0; ply < 2; ply += 1)
          room.projection.state = applyBanqiMove(
            room.projection.state,
            getBanqiLegalMoves(room.projection.state)[0]!,
          );
        return providerResponse(request, request.legalMoves[0]!);
      },
    },
    'outside-test-1',
  );
  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
  assert.deepEqual(appended, []);
});

test('strict provider never appends a move after its live clock expires', async () => {
  const { room, ctx, appended } = fixture();
  room.projection.clock = {
    activeColor: 'red',
    incrementMs: 0,
    initialMs: 10000,
    remainingMs: { red: 10000, black: 10000 },
    runningSince: Date.now(),
  };
  const provider = banqiProviderForLive(
    {
      turn: async (request) => {
        room.projection.clock!.remainingMs.red = 0;
        return providerResponse(request, request.legalMoves[0]!);
      },
    },
    'outside-test-1',
  );
  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
  assert.deepEqual(appended, []);
});

test('a forbidden chase from an outside provider resigns rather than substituting a fallback', async () => {
  const noNetwork = mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}', { status: 503 }),
  );
  try {
    let state: BanqiGameState = {
      id: 'provider-chase',
      board: {
        c3: { color: 'red', role: 'advisor', faceDown: false },
        d2: { color: 'black', role: 'chariot', faceDown: false },
        h1: { color: 'red', role: 'soldier', faceDown: false },
        a4: { color: 'black', role: 'soldier', faceDown: false },
        f4: { color: 'black', role: 'horse', faceDown: true },
      },
      status: { type: 'playing', turn: 'red' },
      ply: 10,
      firstColor: 'red',
      moveNumber: 6,
      noProgressClock: 0,
      repCounts: {},
      captures: [],
      lastMove: { from: 'e2', to: 'd2' },
      noProgressLimit: 60,
      chaseRule: 'repetition',
    };
    for (let i = 0; i < 2; i += 1)
      for (const move of [
        { from: 'c3', to: 'c2' },
        { from: 'd2', to: 'd3' },
        { from: 'c2', to: 'c3' },
        { from: 'd3', to: 'd2' },
      ] as const)
        state = applyBanqiMove(state, move);
    const { room, ctx, appended } = fixture(state);
    let calls = 0;
    const provider = banqiProviderForLive(
      {
        turn: async (request) => {
          calls += 1;
          return { ...providerResponse(request, request.legalMoves[0]!), move: 'c2c1' };
        },
      },
      'outside-test-1',
    );
    await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
    assert.equal(calls, 1, 'outside failure is not retried with a fresh deadline');
    assert.deepEqual(
      appended.map((event) => event.type),
      ['seat-resigned'],
    );
  } finally {
    noNetwork.mock.restore();
  }
});
