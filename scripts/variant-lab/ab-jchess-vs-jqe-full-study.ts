// All 600 games of the AB-JChess vs jqe match (2026-10-31) as three studies of 100
// deals each, the two games of a deal side by side. The companion to the post's
// study (ab-jchess-vs-jqe-study.ts), with the same reading of each game and none of
// its editing: the graph under the board is both engines' chance for the lead's side
// at every position (the match's 4 seconds on 4 threads, the mover's own score and
// the other engine's search of the same position), wherever the two engines would
// play different moves both are drawn as arrows, and the other side's moves carry
// the lead engine's ?! ? ?? marks. No comments beyond the intro, no side lines.
//
// The lead is the winner's engine, AB-JChess in a draw; the board faces its side.
// Input: the engine lab's to_full.py output for the 2026-10-31 match,
// one entry per game with its PUBLIC deal.
//
//   npx tsx scripts/variant-lab/ab-jchess-vs-jqe-full-study.ts --data <full.json> --out-dir <dir>
//   npm run study:edit -- --plan <dir>/part-1.json [--apply]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiSquare,
  jieqiPublicDeal,
  jieqiStateToDealtFen,
  parseJieqiFen,
} from '@mistboard/game';
import { disagreementArrows } from '../../apps/web/src/articles/content/ab-jchess-vs-jqe.ts';
import { annotateFromEngine, judgedMoves, type StudyArrow } from '../study-annotate.js';

const argv = process.argv.slice(2);
const arg = (k: string): string => {
  const i = argv.indexOf(k);
  if (i < 0) throw new Error(`missing ${k}`);
  return argv[i + 1]!;
};
const DATA = resolve(arg('--data'));
const OUT_DIR = resolve(arg('--out-dir'));
const VISIBILITY = argv.includes('--public') ? 'public' : 'unlisted';
const PARTS = argv.includes('--parts') ? Number(arg('--parts')) : 1;

type Engine = 'abj' | 'jqe';
type Side = 'red' | 'black';
type Game = {
  key: string;
  seed: number;
  red: string;
  black: string;
  winner: Side | 'draw';
  moves: string;
  deal: JieqiDeal;
  aligned: {
    movetimeMs: number;
    threads: number;
    lead: Engine;
    side: Side;
    series: Record<Engine, number[]>;
    best: Record<Engine, (string | null)[]>;
  };
};
type Data = { total: { games: number }; games: Game[] };

const NAME: Record<Engine, string> = { abj: 'AB-JChess', jqe: 'jqe' };
const SIDE: Record<Side, string> = { red: 'Red', black: 'Black' };
const engineOf = (player: string): Engine => (player.startsWith('AB-JChess') ? 'abj' : 'jqe');
const other = (e: Engine): Engine => (e === 'abj' ? 'jqe' : 'abj');

const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
function move(token: string): { from: JieqiSquare; to: JieqiSquare } {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`not a jieqi move: ${token}`);
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
}
function tryPlay(state: JieqiGameState, token: string): JieqiGameState | null {
  const next = applyJieqiMove(state, move(token));
  return next === state ? null : next;
}
function touchesHidden(state: JieqiGameState, token: string): boolean {
  const { from, to } = move(token);
  return state.board[from]?.faceDown === true || state.board[to]?.faceDown === true;
}

const data = JSON.parse(readFileSync(DATA, 'utf8')) as Data;
const TOTAL = data.total.games;

