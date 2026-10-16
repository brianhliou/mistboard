// The general-hunt step-through for the MistyBanqi article: a window of a real
// game (banqi-engine-game.ts) replayed through the kernel, one frame per action.
// banqi-hunt-diagrams.test.ts replays every move it draws and asserts what the
// narratives and the article's paragraph say: the general reaches the corner, a
// red soldier walks b4-b3-a3-a2-a1, the general is left with no legal move, and
// it stays there until action 85, when it takes an advisor flipped up on b2,
// and the red general captures it on action 86.
import type { BanqiMove, BanqiPlayerView, BanqiSquare } from '@mistboard/game';
import { BANQI_GENERAL_HUNT_GAME } from '../banqi-engine-game.js';
import { BANQI_BOARD_H, BANQI_BOARD_W, banqiArrow, banqiBoardGrid, banqiPiecesFromView, banqiReplayViewAt, xqSvg } from './diagrams.js';

// Frame k is the board after HUNT_START_PLY + k actions.
export const HUNT_START_PLY = 44;
export const HUNT_LAST_PLY = 58;
export const HUNT_CAPTURE_PLY = 86;

function cell(square: BanqiSquare): { col: number; row: number } {
  return { col: square.charCodeAt(0) - 97, row: 4 - Number(square[1]) };
}

function frame(view: BanqiPlayerView, move: BanqiMove | null, id: string): string {
  return xqSvg(
    BANQI_BOARD_W,
    BANQI_BOARD_H,
    [
      banqiBoardGrid(0, 0),
      banqiPiecesFromView(view, 0, 0),
      move ? banqiArrow(cell(move.from), cell(move.to), 0, 0, id, 14) : '',
    ].join(''),
  );
}

export function huntMove(ply: number): BanqiMove {
  const token = BANQI_GENERAL_HUNT_GAME.moves.trim().split(/\s+/)[ply]!;
  return { from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare };
}

const HUNT_NARRATIVES = [
  'MistyBanqi has the black pieces. Its general is on b1, and the red soldier that will hunt it is on b4.',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  'The soldier holds a1. The general on b1 can’t move onto the face-down tiles on c1 and b2, and a general can’t capture a soldier, so it has no legal move. It stays stuck until move 85, when it takes a red advisor flipped up on b2, and the red general captures it on move 86.',
];

export const BANQI_HUNT_STEPS = HUNT_NARRATIVES.map((narrative, k) => {
  const move = k === 0 ? null : huntMove(HUNT_START_PLY + k - 1);
  return {
    svg: () =>
      frame(
        banqiReplayViewAt(BANQI_GENERAL_HUNT_GAME.deal, BANQI_GENERAL_HUNT_GAME.moves, HUNT_START_PLY + k),
        move,
        `bq-hunt-${k}`,
      ),
    move: move ? `${move.from}-${move.to}` : undefined,
    // The kernel's own move: the card glides it (a flip, from === to, does not).
    motion: move && move.from !== move.to ? { from: move.from, to: move.to } : undefined,
    narrative,
  };
});
