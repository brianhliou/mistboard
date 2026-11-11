/**
 * B7 — fog-of-war redaction PARITY: the server's visibility (darkChessVariant
 * getPlayerView, the basis of build.ts redaction) must match the ENGINE's
 * visibility (fow_chess visibility.py), or the engine filters its belief
 * against a different fog rule than the server redacts with — a SILENT wrong
 * belief in production.
 *
 * The other build.test.ts checks redaction is self-consistent (no leaks,
 * visible_pieces ⊆ visibility_mask). This one checks the server and engine
 * AGREE on which squares are visible, against a golden the engine emits
 * (mistboard-engine: scripts/emit_visibility_golden.py). Regenerate + recopy
 * fixtures/visibility_golden.json when either side's fog rule changes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Color, darkChessVariant, type GameState, type Square } from '@mistboard/game';
import { squareIndex } from './build.js';

// The fixture is JSON beside the source, and tsc does not copy it into dist, so the
// compiled run (`npm test`, `test:persistent`) reads it from src as well.
const HERE = dirname(fileURLToPath(import.meta.url)).replace(`${sep}dist${sep}`, `${sep}src${sep}`);

type GoldenCase = {
  id: string;
  fen: string;
  perspective: Color;
  board: Record<string, { color: Color; role: string }>;
  enPassantSquare: string | null;
  visibility_mask: string;
};
const golden: { cases: GoldenCase[] } = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'visibility_golden.json'), 'utf8'),
);

function maskToIndexSet(maskHex: string): Set<number> {
  const mask = BigInt(maskHex);
  const out = new Set<number>();
  for (let i = 0; i < 64; i++) {
    if ((mask >> BigInt(i)) & 1n) out.add(i);
  }
  return out;
}

for (const c of golden.cases) {
  test(`b7 redaction parity: ${c.id}`, () => {
    const state: GameState = {
      ...darkChessVariant.createInitialState('b7-parity'),
      board: c.board as GameState['board'],
      status: { type: 'playing', turn: c.perspective },
      castlingRights: [],
      enPassantSquare: (c.enPassantSquare ?? undefined) as GameState['enPassantSquare'],
    };

    const serverVisible = new Set(
      darkChessVariant
        .getPlayerView(state, c.perspective)
        .visibleSquares.map((sq: Square) => squareIndex(sq)),
    );
    const engineVisible = maskToIndexSet(c.visibility_mask);

    const onlyServer = [...serverVisible]
      .filter((s) => !engineVisible.has(s))
      .sort((a, b) => a - b);
    const onlyEngine = [...engineVisible]
      .filter((s) => !serverVisible.has(s))
      .sort((a, b) => a - b);
    assert.deepStrictEqual(
      { onlyServer, onlyEngine },
      { onlyServer: [], onlyEngine: [] },
      `${c.id}: server redaction and engine visibility disagree on visible squares`,
    );
  });
}
