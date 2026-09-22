// What a batch of banqi self-play games says about the game. Replays every
// game through the kernel and prints the rates a result post can quote, with
// the sample size beside each so nobody quotes a 20-game number as a fact.
//
//   npx tsx scripts/banqi-games-stats.ts tmp/banqi-study/game-*.json
//   npx tsx scripts/banqi-games-stats.ts --json out.json tmp/banqi-study/game-*.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiSquare,
  createInitialBanqiState,
} from '@mistboard/game';

type SelfPlayGame = {
  nodes: number;
  seed: number;
  moves: string;
  plies: number;
  status: { type: string; winner?: 'red' | 'black' | null; reason?: string };
  deal: BanqiDeal;
};

const ROLE_VALUE: Record<BanqiPieceRole, number> = {
  general: 12,
  advisor: 7,
  elephant: 6,
  chariot: 5,
  horse: 4,
  cannon: 6,
  soldier: 2,
};
const RANKS: BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

type Row = {
  seed: string;
  plies: number;
  moves: number;
  winnerSeat: 'red' | 'black' | null;
  reason: string;
  firstFlipRole: BanqiPieceRole;
  firstFlipColor: 'red' | 'black';
  flips: number;
  captures: number;
  firstCapturePly: number;
  generalsTaken: number;
  firstGeneralPly: number | null;
  /** Did the side that lost its general first go on to lose the game? */
  lostGeneralFirstLost: boolean | null;
  /** Largest material lead either side held, in ROLE_VALUE points. */
  maxLead: number;
  leadChanges: number;
  /** Plies from the last lead change (or first capture) to the end. */
  decidedForPlies: number;
  winnerLedFromMove: number | null;
};

function parseMove(token: string): BanqiMove {
  return { from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare };
}

function replay(game: SelfPlayGame): Row {
  let state: BanqiGameState = createInitialBanqiState(`s-${game.seed}`, game.deal);
  const tokens = game.moves.trim().split(/\s+/);
  let flips = 0;
  let captures = 0;
  let firstCapturePly = 0;
  const taken = { red: 0, black: 0 }; // value each INK has taken
  let leader: 'red' | 'black' | null = null;
  let leadChanges = 0;
  let lastChangePly = 0;
  let maxLead = 0;
  let generalsTaken = 0;
  let firstGeneralPly: number | null = null;
  let firstGeneralOwner: 'red' | 'black' | null = null;
  let firstFlipRole: BanqiPieceRole | null = null;
  let firstFlipColor: 'red' | 'black' | null = null;
  let winnerLedFromMove: number | null = null;
  for (const [i, token] of tokens.entries()) {
    const move = parseMove(token);
    const before = state;
    state = applyBanqiMove(state, move);
    if (state === before) throw new Error(`seed ${game.seed}: ply ${i + 1} ${token} refused`);
    if (move.from === move.to) {
      flips += 1;
      if (firstFlipRole === null) {
        const p = state.board[move.to];
        if (p) {
          firstFlipRole = p.role;
          firstFlipColor = p.color;
        }
      }
      continue;
    }
    if (state.captures.length > before.captures.length) {
      captures += 1;
      if (!firstCapturePly) firstCapturePly = i + 1;
      const cap = state.captures[state.captures.length - 1];
      const captor = cap.owner === 'red' ? 'black' : 'red';
      taken[captor] += ROLE_VALUE[cap.role];
      if (cap.role === 'general') {
        generalsTaken += 1;
        if (firstGeneralPly === null) {
          firstGeneralPly = i + 1;
          firstGeneralOwner = cap.owner;
        }
      }
      const diff = taken.red - taken.black;
      maxLead = Math.max(maxLead, Math.abs(diff));
      const now: 'red' | 'black' | null = diff > 0 ? 'red' : diff < 0 ? 'black' : null;
      if (now !== null && now !== leader) {
        if (leader !== null) leadChanges += 1;
        leader = now;
        lastChangePly = i + 1;
      }
    }
  }
  const status = state.status;
  const winnerSeat = status.type === 'finished' ? (status.winner ?? null) : null;
  const firstColor = state.firstColor ?? 'red';
  const inkOf = (seat: 'red' | 'black'): 'red' | 'black' =>
    seat === 'red' ? firstColor : firstColor === 'red' ? 'black' : 'red';
  const winnerInk = winnerSeat ? inkOf(winnerSeat) : null;
  if (winnerInk && leader === winnerInk) winnerLedFromMove = Math.ceil(lastChangePly / 2);
  return {
    seed: String(game.seed),
    plies: tokens.length,
    moves: Math.ceil(tokens.length / 2),
    winnerSeat,
    reason: status.type === 'finished' ? (status.reason ?? '') : 'unfinished',
    firstFlipRole: firstFlipRole ?? 'soldier',
    firstFlipColor: firstFlipColor ?? 'red',
    flips,
    captures,
    firstCapturePly,
    generalsTaken,
    firstGeneralPly,
    lostGeneralFirstLost: firstGeneralOwner && winnerInk ? firstGeneralOwner !== winnerInk : null,
    maxLead,
    leadChanges,
    decidedForPlies: tokens.length - lastChangePly,
    winnerLedFromMove,
  };
}

