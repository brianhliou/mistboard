// The four games of the AB-JChess vs jqe post as one study:edit plan
// (apps/server/src/study-edit-cli.ts): one new @mistboard study, one chapter per
// game in apps/web/src/articles/content/ab-jchess-vs-jqe-match.json, in the
// post's order. Every number comes from that file.
//
// What each chapter carries (scripts/study-annotate.ts writes the tree):
//   - marks on both sides' moves from ONE judge: AB-JChess-20261031 searching
//     every position for 15 s (ab-jchess-vs-jqe-judge.jsonl, made by
//     mistboard-engine lab oracle.py on the same FEN the engines saw), with its
//     best move as a green line beside each marked move;
//   - no mark on a move that turns over or takes a face-down piece: the score
//     after it depends on the draw, not the move; nor on the disputed move,
//     whose verdict is the sideline's;
//   - at the disputed move, the move played as an arrow in the mover's colour and
//     the other engine's pick as a sideline and arrow in its colour (AB-JChess
//     blue, jqe orange, as in the charts), with both engines' 4 s verdicts. The
//     line stops before its first face-down move: past it, the engine assumed an
//     identity no viewer could know;
//   - a note where each engine's chance for the winner passes 70% for good.
//
// Hidden information: the root is the PUBLIC deal (jieqiPublicDeal): a piece
// captured face-down or never turned over is `?` in the stored FEN, so the study
// knows only what both seats saw.
//
//   npx tsx scripts/variant-lab/ab-jchess-vs-jqe-study.ts --out <plan.json>
//   npm run study:edit -- --plan <plan.json>            # dry run
//   npm run study:edit -- --plan <plan.json> --apply    # create it
//   … --update <studyId> --chapters run2:30:<id>,… --out <plan.json>
//                                                  # rewrite the trees

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
import {
  annotateFromEngine,
  type EngineAnnotationInput,
  type JudgedMove,
  judgedMoves,
  type StudyArrow,
  squaresOf,
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
const JUDGE = resolve(arg('--judge', resolve(HERE, 'ab-jchess-vs-jqe-judge.jsonl')));
/** The judge's search per position, in ms (oracle.py --ms). */
const JUDGE_MS = 15000;
/** The post's games, in its order (AB_JQE_GAMES in ab-jchess-vs-jqe.ts). */
const KEYS = ['run2:30', 'run2:198', 'run2:115', 'run1:293'];

type Engine = 'abj' | 'jqe';
type Pair = { played: number; alt: number };
type Game = {
  key: string;
  red: string;
  black: string;
  winner: 'red' | 'black';
  abWon: boolean;
  moves: string;
  moveCount: number;
  deal: JieqiDeal;
  series: Record<Engine, number[]>;
  dispute: {
    ply: number;
    move: number;
    mover: 'AB-JChess' | 'jqe';
    played: string;
    alt: string;
    abj: Pair;
    jqe: Pair;
    glance: Pair;
    pv: Record<'abj_played' | 'abj_alt' | 'jqe_played' | 'jqe_alt', string>;
  };
};
type Data = {
  total: { games: number };
  movetimeMs: number;
  disagree: { glanceMs?: number; searchMs: number };
  review: { k: number };
  games: Game[];
};

const NAME: Record<Engine, string> = { abj: 'AB-JChess', jqe: 'jqe' };
const BRUSH: Record<Engine, string> = { abj: 'blue', jqe: 'orange' };
const engineOf = (player: string): Engine => (player.startsWith('AB-JChess') ? 'abj' : 'jqe');
const other = (e: Engine): Engine => (e === 'abj' ? 'jqe' : 'abj');
const SIDE = { red: 'Red', black: 'Black' } as const;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
/** A sideline's length cap: past ~10 plies a 4 s search's line is noise. */
const LINE_MAX = 10;
const dash = (t: string): string => t.replace(TOKEN, '$1-$2');

const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
function move(token: string): { from: JieqiSquare; to: JieqiSquare } {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`not a jieqi move: ${token}`);
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
}
/** The next state, or null when the move is illegal. */
function tryPlay(state: JieqiGameState, token: string): JieqiGameState | null {
  const next = applyJieqiMove(state, move(token));
  return next === state ? null : next;
}
/** Does this move turn over or take a face-down piece? */
function touchesHidden(state: JieqiGameState, token: string): boolean {
  const { from, to } = move(token);
  return state.board[from]?.faceDown === true || state.board[to]?.faceDown === true;
}
/** "soldier h5-g5", "face-down piece g7-g6". */
function said(state: JieqiGameState, token: string): string {
  const { from, to } = move(token);
  const piece = state.board[from];
  const name = !piece ? 'piece' : piece.faceDown ? 'face-down piece' : piece.role;
  return `${name} ${from}-${to}`;
}

