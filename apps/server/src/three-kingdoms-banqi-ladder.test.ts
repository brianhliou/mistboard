import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import {
  createThreeKingdomsBanqiSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import type { UserAccount } from './persistence.js';
import {
  handleThreeKingdomsBanqiCreate,
  type ThreeKingdomsBanqiCreateContext,
} from './routes/three-kingdoms-banqi-rooms.js';
import * as live from './server-three-kingdoms-banqi-engine.js';
import * as engine from './three-kingdoms-banqi-engine.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { playVariantEngineGame } from './variant-eve.js';
import { eveAdapterFor, eveWorkerCapabilities } from './variant-eve-registry.js';
import { createTenantRuntimeRoomFromEvents, replayTenantEvents } from './variant-tenant/runtime.js';

const SCRATCH = '/tmp/burn-scratch/mistboard-burn-866-tk-server-ladder-and-rateable';
const L1 = 'misty-three-kingdoms-banqi-level-1';
const L2 = 'misty-three-kingdoms-banqi-level-2';
const L8 = 'misty-three-kingdoms-banqi-level-8';
const ROOM = 'tkb_ladder_test';

function eventsFor(engineId = L2): ThreeKingdomsBanqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM,
      gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
      setup: createThreeKingdomsBanqiSetup(() => 0.25),
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: engineId, seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM, clientId: 'human', seat: 'black' },
  ];
}

async function withPaths(run: (dir: string, net: string) => Promise<void>) {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH, 'tk-ladder-'));
  const net = join(dir, 'test.nnue');
  writeFileSync(net, 'stub net');
  const keys = [
    'MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH',
    'MISTBOARD_THREE_KINGDOMS_BANQI_NET',
  ] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = join(dir, 'missing-engine');
  process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = net;
  try {
    await run(dir, net);
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
}

function stubEngine(
  dir: string,
  advertiseNet = true,
  advertiseMix = true,
): { bin: string; log: string } {
  const bin = join(dir, `stub-engine-net-${advertiseNet}-mix-${advertiseMix}`);
  const log = `${bin}.json`;
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin });
const commands = [];
rl.on('line', line => {
  commands.push(line);
  if (line === 'uci') {
    ${advertiseNet ? "console.log('option name EvalFile type string default <empty>');" : ''}
    ${advertiseMix ? "console.log('option name ChanceMix type check default false');" : ''}
    console.log('uciok');
  }
  if (line === 'isready') console.log('readyok');
  if (line.startsWith('go ')) {
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(commands));
    console.log('info depth 1 score cp 0');
    console.log('bestmove a1a1');
  }
});
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

test('TK tier selection accepts eight levels, keeps the historical budget and rejects unknown ids', () => {
  assert.equal(engine.isThreeKingdomsBanqiEngineClientId(L2), true);
  assert.equal(engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.length, 8);
  assert.equal(engine.threeKingdomsBanqiEngineTierFor(L1)?.evaluation, 'random');
  const tiers = engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.slice(1, 7);
  assert.deepEqual(
    tiers.map((tier) => tier.nodes),
    [2_000, 8_000, 32_000, 128_000, 512_000, 2_048_000],
  );
  assert.equal(engine.threeKingdomsBanqiEngineTierFor(L8)?.evaluation, 'nnue');
  assert.equal(engine.threeKingdomsBanqiEngineTierFor(L8)?.nodes, tiers.at(-1)!.nodes);
  assert.equal(
    engine.threeKingdomsBanqiEngineTierFor(engine.THREE_KINGDOMS_BANQI_ENGINE_ID)?.nodes,
    2_000_000,
  );
  assert.equal(
    engine.threeKingdomsBanqiEngineDisplayName(engine.THREE_KINGDOMS_BANQI_ENGINE_ID),
    'MistyThreeKingdomsBanqi',
  );
  assert.equal(
    engine.threeKingdomsBanqiEngineVersion(engine.THREE_KINGDOMS_BANQI_ENGINE_ID),
    '0.1.0',
  );
  for (const id of [
    undefined,
    'misty-banqi',
    'misty-three-kingdoms-banqi-level-0',
    'misty-three-kingdoms-banqi-level-9',
  ]) {
    assert.equal(engine.threeKingdomsBanqiEngineTierFor(id), null);
    assert.equal(engine.isThreeKingdomsBanqiEngineClientId(id), false);
  }
});

