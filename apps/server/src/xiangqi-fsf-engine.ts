// Fairy-Stockfish standard-Xiangqi provider for the human-facing difficulty
// ladder. Unlike mainline Pikafish, FSF exposes Stockfish's stochastic Skill
// Level: internally it searches multiple root candidates and sometimes selects a
// plausible suboptimal move. Levels 1-7 copy the Lichess/PlayStrategy weakening
// profiles (skill + depth cap + short movetime) on the classical eval.
//
// Level 8 is different in kind since 2026-09-02. Until then it was skill 20,
// depth 22, 1 s, classical eval, 1 thread, 16 MB hash, on the generic FSF 14
// release binary: a 1 s single-threaded search that never reached its depth cap
// and that the EvE ladder rated ~500 Elo above a random mover. A human beat it
// in 37 moves. The top rung now runs the official FSF xiangqi NNUE net
// (+914 Elo over classical on the fairy-stockfish.github.io ladder) with a NODE
// budget as the CPU-independent strength anchor and the movetime as a latency
// ceiling only, the same contract as the Pikafish tiers and the sibling FSF
// providers (fortress, drop-mini). Measured 2026-09-02 on an M-series laptop:
// ~700k nps, so 1M nodes is ~1.5 s and reaches depth 19-20; prod's slower vCPU
// takes longer to reach the SAME nodes, which is the point of anchoring on them.
//
// The net's architecture needs a Fairy-Stockfish newer than the fairy_sf_14
// release the other FSF variants run on (FSF 14 refuses to load it and exits),
// so this provider resolves its OWN binary, built from the commit pinned in
// fairy-stockfish-xiangqi.ref, and its own net beside it. Levels 1-7 move onto
// that binary too, with `Use NNUE` forced off so their calibration does not drift.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  fairyStockfishPath,
  splitFairyStockfishCommands,
  UciEnginePool,
  type UciEval,
  UciWarmSessionCache,
} from './uci-engine-harness.js';

// Bumped 0.1.0 -> 0.2.0 on 2026-09-02: new binary for every level, NNUE + node
// anchor on Level 8. Recorded per PvE game as the engine build version.
export const XIANGQI_FSF_ENGINE_VERSION = '0.2.0';

/**
 * Short form of the Fairy-Stockfish commit prod builds for this provider. MUST
 * be a prefix of the first line of fairy-stockfish-xiangqi.ref (the railpack
 * build step checks that commit out); xiangqi-fsf-engine-ref.test.ts fails the
 * build if the two drift. Part of the engine configHash so a binary move is a
 * new engine identity in the EvE ladder rather than a silent strength change.
 */
export const XIANGQI_FSF_ENGINE_REF = '1b5bdd40';

/**
 * The official Fairy-Stockfish xiangqi NNUE net (fairy-stockfish/Fairy-Stockfish-NNUE,
 * 2025-10-31). Named by its sha256 prefix, as FSF nets are; the railpack step
 * verifies the full digest before the binary is allowed to load it.
 */
export const XIANGQI_FSF_NNUE_NET = 'xiangqi-c07e94a5c7cb.nnue';

