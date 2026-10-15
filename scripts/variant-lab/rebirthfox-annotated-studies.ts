// Four correspondence games from 2026-10-08, @brianhliou-dev against
// @rebirthfox333 (fog xiangqi, jieqi, banqi, Duck Xiangqi), as four study:edit
// plans (apps/server/src/study-edit-cli.ts): one @mistboard study per variant,
// since a study holds one variant. The annotation (glyphs, line verdicts,
// sidelines, arrows) is scripts/study-annotate.ts reading the engine numbers in
// rebirthfox-games.json; this file adds each game's story at its turning point
// (NARRATIVE) and replays every mainline and sideline through the rules kernel,
// so a move the kernel refuses fails the build instead of the study.
//
//   npx tsx scripts/variant-lab/rebirthfox-annotated-studies.ts --out <dir>
//   npm run study:edit -- --plan <dir>/<variant>.json            # dry run
//   npm run study:edit -- --plan <dir>/<variant>.json --apply    # create it
//   … --update fog:<studyId>/<chapterId>,jieqi:…,banqi:…,duck:…  # rewrite them
//
// Engines and budgets are in the data's `_engines`. Fog scores are full
// information: the engine sees the whole board, neither player did. Jieqi
// reveals and banqi flips are graded on the search before the piece turns
// over (moveScore), so a draw's luck is never marked as a mistake. Duck
// scores swing with the side to move, so Black's moves are graded against the
// next Black-to-move position, never the Red-to-move one between.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBanqiMove,
  applyDuckXiangqiTurn,
  applyJieqiMove,
  applyMove,
  type BanqiDeal,
  banqiStateToDealtFen,
  createBanqiStateFromSetup,
  createInitialDuckXiangqiState,
  createInitialJieqiState,
  createInitialXiangqiState,
  duckXiangqiFen,
  type JieqiDeal,
  jieqiStateToDealtFen,
  standardXiangqiFen,
} from '@mistboard/game';
import {
  annotateFromEngine,
  type EngineAnnotationInput,
  type JudgedMove,
} from '../study-annotate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const DATA = resolve(arg('--data', resolve(HERE, 'rebirthfox-games.json')));
const OUT = resolve(arg('--out', 'rebirthfox-study-plans'));
const POST_SLUG = 'one-opponent-four-variants';
// --update fog:<studyId>/<chapterId>,jieqi:…: rewrite existing studies in place
// (name, description, chapter name and tree) instead of creating new ones.
const UPDATE = new Map(
  arg('--update', '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [key, ids] = pair.split(':') as [string, string];
      const [study, chapter] = ids.split('/') as [string, string];
      return [key, { study, chapter }] as const;
    }),
);

type Line = { moves: string[]; redScoreEnd: number | null; nodes: number | null };
type Game = {
  room: {
    id: string;
    variant: 'dark-xiangqi' | 'jieqi' | 'banqi' | 'duck-xiangqi';
    red: string;
    black: string;
    result: string;
    termination: string;
    started: string;
    ended: string;
  };
  moves: string[];
  deal?: unknown;
  redScore: number[];
  best: (string | null)[];
  moveScore?: (number | null)[];
  lines?: Record<string, Line>;
};
type Data = Record<'fog' | 'jieqi' | 'banqi' | 'duck', Game> & { _engines: Record<string, string> };
const data = JSON.parse(readFileSync(DATA, 'utf8')) as Data;

const pct = (s: number): string => `${Math.round(s * 100)}%`;
const SQ = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))(?:@([a-i](?:10|[1-9])))?$/;
function parse(token: string): { from: string; to: string; duck: string | null } {
  const m = SQ.exec(token);
  if (!m) throw new Error(`bad move token ${token}`);
  return { from: m[1]!, to: m[2]!, duck: m[3] ?? null };
}

