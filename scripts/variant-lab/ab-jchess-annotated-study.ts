// The AB-JChess post's example games as a study:edit plan (apps/server/src/
// study-edit-cli.ts): one new @mistboard study, one chapter per game in
// apps/web/src/articles/content/ab-jchess-examples.json. The annotation itself
// (Pikafish's moves marked by AB-JChess, line verdicts, sidelines, arrows) is
// scripts/study-annotate.ts reading AB-JChess's numbers; this file adds each
// game's story at its turning points (NARRATIVE; every number from the data)
// and the deep checks on the marked moves.
//
//   npx tsx scripts/variant-lab/ab-jchess-annotated-study.ts --out <plan.json>
//   npm run study:edit -- --plan <plan.json>            # dry run
//   npm run study:edit -- --plan <plan.json> --apply    # create it
//   … --update <studyId> --chapters 68:<id>,6:<id> --out <plan.json>
//                                                  # rewrite a study's trees
//
// Jieqi hides identities, so every sideline stops at its first reveal: past a
// face-down piece moving, the engine's line assumes an identity it could not
// know. A reveal move is graded on its own search from the position before it
// (moveScore), never on the position after, which already knows the draw.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJieqiMove,
  type JieqiGameState,
  type JieqiSquare,
  parseJieqiFen,
} from '@mistboard/game';
import {
  type AbExamplesData,
  type AbLine,
  type AbMatchGame,
  pct,
  pikaMoveMarks,
} from '../../apps/web/src/articles/ab-jchess-examples.js';
import { MARK_GLYPH } from '../../apps/web/src/articles/katago-jungle-analysis.js';
import {
  annotateFromEngine,
  type EngineAnnotationInput,
  type EngineSideline,
  type JudgedMove,
  judgedMoves,
} from '../study-annotate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, '../../apps/web/src/articles/content');
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const DATA = resolve(arg('--data', resolve(CONTENT, 'ab-jchess-examples.json')));
const OUT = resolve(arg('--out', 'ab-jchess-study-plan.json'));

const AB = 'AB-JChess';
const PIKA = 'Pikafish';
const nodes = (n: number): string => `${n / 1_000_000} million`;

const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
function move(token: string): { from: JieqiSquare; to: JieqiSquare } {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`not a jieqi move: ${token}`);
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
}
function play(state: JieqiGameState, token: string, where: string): JieqiGameState {
  const next = applyJieqiMove(state, move(token));
  if (next === state) throw new Error(`${where}: ${token} is illegal`);
  return next;
}
/** "horse b1-c3", or "face-down piece g7-g6" for a piece not yet turned over. */
function said(state: JieqiGameState, token: string): string {
  const { from, to } = move(token);
  const piece = state.board[from];
  const name = !piece ? 'piece' : piece.faceDown ? 'face-down piece' : piece.role;
  return `${name} ${from}-${to}`;
}

/** Both engines' reading of the position after `ply` moves, for AB-JChess's side. */
type Reading = { ab: string; pk: string; ingame: string; abFloorFromHere: string };
function reading(game: AbMatchGame, ply: number): Reading {
  const side = (red: number | null): string =>
    red == null ? '?' : pct(game.abColor === 'red' ? red : 1 - red);
  // The in-game number of the last Pikafish move up to this ply.
  let ingame = '?';
  for (let p = ply; p >= 1; p -= 1) {
    const pikaMoved = (p % 2 === 1) === (game.abColor === 'black');
    if (pikaMoved && game.ingame[p - 1] != null) {
      ingame = side(game.ingame[p - 1]!);
      break;
    }
  }
  // AB-JChess's lowest score for its side from this ply on, rounded down so
  // "never below" stays true.
  const rest = game.ab.slice(ply).map((red) => (game.abColor === 'red' ? red! : 1 - red!));
  const abFloorFromHere = `${Math.floor(Math.min(...rest) * 100)}%`;
  return {
    ab: side(game.ab[ply] ?? null),
    pk: side(game.pk[ply] ?? null),
    ingame,
    abFloorFromHere,
  };
}

