import { describe, expect, it, vi } from 'vitest';
import { BANQI_REVEAL_REQUEST_TIMEOUT_MS, createBanqiFinalReveal } from './banqi-final-reveal.js';
import type { BanqiWireView } from './live-banqi.js';

const final = (id = 'one'): BanqiWireView => ({
  id,
  ply: 1,
  perspective: 'red',
  legalMoves: [],
  captured: [],
  firstColor: 'red',
  moveNumber: 1,
  status: { type: 'finished', winner: 'red', reason: 'resignation' },
  board: { a1: { faceDown: false, color: 'red', role: 'general' } },
});
const payload = (id = 'one') =>
  new Response(
    JSON.stringify({ roomId: id, finalizedAt: new Date(5).toISOString(), view: final(id) }),
  );
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};
describe('optional finalized Banqi board', () => {
  it('times out a hung readiness request, retries and cleans up its timers', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const control = createBanqiFinalReveal({
      fetch: fetcher,
      changed: vi.fn(),
      mounted: () => true,
    });
    try {
      control.sync('one', final(), true);
      await vi.advanceTimersByTimeAsync(BANQI_REVEAL_REQUEST_TIMEOUT_MS);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(control.state().ready).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(control.state().ready).toBe(true);
      control.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      control.dispose();
      vi.useRealTimers();
    }
  });
  it.each(['fetch', 'body', 'error'] as const)(
    'recovers from a failed %s request and allows a clean retry',
    async (mode) => {
      vi.useFakeTimers();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      if (mode === 'fetch') fetcher.mockImplementationOnce(() => new Promise(() => {}));
      if (mode === 'body')
        fetcher.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) } as Response);
      if (mode === 'error') fetcher.mockRejectedValueOnce(new Error('network failed'));
      fetcher.mockResolvedValueOnce(payload());
      const control = createBanqiFinalReveal({
        fetch: fetcher,
        changed: vi.fn(),
        mounted: () => true,
      });
      try {
        control.sync('one', final(), true);
        await settle();
        const pending = control.toggle();
        await vi.advanceTimersByTimeAsync(BANQI_REVEAL_REQUEST_TIMEOUT_MS);
        await pending;
        expect(control.state()).toMatchObject({
          loading: false,
          failed: true,
          ready: true,
          view: null,
        });
        expect(vi.getTimerCount()).toBe(0);
        await control.toggle();
        expect(control.state()).toMatchObject({ loading: false, failed: false });
        expect(control.state().view?.id).toBe('one');
        control.dispose();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        control.dispose();
        vi.useRealTimers();
      }
    },
  );
  it('checks readiness without identities, fetches only on opt-in and restores on opt-out', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(payload());
    const control = createBanqiFinalReveal({
      fetch: fetcher,
      changed: vi.fn(),
      mounted: () => true,
    });
    control.sync('one', { ...final(), status: { type: 'playing', turn: 'red' } }, true);
    expect(fetcher).not.toHaveBeenCalled();
    control.sync('one', final(), true);
    await settle();
    expect(control.state().ready).toBe(true);
    expect(control.state().view).toBeNull();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('HEAD');
    await control.toggle();
    expect(control.state().view?.id).toBe('one');
    await control.toggle();
    expect(control.state().view).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    control.dispose();
  });
  it.each(['off', 'room', 'scrub', 'unmount'] as const)(
    'ignores a late response after %s even when transport ignores abort',
    async (mode) => {
      let resolve!: (response: Response) => void;
      let mounted = true;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        )
        .mockResolvedValue(new Response(null, { status: 204 }));
      const control = createBanqiFinalReveal({
        fetch: fetcher,
        changed: vi.fn(),
        mounted: () => mounted,
      });
      control.sync('one', final(), true);
      await settle();
      const pending = control.toggle();
      if (mode === 'off') await control.toggle();
      if (mode === 'room') control.sync('two', final('two'), true);
      if (mode === 'scrub') control.sync('one', final(), false);
      if (mode === 'unmount') {
        mounted = false;
        control.dispose();
      }
      resolve(payload());
      await pending;
      expect(control.state().view).toBeNull();
      expect(control.state().wanted).toBe(false);
      control.dispose();
    },
  );
  it('rejects a mismatched final response and never enables from a local finished flag', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(payload('different'));
    const control = createBanqiFinalReveal({
      fetch: fetcher,
      changed: vi.fn(),
      mounted: () => true,
    });
    control.sync('one', final(), true);
    await settle();
    await control.toggle();
    expect(control.state().view).toBeNull();
    control.dispose();
    control.sync('one', null, true);
    expect(control.state().visible).toBe(false);
  });
});
