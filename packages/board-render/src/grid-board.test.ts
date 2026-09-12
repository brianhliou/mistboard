import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGridGeometry,
  type GridBoardDescriptor,
  type GridPalette,
  renderGridBoardSvg,
} from './grid-board.js';

const palette: GridPalette = {
  lightCell: '#f0d9b5',
  darkCell: '#b58863',
  coord: 'rgba(60,45,30,0.55)',
  lastMove: 'rgba(255,205,80,0.45)',
  selected: 'rgba(255,205,80,0.55)',
  targetDot: 'rgba(45,100,45,0.62)',
  targetRing: 'rgba(170,40,40,0.62)',
  fog: 'rgba(22,18,14,0.66)',
};

// River-board shape: 6 files x 8 ranks with a river strip at the middle.
const sixByEight: GridBoardDescriptor = {
  files: 6,
  ranks: 8,
  cell: 50,
  strips: [{ afterRow: 4, height: 11, fill: '#5aa0d6', highlightFill: 'rgba(255,255,255,0.4)' }],
  palette,
};

// Chess-shaped board: 8x8, no strip — the SAME model, different data.
const chess: GridBoardDescriptor = { files: 8, ranks: 8, cell: 50, palette };

const noPieces = { id: 'b', flip: false, renderPieces: () => '' };

