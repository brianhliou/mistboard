// Sound policy for Jungle / Dou Shou Qi (斗兽棋).
//
// Jungle is PERFECT-INFORMATION (nothing hidden): both seats see the full board, so
// every move can be sounded precisely. There are no drops, no flips, and no king, so
// a board move is just capture (the visible target holds an enemy animal) or move.
// Every game-ending action -- reaching the den or taking the last animal -- resolves
// through the terminal plan rather than a piece-specific cue. The opponent classifier
// diffs the visible piece count, reading no identity the seat is not already shown.

import type { JungleColor, JungleMove, JunglePlayerView } from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

type Seat = JungleColor | 'spectator' | null;

let lastView: JunglePlayerView | null = null;
let lastTerminalKey: string | null = null;

export function resetJungleSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

// The seated player's own move. A capture if the (fully visible) target holds an
// enemy animal, otherwise a plain move (this includes the den-entry win, whose
// fanfare is the terminal plan, not a capture cue).
export function soundForOwnJungleMove(view: JunglePlayerView | null, move: JungleMove): SoundKind {
  if (!view) return 'move';
  const target = view.board[move.to];
  if (!target) return 'move';
  const mover = view.board[move.from];
  const moverColor = mover ? mover.color : view.perspective;
  return target.color === moverColor ? 'move' : 'capture';
}

export function maybePlayJungleSnapshotSound(view: JunglePlayerView | null, seat: Seat): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = jungleTerminalSoundKey(view, seat);
    return;
  }

  const terminal = jungleTerminalSoundKey(view, seat);
  if (terminal && terminal !== lastTerminalKey) {
    lastTerminalKey = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    // Jungle has no king capture, so there is no king-fall sting.
    playTerminalPlan(result, null);
    lastView = view;
    return;
  }

  const kind = classifyJungleOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function jungleTerminalSoundKey(view: JunglePlayerView | null, seat: Seat): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

// Classify the opponent's just-completed move from the visible board delta: a drop in
// the seated player's piece count is 'capture' (mutual-destruction trades count too),
// anything else is a plain 'move'. Counts only. Exported pure for tests.
export function classifyJungleOpponentSound(
  prev: JunglePlayerView | null,
  next: JunglePlayerView | null,
  seat: Seat,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  return pieceCount(next, seat) < pieceCount(prev, seat) ? 'capture' : 'move';
}

function pieceCount(view: JunglePlayerView, color: JungleColor): number {
  let count = 0;
  for (const piece of Object.values(view.board)) {
    if (piece && piece.color === color) count += 1;
  }
  return count;
}
