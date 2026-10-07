// Exact endgame results for standard xiangqi, from the chessdb.cn cloud
// database (the lichess tablebase panel, for xiangqi).
//
// This file is the PURE half: the wire types the server hands the browser, the
// parser for chessdb's `queryall` text, the "is this worth asking" filter and
// the best-first ordering. The server owns the network, the cache and the
// politeness (apps/server/src/xiangqi-tablebase.ts); the web panel and the
// practice grader read the parsed result.
//
// The one rule every function here keeps: a result that is not EXACT is "no
// data", never a draw. chessdb answers every position it knows with a note, but
// only an endgame-tablebase row carries an outcome, `(W-M-0009)`; a book or
// search row carries an engine figure, `(45-02)`, and turning that into a
// verdict would print a guess with a tablebase's authority.

import type { XiangqiGameState, XiangqiMove, XiangqiSquare } from './variants-xiangqi.js';
import { getStandardXiangqiLegalMoves } from './variants-xiangqi-standard.js';
import { pikafishUciToXiangqiSquares } from './xiangqi-uci.js';

/** An exact outcome, from the point of view of the side that is to move. */
export type XiangqiTablebaseOutcome = 'win' | 'draw' | 'loss';

export interface XiangqiTablebaseMove {
  from: XiangqiSquare;
  to: XiangqiSquare;
  /** The outcome for the side PLAYING this move, if it is played and both sides
   *  then play perfectly. */
  result: XiangqiTablebaseOutcome;
  /** Plies until mate after this move under best play (the move itself
   *  included), for a win or a loss. Null for a draw, and for a row whose
   *  distance metric we do not read (never invented). */
  dtm: number | null;
}

/** What GET /api/xiangqi/tablebase answers. `none` covers every way of not
 *  knowing: not in the database, not exact, the database is down or slow. */
export type XiangqiTablebaseResponse =
  | {
      status: 'exact';
      /** The position's own value for the side to move: its best move's result. */
      result: XiangqiTablebaseOutcome;
      dtm: number | null;
      /** Every legal move, best first. */
      moves: XiangqiTablebaseMove[];
    }
  | { status: 'none' };

/**
 * Attacking pieces (chariots, horses, cannons, soldiers, both sides) above which
 * the browser does not ask. chessdb's tablebases are endgame material: across
 * the 35-position endgame corpus every exact row had at most four attackers and
 * every five-attacker position came back `unknown`. A middlegame has twenty-two,
 * so without this filter every move of every analysis would cost chessdb a
 * request for an answer it cannot give. Generous by one on purpose: a position
 * past the filter is only a request that comes back "no data".
 */
export const XIANGQI_TABLEBASE_MAX_ATTACKERS = 5;

/** Whether a position is small enough to be worth a tablebase lookup. */
export function isXiangqiTablebaseCandidate(state: XiangqiGameState): boolean {
  if (state.status.type !== 'playing') return false;
  let attackers = 0;
  for (const piece of Object.values(state.board)) {
    if (!piece) continue;
    if (
      piece.role === 'chariot' ||
      piece.role === 'horse' ||
      piece.role === 'cannon' ||
      piece.role === 'soldier'
    ) {
      attackers += 1;
      if (attackers > XIANGQI_TABLEBASE_MAX_ATTACKERS) return false;
    }
  }
  return true;
}

// `note:! (W-M-0009)`: outcome, metric, distance. Only the `M` (mate) metric
// carries a distance we can print as "mate in N"; chessdb documents another
// spelling for its conversion tables, and a row in that spelling keeps its
// outcome but drops the distance rather than mislabelling it.
const EXACT_NOTE = /\((W|D|L)-([A-Z0-9]+)-(\d+)\)/;
const MOVE_FIELD = /(?:^|,)move:([a-i]\d[a-i]\d)(?:,|$)/;
const NOTE_FIELD = /(?:^|,)note:([^,]*)/;

function outcomeOf(letter: string): XiangqiTablebaseOutcome {
  return letter === 'W' ? 'win' : letter === 'L' ? 'loss' : 'draw';
}

