// Standard xiangqi as a lab variant: the control.
//
// Stock Fairy-Stockfish speaks xiangqi and the elephantops-backed kernel is
// the validated reference, so this adapter is what every command is proven
// against before it is trusted on a variant. It also carries one genuinely
// open rule, the progress clock, so the rules-as-data path (record → kernel
// option → ini stanza → fingerprint) is exercised by the control and not only
// described.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiLegalMove,
  parseStandardXiangqiFen,
  standardXiangqiEngineFen,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import type { LabKernel, LabStatus, LabVariant } from '../types.js';

const UCI_MOVE = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

export const STOCK_FSF = {
  env: 'MISTBOARD_FSF_PATH',
  fallbacks: ['~/projects/tools/fairy-stockfish/src/stockfish'],
  label: 'stock Fairy-Stockfish (largeboards build)',
} as const;

/** The xiangqi-family status shape (shared by the duck kernel) lifted into the lab's. */
export function xiangqiStatus(
  status:
    | { type: 'playing'; turn: 'red' | 'black' }
    | { type: 'finished'; winner: 'red' | 'black' | null; reason: string }
    | { type: 'aborted'; reason: string },
): LabStatus {
  if (status.type === 'playing') return { type: 'playing', turn: status.turn };
  if (status.type === 'finished')
    return { type: 'finished', winner: status.winner, reason: status.reason };
  return { type: 'finished', winner: null, reason: `aborted:${status.reason}` };
}

export const xiangqiVariant: LabVariant<XiangqiGameState, XiangqiMove> = {
  id: 'xiangqi',
  title: 'Xiangqi (control)',
  ruleSchema: {
    progressClock: {
      options: [60, 100],
      default: 60,
      blast: 'terminal',
      note: 'Plies without a capture before the game is drawn. 60 is the site rule; 100 is what stock FSF plays (nMoveRule 50).',
    },
  },
  create(rules) {
    const progressClockLimit = Number(rules.progressClock);
    const kernel: LabKernel<XiangqiGameState, XiangqiMove> = {
      initial: (id) => createInitialXiangqiState(id),
      status: (state) => xiangqiStatus(state.status),
      legalMoves: (state) => getStandardXiangqiLegalMoves(state),
      apply: (state, move) => applyStandardXiangqiMove(state, move, { progressClockLimit }),
      isLegal: (state, move) => isStandardXiangqiLegalMove(state, move),
      moveKey: (move) => `${move.from}${move.to}`,
      toUci: (move) => `${move.from}${move.to}`,
      fromUci: (_state, uci) => {
        const m = UCI_MOVE.exec(uci);
        return m ? { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare } : null;
      },
      fen: (state) => standardXiangqiEngineFen(state),
      parseFen: (fen, id) => {
        const parsed = parseStandardXiangqiFen(fen, id);
        return parsed.ok ? parsed.state : null;
      },
      ply: (state) => state.moveLog?.length ?? 0,
    };
    // FSF's nMoveRule counts full moves (chess's 50 is 100 plies), so the
    // kernel's ply limit halves on the way in.
    const ini = `[labxiangqi:xiangqi]\nnMoveRule = ${Math.round(progressClockLimit / 2)}\n`;
    return { kernel, engine: { variant: 'labxiangqi', ini, binary: STOCK_FSF } };
  },
  discriminatingPositions: [
    {
      name: 'flying general',
      why: 'No facing situation arises within two plies of the start array.',
      fen: '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    },
    {
      name: 'cannon screen',
      why: 'A cannon with exactly one screen and a target behind it; the start array has none in range.',
      fen: '5k3/9/9/9/4r4/9/4p4/9/4C4/3K5 w - - 0 1',
    },
    {
      name: 'horse leg',
      why: 'A horse whose leg point is occupied; every start-array horse has a free leg toward the centre.',
      fen: '5k3/9/9/9/9/9/9/9/3pN4/3K5 w - - 0 1',
    },
  ],
};
