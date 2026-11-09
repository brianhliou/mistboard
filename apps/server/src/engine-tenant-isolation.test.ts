import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  isPlayableLiveEngineClientId,
  knownEngineIds,
  loadEngine,
  playableLiveEngines,
} from './engine-registry.js';
import { JIEQI_DEFAULT_ENGINE_ID } from './jieqi-engine.js';
import { JUNGLE_FLIP_DEFAULT_ENGINE_ID } from './jungle-flip-engine.js';
import { tryHandle as handlePlayableEngines } from './routes/engines.js';
import { handleJieqiCreate, type JieqiCreateContext } from './routes/jieqi-rooms.js';
import {
  handleJungleFlipCreate,
  type JungleFlipCreateContext,
} from './routes/jungle-flip-rooms.js';

// Lesson-enforces: mistboard:e4ab377 (also ded637e's tenant-isolation rule).
// Both commits respected this boundary. The fixture models the mistaken
// PROD_PLAYABLE_ENGINE_IDS addition described by e4ab377, rather than reverting
// either commit: fixtures/variant-pve-picker-leak.patch.
// Replay from the repo root (4 failures with the fixture; 8 passes after removal):
//   git apply apps/server/src/fixtures/variant-pve-picker-leak.patch
//   node --import tsx --test apps/server/src/engine-tenant-isolation.test.ts
//   git apply -R apps/server/src/fixtures/variant-pve-picker-leak.patch
//   node --import tsx --test apps/server/src/engine-tenant-isolation.test.ts
const EXTRA_ENGINES = 'MISTBOARD_EXTRA_PLAYABLE_ENGINES';

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function captureResponse() {
  const capture = {
    status: 0,
    body: '',
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & { status: number; body: string };
}

test('the default dark-chess picker and admission gate exclude every registered variant engine', async () => {
  await withEnv({ [EXTRA_ENGINES]: undefined }, async () => {
    const variants = knownEngineIds()
      .map((id) => loadEngine(id))
      .filter((engine) => engine.gameSpecId && engine.gameSpecId !== 'dark-chess');
    assert.ok(variants.length > 0, 'exercise the real variant registry');
    const offered = new Set(playableLiveEngines().map((engine) => engine.id));
    assert.ok(offered.size > 0, 'keep the dark-chess positive control');
    for (const engine of variants) {
      assert.equal(offered.has(engine.id), false, `${engine.id} leaked into the shared picker`);
      assert.equal(
        isPlayableLiveEngineClientId(engine.id),
        false,
        `${engine.id} entered the shared dark-chess admission gate`,
      );
    }
  });
});

test('/api/engines/playable serializes only dark-chess engines', async () => {
  await withEnv({ [EXTRA_ENGINES]: undefined }, async () => {
    const response = captureResponse();
    assert.equal(
      await handlePlayableEngines(
        undefined,
        { method: 'GET' } as IncomingMessage,
        response,
        '/api/engines/playable',
      ),
      true,
    );
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body) as { engines: { id: string }[] };
    assert.ok(payload.engines.length > 0);
    for (const { id } of payload.engines) {
      assert.equal(
        loadEngine(id).gameSpecId ?? 'dark-chess',
        'dark-chess',
        `${id} leaked into the serialized dark-chess picker`,
      );
    }
  });
});

for (const tenant of [
  {
    specId: 'jieqi',
    flag: 'MISTBOARD_JIEQI_ENABLED',
    ownEngine: JIEQI_DEFAULT_ENGINE_ID,
    foreignEngine: JUNGLE_FLIP_DEFAULT_ENGINE_ID,
    handleCreate: handleJieqiCreate,
  },
  {
    specId: 'jungle-flip',
    flag: 'MISTBOARD_JUNGLE_FLIP_ENABLED',
    ownEngine: JUNGLE_FLIP_DEFAULT_ENGINE_ID,
    foreignEngine: JIEQI_DEFAULT_ENGINE_ID,
    handleCreate: handleJungleFlipCreate,
  },
]) {
  const disabledError = `${tenant.specId.replaceAll('-', '_')}_disabled`;
  const body = { gameSpecId: tenant.specId, mode: 'pve', preferredColor: 'red' };

  function createContext() {
    const engines: unknown[] = [];
    const createRoom = async (...args: Parameters<JieqiCreateContext['createJieqiRoom']>) => {
      engines.push(args[2]);
      return {
        ok: true as const,
        room: { id: 'fixture-room', gameSpecId: tenant.specId, rated: false },
      };
    };
    const ctx: JieqiCreateContext & JungleFlipCreateContext = {
      databaseRequired: false,
      refusesCreate: () => false,
      drainDeadlineMs: () => null,
      createJieqiRoom: createRoom,
      createJungleFlipRoom: createRoom,
    };
    return { ctx, engines };
  }

  test(`${tenant.specId} PvE is disabled even when its engine is in the shared pool`, async () => {
    await withEnv({ [tenant.flag]: undefined, [EXTRA_ENGINES]: tenant.ownEngine }, async () => {
      assert.equal(isPlayableLiveEngineClientId(tenant.ownEngine), true);
      const { ctx, engines } = createContext();
      const response = captureResponse();
      await tenant.handleCreate(ctx, response, { ...body, engineId: tenant.ownEngine });
      assert.equal(response.status, 404);
      assert.deepEqual(JSON.parse(response.body), { error: disabledError });
      assert.deepEqual(engines, []);
    });
  });

  test(`${tenant.specId} PvE accepts its own engine without shared-pool membership`, async () => {
    await withEnv({ [tenant.flag]: 'true', [EXTRA_ENGINES]: undefined }, async () => {
      assert.equal(isPlayableLiveEngineClientId(tenant.ownEngine), false);
      const { ctx, engines } = createContext();
      // The route default and an explicit id must both use the tenant gate.
      for (const request of [body, { ...body, engineId: tenant.ownEngine }]) {
        const response = captureResponse();
        await tenant.handleCreate(ctx, response, request);
        assert.equal(response.status, 201, response.body);
      }
      assert.deepEqual(engines, [
        { engineId: tenant.ownEngine, seat: 'black' },
        { engineId: tenant.ownEngine, seat: 'black' },
      ]);
    });
  });

  test(`${tenant.specId} PvE rejects dark-chess and other tenants' engines`, async () => {
    await withEnv({ [tenant.flag]: 'true', [EXTRA_ENGINES]: undefined }, async () => {
      const darkChessEngine = playableLiveEngines()[0];
      assert.ok(darkChessEngine);
      const { ctx, engines } = createContext();
      for (const engineId of [darkChessEngine.id, tenant.foreignEngine]) {
        const response = captureResponse();
        await tenant.handleCreate(ctx, response, { ...body, engineId });
        assert.equal(response.status, 400);
        assert.deepEqual(JSON.parse(response.body), { error: 'invalid_engine' });
      }
      assert.deepEqual(engines, []);
    });
  });
}