export type XiangqiFsfEngineId = `fairy-stockfish-xiangqi-level-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export type XiangqiFsfEngineTier = {
  id: XiangqiFsfEngineId;
  name: string;
  /** Stockfish `Skill Level` (-20..20); 20 is full strength. */
  skill: number;
  /**
   * Latency ceiling handed to the clock-aware allocator (budgetForMove). For the
   * depth-capped rungs it is also, in practice, the strength knob; for a
   * node-anchored rung it only binds under time pressure.
   */
  movetimeMs: number;
  /** Lichess-style depth cap (levels 1-7). Absent on the node-anchored rung. */
  depth?: number;
  /** Node budget: the CPU-independent strength anchor (level 8). */
  nodes?: number;
  /** `Hash` MB; omitted rungs run the engine default (16). */
  hashMb?: number;
  /** Load XIANGQI_FSF_NNUE_NET. Omitted/false rungs force classical eval. */
  nnue?: boolean;
};

const XIANGQI_FSF_ENGINE_TIERS = [
  {
    id: 'fairy-stockfish-xiangqi-level-1',
    name: 'Fairy-Stockfish Level 1',
    skill: -9,
    depth: 5,
    movetimeMs: 50,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-2',
    name: 'Fairy-Stockfish Level 2',
    skill: -5,
    depth: 5,
    movetimeMs: 100,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-3',
    name: 'Fairy-Stockfish Level 3',
    skill: -1,
    depth: 5,
    movetimeMs: 150,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-4',
    name: 'Fairy-Stockfish Level 4',
    skill: 3,
    depth: 5,
    movetimeMs: 200,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-5',
    name: 'Fairy-Stockfish Level 5',
    skill: 7,
    depth: 5,
    movetimeMs: 300,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-6',
    name: 'Fairy-Stockfish Level 6',
    skill: 11,
    depth: 8,
    movetimeMs: 400,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-7',
    name: 'Fairy-Stockfish Level 7',
    skill: 16,
    depth: 13,
    movetimeMs: 500,
  },
  {
    id: 'fairy-stockfish-xiangqi-level-8',
    name: 'Fairy-Stockfish Level 8',
    skill: 20,
    // 1M nodes with the NNUE net: depth 19-20 from the opening, ~1.5 s on a
    // laptop, an estimated 3-4 s on prod's shared vCPU. The 6 s ceiling leaves
    // the node budget as the binding limit on every offered pace except bullet,
    // where the allocator shrinks the movetime and the rung plays weaker but
    // solvent (the fortress top rung made the same 2000 -> 6000 move).
    nodes: 1_000_000,
    movetimeMs: 6_000,
    hashMb: 64,
    nnue: true,
  },
] as const satisfies readonly XiangqiFsfEngineTier[];

export const XIANGQI_FSF_PLAYABLE_ENGINES: readonly XiangqiFsfEngineTier[] =
  XIANGQI_FSF_ENGINE_TIERS;

const XIANGQI_FSF_ENGINE_BY_ID: ReadonlyMap<string, XiangqiFsfEngineTier> = new Map(
  XIANGQI_FSF_ENGINE_TIERS.map((engine) => [engine.id, engine]),
);

const fsfPool = new UciEnginePool({
  name: 'xiangqi-fsf',
  maxProcessesEnvVar: 'MISTBOARD_XIANGQI_FSF_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_XIANGQI_FSF_QUEUE_TIMEOUT_MS',
  queueTimeoutMessage: 'fairy-stockfish-xiangqi concurrency queue timed out',
});

// The worst-move bot (xiangqi-worst-engine.ts) runs this binary too, so it
// shares the cap.
export const xiangqiFsfLivePool = fsfPool;

// Parked engine processes between moves; the pool above still caps how many
// searches run at once, so live sessions never exceed its slots.
const warmSessions = new UciWarmSessionCache({ name: 'xiangqi-fsf' });

/** Point-in-time warm-session counters (spawned/reused/idle) for diagnostics. */
export function xiangqiFsfWarmSessionStats() {
  return warmSessions.stats();
}

export function xiangqiFsfEngineTierFor(engineId: string | undefined): XiangqiFsfEngineTier | null {
  if (!engineId) return null;
  return XIANGQI_FSF_ENGINE_BY_ID.get(engineId) ?? null;
}

/**
 * Resolve the xiangqi FSF binary: explicit env override, else the railpack-built
 * `/app/bin/fairy-stockfish-xiangqi` (or its cwd-relative dev twin), else the
 * shared FSF resolution (the dev laptop's master build serves both). The shared
 * fallback keeps levels 1-7 alive if the dedicated build is missing; the NNUE
 * rung then fails closed at net load (FSF 14 exits on this net), which is the
 * right failure: a resigned game, not a silently classical "Level 8".
 */
export function xiangqiFsfPath(): string {
  const explicit = process.env.MISTBOARD_FSF_XIANGQI_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_FSF_XIANGQI_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'fairy-stockfish-xiangqi'),
    '/app/bin/fairy-stockfish-xiangqi',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return fairyStockfishPath();
}

/**
 * Resolve the NNUE net as an absolute path: explicit env override, else
 * XIANGQI_FSF_NNUE_NET beside the binary (prod bakes it there; dev keeps a copy
 * beside the master build). Throws rather than letting the engine run classical
 * under a label that promises the net.
 */
export function xiangqiFsfNetPath(binPath: string): string {
  const explicit = process.env.MISTBOARD_FSF_XIANGQI_NET;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_FSF_XIANGQI_NET points at ${resolved} but the file does not exist`,
      );
    }
    return resolved;
  }
  const beside = resolve(dirname(binPath), XIANGQI_FSF_NNUE_NET);
  if (existsSync(beside)) return beside;
  throw new Error(
    `Fairy-Stockfish xiangqi net ${XIANGQI_FSF_NNUE_NET} not found beside ${binPath}. Set MISTBOARD_FSF_XIANGQI_NET.`,
  );
}

