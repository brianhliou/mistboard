// The games of the AB-JChess vs jqe post as one study:edit plan
// (apps/server/src/study-edit-cli.ts): one chapter per game in
// apps/web/src/articles/content/ab-jchess-vs-jqe-match.json, in the post's order.
// Every number comes from that file's `deep` block per game.
//
// Each game is read from the winner's side (for a draw, the side that did not get
// into trouble): the board faces the winner and the graph under it is the winner's
// chance at every position by both engines, each searching at the match's node
// budget (AB-JChess teal, jqe orange). The match file stores the loser's chance; a
// chance here is one minus it. At each moment the post names, the loser's move is
// an arrow in the loser's colour and the winning engine's pick an arrow in its own
// (AB-JChess blue, jqe orange), with the pick as a one-move line beside the game
// move when it is a face-up move. A note on the move gives both engines' chance
// for the winner after each, and how many moves the loser took to see it. A game
// with `deep.openPly` (game 1) has no marked move: the moment stays in the file as
// the dearest choice in the stretch, and the board opens unmarked at openPly.
//
// Hidden information: the root is the PUBLIC deal (jieqiPublicDeal): a piece
// captured face-down or never turned over is `?` in the stored FEN, so the study
// knows only what both seats saw.
//
//   npx tsx scripts/variant-lab/ab-jchess-vs-jqe-study.ts --out <plan.json>
//                                       # a new study (create)
//   … --update <studyId> --chapters run2:30:<id>,… --out <plan.json>
//                                       # rewrite the named chapters, add the rest
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
import { annotateFromEngine, type StudyArrow, squaresOf } from '../study-annotate.js';

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
type Pair = { played: number; pick: number };
export type DeepMoment = {
  /** The position before the loser's move: index into the mainline, 0 = the start. */
  ply: number;
  move: number;
  played: string;
  pick: string;
  /** The loser's chance after each move, as the winning engine sees it. */
  winner: Pair;
  /** The same, as the loser's own engine sees it. */
  loser: Pair;
  caughtPly: number | null;
  lagMoves: number | null;
  revealSwings: number[];
  pickTurnsOver: boolean;
  playedTurnsOver: boolean;
};
type Game = {
  key: string;
  red: string;
  black: string;
  winner: 'red' | 'black' | 'draw';
  moves: string;
  moveCount: number;
  deal: JieqiDeal;
  deep: {
    nodes: number;
    loser: Engine;
    side: 'red' | 'black';
    series: Record<Engine, number[]>;
    moments: DeepMoment[];
    /** Open the board here, with no move marked: no single move is the story. */
    openPly?: number;
  };
};
type Data = {
  total: { games: number };
  movetimeMs: number;
  games: Game[];
};

const NAME: Record<Engine, string> = { abj: 'AB-JChess', jqe: 'jqe' };
const BRUSH: Record<Engine, string> = { abj: 'blue', jqe: 'orange' };
const engineOf = (player: string): Engine => (player.startsWith('AB-JChess') ? 'abj' : 'jqe');
const other = (e: Engine): Engine => (e === 'abj' ? 'jqe' : 'abj');
const pct = (x: number): string => `${Math.round(x * 100)}%`;

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
/** "the chariot e2-e6, taking the cannon", "a face-down piece g7-g6". */
export function said(state: JieqiGameState, token: string): string {
  const { from, to } = move(token);
  const piece = state.board[from];
  const name = !piece ? 'the piece' : piece.faceDown ? 'a face-down piece' : `the ${piece.role}`;
  const cap = state.board[to];
  const taking = !cap
    ? ''
    : cap.faceDown
      ? ', taking a face-down piece'
      : `, taking the ${cap.role}`;
  return `${name} ${from}-${to}${taking}`;
}

const data = JSON.parse(readFileSync(DATA, 'utf8')) as Data;
const nodesM = (n: number) => `${Math.round(n / 1e6)} million`;

