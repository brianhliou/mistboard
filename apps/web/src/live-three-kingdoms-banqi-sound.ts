// Sound policy for Three Kingdoms banqi (#628), banqi's (live-banqi-sound.ts)
// on this room's seats. The room played only its own moves (sendMove), so the
// opponent's moves and the result were silent (Brian, 2026-10-30). Seats here
// are move order and a piece's colour is the ink a seat bound on the opening
// flip, so "my pieces" is read through flipSeatInk, never the seat name.
// Every point is public; the classifier reads face-up pieces only.

import type { BanqiColor, BanqiSeat } from '@mistboard/game';
import { flipSeatInk } from './flip-seat-ink.js';
import { playSound, playTerminalPlan } from './live-sound.js';
import type { SoundKind } from './live-state.js';
import type { ThreeKingdomsBanqiWireView } from './live-three-kingdoms-banqi.js';

type View = ThreeKingdomsBanqiWireView;
type SeatOrSpectator = BanqiSeat | 'spectator' | null;

let lastView: View | null = null;
let lastTerminalKey: string | null = null;

export function resetThreeKingdomsBanqiSoundState(): void {
  lastView = null;
  lastTerminalKey = null;
}

export function maybePlayThreeKingdomsBanqiSound(view: View | null, seat: SeatOrSpectator): void {
  if (lastView === null) {
    lastView = view;
    lastTerminalKey = tkTerminalSoundKey(view, seat);
    return;
  }
  const terminal = tkTerminalSoundKey(view, seat);
  if (terminal && terminal !== lastTerminalKey) {
    lastTerminalKey = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    playTerminalPlan(result, null);
    lastView = view;
    return;
  }
  const kind = classifyTkOpponentSound(lastView, view, seat);
  if (kind) playSound(kind);
  lastView = view;
}

export function tkTerminalSoundKey(view: View | null, seat: SeatOrSpectator): string | null {
  if (view?.status.type !== 'finished') return null;
  if (seat !== 'red' && seat !== 'black') return null;
  if (view.status.winner === null) return `draw:${view.moveNumber}`;
  return view.status.winner === seat ? `win:${view.moveNumber}` : `lose:${view.moveNumber}`;
}

/** The opponent's just-completed action, from the public board delta: a tile
 *  that turned face up is a flip, one fewer of my face-up pieces is a capture
 *  of mine, anything else a move. My own moves sound when I send them. */
export function classifyTkOpponentSound(
  prev: View | null,
  next: View | null,
  seat: SeatOrSpectator,
): SoundKind | null {
  if (seat !== 'red' && seat !== 'black') return null;
  if (!prev || !next) return null;
  if (prev.status.type !== 'playing') return null;
  if (prev.status.turn === seat) return null;
  if (next.status.type === 'playing' && next.status.turn !== seat) return null;
  if (someTileFlipped(prev, next)) return 'flip';
  const ink = flipSeatInk(seat, next.firstColor);
  if (ink && faceUpCount(next, ink) < faceUpCount(prev, ink)) return 'capture';
  return 'move';
}

function someTileFlipped(prev: View, next: View): boolean {
  for (const [square, entry] of Object.entries(next.board)) {
    if (!entry || entry.faceDown) continue;
    if (prev.board[square as keyof View['board']]?.faceDown) return true;
  }
  return false;
}

function faceUpCount(view: View, color: BanqiColor): number {
  let count = 0;
  for (const entry of Object.values(view.board)) {
    if (entry && !entry.faceDown && entry.color === color) count += 1;
  }
  return count;
}
