/** Historical identities and cache keys for retired Atomic Xiangqi games.
 * Keep this module pure: replay, exports and browser review need no native engine.
 */
export const ATOMIC_XIANGQI_DEFAULT_ENGINE_ID = 'fairy-stockfish-atomic-xiangqi-level-4';
export const ATOMIC_XIANGQI_FSF_ENGINE_VERSION = '0.1.0';
export const ATOMIC_XIANGQI_ANALYSIS_DEPTH = 12;
export const ATOMIC_XIANGQI_ANALYSIS_ENGINE_ID = `fairy-stockfish-atomic-xiangqi-analysis@${ATOMIC_XIANGQI_FSF_ENGINE_VERSION}`;

export function isAtomicXiangqiEngineClientId(clientId: string | undefined): boolean {
  return (
    typeof clientId === 'string' && /^fairy-stockfish-atomic-xiangqi-level-[1-8]$/.test(clientId)
  );
}

export function atomicXiangqiEngineDisplayName(engineId: string): string {
  return isAtomicXiangqiEngineClientId(engineId)
    ? `Fairy-Stockfish Level ${engineId.at(-1)}`
    : engineId;
}

export function atomicXiangqiEngineVersion(clientId: string | undefined): string | null {
  return isAtomicXiangqiEngineClientId(clientId) ? ATOMIC_XIANGQI_FSF_ENGINE_VERSION : null;
}
