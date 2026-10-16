// Whose general a check mark (a board glow, a `+` in a move list) is about,
// shared by every variant that has check. Kept apart from the kernels so each
// can import it without importing another variant.

/**
 * Whose general a check mark is about: the side to move while the game is on,
 * the loser once it is over (the side that was mated, or that resigned or ran
 * out of time facing the move). Null for a draw or an abort.
 */
export function checkSubjectColor<C extends 'red' | 'black'>(
  status:
    | { type: 'playing'; turn: C }
    | { type: 'finished'; winner: C | null }
    | { type: 'aborted' },
): C | null {
  if (status.type === 'playing') return status.turn;
  if (status.type === 'finished' && status.winner) {
    return (status.winner === 'red' ? 'black' : 'red') as C;
  }
  return null;
}
