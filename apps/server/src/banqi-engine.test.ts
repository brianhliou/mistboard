import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBanqiSetup, createBanqiStateFromSetup, getBanqiLegalMoves } from '@mistboard/game';
import {
  BANQI_DEFAULT_ENGINE_ID,
  BANQI_PLAYABLE_ENGINES,
  BANQI_RANDOM_ENGINE_ID,
  banqiEngineTierFor,
  banqiLiveEngineMove,
  banqiNoiseSeed,
  evaluateBanqiFenNodes,
} from './banqi-engine.js';
import { banqiEveAdapter } from './banqi-eve-adapter.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { botSeatName, firstPartyBotForEngine } from './first-party-bots.js';
import { playBanqiEngineMoveIfReady } from './server-banqi-engine.js';
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
    raw: () => readFileSync(log),
    commands: () => readFileSync(log, 'utf8').trim().split('\n'),
  };
}

async function withEngine(bin: string, run: () => Promise<void>) {
  const previous = process.env.MISTBOARD_BANQI_ENGINE_PATH;
  process.env.MISTBOARD_BANQI_ENGINE_PATH = bin;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_BANQI_ENGINE_PATH;
    else process.env.MISTBOARD_BANQI_ENGINE_PATH = previous;
  }
}

test('Banqi offers eight levels, retaining the historical id at L8', () => {
  assert.deepEqual(
    BANQI_PLAYABLE_ENGINES.map((tier) => tier.id),
    [...Array.from({ length: 7 }, (_, index) => `misty-banqi-level-${index + 1}`), 'misty-banqi'],
  );
});

test('the historical Banqi id resolves to level 8 and unknown ids fail closed', () => {
  assert.equal(banqiEngineTierFor(BANQI_DEFAULT_ENGINE_ID), BANQI_PLAYABLE_ENGINES[7]);
  for (const id of ['misty-banqi-amateur', 'misty-banqi-strong', 'misty-banqi-strongest']) {
    assert.equal(banqiEngineTierFor(id), BANQI_PLAYABLE_ENGINES[7]);
  }
  assert.equal(banqiEngineTierFor('misty-banqi-level-9'), null);
  assert.equal(banqiEngineTierFor('misty-jungle-flip-level-4'), null);
});

test('L8 preserves the shipped registry identity and byte-identical UCI stream', async () => {
  const registry = loadEngine(BANQI_DEFAULT_ENGINE_ID);
  assert.equal(registry.configHash, 'misty-banqi-0.2.7-nodes-3500000');
  assert.equal(registry.playSignature, registry.configHash);
  assert.deepEqual(registry.config, { kind: 'banqi-uci', nodes: 3_500_000, movetime_ms: 8000 });
  for (const options of [
    {},
    { moves: ['a0b0', 'h3g3'], searchMoves: ['b0c0'], noProgressLimit: 40, seed: '12345' },
  ]) {
    const engine = fakeEngine(['NoProgressLimit']);
    await withEngine(engine.bin, async () => {
      await banqiLiveEngineMove(BANQI_DEFAULT_ENGINE_ID, fen, options);
    });
    // Literal pre-ladder protocol, including the final newline. No seed or noise at L8.
    const expected = `uci\nsetoption name NoProgressLimit value ${options.noProgressLimit ?? 60}\nucinewgame\nisready\nposition fen ${fen}${options.moves ? ' moves a0b0 h3g3' : ''}\ngo nodes 3500000 movetime 8000${options.searchMoves ? ' searchmoves b0c0' : ''}\n`;
    assert.deepEqual(engine.raw(), Buffer.from(expected));
  }
});

test('each level sends exactly its calibrated weakening options and search budget', async () => {
  const weakening = [
    [1, 1],
    [0.1, 2],
    [0.05, 2],
    [0.02, 2],
  ];
  const budgets = [3_500_000, 3_500_000, 3_500_000, 3_500_000, 2_000, 32_000, 200_000, 3_500_000];
  for (let level = 1; level <= 8; level++) {
    const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed']);
    await withEngine(engine.bin, async () => {
      const result = await banqiLiveEngineMove(
        level === 8 ? BANQI_DEFAULT_ENGINE_ID : `misty-banqi-level-${level}`,
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
        : ['setoption name NoProgressLimit value 60'],
    );
    assert.ok(commands.includes(`go nodes ${budgets[level - 1]} movetime 8000`));
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

test('legacy play and analysis require no weakening options and preserve their budgets', async () => {
  const engine = fakeEngine(['NoProgressLimit']);
  await withEngine(engine.bin, async () => {
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
  const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed']);
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
  const requests: string[] = [];
  for (const events of [game.events, different.events]) {
    const engine = fakeEngine(['NoProgressLimit', 'Noise', 'NoiseDepth', 'Seed']);
    await withEngine(engine.bin, async () => {
      await banqiEveAdapter.search(
        'misty-banqi-level-4',
        [],
        { movetimeMs: 8000 },
        { events, color: 'red' },
      );
    });
    requests.push(JSON.stringify(engine.commands()));
  }
  assert.equal(requests[0], requests[1]);
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

test('the v0.2.8 binary serves all eight levels through the Banqi adapter', {
  skip: process.env.MISTBOARD_BANQI_ENGINE_PATH
    ? false
    : 'set MISTBOARD_BANQI_ENGINE_PATH to v0.2.8',
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
