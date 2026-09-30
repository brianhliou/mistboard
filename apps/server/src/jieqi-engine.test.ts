import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { firstPartyBotEngineFor } from './first-party-bots.js';
import {
  ABJCHESS_JIEQI_ENGINE_VERSION,
  buildJieqiAnalysisCommands,
  buildJieqiGoCommand,
  buildJieqiLiveCommands,
  buildJieqiLiveInitCommands,
  JIEQI_ABJCHESS_ENGINE_ID,
  JIEQI_DEFAULT_ENGINE_ID,
  JIEQI_ENGINE_VERSION,
  JIEQI_PLAYABLE_ENGINES,
  jieqiAnalysisResourceOptions,
  jieqiEngineMove,
  jieqiEngineTierFor,
  jieqiEngineVersion,
  pickSkillMove,
  pikafishJieqiWarmSessionStats,
} from './jieqi-engine.js';

const FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    run();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// The 2026-08-23 defect: every jieqi PvE game was served by the DEPTH-CAPPED middle
// rung, so the bot stopped at depth 10 (~840ms) while its own 1200ms budget went
// unspent and the uncapped tier existed but was unreachable from any surface. Guard
// the property that broke, not the id: the served tier must have no depth cap.
test('the served jieqi tier is uncapped', () => {
  const tier = jieqiEngineTierFor(JIEQI_DEFAULT_ENGINE_ID);
  assert.ok(tier, 'the default engine id resolves to a tier');
  assert.equal(tier.depth, undefined, 'the tier every PvE game is served by has no depth cap');
  assert.ok(tier.movetimeMs >= 4_000, 'and is given at least the xiangqi top rung’s think time');
});

// Three surfaces name the jieqi engine independently (the create-route default, the
// Pikafish bot profile, and the web landing registry, which is asserted against this
// one in variant-registry-sync.test.ts). They drifted apart once already.
test('the Pikafish bot plays the same jieqi tier the create route defaults to', () => {
  assert.equal(firstPartyBotEngineFor('pikafish', 'jieqi'), JIEQI_DEFAULT_ENGINE_ID);
});

test('the tier ladder stays ordered weakest-first', () => {
  const depths = JIEQI_PLAYABLE_ENGINES.map((t) => t.depth ?? Number.POSITIVE_INFINITY);
  assert.deepEqual(
    [...depths].sort((a, b) => a - b),
    depths,
  );
  assert.deepEqual(
    JIEQI_PLAYABLE_ENGINES.slice(-2).map((t) => t.id),
    [JIEQI_DEFAULT_ENGINE_ID, JIEQI_ABJCHESS_ENGINE_ID],
    'level 8 (the create-route default) sits under the AB-JChess top slot',
  );
});

test('live moves configure Hash and Threads before ucinewgame', () => {
  withEnv(
    { MISTBOARD_PIKAFISH_JIEQI_HASH_MB: undefined, MISTBOARD_PIKAFISH_JIEQI_THREADS: undefined },
    () => {
      const commands = buildJieqiLiveCommands(FEN, { movetimeMs: 4_000 });
      const hash = commands.indexOf('setoption name Hash value 256');
      const threads = commands.findIndex((c) => c.startsWith('setoption name Threads value '));
      const newGame = commands.indexOf('ucinewgame');
      assert.ok(hash >= 0, 'Hash is set (the 16MB UCI default thrashes at this engine’s nps)');
      assert.ok(threads >= 0, 'Threads is set');
      assert.ok(hash < newGame && threads < newGame, 'both land before ucinewgame');
      assert.equal(commands.at(-1), 'go movetime 4000', 'no depth cap on the served tier');
    },
  );
});

