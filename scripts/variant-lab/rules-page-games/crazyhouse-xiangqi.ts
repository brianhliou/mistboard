// The Crazyhouse Xiangqi rules page's sample game: "Win 3: a comeback, and a soldier drop
// mates" from the six-game engine study (Fairy-Stockfish against itself, five seconds a
// move, scripts/data/crazyhouse-xiangqi-study.json), the game the page already embeds.
// Read again by the same Fairy-Stockfish on this Mac and annotated by the pipeline; the
// study's own per-move notes ride along as comments.
//
//   npx tsx scripts/variant-lab/rules-page-games/crazyhouse-xiangqi.ts jobs --engine FSF
//   python3 -I scripts/variant-lab/rules-page-games/analyse.py \
//     --jobs scripts/variant-lab/rules-page-games/plans/crazyhouse-xiangqi.jobs.json \
//     --out scripts/variant-lab/rules-page-games/plans/crazyhouse-xiangqi.rows.jsonl
//   npx tsx scripts/variant-lab/rules-page-games/crazyhouse-xiangqi.ts build \
//     --rows scripts/variant-lab/rules-page-games/plans/crazyhouse-xiangqi.rows.jsonl
//
// FSF is the classical Fairy-Stockfish build (~/projects/tools/fairy-stockfish/src/stockfish)
// with the site's variant file, apps/server/src/crazyhouse-xiangqi.ini.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_START_FEN,
  type CrazyhouseXiangqiGameState,
  crazyhouseXiangqiFen,
  crazyhouseXiangqiMoveFromUci,
  createInitialCrazyhouseXiangqiState,
  isCrazyhouseXiangqiLegalMove,
  winPercent,
} from '@mistboard/game';
import { CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID } from '../../../apps/server/src/crazyhouse-xiangqi-fsf-engine.ts';
import { annotateFromEngine, type EngineSideline, judgedMoves } from '../../study-annotate.ts';
import { cli, noted, readNotes, readRows, report, writePlan } from './common.ts';

const GAME = 'Win 3:';
const { mode, arg } = cli();
const data = JSON.parse(
  readFileSync(new URL('../../data/crazyhouse-xiangqi-study.json', import.meta.url), 'utf8'),
) as {
  games: {
    name: string;
    moves: string[];
    red: string;
    black: string;
    result: string;
    event: string;
    date?: string;
    notes?: Record<string, { text?: string }>;
  }[];
};
const game = data.games.find((g) => g.name.startsWith(GAME));
if (!game) throw new Error(`no ${GAME}`);
const moves = game.moves;

const states: CrazyhouseXiangqiGameState[] = [createInitialCrazyhouseXiangqiState('rules-chx')];
const legalAfter = (s: CrazyhouseXiangqiGameState, u: string) => {
  const m = crazyhouseXiangqiMoveFromUci(u);
  return m && s.status.type === 'playing' && isCrazyhouseXiangqiLegalMove(s, m)
    ? applyCrazyhouseXiangqiMove(s, m)
    : null;
};
for (const [i, u] of moves.entries()) {
  const next = legalAfter(states[i]!, u);
  if (!next) throw new Error(`ply ${i + 1}: ${u} is illegal`);
  states.push(next);
}
const final = states.at(-1)!.status;
if (final.type !== 'finished' || final.winner !== 'red') throw new Error('Win 3 is a Red win');

if (mode === 'jobs') {
  const bin = arg('--engine');
  const ini = resolve(import.meta.dirname, '../../../apps/server/src/crazyhouse-xiangqi.ini');
  const jobs = moves.map((_, i) => ({ id: `p${i}`, fen: crazyhouseXiangqiFen(states[i]!) }));
  writePlan('crazyhouse-xiangqi', 'jobs', {
    engine: {
      binary: bin,
      options: [
        `VariantPath value ${ini}`,
        'UCI_Variant value crazyhousexiangqi',
        'Use NNUE value false',
        'Threads value 1',
        'Hash value 256',
      ],
    },
    limit: { movetime: Number(arg('--movetime', '4000')) },
    jobs,
  });
} else if (mode === 'build') {
  const rows = readRows(arg('--rows'));
  const row = (i: number) => {
    const r = rows.get(`p${i}`);
    if (!r) throw new Error(`no search for position ${i}`);
    return r;
  };
  // Side-to-move POV in, Red POV out, on the site's own win curve for this engine.
  const redScore = moves.map((_, i) => {
    const r = row(i);
    const w = winPercent(r.cp ?? null, r.mate ?? null, CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID) / 100;
    return i % 2 === 0 ? w : 1 - w;
  });
  redScore.push(1); // Red mates.
  const best = moves.map((_, i) => row(i).best);
  const base = { rootFen: CRAZYHOUSE_XIANGQI_START_FEN, moves, redScore, best };
  const marks = judgedMoves(base);
  const sidelines: EngineSideline[] = [];
  for (const m of marks) {
    const i = m.ply - 1;
    let s = states[i]!;
    const line: string[] = [];
    for (const u of row(i).pv) {
      const next = legalAfter(s, u);
      if (!next || line.length === 6) break;
      line.push(u);
      s = next;
    }
    if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
  }
  const notes = readNotes('crazyhouse-xiangqi');
  // The study's own move notes stay, under any written for this reading.
  for (const [ply, n] of Object.entries(game.notes ?? {})) {
    if (n.text && !notes.comments[ply]) notes.comments[ply] = n.text;
  }
  const tree = annotateFromEngine({ ...base, sidelines, ...noted(notes, sidelines) });
  writePlan('crazyhouse-xiangqi', 'plan', {
    create: {
      owner: 'mistboard',
      name: 'Crazyhouse Xiangqi: a sample game, annotated',
      description:
        'Fairy-Stockfish against itself under the site rules, five seconds a move, read again by Fairy-Stockfish. From the Crazyhouse Xiangqi rules page at mistboard.com/rules/crazyhouse-xiangqi.',
      visibility: 'public',
      chapter: {
        name: notes.title ?? 'A comeback, and a soldier drop mates',
        variant: 'crazyhouse-xiangqi',
        orientation: 'red',
        tree,
        tags: {
          red: game.red,
          black: game.black,
          result: game.result,
          event: game.event,
          ...(game.date ? { date: game.date } : {}),
        },
        scoreSeries: {
          side: 'red',
          series: [{ name: 'Fairy-Stockfish', color: 'a', values: redScore }],
        },
      },
    },
    ops: [],
  });
  report(marks, sidelines);
} else {
  throw new Error('mode: jobs | build');
}
