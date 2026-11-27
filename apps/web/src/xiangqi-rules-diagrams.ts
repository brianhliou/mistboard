// English rules examples for the xiangqi page. Every board comes from the
// starting position and a legal line; the test checks the moves and the claims
// made beside each figure.
import {
  applyStandardXiangqiMove,
  createInitialStandardXiangqiState,
  type StandardXiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  activeXiangqiPieceSet,
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqCoord,
  xqPieceDrawSize,
  xqPieceSize,
  xqPoint,
  xqSvg,
} from './articles/diagrams.js';
import {
  boardLastMoveMarkersSvg,
  boardLastMovePiece,
  boardLastMoveStyleAttr,
} from './board-lastmove.js';

export const XIANGQI_RULES_LINES = {
  horse: 'b1c3',
  cannon: 'b3b10',
} satisfies Record<string, string>;

export function xiangqiRulesMoves(line: string): XiangqiMove[] {
  if (!line.trim()) return [];
  return line
    .trim()
    .split(/\s+/)
    .map((token) => {
      const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
      if (!match) throw new Error(`Invalid xiangqi rules move: ${token}`);
      return { from: match[1] as XiangqiSquare, to: match[2] as XiangqiSquare };
    });
}

export function xiangqiRulesStates(line: string): StandardXiangqiGameState[] {
  const states = [createInitialStandardXiangqiState('xiangqi-rules-example')];
  for (const move of xiangqiRulesMoves(line)) {
    const before = states[states.length - 1];
    const after = applyStandardXiangqiMove(before, move);
    if (after === before) throw new Error(`Illegal xiangqi rules move: ${move.from}${move.to}`);
    states.push(after);
  }
  return states;
}

// The live boards' last-move marks, drawn under the pieces.
function lastMoveUnderlay(move: XiangqiMove, x: number): string {
  const at = (square: XiangqiSquare) => {
    const { file, rank } = xqCoord(square);
    return xqPoint(file, rank, 'red', x, 28);
  };
  const size = xqPieceSize();
  return `<g ${boardLastMoveStyleAttr(size)}>${boardLastMoveMarkersSvg(
    { from: at(move.from), to: at(move.to) },
    size,
    'under',
    boardLastMovePiece(xqPieceDrawSize(), activeXiangqiPieceSet),
  )}</g>`;
}

/** A move from the start: the board before it with the arrow, and after it. */
export function xiangqiRulesDiagram(
  example: keyof typeof XIANGQI_RULES_LINES,
  beforeLabel: string,
  afterLabel: string,
): () => string {
  return () => {
    const states = xiangqiRulesStates(XIANGQI_RULES_LINES[example]);
    const last = states[states.length - 1];
    const move = last.lastMove as XiangqiMove;
    return xqSvg(
      XQ_BOARD_W * 2 + 28,
      XQ_BOARD_H + 52,
      [
        xqBoardSvg({
          state: states[states.length - 2],
          x: 0,
          y: 0,
          label: beforeLabel,
          perspective: 'red',
          arrows: [move],
        }),
        xqBoardSvg({
          state: last,
          x: XQ_BOARD_W + 28,
          y: 0,
          label: afterLabel,
          perspective: 'red',
          underlay: lastMoveUnderlay(move, XQ_BOARD_W + 28),
        }),
      ].join(''),
    );
  };
}
