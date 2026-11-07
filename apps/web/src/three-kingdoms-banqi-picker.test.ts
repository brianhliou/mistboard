import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlayableEnginesOnce } from './landing.js';
import { openLandingSetupDialog, setRoomNavigator } from './landing-play.js';
import { setResolvedAdmin } from './signed-in-state.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';

const ORIGINAL = 'misty-three-kingdoms-banqi';
const L1 = `${ORIGINAL}-level-1`;
const L8 = `${ORIGINAL}-level-8`;
const options = [
  ORIGINAL,
  ...Array.from({ length: 8 }, (_, i) => `${ORIGINAL}-level-${i + 1}`),
].map((id) => ({
  id,
  name: id === ORIGINAL ? 'Misty' : `Misty level ${id.at(-1)}`,
  familyName: 'Misty',
  kind: 'container',
}));

describe('TK setup uses the server runtime roster', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
    setResolvedAdmin(true);
    setRoomNavigator(vi.fn());
  });
  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.replaceChildren();
    window.localStorage.clear();
    setResolvedAdmin(undefined);
    setRoomNavigator(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function load(roster = options) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input) === '/api/rooms'
        ? Response.json({ url: '/room/tkb_picker' })
        : Response.json({
            engines: [
              { id: 'python-v2-v1.0', name: 'Misty', familyName: 'Misty', kind: 'container' },
            ],
            threeKingdomsBanqiEngines: roster,
          }),
    );
    vi.stubGlobal('fetch', fetcher);
    await fetchPlayableEnginesOnce();
    return fetcher;
  }
  function open() {
    openLandingSetupDialog({
      mode: 'pve',
      initialGameSpecId: 'three-kingdoms-banqi',
      locale: 'en',
    });
    return document.querySelector<HTMLSelectElement>('select[aria-label="Bot"]');
  }

  it('offers all reported levels and submits the selected level, preserving the classical default', async () => {
    const fetcher = await load();
    const select = open();
    expect(select).not.toBeNull();
    expect([...select!.options].map((o) => o.value)).toEqual(options.map((e) => e.id));
    expect(select!.value).toBe(ORIGINAL);
    select!.value = L8;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    const play = document.querySelector<HTMLButtonElement>('.landing-setup-start');
    expect(play).not.toBeNull();
    play!.click();
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.some(([input]) => String(input) === '/api/rooms')).toBe(true),
    );
    const call = fetcher.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
      gameSpecId: 'three-kingdoms-banqi',
      mode: 'pve',
      engineId: L8,
    });
  });

  it('drops L8 when no net is reported and discards a stale remembered L8', async () => {
    await load(options.filter((e) => e.id !== L8));
    window.localStorage.setItem(
      'mistboard:setup:pve',
      JSON.stringify({ engineIdByGameSpec: { 'three-kingdoms-banqi': L8 } }),
    );
    const select = open();
    expect(select).not.toBeNull();
    expect([...select!.options].map((o) => o.value)).not.toContain(L8);
    expect(select!.value).toBe(ORIGINAL);
  });

  it('uses L1 when the binary is unavailable and never submits the unavailable default', async () => {
    const fetcher = await load(options.filter((e) => e.id === L1));
    open();
    document.querySelector<HTMLButtonElement>('.landing-setup-start')!.click();
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.some(([input]) => String(input) === '/api/rooms')).toBe(true),
    );
    const call = fetcher.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string).engineId).toBe(
      L1,
    );
  });

  it('keeps runtime levels behind the admin/local gate and clears a missing API roster', async () => {
    await load();
    const landing = webVariantTenantForSpecId('three-kingdoms-banqi')!.landing!;
    for (const role of [undefined, false] as const) {
      setResolvedAdmin(role);
      expect(landing.engineOptions).toBeUndefined();
    }
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    expect(landing.engineOptions?.map((e) => e.id)).toEqual(options.map((e) => e.id));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ engines: options.slice(0, 1) })),
    );
    await fetchPlayableEnginesOnce();
    expect(landing.engineOptions).toBeUndefined();
  });

  it('offers no guessed tiers before availability loads or after a failed refresh', async () => {
    await load([]);
    const landing = webVariantTenantForSpecId('three-kingdoms-banqi')!.landing!;
    expect(landing.engineOptions).toBeUndefined();
    await load();
    expect(landing.engineOptions?.length).toBe(9);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
    expect(landing.engineOptions).toBeUndefined();
  });
});
