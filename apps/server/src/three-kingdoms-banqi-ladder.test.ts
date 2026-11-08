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
const L7 = 'misty-three-kingdoms-banqi-level-7';
const L8 = 'misty-three-kingdoms-banqi-level-8';
const ROOM = 'tkb_ladder_test';
const REAL_ENGINE = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH;
const REAL_NET = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;

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
  noiseOptions: readonly string[] = ['Noise', 'NoiseDepth', 'Seed'],
): { bin: string; log: string } {
  const bin = join(
    dir,
    `stub-engine-net-${advertiseNet}-mix-${advertiseMix}-${noiseOptions.join('-')}`,
  );
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
    ${noiseOptions.map((name) => `console.log('option name ${name} type string default 0');`).join('\n')}
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
  assert.deepEqual(
    engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.map((tier) => [
      tier.id,
      tier.evaluation,
      tier.nodes,
      tier.noise,
      tier.noiseDepth,
      tier.movetimeCapMs,
      tier.chance,
    ]),
    [
      [L1, 'random', 0, undefined, undefined, 3000, undefined],
      [L2, 'classical', 2000, 0.05, 2, 3000, 'mix'],
      ['misty-three-kingdoms-banqi-level-3', 'classical', 2000, 0.03, 2, 3000, 'mix'],
      ['misty-three-kingdoms-banqi-level-4', 'classical', 2000, 0.02, 2, 3000, 'mix'],
      ['misty-three-kingdoms-banqi-level-5', 'classical', 2000, undefined, undefined, 3000, 'mix'],
      ['misty-three-kingdoms-banqi-level-6', 'classical', 8000, undefined, undefined, 3000, 'mix'],
      [L7, 'classical', 2048000, undefined, undefined, 3000, 'mix'],
      [L8, 'nnue', 2048000, undefined, undefined, 3000, 'mix'],
    ],
  );
  assert.equal(engine.threeKingdomsBanqiEngineTierFor(L8)?.evaluation, 'nnue');
  assert.equal(engine.THREE_KINGDOMS_BANQI_ENGINE_VERSION, '0.3.0');
  for (const tier of engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES) {
    assert.equal(engine.threeKingdomsBanqiEngineVersion(tier.id), '0.3.0');
  }
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
    '0.2.0',
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
        ...([
          L2,
          'misty-three-kingdoms-banqi-level-3',
          'misty-three-kingdoms-banqi-level-4',
        ].includes(id)
          ? [
              `setoption name Noise value ${[0.05, 0.03, 0.02][Number(id.at(-1)) - 2]}`,
              'setoption name NoiseDepth value 2',
              `setoption name Seed value ${engine.threeKingdomsBanqiNoiseSeed(ROOM)}`,
            ]
          : []),
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

test('TK L7/L8 full UCI streams remain byte-identical to the pre-calibration ladder', async () => {
  await withPaths(async (_dir, net) => {
    const position =
      'position fen XXXX1XXXX/XXXX1XXXX/9/XXXX1XXXX/XXXX1XXXX r - 0 0 0 1 G1A2E2R2H2C2S5g1a2e2r2h2c2s5 -';
    for (const id of [L7, L8]) {
      const events = eventsFor(id);
      const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
      const request = live.threeKingdomsBanqiTierRequestFor(events, state, id, 3000);
      for (const history of [false, true]) {
        assert.equal(
          `${engine
            .buildThreeKingdomsBanqiEngineCommands({
              ...request,
              ...(history ? { moves: ['a1a2'], searchMoves: ['b1b2'] } : {}),
            })
            .join('\n')}\n`,
          `uci\n${id === L8 ? `setoption name EvalFile value ${net}\n` : ''}` +
            'setoption name ChanceMix value true\nucinewgame\nisready\n' +
            `${position}${history ? ' moves a1a2' : ''}\n` +
            `go nodes 2048000 movetime 3000${history ? ' searchmoves b1b2' : ''}\n`,
        );
      }
    }
  });
});

test('TK noisy levels refuse binaries missing Noise, NoiseDepth or Seed; L5-L8 still play', async () => {
  await withPaths(async (dir) => {
    for (const options of [
      [],
      ['NoiseDepth', 'Seed'],
      ['Noise', 'Seed'],
      ['Noise', 'NoiseDepth'],
    ]) {
      const { bin } = stubEngine(dir, true, true, options);
      process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
      for (const tier of engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.slice(1)) {
        const events = eventsFor(tier.id);
        const request = live.threeKingdomsBanqiTierRequestFor(
          events,
          replayTenantEvents(threeKingdomsBanqiTenant, events).state,
          tier.id,
          500,
        );
        if (tier.level! <= 4) {
          await assert.rejects(
            engine.threeKingdomsBanqiLiveEngineMove(request),
            /does not advertise configured option\(s\): (Noise|NoiseDepth|Seed)/,
          );
        } else {
          assert.equal((await engine.threeKingdomsBanqiLiveEngineMove(request)).best, 'a1a1');
        }
      }
    }
  });
});

test('TK root-noise seed is stable across turns and tiers, nonzero and varies by room', () => {
  const seeds: string[] = [];
  for (const id of [
    L2,
    'misty-three-kingdoms-banqi-level-3',
    'misty-three-kingdoms-banqi-level-4',
  ]) {
    const events = eventsFor(id);
    const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
    const request = live.threeKingdomsBanqiTierRequestFor(events, state, id, 3000);
    assert.match(request.seed!, /^[1-9][0-9]*$/);
    assert.ok(BigInt(request.seed!) <= 0xffffffffffffffffn);
    seeds.push(request.seed!);
    const nextEvents: ThreeKingdomsBanqiEvent[] = [
      ...events,
      {
        type: 'move-played',
        at: 10,
        roomId: ROOM,
        color: 'red',
        move: getThreeKingdomsBanqiLegalMoves(state)[0]!,
      },
    ];
    const next = replayTenantEvents(threeKingdomsBanqiTenant, nextEvents).state;
    assert.equal(
      live.threeKingdomsBanqiTierRequestFor(nextEvents, next, id, 3000).seed,
      request.seed,
    );
    const otherEvents = events.map((event) => ({ ...event, roomId: `${ROOM}_other` }));
    const other = replayTenantEvents(threeKingdomsBanqiTenant, otherEvents).state;
    assert.notEqual(
      live.threeKingdomsBanqiTierRequestFor(otherEvents, other, id, 3000).seed,
      request.seed,
    );
  }
  assert.equal(new Set(seeds).size, 1);
});

test('TK calibrated search tiers play legal moves with the local noise-capable binary and L8 net', {
  skip: !REAL_ENGINE || !REAL_NET,
}, async () => {
  const bests: string[] = [];
  for (const tier of engine.THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.slice(1)) {
    const events = eventsFor(tier.id);
    const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
    const request = live.threeKingdomsBanqiTierRequestFor(events, state, tier.id, 3000);
    const result = await engine.threeKingdomsBanqiLiveEngineMove(request);
    assert.ok(
      getThreeKingdomsBanqiLegalMoves(state).some(
        (move) => live.threeKingdomsBanqiMoveToUci(move) === result.best,
      ),
      tier.id,
    );
    bests.push(result.best!);
  }
  const events = eventsFor(L2);
  const state = replayTenantEvents(threeKingdomsBanqiTenant, events).state;
  assert.equal(
    (
      await engine.threeKingdomsBanqiLiveEngineMove(
        live.threeKingdomsBanqiTierRequestFor(events, state, L2, 3000),
      )
    ).best,
    bests[0],
    'the same room seed reproduces the noisy move',
  );
});

test('TK search signatures name 0.3.0; historical and process-free L1 pairs stay unchanged', () => {
  for (const tier of engine.THREE_KINGDOMS_BANQI_ALL_ENGINE_TIERS) {
    const entry = loadEngine(tier.id);
    const version = tier.level !== undefined && tier.level >= 2 ? '0.3.0' : '0.2.0';
    const signature = `${tier.id}-${version}-${tier.evaluation}-nodes-${tier.nodes}`;
    const mix = tier.level !== undefined && tier.level >= 2;
    const noise = tier.level !== undefined && tier.level >= 2 && tier.level <= 4;
    const suffix = noise ? `-noise-${tier.noise}-depth-${tier.noiseDepth}` : '';
    assert.equal(entry.configHash, `${signature}${mix ? '-chance-mix' : ''}${suffix}`);
    assert.equal(entry.playSignature, entry.configHash);
    assert.equal(
      'chance' in entry.config ? entry.config.chance : undefined,
      mix ? 'mix' : undefined,
    );
    assert.equal('noise' in entry.config ? entry.config.noise : undefined, tier.noise);
    assert.equal(
      'noiseDepth' in entry.config ? entry.config.noiseDepth : undefined,
      tier.noiseDepth,
    );
  }
  const historical = loadEngine(engine.THREE_KINGDOMS_BANQI_ENGINE_ID);
  assert.match(historical.notes!, /Historical MistyThreeKingdomsBanqi 0\.2\.0/);
  assert.deepEqual(historical.config, {
    kind: 'three-kingdoms-banqi-uci',
    nodes: 2_000_000,
    movetime_ms: 3000,
    evaluation: 'classical',
  });
});

test('TK L2-L4/L8 live and EvE requests are byte-identical after swapping covered identities', async () => {
  await withPaths(async (dir) => {
    const { bin, log } = stubEngine(dir);
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH = bin;
    const adapter = eveAdapterFor(THREE_KINGDOMS_BANQI_SPEC_ID);
    assert.ok(adapter);
    for (const id of [
      L2,
      'misty-three-kingdoms-banqi-level-3',
      'misty-three-kingdoms-banqi-level-4',
      L8,
    ]) {
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