const NARRATIVE: Record<number, Array<{ ply: number; text: (r: Reading) => string }>> = {
  68: [
    {
      ply: 22,
      text: (r) =>
        `Black's chariot takes a face-down advisor on a1. ${AB} has Red at ${r.ab}; ${PIKA}, searching this position itself, has Red at ${r.pk}.`,
    },
    {
      ply: 25,
      text: (r) =>
        `Red's chariot takes the face-down piece on f10, a cannon. ${AB} has Red at ${r.ab}, and never below ${r.abFloorFromHere} from here; ${PIKA} has Red at ${r.pk}.`,
    },
    {
      ply: 32,
      text: (r) =>
        `The black horse that came up on b1 takes Red's second advisor. ${AB}: Red ${r.ab}. ${PIKA}: Red ${r.pk}.`,
    },
    {
      ply: 36,
      text: (r) =>
        `The horse takes the elephant too. Red has lost two advisors, an elephant and a soldier, and its chariot, horse and soldier are near Black's king. ${AB} has Red at ${r.ab}; ${PIKA} has Red at ${r.pk}, and in the game it reported Red at ${r.ingame}.`,
    },
    {
      ply: 39,
      text: (r) => `Red's elephant takes the horse. ${AB}: Red ${r.ab}. ${PIKA}: Red ${r.pk}.`,
    },
    {
      ply: 42,
      text: (r) =>
        `Black turns over b10, a soldier, and ${PIKA}'s own score for Red jumps to ${r.pk}. ${AB} had Red above 80% from move 18.`,
    },
    { ply: 53, text: () => 'Black has no legal move and loses.' },
  ],
  6: [
    {
      ply: 25,
      text: (r) =>
        `Black's face-down piece on i10 came up a chariot and took a horse; Red's piece on i1 takes it back and comes up a horse. ${AB}: Red ${r.ab}. ${PIKA}: Red ${r.pk}.`,
    },
    {
      ply: 29,
      text: (r) =>
        `${AB}'s chariot takes the advisor on d7 and offers the chariots. ${AB}: Red ${r.ab}. ${PIKA}: Red ${r.pk}.`,
    },
    {
      ply: 31,
      text: (r) =>
        `The chariots are off: Red has one left and Black none, and the seven pieces Black has not turned over can only be five soldiers and two horses. ${AB} has Red at ${r.ab}; ${PIKA} has Red at ${r.pk}, and in the game it reported Red at ${r.ingame}.`,
    },
    {
      ply: 37,
      text: (r) =>
        `Red's chariot reaches Black's back row. ${AB}: Red ${r.ab}. ${PIKA}: Red ${r.pk}.`,
    },
    {
      ply: 41,
      text: (r) =>
        `The chariot has taken two horses on the back row. ${PIKA} now has Red at ${r.pk} and stays above 80% to the end; ${AB} got there on move 17.`,
    },
    { ply: 95, text: () => 'Black has no legal move and loses.' },
  ],
};

/** The longer search's verdict on the game move against AB-JChess's choice, both
 *  engines, in Pikafish's expected score (budgets are in the chapter intro). */
function deepCheck(game: AbMatchGame, line: AbLine): string {
  const pikaSide = (red: number): string => pct(game.abColor === 'red' ? 1 - red : red);
  const color = game.abColor === 'red' ? 'Black' : 'Red';
  const pick = (alt: number, played: number, keeps: string, flips: string): string => {
    const a = pikaSide(alt);
    const p = pikaSide(played);
    if (a === p) return `${keeps.split(' ')[0]} rates them the same (${color} ${a})`;
    // Higher for Pikafish's side means the better move for the side that moved.
    const altBetter = Number.parseFloat(a) > Number.parseFloat(p);
    return altBetter
      ? `${keeps} (${color} ${a} against ${p})`
      : `${flips} (${color} ${p} against ${a})`;
  };
  return (
    `Searched longer, ${pick(line.abAlt, line.abPlayed, `${AB} keeps its choice`, `${AB} switches to the game move`)}; ` +
    `${pick(line.pkAlt, line.pkPlayed, `${PIKA} agrees`, `${PIKA} prefers the game move`)}.`
  );
}

