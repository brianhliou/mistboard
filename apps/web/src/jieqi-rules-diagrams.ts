// English rules examples. Every board comes from a valid deal and a legal line;
// the test checks the moves and the claims made beside each figure.
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPublicView,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  jieqiHomeSquares,
  type XiangqiPlayerView,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqStaticView,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { JIEQI_SAMPLE_GAME } from './jieqi-sample-game.js';

// Move an elephant into a soldier point without changing either side's set.
const elephantDeal: JieqiDeal = {
  red: [...JIEQI_SAMPLE_GAME.deal.red],
  black: [...JIEQI_SAMPLE_GAME.deal.black],
};
const homes = jieqiHomeSquares('red');
const a4 = homes.indexOf('a4');
const c1 = homes.indexOf('c1');
[elephantDeal.red[a4], elephantDeal.red[c1]] = [elephantDeal.red[c1], elephantDeal.red[a4]];

export const JIEQI_RULES_LINES = {
  start: { deal: JIEQI_SAMPLE_GAME.deal, moves: '' },
  horse: { deal: JIEQI_SAMPLE_GAME.deal, moves: 'b1c3' },
  advisor: { deal: JIEQI_SAMPLE_GAME.deal, moves: 'b1c3 i7i6 c3d4' },
  cannon: { deal: JIEQI_SAMPLE_GAME.deal, moves: 'b3b10' },
  soldier: { deal: JIEQI_SAMPLE_GAME.deal, moves: 'b3b10 i7i6 b10c10' },
  elephant: { deal: elephantDeal, moves: 'a4a5 i7i6 a5c7' },
  corner: { deal: JIEQI_SAMPLE_GAME.deal, moves: 'a1a3' },
} satisfies Record<string, { deal: JieqiDeal; moves: string }>;

export function jieqiRulesMoves(line: string): JieqiMove[] {
  if (!line.trim()) return [];
  return line
    .trim()
    .split(/\s+/)
    .map((token) => {
      const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
      if (!match) throw new Error(`Invalid Jieqi rules move: ${token}`);
      return { from: match[1] as JieqiSquare, to: match[2] as JieqiSquare };
    });
}

export function jieqiRulesStates(deal: JieqiDeal, line: string): JieqiGameState[] {
  const states = [createInitialJieqiState('jieqi-rules-example', deal)];
  for (const move of jieqiRulesMoves(line)) {
    const before = states[states.length - 1];
    const after = applyJieqiMove(before, move);
    if (after === before) throw new Error(`Illegal Jieqi rules move: ${move.from}${move.to}`);
    states.push(after);
  }
  return states;
}

// The existing article diagram toolkit draws the public board. A hidden role
// never enters its drawing state, even as an unused value behind a piece back.
function panel(state: JieqiGameState, label: string, x: number, move?: JieqiMove): string {
  const board: XiangqiPlayerView['board'] = {};
  for (const [point, piece] of Object.entries(getJieqiPublicView(state).board)) {
    if (!piece) continue;
    board[point as JieqiSquare] = {
      piece: { color: piece.color, role: piece.faceDown ? 'soldier' : piece.role },
      shrouded: piece.faceDown,
    };
  }
  const drawingBoard = Object.fromEntries(
    Object.entries(board).map(([point, entry]) => [point, entry.piece]),
  );
  return xqBoardSvg({
    state: xqVisionDemoState(`jieqi-rules-${label}`, drawingBoard),
    view: xqStaticView(`jieqi-rules-${label}`, board),
    x,
    y: 0,
    label,
    perspective: 'red',
    shroudedStyle: 'back',
    arrows: move ? [move] : [],
  });
}

export function jieqiRulesDiagram(
  example: keyof typeof JIEQI_RULES_LINES,
  beforeLabel: string,
  afterLabel?: string,
): () => string {
  return () => {
    const { deal, moves } = JIEQI_RULES_LINES[example];
    const states = jieqiRulesStates(deal, moves);
    const last = states[states.length - 1];
    const move = last.lastMove;
    if (afterLabel) {
      return xqSvg(
        XQ_BOARD_W * 2 + 28,
        XQ_BOARD_H + 52,
        [
          panel(states[states.length - 2], beforeLabel, 0, move),
          panel(last, afterLabel, XQ_BOARD_W + 28, move),
        ].join(''),
      );
    }
    return xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H + 52,
      panel(last, beforeLabel, 0, move),
      example === 'start' ? 'xq-article-svg--hero' : '',
    );
  };
}