// One kernel per variant: the start, a move applier, and what stands on a square.
type Kernel = {
  rootFen: string;
  start: () => unknown;
  apply: (state: unknown, token: string) => unknown;
  piece: (state: unknown, square: string) => { role: string; faceDown: boolean } | null;
};
type Board = Record<string, { role: string; faceDown?: boolean } | undefined>;
const pieceOn = (state: unknown, square: string) => {
  const p = (state as { board: Board }).board[square];
  return p ? { role: p.role, faceDown: !!p.faceDown } : null;
};

function kernelFor(key: keyof Omit<Data, '_engines'>): Kernel {
  const game = data[key];
  switch (game.room.variant) {
    case 'dark-xiangqi': {
      const start = () => createInitialXiangqiState('rebirthfox-fog');
      return {
        rootFen: standardXiangqiFen(start()),
        start,
        apply: (s, t) => {
          const { from, to } = parse(t);
          return applyMove(s as never, { from, to } as never);
        },
        piece: pieceOn,
      };
    }
    case 'jieqi': {
      const start = () => createInitialJieqiState('rebirthfox-jieqi', game.deal as JieqiDeal);
      return {
        rootFen: jieqiStateToDealtFen(start()),
        start,
        apply: (s, t) => {
          const { from, to } = parse(t);
          return applyJieqiMove(s as never, { from, to } as never);
        },
        piece: pieceOn,
      };
    }
    case 'banqi': {
      const start = () =>
        createBanqiStateFromSetup('rebirthfox-banqi', {
          deal: game.deal as BanqiDeal,
          chaseRule: 'repetition',
        });
      return {
        rootFen: banqiStateToDealtFen(start()),
        start,
        apply: (s, t) => {
          const { from, to } = parse(t);
          return applyBanqiMove(s as never, { from, to } as never);
        },
        piece: pieceOn,
      };
    }
    case 'duck-xiangqi': {
      const start = () => createInitialDuckXiangqiState('rebirthfox-duck');
      return {
        rootFen: duckXiangqiFen(start()),
        start,
        apply: (s, t) => {
          const { from, to, duck } = parse(t);
          return applyDuckXiangqiTurn(s as never, { from, to, duckTo: duck } as never);
        },
        piece: pieceOn,
      };
    }
  }
}

/** Every position of the game, replayed through the kernel (throws on a refused move). */
function replay(kernel: Kernel, moves: readonly string[], from = kernel.start()): unknown[] {
  const states = [from];
  moves.forEach((t, i) => {
    try {
      states.push(kernel.apply(states[i], t));
    } catch (e) {
      throw new Error(`move ${i + 1} (${t}) refused: ${(e as Error).message}`);
    }
  });
  return states;
}

/** A move in words, read off the kernel state it is played from. */
function said(kernel: Kernel, state: unknown, token: string): string {
  const { from, to, duck } = parse(token);
  const p = kernel.piece(state, from);
  if (from === to) return `turning over ${from}`;
  const who = !p ? 'the piece' : p.faceDown ? 'the face-down piece' : `the ${p.role}`;
  const target = kernel.piece(state, to);
  const verb = target ? 'taking on' : 'to';
  return `${who} from ${from} ${verb} ${to}${duck ? ` with the duck to ${duck}` : ''}`;
}

