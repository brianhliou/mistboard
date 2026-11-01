// Sound policy for Flip Jungle (翻翻兽棋).
//
// Flip Jungle hides identity, not position: every square is visible to both seats, so
// a flip (face-down -> revealed) is public and can be sounded precisely for both
// players, unlike the field-of-fire fog variants. A self-move (from === to) is a
// flip; a board move is a capture of a revealed enemy animal (face-down tiles are
// never captured) or a plain move. The opponent classifier diffs the visible board:
// a freshly turned tile is 'flip', a drop in the seat's revealed-piece count is
// 'captured', anything else is 'move'. It only ever reads revealed pieces, so no
// face-down identity is ever consulted.

import type {
  JungleFlipColor,
  JungleFlipMove,
  JungleFlipPlayerView,
  JungleFlipSeat,
  JungleFlipSquare,
} from '@mistboard/game';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';

type Seat = JungleFlipSeat | 'spectator' | null;

let lastView: JungleFlipPlayerView | null = null;
let lastTerminalKey: string | null = null;

export function resetJungleFlipSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

// The ink a seat owns once the opening flip binds it (null before). Mirrors the
// tenant's jungleFlipSeatInk so the opponent classifier can count the seat's pieces.
function seatInk(view: JungleFlipPlayerView | null, seat: Seat): JungleFlipColor | null {
  if (!view || view.firstColor === null) return null;
  if (seat !== 'red' && seat !== 'black') return null;
  return seat === 'red' ? view.firstColor : view.firstColor === 'red' ? 'black' : 'red';
}

// The seated player's own action. A self-move flips a face-down tile; otherwise it is
// a board move, or a capture of a revealed enemy (only revealed enemies are ever
// capturable, so a revealed target is always a capture). Flip Jungle has no cannon.
export function soundForOwnJungleFlipMove(
  view: JungleFlipPlayerView | null,
  move: JungleFlipMove,
): SoundKind {
  if (move.from === move.to) return 'flip';
  if (!view) return 'move';
  const target = view.board[move.to];
  if (!target || target.faceDown) return 'move';
  return 'capture';
}

export function maybePlayJungleFlipSnapshotSound(
  view: JungleFlipPlayerView | null,
  seat: Seat,
): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = jungleFlipTerminalSoundKey(view, seat);
    return;
  }

  const terminal = jungleFlipTerminalSoundKey(view, seat);
  if (terminal && terminal !== lastTerminalKey) {
    lastTerminalKey = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    // Flip Jungle has no king capture, so there is no king-fall sting.
    playTerminalPlan(result, null);
    lastView = view;
    return;
  }

  const kind = classifyJungleFlipOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function jungleFlipTerminalSoundKey(
  view: JungleFlipPlayerView | null,
  seat: Seat,
): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

// Classify the opponent's just-completed action from the visible board delta. A
// face-down -> revealed transition is the opponent flipping a tile (public); a drop
// in the seat's revealed-piece count is a capture of one of their animals; anything
// else is a plain move. None of these reads a face-down identity. Exported pure for
// tests.
export function classifyJungleFlipOpponentSound(
  prev: JungleFlipPlayerView | null,
  next: JungleFlipPlayerView | null,
  seat: Seat,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  if (someTileFlipped(prev, next)) return 'flip';
  const ink = seatInk(next, seat) ?? seatInk(prev, seat);
  if (ink && ownRevealedCount(next, ink) < ownRevealedCount(prev, ink)) return 'captured';
  return 'move';
}

function someTileFlipped(prev: JungleFlipPlayerView, next: JungleFlipPlayerView): boolean {
  for (const square of Object.keys(next.board) as JungleFlipSquare[]) {
    const nextEntry = next.board[square];
    if (!nextEntry || nextEntry.faceDown) continue;
    const prevEntry = prev.board[square];
    if (prevEntry?.faceDown) return true; // a tile turned face-up between snapshots
  }
  return false;
}

function ownRevealedCount(view: JungleFlipPlayerView, ink: JungleFlipColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && !entry.faceDown && entry.color === ink) count += 1;
  }
  return count;
}
