import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playStreakLine,
  playStreakQuery,
  postGamePlayStreakNote,
  resetPlayStreakCache,
} from './play-streak.js';

describe('play streak', () => {
  beforeEach(() => {
    resetPlayStreakCache();
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('phrases the line with the best only when it beats the current run', () => {
    expect(playStreakLine(streak(1, 1))).toBe('Play streak: 1 day');
    expect(playStreakLine(streak(3, 3))).toBe('Play streak: 3 days');
    expect(playStreakLine(streak(3, 7))).toBe('Play streak: 3 days (best 7 days)');
    expect(playStreakLine(streak(1, 2))).toBe('Play streak: 1 day (best 2 days)');
  });

  it('sends the browser calendar and the guest device id', () => {
    localStorage.setItem('mistboard.device', 'device-1234567890');
    const params = new URLSearchParams(playStreakQuery());
    expect(params.get('tz')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    expect(params.get('device')).toBe('device-1234567890');
  });

  it('fills the note once the streak is known and fetches once per room', async () => {
    const fetchMock = stubStreak([streak(3, 5, '2026-09-13')]);

    const first = postGamePlayStreakNote('room-a');
    const again = postGamePlayStreakNote('room-a');
    expect(first.hidden).toBe(true);

    await vi.waitFor(() => {
      expect(first.hidden).toBe(false);
      expect(again.hidden).toBe(false);
    });
    expect(first.textContent).toBe('Play streak: 3 days (best 5 days)');
    expect(first.className).toBe('room-actions-note play-streak');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays hidden at zero and when the request fails', async () => {
    stubStreak([streak(0, 4, '2026-09-13')]);
    const zero = postGamePlayStreakNote('room-zero');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const failed = postGamePlayStreakNote('room-down');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(zero.hidden).toBe(true);
    expect(failed.hidden).toBe(true);
    expect(failed.textContent).toBe('');
  });

  it('retries once when the game has not been counted yet', async () => {
    vi.useFakeTimers();
    // First read still says yesterday (the games row is not written yet);
    // the retry sees today.
    const fetchMock = stubStreak([streak(2, 2, '2026-09-12'), streak(3, 3, '2026-09-13')]);
    const note = postGamePlayStreakNote('room-late');

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(note.hidden).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Play streak: 3 days');
  });
});

function streak(current: number, best: number, lastPlayedDay: string | null = '2026-09-13') {
  return { current, best, lastPlayedDay, today: '2026-09-13' };
}

// Answers successive /api/play-streak calls with successive payloads (the last
// one repeats).
function stubStreak(payloads: ReturnType<typeof streak>[]) {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return new Response(JSON.stringify({ streak: payload }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
