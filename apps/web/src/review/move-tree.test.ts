// DOM coverage for the branching move-tree renderer: mainline cells, an inlined
// variation, current-node highlight, and the jump callback. Uses the real
// xiangqi adapter so the tree is built from a legal game.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinXiangqiNotation } from '../xiangqi-notation.js';
import { createGameTree, ROOT_PATH, type TreePath } from './game-tree.js';
import { createMoveTree, pathKey } from './move-tree.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

function seededTree() {
  const s0 = createInitialXiangqiState('fixture');
  const first = getStandardXiangqiLegalMoves(s0);
  const m1 = first[0]!;
  const altFirst = first[1]!;
  const s1 = applyStandardXiangqiMove(s0, m1);
  const m2 = getStandardXiangqiLegalMoves(s1)[0]!;
  const tree = createGameTree(xiangqiTreeAdapter, [m1, m2]);
  // Add an alternative first move → a variation off the root.
  tree.addMove(ROOT_PATH, altFirst);
  return { tree, m1, m2, altFirst };
}

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

describe('createMoveTree', () => {
  it('renders mainline cells and an inlined variation', () => {
    const { tree, m1, m2, altFirst } = seededTree();
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    const text = moveTree.el.textContent ?? '';
    expect(text).toContain(`${m1.from}-${m1.to}`);
    expect(text).toContain(`${m2.from}-${m2.to}`);
    // The alternative first move renders as a variation block, in parentheses.
    expect(moveTree.el.querySelector('.move-tree__variation')).not.toBeNull();
    expect(text).toContain(`${altFirst.from}-${altFirst.to}`);
  });

  it('interleaves a root variation right after move 1, splitting the two-ply row', () => {
    // seededTree: mainline [m1 (white 1), m2 (black 1)] + altFirst as an
    // alternative to move 1 (a root variation). The variation must render BETWEEN
    // move 1 and black's reply — not dumped after the whole mainline — and move 1's
    // row splits so black's reply resumes on its own "1…" row.
    const { tree, m2, altFirst } = seededTree();
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    const rows = [...(moveTree.el.querySelector('.review-move-list__rows')?.children ?? [])];

    // [0] mainline row for move 1, [1] the variation breakout, [2] black's "1…" row.
    expect(rows[0]?.classList.contains('review-move-list__row')).toBe(true);
    expect(rows[1]?.classList.contains('move-tree__variation')).toBe(true);
    expect(rows[1]?.textContent).toContain(`${altFirst.from}-${altFirst.to}`);
    // The variation is NOT the last element (it is not dumped at the bottom).
    expect(rows.indexOf(rows[1]!)).toBeLessThan(rows.length - 1);
    // Black's reply resumes on a later row, marked as a continuation ("…").
    const blackRow = rows.find(
      (r) =>
        r.classList.contains('review-move-list__row') &&
        r.textContent?.includes(`${m2.from}-${m2.to}`),
    );
    expect(blackRow).toBeTruthy();
    expect(blackRow?.querySelector('.review-move-list__number')?.textContent).toContain('…');
  });

  it('highlights the current node and fires onJump with its path', () => {
    const { tree, m1 } = seededTree();
    let jumped: TreePath | null = null;
    const moveTree = createMoveTree(tree, { onJump: (path) => (jumped = path) });

    const firstMovePath: TreePath = [tree.root.children[0]!.id];
    moveTree.setCurrent(firstMovePath);
    const current = moveTree.el.querySelector('.review-move-list__move--current');
    expect(current?.textContent).toContain(`${m1.from}-${m1.to}`);

    (current as HTMLButtonElement).click();
    expect(jumped).not.toBeNull();
    expect(pathKey(jumped!)).toBe(pathKey(firstMovePath));
  });

  it('offers promote/delete on a right-clicked move', () => {
    const { tree, altFirst } = seededTree();
    let promoted: TreePath | null = null;
    const moveTree = createMoveTree(tree, {
      onJump: () => {},
      onPromote: (path) => (promoted = path),
      onDelete: () => {},
    });
    const label = `${altFirst.from}-${altFirst.to}`;
    const cell = [...moveTree.el.querySelectorAll('.review-move-list__move')].find((c) =>
      c.textContent?.includes(label),
    );
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const menu = document.querySelector('.move-tree__menu');
    expect(menu).not.toBeNull();
    const promote = [...menu!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Promote to mainline',
    );
    promote?.click();
    expect(promoted).not.toBeNull();
    expect(pathKey(promoted!)).toBe(pathKey(tree.pathTo(tree.root.children[1]!)));
    document.querySelector('.move-tree__menu')?.remove();
  });

  it('leaves a bare analysis tree visually empty', () => {
    const tree = createGameTree(xiangqiTreeAdapter);
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    expect(moveTree.el.querySelector('.review-move-list__rows')?.childElementCount).toBe(0);
    expect(moveTree.el.textContent).not.toContain('No moves');
  });

  it('keeps the eval on a chance ply that also carries a luck badge', () => {
    // The three slots read orthogonally: glyph = decision quality, luck = the reveal's variance,
    // eval = the objective value of the position that resulted. A reveal shows all three. Pin
    // against the old rule (eval suppressed wherever a luck badge rendered), which also made eval
    // visibility track auth state, since the decomposition only runs for signed-in viewers.
    const { tree, m1 } = seededTree();
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    const key = pathKey([tree.root.children[0]!.id]);
    moveTree.annotate(
      new Map([[key, { eval: '+2.0', luck: '🎲 +11%', luckTone: 'lucky' as const }]]),
    );
    const cell = [...moveTree.el.querySelectorAll('.review-move-list__move')].find((c) =>
      c.textContent?.includes(`${m1.from}-${m1.to}`),
    );
    expect(cell?.querySelector('.review-move-list__luck')?.textContent).toBe('🎲 +11%');
    expect(cell?.querySelector('.review-move-list__eval')?.textContent).toBe('+2.0');
  });

  it('renders an annotated advice comment row before the move variations', () => {
    const { tree, m1 } = seededTree();
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    const key = pathKey([tree.root.children[0]!.id]);
    moveTree.annotate(
      new Map([
        [
          key,
          {
            suffix: '??',
            suffixClass: 'blunder',
            comment: 'Blunder. h3-e3 was best.',
            commentClass: 'blunder',
          },
        ],
      ]),
    );
    const rows = [...(moveTree.el.querySelector('.review-move-list__rows')?.children ?? [])];
    const comment = moveTree.el.querySelector('.move-tree__comment');
    expect(comment?.textContent).toBe('Blunder. h3-e3 was best.');
    expect(comment?.classList.contains('move-tree__comment--blunder')).toBe(true);
    // Comment sits right after the judged move's row and BEFORE its variation
    // (seededTree attaches a root variation to move 1).
    const commentIndex = rows.findIndex((r) => r.classList.contains('move-tree__comment'));
    const variationIndex = rows.findIndex((r) => r.classList.contains('move-tree__variation'));
    expect(commentIndex).toBeGreaterThan(0);
    expect(variationIndex).toBe(commentIndex + 1);
    // The judged move's own row still precedes both.
    expect(rows[commentIndex - 1]?.textContent).toContain(`${m1.from}-${m1.to}`);
  });

  it('renders a root comment as an intro row above move 1', () => {
    const { tree, m1 } = seededTree();
    const moveTree = createMoveTree(tree, { onJump: () => {} });
    moveTree.annotate(
      new Map([['', { comment: 'The famous composition, red to move.', commentClass: 'user' }]]),
    );
    const rows = [...(moveTree.el.querySelector('.review-move-list__rows')?.children ?? [])];
    expect(rows[0]?.classList.contains('move-tree__comment')).toBe(true);
    expect(rows[0]?.classList.contains('move-tree__comment--user')).toBe(true);
    expect(rows[0]?.textContent).toBe('The famous composition, red to move.');
    expect(rows[1]?.textContent).toContain(`${m1.from}-${m1.to}`);
  });

  it('appends a terminal result block when a result is supplied', () => {
    const { tree } = seededTree();
    const moveTree = createMoveTree(tree, {
      onJump: () => {},
      result: { score: '0-1', label: 'Black wins by Checkmate' },
    });
    const rows = moveTree.el.querySelector('.review-move-list__rows');
    const result = rows?.querySelector('.move-tree__result');
    expect(result).not.toBeNull();
    expect(result?.querySelector('.move-tree__result-score')?.textContent).toBe('0-1');
    expect(result?.querySelector('.move-tree__result-label')?.textContent).toBe(
      'Black wins by Checkmate',
    );
    // It is the LAST element of the scrollable list.
    expect(rows?.lastElementChild).toBe(result);
  });
});
