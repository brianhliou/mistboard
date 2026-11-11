import './jungle-flip-registration.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createInitialJungleFlipState,
  createJungleFlipDeal,
  type JungleFlipSquare,
} from '@mistboard/game';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { botSeatName, firstPartyBotForEngine } from './first-party-bots.js';
import {
  buildJungleFlipEngineCommands,
  buildJungleFlipEngineRequest,
  evaluateJungleFlipFenNodes,
  JUNGLE_FLIP_DEFAULT_ENGINE_ID,
  JUNGLE_FLIP_PLAYABLE_ENGINES,
  JUNGLE_FLIP_RANDOM_ENGINE_ID,
  jungleFlipEngineAvailable,
  jungleFlipEngineTierFor,
  jungleFlipLiveEngineMove,
  jungleFlipNetPath,
} from './jungle-flip-engine.js';
import { jungleFlipEveAdapter } from './jungle-flip-eve-adapter.js';
import { jungleFlipStateToEngineFen } from './jungle-flip-fen.js';
import { botPlayOptions } from './routes/bots.js';
import {
  handleJungleFlipCreate,
  type JungleFlipCreateContext,
} from './routes/jungle-flip-rooms.js';
import { UciEnginePool, UciWarmSessionCache } from './uci-engine-harness.js';
import { playVariantEngineGame } from './variant-eve.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const fen = 'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0';

function fakeEngine(options: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'jungle-flip-ladder-'));
  const bin = join(dir, 'engine.cjs');
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'commands.txt');
  writeFileSync(log, '');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
let ply = 0;
let evalFile = '';
let searches = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  if (line === 'uci') {
    for (const name of ${JSON.stringify(options)}) console.log('option name ' + name + ' type string default 0');
    console.log('uciok');
  }
  if (line.startsWith('setoption name EvalFile value ')) evalFile = line.slice('setoption name EvalFile value '.length);
  if (line === 'isready') console.log('readyok');
  if (line.startsWith('position fen ')) ply = Number(line.split(' ')[6]);
  if (line.startsWith('go ')) {
    console.log('info depth ' + (++searches) + ' score cp ' + (evalFile ? 100 : 0));
    const square = 'abcd'[ply % 4] + '0';
    console.log('bestmove ' + square + square);
  }
});

