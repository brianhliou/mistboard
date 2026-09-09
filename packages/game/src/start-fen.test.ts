/**
 * start-fen.ts is the one entry point every surface uses to accept a hand-set
 * start position, so these tests pin the two properties the callers rely on:
 *
 *   1. ROUND-TRIP. Feeding a variant's own writer output back through
 *      normalizeStartFen returns that same string. A stored rootFen is replayed
 *      by the board later, so a reader/writer dialect drift would surface as a
 *      chapter that silently opens at the wrong position.
 *   2. FAIL-CLOSED. A spec with no parser, and a spec that is not a variant at
 *      all, are refused. Nothing falls through to another variant's board.
 *
 * The per-variant rejection cases below are the ones a real author hits: a
 * mistyped rank, a piece somewhere the rules forbid, a position that could not
 * have been reached. Fog variants get their own case because they RELAX the
 * standard legality bar rather than sharing it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { banqiStateToDealtFen } from './banqi-fen.js';
import { duckXiangqiFen } from './duck-xiangqi-fen.js';
import { jieqiStateToDealtFen } from './jieqi-fen.js';
import { jungleStateToEngineFen, parseJungleFen } from './jungle-fen.js';
import { jungleFlipStateToDealtFen } from './jungle-flip-fen.js';
import { hasStartFen, normalizeStartFen, START_FEN_SPEC_IDS } from './start-fen.js';
import { darkChessVariant, parseDarkChessFen } from './variants.js';
import { createInitialBanqiState } from './variants-banqi.js';
import { createInitialDuckXiangqiState } from './variants-duck-xiangqi.js';
import {
  createInitialFortressXiangqiState,
  type FortressXiangqiGameState,
  fortressXiangqiEngineFen,
  parseFortressXiangqiFen,
} from './variants-fortress-xiangqi.js';
import { createInitialJieqiState } from './variants-jieqi.js';
import { createInitialJungleState } from './variants-jungle.js';
import { createInitialJungleFlipState } from './variants-jungle-flip.js';
import { createInitialXiangqiState } from './variants-xiangqi.js';
import { parseStandardXiangqiFen, standardXiangqiFen } from './xiangqi-position.js';

test('every start-fen spec round-trips its own standard start', () => {
  const starts: Record<string, string> = {
    xiangqi: standardXiangqiFen(createInitialXiangqiState('t')),
    'dark-xiangqi': standardXiangqiFen(createInitialXiangqiState('t')),
    jungle: jungleStateToEngineFen(createInitialJungleState('t')),
    'fortress-xiangqi': fortressXiangqiEngineFen(createInitialFortressXiangqiState('t')),
    'dark-chess': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    // Duck Xiangqi: the standard six fields plus a SEVENTH naming the duck's
    // point, '-' at the start because the duck enters on Red's first turn.
    'duck-xiangqi': duckXiangqiFen(createInitialDuckXiangqiState('t')),
    // Hidden-deal variants: the canonical spelling is the six-field DEALT fen.
    banqi: banqiStateToDealtFen(createInitialBanqiState('t')),
    jieqi: jieqiStateToDealtFen(createInitialJieqiState('t')),
    'jungle-flip': jungleFlipStateToDealtFen(createInitialJungleFlipState('t')),
  };
  for (const spec of START_FEN_SPEC_IDS) {
    const fen = starts[spec];
    assert.ok(fen, `no start fen fixture for ${spec}`);
    const first = normalizeStartFen(spec, fen);
    assert.equal(first.ok, true, `${spec} rejected its own start: ${JSON.stringify(first)}`);
    assert.ok(first.ok);
    // Canonical spelling is a fixed point: normalizing it again changes nothing.
    const second = normalizeStartFen(spec, first.fen);
    assert.ok(second.ok);
    assert.equal(second.fen, first.fen);
  }
});

test('normalizeStartFen is fail-closed off the list', () => {
  for (const spec of ['chess', 'dark-shogi', 'not-a-variant', '']) {
    assert.equal(hasStartFen(spec), false, `${spec} should not claim a start FEN`);
    const result = normalizeStartFen(spec, 'anything');
    assert.equal(result.ok, false);
  }
});

test('a study start FEN is trimmed and re-spelled, not echoed', () => {
  // Extra whitespace and the engine's 'w' side-to-move both normalize to the
  // xiangqi position-key dialect ('r'), so two spellings of one position are
  // stored identically.
  const engineDialect = '  rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1  ';
  const result = normalizeStartFen('xiangqi', engineDialect);
  assert.ok(result.ok);
  assert.equal(result.fen, standardXiangqiFen(createInitialXiangqiState('t')));
});

// ── Hidden-deal variants ─────────────────────────────────────────────────────

test('a public five-field paste for a dealt variant is pinned as a six-field dealt fen', () => {
  const cases: Array<[string, string]> = [
    ['banqi', 'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1'],
    [
      'jieqi',
      'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1',
    ],
    ['jungle-flip', 'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0'],
  ];
  for (const [spec, publicFen] of cases) {
    assert.equal(hasStartFen(spec), true);
    const first = normalizeStartFen(spec, `  ${publicFen}  `);
    assert.ok(first.ok, `${spec} rejected its public start: ${JSON.stringify(first)}`);
    const fields = first.fen.split(' ');
    assert.equal(fields.length, 6, `${spec} did not pin a hidden field: ${first.fen}`);
    // The public prefix is preserved verbatim (sampling is invisible to the engine)
    // and the pinned form is a fixed point.
    assert.equal(fields.slice(0, 5).join(' '), publicFen);
    const second = normalizeStartFen(spec, first.fen);
    assert.ok(second.ok);
    assert.equal(second.fen, first.fen);
    // A structurally broken paste is refused, not defaulted.
    assert.equal(normalizeStartFen(spec, 'not a fen at all').ok, false);
  }
});

// ── Jungle ───────────────────────────────────────────────────────────────────

test('parseJungleFen reads a hand-set endgame', () => {
  // Red elephant on a1, black rat on g9, red to move.
  const parsed = parseJungleFen('6r/7/7/7/7/7/7/7/E6 r 0 1');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.state.board.a1, { color: 'red', role: 'elephant' });
  assert.deepEqual(parsed.state.board.g9, { color: 'black', role: 'rat' });
  assert.deepEqual(parsed.state.status, { type: 'playing', turn: 'red' });
});

test('parseJungleFen rejects positions play cannot produce', () => {
  const cases: Array<[string, RegExp]> = [
    // A lion standing in the west lake: only the rat may enter water.
    ['6r/7/7/7/7/1L5/7/7/E6 r 0 1', /water/i],
    // A red piece in the red den (d1) — a piece may not enter its own den.
    ['6r/7/7/7/7/7/7/7/3E3 r 0 1', /own den/i],
    // A red piece already in the black den (d9): the game is over.
    ['3E3/7/7/7/7/7/7/7/r6 b 0 1', /enemy den/i],
    // Two red rats.
    ['6r/7/7/7/7/7/7/7/RR5 r 0 1', /two red rats/i],
    // Black has nothing left.
    ['7/7/7/7/7/7/7/7/E6 r 0 1', /no pieces/i],
    ['6r/7/7/7/7/7/E6 r 0 1', /ranks/i],
    ['6r/7/7/7/7/7/7/7/E5 r 0 1', /files/i],
    ['6r/7/7/7/7/7/7/7/E6 x 0 1', /side-to-move/i],
  ];
  for (const [fen, pattern] of cases) {
    const parsed = parseJungleFen(fen);
    assert.equal(parsed.ok, false, `expected a rejection for ${fen}`);
    assert.ok(
      !parsed.ok && pattern.test(parsed.error),
      `wrong error for ${fen}: ${!parsed.ok && parsed.error}`,
    );
  }
});

// ── Fortress Xiangqi ─────────────────────────────────────────────────────────

test('parseFortressXiangqiFen reads the pocket back', () => {
  // Bare generals with material in hand — the shape the pocket exists for, and
  // one a full starting board could never show (every piece is already placed).
  const withHands: FortressXiangqiGameState = {
    ...createInitialFortressXiangqiState('t'),
    board: { b1: { color: 'red', role: 'general' }, f7: { color: 'black', role: 'general' } },
    hands: { red: { chariot: 1, soldier: 2 }, black: { cannon: 1 } },
  };
  const parsed = parseFortressXiangqiFen(fortressXiangqiEngineFen(withHands));
  assert.ok(parsed.ok, `rejected: ${!parsed.ok && parsed.error}`);
  assert.deepEqual(parsed.state.hands.red, { chariot: 1, soldier: 2 });
  assert.deepEqual(parsed.state.hands.black, { cannon: 1 });
});

test('parseFortressXiangqiFen rejects positions play cannot produce', () => {
  const cases: Array<[string, RegExp]> = [
    // General off its palace (red palace is a1-c3).
    ['4k2/7/7/7/7/7/7/6K r - - 0 1', /outside its palace/i],
    // Missing general.
    ['4k2/7/7/7/7/7/7/7 w - - 0 1', /missing the red general/i],
    // Three chariots between the board and the pockets (the sets hold two).
    ['4k2/7/7/7/7/7/RR5/1K5[R] w - - 0 1', /too many chariot/i],
    // Black is in check with red to move: red's previous move was impossible.
    ['4k2/4R2/7/7/7/7/7/1K5 w - - 0 1', /in check/i],
  ];
  for (const [fen, pattern] of cases) {
    const parsed = parseFortressXiangqiFen(fen);
    assert.equal(parsed.ok, false, `expected a rejection for ${fen}`);
    assert.ok(
      !parsed.ok && pattern.test(parsed.error),
      `wrong error for ${fen}: ${!parsed.ok && parsed.error}`,
    );
  }
});

// ── Fog variants relax the legality bar ──────────────────────────────────────

test('fog xiangqi accepts a general left en prise; standard xiangqi does not', () => {
  // Black general on e10 with a red chariot on e1 staring up the open e-file:
  // red to move can simply take it. Unreachable in standard play, ordinary
  // under fog.
  const fen = '4k4/9/9/9/9/9/9/9/9/3AKA3 w - - 0 1';
  const exposed = '4k4/9/9/9/9/9/9/9/9/4K3R w - - 0 1';
  assert.equal(parseStandardXiangqiFen(exposed).ok, false);
  assert.equal(normalizeStartFen('dark-xiangqi', exposed).ok, true);
  // The relaxation is only about capture-the-general: everything else still holds.
  assert.equal(normalizeStartFen('dark-xiangqi', fen).ok, true);
  assert.equal(normalizeStartFen('dark-xiangqi', '4k4/9/9/9/9/9/9/9/9/9 w - - 0 1').ok, false);
});

test('fog chess accepts the side not to move standing in check', () => {
  // White rook on e1 giving check to a black king on e8, black to move having
  // just walked into it: legal under fog, rejected by standard chess legality.
  const exposed = '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1';
  assert.equal(parseDarkChessFen(exposed).ok, true);
  // Structural impossibilities are still refused.
  assert.equal(parseDarkChessFen('8/8/8/8/8/8/8/8 w - - 0 1').ok, false);
  assert.equal(parseDarkChessFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1 extra junk here').ok, false);
});

test('parseDarkChessFen produces a state the fog variant can move from', () => {
  const parsed = parseDarkChessFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  assert.ok(parsed.ok);
  assert.equal(parsed.state.variant, 'dark-chess');
  const moves = darkChessVariant.getLegalMoves(parsed.state, 'white');
  assert.ok(moves.some((move) => move.from === 'e2' && move.to === 'e4'));
});
