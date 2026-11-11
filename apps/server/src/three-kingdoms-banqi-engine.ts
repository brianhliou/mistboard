// The Three Kingdoms Banqi (三國暗棋, #628) bot for public casual play.
//
// The engine is the Rust `three-kingdoms-banqi-engine` binary from the private
// engine repo (three_kingdoms_banqi_rust), driven as a UCI subprocess, one
// process per move, the same pattern as MistyBanqi (banqi-engine.ts). Prod gets
// the release asset `three-kingdoms-engine`, fetched and sha-checked into
// /app/bin by railpack.json (scripts/fetch-release-asset.sh). Locally,
// MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH names a build; with neither, the
// search tiers are unavailable. L1 is a process-free random legal mover.
//
// The engine is handed the REDACTED position only: the public FEN, the covered
// pool computed from public counts, and the quiet moves since the last flip or
// capture (threeKingdomsBanqiStateToEngineFen). It never sees a face-down identity.

import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EngineId } from './engines/types.js';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

export const THREE_KINGDOMS_BANQI_ENGINE_ID = 'misty-three-kingdoms-banqi';
export const THREE_KINGDOMS_BANQI_ENGINE_NAME = 'MistyThreeKingdomsBanqi';
export const THREE_KINGDOMS_BANQI_ENGINE_VERSION = '0.3.0';
export const THREE_KINGDOMS_BANQI_HISTORICAL_ENGINE_VERSION = '0.2.0';

// The engine's full level (Brian, 2026-10-28): about 1.6s a move on a laptop,
// against 0.14s at 200k. The movetime cap below still bounds a slow move.
export const THREE_KINGDOMS_BANQI_ENGINE_NODES = 2_000_000;
export const THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS = 3_000;

export const THREE_KINGDOMS_BANQI_RANDOM_ENGINE_ID = 'misty-three-kingdoms-banqi-level-1';

export type ThreeKingdomsBanqiEngineTier = {
  id: EngineId;
  level?: number;
  nodes: number;
  movetimeCapMs: number;
  evaluation: 'random' | 'classical' | 'nnue';
  /** Absent for L1 and the historical Star1 tier. */
  chance?: 'mix';
  noise?: number;
  noiseDepth?: number;
};

// Calibrated on 120-300 games per step: L2 beat L1 120-0; measured step Elo:
// L3 over L2 +458, L4 over L3 +191, L5 over L4 +260, L6 over L5 +183,
// L7 over L6 +176, L8 over L7 +237. L1 stays process-free.
export const THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES: readonly ThreeKingdomsBanqiEngineTier[] = (
  [
    { level: 1, evaluation: 'random', nodes: 0 },
    { level: 2, evaluation: 'classical', nodes: 2_000, noise: 0.05, noiseDepth: 2 },
    { level: 3, evaluation: 'classical', nodes: 2_000, noise: 0.03, noiseDepth: 2 },
    { level: 4, evaluation: 'classical', nodes: 2_000, noise: 0.02, noiseDepth: 2 },
    { level: 5, evaluation: 'classical', nodes: 2_000 },
    { level: 6, evaluation: 'classical', nodes: 8_000 },
    { level: 7, evaluation: 'classical', nodes: 2_048_000 },
    { level: 8, evaluation: 'nnue', nodes: 2_048_000 },
  ] as const
).map(
  (tier): ThreeKingdomsBanqiEngineTier => ({
    ...tier,
    id: `misty-three-kingdoms-banqi-level-${tier.level}`,
    movetimeCapMs: THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
    ...(tier.level === 1 ? {} : { chance: 'mix' }),
  }),
);

// Historical rooms retain their ID, version and 2M-node classical search.
export const THREE_KINGDOMS_BANQI_ALL_ENGINE_TIERS: readonly ThreeKingdomsBanqiEngineTier[] = [
  ...THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES,
  {
    id: THREE_KINGDOMS_BANQI_ENGINE_ID,
    nodes: THREE_KINGDOMS_BANQI_ENGINE_NODES,
    movetimeCapMs: THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS,
    evaluation: 'classical',
  },
];

const TIERS = new Map<string, ThreeKingdomsBanqiEngineTier>(
  THREE_KINGDOMS_BANQI_ALL_ENGINE_TIERS.map((tier) => [tier.id, tier]),
);

export function threeKingdomsBanqiEngineTierFor(
  clientId: string | undefined,
): ThreeKingdomsBanqiEngineTier | null {
  return clientId ? (TIERS.get(clientId) ?? null) : null;
}

const enginePool = new UciEnginePool({
  name: 'three-kingdoms-banqi',
  maxProcessesEnvVar: 'MISTBOARD_THREE_KINGDOMS_BANQI_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_THREE_KINGDOMS_BANQI_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  queueTimeoutMessage: 'three-kingdoms-banqi-engine concurrency queue timed out',
});

export const THREE_KINGDOMS_BANQI_ENGINE_BINARY = 'three-kingdoms-engine';

/**
 * The binary: the env var when set (a set path that does not exist means no
 * bot, never a silent fallback), else the release asset railpack fetched into
 * bin/ (cwd first, then /app/bin, where the prod image puts it), else null.
 */
export function threeKingdomsBanqiEnginePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  const explicit = env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    return existsSync(resolved) ? resolved : null;
  }
  for (const candidate of [
    resolve(cwd, 'bin', THREE_KINGDOMS_BANQI_ENGINE_BINARY),
    `/app/bin/${THREE_KINGDOMS_BANQI_ENGINE_BINARY}`,
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readableNetPath(path: string | undefined): string | null {
  if (!path) return null;
  const resolved = resolve(path);
  try {
    accessSync(resolved, constants.R_OK);
    const stat = statSync(resolved);
    return stat.isFile() && stat.size > 0 ? resolved : null;
  } catch {
    return null;
  }
}

/** No implicit net: L8 is held until an operator supplies its EvalFile. */
export function threeKingdomsBanqiNetPath(): string | null {
  return readableNetPath(process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET);
}

export function threeKingdomsBanqiEngineAvailable(
  clientId: string = THREE_KINGDOMS_BANQI_ENGINE_ID,
): boolean {
  const tier = threeKingdomsBanqiEngineTierFor(clientId);
  if (!tier) return false;
  if (tier.evaluation === 'random') return true;
  return (
    threeKingdomsBanqiEnginePath() !== null &&
    (tier.evaluation !== 'nnue' || threeKingdomsBanqiNetPath() !== null)
  );
}

export function isThreeKingdomsBanqiEngineClientId(clientId: string | undefined): boolean {
  return threeKingdomsBanqiEngineTierFor(clientId) !== null;
}

export function threeKingdomsBanqiEngineDisplayName(clientId: string): string {
  const tier = threeKingdomsBanqiEngineTierFor(clientId);
  if (!tier) return clientId;
  return tier.level === undefined ? 'Misty' : `Misty level ${tier.level}`;
}

export function threeKingdomsBanqiEngineVersion(clientId: string | undefined): string | null {
  if (clientId === THREE_KINGDOMS_BANQI_ENGINE_ID) {
    return THREE_KINGDOMS_BANQI_HISTORICAL_ENGINE_VERSION;
  }
  return isThreeKingdomsBanqiEngineClientId(clientId) ? THREE_KINGDOMS_BANQI_ENGINE_VERSION : null;
}

/** Stable per-game root-noise seed, matching Flip Jungle's nonzero FNV-1a 64-bit shape. */
export function threeKingdomsBanqiNoiseSeed(roomId: string): string {
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < roomId.length; i++) {
    hash = ((hash ^ BigInt(roomId.charCodeAt(i))) * prime) & mask;
  }
  return (hash === 0n ? 1n : hash).toString();
}

export type ThreeKingdomsBanqiEngineRequest = {
  /** threeKingdomsBanqiStateToEngineFen of the state after the last flip or capture. */
  fen: string;
  /** The quiet moves since then, `<from><to>`; never a flip. */
  moves: readonly string[];
  /** Restricts the root when the 長捉 rule forbids some moves. */
  searchMoves?: readonly string[];
  nodes: number;
  movetimeCapMs: number;
  /** Present only for L8; classical searches never send an EvalFile option. */
  evalFile?: string;
  /** L2–L8 require advertised ChanceMix support; historical requests omit it. */
  chance?: 'mix';
  /** L2-L4 only; all three UCI options must be advertised by the binary. */
  noise?: number;
  noiseDepth?: number;
  seed?: string;
};

/** The whole stdin block the engine receives; tests serialize it to prove it is redacted. */
export function buildThreeKingdomsBanqiEngineCommands(
  request: ThreeKingdomsBanqiEngineRequest,
): string[] {
  const position =
    request.moves.length > 0
      ? `position fen ${request.fen} moves ${request.moves.join(' ')}`
      : `position fen ${request.fen}`;
  const go = `go nodes ${request.nodes} movetime ${request.movetimeCapMs}`;
  return [
    'uci',
    ...(request.evalFile === undefined
      ? []
      : [`setoption name EvalFile value ${request.evalFile}`]),
    ...(request.chance === 'mix' ? ['setoption name ChanceMix value true'] : []),
    ...(request.noise === undefined
      ? []
      : [
          `setoption name Noise value ${request.noise}`,
          `setoption name NoiseDepth value ${request.noiseDepth}`,
          `setoption name Seed value ${request.seed}`,
        ]),
    'ucinewgame',
    'isready',
    position,
    request.searchMoves && request.searchMoves.length > 0
      ? `${go} searchmoves ${request.searchMoves.join(' ')}`
      : go,
  ];
}

export type ThreeKingdomsBanqiEngineProvider = (
  request: ThreeKingdomsBanqiEngineRequest,
) => Promise<UciEval>;

export const threeKingdomsBanqiLiveEngineMove: ThreeKingdomsBanqiEngineProvider = async (
  request,
) => {
  const bin = threeKingdomsBanqiEnginePath();
  if (!bin) {
    throw new Error(
      'three-kingdoms-engine not found (MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH unset or missing, no bin/three-kingdoms-engine)',
    );
  }
  const release = await enginePool.acquire();
  try {
    // Recheck after queueing too: a net may disappear after room admission.
    if (request.evalFile !== undefined && !readableNetPath(request.evalFile)) {
      throw new Error('Three Kingdoms banqi net is not available');
    }
    return await runUciEval({
      bin,
      commands: buildThreeKingdomsBanqiEngineCommands(request),
      timeoutMs: request.movetimeCapMs + 4_000,
      timeoutMessage: 'three-kingdoms-banqi-engine move timed out',
    });
  } finally {
    release();
  }
};
