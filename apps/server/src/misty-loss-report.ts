// Operator-only, finished-game analysis. Never feed this truth FEN to a live
// engine request or publish it through a player-facing API.
import {
  applyGameEvent,
  type Color,
  darkChessFen,
  darkChessVariant,
  type GameEvent,
  type GameState,
  initialGameProjection,
  type Move,
  parseStandardChessFen,
  standardChessVariant,
} from '@mistboard/game';
import { resolveStockfishPath } from './engine-paths.js';
import { UciEngineSession, type UciMultiPvEval } from './uci-engine-harness.js';

export type MistyDecisionRecord = {
  /** Context cursor: the number of plies BEFORE the engine move. */
  ply: number | null;
  engineColor: Color | null;
  payload: Record<string, unknown>;
};

export type MistyLossGame = {
  gameId: string;
  engineColor: Color;
  events: GameEvent[];
  decisions: MistyDecisionRecord[];
};

/** Both scores are mover POV at the SAME root and fixed depth. Mate scores
 * use a +/-30000cp sentinel for ranking; original mate distances stay visible. */
export type MistyMoveGrade = {
  bestMove: string;
  bestCp: number;
  playedCp: number;
  bestMate: number | null;
  playedMate: number | null;
};
export type MistyGrader = (fen: string, played: string) => Promise<MistyMoveGrade | null>;

export type MistyWorstMove = MistyMoveGrade & {
  gameId: string;
  gameUrl: string;
  ply: number;
  engineColor: Color;
  fen: string;
  playedMove: string;
  dropPawns: number;
  beliefSize: number | null;
  bestMoveVisible: boolean;
  bestMoveLegal: boolean;
  bestMoveRank: number | null;
  commitGuardChangedMove: boolean | null;
  rankingTopDiffersFromPlayed: boolean | null;
  decisionStatus: 'matched' | 'missing' | 'mismatched' | 'duplicate';
};

export type MistyLossReport = {
  gamesAnalyzed: number;
  ranked: MistyWorstMove[];
  skipped: Array<{ gameId: string; ply: number; reason: 'stockfish-incompatible' }>;
};

