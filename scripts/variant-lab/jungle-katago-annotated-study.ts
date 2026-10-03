// The KataGo post's annotated games as a study:edit plan (apps/server/src/
// study-edit-cli.ts): one new @mistboard study, one chapter per game in
// apps/web/src/articles/content/katago-jungle-evals.json. Each chapter tells
// the game's story in comments at its turning points (NARRATIVE below; every
// number comes from the data), marks Misty's weak moves as KataGo judges them
// (katago-jungle-analysis.ts mistyMoveMarks, the site's review cutoffs), and
// plays KataGo's own line from content/katago-jungle-lines.json as a sideline
// where the game went another way, with a green arrow on its first move.
//
//   npx tsx scripts/variant-lab/jungle-katago-annotated-study.ts --out <plan.json>
//   npm run study:edit -- --plan <plan.json>            # dry run
//   npm run study:edit -- --plan <plan.json> --apply    # create it

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

const NAG = { '?!': 6, '?': 2, '??': 4 } as const;
const NAME = { katago: 'KataGo-AnimalChess', misty: 'MistyJungle 0.0.6' } as const;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

type Node = {
  uci?: string;
  annotations?: {
    comments?: { text: string }[];
    glyphs?: number[];
    shapes?: { kind: 'arrow'; brush: string; orig: string; dest: string }[];
  };
  children: Node[];
};

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
    { ply: 73, text: (r) => `Misty finds ${r.misty} here, 16 plies after KataGo settled.` },
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
        `Fifty plies later Misty still reads ${r.misty}, and KataGo has the game tipping its way, at ${r.kata}.`,
    },
    {
      ply: 100,
      text: (r) =>
        `The turning point. KataGo jumps to ${r.kata} and stays above 80% to the end; Misty still reads ${r.misty}.`,
    },
    { ply: 104, text: (r) => `Misty finds ${r.misty} here, four plies after the cat move.` },
    { ply: 117, text: () => "KataGo's lion walks into the den." },
  ],
};

// The study shows one comment per move, so a second note joins the first.
function comment(node: Node, text: string): void {
  node.annotations ??= {};
  const prior = node.annotations.comments?.[0]?.text;
  node.annotations.comments = [{ text: prior ? `${prior} ${text}` : text }];
}

/** KataGo's line as a sideline tree, every move checked by the kernel. */
function sidelineTree(start: JungleGameState, line: KatagoLine, game: EvaluatedGame): Node {
  const kataSide = (black: number): number => (game.red === 'katago' ? 1 - black : black);
  const after =
    line.kataBlackStart == null
      ? ''
      : ` KataGo has itself at ${pct(kataSide(line.kataBlackStart))} after this move`;
  const end =
    line.kataBlackEnd == null
      ? ''
      : `, and ${pct(kataSide(line.kataBlackEnd))} at the end of the line`;
  let state = start;
  let head: Node | null = null;
  let cursor: Node | null = null;
  for (const uci of line.line) {
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`game ${game.game}: KataGo's line move ${uci} is illegal`);
    const node: Node = { uci, children: [] };
    if (cursor) cursor.children.push(node);
    else head = node;
    cursor = node;
    state = next;
  }
  if (!head) throw new Error(`game ${game.game}: empty line at ply ${line.ply}`);
  comment(
    head,
    `KataGo's line: its own choice for both sides, every position searched at ${line.visits.toLocaleString('en-US')} visits.${after}${end}.`,
  );
  return head;
}

function chapter(game: EvaluatedGame, lines: readonly KatagoLine[]) {
  const mistyColor = game.red === 'misty' ? 'red' : 'black';
  const marks = new Map(mistyMoveMarks(game).map((m) => [m.ply, m]));
  const notes = new Map((NARRATIVE[game.game] ?? []).map((n) => [n.ply, n]));
  for (const ply of notes.keys()) {
    if (ply < 1 || ply > game.plies)
      throw new Error(`game ${game.game}: narrative ply ${ply} out of range`);
  }
  const linesAt = new Map(lines.filter((l) => l.game === game.game).map((l) => [l.ply, l]));
  const intro =
    `Game ${game.game} of the 2026-09-21 match: ${NAME[game.red]} red, ` +
    `${NAME[game.red === 'misty' ? 'katago' : 'misty']} black. ` +
    "Comments give KataGo's expected score for itself (a draw counts half, 1,000 visits) and Misty's own score in centipawns. " +
    "Marks are Misty's moves as KataGo judges them, on the site's review cutoffs (?! 5 points, ? 10, ?? 15). " +
    "Sidelines are KataGo's own line where the game went another way.";
  const root: Node = { annotations: { comments: [{ text: intro }] }, children: [] };
  let cursor = root;
  let state = createInitialJungleState(`katago-study-${game.game}`);
  const rootFen = jungleStateToEngineFen(state);
  game.moves.forEach((uci, ply) => {
    const node: Node = { uci, children: [] };
    const mark = marks.get(ply);
    if (mark) {
      const glyph = MARK_GLYPH[mark.mark];
      node.annotations = { glyphs: [NAG[glyph]] };
      comment(
        node,
        `${glyph} By KataGo's count this move takes Misty (${mistyColor}) from ${pct(mark.before)} to ${pct(mark.after)}. KataGo's choice was ${said(state, mark.kataBest)}, the line beside this move.`,
      );
    }
    const note = notes.get(ply + 1);
    if (note) comment(node, note.text(reading(game, ply + 1)));
    cursor.children.push(node);
    const line = linesAt.get(ply);
    if (line) {
      if (line.line[0] === uci)
        throw new Error(`game ${game.game}: line at ${ply} repeats the game move`);
      cursor.children.push(sidelineTree(state, line, game));
      cursor.annotations = {
        ...(cursor.annotations ?? {}),
        shapes: [
          {
            kind: 'arrow',
            brush: 'green',
            orig: line.line[0]!.slice(0, 2),
            dest: line.line[0]!.slice(2, 4),
          },
        ],
      };
    }
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`game ${game.game}: illegal ${uci} at ply ${ply}`);
    state = next;
    cursor = node;
  });
  const result = game.result === 'draw' ? '1/2-1/2' : game.result === 'red' ? '1-0' : '0-1';
  return {
    name: `Game ${game.game}: ${NAME[game.red]} vs ${NAME[game.red === 'katago' ? 'misty' : 'katago']}, read by KataGo`,
    variant: 'jungle',
    orientation: game.red === 'katago' ? 'red' : 'black',
    tree: { version: 1, rootFen, root },
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
const [first, ...rest] = data.games.map((g) => chapter(g, lines));
if (!first) throw new Error('no games in the data');
const plan = {
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
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(`wrote ${OUT}: ${data.games.length} chapters, ${lines.length} sidelines`);
