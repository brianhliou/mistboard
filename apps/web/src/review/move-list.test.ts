import { describe, expect, it, vi } from 'vitest';
import { createMoveList } from './move-list.js';

describe('createMoveList', () => {
  it('pairs entries two-per-row with a number per pair', () => {
    const ml = createMoveList(
      [
        { ply: 1, label: 'a-b' },
        { ply: 2, label: 'c-d' },
        { ply: 3, label: 'e-f' },
      ],
      { title: 'Moves' },
    );
    expect(ml.el.querySelectorAll('.review-move-list__row').length).toBe(2); // 3 plies → 2 rows
    const moves = ml.el.querySelectorAll('.review-move-list__move');
    expect(moves.length).toBe(3);
    expect(moves[0]!.textContent).toContain('a-b');
    expect(ml.el.querySelector('.review-move-list__title')?.textContent).toBe('Moves');
  });

  it('jumps to the clicked ply once update binds jump', () => {
    const ml = createMoveList([
      { ply: 1, label: 'a-b' },
      { ply: 2, label: 'c-d' },
    ]);
    const jump = vi.fn();
    ml.update(2, jump);
    ml.el.querySelectorAll<HTMLButtonElement>('.review-move-list__move')[0]!.click();
    expect(jump).toHaveBeenCalledWith(1);
  });

  it('highlights only the current ply and moves the highlight on update', () => {
    const ml = createMoveList([
      { ply: 1, label: 'a-b' },
      { ply: 2, label: 'c-d' },
    ]);
    const moves = ml.el.querySelectorAll('.review-move-list__move');
    ml.update(2, () => {});
    expect(moves[0]!.classList.contains('review-move-list__move--current')).toBe(false);
    expect(moves[1]!.classList.contains('review-move-list__move--current')).toBe(true);
    ml.update(1, () => {});
    expect(moves[0]!.classList.contains('review-move-list__move--current')).toBe(true);
    expect(moves[1]!.classList.contains('review-move-list__move--current')).toBe(false);
  });

  it('shows a placeholder when there are no moves', () => {
    const ml = createMoveList([]);
    expect(ml.el.querySelector('.review-move-list__empty')?.textContent).toBe('No moves');
  });

  it('renders an optional suffix with its judgment class hook', () => {
    const ml = createMoveList([{ ply: 1, label: 'a-b', suffix: '+2.1', suffixClass: 'blunder' }]);
    const suffix = ml.el.querySelector('.review-move-list__suffix');
    expect(suffix?.textContent).toContain('+2.1');
    expect(suffix?.classList.contains('review-move--blunder')).toBe(true);
    expect(suffix?.parentElement?.className).toBe('review-move-list__move');
    expect(ml.el.querySelector('.review-move-list__san')?.textContent).toBe('a-b');
  });

  it('annotate adds per-ply glyphs after construction', () => {
    const ml = createMoveList([
      { ply: 1, label: 'a-b' },
      { ply: 2, label: 'c-d' },
      { ply: 3, label: 'e-f' },
    ]);
    ml.annotate(
      new Map([
        [2, { suffix: '??', suffixClass: 'blunder' }],
        [3, { suffix: '?!', suffixClass: 'inaccuracy' }],
      ]),
    );
    const moves = ml.el.querySelectorAll('.review-move-list__move');
    expect(moves[0]!.querySelector('.review-move-list__suffix')).toBeNull();
    const second = moves[1]!.querySelector('.review-move-list__suffix');
    expect(second?.textContent).toContain('??');
    expect(second?.classList.contains('review-move--blunder')).toBe(true);
    expect(moves[2]!.querySelector('.review-move-list__suffix')?.textContent).toContain('?!');
  });

  it('annotate is idempotent: re-annotating clears plies no longer present', () => {
    const ml = createMoveList([
      { ply: 1, label: 'a-b' },
      { ply: 2, label: 'c-d' },
    ]);
    ml.annotate(new Map([[1, { suffix: '??', suffixClass: 'blunder' }]]));
    expect(ml.el.querySelectorAll('.review-move-list__suffix').length).toBe(1);
    ml.annotate(new Map([[2, { suffix: '?', suffixClass: 'mistake' }]]));
    const suffixes = ml.el.querySelectorAll('.review-move-list__suffix');
    expect(suffixes.length).toBe(1);
    expect(
      ml.el
        .querySelectorAll('.review-move-list__move')[0]!
        .querySelector('.review-move-list__suffix'),
    ).toBeNull();
    expect(suffixes[0]!.textContent).toContain('?');
  });

  it('annotate fills a per-move eval and pairs it with the glyph', () => {
    const ml = createMoveList([
      { ply: 1, label: 'a-b' },
      { ply: 2, label: 'c-d' },
    ]);
    ml.annotate(
      new Map([
        [1, { eval: '+0.3' }],
        [2, { suffix: '??', suffixClass: 'blunder', eval: '-2.1' }],
      ]),
    );
    const moves = ml.el.querySelectorAll('.review-move-list__move');
    expect(moves[0]!.querySelector('.review-move-list__eval')?.textContent).toBe('+0.3');
    expect(moves[0]!.querySelector('.review-move-list__suffix')).toBeNull();
    const second = moves[1]!;
    expect(second.querySelector('.review-move-list__eval')?.textContent).toBe('-2.1');
    expect(second.querySelector('.review-move-list__suffix')?.textContent).toContain('??');
  });
});
