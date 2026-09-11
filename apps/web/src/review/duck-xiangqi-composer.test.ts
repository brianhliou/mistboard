// The two-phase gesture on the REVIEW board, driven through the real DOM.
//
// This is the test that decides whether the composer is wired or merely
// compiles. A tree adapter can be perfect and the board still unable to enter a
// move, because the shell's onMove sink takes a WHOLE turn and the second half
// of that turn is collected by the board itself. Nothing below reaches into the
// factory: it clicks points and reads the tree back through the mount handle.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  getDuckXiangqiLegalPieceMoves,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { mountDuckXiangqiReview } from './duck-xiangqi-review.js';
import type { SerializedNode, SerializedTree } from './tree-serialize.js';

const START = createInitialDuckXiangqiState('test');
// The chariot on a1 stepping to a2: the first legal piece move of the opening
// array, taken from the kernel rather than written down, so this test cannot
// disagree with the rules.
const FIRST_MOVE = getDuckXiangqiLegalPieceMoves(START)[0]!;
// An empty point after that move, so a legal duck destination.
const DUCK_TO = 'a5';
// Black's first legal piece move in the position that ply reaches. Taken from
// the kernel too, so the navigation test cannot drift out of turn.
const REPLY = getDuckXiangqiLegalPieceMoves(
  applyDuckXiangqiTurn(START, { ...FIRST_MOVE, duckTo: DUCK_TO }),
)[0]!;

function mount(): {
  root: HTMLElement;
  board: HTMLElement;
  serialize: () => SerializedTree;
} {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountDuckXiangqiReview(root, {
    ariaLabel: 'Duck review',
    title: 'Duck review',
    summary: '',
    moves: [],
    analysis: null,
  });
  const board = root.querySelector<HTMLElement>('.duck-xiangqi-live-board');
  if (!board) throw new Error('no duck board host');
  return { root, board, serialize: () => handle.serialize() };
}

function clickPoint(board: HTMLElement, square: string): void {
  const target = board.querySelector(`[data-square="${square}"]`);
  if (!target) throw new Error(`no click target for ${square}`);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** The node tokens down the mainline of a serialized tree. */
function mainlineUcis(tree: SerializedTree): string[] {
  const out: string[] = [];
  let node: SerializedNode = tree.root;
  while (node.children.length > 0) {
    const child = node.children[0]!;
    if (child.uci) out.push(child.uci);
    node = child;
  }
  return out;
}

describe('duck xiangqi review composer', () => {
  it('takes two clicks to enter one ply, and sends nothing after the first', () => {
    const { root, board, serialize } = mount();

    clickPoint(board, FIRST_MOVE.from);
    // Phase one draws the board's own move hints, not the duck's mark.
    expect(board.querySelectorAll('.xq-live-hint-dot').length).toBeGreaterThan(0);
    expect(board.querySelectorAll('.dkx-target--duck')).toHaveLength(0);

    clickPoint(board, FIRST_MOVE.to);
    // The piece move alone must NOT reach the tree: a turn is not a turn until
    // the duck is placed.
    expect(mainlineUcis(serialize())).toEqual([]);
    // ...and the board is now asking for the duck, with its own distinct mark.
    expect(board.querySelectorAll('.dkx-target--duck').length).toBeGreaterThan(0);
    // The piece shows at its destination while the duck is pending, so the two
    // steps read as one move rather than as lag.
    expect(board.querySelector(`[data-piece-square="${FIRST_MOVE.to}"]`)).not.toBeNull();
    expect(board.querySelector(`[data-piece-square="${FIRST_MOVE.from}"]`)).toBeNull();

    root.remove();
  });

  it('branches the tree on the second click, with the duck in the node id', () => {
    const { root, board, serialize } = mount();

    clickPoint(board, FIRST_MOVE.from);
    clickPoint(board, FIRST_MOVE.to);
    clickPoint(board, DUCK_TO);

    expect(mainlineUcis(serialize())).toEqual([`${FIRST_MOVE.from}${FIRST_MOVE.to}@${DUCK_TO}`]);
    expect(board.querySelector(`[data-duck-square="${DUCK_TO}"]`)).not.toBeNull();

    root.remove();
  });

  it('abandons a half-made turn rather than completing it from a stale position', () => {
    const { root, board, serialize } = mount();

    clickPoint(board, FIRST_MOVE.from);
    clickPoint(board, FIRST_MOVE.to);
    expect(board.querySelectorAll('.dkx-target--duck').length).toBeGreaterThan(0);

    // A phase-two click on a NON-target (the point the piece just landed on is
    // occupied, so the duck cannot go there) cancels the whole turn. Free:
    // nothing reached the tree, so there is no half-move to unwind.
    clickPoint(board, FIRST_MOVE.to);
    expect(mainlineUcis(serialize())).toEqual([]);
    expect(board.querySelectorAll('.dkx-target--duck')).toHaveLength(0);
    // The optimistic board rolled back: the piece is where it started.
    expect(board.querySelector(`[data-piece-square="${FIRST_MOVE.from}"]`)).not.toBeNull();

    root.remove();
  });

  it('drops a pending duck when the reader navigates away from the position', () => {
    const { root, board, serialize } = mount();

    // Seed a real ply, step back to the root, then start a half-turn and jump.
    clickPoint(board, FIRST_MOVE.from);
    clickPoint(board, FIRST_MOVE.to);
    clickPoint(board, DUCK_TO);
    expect(mainlineUcis(serialize())).toHaveLength(1);

    // Now half-make BLACK's reply and navigate before placing the duck.
    clickPoint(board, REPLY.from);
    clickPoint(board, REPLY.to);
    expect(board.querySelectorAll('.dkx-target--duck').length).toBeGreaterThan(0);

    // Left arrow steps the review back a node; the pending piece move was chosen
    // from a position that is no longer on screen and must not survive it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(board.querySelectorAll('.dkx-target--duck')).toHaveLength(0);
    expect(mainlineUcis(serialize())).toHaveLength(1);

    root.remove();
  });
});
