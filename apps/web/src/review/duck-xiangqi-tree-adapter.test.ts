// The two-phase ply, pinned. Everything here is about one claim: a Duck Xiangqi
// tree node is a WHOLE TURN, and the duck half is part of its identity.
import {
  createInitialDuckXiangqiState,
  type DuckXiangqiTurn,
  parseDuckXiangqiFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  duckXiangqiTreeAdapter,
  duckXiangqiTurnKey,
  duckXiangqiTurnLabel,
  parseDuckXiangqiTurnToken,
} from './duck-xiangqi-tree-adapter.js';
import { createGameTree, ROOT_PATH } from './game-tree.js';

const adapter = duckXiangqiTreeAdapter;

// Red chariot on e5 bearing up an empty e-file at the black general on e10: the
// one shape of turn that has no duck half, because the game ends on the capture.
const GENERAL_CAPTURE_FEN = '4k4/9/9/9/9/4R4/9/9/9/4K4 w - - 0 1 a1';

describe('duck xiangqi turn tokens', () => {
  it('keys a turn on the duck as well as the move', () => {
    const a: DuckXiangqiTurn = { from: 'b3', to: 'b7', duckTo: 'c4' };
    const b: DuckXiangqiTurn = { from: 'b3', to: 'b7', duckTo: 'd4' };
    expect(duckXiangqiTurnKey(a)).toBe('b3b7@c4');
    expect(duckXiangqiTurnKey(b)).toBe('b3b7@d4');
    expect(duckXiangqiTurnKey(a)).not.toBe(duckXiangqiTurnKey(b));
  });

  it('labels turns the way the live move list does', () => {
    // Same two spellings as duckTurnLabel in live-duck-xiangqi.ts: a review and a
    // live room must not disagree about how a turn is written.
    expect(duckXiangqiTurnLabel({ from: 'b3', to: 'b7', duckTo: 'c4' })).toBe('b3-b7@c4');
    expect(duckXiangqiTurnLabel({ from: 'e5', to: 'e10', duckTo: null })).toBe('e5xe10#');
  });

  it('reads back both the key and the display spelling', () => {
    const turn: DuckXiangqiTurn = { from: 'b3', to: 'b7', duckTo: 'c4' };
    expect(parseDuckXiangqiTurnToken(duckXiangqiTurnKey(turn))).toEqual(turn);
    expect(parseDuckXiangqiTurnToken(duckXiangqiTurnLabel(turn))).toEqual(turn);

    const capture: DuckXiangqiTurn = { from: 'e5', to: 'e10', duckTo: null };
    expect(parseDuckXiangqiTurnToken(duckXiangqiTurnKey(capture))).toEqual(capture);
    expect(parseDuckXiangqiTurnToken(duckXiangqiTurnLabel(capture))).toEqual(capture);
  });

  it('splits two-digit ranks on either side', () => {
    expect(parseDuckXiangqiTurnToken('a10b1@i10')).toEqual({
      from: 'a10',
      to: 'b1',
      duckTo: 'i10',
    });
    expect(parseDuckXiangqiTurnToken('a1b10@c5')).toEqual({ from: 'a1', to: 'b10', duckTo: 'c5' });
  });

  it('refuses tokens that are not turns', () => {
    expect(parseDuckXiangqiTurnToken('')).toBeNull();
    expect(parseDuckXiangqiTurnToken('b3')).toBeNull();
    expect(parseDuckXiangqiTurnToken('b3b7@z9')).toBeNull();
    expect(parseDuckXiangqiTurnToken('b3b11@c4')).toBeNull();
  });
});

describe('duck xiangqi tree adapter', () => {
  it('projects a single truth board for the side to move', () => {
    const views = adapter.project(adapter.initialTruth());
    expect(views).toHaveLength(1);
    expect(views[0]!.key).toBe('truth');
    expect(views[0]!.tier).toBe('primary');
    expect(views[0]!.view.legalPieceMoves.length).toBeGreaterThan(0);
  });

  it('makes two duck placements of one piece move SIBLING nodes, never a merge', () => {
    // This is the whole reason the duck is in the key. createGameTree.addMove
    // returns the EXISTING child on a key collision, so a from+to key would fold
    // these two turns into one node and hand the reader a board with the duck
    // somewhere they never put it - silently.
    const tree = createGameTree(adapter);
    const start = adapter.initialTruth();
    const move = start.board.b3 ? { from: 'b3' as const, to: 'b7' as const } : null;
    expect(move, 'the opening array has a cannon on b3').not.toBeNull();

    // c5 and d5 are both empty (rank 5 is the whole empty band above red).
    const first = tree.addMove(ROOT_PATH, { ...move!, duckTo: 'c5' });
    const second = tree.addMove(ROOT_PATH, { ...move!, duckTo: 'd5' });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(tree.root.children).toHaveLength(2);
    expect(tree.nodeAt(first!)?.truth.duck).toBe('c5');
    expect(tree.nodeAt(second!)?.truth.duck).toBe('d5');
  });

  it('refuses a turn that declines to move the duck', () => {
    const start = adapter.initialTruth();
    expect(adapter.isLegal(start, { from: 'b3', to: 'b7', duckTo: 'c5' })).toBe(true);
    // duckTo: null is legal ONLY on a turn that captures the general; anything
    // else with no duck half is "I decline to move the duck", which is not a turn.
    expect(adapter.isLegal(start, { from: 'b3', to: 'b7', duckTo: null })).toBe(false);
    // A duck point that is not empty is not a duck point.
    expect(adapter.isLegal(start, { from: 'b3', to: 'b7', duckTo: 'c4' })).toBe(false);
  });

  it('accepts the general capture, which is the one turn with no duck half', () => {
    const parsed = parseDuckXiangqiFen(GENERAL_CAPTURE_FEN, 'test');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const capture: DuckXiangqiTurn = { from: 'e5', to: 'e10', duckTo: null };
    expect(adapter.isLegal(parsed.state, capture)).toBe(true);
    // No '@' in the key, so it can never collide with a duck-carrying sibling.
    expect(adapter.moveKey(capture)).toBe('e5e10');

    const after = adapter.applyMove(parsed.state, capture);
    expect(after.status).toEqual({
      type: 'finished',
      winner: 'red',
      reason: 'general-captured',
    });
    // The duck stayed where it was: the game ended before it would have moved.
    expect(after.duck).toBe('a1');
  });

  it('replays a seeded mainline turn for turn', () => {
    const seed: DuckXiangqiTurn[] = [
      { from: 'b3', to: 'b7', duckTo: 'c5' },
      { from: 'c7', to: 'c6', duckTo: 'd5' },
    ];
    const tree = createGameTree(adapter, seed);
    expect(tree.mainlinePath()).toHaveLength(2);
    const tip = tree.nodeAt(tree.mainlinePath());
    expect(tip?.truth.duck).toBe('d5');
    expect(tip?.label).toBe('c7-c6@d5');
  });

  it('keeps the engine token identical to the node key', () => {
    // There is no Duck Xiangqi engine; the two are held equal so they cannot
    // drift apart before there is one.
    const turn: DuckXiangqiTurn = { from: 'b3', to: 'b7', duckTo: 'c4' };
    expect(adapter.toEngineUci(turn)).toBe(adapter.moveKey(turn));
  });

  it('starts from the kernel opening array with the duck off the board', () => {
    expect(adapter.initialTruth().board).toEqual(createInitialDuckXiangqiState('x').board);
    expect(adapter.initialTruth().duck).toBeUndefined();
  });
});
