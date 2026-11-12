// Tell an engine "mate" that is really a rule verdict from a real checkmate.
//
// Pikafish judges repetition inside its search: a line that repeats while one
// side checks on every move scores as a loss for the checker, reported as
// "mate N" exactly like a checkmate. On a record (a broadcast, an imported or
// pasted game) that verdict can land on a position where nobody is mated: the
// checker's opponent has one move, it completes the third repetition, and the
// engine says "mate 1". The source event let play go on, so review must not
// read it as a forced mate.
//
// This replays the history plus the engine's own line for exactly the plies the
// mate distance covers. A real mate ends that walk in checkmate or stalemate. A
// rule mate ends it in a position the kernel's perpetual-check judgment (the
// same window as xiangqiPerpetualCheckLoser) scores against the side the engine
// says loses. Anything else stays an ordinary mate score: the tag is only ever
// added when the kernel agrees with the engine on who loses and why.
//
// Perpetual chase is not here because the kernel has no chase classifier
// (see xiangqiPerpetualCheckLoser); a chase-driven mate score stays untagged.

import {
  createInitialXiangqiState,
  positionRepetitionKey,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from './variants-xiangqi.js';
import {
  applyXiangqiRecordMove,
  isStandardXiangqiGeneralInCheck,
  isStandardXiangqiLegalMove,
  perpetualCheckLoserOfPlies,
  type XiangqiRepetitionPly,
} from './variants-xiangqi-standard.js';
import { fsfUciToXiangqiSquares } from './xiangqi-uci.js';

/** Why an engine mate score is a rule verdict rather than a checkmate. */
export type XiangqiRuleVerdict = 'perpetual-check';

/** Longest mate distance (in moves, either sign) read as a possible rule
 *  verdict. A repetition the engine finds deeper than this is rare, and a
 *  long line is more likely to be a real mate the PV cap cut short, so the
 *  check stays narrow. */
export const XIANGQI_RULE_MATE_MAX_DISTANCE = 2;

export type XiangqiRuleMateInput = {
  /** The moves played before the evaluated position. */
  history: readonly XiangqiMove[];
  /** The engine's mate score from Red's POV (positive: Red wins). */
  mate: number | null | undefined;
  /** The engine's line from the evaluated position, in its UCI dialect
   *  (Fairy-Stockfish squares, as stored on every xiangqi analysis row). */
  pv: readonly string[] | null | undefined;
  /** Start position of the record; the standard opening when omitted. */
  initialState?: XiangqiGameState;
};

/** 'perpetual-check' when the mate score is the perpetual-check rule rather
 *  than a checkmate, else null (including every input it cannot read). */
export function xiangqiRuleMate(input: XiangqiRuleMateInput): XiangqiRuleVerdict | null {
  const { mate } = input;
  if (mate == null || mate === 0 || Math.abs(mate) > XIANGQI_RULE_MATE_MAX_DISTANCE) return null;
  let state = input.initialState ?? createInitialXiangqiState('rule-mate');
  const plies: XiangqiRepetitionPly[] = [];
  const step = (move: XiangqiMove): boolean => {
    if (state.status.type !== 'playing') return false;
    const mover = state.status.turn;
    if (!isStandardXiangqiLegalMove(state, move)) return false;
    const next = applyXiangqiRecordMove(state, move);
    if (next === state) return false;
    const opponent: XiangqiColor = mover === 'red' ? 'black' : 'red';
    plies.push({
      mover,
      gaveCheck: isStandardXiangqiGeneralInCheck(next, opponent),
      key: positionRepetitionKey({ ...next, status: { type: 'playing', turn: opponent } }),
    });
    state = next;
    return true;
  };
  for (const move of input.history) if (!step(move)) return null;
  if (state.status.type !== 'playing') return null;
  const winner: XiangqiColor = mate > 0 ? 'red' : 'black';
  const loser: XiangqiColor = winner === 'red' ? 'black' : 'red';
  // "mate N" for the side to move ends on its own Nth move; for the other side
  // it ends on the reply after the mover's Nth.
  const distance = Math.abs(mate) * 2 - (state.status.turn === winner ? 1 : 0);
  const line = input.pv ?? [];
  if (line.length < distance) return null;
  for (const uci of line.slice(0, distance)) {
    const move = fsfUciToXiangqiSquares(uci);
    if (!move || !step(move)) return null;
    // A finished state here is checkmate or stalemate (record replay resumes
    // the arbiter's draws), so the score is a real mate.
    if (state.status.type !== 'playing') return null;
  }
  return perpetualCheckLoserOfPlies(plies) === loser ? 'perpetual-check' : null;
}
