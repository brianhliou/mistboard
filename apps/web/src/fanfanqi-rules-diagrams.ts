// Kernel positions, masked through getFFQBanqiPlayerView before drawing.
import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import './live-banqi-board.css';
import { renderFFQBanqiBoardSvg } from './live-ffq-banqi-render.js';

// A lone diagram matches the width of one board in a three-up row.
const FULL_WIDTH = 568;
export const SINGLE_WIDTH = 320;

function renderPosition(
  id: string,
  state: FFQBanqiState,
  from?: number,
  maxWidth = FULL_WIDTH,
): string {
  const seat = state.ply % 2 === 0 ? 'red' : 'black';
  return renderFFQBanqiBoardSvg(getFFQBanqiPlayerView(state, seat), {
    selectedSquare: from === undefined ? null : ffqBanqiSquare(from),
    pieceSet: activeXiangqiPieceSet,
  })
    .trim()
    .replace(
      '<svg ',
      `<svg data-fanfanqi-diagram="${id}" width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto" `,
    );
}

export function fanfanqiPositionDiagram(opts: { id: string; state: FFQBanqiState }): () => string {
  return () => renderPosition(opts.id, opts.state);
}

/** Every destination, including quiet steps, must agree with the kernel. */
export function fanfanqiMoveDiagram(opts: {
  id: string;
  state: FFQBanqiState;
  from: number;
  expect: readonly number[];
  maxWidth?: number;
}): () => string {
  return () => {
    const piece = opts.state.board[opts.from];
    if (!piece || piece.faceDown) {
      throw new Error(`Fanfanqi diagram ${opts.id}: nothing to move on ${opts.from}`);
    }
    const targets = getFFQBanqiLegalMoves(opts.state)
      .filter((m) => m.from === opts.from && m.from !== m.to)
      .map((m) => m.to)
      .sort((a, b) => a - b);
    const expected = [...opts.expect].sort((a, b) => a - b);
    if (targets.join(' ') !== expected.join(' ')) {
      throw new Error(
        `Fanfanqi diagram ${opts.id}: kernel allows ${opts.from} -> [${targets.join(' ')}], diagram expects [${expected.join(' ')}]`,
      );
    }
    return renderPosition(opts.id, opts.state, opts.from, opts.maxWidth);
  };
}

// Seed 2 puts both colors on the four fixed face-up squares. The next two
// positions really advance that same deal through Red's and Black's turns.
const setup = createInitialFFQBanqiState('fanfanqi-setup', 2);
const firstFlip = applyFFQBanqiMove(setup, { from: 9, to: 9 });
const replyFlip = applyFFQBanqiMove(firstFlip, { from: 22, to: 22 });

export const FANFANQI_SETUP = fanfanqiPositionDiagram({ id: 'setup', state: setup });
export const FANFANQI_FIRST_FLIP = fanfanqiPositionDiagram({
  id: 'first-flip',
  state: firstFlip,
});
export const FANFANQI_REPLY_FLIP = fanfanqiPositionDiagram({
  id: 'reply-flip',
  state: replyFlip,
});

// Sparse tactical positions use the same state fields and move generator as
// the room. Identities under backs are only kernel inputs, never SVG inputs.
function tacticalState(board: FFQBanqiState['board']): FFQBanqiState {
  return { ...createInitialFFQBanqiState('fanfanqi-tactic', 2), board };
}

const soldierBoard: FFQBanqiState['board'] = Array(32).fill(null);
soldierBoard[9] = { color: 'red', role: 'soldier', faceDown: false };
soldierBoard[10] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_SOLDIER_TAKES_GENERAL = fanfanqiMoveDiagram({
  id: 'soldier-takes-general',
  state: tacticalState(soldierBoard),
  from: 9,
  expect: [5, 8, 10, 13],
});

const generalBoard: FFQBanqiState['board'] = Array(32).fill(null);
generalBoard[9] = { color: 'red', role: 'general', faceDown: false };
generalBoard[10] = { color: 'black', role: 'soldier', faceDown: false };
export const FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER = fanfanqiMoveDiagram({
  id: 'general-cannot-take-soldier',
  state: tacticalState(generalBoard),
  from: 9,
  expect: [5, 8, 13],
});

// The walk-through: one screen then the target, a shot at a back, and a
// cannon with no shot, which also has no move at all.
const shotBoard: FFQBanqiState['board'] = Array(32).fill(null);
shotBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
shotBoard[13] = { color: 'black', role: 'soldier', faceDown: false };
shotBoard[21] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_CANNON_SHOT = fanfanqiMoveDiagram({
  id: 'cannon-shot',
  state: tacticalState(shotBoard),
  from: 9,
  expect: [21],
  maxWidth: SINGLE_WIDTH,
});

const gambleBoard: FFQBanqiState['board'] = Array(32).fill(null);
gambleBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
gambleBoard[10] = { color: 'red', role: 'soldier', faceDown: false };
gambleBoard[11] = { color: 'red', role: 'advisor', faceDown: true };
export const FANFANQI_CANNON_GAMBLE = fanfanqiMoveDiagram({
  id: 'cannon-gamble',
  state: tacticalState(gambleBoard),
  from: 9,
  expect: [11],
  maxWidth: SINGLE_WIDTH,
});

const stuckBoard: FFQBanqiState['board'] = Array(32).fill(null);
stuckBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
stuckBoard[11] = { color: 'black', role: 'horse', faceDown: false };
stuckBoard[13] = { color: 'black', role: 'chariot', faceDown: false };
stuckBoard[17] = { color: 'red', role: 'horse', faceDown: false };
stuckBoard[25] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_CANNON_NO_SHOT = fanfanqiMoveDiagram({
  id: 'cannon-no-shot',
  state: tacticalState(stuckBoard),
  from: 9,
  expect: [],
  maxWidth: SINGLE_WIDTH,
});
