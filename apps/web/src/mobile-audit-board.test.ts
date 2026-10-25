import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The standalone audit runner ships no type declarations.
import { measurePage } from '../../../scripts/lib/mobile-audit-rules.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mountBoard(width: number, height: number): void {
  const board = document.createElement('div');
  board.className = 'board banqi-live-board';
  board.setAttribute('aria-label', 'Banqi board');
  // happy-dom computes no opacity, which the audit reads as hidden.
  board.style.opacity = '1';
  vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(new DOMRect(3, 96, width, height));
  document.body.append(board);
}

// The audit reported board-missing on every banqi room: the board mounts as a
// 568x312 svg (1.82:1), wider than the old 1.6 cap allowed (#618).
describe('mobile audit board detection (#618)', () => {
  it.each([360, 390])('finds the horizontal banqi board at %ipx', (width) => {
    const height = Math.round((width * 312) / 568);
    mountBoard(width, height);
    const measured = measurePage({ deviceWidth: width, deviceHeight: 740 });
    expect(measured.board).toMatchObject({ width, height });
  });

  it('still ignores a strip wider than 2:1', () => {
    mountBoard(390, 150);
    expect(measurePage({ deviceWidth: 390, deviceHeight: 740 }).board).toBeNull();
  });
});
