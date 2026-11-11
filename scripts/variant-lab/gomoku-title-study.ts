// The Gomoku title match study (Rapfi vs KataGomo, 2026-11-11): six games of the
// equal-time match, each read position by position by both engines
// (scripts/variant-lab/gomoku-title-evals.ts), as a study:edit plan.
//
// Per chapter:
//   - the graph under the board: both engines' chance for Black (the seat that
//     moves first, the chart's red side), Rapfi teal and KataGomo orange;
//   - marks (?!, ?, ??) on each engine's moves as the OTHER engine judges them
//     (scoreByMover), never a move the judge would have played itself;
//   - on a marked move, the judge's own line from that position as a sideline,
//     ringed in its colour and ending in its verdict;
//   - comments where something happens: where Rapfi first sees a forced five,
//     where the two engines' readings part, and the finish.
// The post embeds game 1 (RAPFI_KATAGOMO_STUDY in the article).
//
//   npx tsx scripts/variant-lab/gomoku-title-study.ts --evals <dir> --out <plan.json>
//   npx tsx scripts/variant-lab/gomoku-title-study.ts --evals <dir> --update --study <id> --chapter <id> --out <update.json>
//   npm run study:edit -- --plan <plan.json> [--apply]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuRoomState,
  type GomokuSquare,
  gomokuFen,
} from '@mistboard/game';
import match from '../../apps/web/src/articles/content/gomoku-title-match.json' with {
  type: 'json',
};
import {
  annotateFromEngine,
  type EngineSideline,
  judgedMoves,
  type StudyArrow,
} from '../study-annotate.ts';
import { BUDGET, type GameEvals } from './gomoku-title-evals.ts';

type Engine = 'rapfi' | 'katagomo';
type Color = 'black' | 'white';
const NAME: Record<Engine, string> = { rapfi: 'Rapfi', katagomo: 'KataGomo' };
/** Each engine's ring colour; the graph's teal and orange are separate tokens. */
const BRUSH: Record<Engine, string> = { rapfi: 'blue', katagomo: 'orange' };
const other = (e: Engine): Engine => (e === 'rapfi' ? 'katagomo' : 'rapfi');
const pct = (x: number): string => `${Math.round(x * 100)}%`;
/** The longest sideline shown: the judge's first moves, enough to see the idea. */
const LINE_MAX = 8;
/** Where the two readings part (chance for Black), and where they meet again. */
const PART = 0.35;
const REJOIN = 0.15;
const PARTINGS_MAX = 3;

const E = match.equal.total;
const SECONDS = match.equal.katagomoBudget.maxTimeS;

/** The chosen games by match index, in chapter order, and why each is here. */
const PICKS: { index: number; why: string }[] = [
  { index: 0, why: 'Game 1 of the match, the one the post shows.' },
  {
    index: 1,
    why: `Game 2, the same opening with colours swapped, fills the board: one of ${E.draws} draws.`,
  },
  {
    index: 6,
    why: "KataGomo's first win of the match, and its shortest.",
  },
  {
    index: 94,
    why: 'One of two openings where KataGomo won both games; here it has Black.',
  },
  {
    index: 105,
    why: `One of only ${E.rapfiAsBlack.losses} games Rapfi lost with Black, from the other opening KataGomo won twice.`,
  },
  {
    index: 51,
    why: `A typical Rapfi win: the median length of the ${E.wins} games it won.`,
  },
];

const argv = process.argv.slice(2);
const arg = (k: string, d?: string): string => {
  const i = argv.indexOf(k);
  const v = i >= 0 ? argv[i + 1] : d;
  if (v === undefined) throw new Error(`missing ${k}`);
  return v;
};
const EVALS = resolve(arg('--evals'));
const OUT = resolve(arg('--out', 'gomoku-title-study-plan.json'));
const UPDATE = argv.includes('--update');

function load(index: number): GameEvals {
  const path = resolve(EVALS, `run-equal-3s-${String(index).padStart(3, '0')}.json`);
  const ev = JSON.parse(readFileSync(path, 'utf8')) as GameEvals;
  if (!ev.finished) throw new Error(`${path}: the evaluation run has not finished`);
  return ev;
}

/** Plays a line from a position; stops at the first move the kernel refuses. */
function legalPrefix(from: GomokuRoomState, moves: readonly string[]): string[] {
  const out: string[] = [];
  let state = from;
  for (const to of moves) {
    if (state.status.type !== 'playing') break;
    const next = applyGomokuRoomMove(state, { to: to as GomokuSquare });
    if (next === state) break;
    out.push(to);
    state = next;
  }
  return out;
}

