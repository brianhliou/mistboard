import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  ALL_BANQI_SQUARES,
  BANQI_TABLEBASE_MATERIALS,
  type BanqiBoard,
  type BanqiGameState,
  type BanqiTablebaseTable,
  banqiCoordOf,
  banqiSquareOf,
  banqiTablebaseKeyOf,
  banqiTablebaseKeysFor,
  banqiTablebasePieces,
  banqiTablebaseSlot,
  banqiTablebaseTableFromBytes,
  banqiTablebaseUrl,
  decodeBanqiTablebaseSlot,
  decodeBanqiTablebaseValue,
  parseBanqiFen,
  probeBanqiTablebase,
  readBanqiTablebase,
} from './index.js';

// The shipped files, read from the web app's public folder (written by
// scripts/banqi-tablebase/endgame-table.ts --export). Same path from src/ and dist/.
const PUBLIC = new URL('../../../apps/web/public', import.meta.url);
const cache = new Map<string, BanqiTablebaseTable>();
function table(key: string): BanqiTablebaseTable | undefined {
  const known = cache.get(key);
  if (known) return known;
  const bytes = gunzipSync(readFileSync(new URL(`.${banqiTablebaseUrl(key)}`, `${PUBLIC.href}/`)));
  const parsed = banqiTablebaseTableFromBytes(key, new Uint8Array(bytes));
  assert.ok(parsed, `${key}: wrong length`);
  cache.set(key, parsed);
  return parsed;
}

function stateOf(fen: string): BanqiGameState {
  const parsed = parseBanqiFen(fen);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  return parsed.state;
}

function probeValue(fen: string) {
  const state = stateOf(fen);
  const probe = probeBanqiTablebase(state);
  assert.ok(probe, `${fen} should be covered`);
  const t = table(probe.key);
  assert.ok(t);
  return {
    key: probe.key,
    dtm: decodeBanqiTablebaseValue(t.dtm[probe.slot] ?? 0),
    dtz: decodeBanqiTablebaseValue(t.dtz[probe.slot] ?? 0),
  };
}

function mirrored(state: BanqiGameState, files: boolean, ranks: boolean): BanqiGameState {
  const board: BanqiBoard = {};
  for (const square of ALL_BANQI_SQUARES) {
    const piece = state.board[square];
    if (!piece) continue;
    const { file, rank } = banqiCoordOf(square);
    board[banqiSquareOf(files ? 7 - file : file, ranks ? 5 - rank : rank)] = piece;
  }
  return { ...state, board };
}

const ROOT = '8/7r/Hs6/2h4R b - 0 1';

test('the root: black (chariot, horse, soldier) wins in 67 plies, next capture in 45', () => {
  const v = probeValue(ROOT);
  assert.equal(v.key, 'rh-rhs');
  assert.deepEqual(v.dtm, { result: 'win', plies: 67 });
  assert.deepEqual(v.dtz, { result: 'win', plies: 45 });
});

test('values from the solver report, 3, 4 and 5 pieces', () => {
  const cases: [string, string, 'dtm' | 'dtz', number][] = [
    // 5 pieces: the family's longest phase without a capture.
    ['8/6H1/8/sR4rh b - 0 1', 'rh-rhs', 'dtz', 55],
    // 4 pieces: chariot+horse vs chariot+soldier, the longest win in the family.
    ['H6r/8/8/2s4R r - 0 1', 'rh-rs', 'dtm', 73],
    ['H6r/8/8/2s4R r - 0 1', 'rh-rs', 'dtz', 55],
    ['7R/8/8/sh5H r - 0 1', 'rh-hs', 'dtm', 47],
    // 3 pieces.
    ['7r/8/2s5/2R5 b - 0 1', 'r-rs', 'dtm', 23],
    ['8/8/1R6/sr6 r - 0 1', 'r-rs', 'dtm', 21],
    ['8/8/1R6/sr6 r - 0 1', 'r-rs', 'dtz', 3],
    ['7R/8/2H5/2r5 r - 0 1', 'rh-r', 'dtm', 23],
  ];
  for (const [fen, key, metric, plies] of cases) {
    const v = probeValue(fen);
    assert.equal(v.key, key, fen);
    assert.deepEqual(v[metric], { result: 'win', plies }, `${fen} ${metric}`);
  }
  // The same 3-piece position with the other side to move: black wins it instead
  // (the report has black winning 29,752 of 29,760 chariot vs chariot+soldier positions).
  assert.equal(probeValue('8/8/1R6/sr6 b - 0 1').dtm.result, 'win');
  const drawn = probeValue('8/8/8/s6H b - 0 1'); // horse vs soldier, soldier to move: no black win
  assert.notEqual(drawn.dtm.result, 'win');
});

