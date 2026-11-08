import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBanqiSetup, createBanqiStateFromSetup, getBanqiLegalMoves } from '@mistboard/game';
import {
  BANQI_DEFAULT_ENGINE_ID,
  BANQI_PLAYABLE_ENGINES,
  BANQI_RANDOM_ENGINE_ID,
  banqiEngineAvailable,
  banqiEngineTierFor,
  banqiLiveEngineMove,
  banqiNetPath,
  banqiNoiseSeed,
  evaluateBanqiFenNodes,
} from './banqi-engine.js';
import { banqiEveAdapter } from './banqi-eve-adapter.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { botSeatName, firstPartyBotForEngine } from './first-party-bots.js';
import { type BanqiCreateContext, handleBanqiCreate } from './routes/banqi-rooms.js';
import { playBanqiEngineMoveIfReady } from './server-banqi-engine.js';
import { UciEnginePool } from './uci-engine-harness.js';
import { playVariantEngineGame } from './variant-eve.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const fen = banqiStateToEngineFen(
  createBanqiStateFromSetup(
    'bq_ladder',
    createBanqiSetup(() => 0.5),
  ),
);

function fakeEngine(options: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'banqi-ladder-'));
  const bin = join(dir, 'engine.cjs');
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'commands.txt');
  writeFileSync(log, '');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
let square = 'a0';
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  if (line === 'uci') {
    for (const name of ${JSON.stringify(options)}) console.log('option name ' + name + ' type string default 0');
    console.log('uciok');
  }
  if (line === 'isready') console.log('readyok');
  if (line.startsWith('position fen ')) {
    const rows = line.split(' ')[2].split('/').reverse();
    outer: for (let rank = 0; rank < rows.length; rank++) {
      let file = 0;
      for (const char of rows[rank]) {
        if (char === 'X') {
          square = 'abcdefgh'[file] + rank;
          break outer;
        }
        file += /[1-8]/.test(char) ? Number(char) : 1;
      }
    }
  }
  if (line.startsWith('go ')) {
    console.log('bestmove ' + square + square);
  }
});

