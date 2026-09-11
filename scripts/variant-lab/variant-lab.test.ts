// The lab's own tests: the parts that must be right for every variant.
//
// Engine-backed cases run only when a Fairy-Stockfish binary is present, and
// say so when skipped rather than passing vacuously.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprintOf, makeHeader, readArtifacts, writeArtifact } from './lab/artifacts.js';
import { buildContext } from './lab/context.js';
import { LabEngine, locateBinary } from './lab/engine.js';
import { isLegal, playGame, randomPolicy } from './lab/play.js';
import { mulberry32 } from './lab/rng.js';
import { canonicalJson, diffRules, parseRuleArgs, resolveRules, rulesHash } from './lab/rules.js';
import { eloFromScore, tally, waldInterval } from './lab/stats.js';
import type { RuleSchema } from './lab/types.js';
import { duckXiangqiVariant } from './lab/variants/duck-xiangqi.js';
import { listLabVariants } from './lab/variants/index.js';
import { STOCK_FSF, xiangqiVariant } from './lab/variants/xiangqi.js';

const schema: RuleSchema = {
  facing: { options: ['forbidden', 'capture'], default: 'forbidden', blast: 'movegen', note: '' },
  stalemate: { options: ['loss', 'win'], default: 'loss', blast: 'terminal', note: '' },
  clock: { options: [60, 120], default: 60, blast: 'terminal', note: '' },
};

test('rules: parse, default, reject unknown keys and out-of-schema values', () => {
  assert.deepEqual(parseRuleArgs(['facing=capture', 'clock=120,stalemate=win']), {
    facing: 'capture',
    clock: 120,
    stalemate: 'win',
  });
  assert.deepEqual(resolveRules(schema, {}), { facing: 'forbidden', stalemate: 'loss', clock: 60 });
  assert.throws(() => resolveRules(schema, { facin: 'capture' }), /unknown rule "facin"/);
  assert.throws(() => resolveRules(schema, { clock: 90 }), /cannot be 90/);
});

