// Horde Xiangqi through the lab: the adapter's rules record, the sheet's
// terminal positions under the kernel it configures, and the fidelity gate
// against stock Fairy-Stockfish for every formation. Per-variant file, so
// three variant sessions never edit the same test.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { perftGate } from './lab/commands/perft-gate.js';
import { contextForVariant } from './lab/context.js';
import { locateBinary } from './lab/engine.js';
import { resolveRules } from './lab/rules.js';
import {
  HORDE_FORMATIONS,
  type HordeFormation,
  hordeXiangqiVariant,
} from './lab/variants/horde-xiangqi.js';
import { STOCK_FSF } from './lab/variants/xiangqi.js';

const stockBinary = (() => {
  try {
    return locateBinary(STOCK_FSF);
  } catch {
    return null;
  }
})();

function at(rules: Record<string, string | number | boolean>) {
  return hordeXiangqiVariant.create(resolveRules(hordeXiangqiVariant.ruleSchema, rules));
}

test('horde: every formation starts with nine soldier moves and round-trips its FEN', () => {
  for (const formation of Object.keys(HORDE_FORMATIONS) as HordeFormation[]) {
    const { kernel, engine } = at({ formation });
    const start = kernel.initial('s');
    assert.equal(kernel.legalMoves(start).length, 9, formation);
    assert.equal(kernel.fen(start), `${HORDE_FORMATIONS[formation]} w - - 0 1`);
    assert.ok(engine.ini?.includes(`startFen = ${HORDE_FORMATIONS[formation]} w - - 0 1`));
    // Soldiers only, as many as the name says, and no red general anywhere.
    const red = Object.values(start.board).filter((p) => p.color === 'red');
    assert.ok(red.every((p) => p.role === 'soldier'));
    assert.equal(red.length, Number(formation.replace(/\D/g, '')));
  }
});

test('horde: the stanza pins what a kingless side needs and the record refuses the unimplemented', () => {
  const { engine } = at({});
  for (const line of [
    'extinctionValue = loss',
    'extinctionPieceTypes = *',
    'flyingGeneral = false',
    'chasingRule = none',
    'stalemateValue = loss',
    'perpetualCheckIllegal = false',
    'nMoveRule = 30',
  ]) {
    assert.ok(engine.ini?.includes(line), line);
  }
  assert.throws(() => at({ perpetualCheck: 'loss' }), /not adjudicated/);
  assert.throws(() => at({ facing: 'file' }), /cannot be/);
  assert.throws(() => at({ stalemate: 'win' }), /cannot be/);
});

test('horde: D5 no facing, D7 extinction, D8 stalemate under both values', () => {
  const { kernel } = at({});
  // D5: the army's general steps onto the open file above a soldier.
  const facing = kernel.parseFen('3k5/9/9/9/9/9/9/9/9/P8 b - - 0 1', 'd5')!;
  assert.ok(kernel.legalMoves(facing).some((m) => m.from === 'd10' && m.to === 'e10'));
  // D7: the last soldier falls and the game ends there.
  const last = kernel.parseFen('4k4/9/9/9/9/9/9/9/9/r7P b - - 0 1', 'd7')!;
  assert.deepEqual(kernel.apply(last, { from: 'a1', to: 'i1' }).status, {
    type: 'finished',
    winner: 'black',
    reason: 'extinction',
  });
  // D8: the smothered general. Red has just played d8-d9; black has no move.
  const smother = (stalemate: 'loss' | 'draw') => {
    const k = at({ stalemate }).kernel;
    const before = k.parseFen('4k4/5P3/3P5/9/9/9/9/9/9/9 w - - 0 1', 'd8')!;
    return k.apply(before, { from: 'd8', to: 'd9' }).status;
  };
  assert.deepEqual(smother('loss'), { type: 'finished', winner: 'red', reason: 'stalemate' });
  assert.deepEqual(smother('draw'), { type: 'finished', winner: null, reason: 'stalemate' });
  // A checking soldier the general cannot take is mate, not stalemate.
  const mate = kernel.parseFen('3k5/3P5/4P4/9/9/9/9/9/9/9 w - - 0 1', 'm')!;
  assert.deepEqual(kernel.apply(mate, { from: 'e8', to: 'e9' }).status, {
    type: 'finished',
    winner: 'red',
    reason: 'checkmate',
  });
});

test('horde: the horde is never in check and a soldier may step beside the general', () => {
  const { kernel } = at({});
  // Red to move, a black chariot bearing down the a-file: nothing to protect.
  const s = kernel.parseFen('4k4/9/9/9/9/9/9/9/9/rP7 w - - 0 1', 'c')!;
  assert.deepEqual(
    kernel.legalMoves(s).map((m) => `${m.from}${m.to}`),
    ['b1b2'],
  );
});

for (const formation of Object.keys(HORDE_FORMATIONS) as HordeFormation[]) {
  test(`horde: ${formation} passes the fidelity gate against stock FSF`, {
    skip: stockBinary === null ? 'no Fairy-Stockfish binary (set MISTBOARD_FSF_PATH)' : false,
  }, async () => {
    const out = mkdtempSync(join(tmpdir(), 'lab-horde-'));
    try {
      const ctx = contextForVariant(hordeXiangqiVariant, {
        out,
        seed: 7,
        rules: [`formation=${formation}`],
      });
      const result = await perftGate(ctx, { depth: 2, positions: 60, games: 15 });
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
}

test('horde: veteran soldiers are V to the engine and step sideways from rank 1', () => {
  const { kernel, engine } = at({ soldiers: 'veteran' });
  assert.ok(engine.ini?.includes('customPiece1 = v:fsW'));
  assert.ok(engine.ini?.includes('startFen = rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/VVVVVVVVV/'));
  const s = kernel.parseFen('4k4/9/9/9/9/9/9/9/9/4P4 w - - 0 1', 'v')!;
  assert.equal(kernel.fen(s), '4k4/9/9/9/9/9/9/9/9/4V4 w - - 0 1');
  assert.deepEqual(
    kernel
      .legalMoves(s)
      .map((m) => `${m.from}${m.to}`)
      .sort(),
    ['e1d1', 'e1e2', 'e1f1'],
  );
  // The army's soldiers are untouched: forward only before the river.
  const b = kernel.parseFen('4k4/9/9/4p4/9/9/9/9/9/4P4 b - - 0 1', 'b')!;
  assert.deepEqual(
    kernel
      .legalMoves(b)
      .filter((m) => m.from === 'e7')
      .map((m) => m.to),
    ['e6'],
  );
});
