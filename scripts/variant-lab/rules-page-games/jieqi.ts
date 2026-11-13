// The jieqi rules page's sample game (and /blog/luat-co-up's): one game of the
// 2026-10-31 AB-JChess vs jqe match, read again by AB-JChess on this Mac and
// annotated by the pipeline (scripts/study-annotate.ts).
//
//   npx tsx scripts/variant-lab/rules-page-games/jieqi.ts jobs --match FULL.json --key run1:115 --engine ABJ --out jobs.json
//   python3 -I scripts/variant-lab/rules-page-games/analyse.py --jobs jobs.json --out rows.jsonl
//   npx tsx scripts/variant-lab/rules-page-games/jieqi.ts build --match FULL.json --key run1:115 --rows plans/jieqi.rows.jsonl
//   npx biome check --write scripts/variant-lab/rules-page-games/plans/jieqi.*.json
//
// FULL.json is the match lab's full export (to_full.py: every game with its deal and moves).
// Hidden information: the root is the public deal (jieqi-public-deal.ts), so a
// piece captured face-down or never turned over stays unknown; a sideline stops
// before its first move that turns a piece over or takes a face-down one.
// `build` writes plans/jieqi.plan.json (study:edit) and plans/jieqi.luck.json
// (study-chapter-decisions.mjs: each turn-over's luck, from AB-JChess's search of
// the turn-over itself before the piece is seen against the position after).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiSquare,
  jieqiPublicDeal,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from '@mistboard/game';
import { annotateFromEngine, type EngineSideline, judgedMoves } from '../../study-annotate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLANS = resolve(HERE, 'plans');
const [mode, ...argv] = process.argv.slice(2);
const arg = (k: string, d?: string): string => {
  const i = argv.indexOf(k);
  if (i >= 0) return argv[i + 1]!;
  if (d === undefined) throw new Error(`missing ${k}`);
  return d;
};
const HOME = process.env.HOME!;
const ENGINE = {
  // An AB-JChess build (~/projects/tools/AB-JChess/src); needed by `jobs` only.
  binary: arg('--engine', ''),
  options: [
    'Threads value 1',
    'Hash value 256',
    `EvalFile value ${HOME}/projects/tools/AB-JChess/nets/abjchess-20261030.nnue`,
  ],
};
const NODES = Number(arg('--nodes', '4000000'));
/** AB-JChess's own win curve (the match post's fit: 75% at about 409 cp). */
const K = 0.00269;
const win = (r: { cp?: number; mate?: number }): number =>
  r.mate != null ? (r.mate > 0 ? 1 : 0) : 1 / (1 + Math.exp(-K * r.cp!));

type Side = 'red' | 'black';
type Game = {
  key: string;
  red: string;
  black: string;
  winner: Side | 'draw';
  reason: string;
  moves: string;
  deal: JieqiDeal;
};
const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
function move(token: string): { from: JieqiSquare; to: JieqiSquare } {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`not a jieqi move: ${token}`);
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
}
const touchesHidden = (s: JieqiGameState, t: string): boolean => {
  const { from, to } = move(t);
  return s.board[from]?.faceDown === true || s.board[to]?.faceDown === true;
};
const turnsOver = (s: JieqiGameState, t: string): boolean =>
  s.board[move(t).from]?.faceDown === true;
const toEngine = (t: string): string => {
  const { from, to } = move(t);
  const sq = (x: string) => `${x[0]}${Number(x.slice(1)) - 1}`;
  return `${sq(from)}${sq(to)}`;
};
const fromEngine = (u: string): string => {
  const m = pikafishUciToJieqiMove(u);
  if (!m) throw new Error(`engine move ${u}`);
  return `${m.from}${m.to}`;
};

const data = JSON.parse(readFileSync(arg('--match'), 'utf8')) as { games: Game[] };
const key = arg('--key', 'run1:74');
const g = data.games.find((x) => x.key === key);
if (!g) throw new Error(`no game ${key}`);
const moves = g.moves.split(' ');
const pub = jieqiPublicDeal(g.deal, moves.map(move));
const root = createInitialJieqiState(`rules-jieqi-${key}`, pub);
const states: JieqiGameState[] = [root];
for (const [i, t] of moves.entries()) {
  const next = applyJieqiMove(states[i]!, move(t));
  if (next === states[i]) throw new Error(`ply ${i + 1}: ${t} is illegal from the public root`);
  states.push(next);
}
const fen = (i: number) => jieqiStateToPikafishFen(states[i]!, { public: true });

