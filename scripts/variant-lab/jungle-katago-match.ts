// KataGo-AnimalChess vs MistyJungle under Mistboard's rules (#429).
//
// The kernel (@mistboard/game) is the referee: it owns legality, den entry,
// capture-all, stalemate, the 200-ply progress clock and threefold repetition.
// Both engines only propose moves; an illegal proposal loses the game for the
// engine that made it, and that is recorded rather than patched over.
//
//   MistyJungle  = the misty-jungle UCI binary, `go nodes N` (default 5M, the
//                  shipped bot budget), fed `position fen <fen> [reps ...]`.
//   KataGo       = hzyhhzy/KataGomo branch AnimalChess2025 built with the Eigen
//                  backend, GTP, driven with `setfen` + a two-stage `genmove`
//                  (choose the piece, then the destination) at a fixed visit
//                  count from its config.
//
// Coordinates. KataGo's board is the LEFT-RIGHT MIRROR of ours (its start has the
// lion on a9 and the tiger on g9; ours has the tiger on a9 and the lion on g9) and
// its piece letters differ in one place (J = leopard, ours P). Jungle is symmetric
// under a left-right mirror, so every square crossing the bridge is mirrored
// (file f -> 6 - f), ranks kept; captures, traps, dens and water all line up.
// KataGo's "black" (uppercase, bottom, moves first) is our red.
//
// Usage (from the repo root):
//   npx tsx scripts/variant-lab/jungle-katago-match.ts \
//     --katago ~/projects/tools/KataGomo-animalchess/cpp/build/katago \
//     --model <b10c384nbt.bin.gz> --config <gtp.cfg> \
//     --misty ~/projects/misty-jungle/target/release/jungle-engine \
//     --games 200 --nodes 5000000 --out tmp/jungle-katago/run1.jsonl
//
// Colours alternate every game; game i has KataGo as red when i is even. Each
// finished game is appended to --out as one JSON line (moves, result, reason)
// so a run can be resumed by skipping the games already present.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  getJungleLegalMoves,
  isJungleLegalMove,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
  jungleMoveToEngineUci,
  jungleRepSeedFens,
  jungleStateToEngineFen,
} from '@mistboard/game';

type Args = {
  katago: string;
  model: string;
  config: string;
  misty: string;
  games: number;
  nodes: number;
  out: string;
  maxPlies: number;
  // Play exactly this game index and exit (one container per game on Modal).
  only: number | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    katago: '',
    model: '',
    config: '',
    misty: resolve(process.env.HOME ?? '', 'projects/misty-jungle/target/release/jungle-engine'),
    games: 200,
    nodes: 5_000_000,
    out: 'tmp/jungle-katago/run.jsonl',
    maxPlies: 600,
    only: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? '';
    if (a === '--katago') args.katago = next();
    else if (a === '--model') args.model = next();
    else if (a === '--config') args.config = next();
    else if (a === '--misty') args.misty = next();
    else if (a === '--games') args.games = Number(next());
    else if (a === '--nodes') args.nodes = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--max-plies') args.maxPlies = Number(next());
    else if (a === '--only') args.only = Number(next());
    else throw new Error(`unknown arg ${a}`);
  }
  for (const k of ['katago', 'model', 'config'] as const) {
    if (!args[k]) throw new Error(`--${k} is required`);
  }
  return args;
}

// ── line-oriented subprocess ─────────────────────────────────────────────────

class LineProc {
  #proc: ChildProcessWithoutNullStreams;
  #buf = '';
  #waiter: {
    done: (line: string) => boolean;
    resolve: (lines: string[]) => void;
    lines: string[];
  } | null = null;

  constructor(binary: string, argv: string[]) {
    this.#proc = spawn(binary, argv, { stdio: ['pipe', 'pipe', 'inherit'] });
    this.#proc.stdout.setEncoding('utf8');
    this.#proc.stdout.on('data', (chunk: string) => {
      this.#buf += chunk;
      let nl = this.#buf.indexOf('\n');
      while (nl >= 0) {
        const line = this.#buf.slice(0, nl).replace(/\r$/, '');
        this.#buf = this.#buf.slice(nl + 1);
        const w = this.#waiter;
        if (w) {
          w.lines.push(line);
          if (w.done(line)) {
            this.#waiter = null;
            w.resolve(w.lines);
          }
        }
        nl = this.#buf.indexOf('\n');
      }
    });
    this.#proc.on('exit', (code) => {
      if (this.#waiter) throw new Error(`${binary} exited (${code}) mid-request`);
    });
  }

  request(cmds: string[], done: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolveLines) => {
      this.#waiter = { done, resolve: resolveLines, lines: [] };
      for (const cmd of cmds) this.#proc.stdin.write(`${cmd}\n`);
    });
  }

  write(cmd: string): void {
    this.#proc.stdin.write(`${cmd}\n`);
  }

  quit(cmd: string): void {
    this.#proc.stdin.write(`${cmd}\n`);
    this.#proc.stdin.end();
  }
}

