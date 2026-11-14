// Decided 2026-11-13: review and luck share exact public-FEN level-7 searches.
import { FFQ_BANQI_ENGINE_VERSION, ffqBanqiEnginePath } from './ffq-banqi-engine.js';
import type { SweepPlyEval } from './game-analysis-sweep.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import { runUciEval, UciEnginePool } from './uci-engine-harness.js';

export type FFQPublicEval = Omit<SweepPlyEval, 'ply'>;
export type FFQPublicSearch = (fen: string) => Promise<FFQPublicEval>;
const pool = new UciEnginePool({
  name: 'ffq-banqi-analysis',
  maxProcessesEnvVar: 'MISTBOARD_FFQ_BANQI_ANALYSIS_PROCESSES',
  maxProcessesLimit: 2,
  queueTimeoutEnvVar: 'MISTBOARD_FFQ_BANQI_QUEUE_TIMEOUT_MS',
  defaultMaxProcesses: 2,
  queueTimeoutMessage: 'FFQ analysis queue timed out',
});

export function cachedFFQPublicSearch(search: FFQPublicSearch, limit = 8192): FFQPublicSearch {
  const cache = new Map<string, Promise<FFQPublicEval>>();
  return async (fen) => {
    let result = cache.get(fen);
    if (!result) {
      result = search(fen).catch((error: unknown) => {
        cache.delete(fen);
        throw error;
      });
      cache.set(fen, result);
      if (cache.size > limit) cache.delete(cache.keys().next().value!);
    }
    return { ...(await result) };
  };
}

const search = cachedFFQPublicSearch(async (key) => {
  const [bin, _version, fen] = JSON.parse(key) as [string, string, string];
  const release = await pool.acquire();
  try {
    const result = await runUciEval({
      bin,
      commands: [
        'uci',
        'ucinewgame',
        'isready',
        `position fen ${fen}`,
        'go nodes 25000 movetime 3000',
      ],
      timeoutMs: 7000,
      timeoutMessage: 'FFQ analysis timed out',
    });
    if (result.cp === null && result.mate === null) throw new VacuousAnalysisError('ffq-banqi');
    return { cp: result.cp, mate: result.mate, best: result.best };
  } finally {
    release();
  }
});

export const searchFFQPublicFen: FFQPublicSearch = async (fen) => {
  const bin = ffqBanqiEnginePath();
  if (!bin) throw new Error('FFQ analysis engine unavailable');
  return search(JSON.stringify([bin, FFQ_BANQI_ENGINE_VERSION, fen]));
};
