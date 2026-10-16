import type { XiangqiColor } from '@mistboard/game';
import { beforeEach, expect, test } from 'vitest';
import { xiangqiBoardPoint } from './xiangqi-board-geometry.js';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';

// Black's view of a xiangqi board is a 180 degree ROTATION, not a top-to-bottom
// mirror: Black's own file 1 sits on Black's right, which is where the Chinese
// notation beside the board counts from. The shared board geometry got that fix
// on 2026-08-27; the article replay kept its own copy of the point maths and
// flipped only the rank, so after "Flip the board" a1 stayed on the left.

const spec: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7',
  red: 'Red',
  black: 'Black',
  event: 'Flip',
  resultText: '*',
  annotations: { byPly: {} },
};

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
});

/** Centre of the piece drawn on `square`, in board units. */
function pieceCentre(host: HTMLElement, square: string): { x: number; y: number } {
  const piece = host.querySelector(`[data-piece-square="${square}"] svg`);
  if (!piece) throw new Error(`no piece on ${square}`);
  const size = Number(piece.getAttribute('width'));
  return {
    x: Number(piece.getAttribute('x')) + size / 2,
    y: Number(piece.getAttribute('y')) + size / 2,
  };
}

/** The board's margin, read off its own viewBox (width = 2 * margin + 8 cells). */
function geometry(host: HTMLElement) {
  const [, , w] = (host.querySelector('svg.xq-article-svg')?.getAttribute('viewBox') ?? '')
    .split(' ')
    .map(Number);
  const cell = 31;
  return { fileCount: 9, rankCount: 10, cell, margin: (w! - 8 * cell) / 2, riverGap: 0 };
}

function flip(host: HTMLElement): void {
  const item = [...host.querySelectorAll<HTMLButtonElement>('.xq-replay-menu-item')].find(
    (b) => b.textContent === 'Flip the board',
  );
  if (!item) throw new Error('no flip item');
  item.click();
}

test('flipping the board rotates it: a1 and i1 swap sides as well as ranks', () => {
  const c = mountXiangqiReplay(el, spec);
  const redA1 = pieceCentre(el, 'a1');
  const redI1 = pieceCentre(el, 'i1');
  expect(redA1.x).toBeLessThan(redI1.x);

  flip(el);
  const blackA1 = pieceCentre(el, 'a1');
  const blackI1 = pieceCentre(el, 'i1');
  expect(blackA1.x).toBeGreaterThan(blackI1.x);
  expect(blackA1.x).toBe(redI1.x);
  expect(blackA1.y).toBeLessThan(redA1.y);
  c.destroy();
});

test('a board opened for Black has a1 on the right', () => {
  const c = mountXiangqiReplay(el, { ...spec, perspective: 'black' });
  expect(pieceCentre(el, 'a1').x).toBeGreaterThan(pieceCentre(el, 'i1').x);
  c.destroy();
});

test('every piece and the last-move ring agree with the shared board geometry', () => {
  for (const perspective of ['red', 'black'] as XiangqiColor[]) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const c = mountXiangqiReplay(host, { ...spec, perspective, startPly: 2 });
    const geo = geometry(host);
    const slots = host.querySelectorAll<SVGGElement>('[data-piece-square]');
    expect(slots.length).toBe(32);
    for (const slot of slots) {
      const sq = slot.dataset.pieceSquare!;
      const file = 'abcdefghi'.indexOf(sq[0]!);
      const rank = Number(sq.slice(1));
      const want = xiangqiBoardPoint(file, rank, perspective, 'intersection', geo);
      const got = pieceCentre(host, sq);
      expect([sq, perspective, got.x, got.y]).toEqual([sq, perspective, want.x, want.y]);
    }
    // h9g7 just landed on g8 (engine rank). Its ring is centred on that point.
    const to = xiangqiBoardPoint(6, 8, perspective, 'intersection', geo);
    const html = host.querySelector('svg.xq-article-svg')?.innerHTML ?? '';
    expect(html).toContain(`cx="${to.x}"`);
    c.destroy();
  }
});