test('Threads never claims more than half the container’s cores', () => {
  withEnv({ MISTBOARD_PIKAFISH_JIEQI_THREADS: undefined }, () => {
    const line = buildJieqiLiveCommands(FEN).find((c) =>
      c.startsWith('setoption name Threads value '),
    );
    const threads = Number(line?.split(' ').at(-1));
    assert.ok(threads >= 1 && threads <= 4);
    assert.ok(threads <= Math.max(1, Math.floor(availableParallelism() / 2)));
  });
});

test('both resource knobs are env-tunable and bounded', () => {
  withEnv(
    { MISTBOARD_PIKAFISH_JIEQI_HASH_MB: '512', MISTBOARD_PIKAFISH_JIEQI_THREADS: '3' },
    () => {
      const commands = buildJieqiLiveCommands(FEN);
      assert.ok(commands.includes('setoption name Hash value 512'));
      assert.ok(commands.includes('setoption name Threads value 3'));
    },
  );
  withEnv(
    { MISTBOARD_PIKAFISH_JIEQI_HASH_MB: '999999', MISTBOARD_PIKAFISH_JIEQI_THREADS: '0' },
    () => {
      const commands = buildJieqiLiveCommands(FEN);
      assert.ok(commands.includes('setoption name Hash value 4096'), 'hash clamps to the max');
      assert.ok(commands.includes('setoption name Threads value 1'), 'threads clamps to the min');
    },
  );
});

// Analysis sets its OWN resource options rather than borrowing the live ones:
// `jieqi-analysis.ts` caches sweeps by (room, engine, depth) on the promise that a fixed
// depth is the same tree on any box. A second thread breaks that promise (parallel search
// is order-dependent); a FIXED Hash does not, and 256MB is what keeps the table off the
// thrashing ceiling that corrupts the eval. So: Hash pinned, Threads pinned to 1, and
// neither may track the live config, which is env-tunable per box.
test('analysis evals stay single-threaded on a fixed table', () => {
  const commands = buildJieqiAnalysisCommands(FEN, { depth: 20, movetimeMs: 6_000 });
  assert.ok(commands.includes('setoption name Threads value 1'));
  assert.ok(commands.includes('setoption name Hash value 256'));
  assert.equal(commands.at(-1), 'go depth 20 movetime 6000');
});

// The Layer-1 sweep budgets NODES, not depth, because a fixed depth is not a fixed amount of
// search: extensions make a checking position cost multiples of a quiet one, so two adjacent
// plies come back incomparable and the eval graph shows a cliff nobody played. Anything that
// silently turns this back into a `go depth` command reintroduces that, so pin the shape.
test('a node budget emits go nodes, never go depth', () => {
  const commands = buildJieqiAnalysisCommands(FEN, { nodes: 500_000, movetimeMs: 6_000 });
  assert.equal(commands.at(-1), 'go nodes 500000 movetime 6000');
  assert.ok(!commands.some((c) => c.startsWith('go depth')));
});

// The movetime on the nodes arm is a backstop against a pathologically slow box, not a second
// dial: if it ever binds, that ply's result stops being reproducible and the cache promise
// breaks. It must survive as a cap, so assert it is still carried.
test('the node budget keeps its movetime backstop', () => {
  const commands = buildJieqiAnalysisCommands(FEN, { nodes: 1, movetimeMs: 6_000 });
  assert.match(commands.at(-1) ?? '', / movetime 6000$/);
});

// The analysis options must be literals, not a read of the live env knobs: if
// MISTBOARD_PIKAFISH_JIEQI_HASH_MB/_THREADS leaked in here, two boxes would cache
// different evals under the same (room, engine, depth) key.
test('analysis resource options ignore the live env knobs', () => {
  const prevHash = process.env.MISTBOARD_PIKAFISH_JIEQI_HASH_MB;
  const prevThreads = process.env.MISTBOARD_PIKAFISH_JIEQI_THREADS;
  process.env.MISTBOARD_PIKAFISH_JIEQI_HASH_MB = '1024';
  process.env.MISTBOARD_PIKAFISH_JIEQI_THREADS = '8';
  try {
    assert.deepEqual(jieqiAnalysisResourceOptions(), [
      'setoption name Hash value 256',
      'setoption name Threads value 1',
    ]);
  } finally {
    if (prevHash === undefined) delete process.env.MISTBOARD_PIKAFISH_JIEQI_HASH_MB;
    else process.env.MISTBOARD_PIKAFISH_JIEQI_HASH_MB = prevHash;
    if (prevThreads === undefined) delete process.env.MISTBOARD_PIKAFISH_JIEQI_THREADS;
    else process.env.MISTBOARD_PIKAFISH_JIEQI_THREADS = prevThreads;
  }
});