const cellRectCount = (svg: string): number =>
  (svg.match(/ width="50" height="50" fill="/g) ?? []).length;

test('one core renders a 6x8 river board and an 8x8 board from data alone', () => {
  const sixByEightSvg = renderGridBoardSvg(sixByEight, noPieces);
  const chessSvg = renderGridBoardSvg(chess, noPieces);

  // 48 vs 64 checkered cells — the only difference is the descriptor's dimensions.
  assert.equal(cellRectCount(sixByEightSvg), 48);
  assert.equal(cellRectCount(chessSvg), 64);

  // The river strip exists on the 6x8 board only; it pushes board height to
  // 8*50 + 11 = 411 (vs a clean 8*50 = 400 with no strip).
  assert.match(sixByEightSvg, /fill="#5aa0d6"/);
  assert.match(sixByEightSvg, /width="300" height="411"/);
  assert.doesNotMatch(chessSvg, /fill="#5aa0d6"/);
  assert.match(chessSvg, /width="400" height="400"/);
  // Board chrome is intentionally outline-free. The shared core has no frame
  // palette or edge-width escape hatch, so every descriptor gets this policy.
  assert.doesNotMatch(sixByEightSvg, /<rect[^>]*fill="none"[^>]*stroke=/);
  assert.doesNotMatch(chessSvg, /<rect[^>]*fill="none"[^>]*stroke=/);
});

test('geometry offsets rows past the strip and flips with orientation', () => {
  const geom = createGridGeometry(sixByEight, false);
  // a1 (file 0, rank 1) is the bottom-left: display row 7, which sits past the
  // strip, so its y is 7*50 + 11 = 361.
  assert.deepEqual(geom.topLeft(0, 1), { x: 0, y: 361 });
  // a8 is the top-left: display row 0, no strip offset.
  assert.deepEqual(geom.topLeft(0, 8), { x: 0, y: 0 });

  const flipped = createGridGeometry(sixByEight, true);
  // Flipped, a1 moves to the top-right corner column (file -> files-1-file).
  assert.deepEqual(flipped.topLeft(0, 1), { x: 250, y: 0 });
});

test('the orientation flip changes the rendered output', () => {
  const white = renderGridBoardSvg(sixByEight, { ...noPieces });
  const red = renderGridBoardSvg(sixByEight, { ...noPieces, flip: true });
  assert.notEqual(white, red);
});

test('interaction layers render only the data they are given', () => {
  const svg = renderGridBoardSvg(sixByEight, {
    id: 'i',
    flip: false,
    renderPieces: () => '',
    selected: { file: 3, rank: 1 },
    targets: [
      { file: 2, rank: 3, occupied: false },
      { file: 4, rank: 3, occupied: true },
    ],
    fogHidden: [{ file: 5, rank: 8 }],
    interactive: true,
    squareName: (f, r) => `${String.fromCharCode(97 + f)}${r}`,
  });

  // 48 hit targets, each named.
  assert.equal((svg.match(/data-square="/g) ?? []).length, 48);
  assert.match(svg, /data-square="d1"/);
  // Selection highlight + one move dot (empty) + one capture ring (occupied).
  assert.match(svg, /fill="rgba\(255,205,80,0\.55\)"/);
  assert.equal((svg.match(/fill="rgba\(45,100,45,0\.62\)"/g) ?? []).length, 1);
  assert.equal((svg.match(/stroke="rgba\(170,40,40,0\.62\)"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="mb-grid-target-hover"/g) ?? []).length, 2);
  assert.match(svg, /fill="rgba\(31,111,91,0\.30\)"/);
  // The fogged square is filled with the fog colour.
  assert.match(svg, /fill="rgba\(22,18,14,0\.66\)"/);
});

test('highlights fill multiple squares with the selection colour', () => {
  const none = renderGridBoardSvg(sixByEight, noPieces);
  const baseSelected = (none.match(/fill="rgba\(255,205,80,0\.55\)"/g) ?? []).length;

  const svg = renderGridBoardSvg(sixByEight, {
    ...noPieces,
    highlights: [
      { file: 2, rank: 4 },
      { file: 2, rank: 5 },
      { file: 4, rank: 7 },
    ],
  });
  // Three highlight squares, drawn in the selection colour.
  assert.equal((svg.match(/fill="rgba\(255,205,80,0\.55\)"/g) ?? []).length, baseSelected + 3);
});

test('threats fill squares with the threat colour, drawn over the fog', () => {
  const svg = renderGridBoardSvg(sixByEight, {
    ...noPieces,
    fogHidden: [{ file: 3, rank: 5 }],
    threats: [
      { file: 3, rank: 5 },
      { file: 4, rank: 6 },
    ],
  });
  // Two threat squares in the default threat colour...
  assert.equal((svg.match(/fill="rgba\(200,48,48,0\.34\)"/g) ?? []).length, 2);
  // ...and the threat on the fogged square is painted AFTER the fog (so it
  // shows through the shroud).
  const fogIndex = svg.indexOf('fill="rgba(22,18,14,0.66)"');
  const threatIndex = svg.indexOf('fill="rgba(200,48,48,0.34)"');
  assert.ok(fogIndex >= 0 && threatIndex > fogIndex, 'threat layer must paint after fog');
});

test('arrows draw a marker def and one line per arrow', () => {
  const none = renderGridBoardSvg(sixByEight, noPieces);
  assert.doesNotMatch(none, /<marker id="b-arrow"/);

  const svg = renderGridBoardSvg(sixByEight, {
    ...noPieces,
    arrows: [
      { from: { file: 4, rank: 7 }, to: { file: 4, rank: 8 } },
      { from: { file: 0, rank: 1 }, to: { file: 0, rank: 4 } },
    ],
  });
  // One shared marker def, two arrow lines pointing at it, default green.
  assert.equal((svg.match(/<marker id="b-arrow"/g) ?? []).length, 1);
  assert.equal((svg.match(/marker-end="url\(#b-arrow\)"/g) ?? []).length, 2);
  assert.match(svg, /stroke="#2f7d2f"/);
});

test('a custom palette arrow colour overrides the default', () => {
  const svg = renderGridBoardSvg(
    { ...sixByEight, palette: { ...palette, arrow: '#b5322b' } },
    { ...noPieces, arrows: [{ from: { file: 0, rank: 1 }, to: { file: 1, rank: 1 } }] },
  );
  assert.match(svg, /stroke="#b5322b"/);
});
