// The games of the AB-JChess vs jqe post as one study:edit plan
// (apps/server/src/study-edit-cli.ts): one chapter per game in
// apps/web/src/articles/content/ab-jchess-vs-jqe-match.json, in the post's order.
// Every number comes from that file's `aligned` block per game: both engines'
// scores of every position at the match's own 4 seconds on 4 threads (the mover's
// score in the game, the other engine's search of the same position afterwards).
//
// Each game is read from the lead's side (the winner; in a draw, the side whose
// chances one engine read first): the board faces it and the graph under it is
// its chance at every position by both engines (AB-JChess teal, jqe orange). The
// annotation is lichess's set, judged by the lead engine:
//   - the other side's moves get ?! ? ?? when the lead engine's number for its
//     own side rises 5, 10 or 15 points over the move (moveJudgment);
//   - wherever the two engines would play different moves, both as arrows on the
//     position before the move, blue AB-JChess's and orange jqe's (Brian,
//     2026-11-03: "when the two engines disagree on the best move, we always draw
//     the two moves"); where they agree, none;
//   - comments only where something happens (abJqeNotes, apps/web/src/articles/
//     ab-jchess-vs-jqe-notes.ts): the split and why, the reveals and face-down
//     captures that swung the game, the finish. The graph carries the numbers
//     (Brian, 2026-11-03: a percentage on every move was "way too noisy");
//   - the post's moment is the chapter's one side line: the lead engine's choice,
//     ending in an assessment glyph; when that choice turns a piece over or takes a
//     face-down piece, the arrow alone, because what follows depends on the draw.
// A move that turns a piece over or takes a face-down piece is not marked: the
// position after it knows what the piece was.
//
// Reveal luck is not in the tree: it is stored per chapter (study_chapter_decisions)
// by scripts/study-chapter-decisions.mjs after the tree update, since a tree update
// clears a chapter's rows.
//
// Hidden information: the root is the PUBLIC deal (jieqiPublicDeal): a piece
// captured face-down or never turned over is `?` in the stored FEN, so the study
// knows only what both seats saw.
//
//   npx tsx scripts/variant-lab/ab-jchess-vs-jqe-study.ts --out <plan.json>
//   npx tsx scripts/variant-lab/ab-jchess-vs-jqe-study.ts --update --out <update.json>
//   npm run study:edit -- --plan <plan.json> [--apply]

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
  parseJieqiFen,
} from '@mistboard/game';
import { abJqeNotes } from '../../apps/web/src/articles/ab-jchess-vs-jqe-notes.ts';
import {
  AB_JQE_STUDY,
  disagreementArrows,
} from '../../apps/web/src/articles/content/ab-jchess-vs-jqe.ts';
import {
  annotateFromEngine,
  type EngineSideline,
  judgedMoves,
  type StudyArrow,
} from '../study-annotate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, '../../apps/web/src/articles/content');
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const DATA = resolve(arg('--data', resolve(CONTENT, 'ab-jchess-vs-jqe-match.json')));
const OUT = resolve(arg('--out', 'ab-jchess-vs-jqe-study-plan.json'));

type Engine = 'abj' | 'jqe';
type Side = 'red' | 'black';
type AlignedMoment = {
  /** The position before the other side's move: index into the mainline, 0 = the start. */
  ply: number;
  move: number;
  by: Engine;
  played: string;
  /** The lead engine's choice there. */
  pick: string;
  /** Both engines' chance for the lead's side before and after the move. */
  before: Record<Engine, number>;
  after: Record<Engine, number>;
  caughtPly: number | null;
  lagMoves: number | null;
};
type Game = {
  key: string;
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
    catch: number;
    /** Each engine's chance for the lead's side at positions 0..plies; the last is the result. */
    series: Record<Engine, number[]>;
    /** Each engine's choice at every position: the mover's is the move played. */
    best: Record<Engine, (string | null)[]>;
    moment: AlignedMoment;
  };
  chase?: { fromPly: number; toPly: number };
};
type Data = { total: { games: number }; games: Game[] };

const NAME: Record<Engine, string> = { abj: 'AB-JChess', jqe: 'jqe' };
const BRUSH: Record<Engine, string> = { abj: 'blue', jqe: 'orange' };
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

