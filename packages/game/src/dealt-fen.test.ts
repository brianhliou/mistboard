/**
 * The DEALT FEN readers for the hidden-deal variants (banqi, jieqi, jungle-flip).
 * The writers are the engine redaction boundary (pinned in *-fen.test.ts); these
 * tests pin the reverse direction, which seeds an analysis board or a study from
 * a pasted position:
 *
 *   1. GRAMMAR. The sixth `hidden` field is one role char per face-down piece in
 *      board order, hardcoded here so a writer/reader drift fails loudly.
 *   2. ROUND TRIP. parse(stateToDealtFen(s)) reproduces s (up to id, repetition
 *      bookkeeping, capture order, and banqi's ply-parity choice), and the engine
 *      FEN of a state rebuilt from a PUBLIC fen equals that public fen: sampling
 *      the hidden identities is invisible to the engine.
 *   3. SAMPLING is deterministic under a seeded rng and pinned by the dealt form.
 *   4. VALIDATION. Every structural rejection has a user-readable message.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { banqiStateToDealtFen, banqiStateToEngineFen, parseBanqiFen } from './banqi-fen.js';
import { parsePoolField, sameMultiset, shuffleWithRng } from './dealt-fen.js';
import { jieqiStateToDealtFen, jieqiStateToPikafishFen, parseJieqiFen } from './jieqi-fen.js';
import {
  jungleFlipStateToDealtFen,
  jungleFlipStateToEngineFen,
  parseJungleFlipFen,
} from './jungle-flip-fen.js';
import {
  applyBanqiMove,
  type BanqiGameState,
  banqiMoverInk,
  createBanqiDeal,
  createInitialBanqiState,
  getBanqiLegalMoves,
} from './variants-banqi.js';
import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  type JieqiGameState,
} from './variants-jieqi.js';
import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  createJungleFlipDeal,
  getJungleFlipLegalMoves,
  type JungleFlipGameState,
  jungleFlipMoverInk,
} from './variants-jungle-flip.js';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function expectRejections(
  parse: (fen: string) => { ok: boolean; error?: string },
  cases: Array<[string, RegExp]>,
): void {
  for (const [fen, pattern] of cases) {
    const parsed = parse(fen);
    assert.equal(parsed.ok, false, `expected a rejection for "${fen}"`);
    assert.ok(
      !parsed.ok && pattern.test(parsed.error ?? ''),
      `wrong error for "${fen}": ${parsed.error}`,
    );
    assert.ok(!(parsed.error ?? '').includes('—'), `em dash in error for "${fen}"`);
  }
}

function captureKeys(captures: ReadonlyArray<{ owner: string; role: string }>): string[] {
  return captures.map((c) => `${c.owner}:${c.role}`).sort();
}

// ── Shared helpers ───────────────────────────────────────────────────────────

test('parsePoolField reads counts, accepts zeros, rejects junk', () => {
  const known = (ch: string) => 'GAERHCS'.includes(ch.toUpperCase());
  assert.deepEqual([...parsePoolField('-', known)!], []);
  assert.deepEqual(
    [...parsePoolField('G1s5c0', known)!],
    [
      ['G', 1],
      ['s', 5],
      ['c', 0],
    ],
  );
  assert.equal(parsePoolField('G1Z2', known), null);
  assert.equal(parsePoolField('G', known), null);
  assert.equal(parsePoolField('1G', known), null);
});

test('shuffleWithRng is a seeded permutation; sameMultiset ignores order', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const first = shuffleWithRng(items, seededRng(3));
  const second = shuffleWithRng(items, seededRng(3));
  assert.deepEqual(first, second);
  assert.ok(sameMultiset(first, items));
  assert.equal(sameMultiset(['a', 'a'], ['a', 'b']), false);
  assert.equal(sameMultiset(['a'], ['a', 'a']), false);
});

// ── Banqi ────────────────────────────────────────────────────────────────────

const BANQI_START_PUBLIC = 'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1';
// Standard (unshuffled) deal in board order: rank 4 = squares 24..31 (black's
// second half), rank 3 = 16..23, rank 2 = 8..15, rank 1 = 0..7.
const BANQI_START_HIDDEN = 'hccsssssgaaeerrhHCCSSSSSGAAEERRH';

test('banqi: the dealt fen is the engine fen plus the hidden field in board order', () => {
  const initial = createInitialBanqiState('t');
  assert.equal(banqiStateToDealtFen(initial), `${BANQI_START_PUBLIC} ${BANQI_START_HIDDEN}`);
  // Every tile face-down: the field has one char per square.
  assert.equal(BANQI_START_HIDDEN.length, 32);
});

test('banqi: a dealt fen rebuilds the exact deal (no sampling)', () => {
  const parsed = parseBanqiFen(`${BANQI_START_PUBLIC} ${BANQI_START_HIDDEN}`, { gameId: 'g' });
  assert.ok(parsed.ok, `rejected: ${!parsed.ok && parsed.error}`);
  assert.equal(parsed.sampled, false);
  assert.equal(parsed.state.id, 'g');
  assert.deepEqual(parsed.state.board.a1, { color: 'red', role: 'general', faceDown: true });
  assert.deepEqual(parsed.state.board.h4, { color: 'black', role: 'soldier', faceDown: true });
  assert.deepEqual(parsed.state.board.a4, { color: 'black', role: 'horse', faceDown: true });
  assert.equal(parsed.state.firstColor, null);
  assert.equal(parsed.state.ply, 0);
  assert.deepEqual(parsed.state.captures, []);
  assert.deepEqual(parsed.state.status, { type: 'playing', turn: 'red' });
});

test('banqi: a public fen samples the deal deterministically under a seeded rng', () => {
  const a = parseBanqiFen(BANQI_START_PUBLIC, { rng: seededRng(11) });
  const b = parseBanqiFen(BANQI_START_PUBLIC, { rng: seededRng(11) });
  const c = parseBanqiFen(BANQI_START_PUBLIC, { rng: seededRng(12) });
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.sampled, true);
  assert.deepEqual(a.state.board, b.state.board);
  assert.notDeepEqual(a.state.board, c.state.board);
  // Sampling is invisible to the engine, and the dealt form pins it.
  assert.equal(banqiStateToEngineFen(a.state), BANQI_START_PUBLIC);
  const pinned = parseBanqiFen(banqiStateToDealtFen(a.state));
  assert.ok(pinned.ok);
  assert.equal(pinned.sampled, false);
  assert.deepEqual(pinned.state.board, a.state.board);
});

test('banqi: a mid-game public fen samples only from the pool, and the remainder is captured', () => {
  // Red general revealed on a4, one red soldier revealed on h1, three tiles still
  // face-down (a red chariot, two black soldiers), everything else captured.
  const fen = 'G2X4/8/8/3XX2S r R1s2 3 12';
  const parsed = parseBanqiFen(fen, { rng: seededRng(5) });
  assert.ok(parsed.ok, `rejected: ${!parsed.ok && parsed.error}`);
  assert.equal(parsed.sampled, true);
  assert.equal(banqiStateToEngineFen(parsed.state), fen);
  const hidden = ['d4', 'd1', 'e1'].map((sq) => parsed.state.board[sq as 'd4']!);
  assert.ok(hidden.every((p) => p.faceDown));
  assert.deepEqual(hidden.map((p) => `${p.color}:${p.role}`).sort(), [
    'black:soldier',
    'black:soldier',
    'red:chariot',
  ]);
  // 32 - 2 revealed - 3 face-down = 27 captured.
  assert.equal(parsed.state.captures.length, 27);
  assert.equal(parsed.state.moveNumber, 12);
  assert.equal(parsed.state.noProgressClock, 3);
  assert.equal(parsed.state.ply, 22);
  assert.equal(banqiMoverInk(parsed.state), 'red');
});

test('banqi: random states round-trip through the dealt fen (engine fen invariant)', () => {
  const rng = seededRng(2026);
  for (let game = 0; game < 12; game += 1) {
    let state: BanqiGameState = createInitialBanqiState('t', createBanqiDeal(rng));
    const plies = Math.floor(rng() * 30);
    for (let i = 0; i < plies && state.status.type === 'playing'; i += 1) {
      const moves = getBanqiLegalMoves(state);
      state = applyBanqiMove(state, moves[Math.floor(rng() * moves.length)]!);
    }
    if (state.status.type !== 'playing') continue;
    const dealt = banqiStateToDealtFen(state);
    const parsed = parseBanqiFen(dealt);
    assert.ok(parsed.ok, `rejected own dealt fen ${dealt}: ${!parsed.ok && parsed.error}`);
    assert.equal(parsed.sampled, false);
    assert.deepEqual(parsed.state.board, state.board);
    assert.deepEqual(captureKeys(parsed.state.captures), captureKeys(state.captures));
    assert.equal(parsed.state.moveNumber, state.moveNumber);
    assert.equal(parsed.state.noProgressClock, state.noProgressClock);
    assert.equal(banqiMoverInk(parsed.state), banqiMoverInk(state));
    assert.equal(banqiStateToEngineFen(parsed.state), banqiStateToEngineFen(state));
    assert.equal(banqiStateToDealtFen(parsed.state), dealt);
    // The public form re-samples but is still engine-identical.
    const sampled = parseBanqiFen(banqiStateToEngineFen(state), { rng });
    assert.ok(sampled.ok);
    assert.equal(banqiStateToEngineFen(sampled.state), banqiStateToEngineFen(state));
  }
});

test('banqi: the turn field is "-" exactly in the opening', () => {
  // Every tile face-down with an ink already bound: impossible.
  expectRejections(
    (fen) => parseBanqiFen(fen),
    [
      ['XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX r G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1', /must be "-"/],
      // A revealed tile with no ink bound: impossible.
      ['GXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1', /only legal before/],
      // The opening is move 1 with a fresh clock.
      ['XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 2', /move number 1/],
    ],
  );
  const opening = parseBanqiFen(BANQI_START_PUBLIC, { rng: seededRng(1) });
  assert.ok(opening.ok);
  assert.equal(opening.state.firstColor, null);
  // The first flip binds the ink exactly as in a live game.
  const after = applyBanqiMove(opening.state, { from: 'c2', to: 'c2' });
  assert.equal(after.firstColor, opening.state.board.c2!.color);
});

test('banqi: structural rejections carry a readable message', () => {
  const pool = 'G1A2E2R2H2C2S5g1a2e2r2h2c2s5';
  expectRejections(
    (fen) => parseBanqiFen(fen),
    [
      ['', /Empty/],
      ['   ', /Empty/],
      ['XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX -', /5 or 6/],
      [`XXXXXXXX/XXXXXXXX/XXXXXXXX - ${pool} 0 1`, /3.*ranks|ranks/],
      [`XXXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - ${pool} 0 1`, /runs past 8 files/],
      [`XXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - ${pool} 0 1`, /covers 7 files/],
      ['Q7/8/8/8 r - 0 1', /Unknown piece "Q"/],
      ['G7/8/8/8 w - 0 1', /side-to-move "w"/],
      ['G7/8/8/8 r G1Z1 0 1', /Unreadable pool/],
      ['G7/8/8/8 r s2 0 1', /pool lists 2 hidden pieces but the board has 0/],
      ['GG6/8/8/8 r - 0 1', /Too many red generals/],
      ['G7/8/8/8 r - x 1', /clock field/],
      ['G7/8/8/8 r - 0 one', /move-number field/],
      ['G7/8/8/8 r - 0 0', /at least 1/],
      // Sixth field: length, alphabet, and multiset must all agree with the pool.
      ['GX6/8/8/8 r s1 0 1 ss', /hidden field lists 2/],
      ['GX6/8/8/8 r s1 0 1 -', /hidden field lists 0/],
      ['GX6/8/8/8 r s1 0 1 z', /Unknown hidden piece "z"/],
      ['GX6/8/8/8 r s1 0 1 S', /does not match the pool/],
    ],
  );
});

// ── Jungle-flip ──────────────────────────────────────────────────────────────

const JUNGLE_FLIP_START_PUBLIC = 'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0';
// Standard deal in board order: rank 4 = squares 12..15, rank 3 = 8..11, rank 2 = 4..7, rank 1 = 0..3.
const JUNGLE_FLIP_START_HIDDEN = 'ptlercdwPTLERCDW';

test('jungle-flip: the dealt fen is the engine fen plus the hidden field in board order', () => {
  const initial = createInitialJungleFlipState('t');
  assert.equal(
    jungleFlipStateToDealtFen(initial),
    `${JUNGLE_FLIP_START_PUBLIC} ${JUNGLE_FLIP_START_HIDDEN}`,
  );
  const parsed = parseJungleFlipFen(`${JUNGLE_FLIP_START_PUBLIC} ${JUNGLE_FLIP_START_HIDDEN}`);
  assert.ok(parsed.ok, `rejected: ${!parsed.ok && parsed.error}`);
  assert.equal(parsed.sampled, false);
  assert.deepEqual(parsed.state.board, initial.board);
  assert.equal(parsed.state.firstColor, null);
  assert.equal(parsed.state.ply, 0);
});

test('jungle-flip: the movenum slot is the ply; parity picks the seat and solves firstColor', () => {
  // Ply 3 (black seat to move) with the red ink to move: the red SEAT owns black.
  const oddRed = parseJungleFlipFen('RXXX/XXXX/XXXX/XXXc r C1D1W1P1T1L1E1r1d1w1p1t1l1e1 0 3', {
    rng: seededRng(1),
  });
  assert.ok(oddRed.ok, `rejected: ${!oddRed.ok && oddRed.error}`);
  assert.deepEqual(oddRed.state.status, { type: 'playing', turn: 'black' });
  assert.equal(oddRed.state.firstColor, 'black');
  assert.equal(jungleFlipMoverInk(oddRed.state), 'red');
  assert.equal(oddRed.state.moveNumber, 2);
  assert.equal(oddRed.state.ply, 3);
  // Even ply with the red ink to move: the red SEAT owns red.
  const evenRed = parseJungleFlipFen('RXXX/XXXX/XXXX/XXXc r C1D1W1P1T1L1E1r1d1w1p1t1l1e1 1 4', {
    rng: seededRng(1),
  });
  assert.ok(evenRed.ok);
  assert.deepEqual(evenRed.state.status, { type: 'playing', turn: 'red' });
  assert.equal(evenRed.state.firstColor, 'red');
  assert.equal(evenRed.state.moveNumber, 3);
  assert.equal(evenRed.state.noProgressClock, 1);
  // Pool math: 14 face-down, 2 revealed, nothing captured.
  assert.deepEqual(evenRed.state.captures, []);
});

test('jungle-flip: random states round-trip through the dealt fen (engine fen invariant)', () => {
  const rng = seededRng(77);
  for (let game = 0; game < 12; game += 1) {
    let state: JungleFlipGameState = createInitialJungleFlipState('t', createJungleFlipDeal(rng));
    const plies = Math.floor(rng() * 20);
    for (let i = 0; i < plies && state.status.type === 'playing'; i += 1) {
      const moves = getJungleFlipLegalMoves(state);
      state = applyJungleFlipMove(state, moves[Math.floor(rng() * moves.length)]!);
    }
    if (state.status.type !== 'playing') continue;
    const dealt = jungleFlipStateToDealtFen(state);
    const parsed = parseJungleFlipFen(dealt);
    assert.ok(parsed.ok, `rejected own dealt fen ${dealt}: ${!parsed.ok && parsed.error}`);
    assert.deepEqual(parsed.state.board, state.board);
    assert.deepEqual(captureKeys(parsed.state.captures), captureKeys(state.captures));
    assert.equal(parsed.state.ply, state.ply);
    assert.equal(parsed.state.firstColor, state.firstColor);
    assert.equal(parsed.state.moveNumber, state.moveNumber);
    assert.deepEqual(parsed.state.status, state.status);
    assert.equal(jungleFlipStateToEngineFen(parsed.state), jungleFlipStateToEngineFen(state));
    const sampled = parseJungleFlipFen(jungleFlipStateToEngineFen(state), { rng });
    assert.ok(sampled.ok);
    assert.equal(jungleFlipStateToEngineFen(sampled.state), jungleFlipStateToEngineFen(state));
  }
});

test('jungle-flip: structural rejections carry a readable message', () => {
  expectRejections(
    (fen) => parseJungleFlipFen(fen),
    [
      ['XXXX/XXXX/XXXX - r1 0 0', /ranks/],
      ['XXXXX/XXXX/XXXX/XXXX - r1 0 0', /runs past 4 files/],
      ['XXXX/XXXX/XXXX/XXXX r R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0', /must be "-"/],
      ['XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 2', /ply must both be 0/],
      ['R3/4/4/4 - - 0 1', /only legal before/],
      ['RR2/4/4/4 r - 0 2', /Too many red rats/],
      ['G3/4/4/4 r - 0 2', /Unknown piece "G"/],
      ['RX2/4/4/4 r c1 0 2 C', /does not match the pool/],
    ],
  );
});

// ── Jieqi ────────────────────────────────────────────────────────────────────

const JIEQI_START_PUBLIC =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';
// Standard deal in board order: rank 10 (8 black), rank 8 (2), rank 7 (5), then
// rank 4 (5 red), rank 3 (2), rank 1 (8).
const JIEQI_START_HIDDEN = 'rnbaabnrccpppppPPPPPCCRNBAABNR';

test('jieqi: the dealt fen is the Pikafish fen plus the hidden field in board order', () => {
  const initial = createInitialJieqiState('t');
  assert.equal(jieqiStateToDealtFen(initial), `${JIEQI_START_PUBLIC} ${JIEQI_START_HIDDEN}`);
  const parsed = parseJieqiFen(`${JIEQI_START_PUBLIC} ${JIEQI_START_HIDDEN}`, { gameId: 'g' });
  assert.ok(parsed.ok, `rejected: ${!parsed.ok && parsed.error}`);
  assert.equal(parsed.sampled, false);
  assert.deepEqual(parsed.state.board, initial.board);
  assert.deepEqual(parsed.state.status, { type: 'playing', turn: 'red' });
  assert.deepEqual(parsed.state.captures, []);
  assert.equal(parsed.state.id, 'g');
});

test('jieqi: a public fen samples each side from its own pool, invisibly to the engine', () => {
  const a = parseJieqiFen(JIEQI_START_PUBLIC, { rng: seededRng(4) });
  const b = parseJieqiFen(JIEQI_START_PUBLIC, { rng: seededRng(4) });
  const c = parseJieqiFen(JIEQI_START_PUBLIC, { rng: seededRng(5) });
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.sampled, true);
  assert.deepEqual(a.state.board, b.state.board);
  assert.notDeepEqual(a.state.board, c.state.board);
  assert.equal(jieqiStateToPikafishFen(a.state), JIEQI_START_PUBLIC);
  // Colour is never sampled: every dark piece keeps the ink of its home square.
  for (const [square, piece] of Object.entries(a.state.board)) {
    if (!piece?.faceDown) continue;
    assert.equal(piece.color, createInitialJieqiState('t').board[square as 'a1']!.color);
  }
  const pinned = parseJieqiFen(jieqiStateToDealtFen(a.state));
  assert.ok(pinned.ok);
  assert.equal(pinned.sampled, false);
  assert.deepEqual(pinned.state.board, a.state.board);
});

test('jieqi: the Pikafish "w" and the position-key "r" both mean red to move', () => {
  const w = parseJieqiFen('4k4/9/9/9/9/9/9/9/9/4K4 w R0A0C0P0N0B0r0a0c0p0n0b0 0 1');
  const r = parseJieqiFen('4k4/9/9/9/9/9/9/9/9/4K4 r - 0 1');
  assert.ok(w.ok && r.ok);
  assert.deepEqual(w.state.status, { type: 'playing', turn: 'red' });
  assert.deepEqual(r.state.status, { type: 'playing', turn: 'red' });
  // Bare generals: all 30 non-general pieces are captured.
  assert.equal(w.state.captures.length, 30);
  assert.ok(w.state.captures.every((c) => c.revealedAtCapture));
});

test('jieqi: random states round-trip through the dealt fen (engine fen invariant)', () => {
  const rng = seededRng(99);
  for (let game = 0; game < 10; game += 1) {
    let state: JieqiGameState = createInitialJieqiState('t', createJieqiDeal(rng));
    const plies = Math.floor(rng() * 30);
    for (let i = 0; i < plies && state.status.type === 'playing'; i += 1) {
      const moves = getJieqiLegalMoves(state);
      state = applyJieqiMove(state, moves[Math.floor(rng() * moves.length)]!);
    }
    if (state.status.type !== 'playing') continue;
    const dealt = jieqiStateToDealtFen(state);
    const parsed = parseJieqiFen(dealt);
    assert.ok(parsed.ok, `rejected own dealt fen ${dealt}: ${!parsed.ok && parsed.error}`);
    assert.deepEqual(parsed.state.board, state.board);
    assert.deepEqual(captureKeys(parsed.state.captures), captureKeys(state.captures));
    assert.equal(parsed.state.moveNumber, state.moveNumber);
    assert.equal(parsed.state.noCaptureClock, state.noCaptureClock);
    assert.deepEqual(parsed.state.status, state.status);
    assert.equal(jieqiStateToPikafishFen(parsed.state), jieqiStateToPikafishFen(state));
    const sampled = parseJieqiFen(jieqiStateToPikafishFen(state), { rng });
    assert.ok(sampled.ok);
    assert.equal(jieqiStateToPikafishFen(sampled.state), jieqiStateToPikafishFen(state));
  }
});

test('jieqi: dark pieces live on home squares, generals stay in their palaces', () => {
  expectRejections(
    (fen) => parseJieqiFen(fen),
    [
      // A red dark piece on e5 (not a home square).
      ['4k4/9/9/9/9/4X4/9/9/9/4K4 w R1A0C0P0N0B0r0a0c0p0n0b0 0 1', /not on a red home square/],
      // A black dark piece on a red home square.
      ['4k4/9/9/9/9/9/x8/9/9/4K4 w R0A0C0P0N0B0r1a0c0p0n0b0 0 1', /not on a black home square/],
      // Generals: missing, doubled, out of the palace.
      ['9/9/9/9/9/9/9/9/9/4K4 w - 0 1', /exactly one black general, found 0/],
      ['4k4/9/9/9/9/9/9/9/9/3KK4 w - 0 1', /exactly one red general, found 2/],
      ['4k4/9/9/9/9/9/9/9/9/K8 w - 0 1', /red general on a1 is outside its palace/],
      ['k8/9/9/9/9/9/9/9/9/4K4 w - 0 1', /black general on a10 is outside its palace/],
    ],
  );
});

test('jieqi: structural rejections carry a readable message', () => {
  expectRejections(
    (fen) => parseJieqiFen(fen),
    [
      ['', /Empty/],
      ['4k4/9/9/9/9/9/9/9/9/4K4 w -', /5 or 6/],
      ['4k4/9/9/9/9/9/9/9/4K4 w - 0 1', /ranks/],
      ['4k5/9/9/9/9/9/9/9/9/4K4 w - 0 1', /runs past 9 files|covers/],
      ['4k3/9/9/9/9/9/9/9/9/4K4 w - 0 1', /covers 8 files/],
      ['4k4/9/9/9/9/9/9/9/9/4K3Q w - 0 1', /Unknown piece "Q"/],
      ['4k4/9/9/9/9/9/9/9/9/4K4 x - 0 1', /side-to-move "x"/],
      ['4k4/9/9/9/9/9/9/9/9/4K4 w K1 0 1', /Unreadable pool/],
      ['4k4/9/9/9/9/9/9/9/9/X3K4 w - 0 1', /pool lists 0 hidden red pieces but the board has 1/],
      ['4k4/9/9/9/9/9/9/9/9/RRRK5 w - 0 1', /Too many red chariots/],
      ['4k4/9/9/9/9/9/9/9/9/4K4 w - -1 1', /clock field/],
      ['4k4/9/9/9/9/9/9/9/9/4K4 w - 0 1.5', /move-number field/],
      // Sixth field: length, alphabet, colour, and multiset.
      ['4k4/9/9/9/9/9/9/9/9/X3K4 w R1 0 1 RR', /hidden field lists 2/],
      ['4k4/9/9/9/9/9/9/9/9/X3K4 w R1 0 1 K', /Unknown hidden piece "K"/],
      ['4k4/9/9/9/9/9/9/9/9/X3K4 w R1 0 1 r', /does not match the red dark piece/],
      ['4k4/9/9/9/9/9/9/9/9/X3K4 w R1 0 1 N', /does not match the red pool/],
    ],
  );
  // The same position with a matching sixth field parses.
  const ok = parseJieqiFen('4k4/9/9/9/9/9/9/9/9/X3K4 w R1 0 1 R');
  assert.ok(ok.ok, `rejected: ${!ok.ok && ok.error}`);
  assert.deepEqual(ok.state.board.a1, { color: 'red', role: 'chariot', faceDown: true });
  // A public FEN's pool also holds the pieces a side lost face-down (their
  // identities were never shown), so a pool larger than the dark pieces parses
  // in the five-field form, the surplus becoming face-down captures.
  const surplus = parseJieqiFen('4k4/9/9/9/9/9/9/9/9/X3K4 w R1N1 0 1', { rng: () => 0 });
  assert.ok(surplus.ok, `rejected: ${!surplus.ok && surplus.error}`);
  const dark = surplus.state.captures.filter((c) => !c.revealedAtCapture);
  assert.deepEqual(
    dark.map((c) => c.owner),
    ['red'],
  );
  assert.equal(
    jieqiStateToPikafishFen(surplus.state, { public: true }).split(' ')[2],
    'R1A0C0P0N1B0r0a0c0p0n0b0',
  );
  // The exact dealt form stays exact.
  const exact = parseJieqiFen('4k4/9/9/9/9/9/9/9/9/X3K4 w R1N1 0 1 R');
  assert.equal(exact.ok, false);
});