function pct(n: number, d: number): string {
  if (!d) return 'n/a';
  const p = (100 * n) / d;
  const se = 100 * Math.sqrt(((p / 100) * (1 - p / 100)) / d);
  return `${p.toFixed(1)}% ±${se.toFixed(1)} (${n}/${d})`;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const rows: Row[] = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(resolve(f), 'utf8')) as { games: SelfPlayGame[] };
  for (const g of data.games) rows.push(replay(g));
}
const n = rows.length;
const decisive = rows.filter((r) => r.winnerSeat !== null);
const firstWins = decisive.filter((r) => r.winnerSeat === 'red').length;
const out: string[] = [];
out.push(`games ${n}, decisive ${decisive.length}, drawn ${n - decisive.length}`);
out.push(`first seat wins (of decisive): ${pct(firstWins, decisive.length)}`);
out.push(
  `first seat wins (of all, draws as half): ${(((firstWins + (n - decisive.length) / 2) / n) * 100).toFixed(1)}%`,
);
const reasons = new Map<string, number>();
for (const r of rows) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
out.push(`endings: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')}`);
out.push(
  `length: median ${median(rows.map((r) => r.moves))} moves, min ${Math.min(...rows.map((r) => r.moves))}, max ${Math.max(...rows.map((r) => r.moves))}`,
);
out.push(
  `flips: median ${median(rows.map((r) => r.flips))} of 32; captures: median ${median(rows.map((r) => r.captures))}; first capture: median ply ${median(rows.map((r) => r.firstCapturePly))}`,
);
out.push('first flip by rank → first seat win rate (decisive games):');
for (const role of RANKS) {
  const sub = decisive.filter((r) => r.firstFlipRole === role);
  const w = sub.filter((r) => r.winnerSeat === 'red').length;
  out.push(
    `  ${role.padEnd(8)} ${pct(w, sub.length)}  (${rows.filter((r) => r.firstFlipRole === role).length} games)`,
  );
}
const gTaken = rows.filter((r) => r.generalsTaken > 0);
out.push(
  `a general was captured in ${pct(gTaken.length, n)} of games; both generals in ${pct(rows.filter((r) => r.generalsTaken === 2).length, n)}`,
);
const lgf = rows.filter((r) => r.lostGeneralFirstLost !== null);
out.push(
  `the side that lost its general first lost the game: ${pct(lgf.filter((r) => r.lostGeneralFirstLost).length, lgf.length)}`,
);
out.push(`first general capture: median ply ${median(gTaken.map((r) => r.firstGeneralPly ?? 0))}`);
out.push(
  `lead changes: median ${median(rows.map((r) => r.leadChanges))}, max ${Math.max(...rows.map((r) => r.leadChanges))}; max lead: median ${median(rows.map((r) => r.maxLead))} points (general 12, advisor 7, elephant/cannon 6, chariot 5, horse 4, soldier 2)`,
);
const wl = decisive.filter((r) => r.winnerLedFromMove !== null);
out.push(
  `winner held the material lead at the end: ${pct(wl.length, decisive.length)}; winner's lead taken at median move ${median(wl.map((r) => r.winnerLedFromMove ?? 0))} of a median ${median(decisive.map((r) => r.moves))}`,
);
console.log(out.join('\n'));
if (jsonOut)
  writeFileSync(resolve(jsonOut), `${JSON.stringify({ summary: out, rows }, null, 2)}\n`);
