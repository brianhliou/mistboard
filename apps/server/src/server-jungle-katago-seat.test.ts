/**
 * The KataGo top jungle seat (#434): who may create it, how the live loop asks it
 * for a move, and what happens when it cannot answer or cannot run.
 *
 * The provider is a stub; the real binary is driven end to end by the browser
 * check and by railpack's net step (scripts/fetch-katago-jungle-net.sh).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createInitialJungleState,
  getJungleLegalMoves,
  type JungleColor,
  type JungleGameState,
} from '@mistboard/game';
import { jungleMoveToEngineUci } from './jungle-fen.js';
import {
  KATAGO_JUNGLE_ENGINE_ID,
  KATAGO_JUNGLE_ENGINE_VERSION,
  katagoJungleAvailable,
} from './jungle-katago-engine.js';
import {
  isJungleEngineClientId,
  isJunglePlayableEngineClientId,
  JUNGLE_PLAYABLE_ENGINE_ID,
  JUNGLE_PLAYABLE_ENGINE_IDS,
  jungleEngineDisplayName,
  jungleEngineVersion,
  type KatagoJungleMoveProvider,
  playJungleEngineMoveIfReady,
} from './server-jungle-engine.js';
import type { UciEval } from './uci-engine-harness.js';

const ROOM_ID = 'jgl_katago_seat';
const assets = mkdtempSync(join(tmpdir(), 'katago-jungle-seat-'));
const fakeBinary = join(assets, 'katago-jungle');
const fakeNet = join(assets, 'katago-jungle-net.bin.gz');
writeFileSync(fakeBinary, '');
writeFileSync(fakeNet, '');

const ENV_KEYS = [
  'MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH',
  'MISTBOARD_KATAGO_JUNGLE_NET_PATH',
] as const;

/** Run with the binary and net pointed at files that exist (present) or do not (absent). */
async function withAssets<T>(present: boolean, fn: () => Promise<T> | T): Promise<T> {
  const saved = ENV_KEYS.map((key) => process.env[key]);
  process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH = present ? fakeBinary : join(assets, 'none');
  process.env.MISTBOARD_KATAGO_JUNGLE_NET_PATH = present ? fakeNet : join(assets, 'none.gz');
  try {
    return await fn();
  } finally {
    ENV_KEYS.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

type Appended = { type: string; color?: string };

function fixture(state: JungleGameState = createInitialJungleState(ROOM_ID)) {
  const appended: Appended[] = [];
  const room = {
    id: ROOM_ID,
    events: [],
    projection: {
      state,
      seats: { red: KATAGO_JUNGLE_ENGINE_ID, black: 'human-client' },
      clock: null,
    },
  };
  const ctx = {
    appendEvent: async (_room: unknown, event: Appended) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  return { room, ctx, appended };
}

function recordingProvider(reply: (state: JungleGameState) => string | null) {
  const calls: Array<{ fen: string; mover: JungleColor; visits: number; cap: number }> = [];
  const provider = (state: JungleGameState): KatagoJungleMoveProvider => {
    return async (fen, mover, opts): Promise<UciEval> => {
      calls.push({ fen, mover, visits: opts.visits, cap: opts.movetimeCapMs });
      return { best: reply(state), cp: null, mate: null, depth: 0, timeMs: 1_234 };
    };
  };
  return { calls, provider };
}

test('KataGo is the strongest seat, offered only where its binary and net resolve', async () => {
  assert.deepEqual(JUNGLE_PLAYABLE_ENGINE_IDS, [
    KATAGO_JUNGLE_ENGINE_ID,
    JUNGLE_PLAYABLE_ENGINE_ID,
  ]);
  await withAssets(true, () => {
    assert.equal(katagoJungleAvailable(), true);
    assert.equal(isJunglePlayableEngineClientId(KATAGO_JUNGLE_ENGINE_ID), true);
  });
  await withAssets(false, () => {
    assert.equal(katagoJungleAvailable(), false);
    // The create route refuses it rather than seating a bot that resigns at move one...
    assert.equal(isJunglePlayableEngineClientId(KATAGO_JUNGLE_ENGINE_ID), false);
    // ...but a game recorded where it ran still replays as PvE here.
    assert.equal(isJungleEngineClientId(KATAGO_JUNGLE_ENGINE_ID), true);
    // Misty is unaffected either way.
    assert.equal(isJunglePlayableEngineClientId(JUNGLE_PLAYABLE_ENGINE_ID), true);
  });
  assert.equal(jungleEngineDisplayName(KATAGO_JUNGLE_ENGINE_ID), 'KataGo');
  assert.equal(jungleEngineVersion(KATAGO_JUNGLE_ENGINE_ID), KATAGO_JUNGLE_ENGINE_VERSION);
});

test('the seat asks KataGo for 150 visits under the 6 s ceiling and plays its move', async () => {
  const state = createInitialJungleState(ROOM_ID);
  const move = getJungleLegalMoves(state)[0]!;
  const { room, ctx, appended } = fixture(state);
  const { calls, provider } = recordingProvider(() => jungleMoveToEngineUci(move));

  await withAssets(true, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, undefined, provider(state)),
  );

  assert.deepEqual(
    appended.map((event) => event.type),
    ['move-played'],
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.mover, 'red');
  assert.equal(calls[0]!.visits, 150);
  assert.equal(calls[0]!.cap, 6_000, 'an untimed game gets the tier ceiling');
  const payload = (room as { pendingDebugArtifacts?: Array<{ payload: Record<string, unknown> }> })
    .pendingDebugArtifacts?.[0]?.payload;
  assert.ok(payload, 'the success path records a decision');
  assert.equal(payload.engine_id, KATAGO_JUNGLE_ENGINE_ID);
  assert.equal(payload.engine_version, KATAGO_JUNGLE_ENGINE_VERSION);
  assert.equal(payload.move, jungleMoveToEngineUci(move));
  // tier_nodes carries KataGo's visit budget, tier_movetime_ms its ceiling.
  assert.equal(payload.tier_nodes, 150);
  assert.equal(payload.tier_movetime_ms, 6_000);
});

test('no usable move after the retries resigns the seat instead of guessing', async () => {
  const state = createInitialJungleState(ROOM_ID);
  const { room, ctx, appended } = fixture(state);
  // A forfeited stage-two pass parses to null; a kernel-illegal move is rejected.
  let call = 0;
  const { calls, provider } = recordingProvider(() => (call++ === 0 ? null : 'a1a9'));

  await withAssets(true, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, undefined, provider(state)),
  );

  assert.equal(calls.length, 2, 'two attempts, as for every jungle engine');
  assert.deepEqual(
    appended.map((event) => event.type),
    ['seat-resigned'],
  );
});

test('a seated KataGo whose assets vanished fails closed without asking it', async () => {
  const state = createInitialJungleState(ROOM_ID);
  const { room, ctx, appended } = fixture(state);
  const { calls, provider } = recordingProvider(() => null);

  await withAssets(false, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, undefined, provider(state)),
  );

  assert.equal(calls.length, 0);
  assert.deepEqual(
    appended.map((event) => event.type),
    ['seat-resigned'],
  );
});

test('it is not the engine to move on the human turn', async () => {
  const base = createInitialJungleState(ROOM_ID);
  const state: JungleGameState = { ...base, status: { type: 'playing', turn: 'black' } };
  const { room, ctx, appended } = fixture(state);
  const { calls, provider } = recordingProvider(() => null);

  await withAssets(true, () =>
    playJungleEngineMoveIfReady(ctx as never, room as never, undefined, provider(state)),
  );

  assert.equal(calls.length, 0);
  assert.deepEqual(appended, []);
});
