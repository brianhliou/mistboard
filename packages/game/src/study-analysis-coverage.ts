// How much of a stored study-chapter analysis still describes the chapter.
//
// A chapter is a document its owner keeps editing, so its analysis records the
// line it ran on. The reader is shown the analysis for the longest prefix the
// chapter's CURRENT mainline shares with that line, and nothing past it: the
// same rule lichess applies when it charts a study's server analysis over
// mainline.slice(0, analysedPathLength). An edit at ply k leaves plies k and on
// uncovered rather than showing evals for positions no longer on the board.
//
// Shared by the server (whether a chapter needs a fresh run) and the web (what
// the advantage chart covers), so the two can never disagree about it.

/** The first-child line of a SerializedTree, as its stored UCI strings. Stops
 *  at the first node without a move string, so a malformed node ends the line
 *  rather than being skipped (every move after it would be on another board). */
export function serializedTreeMainline(tree: unknown): string[] {
  const out: string[] = [];
  let node = (tree as { root?: { children?: unknown[] } } | null | undefined)?.root;
  while (node && Array.isArray(node.children) && node.children.length > 0) {
    const child = node.children[0] as { uci?: unknown; children?: unknown[] } | null;
    if (!child || typeof child.uci !== 'string') break;
    out.push(child.uci);
    node = child;
  }
  return out;
}

/** The chapter's hand-set start, or null for the standard start. */
export function serializedTreeRootFen(tree: unknown): string | null {
  const fen = (tree as { rootFen?: unknown } | null | undefined)?.rootFen;
  return typeof fen === 'string' && fen.trim() ? fen : null;
}

/**
 * Number of mainline MOVES the analysis covers: the common prefix of the line
 * it analysed and the chapter's current mainline. 0 when the two start from
 * different positions (a chapter re-rooted after the run), since no ply of
 * the old analysis is a position the chapter still has.
 */
export function studyAnalysisCoveredPlies(
  analysed: { moves: readonly string[]; rootFen: string | null },
  current: { moves: readonly string[]; rootFen: string | null },
): number {
  if ((analysed.rootFen ?? null) !== (current.rootFen ?? null)) return 0;
  const limit = Math.min(analysed.moves.length, current.moves.length);
  let ply = 0;
  while (ply < limit && analysed.moves[ply] === current.moves[ply]) ply += 1;
  return ply;
}

/**
 * The eval series cut to the covered prefix: positions 0..covered, so a chart
 * drawn from it ends on the last position both lines share. Null when nothing
 * past the start is covered, because a single point is not a chart and the
 * reader is better served by no analysis than by a dot.
 */
export function coveredStudyAnalysisPlies<T extends { ply: number }>(
  plies: readonly T[],
  covered: number,
): T[] | null {
  if (covered < 1) return null;
  const kept = plies.filter((entry) => entry.ply <= covered);
  return kept.some((entry) => entry.ply >= 1) ? kept : null;
}
