// The xiangqi rules page's sample game: "Sacrifice the Horse in 13", the trap from a
// manual printed in 1632 that the page already stepped through, read by Pikafish on
// this Mac and annotated by the pipeline (scripts/study-annotate.ts).
//
//   npx tsx scripts/variant-lab/rules-page-games/xiangqi.ts jobs --engine PIKAFISH --out jobs.json
//   python3 -I scripts/variant-lab/rules-page-games/analyse.py --jobs jobs.json --out plans/xiangqi.rows.jsonl
//   npx tsx scripts/variant-lab/rules-page-games/xiangqi.ts build --rows plans/xiangqi.rows.jsonl
//   npx biome check --write scripts/variant-lab/rules-page-games/plans/xiangqi.plan.json
//
// PIKAFISH is the pikafish.ref build on the CC0 net (~/projects/tools/pikafish-6a59ee2f-cc0/src).
import {
  applyStandardXiangqiMove,
  createInitialStandardXiangqiState,
  isStandardXiangqiLegalMove,
  standardXiangqiEngineFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { annotateFromEngine, type EngineSideline, judgedMoves } from '../../study-annotate.ts';
import { cli, noted, readNotes, readRows, report, winFor, writePlan } from './common.ts';

const { mode, arg } = cli();
/** The page's game, in ICCS (ranks 0-9) as the old replay block held it. */
export const XIANGQI_TRAP_ICCS =
  'h2e2 h7e7 h0g2 h9g7 i0i1 i9h9 i1d1 h9h3 d1d8 b9a7 a0a1 b7b0 b2b7 g7h9 e2e6 f9e8 a1d1 e9f9 d8d9 e8d9 d1f1 e7f7 f1f7 f9e9 b7e7';
const shift = (u: string, d: number): string =>
  u.replace(
    /^([a-i])(\d)([a-i])(\d)$/,
    (_, a, r1, b, r2) => `${a}${Number(r1) + d}${b}${Number(r2) + d}`,
  );
const fromEngine = (u: string): string => shift(u, 1);
const move = (t: string): { from: XiangqiSquare; to: XiangqiSquare } => {
  const m = /^([a-i](?:10|\d))([a-i](?:10|\d))$/.exec(t)!;
  return { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare };
};
const moves = XIANGQI_TRAP_ICCS.split(' ').map((u) => shift(u, 1));
const root = createInitialStandardXiangqiState('rules-xiangqi-trap');
const states: XiangqiGameState[] = [root];
for (const [i, t] of moves.entries()) {
  if (!isStandardXiangqiLegalMove(states[i]!, move(t)))
    throw new Error(`ply ${i + 1}: ${t} is illegal`);
  states.push(applyStandardXiangqiMove(states[i]!, move(t)));
}
const fen = (i: number) => standardXiangqiEngineFen(states[i]!);
const NODES = Number(arg('--nodes', '4000000'));
/** Pikafish prints WDL (UCI_ShowWDL); this curve is only the fallback for a row without one. */
const K = 0.006;

if (mode === 'jobs') {
  const bin = arg('--engine');
  const jobs = moves.map((_, i) => ({ id: `p${i}`, fen: fen(i) }));
  for (const p of arg('--lines', '').split(',').filter(Boolean).map(Number)) {
    jobs.push({ id: `l${p - 1}`, fen: fen(p - 1), extend: 6 } as never);
  }
  const spec = {
    engine: {
      binary: bin,
      options: [
        'Threads value 1',
        'Hash value 256',
        'UCI_ShowWDL value true',
        `EvalFile value ${bin.replace(/[^/]+$/, '')}xiangqi-c07e94a5c7cb.nnue`,
      ],
    },
    limit: { nodes: NODES },
    jobs,
  };
  console.log(writePlan('xiangqi', 'jobs', spec));
} else if (mode === 'build') {
  const rows = readRows(arg('--rows'));
  const mover = (i: number) => (i % 2 === 0 ? 'red' : 'black');
  const redScore = moves.map((_, i) => {
    const r = rows.get(`p${i}`);
    if (!r) throw new Error(`no search for position ${i}`);
    const w = winFor(r, K);
    return mover(i) === 'red' ? w : 1 - w;
  });
  redScore.push(1); // Red mates.
  const best = moves.map((_, i) => fromEngine(rows.get(`p${i}`)!.best));
  const base = { rootFen: '', moves, redScore, best };
  const marks = judgedMoves(base);
  const sidelines: EngineSideline[] = [];
  for (const m of marks) {
    const i = m.ply - 1;
    let s = states[i]!;
    const line: string[] = [];
    for (const u of (rows.get(`l${i}`) ?? rows.get(`p${i}`)!).pv.slice(0, 6)) {
      const t = fromEngine(u);
      if (!isStandardXiangqiLegalMove(s, move(t))) break;
      line.push(t);
      s = applyStandardXiangqiMove(s, move(t));
    }
    // The line's verdict is the engine's score for it: the position before the move.
    if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
  }
  const notes = readNotes('xiangqi');
  const tree = annotateFromEngine({ ...base, sidelines, ...noted(notes, sidelines) });
  writePlan('xiangqi', 'plan', {
    create: {
      owner: 'mistboard',
      name: 'Xiangqi: a sample game, annotated',
      description:
        'Sacrifice the Horse in 13, a trap from a manual printed in 1632, read by Pikafish. From the xiangqi rules page at mistboard.com/rules/xiangqi.',
      visibility: 'public',
      chapter: {
        name: 'Sacrifice the Horse in 13',
        variant: 'xiangqi',
        orientation: 'red',
        tree,
        tags: { red: 'Red', black: 'Black', result: '1-0', event: 'Classic manual, 1632' },
        scoreSeries: {
          side: 'red',
          series: [{ name: 'Pikafish', color: 'a', values: redScore }],
        },
      },
    },
    ops: [],
  });
  report(marks, sidelines);
} else {
  throw new Error('mode: jobs | build');
}
