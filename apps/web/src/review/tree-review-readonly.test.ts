// A read-only tree-review board says why it refuses input and offers the way
// out beside it. This pins the notice, its action, and the seat: a practice
// chapter's owner board once accepted a move, autosaved it, and ignored it,
// which put a stray move into a published exercise the day the surface shipped.
import { describe, expect, it, vi } from 'vitest';
import { mountFortressXiangqiReview } from './fortress-xiangqi-review.js';

function mount(readOnly: boolean, onPreview = () => {}): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountFortressXiangqiReview(root, {
    ariaLabel: 'Fortress review',
    title: 'Fortress review',
    summary: '',
    moves: [],
    analysis: null,
    ...(readOnly
      ? {
          boardReadOnly: {
            reason: 'Practice chapter: the board is played against the engine, not authored here.',
            action: { label: 'Preview exercise', onClick: onPreview },
          },
        }
      : {}),
  });
  return root;
}

describe('tree review boardReadOnly', () => {
  it('renders the reason and the action next to the board, and the action fires', () => {
    const onPreview = vi.fn();
    const root = mount(true, onPreview);
    const notice = root.querySelector('.review-board-readonly');
    expect(notice?.textContent).toContain('played against the engine');
    expect(root.querySelector('.review-board-wrap--read-only')).not.toBeNull();
    const button = notice?.querySelector<HTMLButtonElement>('.review-board-readonly__action');
    expect(button?.textContent).toBe('Preview exercise');
    button?.click();
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('renders no notice on an ordinary board', () => {
    const root = mount(false);
    expect(root.querySelector('.review-board-readonly')).toBeNull();
    expect(root.querySelector('.review-board-wrap--read-only')).toBeNull();
  });
});