test('TK L1 selects uniformly from legal moves live without asking a process', async () => {
  await withPaths(async () => {
    const events = eventsFor(L1);
    const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
    const legal = getThreeKingdomsBanqiLegalMoves(state);
    assert.ok(legal.length > 1);
    assert.equal(engine.threeKingdomsBanqiEngineAvailable(L1), true, 'no binary needed');
    for (let i = 0; i < legal.length; i++) {
      const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, events);
      assert.ok(hydrated.ok);
      const appended: ThreeKingdomsBanqiEvent[] = [];
      await live.playThreeKingdomsBanqiEngineMoveIfReady(
        {
          appendEvent: async (_room: unknown, event: ThreeKingdomsBanqiEvent) => {
            appended.push(event);
            return events.length;
          },
          broadcastEventAppended: () => {},
        } as never,
        hydrated.room as never,
        async () => {
          assert.fail('L1 must never call an engine provider');
        },
        () => (i + 0.5) / legal.length,
      );
      assert.equal(appended.length, 1);
      const event = appended[0]!;
      assert.equal(event.type, 'move-played');
      if (event.type === 'move-played') assert.deepEqual(event.move, legal[i]);
    }
  });
});

test('TK L8 fails closed for absent, empty and non-file nets; L2 remains available', async () => {
  await withPaths(async (dir, net) => {
    const { bin, log } = stubEngine(dir);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    assert.equal(engine.threeKingdomsBanqiEngineAvailable(L8), true);
    for (const missing of [undefined, join(dir, 'missing-net'), dir, join(dir, 'empty-net')]) {
      writeFileSync(join(dir, 'empty-net'), '');
      if (missing === undefined) delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
      else process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = missing;
      assert.equal(engine.threeKingdomsBanqiEngineAvailable(L8), false);
      assert.equal(engine.threeKingdomsBanqiEngineAvailable(L2), true);
      const events = eventsFor(L8);
      const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
      assert.throws(
        () => live.threeKingdomsBanqiTierRequestFor(events, state, L8, 500),
        /net.*not available/i,
      );
    }
    await assert.rejects(
      engine.threeKingdomsBanqiLiveEngineMove({
        fen: 'unused',
        moves: [],
        nodes: 2000,
        movetimeCapMs: 100,
        evalFile: join(dir, 'missing-net'),
      }),
      /net.*not available/i,
    );
    assert.throws(() => readFileSync(log), /ENOENT/, 'no process ran with a missing net');
    const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, eventsFor(L8));
    assert.ok(hydrated.ok);
    const appended: ThreeKingdomsBanqiEvent[] = [];
    await live.playThreeKingdomsBanqiEngineMoveIfReady(
      {
        appendEvent: async (_room: unknown, event: ThreeKingdomsBanqiEvent) => {
          appended.push(event);
          return 3;
        },
        broadcastEventAppended: () => {},
      } as never,
      hydrated.room as never,
      async () => assert.fail('missing net must not search'),
    );
    assert.equal(appended[0]?.type, 'seat-resigned', 'an existing L8 room also fails closed');
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = net;
  });
});

test('TK search levels receive ChanceMix after EvalFile and before readiness/position/go; historical stays unchanged', async () => {
  await withPaths(async (dir, net) => {
    const { bin, log } = stubEngine(dir);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    for (const id of [
      ...engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.slice(1).map((tier) => tier.id),
      engine.THREE_KINGDOMS_BANQI_ENGINE_ID,
    ]) {
      const events = eventsFor(id);
      const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
      const request = live.threeKingdomsBanqiTierRequestFor(events, state, id, 500);
      const result = await engine.threeKingdomsBanqiLiveEngineMove(request);
      assert.equal(result.best, 'a1a1');
      const commands = JSON.parse(readFileSync(log, 'utf8')) as string[];
      assert.deepEqual(commands, [
        'uci',
        ...(id === L8 ? [`setoption name EvalFile value ${net}`] : []),
        ...(id === engine.THREE_KINGDOMS_BANQI_ENGINE_ID
          ? []
          : ['setoption name ChanceMix value true']),
        'ucinewgame',
        'isready',
        `position fen ${request.fen}`,
        `go nodes ${request.nodes} movetime 500`,
      ]);
    }
    const old = stubEngine(dir, false);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = old.bin;
    const events = eventsFor(L8);
    await assert.rejects(
      engine.threeKingdomsBanqiLiveEngineMove(
        live.threeKingdomsBanqiTierRequestFor(
          events,
          replayTenantEvents(threeKingdomsBanqiTenant, events).state,
          L8,
          500,
        ),
      ),
      /does not advertise.*EvalFile/,
    );
  });
});

