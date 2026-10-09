import type { BanqiMove, BanqiPlayerView, BanqiSeat, BanqiSquare } from '@mistboard/game';

// Pure click-to-move decision for the banqi board — the web-side half of the
// interaction contract, kept out of the DOM client so it is unit-testable.
//
// Banqi is symmetric-information: there is no fog, and a face-down tile carries
// no colour or identity to anyone. The hidden axis is the deal. Two click paths:
//   - FLIP: clicking a face-down tile sends the self-move { from: X, to: X }
//     (flips are present in view.legalMoves as self-moves). A face-down tile is
//     clicked DIRECTLY — it is never "selected", so a flip is a one-click move.
//   - MOVE: clicking your own revealed piece selects it, then clicking a legal
//     destination sends { from, to }. Selectability is "your own revealed piece
//     with a board move", counting the moves the 長捉 rule forbids.
//   - FORBIDDEN: clicking a destination the 長捉 rule forbids (view.forbiddenMoves)
//     sends nothing; the client says why instead.
// Seat ink is bound on the first flip; before then only flips are legal and no
// revealed piece exists to select.

export type BanqiClickResult =
  | { kind: 'select'; square: BanqiSquare }
  | { kind: 'clear' }
  | { kind: 'move'; move: BanqiMove }
  | { kind: 'forbidden'; move: BanqiMove }
  | { kind: 'noop' };

export function banqiClickResult(
  view: BanqiPlayerView,
  seat: unknown,
  selected: BanqiSquare | null,
  square: BanqiSquare,
): BanqiClickResult {
  if (!canInteract(view, seat)) return { kind: 'noop' };

  // A face-down tile is flipped directly (one click), never selected. The flip
  // takes priority even when another piece is selected, so clicking a face-down
  // tile is always a flip rather than a missed move target.
  const flip = view.legalMoves.find((move) => move.from === square && move.to === square);
  if (flip) return { kind: 'move', move: flip };

  if (!selected) {
    return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'noop' };
  }
  if (selected === square) return { kind: 'clear' };
  const move = view.legalMoves.find(
    (candidate) => candidate.from === selected && candidate.to === square,
  );
  if (move) return { kind: 'move', move };
  const forbidden = banqiForbiddenMove(view, selected, square);
  if (forbidden) return { kind: 'forbidden', move: forbidden };
  return canSelect(view, seat, square) ? { kind: 'select', square } : { kind: 'clear' };
}

/** The 長捉-forbidden move from `from` to `to` in this view, if there is one. */
export function banqiForbiddenMove(
  view: Pick<BanqiPlayerView, 'forbiddenMoves'>,
  from: BanqiSquare,
  to: BanqiSquare,
): BanqiMove | undefined {
  return view.forbiddenMoves?.find((move) => move.from === from && move.to === to);
}

function isBanqiSeat(value: unknown): value is BanqiSeat {
  return value === 'red' || value === 'black';
}

function canInteract(view: BanqiPlayerView, seat: unknown): boolean {
  return view.status.type === 'playing' && isBanqiSeat(seat) && view.status.turn === seat;
}

// A revealed own piece with a legal board move (a flip is handled directly, so a
// face-down tile is never a selectable source).
function canSelect(view: BanqiPlayerView, seat: unknown, square: BanqiSquare): boolean {
  if (!canInteract(view, seat)) return false;
  const entry = view.board[square];
  if (!entry || entry.faceDown) return false;
  const ink =
    view.firstColor === null ? null : seat === 'red' ? view.firstColor : oppositeInk(view);
  if (ink === null || entry.color !== ink) return false;
  const hasMove = (move: BanqiMove) => move.from === square && move.to !== square;
  return view.legalMoves.some(hasMove) || (view.forbiddenMoves ?? []).some(hasMove);
}

function oppositeInk(view: BanqiPlayerView): 'red' | 'black' | null {
  if (view.firstColor === null) return null;
  return view.firstColor === 'red' ? 'black' : 'red';
}