test('rules: hash ignores key order and changes with any value', () => {
  const a = rulesHash('v', { facing: 'forbidden', clock: 60 });
  const b = rulesHash('v', { clock: 60, facing: 'forbidden' });
  const c = rulesHash('v', { clock: 120, facing: 'forbidden' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('rules: a diff names the changed keys and the widest blast radius', () => {
  const base = resolveRules(schema, {});
  assert.deepEqual(diffRules(schema, base, base), { changed: [], blast: null });
  assert.deepEqual(diffRules(schema, base, { ...base, clock: 120 }), {
    changed: ['clock'],
    blast: 'terminal',
  });
  assert.deepEqual(diffRules(schema, base, { ...base, clock: 120, facing: 'capture' }), {
    changed: ['clock', 'facing'],
    blast: 'movegen',
  });
});

test('artifacts: fingerprint separates rules, engine and lab version; files round-trip', () => {
  const engine = {
    idName: 'x',
    binaryPath: '/x',
    binarySha256: 'aaaa',
    variant: 'v',
    iniSha256: null,
  };
  const f1 = fingerprintOf('v', { clock: 60 }, engine);
  assert.equal(
    f1,
    fingerprintOf('v', { clock: 60 }, { ...engine, idName: 'renamed', binaryPath: '/y' }),
  );
  assert.notEqual(f1, fingerprintOf('v', { clock: 60 }, { ...engine, binarySha256: 'bbbb' }));
  assert.notEqual(f1, fingerprintOf('v', { clock: 60 }, null));
  assert.notEqual(f1, fingerprintOf('v', { clock: 120 }, engine));

  const dir = mkdtempSync(join(tmpdir(), 'lab-test-'));
  try {
    const header = makeHeader({
      command: 'randomplay',
      variant: 'v',
      rules: { clock: 60 },
      engine: null,
      args: { games: 1 },
      seed: 7,
      startedAt: new Date('2026-09-11T00:00:00Z'),
    });
    const file = writeArtifact(dir, header, { hello: 1 });
    assert.match(file, /randomplay-[0-9a-f]{12}-7-20260911T000000Z\.json$/);
    const back = readArtifacts(dir, 'v');
    assert.equal(back.length, 1);
    assert.equal(back[0]!.rulesHash, rulesHash('v', { clock: 60 }));
    assert.deepEqual(back[0]!.result, { hello: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stats: interval, elo and tally behave at the edges', () => {
  assert.deepEqual(waldInterval(0, 0), { p: 0, halfWidth: 0, n: 0 });
  assert.equal(waldInterval(50, 100).p, 0.5);
  assert.equal(eloFromScore(0.5), 0);
  assert.ok(Math.abs(eloFromScore(0.9) - 382) < 1);
  assert.equal(eloFromScore(1), Number.POSITIVE_INFINITY);
  const t = tally([
    { moves: [], plies: 10, winner: 'red', reason: 'x' },
    { moves: [], plies: 20, winner: null, reason: 'draw' },
    { moves: [], plies: 30, winner: 'black', reason: 'x' },
  ]);
  assert.equal(t.redScore.n, 2);
  assert.equal(t.undecided, 1);
  assert.equal(t.lengths.median, 20);
});

test('every registered variant resolves its defaults and produces a playable start', async () => {
  const variants = await listLabVariants();
  assert.deepEqual(
    variants.map((v) => v.id),
    ['duck-xiangqi', 'xiangqi'],
  );
  for (const variant of variants) {
    const rules = resolveRules(variant.ruleSchema, {});
    const { kernel, engine } = variant.create(rules);
    const start = kernel.initial('t');
    assert.equal(kernel.status(start).type, 'playing');
    assert.ok(kernel.legalMoves(start).length > 0, variant.id);
    assert.ok(engine.variant.length > 0);
    // The start FEN must survive the kernel's own parser.
    const back = kernel.parseFen(kernel.fen(start), 't2');
    assert.ok(back, `${variant.id}: start FEN does not round-trip`);
    assert.equal(kernel.fen(back), kernel.fen(start));
    for (const position of variant.discriminatingPositions) {
      assert.ok(
        kernel.parseFen(position.fen, 'd'),
        `${variant.id}: ${position.name} is unparseable`,
      );
    }
  }
});

test('play: random games terminate under the referee, and an illegal move aborts', async () => {
  const { kernel } = xiangqiVariant.create(resolveRules(xiangqiVariant.ruleSchema, {}));
  const random = randomPolicy(kernel, mulberry32(3));
  const game = await playGame(kernel, { red: random, black: random }, { plyCap: 60 });
  assert.ok(game.plies > 0 && game.plies <= 60);
  const start = kernel.initial('x');
  assert.equal(isLegal(kernel, start, { from: 'a1', to: 'a9' }), false);
  await assert.rejects(
    playGame(kernel, { red: async () => ({ from: 'a1', to: 'a9' }), black: random }, { plyCap: 5 }),
    /ILLEGAL move a1a9/,
  );
});

test('duck: the engine FEN dialect round-trips through the kernel dialect', () => {
  const { kernel } = duckXiangqiVariant.create({});
  const engineFen = '3k5/9/9/3*5/9/9/P8/9/9/3K5 w - - 0 1';
  const state = kernel.parseFen(engineFen, 'd');
  assert.ok(state);
  assert.equal(state.duck, 'd7');
  assert.equal(kernel.fen(state), engineFen);
  // A general capture folds the engine's placements onto one kernel turn.
  const capture = kernel.fromUci(
    kernel.parseFen('3k5/9/9/9/9/9/9/9/9/*2R1K3 w - - 0 1', 'c')!,
    'd1d10,d10a5',
  );
  assert.deepEqual(capture, { from: 'd1', to: 'd10', duckTo: null });
});

const stockBinary = (() => {
  try {
    return locateBinary(STOCK_FSF);
  } catch {
    return null;
  }
})();

test('engine: the control variant takes on stock FSF, and a wrong variant fails loud', {
  skip: stockBinary === null ? 'no Fairy-Stockfish binary (set MISTBOARD_FSF_PATH)' : false,
}, async () => {
  const ctx = await buildContext({ variant: 'xiangqi', out: mkdtempSync(join(tmpdir(), 'lab-')) });
  const engine = await ctx.openEngine();
  try {
    assert.equal(engine.identity?.variant, 'labxiangqi');
    assert.equal(await engine.perft('startpos', 1), 44);
    const moves = await engine.legalMoves('startpos');
    assert.equal(moves.length, 44);
    assert.ok(moves.includes('b1c3'));
  } finally {
    await engine.close();
  }
  // Same binary, a variant it does not have: the combo check refuses it.
  const wrong = new LabEngine(
    { variant: 'nosuchvariant', binary: STOCK_FSF },
    { timeoutMs: 10_000 },
  );
  await assert.rejects(wrong.open(44), /does not list variant "nosuchvariant"/);
  await wrong.close();
  // Same binary, the right variant name, the wrong start count: the perft
  // proof refuses it, which is what catches a stanza that loaded as chess.
  const miscount = new LabEngine({ variant: 'xiangqi', binary: STOCK_FSF }, { timeoutMs: 10_000 });
  await assert.rejects(miscount.open(20), /did not take: perft\(1\) at startpos is 44/);
  await miscount.close();
  rmSync(ctx.outDir, { recursive: true, force: true });
});

test('engine: a dead binary path is reported, not awaited', () => {
  assert.throws(
    () =>
      new LabEngine({
        variant: 'x',
        binary: { env: 'LAB_TEST_NOPE', fallbacks: ['/nonexistent/fsf'], label: 'test' },
      }),
    /set LAB_TEST_NOPE/,
  );
  assert.equal(existsSync('/nonexistent/fsf'), false);
});