test('TK L2 and L8 refuse a binary that silently ignores unadvertised ChanceMix; historical still plays', async () => {
  await withPaths(async (dir) => {
    const { bin, log } = stubEngine(dir, true, false);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    for (const id of [L2, L8]) {
      const events = eventsFor(id);
      const request = live.threeKingdomsBanqiTierRequestFor(
        events,
        replayTenantEvents(threeKingdomsBanqiTenant, events).state,
        id,
        500,
      );
      await assert.rejects(
        engine.threeKingdomsBanqiLiveEngineMove(request),
        /does not advertise.*ChanceMix/,
      );
    }
    const events = eventsFor(engine.THREE_KINGDOMS_BANQI_ENGINE_ID);
    assert.equal(
      (
        await engine.threeKingdomsBanqiLiveEngineMove(
          live.threeKingdomsBanqiTierRequestFor(
            events,
            replayTenantEvents(threeKingdomsBanqiTenant, events).state,
            engine.THREE_KINGDOMS_BANQI_ENGINE_ID,
            500,
          ),
        )
      ).best,
      'a1a1',
    );
    assert.ok(!readFileSync(log, 'utf8').includes('ChanceMix'));
  });
});

test('TK Mix config and signatures separate L2–L8 from Star1; L1 and historical signatures stay unchanged', () => {
  for (const tier of engine.THREE_KINGDOMS_BANQI_ALL_ENGINE_TIERS) {
    const entry = loadEngine(tier.id);
    const oldSignature = `${tier.id}-0.1.0-${tier.evaluation}-nodes-${tier.nodes}`;
    const mix = tier.level !== undefined && tier.level >= 2;
    assert.equal(entry.configHash, `${oldSignature}${mix ? '-chance-mix' : ''}`);
    assert.equal(entry.playSignature, entry.configHash);
    assert.equal(
      'chance' in entry.config ? entry.config.chance : undefined,
      mix ? 'mix' : undefined,
    );
  }
});

test('TK L2/L8 live and EvE requests are byte-identical after swapping covered identities', async () => {
  await withPaths(async (dir) => {
    const { bin, log } = stubEngine(dir);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    const adapter = eveAdapterFor(THREE_KINGDOMS_BANQI_SPEC_ID);
    assert.ok(adapter);
    for (const id of [L2, L8]) {
      const eventsA = eventsFor(id);
      const eventsB = structuredClone(eventsA);
      const created = eventsB[0]!;
      assert.equal(created.type, 'room-created');
      if (created.type !== 'room-created') throw new Error('bad fixture');
      const setup = created.setup as ReturnType<typeof createThreeKingdomsBanqiSetup>;
      const i = 0;
      const j = setup.deal.findIndex(
        (p) => p.role !== setup.deal[i]!.role || p.color !== setup.deal[i]!.color,
      );
      assert.ok(j > 0);
      [setup.deal[i], setup.deal[j]] = [setup.deal[j]!, setup.deal[i]!];
      // Reveal a different square and play a short legal line, exercising quiet history too.
      for (let n = 0; n < 20; n++) {
        const state = replayTenantEvents(threeKingdomsBanqiTenant, eventsA).state;
        if (state.status.type !== 'playing') break;
        const legal = getThreeKingdomsBanqiLegalMoves(state).filter(
          (m) =>
            ![
              THREE_KINGDOMS_BANQI_SETUP_SQUARES[i],
              THREE_KINGDOMS_BANQI_SETUP_SQUARES[j],
            ].includes(m.from),
        );
        const move = legal.find((m) => m.from !== m.to) ?? legal[0]!;
        const event: ThreeKingdomsBanqiEvent = {
          type: 'move-played',
          at: 10 + n,
          roomId: ROOM,
          color: state.status.turn,
          move,
        };
        eventsA.push(event);
        eventsB.push(event);
      }
      let sawQuiet = false;
      for (let n = 3; n <= eventsA.length; n++) {
        const commands: string[] = [];
        for (const events of [eventsA.slice(0, n), eventsB.slice(0, n)]) {
          const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
          const request = live.threeKingdomsBanqiTierRequestFor(events, state, id, 500);
          assert.ok(
            engine
              .buildThreeKingdomsBanqiEngineCommands(request)
              .includes('setoption name ChanceMix value true'),
          );
          sawQuiet ||= request.moves.length > 0;
          commands.push(engine.buildThreeKingdomsBanqiEngineCommands(request).join('\n'));
        }
        assert.equal(commands[0], commands[1], `${id}, prefix ${n} leaks an identity`);
      }
      assert.ok(sawQuiet, 'the test exercises a quiet history window');
      assert.notDeepEqual(eventsA[0], eventsB[0], 'the hidden swap is real');
      // Capture both real call sites: live provider input and EvE subprocess stdin.
      const seen: string[] = [];
      for (const events of [eventsA, eventsB]) {
        const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
        assert.equal(state.status.type, 'playing');
        if (state.status.type !== 'playing') throw new Error('bad fixture');
        assert.equal(state.status.turn, 'red');
        const expected = engine.buildThreeKingdomsBanqiEngineCommands(
          live.threeKingdomsBanqiTierRequestFor(events, state, id, 3000),
        );
        const hydrated = createTenantRuntimeRoomFromEvents(threeKingdomsBanqiTenant, events);
        assert.ok(hydrated.ok);
        await live.playThreeKingdomsBanqiEngineMoveIfReady(
          {
            appendEvent: async () => events.length,
            broadcastEventAppended: () => {},
          } as never,
          hydrated.room as never,
          async (request) => {
            const actual = engine.buildThreeKingdomsBanqiEngineCommands(request);
            assert.deepEqual(actual, expected);
            seen.push(actual.join('\n'));
            return {
              best: live.threeKingdomsBanqiMoveToUci(getThreeKingdomsBanqiLegalMoves(state)[0]!),
              cp: 0,
              mate: null,
              depth: 1,
            };
          },
        );
        await adapter.search(id, [], { movetimeMs: 3000 }, { events, color: 'red' });
        assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), expected);
      }
      assert.equal(seen.length, 2, 'both live providers were called');
      assert.equal(seen[0], seen[1], 'the actual live requests hide the swap');
    }
  });
});