// ── MistyJungle (UCI) ────────────────────────────────────────────────────────

class Misty {
  #p: LineProc;
  constructor(binary: string) {
    this.#p = new LineProc(binary, []);
  }
  async init(): Promise<string> {
    const lines = await this.#p.request(['uci'], (l) => l === 'uciok');
    return lines.find((l) => l.startsWith('id name'))?.slice(8) ?? 'MistyJungle';
  }
  async newGame(): Promise<void> {
    await this.#p.request(['ucinewgame', 'isready'], (l) => l === 'readyok');
  }
  async bestMove(
    state: JungleGameState,
    history: JungleGameState[],
    nodes: number,
  ): Promise<JungleMove | null> {
    const reps = jungleRepSeedFens(history);
    const pos = `position fen ${jungleStateToEngineFen(state)}${reps.length ? ` reps ${reps.join(';')}` : ''}`;
    const lines = await this.#p.request([pos, `go nodes ${nodes} movetime 60000`], (l) =>
      l.startsWith('bestmove'),
    );
    const bm = lines.find((l) => l.startsWith('bestmove'))!.split(/\s+/)[1];
    return engineUciToJungleMove(bm);
  }
  quit(): void {
    this.#p.quit('quit');
  }
}

// ── KataGo-AnimalChess (GTP) ─────────────────────────────────────────────────

const FILES = 'abcdefg';

// Our square -> KataGo vertex (mirrored file, same rank, uppercase letter).
function toKata(sq: JungleSquare): string {
  const f = FILES.indexOf(sq[0]!);
  return `${FILES[6 - f]!.toUpperCase()}${sq.slice(1)}`;
}
function fromKata(vertex: string): JungleSquare {
  const f = FILES.indexOf(vertex[0]!.toLowerCase());
  return `${FILES[6 - f]}${vertex.slice(1)}` as JungleSquare;
}

// Our engine FEN -> KataGo FEN: mirror each rank string, swap P<->J, turn r/b -> w/b.
function toKataFen(fen: string): { board: string; turn: 'w' | 'b' } {
  const [board, turn] = fen.split(' ');
  const ranks = board!.split('/').map((rank) => {
    // expand digits, reverse, re-compress
    const cells: string[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '9') for (let i = 0; i < Number(ch); i += 1) cells.push('.');
      else cells.push(ch === 'P' ? 'J' : ch === 'p' ? 'j' : ch);
    }
    cells.reverse();
    let out = '';
    let run = 0;
    for (const c of cells) {
      if (c === '.') run += 1;
      else {
        if (run) out += String(run);
        run = 0;
        out += c;
      }
    }
    if (run) out += String(run);
    return out;
  });
  return { board: ranks.join('/'), turn: turn === 'r' ? 'w' : 'b' };
}

class Kata {
  #p: LineProc;
  constructor(binary: string, model: string, config: string) {
    this.#p = new LineProc(binary, ['gtp', '-model', model, '-config', config]);
  }
  async #cmd(cmd: string): Promise<string> {
    const lines = await this.#p.request([cmd], (l) => l === '');
    const first = lines.find((l) => l.startsWith('=') || l.startsWith('?')) ?? '';
    if (first.startsWith('?')) throw new Error(`katago: ${cmd} -> ${first}`);
    return first.replace(/^=\s*/, '').trim();
  }
  async init(): Promise<string> {
    const name = await this.#cmd('name');
    const version = await this.#cmd('version');
    return `${name} ${version}`;
  }
  async setPosition(state: JungleGameState): Promise<void> {
    const { board, turn } = toKataFen(jungleStateToEngineFen(state));
    await this.#cmd('clear_board');
    await this.#cmd(`setfen ${board} ${turn}`);
  }
  // Two-stage: the first genmove answers with the piece, the second with the destination.
  async genMove(mover: JungleColor): Promise<JungleMove | null> {
    const colour = mover === 'red' ? 'b' : 'w'; // KataGo ignores it, but GTP wants one
    const from = await this.#cmd(`genmove ${colour}`);
    if (from === 'pass' || from === 'resign') return null;
    const to = await this.#cmd(`genmove ${colour}`);
    if (to === 'pass' || to === 'resign') return null;
    return { from: fromKata(from), to: fromKata(to) };
  }
  // Tell KataGo the opponent's move so its tree and loop history stay in step.
  async play(mover: JungleColor, move: JungleMove): Promise<void> {
    const colour = mover === 'red' ? 'b' : 'w';
    await this.#cmd(`play ${colour} ${toKata(move.from)}`);
    await this.#cmd(`play ${colour} ${toKata(move.to)}`);
  }
  quit(): void {
    this.#p.quit('quit');
  }
}

