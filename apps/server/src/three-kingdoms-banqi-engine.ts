// The Three Kingdoms banqi (三國暗棋, #628) bot for the LOCAL playtest.
//
// The engine is the Rust `three-kingdoms-banqi-engine` binary from the private
// engine repo (three_kingdoms_banqi_rust), driven as a UCI subprocess, one
// process per move, the same pattern as MistyBanqi (banqi-engine.ts). Nothing
// here ships: the binary comes only from MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH,
// and with it unset the bot does not exist (the create route refuses a PvE room
// and the web client hides the option).
//
// The engine is handed the REDACTED position only: the public FEN, the covered
// pool computed from public counts, and the quiet moves since the last flip or
// capture (threeKingdomsBanqiStateToEngineFen). It never sees a face-down identity.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runUciEval, UciEnginePool, type UciEval } from './uci-engine-harness.js';

export const THREE_KINGDOMS_BANQI_ENGINE_ID = 'misty-three-kingdoms-banqi';
export const THREE_KINGDOMS_BANQI_ENGINE_NAME = 'MistyThreeKingdomsBanqi';
export const THREE_KINGDOMS_BANQI_ENGINE_VERSION = '0.1.0';

// The engine's full level (Brian, 2026-10-28): about 1.6s a move on a laptop,
// against 0.14s at 200k. The movetime cap below still bounds a slow move.
export const THREE_KINGDOMS_BANQI_ENGINE_NODES = 2_000_000;
export const THREE_KINGDOMS_BANQI_ENGINE_MOVETIME_CAP_MS = 3_000;

const enginePool = new UciEnginePool({
  name: 'three-kingdoms-banqi',
  maxProcessesEnvVar: 'MISTBOARD_THREE_KINGDOMS_BANQI_MAX_PROCESSES',
  queueTimeoutEnvVar: 'MISTBOARD_THREE_KINGDOMS_BANQI_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  queueTimeoutMessage: 'three-kingdoms-banqi-engine concurrency queue timed out',
});

/** The binary from the env var, or null. No default search path: a bot that
 * appears because a file happens to exist is not "off unless set locally". */
export function threeKingdomsBanqiEnginePath(): string | null {
  const explicit = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH;
  if (!explicit) return null;
  const resolved = resolve(explicit);
  return existsSync(resolved) ? resolved : null;
}

export function threeKingdomsBanqiEngineAvailable(): boolean {
  return threeKingdomsBanqiEnginePath() !== null;
}

export function isThreeKingdomsBanqiEngineClientId(clientId: string | undefined): boolean {
  return clientId === THREE_KINGDOMS_BANQI_ENGINE_ID;
}

export function threeKingdomsBanqiEngineDisplayName(clientId: string): string {
  return isThreeKingdomsBanqiEngineClientId(clientId) ? THREE_KINGDOMS_BANQI_ENGINE_NAME : clientId;
}

export function threeKingdomsBanqiEngineVersion(clientId: string | undefined): string | null {
  return isThreeKingdomsBanqiEngineClientId(clientId) ? THREE_KINGDOMS_BANQI_ENGINE_VERSION : null;
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
  if (!bin) throw new Error('MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH is not set');
  const release = await enginePool.acquire();
  try {
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
