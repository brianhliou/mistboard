import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildFairyStockfishCommands,
  UciWarmSessionCache,
  type WarmSessionSpec,
} from './uci-engine-harness.js';
import {
  fsfXiangqiUciToPikafishUci,
  pikafishUciToFsfXiangqiUci,
  XIANGQI_FSF_NNUE_NET,
  XIANGQI_FSF_PLAYABLE_ENGINES,
  xiangqiFsfEngineTierFor,
  xiangqiFsfLiveEngineMove,
} from './xiangqi-fsf-engine.js';

test('FSF Xiangqi levels 1-7 keep the Lichess/PlayStrategy weakening profiles', () => {
  assert.deepEqual(XIANGQI_FSF_PLAYABLE_ENGINES.slice(0, 7), [
    {
      id: 'fairy-stockfish-xiangqi-level-1',
      name: 'Fairy-Stockfish Level 1',
      skill: -9,
      depth: 5,
      movetimeMs: 50,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-2',
      name: 'Fairy-Stockfish Level 2',
      skill: -5,
      depth: 5,
      movetimeMs: 100,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-3',
      name: 'Fairy-Stockfish Level 3',
      skill: -1,
      depth: 5,
      movetimeMs: 150,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-4',
      name: 'Fairy-Stockfish Level 4',
      skill: 3,
      depth: 5,
      movetimeMs: 200,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-5',
      name: 'Fairy-Stockfish Level 5',
      skill: 7,
      depth: 5,
      movetimeMs: 300,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-6',
      name: 'Fairy-Stockfish Level 6',
      skill: 11,
      depth: 8,
      movetimeMs: 400,
    },
    {
      id: 'fairy-stockfish-xiangqi-level-7',
      name: 'Fairy-Stockfish Level 7',
      skill: 16,
      depth: 13,
      movetimeMs: 500,
    },
  ]);
  assert.equal(xiangqiFsfEngineTierFor('unknown'), null);
});

// 2026-09-02: a human beat the old Level 8 (skill 20, depth 22, 1 s, classical,
// 16 MB hash) in 37 moves, and the EvE ladder had it ~500 Elo above a random
// mover. The top rung is now node-anchored with the NNUE net. These pin the shape
// so a "small tidy" cannot quietly put it back on a movetime-only classical search.
test('FSF Xiangqi level 8 is the node-anchored NNUE rung', () => {
  const top = XIANGQI_FSF_PLAYABLE_ENGINES[7]!;
  assert.equal(top.id, 'fairy-stockfish-xiangqi-level-8');
  assert.equal(top.name, 'Fairy-Stockfish Level 8');
  assert.equal(top.skill, 20, 'full strength: no stochastic weakening on the top rung');
  assert.equal(top.nnue, true);
  assert.equal(top.depth, undefined, 'no depth cap: the node budget is the strength anchor');
  assert.ok((top.nodes ?? 0) >= 1_000_000, 'node anchor at or above 1M');
  assert.ok(top.movetimeMs >= 4_000, 'ceiling high enough for the node budget to bind on prod');
  assert.ok((top.hashMb ?? 0) >= 64);
});

test('only the top rung runs the net; the calibrated rungs stay classical', () => {
  const withNet = XIANGQI_FSF_PLAYABLE_ENGINES.filter((tier) => tier.nnue);
  assert.deepEqual(
    withNet.map((tier) => tier.id),
    ['fairy-stockfish-xiangqi-level-8'],
  );
  for (const tier of XIANGQI_FSF_PLAYABLE_ENGINES.slice(0, 7)) {
    assert.equal(tier.nodes, undefined, `${tier.id}: depth-capped rung has no node budget`);
    assert.equal(typeof tier.depth, 'number');
  }
});

test('the net is named by its sha256 prefix, as FSF nets are', () => {
  assert.match(XIANGQI_FSF_NNUE_NET, /^xiangqi-[0-9a-f]{12}\.nnue$/);
});

test('level 8 command block: net on, hash set, node anchor + movetime ceiling, no depth', () => {
  const top = XIANGQI_FSF_PLAYABLE_ENGINES[7]!;
  const commands = buildFairyStockfishCommands({
    moves: ['h3e3'],
    variant: 'xiangqi',
    skill: top.skill,
    depth: top.depth,
    nodes: top.nodes,
    hashMb: top.hashMb,
    eval: { evalFile: '/app/bin/xiangqi-c07e94a5c7cb.nnue' },
    movetimeMs: 6_000,
  });
  assert.deepEqual(commands, [
    'uci',
    'setoption name Hash value 64',
    'setoption name Use NNUE value true',
    'setoption name EvalFile value /app/bin/xiangqi-c07e94a5c7cb.nnue',
    'setoption name UCI_Variant value xiangqi',
    'setoption name Skill Level value 20',
    'ucinewgame',
    'isready',
    'position startpos moves h3e3',
    'go nodes 1000000 movetime 6000',
  ]);
});

