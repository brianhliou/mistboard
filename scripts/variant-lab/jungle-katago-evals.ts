// Both engines' evaluations of positions from the 2026-09-21 KataGo vs
// MistyJungle match (#429), for the KataGo post's calibration chart and its
// per-game charts. Each position is scored by both engines at the match budget:
//
//   MistyJungle 0.0.6  `go nodes 5000000` (1 thread), fed the kernel's FEN plus
//                      the game's repetition seeds, as the match harness does.
//                      Score is centipawns for the side to move.
//   KataGo-AnimalChess one `kata-genmove_analyze` at 1,000 visits (4 threads):
//                      the stage-1 search (which piece to move) is the
//                      evaluation; its most-visited candidate's `winrate` is
//                      black's expected score (win + draw/2; the config reports
//                      winrates as KataGo's WHITE, which is our black), and its
//                      PV's first two squares are the full move it prefers.
//
// Bridge conventions (mirrored files, P<->J for the leopard) are the match
// harness's (jungle-katago-match.ts). Method and the game-67 precedent:
// docs-private/videos/jungle-katago-01/eval-notes.md.
//
// Usage (from the repo root; appends one JSON line per position to --out and
// skips positions already there, so a run can be resumed):
//   npx tsx scripts/variant-lab/jungle-katago-evals.ts \
//     --games-file ~/projects/brianhliou.com/assets/jungle-games/katago-vs-misty-2026-09-21.jsonl \
//     --games 0,5,10 [--every-game 5] [--stride 4] [--shard 0/3] --out evals.jsonl

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
  jungleRepSeedFens,
  jungleStateToEngineFen,
} from '@mistboard/game';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME ?? '';
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const GAMES_FILE = resolve(
  arg(
    '--games-file',
    `${HOME}/projects/brianhliou.com/assets/jungle-games/katago-vs-misty-2026-09-21.jsonl`,
  ),
);
const KATAGO = resolve(
  arg('--katago', `${HOME}/projects/tools/KataGomo-animalchess/cpp/build/katago`),
);
const MODEL = resolve(
  arg(
    '--model',
    `${HOME}/projects/mistboard-engine/lab/jungle-katago-2026-09-21/b10c384nbt.bin.gz`,
  ),
);
const MISTY = resolve(arg('--misty', `${HOME}/projects/misty-jungle/target/release/jungle-engine`));
const CONFIG = resolve(arg('--config', resolve(HERE, 'jungle-katago-analysis.cfg')));
const NODES = Number(arg('--nodes', '5000000'));
const STRIDE = Number(arg('--stride', '1'));
const EVERY_GAME = Number(arg('--every-game', '0'));
const GAME_LIST = arg('--games', '').split(',').filter(Boolean).map(Number);
const [SHARD, SHARDS] = arg('--shard', '0/1').split('/').map(Number) as [number, number];
const OUT = resolve(arg('--out', 'jungle-katago-evals.jsonl'));

class LineProc {
  #proc: ChildProcessWithoutNullStreams;
  #buf = '';
  #waiter: {
    done: (l: string) => boolean;
    resolve: (ls: string[]) => void;
    lines: string[];
  } | null = null;
  constructor(bin: string, args: string[]) {
    this.#proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
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
  }
  request(cmds: string[], done: (l: string) => boolean): Promise<string[]> {
    return new Promise((res) => {
      this.#waiter = { done, resolve: res, lines: [] };
      for (const c of cmds) this.#proc.stdin.write(`${c}\n`);
    });
  }
  quit(cmd: string): void {
    this.#proc.stdin.write(`${cmd}\n`);
    this.#proc.stdin.end();
  }
}

const FILES = 'abcdefg';
const fromKata = (v: string): string =>
  /^[A-Ga-g][1-9]$/.test(v)
    ? `${FILES[6 - FILES.indexOf(v[0]!.toLowerCase())]}${v.slice(1)}`
    : v.toLowerCase();

