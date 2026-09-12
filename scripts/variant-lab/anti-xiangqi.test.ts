// Anti xiangqi: the adapter's rules, the discriminating positions under the
// kernel, the opening tree that the sheet's issue-10 redo rests on, and the
// perft gate against stock Fairy-Stockfish when a binary is present.
//
// Run: tsx --test scripts/variant-lab/anti-xiangqi.test.ts

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleState,
} from '../../packages/game/src/xiangqi-rule-kernel.js';
import { perftGate } from './lab/commands/perft-gate.js';
import { contextForVariant } from './lab/context.js';
import { locateBinary } from './lab/engine.js';
import { resolveRules } from './lab/rules.js';
import { antiXiangqiKernelConfig, antiXiangqiVariant } from './lab/variants/anti-xiangqi.js';
import { STOCK_FSF } from './lab/variants/xiangqi.js';

const defaults = () => resolveRules(antiXiangqiVariant.ruleSchema, {});

test('anti: the defaults are the sheet’s defaults and the stanza names every trap explicitly', () => {
  const rules = defaults();
  assert.equal(rules.generalRoyal, false);
  assert.equal(rules.facing, 'off');
  assert.equal(rules.stalemate, 'win');
  assert.equal(rules.stall, 'off');
  const { engine, kernel } = antiXiangqiVariant.create(rules);
  assert.equal(engine.variant, 'labanti');
  for (const line of [
    'king = -',
    'wazir = k',
    'flyingGeneral = false',
    'chasingRule = none',
    'perpetualCheckIllegal = false',
    'mustCapture = true',
    'stalemateValue = win',
    'extinctionValue = win',
    'extinctionPieceTypes = *',
  ]) {
    assert.ok(engine.ini?.includes(`${line}\n`), line);
  }
  assert.equal(kernel.rules.mustCapture, true);
  assert.deepEqual(kernel.rules.royal, { red: false, black: false });
  assert.equal(kernel.rules.deadPosition, false);
  // D9 as a row: the kernel referees the count, the engine stanza is unchanged.
  const counted = antiXiangqiVariant.create(
    resolveRules(antiXiangqiVariant.ruleSchema, { stall: 'fewerPieces' }),
  );
  assert.equal(counted.kernel.rules.stall, 'fewerPieces');
  assert.equal(counted.kernel.rules.deadPosition, true);
  assert.equal(counted.engine.ini, engine.ini);
});

test('anti: what stock FSF or the kernel cannot express throws instead of measuring another game', () => {
  const schema = antiXiangqiVariant.ruleSchema;
  assert.throws(
    () => antiXiangqiVariant.create(resolveRules(schema, { facing: 'file' })),
    /flyingGeneral patch/,
  );
  assert.throws(
    () => antiXiangqiVariant.create(resolveRules(schema, { generalRoyal: true, facing: 'file' })),
    /unmeasured/,
  );
  assert.throws(
    () => antiXiangqiKernelConfig(resolveRules(schema, { generalRoyal: true, facing: 'off' })),
    /fixes facing=file/,
  );
});

test('anti: the discriminating positions say what their notes say under the kernel', () => {
  const { kernel } = antiXiangqiVariant.create(defaults());
  const moves = (fen: string) => {
    const state = kernel.parseFen(fen, 'p');
    assert.ok(state, fen);
    return kernel
      .legalMoves(state)
      .map((m) => kernel.toUci(m))
      .sort();
  };
  const byName = Object.fromEntries(
    antiXiangqiVariant.discriminatingPositions.map((p) => [p.name, p.fen]),
  );
  assert.deepEqual(
    moves(byName['compulsory capture through a screen; a blocked leg is no capture']),
    ['a1a5'],
  );
  assert.deepEqual(moves('3k5/9/9/9/9/p8/9/P2p5/9/C1N1K4 w - - 0 1'), ['a1a5', 'c1d3']);
  assert.deepEqual(moves(byName['the general is not royal']), ['a1a5']);
  assert.deepEqual(moves(byName['the general can be compelled']), ['e1d1']);
  assert.deepEqual(moves(byName['the general can be captured']), ['a10e10']);
  assert.deepEqual(moves(byName['facing generals are legal']), ['d1d2', 'd1e1']);
  assert.deepEqual(moves(byName.stalemate), []);
  // Stalemate is a win for the side that cannot move (D3 default).
  const stuck = kernel.parseFen(byName.stalemate, 's')!;
  // Reach it by a black move so the referee adjudicates: black general steps and back.
  const before = kernel.parseFen('3k5/9/9/9/9/9/9/4p4/3pNp3/3AKA3 b - - 0 1', 's2')!;
  const after = kernel.apply(before, { from: 'd10', to: 'e10' });
  assert.equal(kernel.fen(after).split(' ')[0], kernel.fen(stuck).split(' ')[0]);
  assert.deepEqual(after.status, { type: 'finished', winner: 'red', reason: 'stalemate' });
  // Losing everything wins: the forced general capture hands Black the game.
  const capture = kernel.parseFen(byName['the general can be captured'], 'x')!;
  const done = kernel.apply(capture, { from: 'a10', to: 'e10' });
  assert.deepEqual(done.status, { type: 'finished', winner: 'black', reason: 'extinction' });
});

/**
 * The opening tree: from the array, follow every line while the mover has a
 * capture; a leaf is the first position where it has none. The counts are
 * the ones docs-private/variant-lab/anti-xiangqi/opening-tree.md records.
 */
function openingTree(royal: boolean) {
  const kernel = createXiangqiRuleKernel(
    antiXiangqiKernelConfig(
      resolveRules(
        antiXiangqiVariant.ruleSchema,
        royal ? { generalRoyal: true, facing: 'file' } : {},
      ),
    ),
  );
  let leaves = 0;
  let deepest = 0;
  let generalGone = 0;
  const walk = (state: XiangqiRuleState, depth: number) => {
    assert.equal(state.status.type, 'playing');
    const captures = kernel.legalMoves(state).filter((m) => state.board[m.to] !== undefined);
    if (captures.length === 0) {
      leaves += 1;
      deepest = Math.max(deepest, depth);
      const generals = Object.values(state.board).filter((p) => p?.role === 'general').length;
      if (generals < 2) generalGone += 1;
      return;
    }
    for (const move of captures) walk(kernel.apply(state, move), depth + 1);
  };
  walk(kernel.initial('tree'), 0);
  return { leaves, deepest, generalGone };
}

test('anti: the opening cascade has 166 leaves to ply 18 with a non-royal general, 32 with a royal one', () => {
  assert.deepEqual(openingTree(false), { leaves: 166, deepest: 18, generalGone: 130 });
  assert.deepEqual(openingTree(true), { leaves: 32, deepest: 18, generalGone: 0 });
});

const stockBinary = (() => {
  try {
    return locateBinary(STOCK_FSF);
  } catch {
    return null;
  }
})();

test('anti: the kernel at the defaults passes the perft gate against stock FSF', {
  skip: stockBinary === null ? 'no Fairy-Stockfish binary (set MISTBOARD_FSF_PATH)' : false,
}, async () => {
  const out = mkdtempSync(join(tmpdir(), 'lab-anti-'));
  try {
    const ctx = contextForVariant(antiXiangqiVariant, { out, seed: 7 });
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