const data = JSON.parse(readFileSync(DATA, 'utf8')) as Data;
const K = data.review.k;
/** The mover's chance after a 4 s score in cp, on the post's curve (chance() in the article). */
const chanceOf = (cp: number): number => 1 / (1 + Math.exp(-K * cp));
const glanceS = (data.disagree.glanceMs ?? 500) / 1000;
const searchS = data.disagree.searchMs / 1000;
const judgeS = JUDGE_MS / 1000;

/** One judge row: the position before move ply + 1, searched by AB-JChess for JUDGE_MS. */
type JudgeRow = {
  key: string;
  ply: number;
  played: string;
  best: string | null;
  /** Side to move's score in cp (a mate folded to a large cp). */
  cp: number | null;
  mate: boolean;
  pv: string | null;
};
const judgeRows = new Map<string, JudgeRow[]>();
for (const line of readFileSync(JUDGE, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const raw = JSON.parse(line) as JudgeRow;
  // The engine counts ranks 0-9 from Red's side; the site's tokens count 1-10.
  const site = (t: string): string => {
    const m = /^([a-i])(\d)([a-i])(\d)$/.exec(t);
    if (!m) throw new Error(`judge: not an engine move: ${t}`);
    return `${m[1]}${Number(m[2]) + 1}${m[3]}${Number(m[4]) + 1}`;
  };
  const r: JudgeRow = {
    ...raw,
    played: site(raw.played),
    best: raw.best ? site(raw.best) : null,
    pv: raw.pv ? raw.pv.split(' ').map(site).join(' ') : null,
  };
  const rows = judgeRows.get(r.key) ?? [];
  rows[r.ply] = r;
  judgeRows.set(r.key, rows);
}

/** Cut an engine line before its first face-down move (past it the engine
 *  assumed an identity no viewer could know), at LINE_MAX, or at an illegal move. */
function cutLine(from: JieqiGameState, pv: readonly string[]) {
  const line: string[] = [];
  let s = from;
  let stop: 'hidden' | 'illegal' | null = null;
  for (const t of pv.slice(0, LINE_MAX)) {
    if (touchesHidden(s, t)) {
      stop = 'hidden';
      break;
    }
    const next = tryPlay(s, t);
    if (!next) {
      stop = 'illegal';
      break;
    }
    line.push(t);
    s = next;
  }
  return { line, stop };
}

/** Position p from which an engine's chance for the winner stays >= 70% to the end. */
function seenAt(g: Game, s: readonly number[]): number {
  const w = (x: number) => (g.abWon ? x : 1 - x);
  let p = s.length - 1;
  while (p > 0 && w(s[p - 1]!) >= 0.7) p--;
  return p;
}

function chapter(g: Game, n: number) {
  const moves = g.moves.split(' ');
  const where = `game ${n} (${g.key})`;
  // The stored root knows only what both seats saw.
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

  const redE = engineOf(g.red);
  const blackE = engineOf(g.black);
  const abColor = redE === 'abj' ? 'red' : 'black';
  // The judge: red's chance at every position 0..n by AB-JChess's 15 s search
  // (the final position is the checkmate).
  const rows = judgeRows.get(g.key) ?? [];
  const judgeRed = moves.map((t, p) => {
    const r = rows[p];
    if (!r || r.cp == null) throw new Error(`${where}: no judge score for position ${p}`);
    if (r.played !== t) throw new Error(`${where}: judge row ${p} is for ${r.played}`);
    const mover = chanceOf(r.cp);
    return p % 2 === 0 ? mover : 1 - mover;
  });
  judgeRed.push(g.winner === 'red' ? 1 : 0);
  const best = moves.map((_, p) => rows[p]!.best);
  // No mark where the draw decides the score: a move that turns over or takes a face-down piece.
  const hidden = moves.map((t, i) => touchesHidden(states[i]!, t));
  const moveScore = moves.map((_, i) => (hidden[i] ? judgeRed[i]! : null));

  // The judge's best line beside every move it might mark (the annotator keeps
  // only those on a marked move), cut before its first face-down move.
  const judgeLines = moves.flatMap((t, i) => {
    const r = rows[i]!;
    if (!r.pv || !r.best || r.best === t) return [];
    const { line, stop } = cutLine(states[i]!, r.pv.split(' '));
    if (!line.length || line[0] === t) return [];
    return [
      {
        ply: i,
        moves: line,
        redScoreEnd: judgeRed[i]!,
        comment:
          `AB-JChess at ${judgeS} s prefers the ${said(states[i]!, line[0]!)}.` +
          (stop === 'hidden' ? ' The line stops before a face-down piece moves or is taken.' : ''),
      },
    ];
  });

  // Where the judge's pick itself turns over or takes a face-down piece there is
  // no line to show (the result depends on the draw): a green arrow instead.
  const faceDownBest = new Map<number, string>();
  moves.forEach((t, i) => {
    const b = best[i];
    if (b && b !== t && touchesHidden(states[i]!, b)) faceDownBest.set(i, b);
  });

  // The disputed move: the position before it gets the mover's arrow, and the
  // other engine's pick hangs beside it as a line in its colour.
  const d = g.dispute;
  const at = d.ply - 1;
  // The disputed move's verdict is the sideline's (both engines searched both
  // moves): no glyph on it.
  moveScore[at] = judgeRed[at]!;
  const moverE: Engine = d.mover === 'AB-JChess' ? 'abj' : 'jqe';
  const criticE = other(moverE);
  const moverSide = SIDE[at % 2 === 0 ? 'red' : 'black'];
  if (moves[at] !== d.played) throw new Error(`${where}: dispute ply ${d.ply} is not ${d.played}`);
  const pv = d.pv[`${criticE}_alt`].split(' ');
  if (pv[0] !== d.alt)
    throw new Error(`${where}: ${criticE}'s alt line does not start with ${d.alt}`);
  const { line, stop } = cutLine(states[at]!, pv);
  if (!line.length) throw new Error(`${where}: ${criticE}'s line is empty after the face-down cut`);
  const judgeAt = best[at];
  const judgeSays =
    judgeAt === d.played
      ? ` At ${judgeS} s AB-JChess also plays the game move.`
      : judgeAt === d.alt
        ? ` At ${judgeS} s AB-JChess prefers ${NAME[criticE]}'s pick.`
        : judgeAt
          ? ` At ${judgeS} s AB-JChess prefers neither: it plays the ${said(states[at]!, judgeAt)}.`
          : '';
  const v = (e: Engine, k: keyof Pair) => pct(chanceOf(d[e][k]));
  const verdict = (e: Engine) =>
    `${NAME[e]} ${v(e, 'alt')} after ${dash(d.alt)}, ${v(e, 'played')} after the game move ${dash(d.played)}`;
  const critAltCp = d[criticE].alt;
  const sideline = {
    ply: at,
    moves: line,
    // The critic's 4 s score of the line, as red's expected score.
    redScoreEnd: chanceOf(moverSide === 'Red' ? critAltCp : -critAltCp),
    brush: BRUSH[criticE],
    always: true,
    comment:
      `${NAME[criticE]}'s pick at a glance (${glanceS} s), its line from a ${searchS} s search. ` +
      `${moverSide}'s chance, both engines given ${searchS} s: ${verdict('abj')}; ${verdict('jqe')}.` +
      (stop === 'hidden' ? ' The line stops before a face-down piece moves or is taken.' : '') +
      (stop === 'illegal' ? ' The line stops where its next move is not legal here.' : ''),
  };
  const shapes: Record<number, StudyArrow[]> = {
    [at]: [{ kind: 'arrow', brush: BRUSH[moverE], ...squaresOf(d.played) }],
  };
  const marked = judgedMoves({ rootFen, moves, redScore: judgeRed, best, moveScore });
  for (const m of marked) {
    const b = faceDownBest.get(m.ply - 1);
    if (b && m.ply - 1 !== at) {
      shapes[m.ply - 1] = [
        ...(shapes[m.ply - 1] ?? []),
        { kind: 'arrow', brush: 'green', ...squaresOf(b) },
      ];
    }
  }

  const comments: Record<number, string> = {};
  const note = (ply: number, text: string) => {
    comments[ply] = comments[ply] ? `${comments[ply]} ${text}` : text;
  };
  note(
    d.ply,
    `The disputed move: ${NAME[moverE]} plays the ${said(states[at]!, d.played)} (${BRUSH[moverE]} arrow). ` +
      `At a glance ${NAME[criticE]} wanted the ${said(states[at]!, d.alt)} (${BRUSH[criticE]} arrow, the line beside this move).` +
      judgeSays,
  );
  const winnerSide = SIDE[g.winner];
  for (const e of ['abj', 'jqe'] as const) {
    const p = seenAt(g, g.series[e]);
    // Position p was scored by e's move at ply p + 1 or ply p, whichever is e's.
    const eColor = e === redE ? 'red' : 'black';
    const ply = (p % 2 === 0 ? 'red' : 'black') === eColor ? p + 1 : p;
    if (ply >= 1 && ply <= moves.length) {
      note(ply, `${NAME[e]}'s chance for ${winnerSide} passes 70% with this move and stays there.`);
    }
  }
  note(moves.length, 'Checkmate.');

  const input = {
    rootFen,
    moves,
    redScore: judgeRed,
    best,
    moveScore,
    // The dispute's two-engine line wins its ply over a judge line.
    sidelines: [...judgeLines.filter((l) => l.ply !== at), sideline],
    shapes,
    comments,
    judgedComment: (m: JudgedMove) => {
      const b = faceDownBest.get(m.ply - 1);
      return (
        `${m.glyph} AB-JChess at ${judgeS} s: this drops ${SIDE[m.mover]} from ${pct(m.before)} to ${pct(m.after)}.` +
        (b
          ? ` It prefers the ${said(states[m.ply - 1]!, b)} (green arrow); no line follows it, because what comes next depends on the draw.`
          : '')
      );
    },
    intro:
      `Game ${n} of the post: one of ${data.total.games} games between AB-JChess-20261031 and jqe on 2026-10-31, ${data.movetimeMs / 1000} seconds a move. ` +
      `${NAME[redE]} has Red. The marks on both sides' moves are the stronger engine's analysis: AB-JChess searched every position for ${judgeS} seconds after the match, and its preferred move is the green line beside each marked move (?! loses 5 points of win chance, ? 10, ?? 15). ` +
      'A move that turns over or takes a face-down piece is not marked: the score after it depends on the draw. ' +
      'At the disputed move, AB-JChess blue and jqe orange, as they played. Pieces taken face-down or never turned over stay face-down here.',
  } satisfies EngineAnnotationInput;
  const marks = judgedMoves(input);
  const result = g.winner === 'red' ? '1-0' : '0-1';
  return {
    key: g.key,
    marks,
    chapter: {
      name: `Game ${n}: ${NAME[redE]} vs ${NAME[blackE]}`,
      variant: 'jieqi',
      orientation: abColor,
      tree: annotateFromEngine(input),
      tags: {
        red: g.red,
        black: g.black,
        result,
        event: `AB-JChess vs jqe, ${data.total.games} games, 2026-10-31`,
        date: '2026-10-31',
      },
    },
  };
}

const built = KEYS.map((key, i) => {
  const g = data.games.find((x) => x.key === key);
  if (!g) throw new Error(`no game ${key} in ${DATA}`);
  return chapter(g, i + 1);
});
for (const b of built) {
  const by = (side: string) =>
    b.marks.filter((m) => m.mover === side).map((m) => `${m.ply}${m.glyph}`);
  console.log(
    `${b.key}: red marks ${by('red').join(' ') || '-'} | black marks ${by('black').join(' ') || '-'}`,
  );
}
const DESCRIPTION = `Four games from the ${data.total.games}-game match between AB-JChess-20261031 and jqe on 2026-10-31. Moves are marked by AB-JChess's own analysis at ${judgeS} s a position, and at each disputed move both engines' picks are shown as arrows. From the post at mistboard.com/blog/ab-jchess-vs-jqe.`;
const UPDATE = arg('--update', '');
let plan: unknown;
if (UPDATE) {
  const ids = new Map(
    arg('--chapters', '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const cut = pair.lastIndexOf(':');
        return [pair.slice(0, cut), pair.slice(cut + 1)] as const;
      }),
  );
  plan = {
    study: UPDATE,
    ops: [
      { op: 'study', description: DESCRIPTION },
      ...built.map((b) => {
        const id = ids.get(b.key);
        if (!id) throw new Error(`--chapters has no id for ${b.key}`);
        return { op: 'tree', chapter: id, tree: b.chapter.tree };
      }),
    ],
  };
} else {
  const [first, ...rest] = built.map((b) => b.chapter);
  plan = {
    create: {
      owner: 'mistboard',
      name: 'AB-JChess vs jqe: four games read by both engines',
      description: DESCRIPTION,
      visibility: 'public',
      chapter: first,
    },
    ops: rest.map((c, i) => ({ op: 'add', ref: `g${i + 2}`, ...c })),
  };
}
// --series: the chapters' win-chance graph (each engine's in-game chance for
// AB-JChess, the post's two-line chart) as its own plan. It needs the
// study_chapters.score_series column (migration 184), so it applies only once
// that has shipped.
if (UPDATE && argv.includes('--series')) {
  const ids = new Map(
    arg('--chapters', '')
      .split(',')
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.lastIndexOf(':')), pair.slice(pair.lastIndexOf(':') + 1)]),
  );
  plan = {
    study: UPDATE,
    ops: KEYS.map((key) => {
      const g = data.games.find((x) => x.key === key)!;
      if (!ids.get(key)) throw new Error(`--chapters has no id for ${key}`);
      return {
        op: 'series',
        chapter: ids.get(key),
        scoreSeries: {
          side: engineOf(g.red) === 'abj' ? 'red' : 'black',
          series: [
            { name: 'AB-JChess', color: 'a', values: g.series.abj },
            { name: 'jqe', color: 'b', values: g.series.jqe },
          ],
        },
      };
    }),
  };
}
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(`wrote ${OUT}: ${built.length} chapters`);