if (mode === 'jobs') {
  if (!ENGINE.binary) throw new Error('jobs needs --engine <AB-JChess binary>');
  const jobs: {
    id: string;
    fen: string;
    searchmoves?: string;
    extend?: number;
    hidden?: string[];
  }[] = [];
  // --lines 42,54: the engine's line from before those (1-based) moves, one search a ply.
  for (const p of arg('--lines', '').split(',').filter(Boolean).map(Number)) {
    const s = states[p - 1]!;
    const hidden = Object.entries(s.board)
      .filter(([, piece]) => piece?.faceDown)
      .map(([sq]) => `${sq[0]}${Number(sq.slice(1)) - 1}`);
    jobs.push({ id: `l${p - 1}`, fen: fen(p - 1), extend: 6, hidden });
  }
  for (let i = 0; i < moves.length; i += 1) {
    jobs.push({ id: `p${i}`, fen: fen(i) });
    if (touchesHidden(states[i]!, moves[i]!)) {
      jobs.push({ id: `m${i}`, fen: fen(i), searchmoves: toEngine(moves[i]!) });
    }
  }
  const out = arg('--out');
  writeFileSync(out, JSON.stringify({ engine: ENGINE, limit: { nodes: NODES }, jobs }, null, 1));
  console.log(`wrote ${out}: ${jobs.length} searches`);
} else if (mode === 'build') {
  type Row = { id: string; best: string; pv: string[]; cp?: number; mate?: number };
  const rows = new Map<string, Row>(
    readFileSync(arg('--rows'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row)
      .map((r) => [r.id, r]),
  );
  const mover = (i: number): Side => (i % 2 === 0 ? 'red' : 'black');
  const asRed = (i: number, p: number) => (mover(i) === 'red' ? p : 1 - p);
  const final = g.winner === 'red' ? 1 : g.winner === 'black' ? 0 : 0.5;
  const redScore = moves.map((_, i) => {
    const r = rows.get(`p${i}`);
    if (!r) throw new Error(`no search for position ${i}`);
    return asRed(i, win(r));
  });
  redScore.push(final);
  const best = moves.map((_, i) => fromEngine(rows.get(`p${i}`)!.best));
  const moveScore = moves.map((t, i) => {
    if (!touchesHidden(states[i]!, t)) return null;
    const r = rows.get(`m${i}`);
    if (!r) throw new Error(`no restricted search for move ${i + 1}`);
    return asRed(i, win(r));
  });
  const base = { rootFen: '', moves, redScore, best, moveScore };
  const marks = judgedMoves(base);

  // The engine's line at each marked move, up to its first hidden piece.
  const sidelines: EngineSideline[] = [];
  for (const m of marks) {
    const i = m.ply - 1;
    let s = states[i]!;
    const line: string[] = [];
    for (const u of (rows.get(`l${i}`) ?? rows.get(`p${i}`)!).pv) {
      const t = fromEngine(u);
      if (touchesHidden(s, t)) break;
      const next = applyJieqiMove(s, move(t));
      if (next === s) break;
      line.push(t);
      s = next;
      if (line.length >= 6) break;
    }
    if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
    else console.log(`ply ${m.ply}: AB-JChess's choice ${m.best} turns a piece over; arrow only`);
  }
  const notes = JSON.parse(readFileSync(resolve(PLANS, 'jieqi.notes.json'), 'utf8')) as {
    intro: string;
    judged: Record<string, string>;
    comments: Record<string, string>;
    lines: Record<string, string>;
  };
  for (const sl of sidelines) {
    const c = notes.lines[String(sl.ply + 1)];
    if (c) sl.comment = c;
  }
  const shapes: Record<number, { kind: 'arrow'; brush: string; orig: string; dest: string }[]> = {};
  for (const m of marks) {
    if (sidelines.some((s) => s.ply === m.ply - 1) || !m.best) continue;
    const { from, to } = move(m.best);
    shapes[m.ply - 1] = [{ kind: 'arrow', brush: 'green', orig: from, dest: to }];
  }
  const comments = Object.fromEntries(
    Object.entries(notes.comments).map(([p, t]) => [Number(p), t]),
  );
  const rootFen = jieqiStateToDealtFen(root);
  const tree = annotateFromEngine({
    ...base,
    rootFen,
    sidelines,
    shapes,
    comments,
    judgedComment: (m) => notes.judged[String(m.ply)] ?? '',
    intro: notes.intro,
  });
  const winnerSide: Side = g.winner === 'black' ? 'black' : 'red';
  const plan = {
    create: {
      owner: 'mistboard',
      name: 'Jieqi: a sample game, annotated',
      description:
        'One game from the 600-game match between AB-JChess and jqe on 2026-10-31, read again by AB-JChess. From the jieqi rules page at mistboard.com/rules/jieqi.',
      visibility: 'public',
      chapter: {
        name: `${g.red.split('-20')[0]} vs ${g.black.split('-20')[0]}`,
        variant: 'jieqi',
        orientation: winnerSide,
        tree,
        tags: {
          red: g.red,
          black: g.black,
          result: g.winner === 'red' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2',
          event: 'AB-JChess vs jqe, 600 games, 2026-10-31',
          date: '2026-10-31',
          round: key.replace(/^run(\d+):(\d+)$/, 'Run $1, game $2'),
        },
        scoreSeries: {
          side: winnerSide,
          series: [
            {
              name: 'AB-JChess',
              color: 'a',
              values: redScore.map((x) => (winnerSide === 'red' ? x : 1 - x)),
            },
          ],
        },
      },
    },
    ops: [],
  };
  const pct = (x: number) => Math.round(x * 1000) / 10;
  const decisions = moves.flatMap((t, i) => {
    if (!turnsOver(states[i]!, t)) return [];
    const forMover = (red: number) => (mover(i) === 'red' ? red : 1 - red);
    return [
      {
        ply: i + 1,
        mover: mover(i),
        playedWin: pct(forMover(moveScore[i]!)),
        realizedWin: pct(forMover(redScore[i + 1]!)),
      },
    ];
  });
  const luck = {
    engineId: 'jieqi-engine',
    source: `AB-JChess-20261031, ${NODES / 1e6}M nodes a position, public positions`,
    decisions,
  };
  writeFileSync(resolve(PLANS, 'jieqi.plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(resolve(PLANS, 'jieqi.luck.json'), `${JSON.stringify(luck, null, 2)}\n`);
  for (const m of marks) {
    console.log(
      `${m.ply}${m.glyph} ${m.mover} ${m.uci} ${pct(m.before)}->${pct(m.after)} best ${m.best} ${touchesHidden(states[m.ply - 1]!, m.uci) ? '(hidden)' : ''}`,
    );
  }
  console.log(`sidelines ${sidelines.map((s) => `${s.ply + 1}:${s.moves.join(' ')}`).join(' | ')}`);
  console.log(
    `${decisions.length} turn-overs graded; wrote plans/jieqi.plan.json, plans/jieqi.luck.json`,
  );
} else {
  throw new Error('mode: jobs | build');
}
