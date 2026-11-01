import { type GomokuColor, type GomokuState, mustBlock, winsInOne } from './variants-gomoku.js';

export interface RapfiPoint {
  x: number;
  y: number;
}

export interface RapfiPosition {
  turn: 1 | 2;
  stones: readonly (RapfiPoint & { player: 1 | 2 })[];
}

export interface RapfiCandidate {
  /** Rapfi's zero-based PV index. */
  pvIndex: number;
  numPv: number;
  move: RapfiPoint;
  /** Integer evaluation from the side to move, including when that side is White. */
  eval: number;
  /** VALUE_MATE = 30000; distance is in plies, not full moves. */
  forcedFive: { result: 'win' | 'loss'; plies: number } | null;
  pv: readonly RapfiPoint[];
  depth: number;
  seldepth: number;
  nodes: number;
  totalNodes: number;
  timeMs: number;
  speed: number;
  winrate: number;
}

export interface RapfiChoiceOptions {
  /** Take at most this many distinct legal candidates, ordered by evaluation. */
  candidateCount: number;
  /** Inclusive maximum loss of evaluation against the best legal candidate. */
  evalMargin: number;
  /** Unsigned 32-bit seed; the caller varies it per game/ply for varied play. */
  seed: number;
}

const fields = {
  NUMPV: 'numPv',
  DEPTH: 'depth',
  SELDEPTH: 'seldepth',
  NODES: 'nodes',
  TOTALNODES: 'totalNodes',
  TOTALTIME: 'timeMs',
  SPEED: 'speed',
  EVAL: 'eval',
  WINRATE: 'winrate',
} as const;
type Field = (typeof fields)[keyof typeof fields];

function onBoard(point: RapfiPoint): boolean {
  return (
    Number.isInteger(point.x) &&
    point.x >= 0 &&
    point.x < 15 &&
    Number.isInteger(point.y) &&
    point.y >= 0 &&
    point.y < 15
  );
}

/** Parse the pinned 1387d11 structured INFO stream, never human MESSAGE text.
 * Iterative deepening can leave a truncated last block: only PV DONE commits a
 * block, and each index retains its own last complete, valid block. */
// Rapfi prints a mate as "+M<plies>" / "-M<plies>" (core/iohelper.cpp), the
// distance from VALUE_MATE = 30000. Map it back onto that scale so the
// forced-five check below reads one representation. "+M*" (a database mate
// with no distance) and VAL_INF stay NaN and drop the block.
function rapfiValue(text: string): number {
  const mate = /^([+-])M(\d+)$/.exec(text);
  if (!mate) return Number(text);
  // A five is at most 225 plies away on a 15x15 board; beyond that is garbage.
  if (Number(mate[2]) > 225) return Number.NaN;
  const value = 30000 - Number(mate[2]);
  return mate[1] === '-' ? -value : value;
}

export function parseRapfiOutput(output: string | readonly string[]): RapfiCandidate[] {
  const latest = new Map<number, RapfiCandidate>();
  let block:
    | { pvIndex: number; values: Partial<Record<Field, number>>; pv?: RapfiPoint[] }
    | undefined;
  for (const raw of typeof output === 'string' ? output.split('\n') : output) {
    const line = raw.trim();
    if (line === 'INFO PV DONE') {
      if (block) {
        const { pvIndex, values, pv } = block;
        const {
          numPv,
          depth,
          seldepth,
          nodes,
          totalNodes,
          timeMs,
          speed,
          eval: ev,
          winrate,
        } = values;
        if (
          numPv !== undefined &&
          depth !== undefined &&
          seldepth !== undefined &&
          nodes !== undefined &&
          totalNodes !== undefined &&
          timeMs !== undefined &&
          speed !== undefined &&
          ev !== undefined &&
          winrate !== undefined &&
          pv?.length &&
          [pvIndex, numPv, depth, seldepth, nodes, totalNodes, ev].every(Number.isSafeInteger) &&
          numPv >= 1 &&
          numPv <= 225 &&
          pvIndex >= 0 &&
          pvIndex < numPv &&
          depth >= 0 &&
          seldepth >= 0 &&
          nodes >= 0 &&
          totalNodes >= 0 &&
          Number.isFinite(timeMs) &&
          timeMs >= 0 &&
          Number.isFinite(speed) &&
          speed >= 0 &&
          Math.abs(ev) <= 30000 &&
          Number.isFinite(winrate) &&
          winrate >= 0 &&
          winrate <= 1
        ) {
          latest.set(pvIndex, {
            pvIndex,
            numPv,
            depth,
            seldepth,
            nodes,
            totalNodes,
            timeMs,
            speed,
            eval: ev,
            winrate,
            pv,
            move: { ...pv[0] },
            forcedFive:
              Math.abs(ev) >= 30000 - 225
                ? { result: ev >= 0 ? 'win' : 'loss', plies: 30000 - Math.abs(ev) }
                : null,
          });
        }
      }
      block = undefined;
    } else if (line.startsWith('INFO PV ')) {
      const start = /^INFO PV (\d+)$/.exec(line);
      block = start ? { pvIndex: Number(start[1]), values: {} } : undefined;
    } else if (block && line.startsWith('INFO BESTLINE')) {
      const moves = line.slice('INFO BESTLINE'.length).trim().split(/\s+/);
      const pv: RapfiPoint[] = [];
      for (const move of moves) {
        const match = /^(\d+),(\d+)$/.exec(move);
        if (!match) break;
        const point = { x: Number(match[1]), y: Number(match[2]) };
        if (!onBoard(point)) break;
        pv.push(point);
      }
      block.pv = pv.length === moves.length && pv.length <= 225 ? pv : undefined;
    } else if (block) {
      const info =
        /^INFO (NUMPV|DEPTH|SELDEPTH|NODES|TOTALNODES|TOTALTIME|SPEED|EVAL|WINRATE) (\S+)$/.exec(
          line,
        );
      if (info)
        block.values[fields[info[1] as keyof typeof fields]] =
          info[1] === 'EVAL' ? rapfiValue(info[2]!) : Number(info[2]);
    }
  }
  return [...latest.values()].sort((a, b) => a.pvIndex - b.pvIndex);
}

