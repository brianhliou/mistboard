// Hidden admin FFQ playtest (#809). No release asset is installed yet.
import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  EngineTurnRequest,
  EngineTurnResponse,
  FFQBanqiMove,
  FFQBanqiPlayerView,
} from '@mistboard/game';
import type { EngineId } from './engines/types.js';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

export const FFQ_BANQI_ENGINE_ID = 'misty-ffq-banqi';
export const FFQ_BANQI_ENGINE_NAME = 'MistyFFQ';
// Engine source: github.com/brianhliou/misty-ffq-banqi v0.1.0 (scripts/fetch-release-asset.sh).
export const FFQ_BANQI_ENGINE_VERSION = '0.1.0';
export const FFQ_BANQI_ENGINE_BINARY = 'ffq-banqi-engine';
export const FFQ_BANQI_ENGINE_MOVETIME_CAP_MS = 3_000;
export const FFQ_BANQI_RANDOM_ENGINE_ID = 'misty-ffq-banqi-level-1';
export type FFQBanqiEngineTier = {
  id: EngineId;
  level: number;
  nodes: number;
  movetimeCapMs: number;
  evaluation: 'random' | 'classical';
};
// Provisional, as TK's first ladder was: calibrate with paired EvE runs later.
// These are the engine README's exposed defaults, not measured rating claims.
export const FFQ_BANQI_PLAYABLE_ENGINES: readonly FFQBanqiEngineTier[] = [
  0, 128, 512, 2_000, 5_000, 10_000, 25_000, 50_000,
].map((nodes, i) => ({
  id: `misty-ffq-banqi-level-${i + 1}` as EngineId,
  level: i + 1,
  nodes,
  movetimeCapMs: FFQ_BANQI_ENGINE_MOVETIME_CAP_MS,
  evaluation: i === 0 ? 'random' : 'classical',
}));
export function ffqBanqiEngineTierFor(id: string | undefined): FFQBanqiEngineTier | null {
  return FFQ_BANQI_PLAYABLE_ENGINES.find((tier) => tier.id === id) ?? null;
}
export const isFFQBanqiEngineClientId = (id: string | undefined): boolean =>
  ffqBanqiEngineTierFor(id) !== null;
export const ffqBanqiEngineDisplayName = (id: string): string => {
  const tier = ffqBanqiEngineTierFor(id);
  return tier ? `Misty level ${tier.level}` : id;
};
export const ffqBanqiEngineVersion = (id: string | undefined): string | null =>
  isFFQBanqiEngineClientId(id) ? FFQ_BANQI_ENGINE_VERSION : null;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
export function ffqBanqiEnginePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string | null {
  const explicit = env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
  const candidates = explicit
    ? [resolve(explicit)]
    : [resolve(cwd, 'bin', FFQ_BANQI_ENGINE_BINARY), `/app/bin/${FFQ_BANQI_ENGINE_BINARY}`];
  return candidates.find(executable) ?? null;
}
export function ffqBanqiEngineAvailable(id = 'misty-ffq-banqi-level-8'): boolean {
  const tier = ffqBanqiEngineTierFor(id);
  return tier !== null && (tier.evaluation === 'random' || ffqBanqiEnginePath() !== null);
}
// The protocol retains FFQ's integer coordinates. Both view and FEN contain
// only the bot seat's public facts; no event log, setup, seed or deal crosses it.
export type FFQBanqiEngineRequest = EngineTurnRequest<FFQBanqiMove> & {
  gameSpecId: 'ffq-banqi';
  position: { view: FFQBanqiPlayerView; fen: string };
  nodes: number;
  movetimeCapMs: number;
};
export type FFQBanqiEngineResponse = EngineTurnResponse<FFQBanqiMove> & {
  /** UCI score, from the side to move's POV; absent for scoreless providers. */
  cp?: number | null;
  mate?: number | null;
  /** The whole search report (depth, nodes, PV) for the engine-decision artifact. */
  search?: UciEval;
};
export type FFQBanqiEngineProvider = (
  request: FFQBanqiEngineRequest,
) => Promise<FFQBanqiEngineResponse>;
export const ffqBanqiMoveToUci = (move: FFQBanqiMove): string => {
  const square = (n: number) => `${String.fromCharCode(97 + (n % 4))}${Math.floor(n / 4)}`;
  return `${square(move.from)}${square(move.to)}`;
};
export function uciToFFQBanqiMove(uci: string): FFQBanqiMove | null {
  if (!/^[a-d][0-7][a-d][0-7]$/.test(uci)) return null;
  const square = (s: string) => Number(s[1]) * 4 + s.charCodeAt(0) - 97;
  return { from: square(uci.slice(0, 2)), to: square(uci.slice(2)) };
}
export function buildFFQBanqiEngineCommands(request: FFQBanqiEngineRequest): string[] {
  return [
    'uci',
    'ucinewgame',
    'isready',
    `position fen ${request.position.fen}`,
    `go nodes ${request.nodes} movetime ${request.movetimeCapMs}`,
  ];
}
const pool = new UciEnginePool({
  name: 'ffq-banqi',
  maxProcessesEnvVar: 'MISTBOARD_FFQ_BANQI_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_FFQ_BANQI_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  queueTimeoutMessage: 'FFQ banqi engine concurrency queue timed out',
});
export const ffqBanqiLiveEngineMove: FFQBanqiEngineProvider = async (request) => {
  const bin = ffqBanqiEnginePath();
  if (!bin)
    throw new Error(
      'FFQ banqi engine unavailable: set MISTBOARD_FFQ_BANQI_ENGINE_PATH to an executable ffq-banqi-engine',
    );
  const release = await pool.acquire();
  try {
    const result = await runUciEval({
      bin,
      commands: buildFFQBanqiEngineCommands(request),
      timeoutMs: request.movetimeCapMs + 4_000,
      timeoutMessage: 'FFQ banqi engine move timed out',
    });
    const move = result.best ? uciToFFQBanqiMove(result.best) : null;
    if (
      !move ||
      !request.legalMoves.some((legal) => legal.from === move.from && legal.to === move.to)
    )
      throw new Error('FFQ banqi engine returned no legal move');
    return {
      protocolVersion: request.protocolVersion,
      gameId: request.gameId,
      sessionId: request.sessionId,
      move,
      cp: result.cp,
      mate: result.mate,
      search: result,
    };
  } finally {
    release();
  }
};