test('all four mirrors and the colour swap read the same value', () => {
  const root = stateOf(ROOT);
  const want = probeValue(ROOT);
  for (const [files, ranks] of [
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    const probe = probeBanqiTablebase(mirrored(root, files, ranks));
    assert.ok(probe);
    const t = table(probe.key);
    assert.ok(t);
    assert.equal(t.dtm[probe.slot], 67, `mirror files=${files} ranks=${ranks}`);
    assert.equal(t.dtz[probe.slot], 45);
  }
  // Inks swapped (red has chariot+horse+soldier, and is to move): same file, same answer.
  const swapped = probeValue('8/7R/hS6/2H4r r - 0 1');
  assert.equal(swapped.key, 'rh-rhs');
  assert.deepEqual(swapped.dtm, want.dtm);
  assert.deepEqual(swapped.dtz, want.dtz);
});

test('slot encoding round-trips and stays inside the file', () => {
  for (const k of [2, 3, 5]) {
    const squares = [2, 9, 31, 17, 24].slice(0, k);
    for (const stm of [0, 1] as const) {
      const slot = banqiTablebaseSlot(squares, stm);
      const back = decodeBanqiTablebaseSlot(slot, k);
      assert.equal(back.stm, stm);
      assert.deepEqual(back.squares, squares); // first square already in a-d, ranks 1-2
    }
  }
  assert.equal(banqiTablebaseKeyOf(banqiTablebasePieces('rh-rhs')), 'rh-rhs');
  assert.equal(BANQI_TABLEBASE_MATERIALS.length, 21);
});

test('not covered: a face-down tile, unknown material, an unbound opening, a finished game', () => {
  // A face-down tile anywhere: no probe and no keys, even with a covered material face up.
  const root = stateOf(ROOT);
  const withTile: BanqiGameState = {
    ...root,
    board: { ...root.board, d4: { color: 'red', role: 'soldier', faceDown: true } },
  };
  assert.equal(probeBanqiTablebase(withTile), null);
  assert.deepEqual(banqiTablebaseKeysFor(withTile), []);
  assert.equal(readBanqiTablebase(withTile, table), null);
  // The covered pieces themselves face down: still nothing.
  const hiddenPiece: BanqiGameState = {
    ...root,
    board: { ...root.board, a2: { color: 'red', role: 'horse', faceDown: true } },
  };
  assert.equal(probeBanqiTablebase(hiddenPiece), null);
  // Material outside the family: a cannon, or a general.
  assert.equal(probeBanqiTablebase(stateOf('8/7r/Hs6/2c4R b - 0 1')), null);
  assert.equal(probeBanqiTablebase(stateOf('8/7r/Gs6/2h4R b - 0 1')), null);
  // Two soldiers on one side.
  assert.equal(probeBanqiTablebase(stateOf('8/7r/Hs6/2s4R b - 0 1')), null);
  // The opening deal (every tile face down, no ink bound).
  const opening = parseBanqiFen(
    'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
  );
  assert.ok(opening.ok);
  assert.equal(probeBanqiTablebase(opening.state), null);
  // Finished.
  assert.equal(
    probeBanqiTablebase({
      ...root,
      status: { type: 'finished', winner: null, reason: 'no-progress' },
    }),
    null,
  );
});

test('move rows: the root has exactly the kernel moves, best first, matching the position', () => {
  const answer = readBanqiTablebase(stateOf(ROOT), table);
  assert.ok(answer);
  assert.equal(answer.result, 'win');
  assert.equal(answer.dtm, 67);
  assert.equal(answer.dtz, 45);
  // DTZ 45 against a 40-ply clock at 0: the win is a draw over the board.
  assert.equal(answer.clockDraw, true);
  const best = answer.rows[0];
  assert.ok(best);
  assert.equal(best.result, 'win');
  assert.equal(best.dtm, 67);
  // The fastest next capture over all winning rows is the position's DTZ.
  const captureNow = answer.rows.some((r) => r.result === 'win' && r.capture);
  const fastest = Math.min(
    ...answer.rows.filter((r) => r.result === 'win' && !r.capture).map((r) => r.nextCapture ?? 99),
  );
  assert.equal(captureNow ? 1 : fastest, 45);
  for (const row of answer.rows) if (row.result === 'win') assert.equal(row.clockDraw, true);
  // Same position with a clock of 30: the same moves, the same marks.
  const late = readBanqiTablebase({ ...stateOf(ROOT), noProgressClock: 30 }, table);
  assert.ok(late);
  assert.equal(late.rows.length, answer.rows.length);
});

test('a short win inside the clock is not marked', () => {
  const answer = readBanqiTablebase(stateOf('7r/8/2s5/2R5 b - 0 1'), table);
  assert.ok(answer);
  assert.equal(answer.result, 'win');
  assert.equal(answer.dtm, 23);
  assert.equal(answer.clockDraw, false);
  // With 38 plies already on the clock the same win needs 23 and has 2 left.
  const late = readBanqiTablebase(
    { ...stateOf('7r/8/2s5/2R5 b - 0 1'), noProgressClock: 38 },
    table,
  );
  assert.ok(late);
  assert.equal(late.clockDraw, true);
});