/** Shared boundary validation and tactical view; playable freestyle positions
 * are supplied by the caller, so no opening-count restriction is imposed. */
export function rapfiPositionState(position: RapfiPosition): GomokuState {
  if (position.turn !== 1 && position.turn !== 2) throw new Error('Invalid Rapfi turn');
  const board: (GomokuColor | null)[] = Array(225).fill(null);
  for (const stone of position.stones) {
    if (!onBoard(stone) || (stone.player !== 1 && stone.player !== 2))
      throw new Error('Invalid Rapfi stone');
    const index = stone.y * 15 + stone.x;
    if (board[index] !== null) throw new Error('Duplicate Rapfi stone');
    board[index] = stone.player === 1 ? 'black' : 'white';
  }
  if (position.stones.length === 225) throw new Error('Rapfi board is full');
  return {
    rule: 'freestyle',
    board,
    ply: position.stones.length,
    status: { type: 'playing', turn: position.turn === 1 ? 'black' : 'white' },
  };
}

export function validateRapfiCandidateCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > 225)
    throw new Error('Invalid Rapfi candidate count');
}

export function validateRapfiChoiceOptions(options: RapfiChoiceOptions): void {
  validateRapfiCandidateCount(options.candidateCount);
  if (
    !Number.isFinite(options.evalMargin) ||
    options.evalMargin < 0 ||
    !Number.isInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffffffff
  )
    throw new Error('Invalid Rapfi choice options');
}

/** Eval-weighted, deterministic choice. Tactical protection outranks both the
 * candidate cap and margin, even when Rapfi omitted the winning/blocking point.
 * An open four has two winning endpoints and is already lost; still block one. */
export function selectRapfiMove(
  position: RapfiPosition,
  candidates: readonly RapfiCandidate[],
  options: RapfiChoiceOptions,
): RapfiPoint {
  validateRapfiChoiceOptions(options);
  const state = rapfiPositionState(position);
  const ranked = candidates
    .filter(
      (candidate) =>
        onBoard(candidate.move) &&
        state.board[candidate.move.y * 15 + candidate.move.x] === null &&
        Number.isSafeInteger(candidate.eval) &&
        Math.abs(candidate.eval) <= 30000,
    )
    .sort(
      (a, b) =>
        b.eval - a.eval || a.pvIndex - b.pvIndex || a.move.y - b.move.y || a.move.x - b.move.x,
    );
  const wins = winsInOne(state);
  const tactics = wins.length ? wins : mustBlock(state);
  if (tactics.length) {
    const safe = tactics.map(({ to }) => ({
      x: to.charCodeAt(0) - 97,
      y: Number(to.slice(1)) - 1,
    }));
    return {
      ...(ranked.find(({ move }) => safe.some((point) => point.x === move.x && point.y === move.y))
        ?.move ?? safe[0]),
    };
  }
  const seen = new Set<string>();
  const distinct = ranked.filter(({ move }) => {
    const key = `${move.x},${move.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!distinct.length) throw new Error('Rapfi returned no legal candidates');
  const best = distinct[0].eval;
  const pool = distinct
    .slice(0, options.candidateCount)
    .filter((candidate) => best - candidate.eval <= options.evalMargin);
  // Softmax with temperature equal to the permitted margin (at least 1).
  // Subtracting best avoids overflow, including for forced-five evaluations.
  const weights = pool.map((candidate) =>
    Math.exp((candidate.eval - best) / Math.max(1, options.evalMargin)),
  );
  // One Mulberry32 sample: no global random state, identical on browser/Node.
  let n = (options.seed + 0x6d2b79f5) >>> 0;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  let ticket =
    (((n ^ (n >>> 14)) >>> 0) / 4294967296) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < pool.length; i++) {
    ticket -= weights[i];
    if (ticket < 0) return { ...pool[i].move };
  }
  return { ...pool[pool.length - 1].move };
}