/**
 * Parse chessdb's `queryall` answer for `state` into an exact result, or null.
 *
 * Null whenever the answer is anything short of complete and exact:
 *   - a status word (`unknown`, `invalid board`, `rate limit exceeded`, …);
 *   - any row without an exact outcome (a half-solved position is not exact);
 *   - any row our kernel rejects, or a legal move of ours the database left out:
 *     the two rule sets disagree here, and a table missing a legal move would
 *     read as "that move is not playable" when it is.
 */
export function parseChessdbQueryAll(
  text: string,
  state: XiangqiGameState,
): Extract<XiangqiTablebaseResponse, { status: 'exact' }> | null {
  if (state.status.type !== 'playing') return null;
  const body = text.replace(/\0/g, '').trim();
  if (!body.includes('move:')) return null;

  const legal = getStandardXiangqiLegalMoves(state);
  const legalKeys = new Set(legal.map((m) => `${m.from}${m.to}`));
  const seen = new Set<string>();
  const moves: XiangqiTablebaseMove[] = [];
  for (const row of body.split('|')) {
    const fields = row.trim();
    if (!fields) continue;
    const uci = MOVE_FIELD.exec(fields)?.[1];
    const note = NOTE_FIELD.exec(fields)?.[1];
    if (!uci || !note) return null;
    const exact = EXACT_NOTE.exec(note);
    if (!exact) return null;
    // chessdb speaks Pikafish's rank-0 dialect: `e0e1` is our e1->e2.
    const move = pikafishUciToXiangqiSquares(uci);
    if (!move) return null;
    const key = `${move.from}${move.to}`;
    if (!legalKeys.has(key) || seen.has(key)) return null;
    seen.add(key);
    const result = outcomeOf(exact[1] as string);
    const plies = Number(exact[3]);
    moves.push({
      from: move.from,
      to: move.to,
      result,
      dtm: result !== 'draw' && exact[2] === 'M' && plies > 0 ? plies : null,
    });
  }
  if (moves.length === 0 || moves.length !== legalKeys.size) return null;

  moves.sort(compareXiangqiTablebaseMoves);
  const best = moves[0] as XiangqiTablebaseMove;
  return { status: 'exact', result: best.result, dtm: best.dtm, moves };
}

const OUTCOME_RANK: Record<XiangqiTablebaseOutcome, number> = { win: 0, draw: 1, loss: 2 };

/**
 * Best first, lichess's order: wins by the fastest mate, then draws, then losses
 * by the slowest mate (the most stubborn defence). A win or loss with no
 * distance sorts after the ones that have one, so a known shortest mate is never
 * pushed down by a row we could not measure. Ties keep a stable square order so
 * the table does not reshuffle between identical lookups.
 */
export function compareXiangqiTablebaseMoves(
  a: XiangqiTablebaseMove,
  b: XiangqiTablebaseMove,
): number {
  const byOutcome = OUTCOME_RANK[a.result] - OUTCOME_RANK[b.result];
  if (byOutcome !== 0) return byOutcome;
  if (a.result !== 'draw') {
    const far = Number.POSITIVE_INFINITY;
    const da = a.dtm ?? far;
    const db = b.dtm ?? far;
    if (da !== db) {
      if (a.result === 'win') return da - db;
      // Losses: longest resistance first, unknown distance last.
      if (a.dtm === null) return 1;
      if (b.dtm === null) return -1;
      return db - da;
    }
  }
  return `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`);
}

/** Full moves to mate from a ply distance ("mate in 5" for DTM 9). */
export function xiangqiTablebaseMateMoves(dtm: number): number {
  return Math.ceil(dtm / 2);
}

/** The tablebase row for a move, if the result lists it. */
export function xiangqiTablebaseRowFor(
  response: XiangqiTablebaseResponse,
  move: Pick<XiangqiMove, 'from' | 'to'>,
): XiangqiTablebaseMove | null {
  if (response.status !== 'exact') return null;
  return response.moves.find((m) => m.from === move.from && m.to === move.to) ?? null;
}