function chapter(g: Game, n: number) {
  const moves = g.moves.split(' ');
  const where = `game ${n} (${g.key})`;
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
  const d = g.deep;
  for (const e of ['abj', 'jqe'] as const) {
    if (d.series[e].length !== moves.length + 1) {
      throw new Error(
        `${where}: ${e} series has ${d.series[e].length} values for ${moves.length} plies`,
      );
    }
  }
  const L = d.loser;
  const W = other(L);
  const redE = engineOf(g.red);
  if ((redE === L ? 'red' : 'black') !== d.side)
    throw new Error(`${where}: deep.side is not the loser's`);
  const wSide = d.side === 'red' ? ('black' as const) : ('red' as const);
  const wName = wSide === 'red' ? 'Red' : 'Black';
  /** The winner's chance from a stored loser's chance. */
  const win = (x: number) => 1 - x;

  const shapes: Record<number, StudyArrow[]> = {};
  const comments: Record<number, string> = {};
  const sidelines = [];
  for (const m of d.openPly === undefined ? d.moments : []) {
    const at = m.ply;
    if (moves[at] !== m.played) throw new Error(`${where}: moment ply ${at} is not ${m.played}`);
    if ((at % 2 === 0 ? 'red' : 'black') !== d.side) {
      throw new Error(`${where}: moment ply ${at} is not a move by ${NAME[L]}`);
    }
    const s = states[at]!;
    if (!tryPlay(s, m.pick))
      throw new Error(`${where}: ${NAME[W]}'s pick ${m.pick} is illegal at ${at}`);
    shapes[at] = [{ kind: 'arrow', brush: BRUSH[L], ...squaresOf(m.played) }];
    // A face-up pick hangs beside the game move as a one-move line (its arrow
    // comes with it); a pick that turns over or takes a face-down piece has no
    // line, because what follows depends on the draw.
    if (touchesHidden(s, m.pick)) {
      shapes[at].push({ kind: 'arrow', brush: BRUSH[W], ...squaresOf(m.pick) });
    } else {
      sidelines.push({
        ply: at,
        moves: [m.pick],
        redScoreEnd: null,
        brush: BRUSH[W],
        always: true,
        comment: `${NAME[W]}'s pick. ${wName}'s chance after it: ${pct(win(m.winner.pick))} by ${NAME[W]}, ${pct(win(m.loser.pick))} by ${NAME[L]}.`,
      });
    }
    const caught =
      m.lagMoves == null
        ? ` ${NAME[L]}'s number never came within 5 points of ${NAME[W]}'s before the end.`
        : ` ${NAME[L]}'s number came within 5 points of ${NAME[W]}'s ${m.lagMoves === 1 ? 'one move' : `${m.lagMoves} moves`} later, at move ${Math.floor(m.caughtPly! / 2) + 1}.`;
    comments[at] =
      `${NAME[L]} plays ${said(s, m.played)} (${BRUSH[L]} arrow). ${NAME[W]} wanted ${said(s, m.pick)} (${BRUSH[W]} arrow). ` +
      `${wName}'s chance by ${NAME[W]}: ${pct(win(m.winner.pick))} after the pick, ${pct(win(m.winner.played))} after the game move. ` +
      `By ${NAME[L]}: ${pct(win(m.loser.pick))} and ${pct(win(m.loser.played))}.` +
      caught;
  }
  if (d.openPly !== undefined) {
    const at = d.openPly;
    comments[at] =
      `${wName}'s chance here: ${pct(win(d.series[W][at]!))} by ${NAME[W]}, ${pct(win(d.series[L][at]!))} by ${NAME[L]}. ` +
      `The engines mostly agree on the moves and not on the score; no single move decides this game.`;
  }
  const result = g.winner === 'red' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
  comments[moves.length] =
    g.winner === 'draw' ? 'Drawn: the same position came up a third time.' : 'Checkmate.';

  const sideName = d.side === 'red' ? 'Red' : 'Black';
  const intro =
    `Game ${n} of the post: one of ${data.total.games} games between AB-JChess-20261031 and jqe on 2026-10-31, ${data.movetimeMs / 1000} seconds a move. ` +
    `${NAME[redE]} has Red. ` +
    (g.winner === 'draw'
      ? `The game is drawn; the board faces ${NAME[W]} (${wName}) and the graph is its chance, against ${NAME[L]} (${sideName}), the side that got into trouble. `
      : `The board faces the winner, ${NAME[W]} (${wName}), and the graph is its chance. `) +
    `Both engines searched every position for ${nodesM(d.nodes)} nodes, about what a move had in the match: AB-JChess teal, jqe orange. ` +
    (d.openPly === undefined
      ? `At the marked move, ${NAME[L]}'s move is the ${BRUSH[L]} arrow and ${NAME[W]}'s pick the ${BRUSH[W]} arrow. `
      : '') +
    'Pieces taken face-down or never turned over stay face-down here.';
  const tree = annotateFromEngine({
    rootFen,
    moves,
    // No judged marks: the moments are the post's, from both engines.
    redScore: [],
    shapes,
    comments,
    sidelines,
    intro,
  });
  return {
    key: g.key,
    name: `Game ${n}: ${NAME[redE]} vs ${NAME[other(redE)]}`,
    // The board faces the winner (a rename turns an existing chapter's board).
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
        { name: 'AB-JChess', color: 'a', values: d.series.abj.map(win) },
        { name: 'jqe', color: 'b', values: d.series.jqe.map(win) },
      ],
    },
  };
}

