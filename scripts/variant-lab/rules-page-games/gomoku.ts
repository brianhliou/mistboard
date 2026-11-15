// The Gomoku rules page's sample game: Rapfi Level 8 (Black) against Rapfi Level 7
// (White) from a dealt opening, both at the server's bot settings (RAPFI_LEVELS: L7
// 25,000 nodes, L8 80,000), played through the live provider (gomokuLiveEngineMove)
// and kept beside the plan as plans/gomoku.game.json. Read again by the same Rapfi
// at 1,000,000 nodes a position and annotated by the pipeline.
//
//   npx tsx scripts/variant-lab/rules-page-games/gomoku.ts play --rapfi RAPFI \
//     --opening 161 --black 8 --white 7
//   npx tsx scripts/variant-lab/rules-page-games/gomoku.ts analyse --rapfi RAPFI
//   npx tsx scripts/variant-lab/rules-page-games/gomoku.ts build
//   npx biome check --write scripts/variant-lab/rules-page-games/plans/gomoku.plan.json
//
// RAPFI is prod's binary: the engines release (scripts/engine-assets.sh fetch, then
// verify-rapfi), x86-64 haswell, rapfi.ref with the CC0 mix9svq networks. On an
// Apple Silicon Mac it runs through an executable Docker shim (linux/amd64), the
// local route in docs-private/gomoku/docs/gomoku-analysis.md. The game recorded
// here is the first decisive one of seven L7/L8 pairings tried on 2026-11-14
// (openings 161 to 164, both seatings): the first, L7 Black on opening 161,
// filled the board drawn.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_DEALT_OPENINGS,
  type GomokuRoomState,
  gomokuFen,
  parseGomokuFen,
  parseGomokuMove,
  parseRapfiOutput,
  type RapfiPoint,
  rapfiBoardLines,
} from '@mistboard/game';
import { gomokuLiveEngineMove } from '../../../apps/server/src/gomoku-engine.ts';
import { annotateFromEngine, judgedMoves } from '../../study-annotate.ts';
import { cli, noted, PLANS, readNotes, report, writePlan } from './common.ts';

type GameRecord = {
  openingId: string;
  openingIndex: number;
  rootFen: string;
  black: string;
  white: string;
  gameSeed: number;
  status: GomokuRoomState['status'];
  moves: { ply: number; color: string; level: string; to: string; ms: number; msg: string }[];
};

type EvalRow = {
  ply: number;
  turn: 'black' | 'white';
  best: string;
  played: string | null;
  eval: number;
  winrate: number;
  /** Black's expected score: Rapfi's winrate (sigmoid(EVAL / 200), the site's own
   *  Rapfi win curve) for the side to move, 1 or 0 on a forced five. */
  blackScore: number;
  forcedFive: { result: 'win' | 'loss'; plies: number } | null;
  pv: string[];
  depth: number;
  seldepth: number;
  nodes: number;
  ms: number;
};

const GAME = resolve(PLANS, 'gomoku.game.json');
const ROWS = resolve(PLANS, 'gomoku.rows.jsonl');
const square = (p: RapfiPoint): string => `${'abcdefghijklmno'[p.x]}${p.y + 1}`;

function replay(record: GameRecord): GomokuRoomState[] {
  const parsed = parseGomokuFen(record.rootFen, 'rules-gomoku');
  if (!parsed.ok) throw new Error(`bad root: ${parsed.error}`);
  const states = [parsed.state];
  for (const m of record.moves) {
    const move = parseGomokuMove(m.to);
    const before = states.at(-1)!;
    const after = move && applyGomokuRoomMove(before, move);
    if (!after || after === before) throw new Error(`ply ${m.ply}: ${m.to} is illegal`);
    states.push(after);
  }
  return states;
}

const { mode, arg } = cli();

