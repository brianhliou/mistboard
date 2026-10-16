// The KataGo post's annotated games as a study:edit plan (apps/server/src/
// study-edit-cli.ts): one new @mistboard study, one chapter per game in
// apps/web/src/articles/content/katago-jungle-evals.json. The annotation itself
// (move glyphs, position verdicts, sidelines, arrows) is scripts/study-annotate.ts
// reading KataGo's numbers; this file adds the game's story at its turning
// points (NARRATIVE below; every number from the data) and KataGo's own lines
// from content/katago-jungle-lines.json.
//
//   npx tsx scripts/variant-lab/jungle-katago-annotated-study.ts --out <plan.json>
//   npm run study:edit -- --plan <plan.json>            # dry run
//   npm run study:edit -- --plan <plan.json> --apply    # create it
//   … --update h2DLEHEC --chapters 67:3ZKOQobN,94:TAPsmuCM --out <plan.json>
//                                                  # rewrite the prod study's trees

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
  type JungleSquare,
  jungleStateToEngineFen,
} from '@mistboard/game';
import {
  type EvalsData,
  type EvaluatedGame,
  type KatagoLine,
  MARK_GLYPH,
  mistyMoveMarks,
} from '../../apps/web/src/articles/katago-jungle-analysis.js';
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
const DATA = resolve(arg('--data', resolve(CONTENT, 'katago-jungle-evals.json')));
const LINES = resolve(arg('--lines', resolve(CONTENT, 'katago-jungle-lines.json')));
const OUT = resolve(arg('--out', 'katago-jungle-study-plan.json'));

const NAME = { katago: 'KataGo-AnimalChess', misty: 'MistyJungle 0.0.6' } as const;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

const role = (state: JungleGameState, uci: string): string =>
  state.board[uci.slice(0, 2) as JungleSquare]?.role ?? 'piece';
const said = (state: JungleGameState, uci: string): string =>
  `${role(state, uci)} ${uci.slice(0, 2)}-${uci.slice(2, 4)}`;

/** KataGo's score for itself, and Misty's own score in its words, after ply p. */
type Reading = { kata: string; misty: string };
function reading(game: EvaluatedGame, p: number): Reading {
  const at = Math.min(p, game.plies - 1);
  const kataBlack = game.kata[at]!;
  const kataSide = game.red === 'katago' ? 1 - kataBlack : kataBlack;
  const cp = game.misty[at];
  const forMisty = cp == null ? 0 : game.red === 'misty' ? -cp : cp;
  const misty =
    Math.abs(forMisty) >= 900_000
      ? forMisty > 0
        ? 'a forced win for itself'
        : 'a forced loss'
      : `${forMisty >= 0 ? '+' : ''}${forMisty} for itself`;
  return { kata: pct(kataSide), misty };
}

// The story of each game, at the plies where it turned. `ply` is the move the
// comment sits on; the numbers read the position after it.
const NARRATIVE: Record<number, Array<{ ply: number; text: (r: Reading) => string }>> = {
  67: [
    {
      ply: 21,
      text: (r) =>
        `Misty's tiger takes the wolf, and Misty reads ${r.misty}. KataGo has itself at ${r.kata}: an extra wolf does not change who is winning.`,
    },
    {
      ply: 57,
      text: (r) =>
        `The turning point. KataGo now has itself at ${r.kata} and stays above 80% to the end; Misty still reads ${r.misty}, a wolf up.`,
    },
    {
      ply: 69,
      text: (r) =>
        `Misty takes the tiger and is two pieces up, but its elephant has left d3, and KataGo's elephant takes the leopard on c3 next. Misty now reads ${r.misty}; KataGo has itself at ${r.kata}.`,
    },
    { ply: 73, text: (r) => `Misty finds ${r.misty} here, eight moves after KataGo saw the win.` },
    { ply: 90, text: () => "KataGo's lion walks into the den." },
  ],
  94: [
    {
      ply: 38,
      text: (r) =>
        `Misty's tiger takes the wolf, and Misty reads ${r.misty}. KataGo has itself at ${r.kata}.`,
    },
    {
      ply: 90,
      text: (r) =>
        `Twenty-six moves later Misty still reads ${r.misty}, and KataGo has the game tipping its way, at ${r.kata}.`,
    },
    {
      ply: 100,
      text: (r) =>
        `The turning point. KataGo jumps to ${r.kata} and stays above 80% to the end; Misty still reads ${r.misty}.`,
    },
    { ply: 104, text: (r) => `Misty finds ${r.misty} here, two moves after the cat move.` },
    { ply: 117, text: () => "KataGo's lion walks into the den." },
  ],
};

/** Every move of KataGo's line is legal from where it starts. */
function checkLine(start: JungleGameState, line: KatagoLine, game: EvaluatedGame): void {
  let state = start;
  for (const uci of line.line) {
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`game ${game.game}: KataGo's line move ${uci} is illegal`);
    state = next;
  }
}

