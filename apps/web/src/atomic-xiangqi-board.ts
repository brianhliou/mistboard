// The two things an Atomic Xiangqi board draws that a xiangqi board does not,
// shared by the live room and the postgame so they cannot disagree:
//
//   - the AFTERMATH: an amber ring on every point the last move's explosion
//     cleared (the captured piece and its neighbours; the capturer's origin is
//     already the last-move shadow), so pieces do not simply vanish;
//   - the CHECK notice copy, which has to say what "check" means here, because
//     a chariot bearing on your advisor is check under the repetition law and
//     the first perpetual-check loss would otherwise feel like a cheat.
//
// The board itself is xiangqi-board.ts: same array, same geometry, same piece
// set. An AtomicXiangqiPlayerView is a StandardXiangqiPlayerView with two more
// fields, so it renders through the same function.

import type { AtomicXiangqiColor, AtomicXiangqiPlayerView } from '@mistboard/game';
import type { XiangqiBoardMarker } from './xiangqi-board.js';

export function atomicXiangqiBlastMarkers(view: AtomicXiangqiPlayerView): XiangqiBoardMarker[] {
  return view.lastBlast.map((victim) => ({
    square: victim.square,
    kind: 'circle',
    className: 'xq-marker--blast',
  }));
}

/** The reason phrase for the room chrome's end-of-game line. */
export function atomicXiangqiReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'general-captured':
      return 'the general was blown up';
    case 'timeout':
      return 'timeout';
    case 'resignation':
      return 'resignation';
    case 'abandonment':
      return 'abandonment';
    case 'repetition':
      return 'threefold repetition';
    case 'chasing':
      return 'perpetual check';
    case 'progress-clock':
      return 'sixty moves without a capture';
    default:
      return 'the game rules';
  }
}

/** Check notice body: whose general, and what the threat is. */
export function atomicXiangqiCheckBody(perspective: AtomicXiangqiColor, ownSeat: boolean): string {
  const whose = ownSeat ? 'Your' : perspective === 'red' ? 'Red’s' : 'Black’s';
  return `${whose} general can be taken or blown up next move. A repeated check like this loses.`;
}