// ── Live moves ride a warm session ───────────────────────────────────────────
//
// The spawn-per-move loop paid the handshake and two 256 MB hash allocations on
// every ply; on the prod host those allocations are transparent-huge-page faults
// that can stall in direct compaction for seconds (#335). Two consecutive moves
// must therefore hit the SAME process, and only the first pays the handshake.

const fixtureDir = mkdtempSync(join(tmpdir(), 'jieqi-engine-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

// Advertises the options the live init block sets, answers the handshake, and
// answers every `go` with a fixed move. Counts `ucinewgame` on stderr-free stdout
// as an `info string`, which the eval reader ignores.
const fakePikaJieqi = (() => {
  const path = join(fixtureDir, 'pikafish-jieqi.mjs');
  writeFileSync(
    path,
    `#!/usr/bin/env node
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'uci') {
      process.stdout.write('option name Hash type spin default 16 min 1 max 4096\\n');
      process.stdout.write('option name Threads type spin default 1 min 1 max 16\\n');
      process.stdout.write('option name EvalFile type string default\\n');
      process.stdout.write('uciok\\n');
    }
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) process.stdout.write('info depth 3 score cp 12 nodes 30 time 2 pv b2e2\\nbestmove b2e2\\n');
  }
});
`,
  );
  chmodSync(path, 0o755);
  return path;
})();

test('jieqiEngineMove reuses one parked process across moves', async () => {
  const prior = process.env.MISTBOARD_PIKAFISH_PATH;
  process.env.MISTBOARD_PIKAFISH_PATH = fakePikaJieqi;
  try {
    const before = pikafishJieqiWarmSessionStats();
    const first = await jieqiEngineMove(FEN, { movetimeMs: 50, newGame: true });
    const second = await jieqiEngineMove(FEN, { movetimeMs: 50 });
    assert.equal(first, 'b2e2');
    assert.equal(second, 'b2e2');
    const after = pikafishJieqiWarmSessionStats();
    assert.equal(after.spawned - before.spawned, 1, 'one process for two moves');
    assert.equal(after.reused - before.reused, 1, 'the second move reused it');
    assert.equal(after.idle, 1, 'and it is parked for the next one');
  } finally {
    if (prior === undefined) delete process.env.MISTBOARD_PIKAFISH_PATH;
    else process.env.MISTBOARD_PIKAFISH_PATH = prior;
  }
});

test('the live block is the session handshake followed by position and go', () => {
  const commands = buildJieqiLiveCommands(FEN, { movetimeMs: 4_000, moves: ['h2e2'] });
  assert.deepEqual(
    commands.slice(0, buildJieqiLiveInitCommands().length),
    buildJieqiLiveInitCommands(),
  );
  assert.equal(commands.at(-2), `position fen ${FEN} moves h2e2`);
  assert.equal(commands.at(-1), buildJieqiGoCommand({ movetimeMs: 4_000 }));
  assert.equal(buildJieqiGoCommand({ movetimeMs: 1_200, depth: 10 }), 'go depth 10 movetime 1200');
});

test('pickSkillMove: full strength among near-equal moves, weak levels drift to worse ones', () => {
  const line = (index: number, move: string, cp: number) => ({
    index,
    move,
    cp,
    mate: null,
    depth: 5,
    pv: [move],
    bound: null,
  });
  const table = [
    line(1, 'a0a1', 50),
    line(2, 'b0b1', 40),
    line(3, 'c0c1', -150),
    line(4, 'd0d1', -400),
  ];
  // Skill 20 with no random push keeps the top move: 50 beats 40 + 80*10/128.
  assert.equal(pickSkillMove(table, 20, () => 0)?.move, 'a0a1');
  // Skill -9 (weakness 138 > 128): the deterministic push outweighs the loss, so the
  // worst candidate scores highest. This is Stockfish's own rule, not a bug.
  assert.equal(pickSkillMove(table, -9, () => 0)?.move, 'd0d1');
  // Only the first four lines are candidates, and an empty table has no pick.
  assert.equal(pickSkillMove([], 3), null);
  assert.equal(pickSkillMove([line(1, 'e3e4', 0)], -9)?.move, 'e3e4');
});

test('pickSkillMove: a forced mate outranks centipawns before the push', () => {
  const mateLine = {
    index: 1,
    move: 'h2e2',
    cp: null,
    mate: 2,
    depth: 5,
    pv: ['h2e2'],
    bound: null,
  };
  const quiet = { index: 2, move: 'a3a4', cp: 30, mate: null, depth: 5, pv: ['a3a4'], bound: null };
  assert.equal(pickSkillMove([mateLine, quiet], 16, () => 0)?.move, 'h2e2');
});

test('the ladder is eight levels, Lichess-shaped, with level 8 the full-strength tier', () => {
  const pikafish = JIEQI_PLAYABLE_ENGINES.filter((t) => t.engine === undefined);
  assert.equal(pikafish.length, 8);
  assert.deepEqual(
    pikafish.map((t) => t.skill ?? null),
    [-9, -5, -1, 3, 7, 11, 16, null],
  );
  assert.ok(JIEQI_PLAYABLE_ENGINES.every((t) => !t.retired));
  assert.equal(jieqiEngineTierFor('pikafish-jieqi-amateur')?.retired, true);
});

// The top slot (2026-10) is a different binary: its seat, artifacts and catalog
// entry must name AB-JChess's own build, and its handshake must load its net, or a
// session parked for PikaJieQi could serve it (sessions key on bin + handshake).
test('the AB-JChess top slot runs its own build at full strength and records its own version', () => {
  const tier = jieqiEngineTierFor(JIEQI_ABJCHESS_ENGINE_ID);
  assert.ok(tier);
  assert.equal(tier.engine, 'ab-jchess');
  assert.equal(tier.skill, undefined);
  assert.equal(tier.depth, undefined);
  assert.equal(tier.movetimeMs, jieqiEngineTierFor(JIEQI_DEFAULT_ENGINE_ID)?.movetimeMs);
  assert.equal(jieqiEngineVersion(JIEQI_ABJCHESS_ENGINE_ID), ABJCHESS_JIEQI_ENGINE_VERSION);
  assert.equal(jieqiEngineVersion(JIEQI_DEFAULT_ENGINE_ID), JIEQI_ENGINE_VERSION);
  assert.equal(firstPartyBotEngineFor('ab-jchess', 'jieqi'), JIEQI_ABJCHESS_ENGINE_ID);
});

test('the AB-JChess handshake loads its net from MISTBOARD_ABJCHESS_NET; PikaJieQi loads none', () => {
  const saved = process.env.MISTBOARD_ABJCHESS_NET;
  process.env.MISTBOARD_ABJCHESS_NET = process.execPath; // any file that exists
  try {
    assert.ok(
      buildJieqiLiveInitCommands('ab-jchess').includes(
        `setoption name EvalFile value ${process.execPath}`,
      ),
    );
    assert.ok(!buildJieqiLiveInitCommands().some((line) => line.includes('EvalFile')));
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_ABJCHESS_NET;
    else process.env.MISTBOARD_ABJCHESS_NET = saved;
  }
});
