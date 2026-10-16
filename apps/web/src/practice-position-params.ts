// /practice/position?fen=…&goal=mate|draw&side=red|black: practice against the
// engine from any xiangqi position. The endgames page links here for each of its
// positions, and the board editor hands its position over the same way.
//
// Fail-closed: a URL is a request a stranger can type, so every parameter is
// read strictly. An unreadable FEN, a finished position, a goal other than the
// two the page offers, or a side other than red/black refuses with a reason and
// mounts no runner. Defaulting a missing side or goal would hand the learner an
// exercise they did not ask for, graded against a goal they cannot see.
//
// Kept apart from the page module so it can be tested without the engine.

import {
  getStandardXiangqiLegalMoves,
  normalizeStartFen,
  type PracticeGoal,
  parsePracticeGoal,
  parseStandardXiangqiFen,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
} from '@mistboard/game';

/** A draw exercise holds for this many moves, as the practice studies do. */
export const PRACTICE_POSITION_DRAW_MOVES = 15;

export type PracticePositionGoal = 'mate' | 'draw';

export type PracticePositionRequest =
  | {
      ok: true;
      fen: string;
      state: XiangqiGameState;
      goalKind: PracticePositionGoal;
      goal: PracticeGoal;
      side: XiangqiColor;
    }
  | { ok: false; reason: 'fen' | 'finished' | 'goal' | 'side' };

function goalFor(kind: string | null): PracticeGoal | null {
  if (kind === 'mate') return parsePracticeGoal('mate');
  if (kind === 'draw') return parsePracticeGoal(`draw in ${PRACTICE_POSITION_DRAW_MOVES}`);
  return null;
}

export function parsePracticePositionParams(params: URLSearchParams): PracticePositionRequest {
  const side = params.get('side');
  if (side !== 'red' && side !== 'black') return { ok: false, reason: 'side' };

  const goalKind = params.get('goal');
  const goal = goalFor(goalKind);
  if (!goal) return { ok: false, reason: 'goal' };

  const raw = params.get('fen')?.trim();
  if (!raw) return { ok: false, reason: 'fen' };
  const normalized = normalizeStartFen(XIANGQI_SPEC_ID, raw);
  if (!normalized.ok) return { ok: false, reason: 'fen' };
  const parsed = parseStandardXiangqiFen(normalized.fen, 'practice-position');
  if (!parsed.ok) return { ok: false, reason: 'fen' };
  // A mated or stalemated position is a legal FEN and no exercise at all. The
  // FEN parser reports every position as 'playing' (status is a game fact, not
  // a board fact), so ask the rules whether the side to move has a move.
  if (
    parsed.state.status.type !== 'playing' ||
    getStandardXiangqiLegalMoves(parsed.state).length === 0
  ) {
    return { ok: false, reason: 'finished' };
  }

  return {
    ok: true,
    fen: normalized.fen,
    state: parsed.state,
    goalKind: goalKind as PracticePositionGoal,
    goal,
    side,
  };
}

/** The URL for practising `fen`; the editor and the endgames page both build it here. */
export function practicePositionHref(
  fen: string,
  goal: PracticePositionGoal,
  side: XiangqiColor,
): string {
  const params = new URLSearchParams({ fen, goal, side });
  return `/practice/position?${params.toString()}`;
}
