/**
 * The one grammar every Duck Xiangqi surface writes a turn in: `e2-e5@c7`, and
 * `x…#` for the general capture, which ends the game before the duck would
 * have moved and is the one turn with no `@` half.
 *
 * A leaf module with no imports, so the live room, the postgame and review
 * boards, and the article/embed replay can all share it without any of them
 * pulling another's bundle in. It used to be four hand-kept copies for exactly
 * that bundle reason; the replay's copy drifted to `e2-e5, duck c7` and every
 * duck turn in an embedded study truncated to `e2-e5, d…` (9c8b95da).
 *
 * Takes the STRUCTURAL shape rather than `DuckXiangqiTurn`, because the watch
 * renderer labels moves straight off the wire, where a square is only a string.
 */
export function duckXiangqiTurnLabel(turn: {
  from: string;
  to: string;
  duckTo: string | null;
}): string {
  return turn.duckTo === null
    ? `${turn.from}x${turn.to}#`
    : `${turn.from}-${turn.to}@${turn.duckTo}`;
}
