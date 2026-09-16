// Authored study comments must reach VIEWERS, not just the owner's editor box:
// the current node's text renders in the under-board comment panel, commented
// moves carry a bubble marker in the move list, and right-arrow at a branch
// point opens the variation picker (up/down select, right descends).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinXiangqiNotation } from '../xiangqi-notation.js';
import type { SerializedTree } from './tree-serialize.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const ANNOTATED_TREE: SerializedTree = {
  version: 1,
  root: {
    annotations: { comments: [{ text: 'The intro: a hand-set composition.' }] },
    children: [
      {
        uci: 'h3e3',
        annotations: { comments: [{ text: 'The cannon centralises.' }] },
        children: [{ uci: 'h8e8', children: [] }],
      },
      {
        uci: 'b3e3',
        annotations: { comments: [{ text: 'The other cannon is passive.' }] },
        children: [],
      },
    ],
  },
};

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountXiangqiReview(root, {
    ariaLabel: 'Study',
    title: 'Study',
    summary: '',
    moves: [],
    initialTree: ANNOTATED_TREE,
    analysis: null,
  });
  return root;
}

function key(name: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
}

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

describe('viewer-visible study comments', () => {
  it('marks commented moves and shows the current node text under the board', () => {
    const root = mount();
    // Two commented MOVES carry bubble markers (the root has no move cell).
    expect(root.querySelectorAll('.review-move-list__comment-marker')).toHaveLength(2);
    // No inline comment text in the list itself.
    expect(root.querySelector('.move-tree__comment--user')).toBeNull();

    // Mount lands on the mainline tip (h8e8, uncommented): panel hidden.
    const panel = root.querySelector('.review-comment-panel');
    expect(panel?.classList.contains('review-comment-panel--empty')).toBe(true);

    // Click the commented move: its text appears in the panel.
    const cell = [...root.querySelectorAll('.review-move-list__move')].find((c) =>
      c.textContent?.includes('h3-e3'),
    ) as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel?.textContent).toBe('The cannon centralises.');
    expect(panel?.classList.contains('review-comment-panel--empty')).toBe(false);

    // Step back to the root: the intro shows.
    key('ArrowLeft');
    expect(panel?.textContent).toBe('The intro: a hand-set composition.');
    root.remove();
  });

  it('right-arrow at a branch point opens the picker; up/down select; right descends', () => {
    const root = mount();
    key('Home'); // to the root (two children: h3e3 mainline, b3e3)
    key('ArrowRight');
    const picker = root.querySelector('.review-var-picker');
    expect(picker).not.toBeNull();
    const rows = [...(picker?.querySelectorAll('.review-var-picker__row') ?? [])];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains('is-selected')).toBe(true);
    expect(rows[0]?.textContent).toContain('main line');
    expect(rows[1]?.textContent).toContain('The other cannon is passive.');

    key('ArrowDown');
    expect(
      root.querySelectorAll('.review-var-picker__row')[1]?.classList.contains('is-selected'),
    ).toBe(true);

    key('ArrowRight'); // descend the selected variation
    expect(root.querySelector('.review-var-picker')).toBeNull();
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('b3-e3');
    expect(root.querySelector('.review-comment-panel')?.textContent).toBe(
      'The other cannon is passive.',
    );
    root.remove();
  });

  it('left arrow and escape cancel the picker without moving', () => {
    const root = mount();
    key('Home');
    key('ArrowRight');
    expect(root.querySelector('.review-var-picker')).not.toBeNull();
    key('ArrowLeft');
    expect(root.querySelector('.review-var-picker')).toBeNull();
    // Still at the root: right reopens rather than stepping.
    key('ArrowRight');
    expect(root.querySelector('.review-var-picker')).not.toBeNull();
    key('Escape');
    expect(root.querySelector('.review-var-picker')).toBeNull();
    root.remove();
  });

  it('single-continuation nodes step forward without a picker', () => {
    const root = mount();
    key('Home');
    key('ArrowRight'); // picker at the branch point
    key('ArrowRight'); // descend mainline (h3e3, preselected)
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('h3-e3');
    key('ArrowRight'); // h3e3 has ONE child: plain step, no picker
    expect(root.querySelector('.review-var-picker')).toBeNull();
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('h8-e8');
    root.remove();
  });
});