`,
    { mode: 0o755 },
  );
  return {
    bin,
    net: join(dir, 'test.bqnn'),
    raw: () => readFileSync(log),
    commands: () => readFileSync(log, 'utf8').trim().split('\n'),
  };
}

async function withEngine(bin: string, run: () => Promise<void>) {
  const previous = process.env.MISTBOARD_BANQI_ENGINE_PATH;
  const previousNet = process.env.MISTBOARD_BANQI_NET;
  const net = join(bin, '..', 'test.bqnn');
  if (!bin.startsWith('/nonexistent/')) writeFileSync(net, 'stub net');
  process.env.MISTBOARD_BANQI_NET = net;
  process.env.MISTBOARD_BANQI_ENGINE_PATH = bin;
  try {
    await run();
  } finally {
    if (previousNet === undefined) delete process.env.MISTBOARD_BANQI_NET;
    else process.env.MISTBOARD_BANQI_NET = previousNet;
    if (previous === undefined) delete process.env.MISTBOARD_BANQI_ENGINE_PATH;
    else process.env.MISTBOARD_BANQI_ENGINE_PATH = previous;
  }
}

test('the stored Banqi id stays classical L7 at 3.5M nodes without a net or EvalFile', async () => {
  const tier = banqiEngineTierFor('misty-banqi')!;
  assert.equal(tier.level, 7);
  assert.equal(tier.evaluation, 'classical');
  assert.equal(tier.nodes, 3_500_000);
  const registry = loadEngine('misty-banqi');
  assert.equal(registry.configHash, 'misty-banqi-0.2.7-nodes-3500000');
  assert.equal(registry.playSignature, registry.configHash);
  assert.deepEqual(registry.config, {
    kind: 'banqi-uci',
    nodes: 3_500_000,
    movetime_ms: 8000,
  });
  const engine = fakeEngine(['NoProgressLimit', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    for (const net of [engine.net, undefined]) {
      if (net === undefined) delete process.env.MISTBOARD_BANQI_NET;
      else process.env.MISTBOARD_BANQI_NET = net;
      assert.equal(banqiEngineAvailable('misty-banqi'), true);
      assert.equal(banqiEngineAvailable(), true);
      await banqiLiveEngineMove('misty-banqi', fen);
    }
  });
  assert.deepEqual(
    engine.commands().filter((command) => command.startsWith('setoption ')),
    ['setoption name NoProgressLimit value 60', 'setoption name NoProgressLimit value 60'],
  );
  assert.deepEqual(
    engine.commands().filter((command) => command.startsWith('go ')),
    ['go nodes 3500000 movetime 8000', 'go nodes 3500000 movetime 8000'],
  );
});

test('Banqi offers eight levels, retaining the historical id at L7', () => {
  assert.deepEqual(
    BANQI_PLAYABLE_ENGINES.map((tier) => tier.id),
    [
      ...Array.from({ length: 6 }, (_, index) => `misty-banqi-level-${index + 1}`),
      'misty-banqi',
      'misty-banqi-level-8',
    ],
  );
});

test('the historical Banqi id resolves to level 7 and unknown ids fail closed', () => {
  assert.equal(banqiEngineTierFor(BANQI_DEFAULT_ENGINE_ID), BANQI_PLAYABLE_ENGINES[6]);
  for (const id of ['misty-banqi-amateur', 'misty-banqi-strong', 'misty-banqi-strongest']) {
    assert.equal(banqiEngineTierFor(id), BANQI_PLAYABLE_ENGINES[6]);
  }
  assert.equal(banqiEngineTierFor('misty-banqi-level-7'), null);
  assert.equal(banqiEngineTierFor('misty-banqi-level-9'), null);
  assert.equal(banqiEngineTierFor('misty-jungle-flip-level-4'), null);
});

test('L8 records NNUE and sends its EvalFile with the calibrated budget', async () => {
  const registry = loadEngine('misty-banqi-level-8');
  assert.equal(registry.configHash, 'misty-banqi-0.2.7-nnue-nodes-2000000');
  assert.equal(registry.playSignature, registry.configHash);
  assert.deepEqual(registry.config, {
    kind: 'banqi-uci',
    evaluation: 'nnue',
    nodes: 2_000_000,
    movetime_ms: 8000,
  });
  assert.match(registry.notes!, /0\.3\.0.*EvalFile/);
  for (const options of [
    {},
    { moves: ['a0b0', 'h3g3'], searchMoves: ['b0c0'], noProgressLimit: 40, seed: '12345' },
  ]) {
    const engine = fakeEngine(['NoProgressLimit', 'EvalFile']);
    await withEngine(engine.bin, async () => {
      await banqiLiveEngineMove('misty-banqi-level-8', fen, options);
    });
    const expected = `uci\nsetoption name EvalFile value ${engine.net}\nsetoption name NoProgressLimit value ${options.noProgressLimit ?? 60}\nucinewgame\nisready\nposition fen ${fen}${options.moves ? ' moves a0b0 h3g3' : ''}\ngo nodes 2000000 movetime 8000${options.searchMoves ? ' searchmoves b0c0' : ''}\n`;
    assert.deepEqual(engine.raw(), Buffer.from(expected));
  }
});

test('L8 is unavailable without a readable non-empty net; classical tiers remain available', async () => {
  const engine = fakeEngine(['NoProgressLimit', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    assert.equal(banqiNetPath(), engine.net);
    assert.equal(banqiEngineAvailable('misty-banqi-level-8'), true);
    const empty = join(engine.bin, '..', 'empty.bqnn');
    writeFileSync(empty, '');
    for (const path of [undefined, `${engine.net}.missing`, join(engine.bin, '..'), empty]) {
      if (path === undefined) delete process.env.MISTBOARD_BANQI_NET;
      else process.env.MISTBOARD_BANQI_NET = path;
      assert.equal(banqiNetPath(), null);
      assert.equal(banqiEngineAvailable('misty-banqi-level-8'), false);
      assert.deepEqual(
        BANQI_PLAYABLE_ENGINES.filter((tier) => banqiEngineAvailable(tier.id)).map(
          (tier) => tier.level,
        ),
        [1, 2, 3, 4, 5, 6, 7],
      );
      await assert.rejects(banqiLiveEngineMove('misty-banqi-level-8', fen), /net.*not available/i);
    }
    assert.deepEqual(engine.raw(), Buffer.from(''), 'no process ran with an unavailable net');
    assert.equal(banqiEngineAvailable('unknown'), false);
  });
});

test('L8 rechecks the net after waiting for a search slot and releases the slot on failure', async (t) => {
  const engine = fakeEngine(['NoProgressLimit', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    let admit!: (release: () => void) => void;
    let released = false;
    const acquire = t.mock.method(
      UciEnginePool.prototype,
      'acquire',
      () =>
        new Promise<() => void>((resolve) => {
          admit = resolve;
        }),
    );
    const pending = banqiLiveEngineMove('misty-banqi-level-8', fen);
    assert.equal(acquire.mock.callCount(), 1);
    rmSync(engine.net);
    admit(() => {
      released = true;
    });
    await assert.rejects(pending, /net.*not available/i);
    assert.equal(released, true);
    assert.deepEqual(engine.raw(), Buffer.from(''), 'no process started after net disappeared');
  });
});

test('L8 refuses binaries that do not advertise EvalFile', async () => {
  const engine = fakeEngine(['NoProgressLimit']);
  await withEngine(engine.bin, async () => {
    await assert.rejects(
      banqiLiveEngineMove('misty-banqi-level-8', fen),
      /does not advertise.*EvalFile/,
    );
  });
});

test('Banqi room creation holds L8 without its net and admits classical tiers', async (t) => {
  const saved = process.env.MISTBOARD_BANQI_ENABLED;
  process.env.MISTBOARD_BANQI_ENABLED = 'true';
  t.after(() => {
    if (saved === undefined) delete process.env.MISTBOARD_BANQI_ENABLED;
    else process.env.MISTBOARD_BANQI_ENABLED = saved;
  });
  const engine = fakeEngine(['NoProgressLimit', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    const seated: string[] = [];
    const ctx: BanqiCreateContext = {
      databaseRequired: false,
      refusesCreate: () => false,
      drainDeadlineMs: () => null,
      createBanqiRoom: async (_clock, _pref, bot) => {
        seated.push(bot!.engineId);
        return { ok: true, room: { id: 'bq_net_gate', gameSpecId: 'banqi', rated: false } };
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
      await handleBanqiCreate(ctx, response, { gameSpecId: 'banqi', mode: 'pve', engineId });
      return status;
    };
    assert.equal(await request(BANQI_DEFAULT_ENGINE_ID), 201);
    delete process.env.MISTBOARD_BANQI_NET;
    assert.equal(await request('misty-banqi-level-8'), 404);
    assert.equal(await request(BANQI_DEFAULT_ENGINE_ID), 201);
    assert.equal(await request(), 201, 'default classical L7 stays available without a net');
    assert.equal(await request('misty-banqi-level-6'), 201);
    assert.equal(await request('misty-banqi-level-9'), 400);
    assert.deepEqual(seated, [
      BANQI_DEFAULT_ENGINE_ID,
      BANQI_DEFAULT_ENGINE_ID,
      BANQI_DEFAULT_ENGINE_ID,
      'misty-banqi-level-6',
    ]);
  });
});

test('each level sends exactly its calibrated weakening options and search budget', async () => {
  const weakening = [
    [1, 1],
    [0.1, 2],
    [0.05, 2],
    [0.02, 2],
  ];
  const budgets = [
    3_500_000, 3_500_000, 3_500_000, 3_500_000, 32_000, 200_000, 3_500_000, 2_000_000,
  ];
  for (let level = 1; level <= 8; level++) {
    const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
    await withEngine(engine.bin, async () => {
      const result = await banqiLiveEngineMove(
        level === 7 ? BANQI_DEFAULT_ENGINE_ID : `misty-banqi-level-${level}`,
        fen,
        {
          seed: '12345',
        },
      );
      assert.equal(result.best, 'a0a0');
    });
    const commands = engine.commands();
    assert.deepEqual(
      commands.filter((command) => command.startsWith('setoption ')),
      level <= 4
        ? [
            'setoption name NoProgressLimit value 60',
            `setoption name Noise value ${weakening[level - 1]![0]}`,
            `setoption name NoiseDepth value ${weakening[level - 1]![1]}`,
            'setoption name Seed value 12345',
          ]
        : [
            ...(level === 8 ? [`setoption name EvalFile value ${engine.net}`] : []),
            'setoption name NoProgressLimit value 60',
          ],
    );
    assert.ok(commands.includes(`go nodes ${budgets[level - 1]} movetime 8000`));
    assert.equal(BANQI_PLAYABLE_ENGINES[level - 1]!.evaluation, level === 8 ? 'nnue' : 'classical');
  }
});

test('weak levels refuse binaries missing either weakening option or Seed', async () => {
  for (const options of [[], ['Noise', 'Seed'], ['NoiseDepth', 'Seed'], ['Noise', 'NoiseDepth']]) {
    const engine = fakeEngine(['NoProgressLimit', ...options]);
    await withEngine(engine.bin, async () => {
      for (let level = 1; level <= 4; level++) {
        await assert.rejects(
          banqiLiveEngineMove(`misty-banqi-level-${level}`, fen, { seed: '12345' }),
          /UCI engine does not advertise configured option\(s\)/,
        );
      }
    });
  }
});

test('classical play and analysis send neither EvalFile nor weakening options', async () => {
  const engine = fakeEngine(['NoProgressLimit']);
  await withEngine(engine.bin, async () => {
    delete process.env.MISTBOARD_BANQI_NET;
    await banqiLiveEngineMove(BANQI_DEFAULT_ENGINE_ID, fen, { seed: '99' });
    await evaluateBanqiFenNodes(fen, { nodes: 512_000, movetimeCapMs: 2500, noProgressLimit: 40 });
  });
  const commands = engine.commands();
  assert.deepEqual(
    commands.filter((command) => command.startsWith('setoption ')),
    ['setoption name NoProgressLimit value 60', 'setoption name NoProgressLimit value 40'],
  );
  assert.deepEqual(
    commands.filter((command) => command.startsWith('go ')),
    ['go nodes 3500000 movetime 8000', 'go nodes 512000 movetime 2500'],
  );
});

test('Banqi EvE is registered and can load all eight levels plus its random floor', () => {
  assert.equal(eveAdapterFor('banqi'), banqiEveAdapter);
  const known = new Set<string>(knownEngineIds());
  for (const id of [...BANQI_PLAYABLE_ENGINES.map((tier) => tier.id), BANQI_RANDOM_ENGINE_ID]) {
    assert.ok(known.has(id));
    assert.equal(loadEngine(id).gameSpecId, 'banqi');
  }
  assert.equal(banqiEveAdapter.tierFor('misty-jungle-level-2'), null);
  for (const tier of BANQI_PLAYABLE_ENGINES) {
    const bot = firstPartyBotForEngine(tier.id);
    assert.equal(bot?.id, 'misty');
    assert.equal(botSeatName(bot!, tier.id), `Misty Level ${tier.level}`);
  }
});

test('Banqi EvE plays a short fake-binary game through the live search path', async () => {
  const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
  await withEngine(engine.bin, async () => {
    const game = await playVariantEngineGame(banqiEveAdapter, {
      roomId: 'bq_eve_ladder',
      firstEngineId: 'misty-banqi-level-1',
      secondEngineId: BANQI_DEFAULT_ENGINE_ID,
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
    playVariantEngineGame(banqiEveAdapter, {
      roomId: 'bq_eve_hidden',
      startedAt: 1000,
      firstEngineId: 'misty-banqi-level-4',
      secondEngineId: 'misty-banqi-level-4',
      maxPlies: 0,
      openingPolicy: { seed },
    });
  const game = await start('930');
  const same = await start('930');
  const different = await start('931');
  assert.deepEqual(game.events[0], same.events[0]);
  assert.notDeepEqual(game.events[0], different.events[0]);
  for (const id of ['misty-banqi-level-4', BANQI_DEFAULT_ENGINE_ID, 'misty-banqi-level-8']) {
    const requests: string[] = [];
    const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed', 'EvalFile']);
    await withEngine(engine.bin, async () => {
      for (const events of [game.events, different.events]) {
        writeFileSync(join(engine.bin, '..', 'commands.txt'), '');
        await banqiEveAdapter.search(id, [], { movetimeMs: 8000 }, { events, color: 'red' });
        requests.push(JSON.stringify(engine.commands()));
      }
    });
    assert.equal(requests[0], requests[1], id);
  }
});

test('the EvE-only random floor plays without a binary', async () => {
  await withEngine('/nonexistent/banqi-engine', async () => {
    const game = await playVariantEngineGame(banqiEveAdapter, {
      roomId: 'bq_eve_random',
      firstEngineId: BANQI_RANDOM_ENGINE_ID,
      secondEngineId: BANQI_RANDOM_ENGINE_ID,
      maxPlies: 4,
      rng: () => 0.5,
      openingPolicy: { seed: '930' },
    });
    assert.equal(game.status, 'completed');
    assert.equal(game.plyCount, 4);
  });
});

test('the live driver passes a stable room-derived seed on every request', async () => {
  const seeds: Array<string | undefined> = [];
  for (const roomId of ['bq_seed_a', 'bq_seed_a', 'bq_seed_b']) {
    const state = createBanqiStateFromSetup(
      roomId,
      createBanqiSetup(() => 0.5),
    );
    const room = {
      id: roomId,
      events: [],
      projection: { state, seats: { red: 'misty-banqi-level-4', black: 'human' }, clock: null },
    };
    await playBanqiEngineMoveIfReady(
      { appendEvent: async () => 1, broadcastEventAppended: () => {} } as never,
      room as never,
      async (id, _fen, opts) => {
        assert.equal(id, 'misty-banqi-level-4');
        seeds.push(opts.seed);
        const best = banqiMoveToEngineUci(getBanqiLegalMoves(state)[0]!);
        return { best, cp: 0, mate: null, depth: 2, pv: [best] };
      },
    );
  }
  assert.equal(seeds[0], banqiNoiseSeed('bq_seed_a'));
  assert.equal(seeds[0], seeds[1]);
  assert.notEqual(seeds[0], seeds[2]);
  assert.notEqual(seeds[0], '0');
});

test('the v0.3.0 binary and NNUE net serve all eight levels through the Banqi adapter', {
  skip:
    process.env.MISTBOARD_BANQI_ENGINE_PATH && banqiNetPath()
      ? false
      : 'set MISTBOARD_BANQI_ENGINE_PATH to v0.3.0 and MISTBOARD_BANQI_NET',
}, async () => {
  const start = await playVariantEngineGame(banqiEveAdapter, {
    roomId: 'bq_eve_binary',
    firstEngineId: BANQI_DEFAULT_ENGINE_ID,
    secondEngineId: BANQI_DEFAULT_ENGINE_ID,
    maxPlies: 0,
    openingPolicy: { seed: '930' },
  });
  const { replayTenantEvents } = await import('./variant-tenant/runtime.js');
  const state = replayTenantEvents(banqiEveAdapter.tenant, start.events).state;
  for (const tier of BANQI_PLAYABLE_ENGINES) {
    const result = await banqiEveAdapter.search(
      tier.id,
      [],
      { movetimeMs: 8000 },
      {
        events: start.events,
        color: 'red',
      },
    );
    assert.ok(result.best, tier.id);
    assert.ok(
      banqiEveAdapter.legalMoveForUci(banqiEveAdapter.legalMoves(state), result.best),
      tier.id,
    );
  }
});
