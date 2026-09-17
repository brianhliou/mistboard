// Sound policy for standard Xiangqi.
//
// Standard Xiangqi is OPEN INFORMATION: the view that reaches the client carries
// the full truth board (plain pieces, no shrouding), so the classifier can read
// any piece's identity. The own-move classifier reads the mover's role for the
// cannon boom + the target's role for the general capture; the opponent
// classifier diffs the on-board piece count. The general is the king-equivalent.

import type {
  XiangqiColor,
  XiangqiGameStatus,
  XiangqiMove,
  XiangqiPiece,
  XiangqiSquare,
} from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

// Mirrors the client's open-information wire view without coupling to it: every
// occupied square carries a plain piece.
export type XiangqiSoundView = {
  board: Partial<Record<XiangqiSquare, XiangqiPiece>>;
  perspective: XiangqiColor;
  status: XiangqiGameStatus;
  moveNumber: number;
};

export type XiangqiSeatOrSpectator = XiangqiColor | 'spectator' | null;

let lastView: XiangqiSoundView | null = null;
let lastTerminalKey: string | null = null;

export function resetXiangqiSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

export function soundForOwnXiangqiMove(
  view: XiangqiSoundView | null,
  move: XiangqiMove,
): SoundKind {
  if (!view) return 'move';
  const target = view.board[move.to];
  if (!target) return 'move';
  const fromEntry = view.board[move.from];
  const moverIsCannon = !!fromEntry && fromEntry.role === 'cannon';
  const moverColor = fromEntry ? fromEntry.color : view.perspective;
  if (target.color === moverColor) return 'move';
  if (target.role === 'general') return 'king-capture';
  return moverIsCannon ? 'cannon-capture' : 'capture';
}

export function maybePlayXiangqiSnapshotSound(
  view: XiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
  // A variant's own reading of the opponent's move (atomic: the blast). Runs
  // in place of classifyXiangqiOpponentSound with the same prev/next pair.
  classifyOpponent: (
    prev: XiangqiSoundView | null,
    next: XiangqiSoundView | null,
    seat: XiangqiSeatOrSpectator,
  ) => SoundKind | null = classifyXiangqiOpponentSound,
): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = xiangqiTerminalSoundKey(view, seat);
    return;
  }

  const terminal = xiangqiTerminalSoundKey(view, seat);
  if (terminal && terminal !== lastTerminalKey) {
    lastTerminalKey = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    const reason = view?.status.type === 'finished' ? view.status.reason : null;
    playTerminalPlan(result, reason);
    lastView = view;
    return;
  }

  const kind = classifyOpponent(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function xiangqiTerminalSoundKey(
  view: XiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

export function classifyXiangqiOpponentSound(
  prev: XiangqiSoundView | null,
  next: XiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  return ownPieceCount(next, seat) < ownPieceCount(prev, seat) ? 'captured' : 'move';
}

function ownPieceCount(view: XiangqiSoundView, color: XiangqiColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && entry.color === color) count += 1;
  }
  return count;
}
