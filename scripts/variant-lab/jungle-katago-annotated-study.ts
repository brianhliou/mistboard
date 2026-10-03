// The KataGo post's annotated games as a study:edit plan (apps/server/src/
// study-edit-cli.ts): one new @mistboard study, one chapter per game in
// apps/web/src/articles/content/katago-jungle-evals.json. Each of Misty's weak
// moves, as KataGo judges them (katago-jungle-analysis.ts mistyMoveMarks: the
// site's review cutoffs on KataGo's expected score), gets its glyph and a
// comment with KataGo's numbers; KataGo's preferred move goes in as a one-move
// sideline and a green arrow on the position before.
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
  MARK_GLYPH,
  mistyMoveMarks,
} from '../../apps/web/src/articles/katago-jungle-analysis.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const DATA = resolve(
  arg('--data', resolve(HERE, '../../apps/web/src/articles/content/katago-jungle-evals.json')),
);
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

function role(state: JungleGameState, uci: string): string {
  return state.board[uci.slice(0, 2) as JungleSquare]?.role ?? 'piece';
}
const said = (state: JungleGameState, uci: string): string =>
  `${role(state, uci)} ${uci.slice(0, 2)}-${uci.slice(2, 4)}`;

function chapter(game: EvaluatedGame) {
  const misty = game.red === 'misty' ? 'red' : 'black';
  const marks = new Map(mistyMoveMarks(game).map((m) => [m.ply, m]));
  const intro =
    `Game ${game.game} of the 2026-09-21 match, ${NAME[game.red]} red, ` +
    `${NAME[game.red === 'misty' ? 'katago' : 'misty']} black. KataGo won by entering the den on ply ${game.plies}. ` +
    `Marks are Misty's moves as KataGo judges them at 1,000 visits: the drop in Misty's expected score (a draw counts half), ` +
    `on the site's review cutoffs (?! 5 points, ? 10, ?? 15). Green arrows are KataGo's choice.`;
  const root: Node = { annotations: { comments: [{ text: intro }] }, children: [] };
  let cursor = root;
  let state = createInitialJungleState(`katago-study-${game.game}`);
  const rootFen = jungleStateToEngineFen(state);
  game.moves.forEach((uci, ply) => {
    const node: Node = { uci, children: [] };
    const mark = marks.get(ply);
    if (mark) {
      const glyph = MARK_GLYPH[mark.mark];
      node.annotations = {
        glyphs: [NAG[glyph]],
        comments: [
          {
            text: `${glyph} KataGo: Misty (${misty}) went from ${pct(mark.before)} to ${pct(mark.after)}. KataGo would have played ${said(state, mark.kataBest)}.`,
          },
        ],
      };
      cursor.annotations = {
        ...(cursor.annotations ?? {}),
        shapes: [
          {
            kind: 'arrow',
            brush: 'green',
            orig: mark.kataBest.slice(0, 2),
            dest: mark.kataBest.slice(2, 4),
          },
        ],
      };
      // KataGo's move as a one-move sideline after the game move.
      cursor.children.push(node, {
        uci: mark.kataBest,
        annotations: { comments: [{ text: `KataGo's choice: ${said(state, mark.kataBest)}.` }] },
        children: [],
      });
    } else {
      cursor.children.push(node);
    }
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`game ${game.game}: illegal ${uci} at ply ${ply}`);
    if (mark && !applyJungleMove(state, engineUciToJungleMove(mark.kataBest)!)) {
      throw new Error(`game ${game.game}: KataGo's ${mark.kataBest} is illegal at ply ${ply}`);
    }
    state = next;
    cursor = node;
  });
  const result = game.result === 'draw' ? '1/2-1/2' : game.result === 'red' ? '1-0' : '0-1';
  return {
    name: `Game ${game.game}: ${NAME[game.red === 'katago' ? 'katago' : 'misty']} vs ${NAME[game.red === 'katago' ? 'misty' : 'katago']}, read by KataGo`,
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
const [first, ...rest] = data.games.map(chapter);
if (!first) throw new Error('no games in the data');
const plan = {
  create: {
    owner: 'mistboard',
    name: 'KataGo reads two games against Misty',
    description:
      'Two decisive games from the 2026-09-21 match between KataGo-AnimalChess and MistyJungle, with Misty\'s weak moves marked as KataGo judges them. From the post "KataGo, a stronger Jungle Chess bot".',
    visibility: 'public',
    chapter: first,
  },
  ops: rest.map((c, i) => ({ op: 'add', ref: `g${i + 2}`, ...c })),
};
writeFileSync(OUT, `${JSON.stringify(plan, null, 1)}\n`);
console.log(
  `wrote ${OUT}: ${data.games.length} chapters; marks ${data.games
    .map(
      (g) =>
        `g${g.game} ${mistyMoveMarks(g)
          .map((m) => `${m.ply + 1}${MARK_GLYPH[m.mark]}`)
          .join(' ')}`,
    )
    .join(' | ')}`,
);
