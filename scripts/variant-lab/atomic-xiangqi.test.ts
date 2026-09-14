// Atomic Xiangqi adapter: the rules record maps to the kernel the decision
// sheet describes, the stock point passes the gate against stock
// Fairy-Stockfish, and every rule stock FSF cannot express throws at engine
// open (not at create, so kernel-only rows still run).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { perftGate } from './lab/commands/perft-gate.js';
import { contextForVariant } from './lab/context.js';
import { locateBinary } from './lab/engine.js';
import { resolveRules } from './lab/rules.js';
import { ATOMIC_FSF, atomicXiangqiVariant as atomic } from './lab/variants/atomic-xiangqi.js';
import { STOCK_FSF } from './lab/variants/xiangqi.js';

function tryLocate(locator: Parameters<typeof locateBinary>[0]): string | null {
  try {
    return locateBinary(locator);
  } catch {
    return null;
  }
}
const stockBinary = tryLocate(STOCK_FSF);
const atomicBinary = tryLocate(ATOMIC_FSF);
const STOCK_POINT = {
  facing: 'off',
  soldiersImmune: false,
  blastShape: 'king',
  perpetualCheck: 'draw',
} as const;

function keys(rules: Record<string, string | number | boolean>, fen: string): string[] {
  const { kernel } = atomic.create(resolveRules(atomic.ruleSchema, rules));
  const state = kernel.parseFen(fen, 't');
  assert.ok(state, fen);
  return kernel
    .legalMoves(state)
    .map((m) => kernel.moveKey(m))
    .sort();
}

test('atomic: the decision sheet’s discriminating positions separate the rules', () => {
  // D1: Rxd2 kills the general on e1 only when the blast has diagonals.
  const d1 = '3k5/9/9/9/9/3r5/9/9/3N5/4K4 b - - 0 1';
  for (const shape of ['king', 'wazir'] as const) {
    const { kernel } = atomic.create(resolveRules(atomic.ruleSchema, { blastShape: shape }));
    const after = kernel.apply(kernel.parseFen(d1, 'd1')!, { from: 'd5', to: 'd2' });
    assert.equal(after.status.type, shape === 'king' ? 'finished' : 'playing', shape);
  }
  // D2: Rxc1 reaches d1 through the palace wall unless the wall contains it.
  const d2 = '5k3/2r6/9/9/9/9/9/9/9/2NK5 b - - 0 1';
  const open = atomic.create(resolveRules(atomic.ruleSchema, {})).kernel;
  assert.equal(
    open.apply(open.parseFen(d2, 'o')!, { from: 'c9', to: 'c1' }).status.type,
    'finished',
  );
  const walled = atomic.create(resolveRules(atomic.ruleSchema, { palaceWall: true })).kernel;
  assert.equal(
    walled.apply(walled.parseFen(d2, 'w')!, { from: 'c9', to: 'c1' }).status.type,
    'playing',
  );
  // D3: a surviving soldier still screens the general, so a5d5 is legal iff immune
  // (under the king blast; d5-e4 is a diagonal no line draws, so lines spares it anyway).
  const d3 = '3kr4/9/9/9/9/R2n5/4P4/9/9/4K4 w - - 0 1';
  assert.ok(keys({ soldiersImmune: true, blastShape: 'king' }, d3).includes('a5d5'));
  assert.ok(!keys({ soldiersImmune: false, blastShape: 'king' }, d3).includes('a5d5'));
  assert.ok(keys({ soldiersImmune: false, blastShape: 'lines' }, d3).includes('a5d5'));
  // D6: the general never captures; blasting the enemy general outranks check.
  assert.ok(!keys({}, '4k4/9/9/9/9/9/9/9/4n4/4K4 w - - 0 1').includes('e1e2'));
  assert.deepEqual(keys({}, '4k4/4p4/9/9/9/9/9/9/4R4/r3K4 w - - 0 1'), ['e2e9']);
  // D7: a facing only a blast can produce.
  const d7 = '4k4/9/9/9/9/R3n4/9/9/9/4K4 w - - 0 1';
  assert.ok(!keys({ facing: 'file' }, d7).includes('a5e5'));
  assert.ok(keys({ facing: 'off' }, d7).includes('a5e5'));
});

test('atomic: the stock point speaks stock FSF; every other point speaks the patched binary', () => {
  const stock = atomic.create(resolveRules(atomic.ruleSchema, STOCK_POINT));
  assert.equal(stock.engine.binary, STOCK_FSF);
  assert.match(stock.engine.ini ?? '', /blastOnCapture = true/);
  assert.match(stock.engine.ini ?? '', /flyingGeneral = false/);
  assert.doesNotMatch(stock.engine.ini ?? '', /blastImmuneTypes|blastShape/);

  const design = atomic.create(resolveRules(atomic.ruleSchema, {}));
  assert.equal(design.engine.binary, ATOMIC_FSF);
  const ini = design.engine.ini ?? '';
  for (const line of [
    'flyingGeneral = true',
    'perpetualCheckIllegal = true',
    'blastShape = wazir',
    'blastImmuneTypes = p',
    'extinctionPseudoRoyal = true',
  ]) {
    assert.match(ini, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(design.kernel.rules.repetition, 'perpetualCheckLoses');
  assert.deepEqual(design.kernel.rules.blast, {
    shape: 'orthogonal',
    immune: ['soldier'],
    palaceContained: false,
  });
  // One rule still has no engine: the palace wall. Kernel-only.
  const walled = atomic.create(resolveRules(atomic.ruleSchema, { palaceWall: true }));
  assert.ok(walled.kernel.legalMoves(walled.kernel.initial('k')).length === 44);
  assert.throws(() => walled.engine.ini, /region mask/);
});

test('atomic: the stock point passes the perft gate against stock Fairy-Stockfish', {
  skip: stockBinary === null ? 'no Fairy-Stockfish binary (set MISTBOARD_FSF_PATH)' : false,
}, async () => {
  const out = mkdtempSync(join(tmpdir(), 'lab-atomic-'));
  try {
    const ctx = contextForVariant(atomic, {
      out,
      seed: 5,
      rules: ['facing=off', 'soldiersImmune=false'],
    });
    const result = await perftGate(ctx, { depth: 2, positions: 60, games: 20 });
    assert.equal(result.disagreements.length, 0, JSON.stringify(result.disagreements[0]));
    assert.deepEqual(result.unparseable, []);
    assert.ok(
      result.perft.every((r) => r.kernel === r.engine),
      'perft counts agree',
    );
    assert.ok(result.ok);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('atomic: the design rules pass the perft gate against the patched Fairy-Stockfish', {
  skip:
    atomicBinary === null ? 'no patched binary (see scripts/variant-lab/patches/README.md)' : false,
}, async () => {
  const out = mkdtempSync(join(tmpdir(), 'lab-atomic-design-'));
  try {
    const ctx = contextForVariant(atomic, { out, seed: 5 });
    const result = await perftGate(ctx, { depth: 2, positions: 60, games: 20 });
    assert.equal(result.disagreements.length, 0, JSON.stringify(result.disagreements[0]));
    assert.deepEqual(result.unparseable, []);
    assert.ok(
      result.perft.every((r) => r.kernel === r.engine),
      'perft counts agree',
    );
    assert.ok(result.ok);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
