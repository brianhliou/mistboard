// The Duck Xiangqi rules page's sample game: Game 1 of the companion study (Fairy-Stockfish
// against itself at full strength, eight seconds a move), the game the page already embeds,
// kept beside the plan as plans/duck-xiangqi.game.json. Read again by the same patched
// Fairy-Stockfish on this Mac and annotated by the pipeline.
//
//   npx tsx scripts/variant-lab/rules-page-games/duck-xiangqi.ts jobs --engine FSF_DUCK
//   python3 -I scripts/variant-lab/rules-page-games/analyse.py \
//     --jobs scripts/variant-lab/rules-page-games/plans/duck-xiangqi.jobs.json \
//     --out scripts/variant-lab/rules-page-games/plans/duck-xiangqi.rows.jsonl
//   npx tsx scripts/variant-lab/rules-page-games/duck-xiangqi.ts build \
//     --rows scripts/variant-lab/rules-page-games/plans/duck-xiangqi.rows.jsonl
//
// FSF_DUCK is the prod recipe's binary (scripts/engine-assets.sh): Fairy-Stockfish at
// fairy-stockfish-duck-xiangqi.ref with fairy-stockfish-duck-xiangqi.patch, largeboards,
// classical eval, passing the recipe's three perft gates (2554, 430, 431).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_START_FEN,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  isDuckXiangqiLegalTurn,
  winPercent,
} from '@mistboard/game';
import { annotateFromEngine, type EngineSideline, judgedMoves } from '../../study-annotate.ts';
import { cli, noted, PLANS, type Row, readNotes, readRows, report, writePlan } from './common.ts';

const { mode, arg } = cli();
const game = JSON.parse(readFileSync(resolve(PLANS, 'duck-xiangqi.game.json'), 'utf8')) as {
  red: string;
  black: string;
  event: string;
  moves: string[];
};
const moves = game.moves;

/** The study's token (`b3b5@d9`, no duck on a game-ending capture) as a kernel turn. */
function turnOf(token: string): DuckXiangqiTurn | null {
  const m = /^([a-i]\d+)([a-i]\d+)(?:@([a-i]\d+))?$/.exec(token);
  if (!m) return null;
  return {
    from: m[1] as DuckXiangqiSquare,
    to: m[2] as DuckXiangqiSquare,
    duckTo: (m[3] as DuckXiangqiSquare | undefined) ?? null,
  };
}
/** Fairy-Stockfish's gating form (`b3b5,b5d9`) as a study token. */
function tokenOfUci(uci: string): string | null {
  const [piece, duck] = uci.split(',');
  const m = /^([a-i]\d+)([a-i]\d+)$/.exec(piece ?? '');
  if (!m) return null;
  const d = duck ? /^[a-i]\d+([a-i]\d+)$/.exec(duck) : null;
  return `${m[1]}${m[2]}${d ? `@${d[1]}` : ''}`;
}
/** A study token in Fairy-Stockfish's gating form. */
function uciOfToken(token: string): string {
  const t = turnOf(token);
  if (!t) throw new Error(`not a duck move: ${token}`);
  return t.duckTo ? `${t.from}${t.to},${t.to}${t.duckTo}` : `${t.from}${t.to}`;
}
const legalAfter = (s: DuckXiangqiGameState, token: string) => {
  const t = turnOf(token);
  return t && s.status.type === 'playing' && isDuckXiangqiLegalTurn(s, t)
    ? applyDuckXiangqiTurn(s, t)
    : null;
};

const states: DuckXiangqiGameState[] = [createInitialDuckXiangqiState('rules-duck')];
for (const [i, u] of moves.entries()) {
  const next = legalAfter(states[i]!, u);
  if (!next) throw new Error(`ply ${i + 1}: ${u} is illegal`);
  states.push(next);
}
const final = states.at(-1)!.status;
if (final.type !== 'finished' || final.winner !== 'black') throw new Error('Game 1 is a Black win');

const ini = resolve(import.meta.dirname, '../../../apps/server/src/duck-xiangqi.ini');
const engineOptions = [
  `VariantPath value ${ini}`,
  'UCI_Variant value duckxiangqi',
  'Use NNUE value false',
  'Threads value 1',
  'Hash value 256',
];
// Fairy-Stockfish reads the duck as part of a move, so each position is the start plus
// the moves so far in its gating form, as the server's own engine call spells it.
const uci = moves.map(uciOfToken);
const CONFIRM_MS = 12_000;

/** Red's expected score from a row in the side to move's view at position i. */
const redOf = (i: number, r: { cp?: number | null; mate?: number | null }) => {
  const w = winPercent(r.cp ?? null, r.mate ?? null) / 100;
  return i % 2 === 0 ? w : 1 - w;
};

/** Each move graded against the best move from its own position, both searched from that
 *  position: this engine's score swings by thirty points with the side to move, so the
 *  next position's search is never the yardstick. Rows `long` (a 12-second search of the
 *  position and of the played move) replace the 4-second pair where present. */