function toKataFen(fen: string): { board: string; turn: 'w' | 'b' } {
  const [board, turn] = fen.split(' ');
  const ranks = board!.split('/').map((rank) => {
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

type KInfo = { move: string; visits: number; winrateBlack: number; drawPct: number; pv: string[] };

function parseKataInfo(line: string): KInfo[] {
  const out: KInfo[] = [];
  for (const seg of line.split(/(?:^|\s)info\s/).filter((s) => s.trim())) {
    const t = seg.trim().split(/\s+/);
    const get = (k: string): string => t[t.indexOf(k) + 1]!;
    const pvAt = t.indexOf('pv');
    out.push({
      move: fromKata(get('move')),
      visits: Number(get('visits')),
      winrateBlack: Number(get('winrate')),
      // KataGomo reports the draw percentage in the scoreMean slot.
      drawPct: Number(get('scoreMean')),
      pv: t.slice(pvAt + 1, pvAt + 9).map(fromKata),
    });
  }
  return out;
}

class Kata {
  p = new LineProc(KATAGO, ['gtp', '-model', MODEL, '-config', CONFIG]);
  async cmd(c: string): Promise<string[]> {
    const lines = await this.p.request([c], (l) => l === '');
    const err = lines.find((l) => l.startsWith('?'));
    if (err) throw new Error(`katago ${c}: ${err}`);
    return lines;
  }
  async evaluate(fen: string): Promise<KInfo[]> {
    const { board, turn } = toKataFen(fen);
    await this.cmd('clear_board');
    await this.cmd(`setfen ${board} ${turn}`);
    const lines = await this.cmd('kata-genmove_analyze 100000');
    const info = lines.filter((l) => l.startsWith('info')).at(-1) ?? '';
    return parseKataInfo(info).sort((a, b) => b.visits - a.visits);
  }
}

class Misty {
  p = new LineProc(MISTY, []);
  async evaluate(state: JungleGameState, history: JungleGameState[]) {
    const reps = jungleRepSeedFens(history);
    const pos = `position fen ${jungleStateToEngineFen(state)}${reps.length ? ` reps ${reps.join(';')}` : ''}`;
    const lines = await this.p.request(
      ['ucinewgame', pos, `go nodes ${NODES} movetime 120000`],
      (l) => l.startsWith('bestmove'),
    );
    const info =
      lines.filter((l) => l.startsWith('info ') && l.includes(' score cp ')).at(-1) ?? '';
    const t = info.split(/\s+/);
    const num = (k: string): number | null => (t.includes(k) ? Number(t[t.indexOf(k) + 1]) : null);
    return {
      cpStm: num('cp'),
      depth: num('depth'),
      best: lines.find((l) => l.startsWith('bestmove'))!.split(/\s+/)[1]!,
    };
  }
}

type GameRecord = {
  game: number;
  red: 'katago' | 'misty';
  moves: string[];
  plies: number;
  result: 'draw' | 'red' | 'black';
};

async function main(): Promise<void> {
  const records: GameRecord[] = readFileSync(GAMES_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const chosen = records.filter((r) =>
    GAME_LIST.length > 0 ? GAME_LIST.includes(r.game) : EVERY_GAME > 0 && r.game % EVERY_GAME === 0,
  );
  const jobs: Array<{ rec: GameRecord; ply: number }> = [];
  for (const rec of chosen) {
    for (let ply = 0; ply < rec.plies; ply += STRIDE) jobs.push({ rec, ply });
  }
  const mine = jobs.filter((_, i) => i % SHARDS === SHARD);
  const done = new Set(
    existsSync(OUT)
      ? readFileSync(OUT, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const r = JSON.parse(l) as { game: number; ply: number };
            return `${r.game}:${r.ply}`;
          })
      : [],
  );
  const todo = mine.filter((j) => !done.has(`${j.rec.game}:${j.ply}`));
  console.log(`games ${chosen.length}, positions ${mine.length} in shard, ${todo.length} to do`);

  const kata = new Kata();
  const misty = new Misty();
  await misty.p.request(['uci'], (l) => l === 'uciok');
  const replayed = new Map<number, JungleGameState[]>();
  const statesOf = (rec: GameRecord): JungleGameState[] => {
    const hit = replayed.get(rec.game);
    if (hit) return hit;
    let state = createInitialJungleState(`katago-evals-${rec.game}`);
    const states = [state];
    for (const u of rec.moves) {
      const next = applyJungleMove(state, engineUciToJungleMove(u)!);
      if (!next) throw new Error(`game ${rec.game}: illegal ${u}`);
      state = next;
      states.push(state);
    }
    replayed.set(rec.game, states);
    return states;
  };

  const t0 = Date.now();
  let n = 0;
  for (const { rec, ply } of todo) {
    const states = statesOf(rec);
    const s = states[ply]!;
    const fen = jungleStateToEngineFen(s);
    const tp = Date.now();
    const [m, k] = await Promise.all([
      misty.evaluate(s, states.slice(0, ply + 1)),
      kata.evaluate(fen),
    ]);
    const top = k[0];
    const row = {
      game: rec.game,
      ply,
      plies: rec.plies,
      result: rec.result,
      mistyColor: rec.red === 'misty' ? 'red' : 'black',
      toMove: s.status.type === 'playing' ? s.status.turn : null,
      played: rec.moves[ply] ?? null,
      misty: m,
      kata: top
        ? {
            winrateBlack: top.winrateBlack,
            drawPct: top.drawPct,
            best: top.pv.slice(0, 2).join(''),
            candidates: k.slice(0, 4).map((c) => ({
              move: c.move,
              visits: c.visits,
              winrateBlack: c.winrateBlack,
            })),
          }
        : null,
      sec: (Date.now() - tp) / 1000,
    };
    appendFileSync(OUT, `${JSON.stringify(row)}\n`);
    n += 1;
    console.log(
      `g${rec.game} ply ${ply}/${rec.plies} misty ${m.cpStm} | kata ${top?.winrateBlack.toFixed(3)} | ${row.sec}s | ${n}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }
  kata.p.quit('quit');
  misty.p.quit('quit');
  console.log(`done ${n} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