// Each game's story at its turning point, by 1-based ply. Numbers are the
// data's; the claims about what each player could see are the game record's.
const NARRATIVE: Record<keyof Omit<Data, '_engines'>, Record<number, string>> = {
  fog: {
    2: "Red's horse on h1 is in Black's view (the cannon on h8 sees it through the cannon on h3) and stays there.",
    4: 'The same horse, the same view, the same miss.',
    11: "The turning point. The only Black pieces in Red's view are on d10, e7 and e8. The horse on b10 that guards d9 is under the fog, so the chariot lands on a guarded square.",
    12: 'The horse takes the chariot. From here the engine never gives Red more than 9%.',
    18: 'Black finally takes the horse on h1.',
    48: "The cannon takes the general on e3, through the advisor Red put on e2 three plies ago. The cannon came to e1 on the move before, under the fog: Red's view showed Black pieces only on a7, d9 and e9. In fog there is no check, so a general in line is simply taken.",
  },
  jieqi: {
    44: 'The turning point. Before this the game is level. The chariot steps to f3, where the engine wanted f2, which keeps it level.',
    45: "Red's cannon comes to e2, behind its other cannon on e3, and now aims at the chariot on e5.",
    46: 'Black takes the cannon on e3. A longer search (2 million nodes) agrees this capture is best; the damage was the move before.',
    47: "The face-down piece on g1 moves as an elephant from its home square and takes back on e3. It turns out to be an elephant. Red's expected score before the reveal is 84.5%; with an elephant under it, 91.6%.",
    48: 'Black takes the elephant, but has given a chariot for a cannon and an elephant.',
  },
  banqi: {
    1: "Black's elephant: the first flip sets the colours, so the first mover plays Black.",
    13: "The engine had wanted h4 for five flips running (it was one of Black's soldiers). This flip on c2 turns up a Red cannon.",
    15: "The engine's own choice, and Black's expected score was 47.8% before the tile turned. It is a Red cannon, in line with Black's cannon on g1 with one tile between them, and after the draw the score is 27.1%. Pure luck: the choice cost nothing.",
    16: 'The new cannon takes on g1 at once.',
    23: "The cannon on f1 could take the elephant on f3. The flip instead costs 8 points by the engine's count, and the tile is a Red soldier.",
    48: "Red's soldier takes Black's general, the one capture in banqi that runs uphill, and Black resigns.",
  },
  duck: {
    36: "The turning point of the middlegame. Black's expected score is 79% here (a second search of the same size says 87%), and this capture of a soldier brings it to 62%.",
    78: 'The general steps from d10 to e10 with the duck on f8. It will step back and forth thirteen times.',
    100: "Still shuffling. Red's expected score was 51% when the shuffle began; while Black waits, Red's soldiers walk across.",
    102: "The thirteenth step. Red's expected score, 51% when the shuffle began, is now 70%.",
    104: "Black's soldier takes an advisor and the other advisor takes it straight back.",
    137: "Red's chariot takes the general.",
  },
};

const INTRO: Record<keyof Omit<Data, '_engines'>, string> = {
  fog: `${data._engines.fog}. Scores see the whole board, so a mark on a fog move says what the move cost, not what its player could have known.`,
  jieqi: `${data._engines.jieqi}. A move that turns a piece over is graded before it turns, so the luck of the draw is never marked.`,
  banqi: `${data._engines.banqi}. A flip is graded on its average over every tile it could turn up, so a bad draw after a sound flip carries no mark. The first flip turned up a black piece, so the first mover (the Red seat in the game record) plays Black. Red and Black in these comments name the pieces.`,
  duck: `${data._engines.duck}. Duck scores swing hard with the side to move, so Black's moves are graded against the next Black-to-move position.`,
};

const TITLE: Record<keyof Omit<Data, '_engines'>, string> = {
  fog: 'Fog Xiangqi: the chariot the fog hid',
  jieqi: 'Jieqi: the chariot move and the face-down recapture',
  banqi: 'Banqi: the flips that dealt the game',
  duck: 'Duck Xiangqi: the endgame lost by waiting',
};

// What the comments call each seat. In banqi the first flip binds a colour to
// the first mover, and here it turned up black, so the 'red' seat plays Black.
const SIDE_NAME: Record<keyof Omit<Data, '_engines'>, Record<'red' | 'black', string>> = {
  fog: { red: 'Red', black: 'Black' },
  jieqi: { red: 'Red', black: 'Black' },
  banqi: { red: 'Black', black: 'Red' },
  duck: { red: 'Red', black: 'Black' },
};

