// Every xiangqi-shaped board with a river honours the three board appearance
// settings (gear > Board): River text, Start markers, Board color.
//
// River text and start markers are drawn by the shared surface
// (xiangqi-board-surface.ts) only when a board's config asks for them, and the
// captions are then shown or hidden by CSS. On 2026-10-08 jieqi and fortress
// left `riverText` out of their configs, so choosing 楚河 漢界 changed every board
// except those two, and the caption CSS lived in live-xiangqi.css, which the
// fortress routes never import. This sweep renders each board on the lined
// layout and checks the markup, and checks the caption CSS ships with the
// surface module that emits the markup.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInitialDuckXiangqiState,
  createInitialFortressXiangqiState,
  createInitialJieqiState,
  createInitialXiangqiState,
  getDuckXiangqiPlayerView,
  getFortressXiangqiPlayerView,
  getJieqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
import { renderFortressXiangqiBoardSvg } from './fortress-xiangqi-render.js';
import { type DarkXiangqiWireView, renderDarkXiangqiBoardSvg } from './live-dark-xiangqi.js';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';
import { renderXiangqiBoardSvg } from './xiangqi-board.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const darkView: DarkXiangqiWireView = {
  id: 'xq-sweep',
  perspective: 'red',
  board: {},
  visibleSquares: [],
  legalMoves: [],
  status: { type: 'playing', turn: 'red' },
  moveNumber: 1,
  captures: { red: [], black: [] },
};

/** Each board with a river, rendered on the lined (intersection) layout. */
const BOARDS: ReadonlyArray<{ name: string; svg: () => string; startMarkers: boolean }> = [
  {
    name: 'xiangqi',
    svg: () =>
      renderXiangqiBoardSvg(
        getStandardXiangqiPlayerView(createInitialXiangqiState('s'), 'red'),
        'red',
        {
          layout: 'intersection',
        },
      ),
    startMarkers: true,
  },
  {
    name: 'jieqi',
    svg: () =>
      renderJieqiBoardSvg(getJieqiPlayerView(createInitialJieqiState('s'), 'red'), 'red', {
        layout: 'intersection',
      }),
    startMarkers: true,
  },
  {
    name: 'fortress',
    svg: () =>
      renderFortressXiangqiBoardSvg(
        getFortressXiangqiPlayerView(createInitialFortressXiangqiState('s'), 'red'),
        'red',
        { layout: 'intersection' },
      ),
    // Fortress starts its cannons on the back rank, so the standard printed
    // points would mark empty squares; it deliberately has none.
    startMarkers: false,
  },
  {
    name: 'duck xiangqi',
    svg: () =>
      duckXiangqiBoardSvg(
        getDuckXiangqiPlayerView(createInitialDuckXiangqiState('s'), 'red'),
        'red',
        {
          interactive: false,
          phase: { kind: 'piece', selected: null },
          targets: [],
          layout: 'intersection',
        },
      ),
    startMarkers: true,
  },
  {
    name: 'fog xiangqi',
    svg: () => renderDarkXiangqiBoardSvg(darkView),
    startMarkers: true,
  },
];

describe('board appearance settings reach every xiangqi board with a river', () => {
  for (const board of BOARDS) {
    it(`${board.name}: draws both river captions inside the river group`, () => {
      const svg = board.svg();
      expect(svg).toMatch(/<g class="xq-live-river"[^>]*>[\s\S]*class="xq-live-river-label"/);
      expect(svg).toContain('楚 河   漢 界');
      expect(svg).toContain('class="xq-live-river-brand"');
      // The surface CSS is scoped to .xq-surface; a board without it would
      // show the captions unstyled.
      expect(svg).toMatch(/<svg class="[^"]*\bxq-surface\b/);
    });

    it(`${board.name}: ${board.startMarkers ? 'draws' : 'has no'} start markers`, () => {
      const marks = board.svg().match(/class="xq-live-start-mark"/g) ?? [];
      expect(marks).toHaveLength(board.startMarkers ? 14 : 0);
    });
  }

  it('scales the caption on boards drawn at a larger cell, and only there', () => {
    expect(BOARDS[0]?.svg()).not.toContain('--xq-river-scale');
    expect(BOARDS[1]?.svg()).toContain('style="--xq-river-scale: 1.2"');
  });

  it('ships the caption CSS with the surface module, not one variant stylesheet', () => {
    const surfaceCss = readFileSync(resolve(HERE, 'xiangqi-board-surface.css'), 'utf8');
    const liveCss = readFileSync(resolve(HERE, 'live-xiangqi.css'), 'utf8');
    expect(surfaceCss).toContain('display: var(--xq-river-label-display, none);');
    expect(surfaceCss).toContain('display: var(--xq-river-brand-display, none);');
    // One home, so two equal rules never race on bundle order.
    expect(liveCss).not.toContain('xq-river-label-display');
  });
});
