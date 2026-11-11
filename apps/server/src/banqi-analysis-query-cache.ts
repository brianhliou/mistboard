// Analysis-only exact public UCI-query reuse. No room/player/deal enters a key.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import type { UciEval } from './uci-engine-harness.js';

export type AnalysisAsset = { path: string; sha256: string; stamp: string };
const assetDigests = new Map<string, AnalysisAsset>();
export async function analysisAsset(
  path: string,
  executable = false,
  signal?: AbortSignal,
): Promise<AnalysisAsset> {
  try {
    await access(path, executable ? constants.R_OK | constants.X_OK : constants.R_OK);
    const info = await stat(path, { bigint: true });
    if (!info.isFile() || info.size <= 0n || info.size > 128n * 1024n * 1024n) throw new Error();
    const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    const previous = assetDigests.get(path);
    if (previous?.stamp === stamp) return { ...previous };
    const body = await readFile(path, { signal });
    const after = await stat(path, { bigint: true });
    if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` !== stamp)
      throw new Error();
    const asset = { path, stamp, sha256: createHash('sha256').update(body).digest('hex') };
    assetDigests.delete(path);
    assetDigests.set(path, asset);
    while (assetDigests.size > 8) assetDigests.delete(assetDigests.keys().next().value!);
    return { ...asset };
  } catch {
    throw new Error('Banqi analysis assets unavailable');
  }
}

export type BanqiAnalysisQuery = {
  binary: AnalysisAsset;
  model: AnalysisAsset;
  initCommands: readonly string[];
  positionCommand: string;
  goCommand: string;
  nodes: number;
  movetimeCapMs: number;
};
export function banqiAnalysisQueryKey(query: BanqiAnalysisQuery): string {
  return JSON.stringify({
    semantics: 'misty-banqi-uci-v0.3.0-side-to-move-cp-v1',
    binary: query.binary.sha256,
    model: query.model.sha256,
    init: query.initCommands,
    position: query.positionCommand,
    go: query.goCommand,
    nodes: query.nodes,
    movetimeCapMs: query.movetimeCapMs,
  });
}
export function completeBanqiAnalysis(
  result: UciEval,
  query: Pick<BanqiAnalysisQuery, 'nodes' | 'movetimeCapMs'> &
    Partial<Pick<BanqiAnalysisQuery, 'goCommand'>>,
): boolean {
  const scored =
    (result.cp !== null && Number.isFinite(result.cp)) ||
    (result.mate !== null && Number.isFinite(result.mate));
  const roots = query.goCommand?.match(/\bsearchmoves\s+(.+)$/)?.[1]?.split(/\s+/);
  return (
    scored &&
    typeof result.best === 'string' &&
    result.best.length > 0 &&
    (!roots || roots.includes(result.best)) &&
    result.lines?.[0]?.bound === null &&
    Number.isFinite(result.nodes) &&
    result.nodes! >= query.nodes &&
    Number.isFinite(result.timeMs) &&
    result.timeMs! < query.movetimeCapMs
  );
}

export class BanqiAnalysisQueryCache {
  private readonly results = new Map<string, { value: UciEval; bytes: number; expires: number }>();
  private readonly pending = new Map<string, Promise<UciEval>>();
  private bytes = 0;
  private generation = 0;
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private evicted = 0;
  constructor(
    private readonly limits = {
      entries: 8192,
      bytes: 16 * 1024 * 1024,
      inflight: 32,
      ttlMs: 6 * 60 * 60_000,
    },
  ) {}
  async evaluate(query: BanqiAnalysisQuery, run: () => Promise<UciEval>): Promise<UciEval> {
    const key = banqiAnalysisQueryKey(query);
    const keyBytes = Buffer.byteLength(key);
    if (keyBytes > 64 * 1024) throw new Error('Banqi analysis query too large');
    const hit = this.results.get(key);
    if (hit && hit.expires > Date.now()) {
      this.hits++;
      this.results.delete(key);
      this.results.set(key, hit);
      return structuredClone(hit.value);
    }
    if (hit) this.drop(key);
    const inflight = this.pending.get(key);
    if (inflight) {
      this.coalesced++;
      return structuredClone(await inflight);
    }
    if (this.pending.size >= this.limits.inflight)
      throw new Error('Banqi analysis query capacity exceeded');
    this.misses++;
    const generation = this.generation;
    const computation = Promise.resolve()
      .then(run)
      .then((value) => {
        const snapshot = structuredClone(value);
        const bytes = keyBytes + Buffer.byteLength(JSON.stringify(snapshot));
        if (
          generation === this.generation &&
          completeBanqiAnalysis(snapshot, query) &&
          bytes <= this.limits.bytes &&
          this.limits.entries > 0
        ) {
          while (this.results.size >= this.limits.entries || this.bytes + bytes > this.limits.bytes)
            this.drop(this.results.keys().next().value!);
          this.results.set(key, {
            value: snapshot,
            bytes,
            expires: Date.now() + this.limits.ttlMs,
          });
          this.bytes += bytes;
        }
        return snapshot;
      });
    this.pending.set(key, computation);
    try {
      return structuredClone(await computation);
    } finally {
      if (this.pending.get(key) === computation) this.pending.delete(key);
    }
  }
  private drop(key: string): void {
    const entry = this.results.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.results.delete(key);
    this.evicted++;
  }
  clear(): void {
    this.generation++;
    this.results.clear();
    this.bytes = 0;
  }
  stats() {
    return {
      entries: this.results.size,
      bytes: this.bytes,
      inflight: this.pending.size,
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      evicted: this.evicted,
    };
  }
}