`,
    { mode: 0o755 },
  );
  return {
    bin,
    net: join(dir, 'test.jfnn'),
    raw: () => readFileSync(log),
    commands: () => readFileSync(log, 'utf8').trimEnd().split('\n'),
  };
}

async function withEngine(bin: string, run: () => Promise<void>) {
  const previous = process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
  const previousNet = process.env.MISTBOARD_JUNGLE_FLIP_NET;
  const net = join(bin, '..', 'test.jfnn');
  if (!bin.startsWith('/nonexistent/')) writeFileSync(net, 'stub net');
  process.env.MISTBOARD_JUNGLE_FLIP_NET = net;
  process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = bin;
  try {
    await run();
  } finally {
    if (previousNet === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_NET;
    else process.env.MISTBOARD_JUNGLE_FLIP_NET = previousNet;
    if (previous === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = previous;
  }
}

test('Flip Jungle offers eight numbered levels', () => {
  assert.deepEqual(
    JUNGLE_FLIP_PLAYABLE_ENGINES.map((tier) => tier.id),
    [
      ...Array.from({ length: 6 }, (_, index) => `misty-jungle-flip-level-${index + 1}`),
      JUNGLE_FLIP_DEFAULT_ENGINE_ID,
      'misty-jungle-flip-level-8',
    ],
  );
});

test('the historical Flip Jungle id resolves to classical level 7 and unknown ids fail closed', () => {
  assert.equal(
    jungleFlipEngineTierFor(JUNGLE_FLIP_DEFAULT_ENGINE_ID),
    JUNGLE_FLIP_PLAYABLE_ENGINES[6],
  );
  assert.equal(jungleFlipEngineTierFor('misty-jungle-flip-level-9'), null);
  assert.equal(jungleFlipEngineTierFor('misty-jungle-flip-level-7'), null);
  assert.equal(jungleFlipEngineTierFor(JUNGLE_FLIP_DEFAULT_ENGINE_ID)?.nodes, 2_500_000);
});

test('each level sends exactly its measured weakening options and search budget', async () => {
  const weakening = [
    [1, 1],
    [0.3, 2],
    [0.1, 2],
    [0.02, 2],
    [0.01, 4],
  ];
  const budgets = [
    2_500_000, 2_500_000, 2_500_000, 2_500_000, 2_500_000, 2_000, 2_500_000, 1_000_000,
  ];
  for (let level = 1; level <= 8; level++) {
    const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
    await withEngine(engine.bin, async () => {
      const result = await jungleFlipLiveEngineMove(
        level === 7 ? JUNGLE_FLIP_DEFAULT_ENGINE_ID : `misty-jungle-flip-level-${level}`,
        fen,
        {
          tieSeed: '12345',
        },
      );
      assert.equal(result.best, 'a0a0');
    });
    const commands = engine.commands();
    assert.deepEqual(
      commands.filter((command) => command.startsWith('setoption ')),
      [
        `setoption name EvalFile value ${level === 8 ? engine.net : ''}`,
        ...(level <= 5
          ? [
              `setoption name Noise value ${weakening[level - 1]![0]}`,
              `setoption name NoiseDepth value ${weakening[level - 1]![1]}`,
              'setoption name Seed value 12345',
            ]
          : []),
      ],
    );
    assert.ok(commands.includes(`go nodes ${budgets[level - 1]} movetime 5000`));
  }
});

test('weak levels refuse binaries missing either weakening option or Seed', async () => {
  for (const options of [[], ['Noise', 'Seed'], ['NoiseDepth', 'Seed'], ['Noise', 'NoiseDepth']]) {
    const engine = fakeEngine([...options, 'EvalFile']);
    await withEngine(engine.bin, async () => {
      for (let level = 1; level <= 5; level++) {
        await assert.rejects(
          jungleFlipLiveEngineMove(`misty-jungle-flip-level-${level}`, fen, { tieSeed: '12345' }),
          /UCI engine does not advertise configured option\(s\): (?:Noise|NoiseDepth|Seed)/,
        );
      }
    });
  }
});

test('legacy play and analysis require no weakening options and preserve their budgets', async () => {
  const engine = fakeEngine(['EvalFile']);
  await withEngine(engine.bin, async () => {
    await jungleFlipLiveEngineMove(JUNGLE_FLIP_DEFAULT_ENGINE_ID, fen, { tieSeed: '99' });
    await evaluateJungleFlipFenNodes(fen, { nodes: 512_000, movetimeCapMs: 2500 });
  });
  const commands = engine.commands();
  assert.deepEqual(
    commands.filter((command) => command.startsWith('setoption ')),
    ['setoption name EvalFile value ', 'setoption name EvalFile value '],
  );
  assert.deepEqual(
    commands.filter((command) => command.startsWith('go ')),
    ['go nodes 2500000 movetime 5000', 'go nodes 512000 movetime 2500'],
  );
});

test('Flip Jungle EvE is registered and can load all eight levels plus its random floor', () => {
  assert.equal(eveAdapterFor('jungle-flip'), jungleFlipEveAdapter);
  const known = new Set<string>(knownEngineIds());
  for (const id of [
    ...JUNGLE_FLIP_PLAYABLE_ENGINES.map((tier) => tier.id),
    JUNGLE_FLIP_RANDOM_ENGINE_ID,
  ]) {
    assert.ok(known.has(id));
    assert.equal(loadEngine(id).gameSpecId, 'jungle-flip');
  }
  assert.equal(jungleFlipEveAdapter.tierFor('misty-jungle-level-2'), null);
  for (const tier of JUNGLE_FLIP_PLAYABLE_ENGINES) {
    const bot = firstPartyBotForEngine(tier.id);
    assert.equal(bot?.id, 'misty');
    assert.equal(botSeatName(bot!, tier.id), `Misty Level ${tier.level}`);
  }
});

test('Flip Jungle EvE plays a short fake-binary game through the live search path', async () => {
  const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    const game = await playVariantEngineGame(jungleFlipEveAdapter, {
      roomId: 'jgf_eve_ladder',
      firstEngineId: 'misty-jungle-flip-level-1',
      secondEngineId: 'misty-jungle-flip-level-8',
      maxPlies: 4,
      openingPolicy: { seed: '930' },
    });
    assert.equal(game.status, 'completed');
    assert.equal(game.plyCount, 4);
    assert.equal(game.termination, 'truncated');
    const commands = engine.commands();
    assert.equal(commands.filter((line) => line === 'setoption name Noise value 1').length, 2);
    const seeds = commands.filter((line) => line.startsWith('setoption name Seed value '));
    assert.equal(seeds.length, 2);
    assert.equal(seeds[0], seeds[1]);
    assert.equal(commands.filter((line) => line.startsWith('position fen ')).length, 4);
    assert.ok(commands.includes(`position fen ${fen}`));
  });
});

test('EvE uses reproducible secret deals but sends identical whole requests for indistinguishable boards', async () => {
  const start = (seed: string) =>
    playVariantEngineGame(jungleFlipEveAdapter, {
      roomId: 'jgf_eve_hidden',
      startedAt: 1000,
      firstEngineId: 'misty-jungle-flip-level-4',
      secondEngineId: 'misty-jungle-flip-level-4',
      maxPlies: 0,
      openingPolicy: { seed },
    });
  const game = await start('930');
  const same = await start('930');
  const different = await start('931');
  assert.deepEqual(game.events[0], same.events[0]);
  assert.notDeepEqual(game.events[0], different.events[0]);
  for (const id of [
    'misty-jungle-flip-level-4',
    JUNGLE_FLIP_DEFAULT_ENGINE_ID,
    'misty-jungle-flip-level-8',
  ]) {
    const requests: string[] = [];
    const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
    await withEngine(engine.bin, async () => {
      for (const events of [game.events, different.events]) {
        writeFileSync(join(engine.bin, '..', 'commands.txt'), '');
        await jungleFlipEveAdapter.search(id, [], { movetimeMs: 5000 }, { events, color: 'red' });
        requests.push(JSON.stringify(engine.commands()));
      }
    });
    assert.equal(requests[0], requests[1], id);
  }
});

test('the EvE-only random floor plays without a binary', async () => {
  await withEngine('/nonexistent/jungle-flip-engine', async () => {
    const game = await playVariantEngineGame(jungleFlipEveAdapter, {
      roomId: 'jgf_eve_random',
      firstEngineId: JUNGLE_FLIP_RANDOM_ENGINE_ID,
      secondEngineId: JUNGLE_FLIP_RANDOM_ENGINE_ID,
      maxPlies: 4,
      rng: () => 0.5,
      openingPolicy: { seed: '930' },
    });
    assert.equal(game.status, 'completed');
    assert.equal(game.plyCount, 4);
  });
});

test('L8 records a distinct neural identity and sends only its net and 1M-node budget', async () => {
  const registry = loadEngine('misty-jungle-flip-level-8');
  assert.equal(registry.configHash, 'misty-jungle-flip-0.6.0-nnue-nodes-1000000');
  assert.equal(registry.playSignature, registry.configHash);
  assert.deepEqual(registry.config, {
    kind: 'jungle-flip-uci',
    evaluation: 'nnue',
    nodes: 1_000_000,
    movetime_ms: 5000,
  });
  assert.equal(
    loadEngine(JUNGLE_FLIP_DEFAULT_ENGINE_ID).configHash,
    'misty-jungle-flip-0.6.0-nodes-2500000',
  );
  const engine = fakeEngine(['EvalFile']);
  await withEngine(engine.bin, async () => {
    await jungleFlipLiveEngineMove('misty-jungle-flip-level-8', fen, { tieSeed: '12345' });
  });
  assert.deepEqual(
    engine.raw(),
    Buffer.from(
      `uci\nsetoption name EvalFile value ${engine.net}\nucinewgame\nisready\nposition fen ${fen}\ngo nodes 1000000 movetime 5000\n`,
    ),
  );
});

test('L8 requires a readable non-empty file; the classical ladder stays L1-7', async () => {
  const engine = fakeEngine(['EvalFile']);
  await withEngine(engine.bin, async () => {
    assert.equal(jungleFlipNetPath(), engine.net);
    assert.equal(jungleFlipEngineAvailable('misty-jungle-flip-level-8'), true);
    const empty = join(engine.bin, '..', 'empty.jfnn');
    writeFileSync(empty, '');
    for (const path of [undefined, `${engine.net}.missing`, join(engine.bin, '..'), empty]) {
      if (path === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_NET;
      else process.env.MISTBOARD_JUNGLE_FLIP_NET = path;
      assert.equal(jungleFlipNetPath(), null);
      assert.equal(jungleFlipEngineAvailable('misty-jungle-flip-level-8'), false);
      assert.deepEqual(
        JUNGLE_FLIP_PLAYABLE_ENGINES.filter((tier) => jungleFlipEngineAvailable(tier.id)).map(
          (tier) => tier.level,
        ),
        [1, 2, 3, 4, 5, 6, 7],
      );
      await assert.rejects(
        jungleFlipLiveEngineMove('misty-jungle-flip-level-8', fen),
        /net.*not available/i,
      );
    }
    assert.equal(jungleFlipEngineAvailable(), true);
    assert.equal(jungleFlipEngineAvailable('unknown'), false);
    assert.equal(engine.raw().length, 0, 'no process ran without the net');
  });
});

test('L8 rechecks its net after waiting for a slot and releases the slot', async (t) => {
  const engine = fakeEngine(['EvalFile']);
  await withEngine(engine.bin, async () => {
    let admit!: (release: () => void) => void;
    let released = false;
    t.mock.method(
      UciEnginePool.prototype,
      'acquire',
      () =>
        new Promise<() => void>((resolve) => {
          admit = resolve;
        }),
    );
    const pending = jungleFlipLiveEngineMove('misty-jungle-flip-level-8', fen);
    rmSync(engine.net);
    admit(() => {
      released = true;
    });
    await assert.rejects(pending, /net.*not available/i);
    assert.equal(released, true);
    assert.equal(engine.raw().length, 0);
  });
});

test('L8 rejects a binary without EvalFile support', async () => {
  const engine = fakeEngine([]);
  await withEngine(engine.bin, async () => {
    await assert.rejects(
      jungleFlipLiveEngineMove('misty-jungle-flip-level-8', fen),
      /does not advertise.*EvalFile/,
    );
  });
});

test('room creation holds only neural L8 when the net disappears', async (t) => {
  const saved = process.env.MISTBOARD_JUNGLE_FLIP_ENABLED;
  process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = 'true';
  t.after(() => {
    if (saved === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENABLED;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = saved;
  });
  const engine = fakeEngine(['EvalFile']);
  await withEngine(engine.bin, async () => {
    const seated: string[] = [];
    const ctx: JungleFlipCreateContext = {
      databaseRequired: false,
      refusesCreate: () => false,
      drainDeadlineMs: () => null,
      createJungleFlipRoom: async (_clock, _pref, bot) => {
        seated.push(bot!.engineId);
        return { ok: true, room: { id: 'jgf_net_gate', gameSpecId: 'jungle-flip', rated: false } };
      },
    };
    const request = async (engineId?: string) => {
      let status = 0;
      const response = {
        writeHead: (code: number) => {
          status = code;
        },
        end: () => {},
      } as unknown as ServerResponse;
      await handleJungleFlipCreate(ctx, response, {
        gameSpecId: 'jungle-flip',
        mode: 'pve',
        engineId,
      });
      return status;
    };
    assert.equal(await request('misty-jungle-flip-level-8'), 201);
    delete process.env.MISTBOARD_JUNGLE_FLIP_NET;
    assert.equal(await request('misty-jungle-flip-level-8'), 404);
    assert.equal(await request(), 201);
    assert.equal(await request('misty-jungle-flip-level-1'), 201);
    assert.equal(await request('misty-jungle-flip-level-9'), 400);
    assert.deepEqual(seated, [
      'misty-jungle-flip-level-8',
      JUNGLE_FLIP_DEFAULT_ENGINE_ID,
      'misty-jungle-flip-level-1',
    ]);
  });
});

test('classical requests clear EvalFile even after L8 on the same warm process; analysis stays classical', async () => {
  const engine = fakeEngine(['EvalFile', 'Noise', 'NoiseDepth', 'Seed']);
  const cache = new UciWarmSessionCache({ name: 'jungle-flip-net-isolation' });
  try {
    // UciEnginePool gates slots; runUciEval currently spawns a fresh process per request.
    // Drive the actual command builder through one reused warm process too, so adding
    // warm reuse later cannot silently carry L8's evaluation into another tier.
    for (const tier of JUNGLE_FLIP_PLAYABLE_ENGINES.filter((entry) => entry.level !== 8)) {
      for (const opts of [
        { evalFile: engine.net },
        { noise: tier.noise, noiseDepth: tier.noiseDepth, tieSeed: '12345' },
      ]) {
        const commands = buildJungleFlipEngineCommands(fen, opts);
        const result = await cache.withSession(
          { bin: engine.bin, initCommands: ['uci', 'isready'] },
          (session) =>
            session.evalPosition({
              positionCommand: commands.slice(1, -1).join('\n'),
              goCommand: commands.at(-1)!,
              timeoutMs: 2000,
              timeoutMessage: 'test search timed out',
            }),
        );
        assert.equal(result.cp, opts.evalFile ? 100 : 0);
      }
    }
    assert.equal(cache.stats().spawned, 1);
    assert.equal(cache.stats().reused, 13);
  } finally {
    cache.closeAll();
  }
  await withEngine(engine.bin, async () => {
    await evaluateJungleFlipFenNodes(fen, { nodes: 512_000, movetimeCapMs: 2500 });
  });
  const commands = engine.commands();
  assert.deepEqual(commands.slice(-5), [
    'setoption name EvalFile value ',
    'ucinewgame',
    'isready',
    `position fen ${fen}`,
    'go nodes 512000 movetime 2500',
  ]);
});

test('the whole L8 engine request is byte-identical after swapping canonical face-down pieces', async () => {
  const state = createInitialJungleFlipState(
    'jgf_hidden_net',
    createJungleFlipDeal(() => 0.5),
  );
  const swapped = structuredClone(state);
  const squares = Object.keys(state.board) as JungleFlipSquare[];
  const first = squares[0]!;
  const second = squares.find((square) => state.board[square]!.role !== state.board[first]!.role)!;
  assert.ok(state.board[first]!.faceDown && state.board[second]!.faceDown);
  [swapped.board[first], swapped.board[second]] = [swapped.board[second], swapped.board[first]];
  assert.notDeepEqual(state, swapped);
  const engine = fakeEngine(['EvalFile']);
  const requests: string[] = [];
  await withEngine(engine.bin, async () => {
    const tier = jungleFlipEngineTierFor('misty-jungle-flip-level-8')!;
    const wire: Buffer[] = [];
    for (const canonical of [state, swapped]) {
      const redacted = jungleFlipStateToEngineFen(canonical);
      requests.push(
        JSON.stringify(
          buildJungleFlipEngineRequest(redacted, {
            evalFile: jungleFlipNetPath()!,
            nodes: tier.nodes,
            movetimeCapMs: tier.movetimeCapMs,
            tieSeed: '12345',
          }),
        ),
      );
      writeFileSync(join(engine.bin, '..', 'commands.txt'), '');
      await jungleFlipLiveEngineMove('misty-jungle-flip-level-8', redacted, { tieSeed: '12345' });
      wire.push(engine.raw());
    }
    assert.deepEqual(
      wire[0],
      wire[1],
      'actual subprocess receives byte-identical whole command streams',
    );
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
});

test('the bots API omits an unavailable neural Flip Jungle play option', async (t) => {
  const enabled = process.env.MISTBOARD_JUNGLE_FLIP_ENABLED;
  process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = 'true';
  t.after(() => {
    if (enabled === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENABLED;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = enabled;
  });
  const engine = fakeEngine(['EvalFile']);
  const bot = {
    id: 'fixture-neural',
    activeEngineId: 'misty-jungle-flip-level-8',
    defaultGameSpecId: 'jungle-flip',
    supportedGameSpecIds: ['jungle-flip'],
  };
  await withEngine(engine.bin, async () => {
    assert.deepEqual(botPlayOptions(bot), [
      {
        gameSpecId: 'jungle-flip',
        engineId: 'misty-jungle-flip-level-8',
        playable: true,
        version: '0.6.0',
      },
    ]);
    delete process.env.MISTBOARD_JUNGLE_FLIP_NET;
    assert.deepEqual(botPlayOptions(bot), []);
    const classical = botPlayOptions({
      ...bot,
      id: 'misty',
      activeEngineId: JUNGLE_FLIP_DEFAULT_ENGINE_ID,
    });
    assert.equal(classical[0]!.engineId, JUNGLE_FLIP_DEFAULT_ENGINE_ID);
    assert.ok(!JSON.stringify(classical).includes('level-8'));
  });
});