function chapter(game: AbMatchGame, budgets: AbExamplesData['budgets']) {
  const pikaColor = game.abColor === 'red' ? 'black' : 'red';
  const notes = NARRATIVE[game.game] ?? [];
  for (const { ply } of notes) {
    if (ply < 1 || ply > game.plies) throw new Error(`game ${game.game}: narrative ply ${ply}`);
  }
  // Replay through the kernel against the deal: every move legal, and every
  // reveal comes up as the match's referee drew it.
  const parsed = parseJieqiFen(game.rootFen, { gameId: `ab-jchess-study-${game.game}` });
  if (!parsed.ok || parsed.sampled)
    throw new Error(`game ${game.game}: root does not carry the deal`);
  const states: JieqiGameState[] = [parsed.state];
  for (const [i, token] of game.moves.entries()) {
    const before = states[i]!;
    const from = before.board[move(token).from];
    const next = play(before, token, `game ${game.game} ply ${i + 1}`);
    const revealed = from?.faceDown ? next.board[move(token).to]?.role : null;
    if ((revealed ?? null) !== (game.reveals[i] ?? null)) {
      throw new Error(`game ${game.game} ply ${i + 1}: reveal ${revealed} != ${game.reveals[i]}`);
    }
    states.push(next);
  }
  const marks = new Map(pikaMoveMarks(game).map((m) => [m.ply, m]));
  const deep = new Map(game.lines.map((l) => [l.ply, l]));
  const sidelines: EngineSideline[] = game.lines
    .filter((line) => marks.has(line.ply))
    .map((line) => {
      let s = states[line.ply]!;
      line.moves.forEach((t, k) => {
        s = play(s, t, `game ${game.game} line at ply ${line.ply} move ${k + 1}`);
      });
      const start = states[line.ply]!;
      const last = line.moves[line.moves.length - 1]!;
      // The board before the line's last move: did a face-down piece move?
      let beforeLast = start;
      for (const t of line.moves.slice(0, -1)) beforeLast = play(beforeLast, t, 'line');
      const endsOnReveal = beforeLast.board[move(last).from]?.faceDown === true;
      return {
        ply: line.ply,
        moves: line.moves,
        redScoreEnd: line.abAlt,
        comment:
          `${AB}'s choice.` +
          (endsOnReveal
            ? ' It turns over a face-down piece, so the line stops there; its score averages what the piece could be.'
            : ''),
      };
    });
  // A deep check on a move the analysis did not mark goes on the move itself.
  const comments: Record<number, string> = {};
  for (const n of notes) comments[n.ply] = n.text(reading(game, n.ply));
  for (const line of game.lines) {
    if (marks.has(line.ply)) continue;
    const ply = line.ply + 1;
    const prior = comments[ply] ? `${comments[ply]} ` : '';
    comments[ply] =
      `${prior}${AB} preferred ${said(states[line.ply]!, line.moves[0]!)}, but by its count the game move cost under 5 points. ${deepCheck(game, line)}`;
  }
  const input = {
    rootFen: game.rootFen,
    moves: game.moves,
    redScore: game.ab.map((x, i) => {
      if (x == null) throw new Error(`game ${game.game}: no AB-JChess score at ${i}`);
      return x;
    }),
    best: game.abBest,
    moveScore: game.moveScore,
    judge: pikaColor,
    sidelines,
    comments,
    judgedComment: (m: JudgedMove) => {
      const line = deep.get(m.ply - 1);
      return (
        `${m.glyph} By ${AB}'s count this drops ${PIKA} from ${pct(m.before)} to ${pct(m.after)}; it preferred ${said(states[m.ply - 1]!, m.best!)}` +
        (line ? `, the line beside this move. ${deepCheck(game, line)}` : '.')
      );
    },
    intro:
      `Game ${game.game} of the 2026-09-29 match, 400 games at 4 seconds a move: ${game.abColor === 'red' ? `${AB} red, ${PIKA} black` : `${PIKA} red, ${AB} black`}. ` +
      `Both engines scored every position again: ${AB} at ${nodes(budgets.abNodes)} nodes, the fixed ${PIKA} at ${nodes(budgets.pkNodes)}; scores are expected results, a draw counting half. ` +
      `Marks are ${PIKA}'s moves as ${AB} judges them (?! loses 5 points, ? 10, ?? 15); a reveal is judged before the piece comes up. ` +
      `Longer searches of a marked move: ${AB} at ${nodes(budgets.lineAbNodes)} nodes, ${PIKA} at ${nodes(budgets.deepPkNodes)}. Each line ends with ${AB}'s verdict on the position.`,
  } satisfies EngineAnnotationInput;
  // The study's marks are the chart's marks.
  const studyMarks = judgedMoves(input).map((m) => `${m.ply}${m.glyph}`);
  const chartMarks = pikaMoveMarks(game).map((m) => `${m.ply + 1}${MARK_GLYPH[m.mark]}`);
  if (studyMarks.join() !== chartMarks.join()) {
    throw new Error(`game ${game.game}: study marks ${studyMarks} != chart marks ${chartMarks}`);
  }
  const result = game.winner === 'draw' ? '1/2-1/2' : game.winner === 'red' ? '1-0' : '0-1';
  const red = game.abColor === 'red' ? AB : PIKA;
  const black = game.abColor === 'red' ? PIKA : AB;
  return {
    name: `Game ${game.game}: ${red} vs ${black}, read by both engines`,
    variant: 'jieqi',
    orientation: game.abColor,
    tree: annotateFromEngine(input),
    tags: {
      red,
      black,
      result,
      event: `${AB} vs ${PIKA}, 400 games, 2026-09-29`,
      date: '2026-09-29',
    },
  };
}

