// The KataGo-AnimalChess GTP bridge shared by the lab's KataGo scripts
// (jungle-katago-evals.ts, jungle-katago-lines.ts). Conventions are the match
// harness's (jungle-katago-match.ts): KataGo's board is the left-right mirror
// of ours and its leopard is J; the analysis config reports winrates as KataGo's
// WHITE, which is our black.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { resolve } from 'node:path';

export class LineProc {
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

export const FILES = 'abcdefg';
export const fromKata = (v: string): string =>
  /^[A-Ga-g][1-9]$/.test(v)
    ? `${FILES[6 - FILES.indexOf(v[0]!.toLowerCase())]}${v.slice(1)}`
    : v.toLowerCase();

export function toKataFen(fen: string): { board: string; turn: 'w' | 'b' } {
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

export type KInfo = {
  move: string;
  visits: number;
  winrateBlack: number;
  drawPct: number;
  pv: string[];
};

export function parseKataInfo(line: string): KInfo[] {
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

export class Kata {
  p: LineProc;
  constructor(katago: string, model: string, config: string) {
    this.p = new LineProc(resolve(katago), [
      'gtp',
      '-model',
      resolve(model),
      '-config',
      resolve(config),
    ]);
  }
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
  /** KataGo's own move: stage 1 picks the piece, stage 2 the square. Returns the
   *  move in our coordinates and the stage-1 search (the evaluation). */
  async genmove(fen: string): Promise<{ move: string; infos: KInfo[] }> {
    const { board, turn } = toKataFen(fen);
    await this.cmd('clear_board');
    await this.cmd(`setfen ${board} ${turn}`);
    const stage = async (): Promise<{ infos: KInfo[]; play: string }> => {
      const lines = await this.cmd('kata-genmove_analyze 100000');
      const info = lines.filter((l) => l.startsWith('info')).at(-1) ?? '';
      const play = lines.find((l) => l.startsWith('play'))!.split(/\s+/)[1]!;
      return {
        infos: parseKataInfo(info).sort((a, b) => b.visits - a.visits),
        play: fromKata(play),
      };
    };
    const s1 = await stage();
    const s2 = await stage();
    return { move: `${s1.play}${s2.play}`, infos: s1.infos };
  }
}