function grading(rows: Map<string, Row>, long: Map<string, Row>) {
  const pick = (kind: 'p' | 'm', i: number) => {
    const r = long.get(`${kind.toUpperCase()}${i}`) ?? rows.get(`${kind}${i}`);
    if (!r) throw new Error(`no ${kind} search at ${i}`);
    return r;
  };
  const redScore = moves.map((_, i) => redOf(i, pick('p', i)));
  redScore.push(0); // Black takes the general.
  const best = moves.map((_, i) => {
    const b = pick('p', i).best;
    return b ? tokenOfUci(b) : null;
  });
  // The last move takes the general: it is the win itself.
  const moveScore = moves.map((_, i) => (i === moves.length - 1 ? 0 : redOf(i, pick('m', i))));
  return { redScore, best, moveScore, pick };
}

if (mode === 'jobs') {
  const jobs = moves.map((_, i) => ({
    id: `p${i}`,
    fen: DUCK_XIANGQI_START_FEN,
    moves: uci.slice(0, i),
  }));
  // The played move searched from the same position. This engine's score swings by the side
  // to move (the mover also places the duck), so a move is graded against the best move from
  // its own position, never against the next position's search.
  const played = moves.map((_, i) => ({
    id: `m${i}`,
    fen: DUCK_XIANGQI_START_FEN,
    moves: uci.slice(0, i),
    searchmoves: uci[i],
  }));
  writePlan('duck-xiangqi', 'jobs', {
    engine: { binary: arg('--engine'), options: engineOptions },
    limit: { movetime: Number(arg('--movetime', '4000')) },
    jobs: [...jobs, ...played],
  });
} else if (mode === 'confirm') {
  // Every move the 4-second pair marks, searched again for three times as long, both the
  // position and the played move; split in two files so two engines can run at once.
  const { redScore, best, moveScore } = grading(readRows(arg('--rows')), new Map());
  const flagged = judgedMoves({ rootFen: DUCK_XIANGQI_START_FEN, moves, redScore, best, moveScore })
    .map((m) => m.ply - 1)
    .filter((i) => i < moves.length - 1);
  const jobs = flagged.flatMap((i) => [
    { id: `P${i}`, fen: DUCK_XIANGQI_START_FEN, moves: uci.slice(0, i) },
    { id: `M${i}`, fen: DUCK_XIANGQI_START_FEN, moves: uci.slice(0, i), searchmoves: uci[i] },
  ]);
  for (const half of [0, 1]) {
    writePlan(`duck-xiangqi.confirm${half}`, 'jobs', {
      engine: { binary: arg('--engine'), options: engineOptions },
      limit: { movetime: CONFIRM_MS },
      jobs: jobs.filter((_, k) => Math.floor(k / 2) % 2 === half),
    });
  }
  console.log(`${flagged.length} moves to confirm: ${flagged.map((i) => i + 1).join(' ')}`);
} else if (mode === 'build') {
  const long = new Map<string, Row>();
  for (const half of [0, 1]) {
    const f = resolve(PLANS, `duck-xiangqi.confirm${half}.rows.jsonl`);
    if (existsSync(f)) for (const [k, v] of readRows(f)) long.set(k, v);
  }
  const { redScore, best, moveScore, pick } = grading(readRows(arg('--rows')), long);
  // Inaccuracies are not marked: the 4- and 12-second gradings of the same move differ by a
  // median 6.7 points (33 moves), wider than the whole ?! band (5 to 10).
  const base = {
    rootFen: DUCK_XIANGQI_START_FEN,
    moves,
    redScore,
    best,
    moveScore,
    floor: '?' as const,
  };
  const marks = judgedMoves(base);
  const sidelines: EngineSideline[] = [];
  for (const m of marks) {
    const i = m.ply - 1;
    let s = states[i]!;
    const line: string[] = [];
    // A search cut off by its time limit can return a best move with no PV: the line is then
    // the best move alone.
    const searched = pick('p', i);
    const pv = searched.pv.length ? searched.pv : searched.best ? [searched.best] : [];
    for (const u of pv) {
      const t = tokenOfUci(u);
      const next = t && legalAfter(s, t);
      if (!t || !next || line.length === 6) break;
      line.push(t);
      s = next;
    }
    if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
  }
  const notes = readNotes('duck-xiangqi');
  const tree = annotateFromEngine({ ...base, sidelines, ...noted(notes, sidelines) });
  writePlan('duck-xiangqi', 'plan', {
    create: {
      owner: 'mistboard',
      name: 'Duck Xiangqi: a sample game, annotated',
      description:
        'Fairy-Stockfish against itself at full strength, eight seconds a move, read again by Fairy-Stockfish. From the Duck Xiangqi rules page at mistboard.com/rules/duck-xiangqi.',
      visibility: 'public',
      chapter: {
        name: notes.title ?? 'Fairy-Stockfish against itself',
        variant: 'duck-xiangqi',
        orientation: 'red',
        tree,
        // No score chart: the engine's score swings by thirty points with the side to move,
        // so a per-position series would draw a sawtooth, not the game.
        tags: { red: game.red, black: game.black, result: '0-1', event: game.event },
      },
    },
    ops: [],
  });
  report(marks, sidelines);
} else {
  throw new Error('mode: jobs | build');
}
