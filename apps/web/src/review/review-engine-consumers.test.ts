import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAtomicXiangqiReview } from './atomic-xiangqi-review.js';
import { mountChessReview } from './chess-review.js';
import { mountCrazyhouseXiangqiReview } from './crazyhouse-xiangqi-review.js';
import { mountDuckXiangqiReview } from './duck-xiangqi-review.js';
import { mountFortressXiangqiReview } from './fortress-xiangqi-review.js';
import { mountTreeReview } from './tree-review.js';

vi.mock('./tree-review.js', () => ({ mountTreeReview: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('review engine consumers', () => {
  it.each([
    ['Fortress', mountFortressXiangqiReview, 'fortressxiangqi'],
    ['Atomic', mountAtomicXiangqiReview, 'atomicxiangqi'],
    ['Crazyhouse', mountCrazyhouseXiangqiReview, 'crazyhousexiangqi'],
    ['Chess', mountChessReview, 'chess'],
  ] as const)('keeps %s review on its existing FSF variant', (_label, mount, variant) => {
    mount(document.createElement('div'), {
      ariaLabel: 'Review',
      title: 'Review',
      summary: '',
      moves: [],
      analysis: null,
    });
    expect(mountTreeReview).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ engine: expect.objectContaining({ panelVariant: variant }) }),
      expect.any(Object),
    );
  });

  it('keeps Duck review engine-less', () => {
    mountDuckXiangqiReview(document.createElement('div'), {
      ariaLabel: 'Duck review',
      title: 'Duck review',
      summary: '',
      moves: [],
      analysis: null,
    });
    expect(mountTreeReview).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ engine: null }),
      expect.any(Object),
    );
  });
});