function chapter(game: EvaluatedGame, lines: readonly KatagoLine[]) {
  const mistyColor = game.red === 'misty' ? 'red' : 'black';
  const notes = NARRATIVE[game.game] ?? [];
  for (const { ply } of notes) {
    if (ply < 1 || ply > game.plies)
      throw new Error(`game ${game.game}: narrative ply ${ply} out of range`);
  }
  // Every position the game reached, for piece names and the legality checks.
  const states: JungleGameState[] = [createInitialJungleState(`katago-study-${game.game}`)];
  for (const [ply, uci] of game.moves.entries()) {
    const next = applyJungleMove(states[ply]!, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`game ${game.game}: illegal ${uci} at ply ${ply}`);
    states.push(next);
  }
  const kataSide = (black: number): number => (game.red === 'katago' ? 1 - black : black);
  const sidelines: EngineSideline[] = lines
    .filter((l) => l.game === game.game)
    .map((line) => {
      checkLine(states[line.ply]!, line, game);
      const after =
        line.kataBlackStart == null
          ? ''
          : ` KataGo has itself at ${pct(kataSide(line.kataBlackStart))} after this move`;
      const end =
        line.kataBlackEnd == null
          ? ''
          : `, and ${pct(kataSide(line.kataBlackEnd))} at the end of the line`;
      return {
        ply: line.ply,
        moves: line.line,
        redScoreEnd: line.kataBlackEnd == null ? null : 1 - line.kataBlackEnd,
        comment: `KataGo's line: its own choice for both sides, every position searched at ${line.visits.toLocaleString('en-US')} visits.${after}${end}.`,
      };
    });
  const input = {
    rootFen: jungleStateToEngineFen(states[0]!),
    moves: game.moves,
    redScore: game.kata.map((black) => 1 - black),
    best: game.kataBest,
    judge: mistyColor,
    sidelines,
    comments: Object.fromEntries(notes.map((n) => [n.ply, n.text(reading(game, n.ply))] as const)),
    judgedComment: (m: JudgedMove) =>
      `${m.glyph} By KataGo's count this move takes Misty (${mistyColor}) from ${pct(m.before)} to ${pct(m.after)}. KataGo's choice was ${said(states[m.ply - 1]!, m.best!)}, the line beside this move.`,
    intro:
      `Game ${game.game} of the 2026-09-21 match: ${NAME[game.red]} red, ` +
      `${NAME[game.red === 'misty' ? 'katago' : 'misty']} black. ` +
      "Comments give KataGo's expected score for itself (a draw counts half, 1,000 visits) and Misty's own score in centipawns. " +
      "Marks are Misty's moves as KataGo judges them, on the site's review cutoffs (?! 5 points, ? 10, ?? 15); " +
      'the symbol at the end of each line is the position there by KataGo (=, ⩲, ±, +− for red; ⩱, ∓, −+ for blue). ' +
      "Sidelines are KataGo's own line where the game went another way.",
  } satisfies EngineAnnotationInput;
  // The study and the post's chart must mark the same moves.
  const studyMarks = judgedMoves(input).map((m) => `${m.ply}${m.glyph}`);
  const chartMarks = mistyMoveMarks(game).map((m) => `${m.ply + 1}${MARK_GLYPH[m.mark]}`);
  if (studyMarks.join() !== chartMarks.join()) {
    throw new Error(`game ${game.game}: study marks ${studyMarks} != chart marks ${chartMarks}`);
  }
  const result = game.result === 'draw' ? '1/2-1/2' : game.result === 'red' ? '1-0' : '0-1';
  return {
    name: `Game ${game.game}: ${NAME[game.red]} vs ${NAME[game.red === 'katago' ? 'misty' : 'katago']}, read by KataGo`,
    variant: 'jungle',
    orientation: game.red === 'katago' ? 'red' : 'black',
    tree: annotateFromEngine(input),
    tags: {
      red: NAME[game.red],
      black: NAME[game.red === 'katago' ? 'misty' : 'katago'],
      result,
      event: 'KataGo-AnimalChess vs MistyJungle, 200 games, 2026-09-21',
      date: '2026-09-21',
    },
  };
}

const data = JSON.parse(readFileSync(DATA, 'utf8')) as EvalsData;
const lines = JSON.parse(readFileSync(LINES, 'utf8')) as KatagoLine[];
const chapters = data.games.map((g) => ({ game: g.game, ...chapter(g, lines) }));
// `--update <studyId> --chapters 67:<chapterId>,94:<chapterId>` rewrites the
// trees of a study that already exists (the prod study, once created);
// otherwise the plan creates a new study.
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
      name: 'KataGo reads two games against Misty',
      description:
        'Two decisive games from the 2026-09-21 match between KataGo-AnimalChess and MistyJungle, told at their turning points, with Misty\'s weak moves marked and KataGo\'s own lines as sidelines. From the post "KataGo, a stronger Jungle Chess bot".',
      visibility: 'public',
      chapter: first,
    },
    ops: rest.map((c, i) => ({ op: 'add', ref: `g${i + 2}`, ...c })),
  };
}
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(`wrote ${OUT}: ${data.games.length} chapters, ${lines.length} sidelines`);
