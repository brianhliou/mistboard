// Offline study imports use the room convention: ply 1 is the first move,
// keyed to the position AFTER that move. Win percentages are mover POV.
import {
  applyJieqiMove,
  type JieqiMove,
  parseJieqiFen,
  serializedTreeMainline,
  serializedTreeRootFen,
} from '@mistboard/game';

export type StudyJieqiDecision = {
  ply: number;
  mover: 'red' | 'black';
  playedWin: number;
  realizedWin: number;
  bestWin?: number;
  playedRank?: number | null;
  candidates?: { move: string; win: number; played?: boolean }[];
};
export type StudyDecisionsInput = {
  engineId: string;
  source: string;
  decisions: StudyJieqiDecision[];
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('unexpected field: decision data must not carry hidden piece identities');
}
function win(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    throw new Error('win percentage must be finite and in [0, 100]');
  return value;
}

/** Reject rather than strip unknown fields: no captured identity can enter storage. */
export function validateStudyDecisions(
  variant: string,
  tree: unknown,
  value: unknown,
): StudyDecisionsInput {
  if (variant !== 'jieqi') throw new Error('decisions require a jieqi chapter');
  const input = object(value);
  keys(input, ['engineId', 'source', 'decisions']);
  if (
    typeof input.engineId !== 'string' ||
    !input.engineId.trim() ||
    typeof input.source !== 'string' ||
    !input.source.trim()
  )
    throw new Error('engineId and source are required');
  if (!Array.isArray(input.decisions)) throw new Error('decisions must be an array');
  const fen = serializedTreeRootFen(tree);
  if (!fen || fen.trim().split(/\s+/).length < 6) throw new Error('chapter needs a dealt root');
  const parsed = parseJieqiFen(fen);
  if (!parsed.ok) throw new Error('invalid jieqi root');
  let state = parsed.state;
  const reveals = new Map<number, 'red' | 'black'>();
  for (const [index, token] of serializedTreeMainline(tree).entries()) {
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
    if (!match) break;
    const move = { from: match[1], to: match[2] } as JieqiMove;
    const piece = state.board[move.from];
    if (!piece || piece.unknown) break;
    const next = applyJieqiMove(state, move);
    if (next === state) break;
    if (piece.faceDown) reveals.set(index + 1, piece.color);
    state = next;
  }
  const seen = new Set<number>();
  const decisions = input.decisions.map((raw): StudyJieqiDecision => {
    const row = object(raw);
    keys(row, ['ply', 'mover', 'playedWin', 'realizedWin', 'bestWin', 'playedRank', 'candidates']);
    const ply = row.ply;
    if (typeof ply !== 'number' || !Number.isInteger(ply) || !reveals.has(ply) || seen.has(ply))
      throw new Error('ply must identify a unique mainline face-down move (first move = 1)');
    if (row.mover !== reveals.get(ply)) throw new Error('mover does not match chapter');
    seen.add(ply);
    const result: StudyJieqiDecision = {
      ply,
      mover: row.mover as 'red' | 'black',
      playedWin: win(row.playedWin),
      realizedWin: win(row.realizedWin),
    };
    if (row.bestWin !== undefined) result.bestWin = win(row.bestWin);
    if (row.playedRank !== undefined) {
      if (
        row.playedRank !== null &&
        (typeof row.playedRank !== 'number' ||
          !Number.isInteger(row.playedRank) ||
          row.playedRank < 1)
      )
        throw new Error('invalid playedRank');
      result.playedRank = row.playedRank as number | null;
    }
    if (row.candidates !== undefined) {
      if (!Array.isArray(row.candidates)) throw new Error('invalid candidates');
      result.candidates = row.candidates.map((raw) => {
        const candidate = object(raw);
        keys(candidate, ['move', 'win', 'played']);
        if (typeof candidate.move !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(candidate.move))
          throw new Error('invalid candidate UCI');
        if (candidate.played !== undefined && typeof candidate.played !== 'boolean')
          throw new Error('invalid candidate played');
        return {
          move: candidate.move,
          win: win(candidate.win),
          ...(candidate.played === undefined ? {} : { played: candidate.played as boolean }),
        };
      });
    }
    return result;
  });
  return { engineId: input.engineId, source: input.source, decisions };
}
