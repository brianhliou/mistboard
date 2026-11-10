import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAnalysisJob, postAnalysisJob } from './analysis-job-poll.js';

// The async-queue client contract (#208): 200 = cached result (fast path
// unchanged), 202 = job accepted -> poll /jobs/:id until done/failed.

type FakeResponse = { status: number; ok: boolean; json(): Promise<unknown> };

function response(status: number, body: unknown): FakeResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function stubFetch(script: Array<{ url?: string; method?: string; reply: FakeResponse }>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const call = { url, method: init?.method ?? 'GET' };
      calls.push(call);
      const step = script.shift();
      if (!step) throw new Error(`unexpected fetch: ${call.method} ${url}`);
      if (step.url) expect(url).toBe(step.url);
      if (step.method) expect(call.method).toBe(step.method);
      return step.reply;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postAnalysisJob', () => {
  it('returns the body immediately on 200 (cached fast path, no polling)', async () => {
    const calls = stubFetch([
      { method: 'POST', reply: response(200, { engineId: 'e@1', plies: [1] }) },
    ]);
    const result = await postAnalysisJob<{ engineId: string }>('/api/x/games/r/analysis');
    expect(result.engineId).toBe('e@1');
    expect(calls).toHaveLength(1);
  });

  it('polls the job endpoint on 202 until done and returns the result envelope', async () => {
    const calls = stubFetch([
      { method: 'POST', reply: response(202, { jobId: 'j1', status: 'pending' }) },
      {
        method: 'GET',
        url: '/api/x/games/r/analysis/jobs/j1',
        reply: response(200, { status: 'pending' }),
      },
      {
        method: 'GET',
        url: '/api/x/games/r/analysis/jobs/j1',
        reply: response(200, { status: 'done', result: { engineId: 'e@1', plies: [7] } }),
      },
    ]);
    const result = await postAnalysisJob<{ plies: number[] }>('/api/x/games/r/analysis', {
      pollIntervalMs: 1,
    });
    expect(result.plies).toEqual([7]);
    expect(calls).toHaveLength(3);
  });

  it('rejects with the mapped code when the job fails', async () => {
    stubFetch([
      { method: 'POST', reply: response(202, { jobId: 'j2', status: 'pending' }) },
      {
        method: 'GET',
        reply: response(200, { status: 'failed', error: 'analysis_engine_unavailable' }),
      },
    ]);
    await expect(postAnalysisJob('/api/x/games/r/analysis', { pollIntervalMs: 1 })).rejects.toThrow(
      'analysis_request_failed_analysis_engine_unavailable',
    );
  });

  it('rejects on a non-200/202 POST with the status-coded error (prefix configurable)', async () => {
    stubFetch([{ method: 'POST', reply: response(429, { error: 'rate_limited' }) }]);
    await expect(
      postAnalysisJob('/api/x/games/r/decisions', { errorPrefix: 'decisions_request_failed' }),
    ).rejects.toThrow('decisions_request_failed_429');
  });

  it('rejects when the poll endpoint errors', async () => {
    stubFetch([
      { method: 'POST', reply: response(202, { jobId: 'j3', status: 'pending' }) },
      { method: 'GET', reply: response(404, { error: 'not_found' }) },
    ]);
    await expect(postAnalysisJob('/api/x/games/r/analysis', { pollIntervalMs: 1 })).rejects.toThrow(
      'analysis_request_failed_404',
    );
  });

  it('gives up after the overall deadline', async () => {
    stubFetch([
      { method: 'POST', reply: response(202, { jobId: 'j4', status: 'pending' }) },
      { method: 'GET', reply: response(200, { status: 'pending' }) },
      { method: 'GET', reply: response(200, { status: 'pending' }) },
    ]);
    await expect(
      postAnalysisJob('/api/x/games/r/analysis', { pollIntervalMs: 5, timeoutMs: 8 }),
    ).rejects.toThrow('analysis_request_failed_timeout');
  });
});

it('a new page resumes GET202 through queue/progress/completion without any POST', async () => {
  const states: unknown[] = [];
  const calls = stubFetch([
    {
      method: 'GET',
      reply: response(202, { jobId: 'retained', status: 'pending', state: 'queued' }),
    },
    {
      method: 'GET',
      reply: response(200, {
        status: 'pending',
        state: 'running',
        progress: { phase: 'analysis', completed: 7, total: 20 },
      }),
    },
    { method: 'GET', reply: response(200, { status: 'done', result: { plies: [1] } }) },
  ]);
  expect(
    await fetchAnalysisJob('/api/x/games/r/analysis', {
      pollIntervalMs: 1,
      onStatus: (s) => states.push(s),
    }),
  ).toEqual({ plies: [1] });
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(states).toHaveLength(2);
  expect(states[1]).toMatchObject({ state: 'running', progress: { completed: 7, total: 20 } });
});
it('a GET204 miss never requests computation', async () => {
  const calls = stubFetch([{ method: 'GET', reply: response(204, null) }]);
  expect(await fetchAnalysisJob('/api/x/games/r/analysis')).toBeNull();
  expect(calls).toHaveLength(1);
});
it('a lost handle or retained failure stays actionable without an automatic POST', async () => {
  const calls = stubFetch([
    { method: 'GET', reply: response(202, { jobId: 'lost', status: 'pending' }) },
    { method: 'GET', reply: response(404, null) },
    {
      method: 'GET',
      reply: response(202, { jobId: 'failed', status: 'failed', error: 'analysis_failed' }),
    },
  ]);
  await expect(fetchAnalysisJob('/api/x/games/r/analysis', { pollIntervalMs: 1 })).rejects.toThrow(
    '_404',
  );
  await expect(fetchAnalysisJob('/api/x/games/r/analysis')).rejects.toThrow('_analysis_failed');
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
});
it('unmount abort cancels the wait and never sends another poll', async () => {
  const controller = new AbortController();
  const calls = stubFetch([
    { method: 'GET', reply: response(202, { jobId: 'running', status: 'pending' }) },
  ]);
  const pending = fetchAnalysisJob('/api/x/games/r/analysis', {
    signal: controller.signal,
    pollIntervalMs: 10000,
    onStatus: () => controller.abort(),
  });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toHaveLength(1);
});

it('supports the browser floor without AbortSignal reason or throwIfAborted', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted');
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    configurable: true,
    value: undefined,
  });
  try {
    stubFetch([{ method: 'GET', reply: response(200, { plies: [1] }) }]);
    expect(await fetchAnalysisJob('/api/x/games/r/analysis')).toEqual({ plies: [1] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchAnalysisJob('/api/x/games/r/analysis', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    if (original) Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', original);
  }
});
