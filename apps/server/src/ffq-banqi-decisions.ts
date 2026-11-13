// Decided 2026-11-13: only public FENs enter the luck computation.
import { FFQ_BANQI_DAMAGE, type FFQBanqiMove, winPercent } from '@mistboard/game';
import type { BanqiDecision, BanqiDecisionCandidate } from './banqi-analysis.js';
import { FFQ_BANQI_ANALYSIS_DEPTH, FFQ_BANQI_ANALYSIS_ENGINE_ID } from './ffq-banqi-analysis.js';
import { ffqBanqiMoveToUci, uciToFFQBanqiMove } from './ffq-banqi-engine.js';
import { type FFQPublicSearch, searchFFQPublicFen } from './ffq-banqi-public-analysis.js';
import { ffqBanqiPostgameHistory } from './ffq-banqi-replay.js';
import type { FFQBanqiEvent } from './ffq-banqi-tenant.js';
import {
  type AnalysisProgressStore,
  type GameAnalysisCacheOps,
  liveAnalysisProgressStore,
  mapWithConcurrency,
  resolveCachedComputation,
} from './game-analysis-kernel.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import * as persistence from './persistence.js';

export const FFQ_BANQI_DECISION_NODES = 25_000;
export const FFQ_BANQI_DECISIONS_ENGINE_ID = `${FFQ_BANQI_ANALYSIS_ENGINE_ID.replace('-analysis@', '-decisions@')}-d1-top-played`;
export type FFQBanqiDecisionsCache = GameAnalysisCacheOps<BanqiDecision[]>;
const LETTERS = 'GAERHCSgaerhcs';
const ROLES = ['general', 'advisor', 'elephant', 'chariot', 'horse', 'cannon', 'soldier'] as const;

function parse(fen: string) {
  const fields = fen.split(' ');
  if (fields.length !== 11 || !/^[rb]$/.test(fields[1]!)) throw new Error('ffq_decisions_bad_fen');
  const board: string[] = [];
  const rows = fields[0]!.split('/');
  if (rows.length !== 8) throw new Error('ffq_decisions_bad_board');
  for (const row of rows.reverse()) {
    const squares = [...row].flatMap((c) =>
      /[1-4]/.test(c) ? Array<string>(Number(c)).fill('') : [c],
    );
    if (squares.length !== 4 || squares.some((c) => c && !`${LETTERS}X`.includes(c)))
      throw new Error('ffq_decisions_bad_board');
    board.push(...squares);
  }
  const pool = new Map<string, number>();
  const field = fields[8]!;
  let consumed = '';
  for (const match of field.matchAll(/([GAERHCSgaerhcs])(\d+)/g)) {
    consumed += match[0];
    if (pool.has(match[1]!) || Number(match[2]) <= 0) throw new Error('ffq_decisions_bad_pool');
    pool.set(match[1]!, Number(match[2]));
  }
  if (field !== '-' && consumed !== field) throw new Error('ffq_decisions_bad_pool');
  return { fields, board, pool };
}

function write(position: ReturnType<typeof parse>): string {
  const { fields, board, pool } = position;
  const rows: string[] = [];
  for (let y = 7; y >= 0; y--) {
    let row = '',
      empty = 0;
    for (const piece of board.slice(y * 4, y * 4 + 4)) {
      if (!piece) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += piece;
      }
    }
    rows.push(row + (empty || ''));
  }
  fields[0] = rows.join('/');
  fields[8] =
    [...LETTERS].flatMap((t) => (pool.get(t) ? [`${t}${pool.get(t)}`] : [])).join('') || '-';
  return fields.join(' ');
}

export function ffqChanceOutcomeFen(fen: string, move: FFQBanqiMove, identity: string): string {
  const position = parse(fen);
  const { fields, board, pool } = position;
  const count = pool.get(identity) ?? 0;
  if (!count || board[move.to] !== 'X') throw new Error('ffq_decisions_invalid_chance');
  pool.set(identity, count - 1);
  if (move.from === move.to) board[move.to] = identity;
  else {
    if (board[move.from] !== (fields[1] === 'r' ? 'C' : 'c'))
      throw new Error('ffq_decisions_not_cannon');
    board[move.to] = board[move.from]!;
    board[move.from] = '';
    const hp = identity === identity.toUpperCase() ? 2 : 3;
    fields[hp] = String(
      Math.max(0, Number(fields[hp]) - FFQ_BANQI_DAMAGE[ROLES[LETTERS.indexOf(identity) % 7]!]),
    );
  }
  fields[1] = fields[1] === 'r' ? 'b' : 'r';
  fields[4] = fields[5] = fields[6] = '0';
  if (fields[1] === 'r') fields[7] = String(Number(fields[7]) + 1);
  return write(position);
}