const data = JSON.parse(readFileSync(DATA, 'utf8')) as AbExamplesData;
const chapters = data.games.map((g) => ({ game: g.game, ...chapter(g, data.budgets) }));
const UPDATE = arg('--update', '');
const CHAPTER_IDS = new Map(
  arg('--chapters', '')
    .split(',')
    .filter(Boolean)
    .map((pair) => pair.split(':') as [string, string])
    .map(([game, id]) => [Number(game), id] as const),
);
let plan: unknown;
if (UPDATE) {
  plan = {
    study: UPDATE,
    ops: chapters.map((c) => {
      const id = CHAPTER_IDS.get(c.game);
      if (!id) throw new Error(`--chapters has no id for game ${c.game}`);
      return { op: 'tree', chapter: id, tree: c.tree };
    }),
  };
} else {
  const [first, ...rest] = chapters.map(({ game: _game, ...c }) => c);
  if (!first) throw new Error('no games in the data');
  plan = {
    create: {
      owner: 'mistboard',
      name: 'AB-JChess vs Pikafish: two wins, read by both engines',
      description:
        "Two of AB-JChess's wins from the 2026-09-29 match against Pikafish, every position scored again by both engines, Pikafish's moves marked by AB-JChess and its own choices as sidelines. From the post on AB-JChess at mistboard.com/blog/ab-jchess.",
      visibility: 'public',
      chapter: first,
    },
    ops: rest.map((c, i) => ({ op: 'add', ref: `g${i + 2}`, ...c })),
  };
}
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(`wrote ${OUT}: ${data.games.length} chapters`);
