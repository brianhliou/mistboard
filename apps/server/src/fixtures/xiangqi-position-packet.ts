import {
  applyStandardXiangqiMove, getStandardXiangqiLegalMoves, proveXiangqiMateGoalWithRetry,
  readXiangqiPositionOnlyPuzzle, XIANGQI_PUZZLES, XIANGQI_PUZZLE_ADMISSION_PROFILE,
  XIANGQI_PUZZLE_VERIFICATION_PROFILE, xiangqiMoveToPikafishUci,
  type XiangqiPuzzle,
} from '@mistboard/game';
import {
  XIANGQI_POSITION_PACKET_ENGINE, XIANGQI_POSITION_PACKET_VERSION, xiangqiPositionPuzzleHash,
  type XiangqiPositionPacket, type XiangqiPositionReceipt,
} from '../xiangqi-puzzle-position-packet.js';

export function positionPuzzleFixture(winning = false): XiangqiPuzzle {
  const seed = XIANGQI_PUZZLES.find(p => p.goal.type === 'checkmate' && p.solution.length === 3)!;
  const id = winning ? 'position-advantage-fixture' : 'position-mate-fixture';
  return readXiangqiPositionOnlyPuzzle({ id, variant: 'xiangqi', title: winning ? 'Red winning advantage' : seed.title,
    initial: { id, board: winning ? {
      d1: { color: 'red', role: 'general' }, a1: { color: 'red', role: 'chariot' },
      e10: { color: 'black', role: 'general' }, a5: { color: 'black', role: 'horse' }, g5: { color: 'black', role: 'cannon' },
    } : seed.initial.board,
      status: { type: 'playing', turn: winning ? 'red' : seed.initial.status.type === 'playing' ? seed.initial.status.turn : 'black' },
      moveNumber: 1, progressClock: 0, positionCounts: {}, progressClockLimit: 60 },
    solution: winning ? [{ from: 'a1', to: 'a5' }, { from: 'e10', to: 'f10' }, { from: 'a5', to: 'g5' }] : seed.solution,
    goal: winning ? { type: 'winning-advantage', winner: 'red', centipawns: 1000 } : seed.goal,
    themes: winning ? ['winning', 'winning-material'] : seed.themes,
    credit: { name: 'DPXQ', event: 'World Championship', red: 'Red Player', black: 'Black Player', url: 'http://www.dpxq.com/hldcg/search/view_m_1.html' },
  });
}

export function positionReceiptFixture(puzzle: XiangqiPuzzle): XiangqiPositionReceipt {
  const turns: XiangqiPositionReceipt['turns'] = [];
  let state = puzzle.initial;
  for (const [ply, move] of puzzle.solution.entries()) {
    if (ply % 2 === 0) {
      if (puzzle.goal.type === 'checkmate') {
        const terminal = ply === puzzle.solution.length - 1;
        turns.push({ solutionPly: ply, reason: terminal ? 'kernel-mate-goal-completed' : 'unique-within-mate-goal',
          mateGoalAttempts: terminal ? [] : proveXiangqiMateGoalWithRetry(state, (puzzle.solution.length - ply + 1) / 2).attempts, searches: [] });
      } else {
        const rest = getStandardXiangqiLegalMoves(state).filter(m => m.from !== move.from || m.to !== move.to).slice(0, 2);
        const lines = [move, ...rest].map((m, i) => ({ rank: i + 1, score: { cp: [1000, 0, -100][i]!, mate: null },
          pvUci: [xiangqiMoveToPikafishUci(m)], depth: 30 }));
        turns.push({ solutionPly: ply, reason: 'winning-chance-separation', mateGoalAttempts: [],
          searches: [{ nodes: 5_000_000, lines }, { nodes: 25_000_000, lines }] });
      }
    }
    state = applyStandardXiangqiMove(state, move);
  }
  return { puzzleHash: xiangqiPositionPuzzleHash(puzzle), turns };
}

export function positionPacketFixture(winning = false): XiangqiPositionPacket {
  const puzzle = positionPuzzleFixture(winning);
  return { version: XIANGQI_POSITION_PACKET_VERSION, source: 'dpxq', engine: XIANGQI_POSITION_PACKET_ENGINE,
    admissionProfile: XIANGQI_PUZZLE_ADMISSION_PROFILE, verificationProfile: XIANGQI_PUZZLE_VERIFICATION_PROFILE,
    items: [{ puzzle, verify: positionReceiptFixture(puzzle), audit: positionReceiptFixture(puzzle),
      review: { puzzleHash: xiangqiPositionPuzzleHash(puzzle), note: 'Reviewed fixture' } }] };
}
