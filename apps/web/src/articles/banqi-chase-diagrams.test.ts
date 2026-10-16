import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  createInitialBanqiState,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  isBanqiLegalMove,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  BANQI_CHASE_BACK_AND_FORTH_STEPS,
  BANQI_CHASE_CYCLE_STEPS,
  BANQI_CHASE_HERD_END,
  BANQI_CHASE_HERD_START,
  BANQI_CHASE_THUMBNAIL,
  CHASE_CYCLE_MOVES,
  CHASE_DRAW_LAST_PLY,
  CHASE_DRAW_VIEW_PLY,
  CHASE_HERD_END_PLY,
  CHASE_HERD_ROUTE,
  CHASE_HERD_START_PLY,
  chaseCycleStart,
} from './banqi-chase-diagrams.js';
import { BANQI_CHASE_DRAW_GAME, BANQI_CHASE_HERD_GAME } from './content/banqi-chase-games.js';

function parse(moves: string): BanqiMove[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((token) => ({ from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare }));
}

// Every state from 0 to `upTo` actions, each move checked legal before it is applied
// (applyBanqiMove silently ignores an illegal one, which would let a figure drift).
function replay(game: { deal: BanqiDeal; moves: string }, upTo: number): BanqiGameState[] {
  const moves = parse(game.moves);
  let state = createInitialBanqiState('chase-test', game.deal);
  const states = [state];
  for (const move of moves.slice(0, upTo)) {
    expect(isBanqiLegalMove(state, move)).toBe(true);
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  return states;
}

function boardKey(state: BanqiGameState): string {
  return JSON.stringify(
    Object.entries(state.board)
      .filter(([, piece]) => piece)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// Could the piece on `from` capture on `to` if its side moved again now? The
// chaser's threat is a move it would have on its next turn, so ask the move
// generator with the turn handed back to it.
function threatens(state: BanqiGameState, from: BanqiSquare, to: BanqiSquare): boolean {
  const again: BanqiGameState = { ...state, ply: state.ply + 1 };
  return getBanqiLegalMoves(again).some((move) => move.from === from && move.to === to);
}

describe('banqi perpetual-chase diagrams', () => {
  it('back and forth: four plies return the board, and each advisor move attacks the chariot', () => {
    const states = replay(BANQI_CHASE_DRAW_GAME, CHASE_DRAW_VIEW_PLY + 4);
    const start = states[CHASE_DRAW_VIEW_PLY]!;
    expect(start.board.g1).toMatchObject({ color: 'black', role: 'chariot', faceDown: false });
    expect(start.board.g2).toMatchObject({ color: 'red', role: 'advisor', faceDown: false });
    // The chariot's only empty neighbour is f1; h1 and e1 hold black soldiers.
    expect(start.board.f1).toBeUndefined();
    expect(start.board.h1).toMatchObject({ color: 'black', role: 'soldier' });
    expect(start.board.e1).toMatchObject({ color: 'black', role: 'soldier' });
    // No tile left face down.
    expect(Object.values(start.board).some((piece) => piece?.faceDown)).toBe(false);
    const played = parse(BANQI_CHASE_DRAW_GAME.moves)
      .slice(CHASE_DRAW_VIEW_PLY, CHASE_DRAW_VIEW_PLY + 4)
      .map((move) => `${move.from}${move.to}`);
    expect(played).toEqual(['g1f1', 'g2f2', 'f1g1', 'f2g2']);
    expect(threatens(states[CHASE_DRAW_VIEW_PLY + 2]!, 'f2', 'f1')).toBe(true);
    expect(threatens(states[CHASE_DRAW_VIEW_PLY + 4]!, 'g2', 'g1')).toBe(true);
    expect(boardKey(states[CHASE_DRAW_VIEW_PLY + 4]!)).toBe(boardKey(start));
  });

  it('back and forth: each flee is the chariot’s only move, and the rule forbids exactly chase 4', () => {
    // Replayed under the current rules: the game's own moves stay legal up to the
    // shuttle, and only the bot's fourth chase (ply 87, f2g2) is taken away.
    const states = replay(BANQI_CHASE_DRAW_GAME, CHASE_DRAW_LAST_PLY - 1);
    const moves = parse(BANQI_CHASE_DRAW_GAME.moves);
    for (let ply = CHASE_DRAW_VIEW_PLY; ply < CHASE_DRAW_LAST_PLY; ply++) {
      const forbidden = getBanqiForbiddenChaseMoves(states[ply]!).map((m) => `${m.from}${m.to}`);
      expect(forbidden).toEqual(ply === CHASE_DRAW_LAST_PLY - 1 ? ['f2g2'] : []);
      if ((ply - CHASE_DRAW_VIEW_PLY) % 2 === 0) {
        const move = moves[ply]!;
        expect(getBanqiLegalMoves(states[ply]!).filter((m) => m.from === move.from)).toEqual([move]);
      }
    }
    expect(BANQI_CHASE_BACK_AND_FORTH_STEPS).toHaveLength(CHASE_DRAW_LAST_PLY - CHASE_DRAW_VIEW_PLY + 1);
  });

  it('four squares: the rule first forbids a move early in the third lap, an advisor chase', () => {
    let state = chaseCycleStart();
    for (let index = 0; index < 24; index++) {
      const move = CHASE_CYCLE_MOVES[index % 8]!;
      const forbidden = getBanqiForbiddenChaseMoves(state);
      if (index < 17) expect(forbidden).toEqual([]);
      else {
        expect(index).toBe(17);
        expect(index % 2).toBe(1); // an advisor (chaser) move
        expect(forbidden).toEqual([move]);
        break;
      }
      state = applyBanqiMove(state, move);
    }
    expect(BANQI_CHASE_CYCLE_STEPS).toHaveLength(CHASE_CYCLE_MOVES.length + 1);
  });

  it('four squares: eight plies return the board, each chariot move is forced, each advisor move attacks', () => {
    let state = chaseCycleStart();
    const start = boardKey(state);
    CHASE_CYCLE_MOVES.forEach((move, index) => {
      const chariotTurn = index % 2 === 0;
      if (chariotTurn) {
        // The chariot is attacked, and the square it goes to is its only move.
        expect(threatens(state, CHASE_CYCLE_MOVES[(index + 7) % 8]!.to, move.from)).toBe(true);
        expect(getBanqiLegalMoves(state).filter((m) => m.from === move.from)).toEqual([move]);
      }
      expect(isBanqiLegalMove(state, move)).toBe(true);
      state = applyBanqiMove(state, move);
      if (!chariotTurn) expect(threatens(state, move.to, CHASE_CYCLE_MOVES[index - 1]!.to)).toBe(true);
    });
    expect(state.status.type).toBe('playing');
    expect(boardKey(state)).toBe(start);
  });

  it('herding chase: no position repeats, every general move attacks the advisor, and ply 186 takes it', () => {
    const states = replay(BANQI_CHASE_HERD_GAME, CHASE_HERD_END_PLY + 1);
    const moves = parse(BANQI_CHASE_HERD_GAME.moves);
    const window = states.slice(CHASE_HERD_START_PLY, CHASE_HERD_END_PLY + 1).map(boardKey);
    expect(new Set(window).size).toBe(window.length);
    // The advisor's route is the squares the figure draws.
    const advisorSteps = [177, 179, 181, 183, 185].map((ply) => moves[ply]!);
    expect([advisorSteps[0]!.from, ...advisorSteps.map((move) => move.to)]).toEqual(CHASE_HERD_ROUTE);
    for (const ply of [176, 178, 180, 182, 184]) {
      const general = moves[ply]!;
      expect(states[ply]!.board[general.from]).toMatchObject({ color: 'black', role: 'general' });
      const target = moves[ply + 1]!.from;
      expect(states[ply + 1]!.board[target]).toMatchObject({ color: 'red', role: 'advisor' });
      expect(threatens(states[ply + 1]!, general.to, target)).toBe(true);
    }
    const take = moves[CHASE_HERD_END_PLY]!;
    expect(`${take.from}${take.to}`).toBe('f2f3');
    expect(states[CHASE_HERD_END_PLY]!.board.f2).toMatchObject({ color: 'black', role: 'advisor' });
    expect(states[CHASE_HERD_END_PLY + 1]!.captures.at(-1)).toEqual({ owner: 'red', role: 'advisor' });
  });

  it('renders every figure and the card', () => {
    for (const render of [
      ...BANQI_CHASE_BACK_AND_FORTH_STEPS.map((step) => step.svg),
      ...BANQI_CHASE_CYCLE_STEPS.map((step) => step.svg),
      BANQI_CHASE_HERD_START,
      BANQI_CHASE_HERD_END,
      BANQI_CHASE_THUMBNAIL,
    ]) {
      expect(render()).toMatch(/^<svg/);
    }
  });

  it("each step's glide is the kernel's move, keyed on the piece that makes it", () => {
    const slotPiece = (svg: string, square: string): string | null => {
      const host = document.createElement('div');
      host.innerHTML = svg;
      const slot = host.querySelector(`[data-piece-square="${square}"]`);
      if (!slot?.hasAttribute('data-piece-cx')) return null;
      // The piece without the position its outer element is drawn at.
      return slot.innerHTML.replace(/^(<svg)( [xy]="[^"]*")+/, '$1');
    };
    const steppers = [
      { steps: BANQI_CHASE_BACK_AND_FORTH_STEPS, moves: parse(BANQI_CHASE_DRAW_GAME.moves).slice(CHASE_DRAW_VIEW_PLY) },
      { steps: BANQI_CHASE_CYCLE_STEPS, moves: CHASE_CYCLE_MOVES },
    ];
    for (const { steps, moves } of steppers) {
      expect(steps[0]!.motion).toBeUndefined();
      steps.slice(1).forEach((step, i) => {
        const move = moves[i]!;
        expect(step.motion).toEqual({ from: move.from, to: move.to });
        expect(step.move).toBe(`${move.from}-${move.to}`);
        // The piece on the origin before is the piece on the landing after: the
        // slot the card glides holds the mover, not a victim or a stranger.
        const before = slotPiece(steps[i]!.svg(), move.from);
        expect(before).not.toBeNull();
        expect(slotPiece(step.svg(), move.to)).toBe(before);
      });
    }
  });
});
