// Exact-query reuse only for whole-game analysis. Each miss keeps the existing
// cold-process search contract; warm reuse measured too little benefit to land.
import {
  analysisAsset,
  type BanqiAnalysisQuery,
  BanqiAnalysisQueryCache,
} from './banqi-analysis-query-cache.js';
import { runUciEval, type UciEnginePool } from './uci-engine-harness.js';

const cache = new BanqiAnalysisQueryCache();
const active = new Set<AbortController>();
let coldCalls = 0;
let stopped = false;
const NET_UNAVAILABLE = 'Banqi analysis net is not available';
async function analysisModel(path: string, signal: AbortSignal) {
  try {
    return await analysisAsset(path, false, signal);
  } catch {
    throw new Error(NET_UNAVAILABLE);
  }
}
export function openBanqiAnalysisQueries(): void {
  stopped = false;
}
export async function runBanqiAnalysisQuery(args: {
  binaryPath: string;
  modelPath: string;
  initCommands: readonly string[];
  positionCommand: string;
  goCommand: string;
  nodes: number;
  movetimeCapMs: number;
  pool: UciEnginePool;
}) {
  if (stopped) throw new Error('Banqi analysis closed');
  const controller = new AbortController();
  active.add(controller);
  const deadline = Date.now() + args.movetimeCapMs + 4000;
  const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  timeout.unref();
  try {
    const binary = await analysisAsset(args.binaryPath, true, controller.signal);
    const model = await analysisModel(args.modelPath, controller.signal);
    if (controller.signal.aborted) throw new Error();
    const query: BanqiAnalysisQuery = {
      binary,
      model,
      initCommands: [...args.initCommands],
      positionCommand: args.positionCommand,
      goCommand: args.goCommand,
      nodes: args.nodes,
      movetimeCapMs: args.movetimeCapMs,
    };
    const value = await cache.evaluate(query, async () => {
      const release = await args.pool.acquire(controller.signal);
      try {
        if (controller.signal.aborted) throw new Error();
        const admittedBinary = await analysisAsset(binary.path, true, controller.signal);
        const admittedModel = await analysisModel(model.path, controller.signal);
        if (admittedBinary.stamp !== binary.stamp || admittedModel.stamp !== model.stamp)
          throw new Error('Banqi analysis assets changed while queued');
        coldCalls++;
        const value = await runUciEval({
          bin: binary.path,
          commands: [...query.initCommands, query.positionCommand, query.goCommand],
          timeoutMs: Math.max(1, deadline - Date.now()),
          timeoutMessage: 'Banqi analysis timed out',
          signal: controller.signal,
          deadlineUnixMs: deadline,
          rejectOutputLine: (line) => /^info string error EvalFile:/i.test(line),
        });
        if (controller.signal.aborted) throw new Error();
        const afterBinary = await analysisAsset(binary.path, true, controller.signal);
        const afterModel = await analysisModel(model.path, controller.signal);
        if (afterBinary.stamp !== binary.stamp || afterModel.stamp !== model.stamp)
          throw new Error();
        return value;
      } finally {
        release();
      }
    });
    if (controller.signal.aborted) throw new Error();
    return value;
  } catch (error) {
    // Preserve useful fixed diagnostics without returning engine output or paths.
    const missingEvalFile =
      error instanceof Error &&
      error.message.startsWith('UCI engine does not advertise configured option(s): ') &&
      error.message.split(': ')[1]?.split(', ').includes('EvalFile');
    throw new Error(
      controller.signal.aborted
        ? 'Banqi analysis timed out or closed'
        : error instanceof Error && error.message === NET_UNAVAILABLE
          ? NET_UNAVAILABLE
          : missingEvalFile
            ? 'Banqi analysis engine does not advertise EvalFile'
            : 'Banqi analysis query failed',
    );
  } finally {
    clearTimeout(timeout);
    active.delete(controller);
  }
}
export function banqiAnalysisQueryStats() {
  return { cache: cache.stats(), coldCalls };
}
export function closeBanqiAnalysisQueries(): void {
  stopped = true;
  for (const controller of active) controller.abort();
  cache.clear();
}
