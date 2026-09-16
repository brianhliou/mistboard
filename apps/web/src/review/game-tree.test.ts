// Proves the variant-agnostic GameTree spine against the REAL standard-xiangqi
// kernel (via xiangqiTreeAdapter) — seed, branch, merge, navigate, promote,
// delete, project — before any UI rides it. Moves are picked from the kernel's
// own legal-move generator so the test never hand-encodes coordinates.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  type XiangqiMove,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinXiangqiNotation } from '../xiangqi-notation.js';
import { createGameTree, ROOT_PATH } from './game-tree.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

// A real 3-ply legal mainline, plus a second distinct legal first move for the
// branch tests — all drawn from the kernel so they are guaranteed legal.
function realMoves(): { mainline: XiangqiMove[]; altFirst: XiangqiMove; illegal: XiangqiMove } {
  const s0 = createInitialXiangqiState('fixture');
  const first = getStandardXiangqiLegalMoves(s0);
  const m1 = first[0]!;
  const altFirst = first[1]!;
  const s1 = applyStandardXiangqiMove(s0, m1);
  const m2 = getStandardXiangqiLegalMoves(s1)[0]!;
  const s2 = applyStandardXiangqiMove(s1, m2);
  const m3 = getStandardXiangqiLegalMoves(s2)[0]!;
  // A stationary move is never in the legal set → a reliable illegal move.
  const illegal: XiangqiMove = { from: m1.from, to: m1.from };
  return { mainline: [m1, m2, m3], altFirst, illegal };
}

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

describe('createGameTree (xiangqi adapter)', () => {
  it('starts empty at the root', () => {
    const tree = createGameTree(xiangqiTreeAdapter);
    expect(tree.root.ply).toBe(0);
    expect(tree.root.move).toBeNull();
    expect(tree.mainlinePath()).toEqual(ROOT_PATH);
    expect(tree.first()).toEqual(ROOT_PATH);
    expect(tree.last()).toEqual(ROOT_PATH);
  });

  it('seeds a mainline from a move list', () => {
    const { mainline } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    const last = tree.last();
    expect(last).toHaveLength(3);
    expect(tree.mainlinePath()).toEqual(last);
    const tip = tree.nodeAt(last);
    expect(tip?.ply).toBe(3);
    expect(tip?.label).toBe(`${mainline[2]!.from}-${mainline[2]!.to}`);
  });

  it('projects a single truth view for an open variant', () => {
    const { mainline } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    const views = tree.project(tree.root);
    expect(views).toHaveLength(1);
    expect(views[0]!.key).toBe('truth');
    expect(views[0]!.tier).toBe('primary');
  });

  it('branches a variation and merges a repeated move', () => {
    const { mainline, altFirst } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);

    // A different legal first move at the root creates a second child (variation).
    const branch = tree.addMove(ROOT_PATH, altFirst);
    expect(branch).toHaveLength(1);
    expect(tree.root.children).toHaveLength(2);

    // Re-playing the SAME first move merges into the existing mainline child.
    const merged = tree.addMove(ROOT_PATH, mainline[0]!);
    expect(merged).toEqual([tree.root.children[0]!.id]);
    expect(tree.root.children).toHaveLength(2); // no duplicate created
  });

  it('rejects an illegal move', () => {
    const { illegal } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter);
    expect(tree.addMove(ROOT_PATH, illegal)).toBeNull();
    expect(tree.root.children).toHaveLength(0);
  });

  it('truncates a seed at the first illegal move', () => {
    const { mainline, illegal } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, [mainline[0]!, illegal, mainline[1]!]);
    // Only the first legal move survives; the illegal one stops reconstruction.
    expect(tree.last()).toHaveLength(1);
  });

  it('steps forward and back along the mainline', () => {
    const { mainline } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    const one = tree.stepForward(ROOT_PATH);
    expect(one).toHaveLength(1);
    const back = tree.stepBack(one);
    expect(back).toEqual(ROOT_PATH);
    // Stepping back from the root is clamped.
    expect(tree.stepBack(ROOT_PATH)).toEqual(ROOT_PATH);
  });

  it('promotes a variation to the mainline and deletes a branch', () => {
    const { mainline, altFirst } = realMoves();
    const tree = createGameTree(xiangqiTreeAdapter, mainline);
    const branch = tree.addMove(ROOT_PATH, altFirst)!;
    const branchId = branch[0]!;

    tree.promoteToMainline(branch);
    expect(tree.root.children[0]!.id).toBe(branchId);
    expect(tree.mainlinePath()).toEqual(branch); // promoted branch is now the main line

    tree.deleteAt(branch);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children.some((child) => child.id === branchId)).toBe(false);
  });

  it('never deletes the root', () => {
    const tree = createGameTree(xiangqiTreeAdapter);
    tree.deleteAt(ROOT_PATH);
    expect(tree.root).toBeDefined();
    expect(tree.root.ply).toBe(0);
  });
});