const games = data.games.filter((g) => g.deep);
const built = games.map((g, i) => chapter(g, i + 1));
for (const b of built)
  console.log(
    `${b.key}: ${b.name}, ${games.find((g) => g.key === b.key)!.deep.moments.length} moments`,
  );
const DESCRIPTION = `${built.length} games from the ${data.total.games}-game match between AB-JChess-20261031 and jqe on 2026-10-31, read from the winner's side: both engines' view of the winner's chance at every position, and at each marked move the loser's move beside the winning engine's pick. From the post at mistboard.com/blog/ab-jchess-vs-jqe.`;
const NAME_STUDY = `AB-JChess vs jqe: ${built.length} games read by both engines`;
const UPDATE = arg('--update', '');
let plan: unknown;
if (UPDATE) {
  const ids = new Map(
    arg('--chapters', '')
      .split(',')
      .filter(Boolean)
      .map(
        (pair) =>
          [pair.slice(0, pair.lastIndexOf(':')), pair.slice(pair.lastIndexOf(':') + 1)] as const,
      ),
  );
  const ref = (key: string) => ids.get(key) ?? `ref:${key.replace(':', '-')}`;
  plan = {
    study: UPDATE,
    ops: [
      { op: 'study', name: NAME_STUDY, description: DESCRIPTION },
      ...built.flatMap((b): unknown[] => {
        const id = ids.get(b.key);
        if (!id) {
          return [
            {
              op: 'add',
              ref: b.key.replace(':', '-'),
              name: b.name,
              tree: b.tree,
              orientation: b.orientation,
              tags: b.tags,
              scoreSeries: b.scoreSeries,
            },
          ];
        }
        return [
          { op: 'rename', chapter: id, name: b.name, tags: b.tags, orientation: b.orientation },
          { op: 'tree', chapter: id, tree: b.tree },
          { op: 'series', chapter: id, scoreSeries: b.scoreSeries },
        ];
      }),
      // Chapters the post no longer reads stay at the end, in their old order.
      {
        op: 'order',
        chapters: [
          ...built.map((b) => ref(b.key)),
          ...[...ids.entries()]
            .filter(([k]) => !built.some((b) => b.key === k))
            .map(([, id]) => id),
        ],
      },
    ],
  };
} else {
  const [first, ...rest] = built;
  if (!first) throw new Error('no game in the match file has a deep block');
  plan = {
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
}
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(`wrote ${OUT}: ${built.length} chapters`);
