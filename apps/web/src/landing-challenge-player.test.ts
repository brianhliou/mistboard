import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLandingChallengePlayer } from './landing-challenge-player.js';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe('challenge player availability', () => {
  let picker: ReturnType<typeof buildLandingChallengePlayer>;
  let fetcher: ReturnType<typeof vi.fn>;
  let states: Record<string, string>;
  const pick = (handle: string) =>
    document.querySelector<HTMLButtonElement>(`[data-handle="${handle}"]`)!;
  const open = async () => {
    document.querySelector<HTMLButtonElement>('[data-send-to="player"]')!.click();
    picker.row.click();
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    states = {
      online: 'available',
      follower: 'available',
      busy: 'busy',
      offline: 'offline',
      optedout: 'unavailable',
    };
    fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/following?'))
        return json({
          entries: ['online', 'busy', 'offline', 'optedout'].map((handle) => ({ handle })),
          total: 4,
        });
      if (url.includes('/followers?'))
        return json({
          entries: [{ handle: 'follower' }, { handle: 'ONLINE' }, { handle: null }],
          total: 3,
        });
      if (url.includes('online-following')) return json({ players: [{ handle: 'online' }] });
      if (url.includes('/availability?'))
        return json({
          players: Object.entries(states).map(([handle, availability]) => ({
            handle,
            availability,
          })),
        });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetcher);
    picker = buildLandingChallengePlayer({
      locale: 'en',
      onChange() {},
      onOpen() {
        picker.picker.hidden = false;
      },
      onClose() {
        picker.picker.hidden = true;
      },
    });
    document.body.append(picker.section, picker.picker);
    picker.section.hidden = false;
    picker.setRealtime(true);
  });
  afterEach(() => {
    picker.dispose();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows online follower-only players and disables busy, offline and policy-unavailable players', async () => {
    await open();
    expect(document.querySelectorAll('.landing-challenge-player-option')).toHaveLength(5);
    expect(pick('follower').disabled).toBe(false);
    expect(pick('follower').textContent).toContain('online now');
    expect(pick('busy').textContent).toContain('Playing now');
    expect(pick('offline').textContent).toContain('Currently offline');
    for (const handle of ['busy', 'offline', 'optedout']) {
      expect(pick(handle).disabled).toBe(true);
      pick(handle).click();
      expect(picker.selectedHandle()).toBeUndefined();
    }
    pick('follower').click();
    expect(picker.selectedHandle()).toBe('follower');
    expect(picker.canSend()).toBe(true);
    states.follower = 'busy';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(picker.canSend()).toBe(false);
    expect(picker.row.textContent).toContain('Playing now');
  });

  it('preserves a correspondence recipient through pace and delivery switches without allowing an unchecked live send', async () => {
    picker.setRealtime(false);
    await open();
    expect(pick('offline').disabled).toBe(false);
    pick('offline').click();
    expect(picker.canSend()).toBe(true);
    picker.setRealtime(true);
    expect(picker.canSend()).toBe(false);
    await flush();
    expect(picker.selectedHandle()).toBe('offline');
    expect(picker.canSend()).toBe(false);
    picker.setRealtime(false);
    expect(picker.canSend()).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-send-to="link"]')!.click();
    expect(picker.choosingPlayer()).toBe(false);
    picker.setRealtime(true);
    states.offline = 'available';
    document.querySelector<HTMLButtonElement>('[data-send-to="player"]')!.click();
    expect(picker.canSend()).toBe(false);
    await flush();
    expect(picker.canSend()).toBe(true);
  });

  it('fails closed on an availability failure and stops polling when the sheet closes', async () => {
    await open();
    pick('follower').click();
    fetcher.mockImplementation(async () => json({}, 503));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(picker.canSend()).toBe(false);
    expect(pick('follower').disabled).toBe(true);
    picker.dispose();
    fetcher.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores delayed availability after changing pace', async () => {
    await open();
    let release!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.advanceTimersByTime(5_000);
    await flush();
    picker.setRealtime(false);
    release(json({ players: [{ handle: 'follower', availability: 'busy' }] }));
    await flush();
    expect(pick('follower').disabled).toBe(false);
    expect(pick('follower').textContent).toContain('follows you');
  });
});