if (mode === 'play') {
  const binaryPath = arg('--rapfi', process.env.RAPFI_BIN);
  const index = Number(arg('--opening'));
  const levels = { black: arg('--black'), white: arg('--white') };
  const opening = GOMOKU_DEALT_OPENINGS[index];
  if (!opening) throw new Error(`no opening ${index}`);
  const root = createGomokuRoomState('rules-gomoku', opening);
  const gameSeed = 1146;
  let state = root;
  const moves: GameRecord['moves'] = [];
  while (state.status.type === 'playing') {
    const color = state.status.turn;
    const level = levels[color];
    let lines: string[] = [];
    let elapsedMs = 0;
    const move = await gomokuLiveEngineMove(state, `rapfi-level-${level}`, {
      binaryPath,
      gameSeed,
      timeoutMs: 30_000,
      onSearch: (s) => {
        lines = s.lines;
        elapsedMs = s.elapsedMs;
      },
    });
    if (!move) throw new Error('no move');
    const msg = lines.filter((l) => l.startsWith('MESSAGE')).at(-1) ?? '';
    moves.push({ ply: moves.length + 1, color, level, to: move.to, ms: elapsedMs, msg });
    console.log(moves.length, color, `L${level}`, move.to, `${elapsedMs}ms`, msg);
    state = applyGomokuRoomMove(state, move);
  }
  const record: GameRecord = {
    openingId: opening.id,
    openingIndex: index,
    rootFen: gomokuFen(root),
    black: `Rapfi Level ${levels.black}`,
    white: `Rapfi Level ${levels.white}`,
    gameSeed,
    status: state.status,
    moves,
  };
  writeFileSync(arg('--out', GAME), `${JSON.stringify(record, null, 2)}\n`);
  console.log('result', JSON.stringify(state.status), moves.length, 'moves');
} else if (mode === 'analyse') {
  const binaryPath = arg('--rapfi', process.env.RAPFI_BIN);
  const nodes = Number(arg('--nodes', '1000000'));
  const record = JSON.parse(readFileSync(GAME, 'utf8')) as GameRecord;
  const states = replay(record);
  const child = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = '';
  let waiting: {
    lines: string[];
    done: (l: string) => boolean;
    resolve: (l: string[]) => void;
  } | null = null;
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
      if (!waiting) continue;
      waiting.lines.push(line);
      if (waiting.done(line.trim())) {
        const w = waiting;
        waiting = null;
        w.resolve(w.lines);
      }
    }
  });
  const exchange = (lines: string[], done: (l: string) => boolean) =>
    new Promise<string[]>((resolve) => {
      waiting = { lines: [], done, resolve };
      child.stdin.write(`${lines.join('\n')}\n`);
    });
  await exchange(['START 15'], (l) => l === 'OK');
  child.stdin.write(
    `${[
      'INFO rule 0',
      'INFO thread_num 1',
      'INFO max_memory 268435456',
      'INFO show_detail 2',
      `INFO max_node ${nodes}`,
      'INFO timeout_turn 600000',
    ].join('\n')}\n`,
  );
  writeFileSync(ROWS, '');
  // Every position before the five: the last one is decided by the game itself.
  for (const [ply, state] of states.entries()) {
    if (state.status.type !== 'playing') break;
    const turn = state.status.turn;
    const stones = rapfiBoardLines({
      turn: 1,
      stones: state.board.flatMap((color, index) =>
        color ? [{ x: index % 15, y: Math.floor(index / 15), player: color === turn ? 1 : 2 }] : [],
      ),
    });
    const started = Date.now();
    const lines = await exchange(['YXBOARD', ...stones, 'DONE', 'YXNBEST 1'], (l) =>
      /^\d+,\d+$/.test(l),
    );
    const c = parseRapfiOutput(lines).find((x) => x.pvIndex === 0);
    if (!c) throw new Error(`no PV at ply ${ply}`);
    const mover = c.forcedFive ? (c.forcedFive.result === 'win' ? 1 : 0) : c.winrate;
    const row: EvalRow = {
      ply,
      turn,
      best: square(c.move),
      played: record.moves[ply]?.to ?? null,
      eval: c.eval,
      winrate: c.winrate,
      blackScore: Math.round((turn === 'black' ? mover : 1 - mover) * 10000) / 10000,
      forcedFive: c.forcedFive,
      pv: c.pv.map(square),
      depth: c.depth,
      seldepth: c.seldepth,
      nodes: c.totalNodes,
      ms: Date.now() - started,
    };
    appendFileSync(ROWS, `${JSON.stringify(row)}\n`);
    console.log(ply, turn, row.best, row.played, row.eval, row.blackScore, `d${row.depth}`);
  }
  child.stdin.end('END\n');
} else if (mode === 'build') {
  const record = JSON.parse(readFileSync(GAME, 'utf8')) as GameRecord;
  const states = replay(record);
  const final = states.at(-1)!.status;
  if (final.type !== 'finished' || final.reason !== 'five' || final.winner !== 'black')
    throw new Error('the recorded game is a five in a row for Black');
  // Black moves first from every dealt opening, so Black is the pipeline's first mover.
  if (states[0]!.status.type !== 'playing' || states[0]!.status.turn !== 'black')
    throw new Error('Black moves first');
  const moves = record.moves.map((m) => m.to);
  const rows = readFileSync(ROWS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalRow)
    .sort((a, b) => a.ply - b.ply);
  if (rows.length !== moves.length)
    throw new Error(`${rows.length} rows for ${moves.length} plies`);
  rows.forEach((r, i) => {
    if (r.ply !== i || r.played !== moves[i]) throw new Error(`row ${i} is not ply ${i}`);
  });

  const blackScore = rows.map((r) => r.blackScore);
  blackScore.push(1);
  const best = rows.map((r) => r.best);
  // A placement is one point, not a from-to move, so no sidelines (study-annotate
  // draws a line's arrow from its first move's two squares).
  const base = { rootFen: record.rootFen, moves, redScore: blackScore, best };
  const marks = judgedMoves(base);
  const notes = readNotes('gomoku');
  const tree = annotateFromEngine({ ...base, ...noted(notes, []) });
  writePlan('gomoku', 'plan', {
    create: {
      owner: 'mistboard',
      name: 'Gomoku: an engine game, annotated',
      description:
        'Rapfi at Level 8 (Black) against Rapfi at Level 7 (White) from a dealt opening, read by Rapfi at a far deeper search. From the Gomoku rules page at mistboard.com/rules/gomoku.',
      visibility: 'public',
      chapter: {
        name: notes.title ?? 'Rapfi Level 8 vs Rapfi Level 7',
        variant: 'gomoku',
        orientation: 'black',
        tree,
        tags: {
          black: record.black,
          white: record.white,
          result: '1-0',
          event: 'Rapfi Level 8 vs Level 7, Mistboard bot settings',
          date: '2026-11-14',
        },
        scoreSeries: {
          side: 'black',
          series: [{ name: 'Rapfi', color: 'a', values: blackScore }],
        },
      },
    },
    ops: [],
  });
  report(marks, []);
} else {
  throw new Error('mode: play | analyse | build');
}
