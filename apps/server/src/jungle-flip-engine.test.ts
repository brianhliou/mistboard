import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { botSeatName, firstPartyBotForEngine } from './first-party-bots.js';
import {
  evaluateJungleFlipFenNodes,
  JUNGLE_FLIP_DEFAULT_ENGINE_ID,
  JUNGLE_FLIP_PLAYABLE_ENGINES,
  JUNGLE_FLIP_RANDOM_ENGINE_ID,
  jungleFlipEngineTierFor,
  jungleFlipLiveEngineMove,
} from './jungle-flip-engine.js';
import { jungleFlipEveAdapter } from './jungle-flip-eve-adapter.js';
import { playVariantEngineGame } from './variant-eve.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const fen = 'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0';

function fakeEngine(options: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'jungle-flip-ladder-'));
  const bin = join(dir, 'engine.cjs');
  const log = join(dir, 'commands.txt');
  writeFileSync(log, '');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
let ply = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  if (line === 'uci') {
    for (const name of ${JSON.stringify(options)}) console.log('option name ' + name + ' type string default 0');
    console.log('uciok');
  }
  if (line === 'isready') console.log('readyok');
  if (line.startsWith('position fen ')) ply = Number(line.split(' ')[6]);
  if (line.startsWith('go ')) {
    const square = 'abcd'[ply % 4] + '0';
    console.log('bestmove ' + square + square);
  }
});

`,
    { mode: 0o755 },
  );
  return { bin, commands: () => readFileSync(log, 'utf8').trim().split('\n') };
}

async function withEngine(bin: string, run: () => Promise<void>) {
  const previous = process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
  process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = bin;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = previous;
  }
}

test('Flip Jungle offers eight numbered levels', () => {
  assert.deepEqual(
    JUNGLE_FLIP_PLAYABLE_ENGINES.map((tier) => tier.id),
    Array.from({ length: 8 }, (_, index) => `misty-jungle-flip-level-${index + 1}`),
  );
});

test('the historical Flip Jungle id resolves to level 8 and unknown ids fail closed', () => {
  assert.equal(
    jungleFlipEngineTierFor(JUNGLE_FLIP_DEFAULT_ENGINE_ID),
    JUNGLE_FLIP_PLAYABLE_ENGINES[7],
  );
  assert.equal(jungleFlipEngineTierFor('misty-jungle-flip-level-9'), null);
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
    2_500_000, 2_500_000, 2_500_000, 2_500_000, 2_500_000, 2_000, 100_000, 2_500_000,
  ];
  for (let level = 1; level <= 8; level++) {
    const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed']);
    await withEngine(engine.bin, async () => {
      const result = await jungleFlipLiveEngineMove(`misty-jungle-flip-level-${level}`, fen, {
        tieSeed: '12345',
      });
      assert.equal(result.best, 'a0a0');
    });
    const commands = engine.commands();
    assert.deepEqual(
      commands.filter((command) => command.startsWith('setoption ')),
      level <= 5
        ? [
            `setoption name Noise value ${weakening[level - 1]![0]}`,
            `setoption name NoiseDepth value ${weakening[level - 1]![1]}`,
            'setoption name Seed value 12345',
          ]
        : [],
    );
    assert.ok(commands.includes(`go nodes ${budgets[level - 1]} movetime 5000`));
  }
});

test('weak levels refuse binaries missing either weakening option or Seed', async () => {
  for (const options of [[], ['Noise', 'Seed'], ['NoiseDepth', 'Seed'], ['Noise', 'NoiseDepth']]) {
    const engine = fakeEngine(options);
    await withEngine(engine.bin, async () => {
      for (let level = 1; level <= 5; level++) {
        await assert.rejects(
          jungleFlipLiveEngineMove(`misty-jungle-flip-level-${level}`, fen, { tieSeed: '12345' }),
          /UCI engine does not advertise configured option\(s\)/,
        );
      }
    });
  }
});

test('legacy play and analysis require no weakening options and preserve their budgets', async () => {
  const engine = fakeEngine([]);
  await withEngine(engine.bin, async () => {
    await jungleFlipLiveEngineMove(JUNGLE_FLIP_DEFAULT_ENGINE_ID, fen, { tieSeed: '99' });
    await evaluateJungleFlipFenNodes(fen, { nodes: 512_000, movetimeCapMs: 2500 });
  });
  const commands = engine.commands();
  assert.deepEqual(
    commands.filter((command) => command.startsWith('setoption ')),
    [],
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
  const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed']);
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
  const requests: string[] = [];
  for (const events of [game.events, different.events]) {
    const engine = fakeEngine(['Noise', 'NoiseDepth', 'Seed']);
    await withEngine(engine.bin, async () => {
      await jungleFlipEveAdapter.search(
        'misty-jungle-flip-level-4',
        [],
        { movetimeMs: 5000 },
        { events, color: 'red' },
      );
    });
    requests.push(JSON.stringify(engine.commands()));
  }
  assert.equal(requests[0], requests[1]);
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
