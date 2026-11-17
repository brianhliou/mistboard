import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readXiangqiPositionOnlyPuzzle,
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
} from '@mistboard/game';
import {
  positionPacketFixture,
  positionPuzzleFixture,
} from './fixtures/xiangqi-position-packet.js';
import {
  readXiangqiPositionPacket,
  xiangqiPositionPacketHash,
} from './xiangqi-puzzle-position-packet.js';

test('position-only mate and advantage packets bind every solver turn', () => {
  for (const winning of [false, true]) {
    const packet = positionPacketFixture(winning);
    assert.equal(readXiangqiPositionPacket(packet).items.length, 1);
    assert.match(xiangqiPositionPacketHash(packet), /^[a-f0-9]{64}$/);
  }
});

test('complete serialized position-only payload contains no game history or reference', () => {
  const puzzle = readXiangqiPositionOnlyPuzzle(positionPuzzleFixture());
  const text = JSON.stringify(puzzle);
  for (const marker of ['sourceGame', 'history', 'moveLog', 'lastMove', 'showcaseSourceGameId'])
    assert.ok(!text.includes(marker));
  assert.deepEqual(puzzle.initial.positionCounts, {});
  assert.ok(puzzle.credit?.event);
});

test('a legal forced-start line cannot acquire approval from a claimed winning score', () => {
  const puzzle = positionPuzzleFixture(true);
  puzzle.initial.board = {
    e1: { color: 'red', role: 'general' },
    a3: { color: 'red', role: 'chariot' },
    d10: { color: 'black', role: 'general' },
    e3: { color: 'black', role: 'chariot' },
    d2: { color: 'black', role: 'chariot' },
    h2: { color: 'black', role: 'horse' },
  };
  puzzle.solution = [
    { from: 'a3', to: 'e3' },
    { from: 'h2', to: 'f3' },
    { from: 'e3', to: 'f3' },
  ];
  assert.equal(validateStandardXiangqiPuzzle(puzzle as XiangqiPuzzle).ok, true);
  assert.throws(() => readXiangqiPositionOnlyPuzzle(puzzle), /starting choice/);
});

function plant(root: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let target = root as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const key = keys.at(-1)!;
  if (value === undefined) delete target[key];
  else target[key] = value;
}

test('planted history is refused at every nesting level', () => {
  for (const [path, value] of [
    ['sourceGame', { gameId: 'PRIVATE_GAME', ply: 50 }],
    ['initial.moveLog', ['PRIVATE_HISTORY']],
    ['initial.lastMove', { from: 'a1', to: 'a2' }],
    ['initial.positionCounts', { PRIVATE_HISTORY: 1 }],
    ['solution.0.history', 'PRIVATE_HISTORY'],
    ['credit.history', 'PRIVATE_HISTORY'],
  ] as const) {
    const puzzle = structuredClone(positionPuzzleFixture());
    plant(puzzle, path, value);
    assert.throws(() => readXiangqiPositionOnlyPuzzle(puzzle));
  }
});

test('missing credit, misleading goal, invalid link and untyped rule stamps are refused', () => {
  for (const [path, value] of [
    ['credit.event', undefined],
    ['credit.red', ''],
    ['credit.url', 'javascript:alert(1)'],
    ['title', 'Find the winning move'],
    ['initial.progressClockLimit', '60'],
  ] as const) {
    const puzzle = structuredClone(positionPuzzleFixture());
    plant(puzzle, path, value);
    assert.throws(() => readXiangqiPositionOnlyPuzzle(puzzle));
  }
});

test('changed puzzle, engine, profile, review or incomplete audit fail closed', () => {
  for (const [path, value] of [
    ['items.0.puzzle.credit.event', 'Different event'],
    ['engine.networkSha256', '0'.repeat(64)],
    ['engine.binarySha256', '0'.repeat(64)],
    ['verificationProfile.baselineNodes.1', 1_000_000],
    ['items.0.review.puzzleHash', '0'.repeat(64)],
    ['items.0.audit.turns.length', 1],
    ['items.0.audit.turns.0.mateGoalAttempts.0.complete', false],
    ['items.0.audit.turns.0.mateGoalAttempts.0.winningMoves.1', { from: 'a1', to: 'a2' }],
  ] as const) {
    const packet = structuredClone(positionPacketFixture());
    plant(packet, path, value);
    assert.throws(() => readXiangqiPositionPacket(packet));
  }
});

test('winning-advantage scores, depth and legal alternatives are recomputed', () => {
  for (const [path, value] of [
    ['items.0.audit.turns.0.searches.1.lines.1.score.cp', 999],
    ['items.0.audit.turns.0.searches.1.lines.0.depth', 1],
    ['items.0.audit.turns.0.searches.1.lines.1.pvUci', ['a9a0']],
    ['items.0.audit.turns.0.searches.1.lines.length', 2],
    ['items.0.audit.turns.0.searches.1.nodes', 1],
  ] as const) {
    const packet = structuredClone(positionPacketFixture(true));
    plant(packet, path, value);
    assert.throws(() => readXiangqiPositionPacket(packet));
  }
});

test('reading a packet detaches its puzzle and receipts from mutable caller data', () => {
  const value = positionPacketFixture();
  const result = readXiangqiPositionPacket(value);
  value.items[0]!.puzzle.credit!.event = 'mutated';
  value.items[0]!.audit.turns.length = 0;
  assert.notEqual(result.items[0]!.puzzle.credit!.event, 'mutated');
  assert.equal(result.items[0]!.audit.turns.length, 2);
});