function chapter(g: Game, deal: number) {
  const moves = g.moves.split(' ');
  const where = g.key;
  const pub = jieqiPublicDeal(g.deal, moves.map(move));
  if (JSON.stringify(pub) !== JSON.stringify(g.deal)) {
    throw new Error(`${where}: the deal is not the public deal`);
  }
  const rootFen = jieqiStateToDealtFen(createInitialJieqiState(`abjqe-${g.key}`, pub));
  const parsed = parseJieqiFen(rootFen, { gameId: `abjqe-full-${g.key}` });
  if (!parsed.ok) throw new Error(`${where}: root FEN does not parse`);
  const states: JieqiGameState[] = [parsed.state];
  for (const [i, t] of moves.entries()) {
    const next = tryPlay(states[i]!, t);
    if (!next) throw new Error(`${where} ply ${i + 1}: ${t} is illegal from the public root`);
    states.push(next);
  }
  const a = g.aligned;
  const S = a.series;
  for (const e of ['abj', 'jqe'] as const) {
    if (S[e].length !== moves.length + 1) {
      throw new Error(`${where}: ${e} series has ${S[e].length} values for ${moves.length} plies`);
    }
    if (a.best[e].length !== moves.length) throw new Error(`${where}: ${e} choices are short`);
  }
  const W = a.lead;
  const L = other(W);
  const wSide = a.side;
  const lSide: Side = wSide === 'red' ? 'black' : 'red';
  const redE = engineOf(g.red);
  if ((redE === W ? 'red' : 'black') !== wSide) throw new Error(`${where}: side is not the lead's`);
  const toRed = (x: number) => (wSide === 'red' ? x : 1 - x);
  const redScore = S[W].map(toRed);
  const moveScore = moves.map((t, i) => (touchesHidden(states[i]!, t) ? redScore[i]! : null));
  const best = a.best[W].map((x) => x ?? '');

  // An engine's choice that is not legal from the public position (it saw no history,
  // so a rare pick can differ from the referee's state) is dropped, never drawn.
  const shapes: Record<number, StudyArrow[]> = {};
  for (const [k, arrows] of Object.entries(disagreementArrows(a.best))) {
    const i = Number(k);
    if (
      ['abj', 'jqe'].every(
        (e) => a.best[e as Engine][i] && tryPlay(states[i]!, a.best[e as Engine][i]!),
      )
    ) {
      shapes[i] = arrows;
    }
  }
  const base = {
    rootFen,
    moves,
    redScore,
    best,
    moveScore,
    judge: lSide,
    shapes,
    comments: {} as Record<number, string>,
    sidelines: [],
  };
  const marks = judgedMoves(base);
  const intro =
    `Deal ${deal} of ${TOTAL / 2}, one of ${TOTAL} games between AB-JChess-20261031 and jqe on 2026-10-31, ${a.movetimeMs / 1000} seconds a move on ${a.threads} threads; each deal was played twice with the colours swapped. ` +
    `${NAME[redE]} has Red. ` +
    (g.winner === 'draw'
      ? `The game is drawn; the board faces AB-JChess (${SIDE[wSide]}). `
      : `The board faces the winner, ${NAME[W]} (${SIDE[wSide]}). `) +
    `The graph is both engines' chance for ${SIDE[wSide]}, AB-JChess teal and jqe orange. ` +
    'Wherever the two engines would play different moves, both are drawn: blue for AB-JChess, orange for jqe. ' +
    `Marks (?!, ?, ??) are ${NAME[L]}'s moves as ${NAME[W]} judges them. ` +
    'Pieces taken face-down or never turned over stay face-down here.';
  const tree = annotateFromEngine({ ...base, intro });
  const result = g.winner === 'red' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
  return {
    key: g.key,
    marks: marks.length,
    name: `Deal ${deal}: ${NAME[redE]} vs ${NAME[other(redE)]}`,
    orientation: wSide,
    tree,
    tags: {
      red: g.red,
      black: g.black,
      result,
      event: `AB-JChess vs jqe, ${TOTAL} games, 2026-10-31`,
      date: '2026-10-31',
      round: String(deal),
    },
    scoreSeries: {
      side: wSide,
      series: [
        { name: 'AB-JChess', color: 'a', values: S.abj },
        { name: 'jqe', color: 'b', values: S.jqe },
      ],
    },
  };
}

const seeds = [...new Set(data.games.map((g) => g.seed))];
if (seeds.length * 2 !== TOTAL) throw new Error(`${seeds.length} deals for ${TOTAL} games`);
const dealOf = new Map(seeds.map((s, i) => [s, i + 1]));
const built = data.games.map((g) => chapter(g, dealOf.get(g.seed)!));
const perPart = TOTAL / PARTS;
mkdirSync(OUT_DIR, { recursive: true });
for (let p = 0; p < PARTS; p++) {
  const part = built.slice(p * perPart, (p + 1) * perPart);
  const lo = (p * perPart) / 2 + 1;
  const hi = ((p + 1) * perPart) / 2;
  const [first, ...rest] = part;
  if (!first) throw new Error(`part ${p + 1} is empty`);
  const plan = {
    create: {
      owner: 'mistboard',
      name:
        PARTS === 1
          ? `AB-JChess vs jqe, all ${TOTAL} games`
          : `AB-JChess vs jqe, all ${TOTAL} games: deals ${lo} to ${hi}`,
      description: `Every game of the ${TOTAL}-game match between AB-JChess-20261031 and jqe on 2026-10-31${PARTS === 1 ? '' : `, in ${PARTS} studies of ${TOTAL / PARTS / 2} deals; this one holds deals ${lo} to ${hi}`}. Each deal was played twice with the colours swapped, and the two games sit side by side. The graph under each game is both engines' chance at the match's 4 seconds a move, and wherever the two engines would play different moves, both are drawn as arrows. The games the post discusses, with comments, are in its own study. From the post at mistboard.com/blog/ab-jchess-vs-jqe.`,
      visibility: VISIBILITY,
      chapter: {
        name: first.name,
        variant: 'jieqi',
        orientation: first.orientation,
        tree: first.tree,
        tags: first.tags,
        scoreSeries: first.scoreSeries,
      },
    },
    ops: rest.map((b) => ({
      op: 'add',
      ref: b.key.replace(':', '-'),
      name: b.name,
      tree: b.tree,
      orientation: b.orientation,
      tags: b.tags,
      scoreSeries: b.scoreSeries,
    })),
  };
  const file = resolve(OUT_DIR, `part-${p + 1}.json`);
  writeFileSync(file, `${JSON.stringify(plan)}\n`);
  console.log(
    `${file}: deals ${lo}-${hi}, ${part.length} chapters, ${part.reduce((n, b) => n + b.marks, 0)} marks`,
  );
}
