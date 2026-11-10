// Shared read/discovery and polling contract. GET can resume existing server work;
// only an explicit POST creates work. The caller owns the polling lifetime.
export type AnalysisJobStatus = {
  status: 'pending';
  state?: 'queued' | 'running';
  progress?: { phase: 'analysis' | 'decisions'; completed: number; total: number };
};
export type AnalysisJobPollOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  errorPrefix?: string;
  signal?: AbortSignal;
  onStatus?(status: AnalysisJobStatus): void;
};
type JobStatusBody =
  | AnalysisJobStatus
  | { status: 'failed'; error?: string }
  | { status: 'done'; result: unknown };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
async function analysisJob<T>(
  url: string,
  method: 'GET' | 'POST',
  opts: AnalysisJobPollOptions,
): Promise<T | null> {
  const prefix = opts.errorPrefix ?? 'analysis_request_failed';
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    opts.timeoutMs ?? 20 * 60 * 1000,
  );
  const signal = controller.signal;
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetch(url, { method, signal });
    if (method === 'GET' && response.status === 204) return null;
    if (response.status === 200) return (await response.json()) as T;
    if (response.status !== 202) throw new Error(`${prefix}_${response.status}`);
    const accepted = (await response.json()) as JobStatusBody & { jobId?: string };
    if (!accepted.jobId) throw new Error(`${prefix}_missing_job`);
    // The server's 202 carries only {jobId}; a job with no status yet is pending.
    let body: JobStatusBody = {
      ...accepted,
      status: accepted.status ?? 'pending',
    } as JobStatusBody;
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (body.status === 'done') return body.result as T;
      if (body.status === 'failed') throw new Error(`${prefix}_${body.error ?? 'analysis_failed'}`);
      if (body.status !== 'pending') throw new Error(`${prefix}_invalid_job`);
      opts.onStatus?.(body);
      await sleep(opts.pollIntervalMs ?? 2000, signal);
      const poll = await fetch(`${url}/jobs/${encodeURIComponent(accepted.jobId)}`, {
        method: 'GET',
        signal,
      });
      if (!poll.ok) throw new Error(`${prefix}_${poll.status}`);
      body = (await poll.json()) as JobStatusBody;
    }
  } catch (error) {
    if (timedOut) throw new Error(`${prefix}_timeout`);
    throw error;
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', abort);
  }
}
/** Read cached results or resume an existing handle; never POST or create work. */
export function fetchAnalysisJob<T>(
  url: string,
  opts: AnalysisJobPollOptions = {},
): Promise<T | null> {
  return analysisJob<T>(url, 'GET', opts);
}
/** Explicit compute request. The server coalesces repeated POSTs across viewers. */
export async function postAnalysisJob<T>(
  url: string,
  opts: AnalysisJobPollOptions = {},
): Promise<T> {
  return (await analysisJob<T>(url, 'POST', opts)) as T;
}