function chapter(g: Game, n: number) {
  const moves = g.moves.split(' ');
  const where = g.key;
  const pub = jieqiPublicDeal(g.deal, moves.map(move));
  if (JSON.stringify(pub) !== JSON.stringify(g.deal)) {
    throw new Error(`${where}: the match file's deal is not the public deal`);
  }
  const rootFen = jieqiStateToDealtFen(createInitialJieqiState(`abjqe-${g.key}`, pub));
  const parsed = parseJieqiFen(rootFen, { gameId: `abjqe-study-${g.key}` });
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
  if ((redE === W ? 'red' : 'black') !== wSide) {
    throw new Error(`${where}: aligned.side is not the lead's`);
  }
  const wName = SIDE[wSide];
  const toRed = (x: number) => (wSide === 'red' ? x : 1 - x);

  // The lead engine judges the other side's moves; a move that touches a hidden
  // piece is graded as no change (the next position already knows the piece).
  const redScore = S[W].map(toRed);
  const moveScore = moves.map((t, i) => (touchesHidden(states[i]!, t) ? redScore[i]! : null));
  const best = a.best[W];

  // Every position where the two engines would play different moves: both moves as
  // arrows, blue AB-JChess's and orange jqe's (disagreementArrows, which the post's
  // test checks); where they agree, none.
  const shapes: Record<number, StudyArrow[]> = disagreementArrows(a.best);
  for (const i of Object.keys(shapes).map(Number)) {
    for (const e of ['abj', 'jqe'] as const) {
      if (!tryPlay(states[i]!, a.best[e][i]!)) {
        throw new Error(`${where}: ${NAME[e]}'s choice ${a.best[e][i]} is illegal at ${i}`);
      }
    }
  }
  const comments: Record<number, string> = {};
  const sidelines: EngineSideline[] = [];

  const base = {
    rootFen,
    moves,
    redScore,
    best,
    moveScore,
    judge: lSide,
    shapes,
    comments,
    sidelines,
  };
  const marks = judgedMoves(base);
  const m = a.moment;
  const at = m.ply;

  // The post's moment: the only side line in the chapter, the lead engine's choice,
  // unless it turns a piece over or takes a face-down one (what follows depends on
  // the draw), when the arrow alone shows it.
  if (moves[at] !== m.played) throw new Error(`${where}: moment ply ${at} is not ${m.played}`);
  if (best[at] !== m.pick)
    throw new Error(`${where}: the moment's pick is not ${NAME[W]}'s choice`);
  if ((at % 2 === 0 ? 'red' : 'black') !== lSide) {
    throw new Error(`${where}: moment ply ${at} is not a move by ${NAME[L]}`);
  }
  if (shapes[at]?.length !== 2) throw new Error(`${where}: the moment has no arrows`);
  const s = states[at]!;
  const hadLine = !touchesHidden(s, m.pick);
  if (hadLine) {
    sidelines.push({
      ply: at,
      moves: [m.pick],
      redScoreEnd: redScore[at]!,
      brush: BRUSH[W],
      always: true,
      comment: `${NAME[W]}'s choice.`,
    });
    // The side line draws its own arrow.
    shapes[at] = shapes[at]!.filter((x) => x.brush !== BRUSH[W]);
  }
  // The comments: only where something happens, never a number the graph shows.
  for (const [p, text] of Object.entries(abJqeNotes(g.key))) {
    const ply = Number(p);
    if (ply < 1 || ply > moves.length) throw new Error(`${where}: a note at ply ${ply}`);
    comments[ply] = text;
  }
  if (!comments[at]) throw new Error(`${where}: no note on the position the post opens on`);
  if (!comments[moves.length]) throw new Error(`${where}: no note on the finish`);

  const result = g.winner === 'red' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
  const intro =
    `${g.chase ? 'The chase rule' : `Game ${n} of the post`}: one of ${data.total.games} games between AB-JChess-20261031 and jqe on 2026-10-31, ${a.movetimeMs / 1000} seconds a move on ${a.threads} threads. ` +
    `${NAME[redE]} has Red. ` +
    (g.winner === 'draw'
      ? `The game is drawn; the board faces ${wName}, whose chances ${NAME[W]} read first at the marked move. `
      : `The board faces the winner, ${NAME[W]} (${wName}). `) +
    `The graph is both engines' chance for ${wName}, AB-JChess teal and jqe orange. ` +
    'Wherever the two engines would play different moves, both are drawn: blue for AB-JChess, orange for jqe. ' +
    `Marks (?!, ?, ??) are ${NAME[L]}'s moves as ${NAME[W]} judges them. ` +
    (g.chase
      ? `${NAME[W]}'s marks on the repeating moves follow its own chase rule, which the match referee did not use. `
      : '') +
    'A die on a move that turned a piece over grades how lucky the reveal was, from what both players could see. ' +
    'Pieces taken face-down or never turned over stay face-down here.';
  const tree = annotateFromEngine({
    ...base,
    intro,
  });
  return {
    key: g.key,
    marks: marks.length,
    name: g.chase
      ? `The chase rule: ${NAME[redE]} vs ${NAME[other(redE)]}`
      : `Game ${n}: ${NAME[redE]} vs ${NAME[other(redE)]}`,
    orientation: wSide,
    tree,
    tags: {
      red: g.red,
      black: g.black,
      result,
      event: `AB-JChess vs jqe, ${data.total.games} games, 2026-10-31`,
      date: '2026-10-31',
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

const games = data.games.filter((g) => g.aligned);
let n = 0;
const built = games.map((g) => chapter(g, g.chase ? 0 : ++n));
for (const b of built) console.log(`${b.key}: ${b.name}, ${b.marks} marks`);
const DESCRIPTION = `${n} games from the ${data.total.games}-game match between AB-JChess-20261031 and jqe on 2026-10-31, and one drawn game where their chase rules disagree. The graph under each game is both engines' chance at the match's 4 seconds a move, the comments mark where the game turned, and wherever the two engines would play different moves, both are drawn as arrows. From the post at mistboard.com/blog/ab-jchess-vs-jqe.`;
const NAME_STUDY = `AB-JChess vs jqe: ${n} games read by both engines`;
const [first, ...rest] = built;
if (!first) throw new Error('no game in the match file has an aligned block');
const plan = {
  create: {
    owner: 'mistboard',
    name: NAME_STUDY,
    description: DESCRIPTION,
    visibility: 'public',
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
// --update: the same chapters as tree replacements on the study the post embeds
// (AB_JQE_STUDY), keeping its chapter ids, so the post's links stay good.
const update = {
  study: AB_JQE_STUDY.id,
  ops: [
    { op: 'study', name: NAME_STUDY, description: DESCRIPTION },
    ...built.map((b) => {
      const chapter = AB_JQE_STUDY.chapters[b.key];
      if (!chapter) throw new Error(`${b.key}: no chapter in AB_JQE_STUDY`);
      return { op: 'tree', chapter, tree: b.tree };
    }),
  ],
};
writeFileSync(OUT, `${JSON.stringify(argv.includes('--update') ? update : plan, null, 1)}\n`);
console.log(
  `wrote ${OUT}: ${built.length} chapters${argv.includes('--update') ? ` as tree updates of ${AB_JQE_STUDY.id}` : ''}`,
);
