import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import {
  atomicXiangqiLineReplays,
  atomicXiangqiPgnStyle,
  atomicXiangqiPgnWriter,
  atomicXiangqiWxfLabels,
} from './atomic-xiangqi-game-export.js';
import { standardXiangqiLineReplays, xiangqiWxfLabels } from './xiangqi-game-export.js';

// Red walks a horse to e7 while Black lines both cannons up on the eighth
// rank: 1. Pg4-g5 Ch8-e8 2. Hh1-g3 Cb8-d8 3. Hg3-f5 Pa7-a6 4. Hf5xe7. The horse
// takes the soldier on e7 and the blast takes the cannon beside it on e8 (and
// the horse itself). 4... Cd8-f8 then slides across e8, which is open only
// because the blast cleared it. Under standard rules the cannon is still on e8
// and the red horse on e7, so the same move is illegal and a standard replay
// cannot spell the line at all.
const LINE: XiangqiMove[] = [
  { from: 'g4', to: 'g5' },
  { from: 'h8', to: 'e8' },
  { from: 'h1', to: 'g3' },
  { from: 'b8', to: 'd8' },
  { from: 'g3', to: 'f5' },
  { from: 'a7', to: 'a6' },
  { from: 'f5', to: 'e7' },
  { from: 'd8', to: 'f8' },
];

test('a line that only replays under atomic rules gets WXF labels from the atomic kernel', () => {
  assert.equal(atomicXiangqiLineReplays(LINE), true);
  assert.equal(standardXiangqiLineReplays(LINE), false);
  const labels = atomicXiangqiWxfLabels(LINE);
  assert.equal(labels.length, 8);
  assert.ok(labels.every((label) => typeof label === 'string' && label.length > 0));
  // The standard exporter, handed the same line, honestly offers nothing.
  assert.deepEqual(
    xiangqiWxfLabels(LINE),
    LINE.map(() => null),
  );
  assert.equal(atomicXiangqiPgnStyle(LINE), 'wxf');
});

test('the PGN movetext is spelled against the post-blast board', () => {
  const pgn = atomicXiangqiPgnWriter(LINE, 'wxf')({ Red: 'a', Black: 'b' }, '*');
  const labels = atomicXiangqiWxfLabels(LINE);
  assert.match(pgn, /\[Red "a"\]/);
  const movetext = labels
    .map((label, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${label}` : label))
    .join(' ');
  assert.ok(pgn.replace(/\n/g, ' ').includes(`${movetext} *`), pgn);
});

test('a line the atomic kernel rejects falls back to coordinates', () => {
  // The cannon on e8 was blasted away; moving it is not a move.
  const broken: XiangqiMove[] = [...LINE.slice(0, 7), { from: 'e8', to: 'e9' }];
  assert.equal(atomicXiangqiLineReplays(broken), false);
  assert.deepEqual(
    atomicXiangqiWxfLabels(broken),
    broken.map(() => null),
  );
  assert.equal(atomicXiangqiPgnStyle(broken), 'iccs');
});