test('level 1-7 command block forces classical eval so the new binary cannot pick up a net', () => {
  const l7 = XIANGQI_FSF_PLAYABLE_ENGINES[6]!;
  const commands = buildFairyStockfishCommands({
    moves: [],
    variant: 'xiangqi',
    skill: l7.skill,
    depth: l7.depth,
    nodes: l7.nodes,
    hashMb: l7.hashMb,
    eval: 'classical',
    movetimeMs: l7.movetimeMs,
  });
  assert.deepEqual(commands, [
    'uci',
    'setoption name Use NNUE value false',
    'setoption name UCI_Variant value xiangqi',
    'setoption name Skill Level value 16',
    'ucinewgame',
    'isready',
    'position startpos',
    'go depth 13 movetime 500',
  ]);
});

test('translates between Pikafish and Fairy-Stockfish Xiangqi ranks', () => {
  assert.equal(pikafishUciToFsfXiangqiUci('b0c2'), 'b1c3');
  assert.equal(pikafishUciToFsfXiangqiUci('h2h9'), 'h3h10');
  assert.equal(fsfXiangqiUciToPikafishUci('b1c3'), 'b0c2');
  assert.equal(fsfXiangqiUciToPikafishUci('h3h10'), 'h2h9');
  assert.throws(() => pikafishUciToFsfXiangqiUci('b1c10'), /invalid Pikafish/);
  assert.throws(() => fsfXiangqiUciToPikafishUci('b0c2'), /invalid Fairy-Stockfish/);
});

// An ini-defined xiangqi variant silently runs classical evaluation even when it
// inherits xiangqi and sets nnueAlias. Keep the served variant built-in so NNUE
// tiers (including L8) use their net; the game server adjudicates the draw.
test('standard xiangqi FSF sessions use built-in xiangqi and the NNUE EvalFile for net tiers', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'xiangqi-fsf-session-'));
  const bin = join(dir, 'fairy-stockfish-xiangqi');
  const net = join(dir, XIANGQI_FSF_NNUE_NET);
  writeFileSync(bin, '');
  writeFileSync(net, '');
  const savedPath = process.env.MISTBOARD_FSF_XIANGQI_PATH;
  const savedNet = process.env.MISTBOARD_FSF_XIANGQI_NET;
  t.after(() => {
    if (savedPath === undefined) delete process.env.MISTBOARD_FSF_XIANGQI_PATH;
    else process.env.MISTBOARD_FSF_XIANGQI_PATH = savedPath;
    if (savedNet === undefined) delete process.env.MISTBOARD_FSF_XIANGQI_NET;
    else process.env.MISTBOARD_FSF_XIANGQI_NET = savedNet;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.MISTBOARD_FSF_XIANGQI_PATH = bin;
  process.env.MISTBOARD_FSF_XIANGQI_NET = net;
  const sessions: WarmSessionSpec[] = [];
  t.mock.method(UciWarmSessionCache.prototype, 'withSession', async (spec: WarmSessionSpec) => {
    sessions.push(spec);
    return { best: null };
  });

  for (const tier of XIANGQI_FSF_PLAYABLE_ENGINES) {
    await xiangqiFsfLiveEngineMove(tier.id, []);
    const session = sessions.at(-1)!;
    assert.equal(session.bin, bin);
    assert.deepEqual(
      session.initCommands.filter((command) => command.startsWith('setoption name UCI_Variant ')),
      ['setoption name UCI_Variant value xiangqi'],
      tier.id,
    );
    assert.equal(
      session.initCommands.some((command) => command.includes('VariantPath')),
      false,
    );
    assert.ok(
      session.initCommands.includes(`setoption name Use NNUE value ${Boolean(tier.nnue)}`),
      tier.id,
    );
    assert.deepEqual(
      session.initCommands.filter((command) => command.startsWith('setoption name EvalFile ')),
      tier.nnue ? [`setoption name EvalFile value ${net}`] : [],
      tier.id,
    );
  }
  assert.equal(sessions.length, XIANGQI_FSF_PLAYABLE_ENGINES.length);
});
