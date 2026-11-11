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
  /** Chance (0-1) of playing the best candidate outright before sampling. A
   * level's strength in Gomoku is mostly its blunder rate, which this sets. */
  bestRate?: number;
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

/** The stone lines of a BOARD/YXBOARD command. Rapfi places the listed stones in order,
 * alternating sides (a pass goes in between two of the same side), and searches for whoever
 * comes after the last one (command/gomocup.cpp getPosition): field 1 does not by itself make
 * a side the one to move. So the list interleaves and ends on an opponent stone, any surplus
 * first, each side's stones in the order given. */
export function rapfiBoardLines(position: RapfiPosition): string[] {
  const own = position.stones.filter((stone) => stone.player === position.turn);
  const opponent = position.stones.filter((stone) => stone.player !== position.turn);
  if (own.length && !opponent.length)
    throw new Error('Rapfi needs an opponent stone to search for the side to move');
  const lines: string[] = [];
  // Built from the end: opponent, own, opponent, ... then whatever one side has left over.
  for (let i = opponent.length - 1, j = own.length - 1; i >= 0 || j >= 0; i--, j--) {
    if (i >= 0) lines.push(`${opponent[i]!.x},${opponent[i]!.y},2`);
    if (j >= 0) lines.push(`${own[j]!.x},${own[j]!.y},1`);
  }
  return lines.reverse();
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
    options.seed > 0xffffffff ||
    (options.bestRate !== undefined &&
      (!Number.isFinite(options.bestRate) || options.bestRate < 0 || options.bestRate > 1))
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
  if (options.bestRate !== undefined && unitSample(options.seed ^ 0x9e3779b9) < options.bestRate)
    return { ...distinct[0].move };
  const pool = distinct
    .slice(0, options.candidateCount)
    .filter((candidate) => best - candidate.eval <= options.evalMargin);
  // Softmax with temperature equal to the permitted margin (at least 1).
  // Subtracting best avoids overflow, including for forced-five evaluations.
  const weights = pool.map((candidate) =>
    Math.exp((candidate.eval - best) / Math.max(1, options.evalMargin)),
  );
  let ticket = unitSample(options.seed) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < pool.length; i++) {
    ticket -= weights[i];
    if (ticket < 0) return { ...pool[i].move };
  }
  return { ...pool[pool.length - 1].move };
}

/** One Mulberry32 sample in [0, 1): no global random state, identical on browser/Node. */
function unitSample(seed: number): number {
  let n = ((seed >>> 0) + 0x6d2b79f5) >>> 0;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

function validateSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Invalid Rapfi seed');
}

// FNV-1a over UTF-16 code units: identical in browser and Node, with explicit
// domains and separators so game identities and plies cannot alias by joining.
function hashSeed(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index++)
    hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

/** Persist this seed with the game; a room id works without a run seed. */
export function rapfiGameSeed(gameId: string, runSeed = 0): number {
  validateSeed(runSeed);
  if (typeof gameId !== 'string' || !gameId.length) throw new Error('Invalid Rapfi game identity');
  return hashSeed(`game:${runSeed}:${gameId}`);
}

/** Use the kernel's absolute ply (including opening stones), never call order. */
export function rapfiPlySeed(gameSeed: number, ply: number): number {
  validateSeed(gameSeed);
  if (!Number.isSafeInteger(ply) || ply < 0) throw new Error('Invalid Rapfi ply');
  return hashSeed(`ply:${gameSeed}:${ply}`);
}

