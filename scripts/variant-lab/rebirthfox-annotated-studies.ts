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
// A rewritten tree drops the chapter's stored luck: re-run
// scripts/study-chapter-decisions.mjs for banqi and jieqi after every --update.
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
import { annotateFromEngine, type EngineAnnotationInput } from '../study-annotate.js';

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
    2: "Black's cannon on h8 could take this horse by jumping the cannon on h3.",
    4: 'Still there, still not taken.',
    11: 'The turning point. Red sees Black only on d10, e7 and e8; the horse guarding d9 is under the fog.',
    12: 'The horse takes the chariot.',
    18: 'Black finally takes the horse on h1.',
    48: 'The cannon came to e1 unseen and takes the general through the advisor on e2.',
  },
  jieqi: {
    44: 'The turning point: the game was level until this chariot move.',
    45: "Red's cannon comes to e2, behind its other cannon on e3, and now aims at the chariot on e5.",
    46: 'The best capture here; the damage was the move before.',
    47: 'The face-down piece on g1 moves as an elephant from its home point, takes back on e3, and turns out to be an elephant.',
    48: 'Black takes the elephant, but has given a chariot for a cannon and an elephant.',
  },
  banqi: {
    1: "Black's elephant: the first flip sets the colours, so the first mover plays Black.",
    15: "A Red cannon, in line with Black's cannon on g1 with one tile between them.",
    16: 'The new cannon takes on g1 at once.',
    48: "Red's soldier takes Black's general, the one capture in banqi that runs uphill, and Black resigns.",
  },
  duck: {
    40: "The turning point of the middlegame: Red's chariot takes this horse at once.",
    78: 'The general steps from d10 to e10 with the duck on f8. It will step back and forth thirteen times.',
    100: "Still shuffling, while Red's soldiers walk across.",
    102: 'The thirteenth step.',
    104: "Black's soldier takes an advisor and the other advisor takes it straight back.",
    137: "Red's chariot takes the general.",
  },
};

const INTRO: Record<keyof Omit<Data, '_engines'>, string> = {
  fog: `${data._engines.fog}. Scores see the whole board, which neither player could.`,
  jieqi: `${data._engines.jieqi}.`,
  banqi: `${data._engines.banqi}. The first flip turned up a black piece, so the first mover plays Black.`,
  duck: `${data._engines.duck}. Black's moves are graded against the next Black-to-move position.`,
};

const TITLE: Record<keyof Omit<Data, '_engines'>, string> = {
  fog: 'Fog Xiangqi: the chariot the fog hid',
  jieqi: 'Jieqi: the chariot move and the face-down recapture',
  banqi: 'Banqi: the flips that dealt the game',
  duck: 'Duck Xiangqi: the endgame lost by waiting',
};

// Whose moves carry marks: Brian's in jieqi and banqi; both sides in fog, where
// the turning move is Red's, and in duck, where Red's misses shape the chart.
const JUDGE: Record<keyof Omit<Data, '_engines'>, 'red' | 'black' | 'both'> = {
  fog: 'both',
  jieqi: 'black',
  banqi: 'red',
  duck: 'both',
};

function plan(key: keyof Omit<Data, '_engines'>) {
  const game = data[key];
  const kernel = kernelFor(key);
  const states = replay(kernel, game.moves);
  // The badges carry each mark's numbers and preferred move, so an engine line
  // is kept only where the story stops (the move after the line's position).
  const lines = Object.entries(game.lines ?? {}).filter(
    ([ply]) => key !== 'banqi' && NARRATIVE[key][Number(ply) + 1] !== undefined,
  );
  // Duck: every marked move shows what the engine would have played, duck
  // included. The engine's line where one was kept, else its preferred turn
  // alone (Red's positions have no stored line). The annotator drops any
  // candidate whose move earned no mark.
  if (key === 'duck') {
    lines.length = 0;
    game.best.forEach((best, ply) => {
      if (!best || best === game.moves[ply]) return;
      // The engine and the kernel can disagree on a rule; a turn the kernel
      // refuses is left out and reported rather than drawn.
      try {
        replay(kernel, [best], states[ply]);
      } catch {
        console.warn(`duck best at ply ${ply}: ${best} refused, no line`);
        return;
      }
      const kept = game.lines?.[String(ply)];
      lines.push([
        String(ply),
        kept?.moves[0] === best ? kept : { moves: [best], redScoreEnd: null, nodes: null },
      ]);
    });
  }
  const sidelines = lines.map(([ply, line]) => {
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
      // Duck hangs a line off every mark; a label on each would bury the notes.
      comment: flip
        ? `The engine's flip, ${said(kernel, states[at], first)}.`
        : key === 'duck'
          ? undefined
          : "The engine's line.",
    };
  });
  const input: EngineAnnotationInput = {
    rootFen: kernel.rootFen,
    moves: game.moves,
    redScore: game.redScore,
    best: game.best,
    // Duck scores swing about 10 points with the side to move, so a move is
    // graded against the mover's next turn, never the very next position.
    moveScore:
      key === 'duck'
        ? game.redScore.map((_, i) => game.moveScore?.[i] ?? game.redScore[i + 2] ?? null)
        : game.moveScore,
    judge: JUDGE[key],
    sidelines,
    comments: NARRATIVE[key],
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