/** Values are mover-seat win%, including friendly covered cannon victims. */
export async function evaluateFFQBanqiChanceDecision(
  before: string,
  after: string,
  played: FFQBanqiMove,
  ply: number,
  search: FFQPublicSearch = searchFFQPublicFen,
): Promise<BanqiDecision> {
  const pre = parse(before),
    post = parse(after);
  if (pre.board[played.to] !== 'X') throw new Error('ffq_decisions_not_chance');
  const mover = pre.fields[1] === 'r' ? 'red' : 'black';
  const win = async (fen: string) => {
    const fields = fen.split(' ');
    if (Number(fields[2]) <= 0 || Number(fields[3]) <= 0) {
      const winner = Number(fields[2]) <= 0 ? (Number(fields[3]) <= 0 ? null : 'black') : 'red';
      return winner === null ? 50 : winner === mover ? 100 : 0;
    }
    const result = await search(fen);
    if (result.cp === null && result.mate === null) throw new VacuousAnalysisError('ffq-banqi');
    const sign = fields[1] === pre.fields[1] ? 1 : -1;
    return winPercent(
      result.cp === null ? null : sign * result.cp,
      result.mate === null ? null : sign * result.mate,
      FFQ_BANQI_DECISIONS_ENGINE_ID,
    );
  };
  const root = await search(before);
  const top = root.best && uciToFFQBanqiMove(root.best);
  if (!top) throw new Error('ffq_decisions_missing_top_move');
  const playedUci = ffqBanqiMoveToUci(played);
  const candidates = new Map([
    [playedUci, played],
    [root.best!, top],
  ]);
  const outcomes = [...LETTERS].filter((t) => pre.pool.has(t));
  const total = outcomes.reduce((sum, t) => sum + pre.pool.get(t)!, 0);
  const realized = outcomes.filter((t) => pre.pool.get(t)! - (post.pool.get(t) ?? 0) === 1);
  if (realized.length !== 1) throw new Error('ffq_decisions_missing_realized_outcome');
  const realizedFen = ffqChanceOutcomeFen(before, played, realized[0]!);
  if (realizedFen !== after) throw new Error('ffq_decisions_public_transition_mismatch');
  let playedWin = 0,
    realizedWin = 0;
  const scored: BanqiDecisionCandidate[] = [];
  for (const [uci, move] of candidates) {
    let value: number;
    if (pre.board[move.to] === 'X') {
      const values = await mapWithConcurrency(outcomes, 2, (t) =>
        win(ffqChanceOutcomeFen(before, move, t)),
      );
      const reference = values[0]!;
      value =
        reference +
        outcomes.reduce(
          (sum, t, i) => sum + (pre.pool.get(t)! / total) * (values[i]! - reference),
          0,
        );
      if (uci === playedUci) realizedWin = values[outcomes.indexOf(realized[0]!)]!;
    } else {
      // Decided 2026-11-13: the plain top move uses its shared pre-move score.
      if (root.cp === null && root.mate === null) throw new VacuousAnalysisError('ffq-banqi');
      value = winPercent(root.cp, root.mate, FFQ_BANQI_DECISIONS_ENGINE_ID);
    }
    if (uci === playedUci) playedWin = value;
    scored.push({ move: uci, win: value, ...(uci === playedUci ? { played: true } : {}) });
  }
  scored.sort((a, b) => b.win - a.win || a.move.localeCompare(b.move));
  return {
    ply,
    mover,
    playedWin,
    realizedWin,
    bestWin: scored[0]!.win,
    playedRank: 1 + scored.filter((c) => c.win > playedWin + 1e-9).length,
    candidates: scored,
  };
}

export type FFQPublicTrack = {
  frames: readonly { fen: string }[];
  moves: readonly FFQBanqiMove[];
};

export function ffqBanqiPublicTrack(events: readonly FFQBanqiEvent[]): FFQPublicTrack {
  if (events[0]?.type !== 'room-created' || !events[0].setup)
    throw new Error('ffq_decisions_missing_deal');
  return {
    frames: ffqBanqiPostgameHistory(events).truth.map(({ fen }) => ({ fen })),
    moves: events.flatMap((event) => (event.type === 'move-played' ? [event.move] : [])),
  };
}

export async function analyzeFFQBanqiDecisions(
  track: FFQPublicTrack,
  search: FFQPublicSearch = searchFFQPublicFen,
  progress?: AnalysisProgressStore<BanqiDecision>,
): Promise<BanqiDecision[]> {
  const resumed = await progress?.load();
  const decisions = resumed ? [...resumed.items] : [];
  for (let i = resumed?.nextIndex ?? 0; i < track.moves.length; i++) {
    const before = track.frames[i]!.fen,
      after = track.frames[i + 1]!.fen,
      move = track.moves[i]!;
    if (parse(before).board[move.to] === 'X')
      decisions.push(await evaluateFFQBanqiChanceDecision(before, after, move, i + 1, search));
    await progress?.save({ nextIndex: i + 1, items: decisions });
  }
  return decisions;
}

const liveCache: FFQBanqiDecisionsCache = {
  get: (room, engine, depth) => persistence.getGameAnalysisBlob(room, engine, depth),
  save: (room, engine, depth, rows) => persistence.saveGameAnalysisBlob(room, engine, depth, rows),
};
export async function resolveFFQBanqiDecisions(
  roomId: string,
  events: readonly FFQBanqiEvent[],
  cache = liveCache,
  analyze?: (track: FFQPublicTrack) => Promise<BanqiDecision[]>,
  computeIfMissing = true,
) {
  const engineId = FFQ_BANQI_DECISIONS_ENGINE_ID,
    depth = FFQ_BANQI_ANALYSIS_DEPTH;
  const progress = analyze
    ? null
    : liveAnalysisProgressStore<BanqiDecision>(roomId, engineId, depth);
  const decisions = await resolveCachedComputation({
    roomId,
    engineId,
    depth,
    cache,
    computeIfMissing,
    compute: () =>
      analyze
        ? analyze(ffqBanqiPublicTrack(events))
        : analyzeFFQBanqiDecisions(ffqBanqiPublicTrack(events), undefined, progress ?? undefined),
    afterSave: progress ? () => progress.clear() : undefined,
  });
  return decisions ? { engineId, depth, decisions } : null;
}
