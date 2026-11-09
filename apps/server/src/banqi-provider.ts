import { isAbsolute } from 'node:path';
import {
  BANQI_PROVIDER_MAX_BUDGET_MS,
  BANQI_PROVIDER_MAX_BYTES,
  type BanqiProviderAnalysis,
  BanqiProviderError,
  type BanqiProviderRequest,
  type BanqiProviderResponse,
  parseBanqiProviderResponse,
  providerResponse,
  snapshotBanqiProviderRequest,
} from './banqi-provider-protocol.js';
import { runUciEval, UciEnginePool } from './uci-engine-harness.js';

export type BanqiTurnProvider = {
  turn(request: BanqiProviderRequest, signal?: AbortSignal): Promise<BanqiProviderResponse>;
};

/** One deadline covers admission, subprocess startup or HTTP, body and parsing. */
function boundedProvider(
  run: (request: BanqiProviderRequest, signal: AbortSignal) => Promise<unknown>,
  concurrency = 1,
): BanqiTurnProvider {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new BanqiProviderError('invalid-request');
  const pool = new UciEnginePool({
    name: 'banqi-provider',
    maxProcessesEnvVar: 'MISTBOARD_BANQI_PROVIDER_MAX_CONCURRENT',
    queueTimeoutEnvVar: 'MISTBOARD_BANQI_PROVIDER_QUEUE_MS',
    defaultMaxProcesses: concurrency,
    maxProcessesLimit: 8,
    defaultQueueTimeoutMs: 30_000,
    queueTimeoutMessage: 'Banqi provider busy',
  });
  return {
    async turn(input, signal) {
      // A snapshot prevents caller mutation while this turn is queued.
      let request: BanqiProviderRequest;
      try {
        request = snapshotBanqiProviderRequest(input);
      } catch (error) {
        if (error instanceof BanqiProviderError) throw error;
        throw new BanqiProviderError('invalid-request');
      }
      const remaining = request.limits.deadlineUnixMs - Date.now();
      if (remaining <= 0) throw new BanqiProviderError('deadline');
      if (remaining > BANQI_PROVIDER_MAX_BUDGET_MS) throw new BanqiProviderError('invalid-request');
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, remaining);
      timer.unref();
      let release: (() => void) | undefined;
      try {
        release = await pool.acquire(controller.signal);
        if (controller.signal.aborted) throw new BanqiProviderError('cancelled');
        const value = await run(request, controller.signal);
        if (Date.now() >= request.limits.deadlineUnixMs) throw new BanqiProviderError('deadline');
        if (controller.signal.aborted) throw new BanqiProviderError('cancelled');
        const result = parseBanqiProviderResponse(value, request);
        if (Date.now() >= request.limits.deadlineUnixMs) throw new BanqiProviderError('deadline');
        return result;
      } catch (error) {
        if (expired || Date.now() >= request.limits.deadlineUnixMs)
          throw new BanqiProviderError('deadline');
        if (signal?.aborted) throw new BanqiProviderError('cancelled');
        if (error instanceof BanqiProviderError) throw error;
        throw new BanqiProviderError('transport');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        release?.();
      }
    },
  };
}

/** The executable speaks the documented five-field Banqi UCI dialect. Its
 * source and weights are outside this interface; no shell or argument string. */
export function createBanqiUciProvider(config: {
  bin: string;
  /** Operator-local path, never serialized into a turn or HTTP header. */
  evalFile?: string;
  concurrency?: number;
}): BanqiTurnProvider {
  if (
    !isAbsolute(config.bin) ||
    /[\r\n\0]/.test(config.bin) ||
    (config.evalFile !== undefined &&
      (!isAbsolute(config.evalFile) || /[\r\n\0]/.test(config.evalFile)))
  )
    throw new BanqiProviderError('invalid-request');
  return boundedProvider(async (request, signal) => {
    const remaining = request.limits.deadlineUnixMs - Date.now();
    if (remaining <= 0) throw new BanqiProviderError('deadline');
    const window = request.repetition;
    // This UCI dialect replays moves; it cannot consume the protocol's public
    // repetition-count map directly. Never silently resume it from FEN alone.
    const quietPlies = Number(request.position.fen.split(' ')[3]);
    if (Number(window.fen.split(' ')[3]) !== 0 || window.moves.length !== quietPlies) {
      throw new BanqiProviderError('invalid-request');
    }
    const result = await runUciEval({
      bin: config.bin,
      commands: [
        'uci',
        ...(config.evalFile ? [`setoption name EvalFile value ${config.evalFile}`] : []),
        `setoption name NoProgressLimit value ${request.rules.noProgressPlies}`,
        'isready',
        'ucinewgame',
        `position fen ${window.fen}${window.moves.length ? ` moves ${window.moves.join(' ')}` : ''}`,
        `go${request.limits.nodes ? ` nodes ${request.limits.nodes}` : ''} movetime ${Math.max(1, remaining - 20)} searchmoves ${request.legalMoves.join(' ')}`,
      ],
      timeoutMs: remaining,
      deadlineUnixMs: request.limits.deadlineUnixMs,
      timeoutMessage: 'Banqi provider deadline',
      signal,
      maxOutputBytes: BANQI_PROVIDER_MAX_BYTES,
      // Executables receive no web service credentials or unrelated configuration.
      inheritEnv: false,
      env: { PATH: '/usr/bin:/bin' },
    });
    if (!result.best) throw new BanqiProviderError('illegal-move');
    let analysis: BanqiProviderAnalysis | undefined;
    if (result.cp !== null || result.mate !== null) {
      analysis = {
        score:
          result.mate !== null
            ? { type: 'mate', value: result.mate, pov: 'side-to-move' }
            : { type: 'cp', value: result.cp!, pov: 'side-to-move' },
        depth: result.depth,
        ...(result.nodes !== undefined ? { nodes: result.nodes } : {}),
        ...(result.pv?.length ? { pv: result.pv } : {}),
      };
    }
    return providerResponse(request, result.best, analysis);
  }, config.concurrency);
}

export function checkedBanqiProviderEndpoint(endpoint: string, allowLocalhostHttp = false): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BanqiProviderError('invalid-request');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(allowLocalhostHttp && loopback && url.protocol === 'http:'))
  ) {
    throw new BanqiProviderError('invalid-request');
  }
  return url;
}

export async function readBanqiProviderBody(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (length > BANQI_PROVIDER_MAX_BYTES) throw new BanqiProviderError('oversized');
  if (!response.body) throw new BanqiProviderError('invalid-response');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BANQI_PROVIDER_MAX_BYTES) throw new BanqiProviderError('oversized');
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BanqiProviderError('invalid-response');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Trusted operator configuration only. This is not a browser-supplied URL. */
export function createBanqiHttpProvider(config: {
  endpoint: string;
  token: string;
  allowLocalhostHttp?: boolean;
  concurrency?: number;
}): BanqiTurnProvider {
  const endpoint = checkedBanqiProviderEndpoint(config.endpoint, config.allowLocalhostHttp);
  if (!config.token || /[\r\n]/.test(config.token)) throw new BanqiProviderError('invalid-request');
  return boundedProvider(async (request, signal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
      await response.body?.cancel().catch(() => {});
      throw new BanqiProviderError('transport');
    }
    return readBanqiProviderBody(response);
  }, config.concurrency);
}