function moveUci(move: Move, state: GameState): string {
  const promotion = move.promotion
    ? { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[move.promotion]
    : '';
  let to = move.to;
  const piece = state.board[move.from];
  const target = state.board[move.to];
  // Kernel logs permit king-to-rook castling; ordinary Stockfish uses the
  // king's destination. Normalize events and stored rankings to the latter.
  if (piece?.role === 'king' && target?.role === 'rook' && target.color === piece.color) {
    to = `${to[0] > move.from[0] ? 'g' : 'c'}${move.from[1]}` as Move['to'];
  }
  return `${move.from}${to}${promotion}`;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function decisionContext(
  game: MistyLossGame,
  ply: number,
  played: string,
  best: string,
  state: GameState,
) {
  const records = game.decisions.filter(
    (record) => record.ply === ply - 1 && record.engineColor === game.engineColor,
  );
  const move = object(records[0]?.payload.move);
  const storedMove = moveUci(move as Move, state);
  const decisionStatus: MistyWorstMove['decisionStatus'] =
    records.length === 0
      ? 'missing'
      : records.length > 1
        ? 'duplicate'
        : storedMove !== played
          ? 'mismatched'
          : 'matched';
  const d = decisionStatus === 'matched' ? object(records[0].payload.engine_diagnostics) : {};
  const ranking =
    Array.isArray(d.moveRanking) &&
    d.moveRanking.every(
      (row) =>
        Array.isArray(row) &&
        typeof row[0] === 'string' &&
        typeof row[1] === 'number' &&
        Number.isFinite(row[1]),
    )
      ? (d.moveRanking as Array<[string, number]>).map(([uci, value]): [string, number] => [
          normalizeUci(uci, state),
          value,
        ])
      : null;
  const bestRank = ranking?.findIndex(([move]) => move === best) ?? -1;
  return {
    decisionStatus,
    beliefSize:
      typeof d.beliefSize === 'number' && Number.isSafeInteger(d.beliefSize) && d.beliefSize >= 0
        ? d.beliefSize
        : null,
    bestMoveRank: bestRank < 0 ? null : bestRank + 1,
    // A top-ranked/played mismatch is evidence of a substitution, but alone
    // cannot identify a commit guard. Older records do not record this flag.
    commitGuardChangedMove:
      typeof d.commitGuardChangedMove === 'boolean' ? d.commitGuardChangedMove : null,
    rankingTopDiffersFromPlayed: ranking?.length ? ranking[0][0] !== played : null,
  };
}

function replayLoss(game: MistyLossGame) {
  const invalid = () => new Error('invalid finished Fog loss event log');
  if (game.events[0]?.type !== 'room-created') throw invalid();
  let projection = initialGameProjection(game.gameId);
  const moves = [];
  let ply = 0;
  for (const [index, event] of game.events.entries()) {
    if (event.roomId !== game.gameId || (index > 0 && event.type === 'room-created'))
      throw invalid();
    const before = projection;
    projection = applyGameEvent(projection, event);
    if (projection.variant !== 'dark-chess') throw invalid();
    if (event.type === 'move-played') {
      if (projection.state === before.state) throw invalid();
      ply += 1;
      if (event.color === game.engineColor) {
        moves.push({ ply, state: before.state, played: moveUci(event.move, before.state) });
      }
    }
  }
  const status = projection.state.status;
  if (
    ply < 2 ||
    status.type !== 'finished' ||
    status.winner === null ||
    status.winner === game.engineColor
  )
    throw invalid();
  return moves;
}

export async function buildMistyLossReport(
  games: MistyLossGame[],
  grade: MistyGrader,
): Promise<MistyLossReport> {
  const ids = new Set<string>();
  // Validate every log before starting expensive engine work.
  const replayed = games
    .map((game) => {
      if (ids.has(game.gameId)) throw new Error('duplicate game in loss report');
      ids.add(game.gameId);
      return { game, moves: replayLoss(game) };
    })
    .sort((a, b) => compareId(a.game.gameId, b.game.gameId));
  const ranked: MistyWorstMove[] = [];
  const skipped: MistyLossReport['skipped'] = [];
  for (const { game, moves } of replayed) {
    let worst: MistyWorstMove | null = null;
    for (const { ply, state, played } of moves) {
      const fen = darkChessFen(state);
      const evaluation = await grade(fen, played);
      if (!evaluation) {
        skipped.push({ gameId: game.gameId, ply, reason: 'stockfish-incompatible' });
        continue;
      }
      if (!Number.isFinite(evaluation.bestCp) || !Number.isFinite(evaluation.playedCp)) {
        throw new Error('grader returned a non-finite score');
      }
      const dropPawns =
        evaluation.bestMove === played
          ? 0
          : Math.max(0, evaluation.bestCp - evaluation.playedCp) / 100;
      if (dropPawns <= 0 || (worst && worst.dropPawns >= dropPawns)) continue;
      const view = darkChessVariant.getPlayerView(state, game.engineColor);
      worst = {
        ...evaluation,
        gameId: game.gameId,
        gameUrl: `https://mistboard.com/game/${encodeURIComponent(game.gameId)}`,
        ply,
        engineColor: game.engineColor,
        fen,
        playedMove: played,
        dropPawns,
        bestMoveVisible: view.visibleSquares.includes(
          evaluation.bestMove.slice(2, 4) as Move['to'],
        ),
        bestMoveLegal: view.legalMoves.some((move) => moveUci(move, state) === evaluation.bestMove),
        ...decisionContext(game, ply, played, evaluation.bestMove, state),
      };
    }
    if (worst) ranked.push(worst);
  }
  ranked.sort(
    (a, b) => b.dropPawns - a.dropPawns || compareId(a.gameId, b.gameId) || a.ply - b.ply,
  );
  return { gamesAnalyzed: games.length, ranked, skipped };
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeUci(uci: string, state: GameState): string {
  // Promotions already use UCI; only the first four characters can change.
  const move = { from: uci.slice(0, 2), to: uci.slice(2, 4) } as Move;
  return `${moveUci(move, state)}${uci.slice(4)}`;
}

function score(evaluation: UciMultiPvEval, depth: number): number {
  if (evaluation.lines.find((line) => line.index === 1)?.bound !== null) {
    throw new Error('Stockfish returned no exact score');
  }
  if (evaluation.mate !== null) return evaluation.mate > 0 ? 30000 : -30000;
  if (evaluation.depth < depth || evaluation.cp === null || !Number.isFinite(evaluation.cp)) {
    throw new Error('Stockfish did not complete the requested depth with a score');
  }
  return evaluation.cp;
}

export async function withMistyStockfishGrader<T>(
  run: (grade: MistyGrader) => Promise<T>,
  options: { bin?: string; depth?: number; timeoutMs?: number } = {},
): Promise<T> {
  const bin = options.bin ?? resolveStockfishPath();
  const depth = options.depth ?? 18;
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!bin) throw new Error('Stockfish binary not found');
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 30) throw new Error('invalid depth');
  const session = new UciEngineSession({
    bin,
    initCommands: [
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 64',
      'setoption name MultiPV value 1',
      'ucinewgame',
      'isready',
    ],
    name: 'Misty loss report Stockfish',
  });
  try {
    await session.ready();
    return await run(async (fen, played) => {
      const parsed = parseStandardChessFen(fen);
      if (!parsed.ok || parsed.state.status.type !== 'playing') return null;
      const legal = standardChessVariant.getLegalMoves(parsed.state, parsed.state.status.turn);
      // Stockfish's rules differ from Fog (check, king captures, castling in
      // check). Never send an invalid root/searchmove to the subprocess.
      const normalizedPlayed = normalizeUci(played, parsed.state);
      if (!legal.some((move) => moveUci(move, parsed.state) === normalizedPlayed)) return null;
      const evaluate = (searchMove?: string) =>
        session.multiPvPosition({
          // Clearing the TT before EACH search removes input-order dependence.
          positionCommand: `ucinewgame\nposition fen ${fen}`,
          goCommand: `go depth ${depth}${searchMove ? ` searchmoves ${searchMove}` : ''}`,
          timeoutMs,
          timeoutMessage: 'Misty loss report Stockfish search timed out',
        });
      const best = await evaluate();
      if (!best.best || !legal.some((move) => moveUci(move, parsed.state) === best.best)) {
        throw new Error('Stockfish returned no legal best move');
      }
      const bestCp = score(best, depth);
      const forced = best.best === normalizedPlayed ? best : await evaluate(normalizedPlayed);
      if (forced.best !== normalizedPlayed) throw new Error('Stockfish ignored the forced move');
      return {
        bestMove: best.best,
        bestCp,
        playedCp: score(forced, depth),
        bestMate: best.mate,
        playedMate: forced.mate,
      };
    });
  } finally {
    session.close();
  }
}

export function renderMistyLossReport(report: MistyLossReport): string {
  const lines = [
    '# Misty losses to people',
    '',
    `${report.gamesAnalyzed} counted losses analyzed; ${report.ranked.length} games with a scored drop; ${report.skipped.length} ungradable moves.`,
    '',
    "Scores compare best vs forced played move at the same root, in pawns from Misty's POV. Mate scores use a 300-pawn sentinel; see the mate fields. Unknown telemetry is marked unknown.",
    '',
  ];
  for (const [index, row] of report.ranked.entries()) {
    lines.push(
      `${index + 1}. [${row.gameId}](${row.gameUrl}), ply ${row.ply} (${row.engineColor}): ${row.playedMove} vs **${row.bestMove}**, **${row.dropPawns.toFixed(2)} pawns dropped**.`,
      `   - FEN: \`${row.fen}\``,
      `   - Belief size: ${row.beliefSize ?? 'unknown'}; best move visible: ${row.bestMoveVisible ? 'yes' : 'no'}; legal in Misty's view: ${row.bestMoveLegal ? 'yes' : 'no'}; Misty rank: ${row.bestMoveRank ?? 'unknown'}.`,
      `   - Commit guard changed move: ${yesNo(row.commitGuardChangedMove)}; ranking top differs from played: ${yesNo(row.rankingTopDiffersFromPlayed)}; decision: ${row.decisionStatus}.`,
      `   - Best: ${row.bestCp}cp (mate ${row.bestMate ?? 'none'}); played: ${row.playedCp}cp (mate ${row.playedMate ?? 'none'}).`,
      '',
    );
  }
  for (const row of report.skipped)
    lines.push(`- Ungradable: ${row.gameId}, ply ${row.ply}: ${row.reason}.`);
  return `${lines.join('\n')}\n`;
}

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}
