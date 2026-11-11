// Sound policy for Dark Xiangqi.
//
// Dark Xiangqi is a field-of-fire fog variant. The view that reaches the client
// is redacted: a shrouded entry carries occupancy + colour but NO piece type, so
// the classifier can never read a hidden identity. The own-move classifier is
// precise (your own pieces are never shrouded) and the opponent classifier diffs
// the visible-piece count. The general is the king-equivalent.

import type {
  XiangqiColor,
  XiangqiGameStatus,
  XiangqiMove,
  XiangqiPiece,
  XiangqiSquare,
} from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

// Mirrors the client's redacted DarkXiangqiWireView without coupling to it: a
// shrouded entry has no `piece`, only occupancy colour.
type DarkXiangqiSoundEntry =
  | { piece: XiangqiPiece; shrouded: false }
  | { color: XiangqiColor; shrouded: true };
type DarkXiangqiSoundView = {
  board: Partial<Record<XiangqiSquare, DarkXiangqiSoundEntry>>;
  perspective: XiangqiColor;
  status: XiangqiGameStatus;
  moveNumber: number;
};

type XiangqiSeatOrSpectator = XiangqiColor | 'spectator' | null;

let lastView: DarkXiangqiSoundView | null = null;
let lastTerminalKey: string | null = null;

export function resetDarkXiangqiSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

export function soundForOwnDarkXiangqiMove(
  view: DarkXiangqiSoundView | null,
  move: XiangqiMove,
): SoundKind {
  if (!view) return 'move';
  const target = view.board[move.to];
  if (!target) return 'move';
  const fromEntry = view.board[move.from];
  // Your own pieces are never shrouded in your own view, so reading the mover's
  // role for the cannon boom is leak-safe.
  const moverIsCannon = !!fromEntry && !fromEntry.shrouded && fromEntry.piece.role === 'cannon';
  const moverColor = fromEntry && !fromEntry.shrouded ? fromEntry.piece.color : view.perspective;
  if (target.shrouded) return moverIsCannon ? 'cannon-capture' : 'capture';
  if (target.piece.color === moverColor) return 'move';
  if (target.piece.role === 'general') return 'king-capture';
  return moverIsCannon ? 'cannon-capture' : 'capture';
}

export function maybePlayDarkXiangqiSnapshotSound(
  view: DarkXiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = darkXiangqiTerminalSoundKey(view, seat);
    return;
  }

  const terminal = darkXiangqiTerminalSoundKey(view, seat);
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

  const kind = classifyDarkXiangqiOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function darkXiangqiTerminalSoundKey(
  view: DarkXiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

export function classifyDarkXiangqiOpponentSound(
  prev: DarkXiangqiSoundView | null,
  next: DarkXiangqiSoundView | null,
  seat: XiangqiSeatOrSpectator,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  return ownVisiblePieceCount(next, seat) < ownVisiblePieceCount(prev, seat) ? 'capture' : 'move';
}

function ownVisiblePieceCount(view: DarkXiangqiSoundView, color: XiangqiColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && !entry.shrouded && entry.piece.color === color) count += 1;
  }
  return count;
}
