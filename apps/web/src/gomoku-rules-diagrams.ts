import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  type GomokuRoomState,
  type GomokuSquare,
  getGomokuPlayerView,
} from '@mistboard/game';
import { gomokuBoardSvg } from './gomoku-board.js';
// The board's classes also live in gomoku-board.css; the prerender's stylesheet
// check fails a baked /rules/gomoku page that does not link it.
import './gomoku-board.css';

// Use the live board geometry, with its paint inline so article prerenders
// and thumbnails do not depend on the live room's lazy CSS chunk. Educational
// figures have one image role and no per-point controls or keyboard stops.
export function gomokuRulesBoard(state: GomokuRoomState): string {
  const paint: Record<string, string> = {
    'gomoku-svg': 'width="384" style="display:block;width:min(100%, 384px);height:auto" role="img"',
    'gomoku-wood': 'fill="#dcb975"',
    'gomoku-grid': 'fill="none" stroke="#6e542e" stroke-width="1"',
    'gomoku-star': 'fill="#6e542e"',
    'gomoku-coordinate':
      'fill="#503e24" font-family="system-ui" font-size="11" text-anchor="middle"',
    'gomoku-stone gomoku-stone--black': 'fill="#222" stroke="#080808" stroke-width="1.2"',
    'gomoku-stone gomoku-stone--white': 'fill="#faf7ee" stroke="#8a806d" stroke-width="1.2"',
    'gomoku-last': 'fill="#d65330"',
    'gomoku-winning': 'fill="none" stroke="#168344" stroke-width="4"',
  };
  return gomokuBoardSvg(getGomokuPlayerView(state, 'black', true), false)
    .replace(/<rect class="gomoku-hit"[^>]*\/>/g, '')
    .replace(/class="([^"]+)"/g, (attribute, name: string) => `${attribute} ${paint[name] ?? ''}`)
    .replace('><rect', '><title>Gomoku board</title><rect');
}

function beforeWin(
  black: readonly GomokuSquare[],
  white: readonly GomokuSquare[],
): GomokuRoomState {
  return createGomokuRoomState('gomoku-rules', {
    stones: [
      ...black.map((square) => ({ square, color: 'black' as const })),
      ...white.map((square) => ({ square, color: 'white' as const })),
    ],
    turn: 'black',
  });
}

const white: GomokuSquare[] = ['f6', 'g6', 'h10', 'j9'];
export const GOMOKU_RULES_EXAMPLES = [
  { before: beforeWin(['e8', 'f8', 'g8', 'h8'], white), to: 'i8' },
] satisfies { before: GomokuRoomState; to: GomokuSquare }[];

export const GOMOKU_OPENING = () =>
  gomokuRulesBoard(createGomokuRoomState('gomoku-rules', GOMOKU_OPENINGS[0]));
export const GOMOKU_PLACEMENT = () =>
  gomokuRulesBoard(applyGomokuRoomMove(createGomokuRoomState('gomoku-rules'), { to: 'h8' }));
export const GOMOKU_WINNING_BOARD = () =>
  gomokuRulesBoard(
    applyGomokuRoomMove(GOMOKU_RULES_EXAMPLES[0].before, { to: GOMOKU_RULES_EXAMPLES[0].to }),
  );