// ── one game ─────────────────────────────────────────────────────────────────

type Seat = 'katago' | 'misty';
type GameRecord = {
  game: number;
  red: Seat;
  black: Seat;
  moves: string[];
  plies: number;
  result: 'red' | 'black' | 'draw';
  reason: string;
  winner: Seat | null;
  seconds: number;
};

async function playGame(
  index: number,
  kata: Kata,
  misty: Misty,
  nodes: number,
  maxPlies: number,
): Promise<GameRecord> {
  const red: Seat = index % 2 === 0 ? 'katago' : 'misty';
  const black: Seat = red === 'katago' ? 'misty' : 'katago';
  const seatOf = (c: JungleColor): Seat => (c === 'red' ? red : black);
  let state = createInitialJungleState(`katago-match-${index}`);
  const history: JungleGameState[] = [state];
  const moves: string[] = [];
  const t0 = Date.now();
  await misty.newGame();
  await kata.setPosition(state);
  let reason = '';
  let result: GameRecord['result'] = 'draw';
  while (state.status.type === 'playing') {
    const mover = state.status.turn;
    const seat = seatOf(mover);
    let move: JungleMove | null;
    if (seat === 'katago') {
      move = await kata.genMove(mover);
    } else {
      move = await misty.bestMove(state, history, nodes);
    }
    if (!move || !isJungleLegalMove(state, move)) {
      // The proposer loses: an illegal or absent move is a forfeit, never repaired.
      result = mover === 'red' ? 'black' : 'red';
      reason = `${seat} proposed ${move ? jungleMoveToEngineUci(move) : 'nothing'}: illegal (${getJungleLegalMoves(state).length} legal)`;
      break;
    }
    if (seat === 'misty') await kata.play(mover, move);
    const next = applyJungleMove(state, move);
    if (!next) throw new Error('kernel refused a move it called legal');
    state = next;
    history.push(state);
    moves.push(jungleMoveToEngineUci(move));
    if (state.status.type === 'playing' && moves.length >= maxPlies) {
      reason = `max plies ${maxPlies}`;
      break;
    }
  }
  if (state.status.type === 'finished') {
    result = state.status.winner ?? 'draw';
    reason = state.status.reason ?? 'finished';
  }
  const winner: Seat | null = result === 'draw' ? null : seatOf(result);
  return {
    game: index,
    red,
    black,
    moves,
    plies: moves.length,
    result,
    reason,
    winner,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const done = new Set<number>();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      if (line.trim()) done.add((JSON.parse(line) as GameRecord).game);
    }
  } else {
    writeFileSync(outPath, '');
  }

  const kata = new Kata(args.katago, args.model, args.config);
  const misty = new Misty(args.misty);
  const [kataName, mistyName] = await Promise.all([kata.init(), misty.init()]);
  console.log(
    `katago: ${kataName}\nmisty:  ${mistyName} (go nodes ${args.nodes})\nout:    ${outPath}`,
  );

  const tally = { katago: 0, misty: 0, draw: 0 };
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as GameRecord;
    if (r.winner) tally[r.winner] += 1;
    else tally.draw += 1;
  }

  for (let i = 0; i < args.games; i += 1) {
    if (done.has(i)) continue;
    if (args.only !== null && i !== args.only) continue;
    const rec = await playGame(i, kata, misty, args.nodes, args.maxPlies);
    appendFileSync(outPath, `${JSON.stringify(rec)}\n`);
    if (rec.winner) tally[rec.winner] += 1;
    else tally.draw += 1;
    const n = tally.katago + tally.misty + tally.draw;
    const score = (tally.katago + tally.draw / 2) / n;
    console.log(
      `game ${i} red=${rec.red} ${rec.result} (${rec.reason}, ${rec.plies} plies, ${rec.seconds}s) ` +
        `| katago ${tally.katago} misty ${tally.misty} draw ${tally.draw} | katago score ${score.toFixed(3)}`,
    );
  }
  kata.quit();
  misty.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