export function chapter(index: number, why: string) {
  const ev = load(index);
  const g = ev.game;
  const where = `game ${index + 1}`;
  const engineOf = (c: Color): Engine => (c === g.rapfiColor ? 'rapfi' : 'katagomo');
  const root = createGomokuRoomState('gomoku-title-study', {
    stones: g.opening.stones.map((s) => ({ square: s.square as GomokuSquare, color: s.color })),
    turn: g.opening.turn,
  });
  const states: GomokuRoomState[] = [root];
  for (const to of g.moves) {
    const next = applyGomokuRoomMove(states.at(-1)!, { to: to as GomokuSquare });
    if (next === states.at(-1)) throw new Error(`${where}: ${to} is not legal`);
    states.push(next);
  }
  const final = states.at(-1)!.status;
  if (final.type !== 'finished') throw new Error(`${where}: the game does not finish`);
  const n = g.moves.length;
  if (ev.rapfi.length !== n + 1 || ev.katagomo.length !== n + 1) {
    throw new Error(`${where}: evaluations do not cover every position`);
  }
  const moverAt = (i: number): Color => {
    const s = states[i]!.status;
    if (s.type !== 'playing') throw new Error(`${where}: no mover at ${i}`);
    return s.turn;
  };
  const series: Record<Engine, number[]> = {
    rapfi: ev.rapfi.map((e, i) => {
      if (!e) throw new Error(`${where}: no Rapfi reading at ${i}`);
      return e.black;
    }),
    katagomo: ev.katagomo.map((e, i) => {
      if (!e) throw new Error(`${where}: no KataGomo reading at ${i}`);
      return e.black;
    }),
  };
  const judgeAt = (i: number): Engine => other(engineOf(moverAt(i)));
  const bestOf = (e: Engine, i: number): string | null =>
    (e === 'rapfi' ? ev.rapfi[i]?.best : ev.katagomo[i]?.best) || null;
  const pvOf = (e: Engine, i: number): string[] =>
    (e === 'rapfi' ? ev.rapfi[i]?.pv : ev.katagomo[i]?.pv) ?? [];

  // Opening stones sit on the board, so the first mover is the opening's turn.
  // The chart's red side is Black either way; scoreByMover keys are the first
  // and second mover (annotateFromEngine alternates from ply 1).
  if (g.opening.turn !== 'black') throw new Error(`${where}: White moves first`);
  const base = {
    rootFen: gomokuFen(root),
    moves: g.moves,
    redScore: series.rapfi,
    scoreByMover: {
      red: series[other(engineOf('black'))],
      black: series[other(engineOf('white'))],
    },
    best: g.moves.map((_, i) => bestOf(judgeAt(i), i)),
    sidelineShape: (move: string, brush: string): StudyArrow => ({
      kind: 'circle',
      brush,
      orig: move,
    }),
  };
  const marks = judgedMoves(base);
  const sidelines: EngineSideline[] = [];
  const comments: Record<number, string> = {};
  const add = (ply: number, text: string): void => {
    comments[ply] = comments[ply] ? `${comments[ply]} ${text}` : text;
  };
  for (const m of marks) {
    const i = m.ply - 1;
    const judge = judgeAt(i);
    const line = legalPrefix(states[i]!, pvOf(judge, i)).slice(0, LINE_MAX);
    if (!line.length || line[0] === m.uci) continue;
    sidelines.push({
      ply: i,
      moves: line,
      redScoreEnd: series[judge][i]!,
      brush: BRUSH[judge],
      comment: `${NAME[judge]}'s line.`,
    });
  }

  // Where Rapfi first sees a forced five, on the move that allowed it.
  const mateAt = ev.rapfi.findIndex((e, i) => i > 0 && i < n && e?.mate != null);
  if (mateAt > 0) {
    // The sign of Rapfi's reading says whose five it is; its distance unit is
    // the engine's own, so the comment does not repeat it.
    const winner: Color = ev.rapfi[mateAt]!.black > 0.5 ? 'black' : 'white';
    add(
      mateAt,
      `Rapfi now sees a forced five for ${winner === 'black' ? 'Black' : 'White'} (${NAME[engineOf(winner)]}).`,
    );
  }
  // Where the two readings part, once per stretch.
  let parted = false;
  let partings = 0;
  for (let i = 1; i < n && partings < PARTINGS_MAX; i += 1) {
    const r = series.rapfi[i]!;
    const k = series.katagomo[i]!;
    const gap = Math.abs(r - k);
    if (!parted && gap >= PART) {
      add(i, `The engines part here: Rapfi gives Black ${pct(r)}, KataGomo ${pct(k)}.`);
      parted = true;
      partings += 1;
    } else if (parted && gap < REJOIN) {
      parted = false;
    }
  }
  const winner = final.winner;
  add(
    n,
    winner
      ? `${NAME[engineOf(winner)]} completes five in a row.`
      : 'The last point is filled: a draw.',
  );

  const blackE = engineOf('black');
  const whiteE = engineOf('white');
  const result = winner === 'black' ? '1-0' : winner === 'white' ? '0-1' : '1/2-1/2';
  const outcome = winner
    ? `${NAME[engineOf(winner)]} wins with ${winner === 'black' ? 'Black' : 'White'} in ${n} moves.`
    : `Drawn after ${n} moves.`;
  const intro =
    `${why} ${NAME[blackE]} has Black, ${NAME[whiteE]} White. ${outcome} ` +
    `Game ${index + 1} of ${E.games} in the title match on 2026-11-11, ${SECONDS} seconds a move for both engines. ` +
    `The graph is both engines' chance for Black (a draw counts half), Rapfi teal and KataGomo orange, each reading every position at the work it did in a median match move: Rapfi ${BUDGET.rapfi.nodes.toLocaleString('en-US')} positions, KataGomo ${BUDGET.katagomo.maxVisits} visits. ` +
    `Marks (?!, ?, ??) on each engine's moves are the other engine's judgment; where the judge would have played elsewhere, its line hangs off the move, ringed blue for Rapfi and orange for KataGomo. ` +
    'Numbers on the stones are move numbers; the opening stones were dealt.';
  const tree = annotateFromEngine({ ...base, intro, sidelines, comments });
  return {
    key: String(index),
    marks: marks.length,
    lines: sidelines.length,
    name: `Game ${index + 1}: ${NAME[blackE]} vs ${NAME[whiteE]}`,
    tree,
    tags: {
      black: NAME[blackE],
      white: NAME[whiteE],
      result,
      event: `Gomoku title match, Rapfi vs KataGomo, 2026-11-11`,
      date: '2026-11-11',
      round: `Game ${index + 1}`,
      opening: g.opening.id,
    },
    scoreSeries: {
      side: 'red',
      series: [
        { name: 'Rapfi', color: 'a', values: series.rapfi },
        { name: 'KataGomo', color: 'b', values: series.katagomo },
      ],
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = PICKS.map((p) => chapter(p.index, p.why));
  for (const b of built) console.log(`${b.name}: ${b.marks} marks, ${b.lines} lines`);
  const NAME_STUDY = 'Rapfi vs KataGomo: the Gomoku title match';
  const DESCRIPTION = `${built.length} games from the ${E.games}-game Gomoku title match between Rapfi and KataGomo on 2026-11-11, ${SECONDS} seconds a move for both. Both engines read every position: the graph under each game is their chance for Black, marks are each engine's moves as the other judges them, and the judge's better line hangs off each marked move. From the post at mistboard.com/blog/rapfi-vs-katagomo.`;
  const [first, ...rest] = built;
  const chapterFields = (b: (typeof built)[number]) => ({
    name: b.name,
    variant: 'gomoku',
    orientation: 'red',
    tree: b.tree,
    tags: b.tags,
    scoreSeries: b.scoreSeries,
  });
  const plan = {
    create: {
      owner: 'mistboard',
      name: NAME_STUDY,
      description: DESCRIPTION,
      visibility: 'public',
      chapter: chapterFields(first!),
    },
    ops: rest.map((b) => ({ op: 'add', ref: `game-${b.key}`, ...chapterFields(b) })),
  };
  // --update rewrites the featured chapter in place (the ids in the article's
  // RAPFI_KATAGOMO_STUDY), so the post's embed stays good. The article module
  // imports the board and its CSS, so the ids come in as arguments.
  const update = () => ({
    study: arg('--study'),
    ops: [
      { op: 'study', name: NAME_STUDY, description: DESCRIPTION },
      { op: 'rename', chapter: arg('--chapter'), name: first!.name, tags: first!.tags },
      { op: 'tree', chapter: arg('--chapter'), tree: first!.tree },
    ],
  });
  writeFileSync(OUT, `${JSON.stringify(UPDATE ? update() : plan, null, 1)}\n`);
  console.log(`wrote ${OUT}: ${built.length} chapters${UPDATE ? ' (featured tree update)' : ''}`);
}