/**
 * Ask Fairy-Stockfish for a move. Returns the whole search summary (best move,
 * depth, nodes, time, score, pv) with the moves translated back to canonical
 * Pikafish a0-i9 coordinates; `best` is null when the engine reports no move.
 */
export async function xiangqiFsfLiveEngineMove(
  engineId: string,
  moves: string[],
  opts: { movetimeMs?: number } = {},
): Promise<UciEval> {
  const tier = xiangqiFsfEngineTierFor(engineId);
  if (!tier) throw new Error(`unknown Fairy-Stockfish Xiangqi engine: ${engineId}`);
  const release = await fsfPool.acquire();
  try {
    const bin = xiangqiFsfPath();
    const movetimeMs = opts.movetimeMs ?? tier.movetimeMs;
    const { init, position, go } = splitFairyStockfishCommands({
      moves: moves.map(pikafishUciToFsfXiangqiUci),
      variant: 'xiangqi',
      skill: tier.skill,
      depth: tier.depth,
      nodes: tier.nodes,
      hashMb: tier.hashMb,
      eval: tier.nnue ? { evalFile: xiangqiFsfNetPath(bin) } : 'classical',
      movetimeMs,
    });
    // Warm session per tier: the prod build of this binary takes ~4.3 s to start
    // (measured in the container 2026-09-02), which a spawn-per-move loop charged
    // to the bot's clock on every ply. `init` is the cache key, so tiers never
    // share a process (different Skill Level, Hash, net).
    const evaluation = await warmSessions.withSession(
      { bin, initCommands: init, name: `xiangqi-fsf:${tier.id}` },
      (session) =>
        session.evalPosition({
          positionCommand: position,
          goCommand: go,
          timeoutMs: movetimeMs + 4000,
          timeoutMessage: 'fsf move timed out',
        }),
    );
    return {
      ...evaluation,
      best: evaluation.best === null ? null : fsfXiangqiUciToPikafishUci(evaluation.best),
      pv: evaluation.pv === undefined ? undefined : fsfPvToPikafishUci(evaluation.pv),
    };
  } finally {
    release();
  }
}

// Translate a pv move-by-move, stopping at the first token that is not a plain
// board move (FSF can append e.g. a null move); a partial pv beats a thrown one
// in a telemetry field.
function fsfPvToPikafishUci(pv: readonly string[]): string[] {
  const out: string[] = [];
  for (const move of pv) {
    try {
      out.push(fsfXiangqiUciToPikafishUci(move));
    } catch {
      break;
    }
  }
  return out;
}

/** Convert canonical server/Pikafish a0-i9 UCI into FSF's a1-i10 ranks. */
export function pikafishUciToFsfXiangqiUci(uci: string): string {
  const match = uci.match(/^([a-i])(\d)([a-i])(\d)$/);
  if (!match) throw new Error(`invalid Pikafish Xiangqi UCI: ${uci}`);
  return `${match[1]}${Number(match[2]) + 1}${match[3]}${Number(match[4]) + 1}`;
}

/** Convert FSF a1-i10 UCI back to canonical server/Pikafish a0-i9 UCI. */
export function fsfXiangqiUciToPikafishUci(uci: string): string {
  const match = uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!match) throw new Error(`invalid Fairy-Stockfish Xiangqi UCI: ${uci}`);
  return `${match[1]}${Number(match[2]) - 1}${match[3]}${Number(match[4]) - 1}`;
}