export type RapfiLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const RAPFI_LEVELS: readonly {
  readonly level: RapfiLevel;
  readonly nodes: number;
  readonly timeMs: number;
  readonly candidateCount?: number;
  readonly evalMargin?: number;
  readonly bestRate?: number;
}[] = Object.freeze([
  // Retuned 2026-11-03 on the offline ladder (scripts/gomoku-level-ladder.mjs,
  // 40 games per adjacent pair): each level scores 67-83% against the one below.
  // L1-5 play the best move with probability bestRate, else a move from the
  // candidate pool; below ~5,000 nodes Rapfi can return no candidates.
  { level: 1, nodes: 5_000, timeMs: 1_000, candidateCount: 64, evalMargin: 20_000 },
  { level: 2, nodes: 5_500, timeMs: 1_000, candidateCount: 64, evalMargin: 20_000, bestRate: 0.6 },
  { level: 3, nodes: 6_000, timeMs: 1_500, candidateCount: 64, evalMargin: 20_000, bestRate: 0.85 },
  { level: 4, nodes: 8_000, timeMs: 1_500, candidateCount: 8, evalMargin: 20_000, bestRate: 0.9 },
  { level: 5, nodes: 10_000, timeMs: 2_000, candidateCount: 3, evalMargin: 20_000, bestRate: 0.97 },
  { level: 6, nodes: 12_000, timeMs: 1_500 },
  // The ladder ran L7-8 at 1.5s; the longer ceilings let a slow phone reach the
  // node budget instead of stopping short of it.
  { level: 7, nodes: 25_000, timeMs: 2_500 },
  { level: 8, nodes: 80_000, timeMs: 3_500 },
]);

/** Shared with the offline ladder so calibration exercises browser commands. */
export function rapfiCommands(
  position: RapfiPosition,
  tier: { nodes: number; timeMs: number; candidateCount?: number },
): { lines: string[]; timeMs: number } {
  if (
    !Number.isSafeInteger(tier.nodes) ||
    tier.nodes < 1 ||
    !Number.isSafeInteger(tier.timeMs) ||
    tier.timeMs < 1
  )
    throw new Error('Invalid Rapfi budget');
  rapfiPositionState(position);
  const count = tier.candidateCount;
  if (count !== undefined) validateRapfiCandidateCount(count);
  return {
    timeMs: tier.timeMs,
    lines: [
      'START 15',
      'INFO rule 0',
      `INFO max_node ${tier.nodes}`,
      `INFO timeout_turn ${tier.timeMs}`,
      ...(count !== undefined ? ['INFO show_detail 2'] : []),
      // BOARD's 1 means us, 2 means opponent, regardless of stone color; the order decides
      // who Rapfi searches for (rapfiBoardLines).
      position.stones.length
        ? [count !== undefined ? 'YXBOARD' : 'BOARD', ...rapfiBoardLines(position), 'DONE'].join(
            '\n',
          )
        : count !== undefined
          ? `YXNBEST ${count}`
          : 'BEGIN',
      ...(count !== undefined && position.stones.length ? [`YXNBEST ${count}`] : []),
    ],
  };
}

/** Identical search policy for native PvE, browser analysis and calibration. */
export function rapfiLevelRequest(
  position: RapfiPosition,
  level: RapfiLevel,
  seedOrChoice: number | RapfiChoiceOptions = 0,
): { lines: string[]; timeMs: number; choice?: RapfiChoiceOptions } {
  const tier = RAPFI_LEVELS.find((entry) => entry.level === level);
  if (!tier) throw new Error('Unknown Rapfi level');
  if (typeof seedOrChoice === 'number') validateSeed(seedOrChoice);
  // Rapfi short-circuits an empty board to centre without emitting PVs.
  // Explicit candidate requests retain their fail-closed parsing contract.
  const choice =
    typeof seedOrChoice !== 'number'
      ? seedOrChoice
      : tier.candidateCount !== undefined && position.stones.length > 0
        ? {
            candidateCount: tier.candidateCount,
            evalMargin: tier.evalMargin ?? 0,
            seed: seedOrChoice,
            ...(tier.bestRate === undefined ? {} : { bestRate: tier.bestRate }),
          }
        : undefined;
  const { lines, timeMs } = rapfiCommands(position, {
    ...tier,
    candidateCount: choice?.candidateCount,
  });
  // Validate options before allocating a worker, including on an empty board.
  if (choice) validateRapfiChoiceOptions(choice);
  return { lines, timeMs, choice };
}
