// Sound policy for Jieqi.
//
// Jieqi hides identity, not position: you see every piece's square and colour,
// but a face-down piece's ROLE is unknown. A piece reveals (flips face-up) when
// it MOVES, which is public; a face-down piece that is CAPTURED reveals only to
// the capturer (private). The classifier drives the flip off public board signals
// only (a moved piece that was face-down in the prior snapshot), so a private
// capture-reveal never leaks through audio -- to the victim it lands as a plain
// `capture`.

import type {
  JieqiColor,
  JieqiGameStatus,
  JieqiMove,
  JieqiPieceRole,
  JieqiSquare,
} from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

// Mirrors the client's redacted JieqiWireView: a face-down entry carries colour
// but no role.
type JieqiSoundEntry =
  | { color: JieqiColor; role: JieqiPieceRole; faceDown: false }
  | { color: JieqiColor; faceDown: true };
type JieqiSoundView = {
  board: Partial<Record<JieqiSquare, JieqiSoundEntry>>;
  perspective: JieqiColor;
  status: JieqiGameStatus;
  moveNumber: number;
  lastMove?: JieqiMove;
};

type JieqiSeatOrSpectator = JieqiColor | 'spectator' | null;

let lastView: JieqiSoundView | null = null;
let lastTerminalKey: string | null = null;

export function resetJieqiSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

// Capturing a revealed general wins (king-capture); any other capture is a
// capture (cannon boom if the mover is a revealed cannon). With no capture,
// moving one of your own face-down pieces reveals it -> flip.
export function soundForOwnJieqiMove(view: JieqiSoundView | null, move: JieqiMove): SoundKind {
  if (!view) return 'move';
  const mover = view.board[move.from];
  const target = view.board[move.to];
  const myColor = view.perspective;
  if (target && target.color !== myColor) {
    const cannon = !!mover && !mover.faceDown && mover.role === 'cannon';
    if (!target.faceDown && target.role === 'general') return 'king-capture';
    return cannon ? 'cannon-capture' : 'capture';
  }
  if (mover?.faceDown) return 'flip';
  return 'move';
}

export function maybePlayJieqiSnapshotSound(
  view: JieqiSoundView | null,
  seat: JieqiSeatOrSpectator,
): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = jieqiTerminalSoundKey(view, seat);
    return;
  }

  const terminal = jieqiTerminalSoundKey(view, seat);
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

  const kind = classifyJieqiOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function jieqiTerminalSoundKey(
  view: JieqiSoundView | null,
  seat: JieqiSeatOrSpectator,
): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

// Public board signals only. A drop in our own piece count is a capture of one
// of our pieces -- if that piece was face-down, its identity reveals to the
// capturer, never to us, so it stays a plain `capture`. A moved piece that was
// face-down in the prior snapshot is a public reveal -> flip. Otherwise a move.
export function classifyJieqiOpponentSound(
  prev: JieqiSoundView | null,
  next: JieqiSoundView | null,
  seat: JieqiSeatOrSpectator,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  if (ownPieceCount(next, seat) < ownPieceCount(prev, seat)) return 'capture';
  const revealedFrom = next.lastMove?.from;
  if (revealedFrom && prev.board[revealedFrom]?.faceDown) return 'flip';
  return 'move';
}

function ownPieceCount(view: JieqiSoundView, color: JieqiColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && entry.color === color) count += 1;
  }
  return count;
}