test('TK create route keeps the admin gate and historical default, admits L1 without a binary, holds L8 without a net', async () => {
  const flag = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED;
  delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED;
  try {
    await withPaths(async (dir) => {
      const seated: string[] = [];
      const ctx: ThreeKingdomsBanqiCreateContext = {
        databaseRequired: false,
        refusesCreate: () => false,
        drainDeadlineMs: () => null,
        createThreeKingdomsBanqiRoom: async (_clock, _pref, bot) => {
          seated.push(bot!.engineId);
          return {
            ok: true,
            room: { id: ROOM, gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID, rated: false },
          };
        },
      };
      const request = async (engineId: string | undefined, role: 'admin' | 'player' | null) => {
        let status = 0;
        const response = {
          writeHead: (code: number) => {
            status = code;
          },
          end: () => {},
        } as unknown as ServerResponse;
        await handleThreeKingdomsBanqiCreate(
          ctx,
          response,
          {
            gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
            mode: 'pve',
            engineId,
            timeControl: { initialMs: 300_000, incrementMs: 5_000 },
          },
          role === null ? null : ({ id: role, accountRole: role } as UserAccount),
        );
        return status;
      };
      assert.equal(await request(L1, null), 404);
      assert.equal(await request(L1, 'player'), 404);
      assert.equal(await request(L1, 'admin'), 201);
      assert.deepEqual(seated, [L1]);
      assert.equal(
        await request(undefined, 'admin'),
        404,
        'historical default still needs a binary',
      );
      const { bin } = stubEngine(dir);
      process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
      assert.equal(await request(undefined, 'admin'), 201);
      assert.equal(seated.at(-1), engine.THREE_KINGDOMS_BANQI_ENGINE_ID);
      assert.equal(await request(L8, 'admin'), 201);
      delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
      assert.equal(await request(L8, 'admin'), 404);
      assert.equal(await request(L2, 'admin'), 201);
      assert.equal(await request('misty-three-kingdoms-banqi-level-9', 'admin'), 400);
    });
  } finally {
    if (flag === undefined) delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED;
    else process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = flag;
  }
});

test('TK adapter anchors at L1, deals seeded openings, and advertises full-ladder capability', async () => {
  await withPaths(async (dir) => {
    const adapter = eveAdapterFor(THREE_KINGDOMS_BANQI_SPEC_ID);
    assert.ok(adapter);
    assert.equal(adapter.randomEngineId, L1);
    assert.equal(adapter.requiredCapability, 'three_kingdoms_banqi_engine');
    assert.equal(eveWorkerCapabilities().three_kingdoms_banqi_engine, false);
    const { bin } = stubEngine(dir);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    assert.equal(eveWorkerCapabilities().three_kingdoms_banqi_engine, true);
    delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
    assert.equal(eveWorkerCapabilities().three_kingdoms_banqi_engine, false);
    assert.deepEqual(adapter.createSetup?.(628n), adapter.createSetup?.(628n));
    assert.notDeepEqual(adapter.createSetup?.(628n), adapter.createSetup?.(629n));
    const result = await playVariantEngineGame(adapter, {
      firstEngineId: L1,
      secondEngineId: L1,
      roomId: ROOM,
      maxPlies: 6,
      openingPolicy: { seed: '628' },
      rng: () => 0.5,
      moveProvider: async () => assert.fail('L1 EvE must not search'),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.plyCount, 6);
    for (const tier of engine.THREE_KINGDOMS_BANQI_ALL_ENGINE_TIERS) {
      assert.ok(knownEngineIds().includes(tier.id));
      assert.equal(loadEngine(tier.id).gameSpecId, THREE_KINGDOMS_BANQI_SPEC_ID);
      assert.equal(adapter.tierFor(tier.id)?.id, tier.id);
    }
  });
});