// Whose moves carry marks: Brian's, except fog, where the turning move is Red's.
const JUDGE: Record<keyof Omit<Data, '_engines'>, 'red' | 'black' | 'both'> = {
  fog: 'both',
  jieqi: 'black',
  banqi: 'red',
  duck: 'black',
};

function plan(key: keyof Omit<Data, '_engines'>) {
  const game = data[key];
  const kernel = kernelFor(key);
  const states = replay(kernel, game.moves);
  const sidelines = Object.entries(game.lines ?? {}).map(([ply, line]) => {
    const at = Number(ply);
    // The engine's line, up to the first move the site's kernel refuses (an
    // engine and the kernel can disagree on a rule deep in a duck line). A
    // trimmed line is reported, never silently stored.
    let legal = line.moves.length;
    for (; legal > 0; legal -= 1) {
      try {
        replay(kernel, line.moves.slice(0, legal), states[at]);
        break;
      } catch {}
    }
    if (legal === 0)
      throw new Error(`${key} line at ply ${at}: first move ${line.moves[0]} refused`);
    if (legal < line.moves.length) {
      console.warn(
        `${key} line at ply ${at}: kept ${legal} of ${line.moves.length} moves (${line.moves[legal]} refused)`,
      );
    }
    line.moves = line.moves.slice(0, legal);
    const first = line.moves[0]!;
    const flip = first.slice(0, 2) === first.slice(2, 4);
    return {
      ply: at,
      moves: line.moves,
      redScoreEnd: line.redScoreEnd,
      comment: flip
        ? `The engine's flip, ${said(kernel, states[at], first)}. Its score is an average over every tile that could lie there.`
        : `The engine's line${line.nodes ? ` at ${line.nodes / 1_000_000} million nodes` : ''}.`,
    };
  });
  const input: EngineAnnotationInput = {
    rootFen: kernel.rootFen,
    moves: game.moves,
    redScore: game.redScore,
    best: game.best,
    moveScore: game.moveScore,
    judge: JUDGE[key],
    sidelines,
    comments: NARRATIVE[key],
    judgedComment: (m: JudgedMove) =>
      `${m.glyph} ${SIDE_NAME[key][m.mover]}'s expected score goes from ${pct(m.before)} to ${pct(m.after)}` +
      (m.best ? `; the engine preferred ${said(kernel, states[m.ply - 1], m.best)}.` : '.'),
    intro: INTRO[key],
  };
  const r = game.room;
  const result = r.result === 'red-wins' ? '1-0' : r.result === 'black-wins' ? '0-1' : '1/2-1/2';
  const name = `${TITLE[key]} (${r.red} vs ${r.black})`;
  const description = `A correspondence game from ${r.started.slice(0, 10)}, every position scored by the engine the site uses for this variant, with the moves it marks, its lines and the turning point. From the post at mistboard.com/blog/${POST_SLUG}.`;
  const tree = annotateFromEngine(input);
  const target = UPDATE.get(key);
  if (target) {
    return {
      study: target.study,
      ops: [
        { op: 'study', name, description },
        { op: 'rename', chapter: target.chapter, name: TITLE[key] },
        { op: 'tree', chapter: target.chapter, tree },
      ],
    };
  }
  return {
    create: {
      owner: 'mistboard',
      name,
      description,
      visibility: 'public',
      chapter: {
        name: TITLE[key],
        variant: r.variant,
        orientation: 'black',
        tree,
        tags: {
          red: r.red,
          black: r.black,
          result,
          event: 'Correspondence, 1 day a move',
          date: r.started.slice(0, 10),
          site: 'mistboard.com',
        },
      },
    },
    ops: [],
  };
}

mkdirSync(OUT, { recursive: true });
for (const key of ['fog', 'jieqi', 'banqi', 'duck'] as const) {
  const p = plan(key);
  const file = resolve(OUT, `${data[key].room.variant}.json`);
  writeFileSync(file, `${JSON.stringify(p, null, 1)}\n`);
  console.log(`wrote ${file}`);
}
