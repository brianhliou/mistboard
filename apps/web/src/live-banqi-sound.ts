// Sound policy for Banqi (Chinese Dark Chess).
//
// Banqi hides identity, not position: every square is visible to both seats, so
// a flip (face-down -> revealed) is public and can be sounded precisely for both
// players, unlike the field-of-fire fog variants. The board carries only revealed
// own pieces (a face-down tile has no colour to anyone), so the opponent
// classifier diffs the revealed-piece count and never reads a hidden identity.

import type { BanqiColor, BanqiMove, BanqiPlayerView, BanqiSquare } from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

type BanqiSeatOrSpectator = BanqiColor | 'spectator' | null;

let lastView: BanqiPlayerView | null = null;
let lastTerminalKey: string | null = null;

export function resetBanqiSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

// The seated player's own move. A self-move (from === to) flips a face-down tile;
// otherwise it is a board move, or a capture of a revealed enemy (only revealed
// enemies are ever capturable). Own pieces are always revealed in your own view,
// so the cannon check never reads a hidden identity.
export function soundForOwnBanqiMove(view: BanqiPlayerView | null, move: BanqiMove): SoundKind {
  if (move.from === move.to) return 'flip';
  if (!view) return 'move';
  const target = view.board[move.to];
  if (!target || target.faceDown) return 'move';
  const mover = view.board[move.from];
  const moverRole = mover && !mover.faceDown ? mover.role : null;
  return moverRole === 'cannon' ? 'cannon-capture' : 'capture';
}

export function maybePlayBanqiSnapshotSound(
  view: BanqiPlayerView | null,
  seat: BanqiSeatOrSpectator,
): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = banqiTerminalSoundKey(view, seat);
    return;
  }

  const terminal = banqiTerminalSoundKey(view, seat);
  if (terminal && terminal !== lastTerminalKey) {
    lastTerminalKey = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    // Banqi has no king-capture win, so there is no king-fall sting.
    playTerminalPlan(result, null);
    lastView = view;
    return;
  }

  const kind = classifyBanqiOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function banqiTerminalSoundKey(
  view: BanqiPlayerView | null,
  seat: BanqiSeatOrSpectator,
): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

// Classify the opponent's just-completed action from the visible board delta.
// Banqi has no vision-fog, so a face-down -> revealed transition is the opponent
// flipping a tile (public); a drop in the seated player's revealed-piece count is
// a capture of one of their pieces; anything else is a plain move. None of these
// reads an identity the seat is not entitled to.
export function classifyBanqiOpponentSound(
  prev: BanqiPlayerView | null,
  next: BanqiPlayerView | null,
  seat: BanqiSeatOrSpectator,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null; // the seat's own move handles its own sound
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  if (someTileFlipped(prev, next)) return 'flip';
  if (ownRevealedCount(next, seat) < ownRevealedCount(prev, seat)) return 'capture';
  return 'move';
}

function someTileFlipped(prev: BanqiPlayerView, next: BanqiPlayerView): boolean {
  for (const square of Object.keys(next.board) as BanqiSquare[]) {
    const nextEntry = next.board[square];
    if (!nextEntry || nextEntry.faceDown) continue;
    const prevEntry = prev.board[square];
    if (prevEntry?.faceDown) return true; // a tile turned face-up between snapshots
  }
  return false;
}

function ownRevealedCount(view: BanqiPlayerView, color: BanqiColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && !entry.faceDown && entry.color === color) count += 1;
  }
  return count;
}
