import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDarkXiangqiPlayAgainRoom,
  darkXiangqiTimeControlFromEvents,
} from './dark-xiangqi-room-actions.js';

describe('Dark Xiangqi room actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates play-again rooms with preserved time control and random seating', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ url: '/room/dxq_next' }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      createDarkXiangqiPlayAgainRoom({ timeControl: { initialMs: 60_000, incrementMs: 1_000 } }),
    ).resolves.toBe('/room/dxq_next');

    expect(fetchSpy).toHaveBeenCalledWith('/api/rooms', {
      method: 'POST',
      // Room POSTs also carry the browser id when one is stored (#776), which
      // depends on what earlier tests in the worker left behind.
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        mode: 'pvp',
        gameSpecId: 'dark-xiangqi',
        preferredColor: 'random',
        timeControl: { initialMs: 60_000, incrementMs: 1_000 },
      }),
    });
  });

  it('extracts Dark Xiangqi time controls from room-created events', () => {
    expect(
      darkXiangqiTimeControlFromEvents([
        {
          type: 'room-created',
          timeControl: { initialMs: 180_000, incrementMs: 2_000 },
        },
      ]),
    ).toEqual({ initialMs: 180_000, incrementMs: 2_000 });
    expect(darkXiangqiTimeControlFromEvents([{ type: 'move-played' }])).toBeNull();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}
