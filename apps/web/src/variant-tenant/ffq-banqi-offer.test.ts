import { FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ffqBanqiEnabled } from '../feature-flags.js';
import { setFFQBanqiEngineOptions } from '../ffq-banqi-access.js';
import { landingBotLadder } from '../landing-bot-policy.js';
import {
  enabledLandingVariantGameSpecs,
  joinLobbyFromPlay,
  landingPlayDeepLinkAccepts,
  openLandingSetupDialog,
  roomCreationRequestBody,
  setRoomNavigator,
} from '../landing-play.js';
import { setResolvedAdmin, setResolvedSignedIn, writeAdminHint } from '../signed-in-state.js';
import { variantPublicSurfaceEnabled, variantSupportsPve } from '../variant-public-surfaces.js';
import { webVariantTenantForRoomId, webVariantTenantForSpecId } from './registry.js';

const spec = gameSpecForId(FFQ_BANQI_SPEC_ID);
const originalSurface = spec.publicSurface;

beforeEach(() => {
  spec.publicSurface = 'hidden';
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  setResolvedAdmin(undefined);
  setFFQBanqiEngineOptions([]);
});
afterEach(() => {
  spec.publicSurface = originalSurface;
  setRoomNavigator(null);
  setResolvedSignedIn(undefined);
  window.localStorage.clear();
  document.body.replaceChildren();
  setResolvedAdmin(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('FFQ hidden admin room entry', () => {
  it.each([false, true])(
    'launched guest/non-admin friend setup submits FFQ, signedIn=%s',
    async (signedIn) => {
      spec.publicSurface = 'casual';
      vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
      setResolvedAdmin(false);
      setResolvedSignedIn(signedIn);
      const navigate = vi.fn();
      setRoomNavigator(navigate);
      const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ url: '/room/ffq_public' }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      openLandingSetupDialog({
        mode: 'pvp',
        initialGameSpecId: FFQ_BANQI_SPEC_ID,
        initialColor: 'black',
        engines: [],
      });
      expect(
        document
          .querySelector('.landing-variant-card[data-game-spec="ffq-banqi"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true');
      const submit = [
        ...document.querySelectorAll<HTMLButtonElement>('.landing-setup-dialog button'),
      ].find((button) => button.textContent === 'Create room');
      expect(submit).toBeDefined();
      submit!.click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const post = fetchSpy.mock.calls.find(([url]) => url === '/api/rooms');
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]?.body))).toMatchObject({
        mode: 'pvp',
        gameSpecId: FFQ_BANQI_SPEC_ID,
        preferredColor: 'black',
        rated: false,
      });
      expect(navigate).toHaveBeenCalledWith('/room/ffq_public');
    },
  );

  it.each(['hidden', 'casual'] as const)(
    'gates every setup entry and engine roster on surface=%s',
    (surface) => {
      spec.publicSurface = surface;
      const tenant = webVariantTenantForSpecId(FFQ_BANQI_SPEC_ID)!;
      for (const flag of ['false', 'true']) {
        vi.stubEnv('VITE_FFQ_BANQI_ENABLED', flag);
        for (const admin of [undefined, false, true]) {
          setResolvedAdmin(admin);
          const offered = flag === 'true' && (surface === 'casual' || admin === true);
          expect(tenant.landing?.offerInMenu()).toBe(offered);
          expect(landingPlayDeepLinkAccepts(FFQ_BANQI_SPEC_ID)).toBe(offered);
          for (const mode of ['pvp', 'pve', 'lobby'] as const) {
            const entries = enabledLandingVariantGameSpecs(mode, 'en');
            expect(entries.some((entry) => entry.gameSpecId === FFQ_BANQI_SPEC_ID)).toBe(
              offered && (mode !== 'lobby' || surface === 'casual'),
            );
          }
          setFFQBanqiEngineOptions([]);
          expect(variantSupportsPve(FFQ_BANQI_SPEC_ID)).toBe(false);
          setFFQBanqiEngineOptions([
            {
              id: 'misty-ffq-banqi-level-4',
              name: 'Misty Level 4',
              familyName: 'Misty',
              kind: 'container',
            },
          ]);
          expect(variantSupportsPve(FFQ_BANQI_SPEC_ID)).toBe(offered);
        }
      }
    },
  );

  it('forces a stale rated lobby setup to casual in the posted request', async () => {
    spec.publicSurface = 'casual';
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    setResolvedAdmin(false);
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ status: 'matched', roomId: 'ffq_lobby', url: '/room/ffq_lobby' }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(vi.fn());
    const cancel = joinLobbyFromPlay(
      document.createElement('button'),
      {
        gameSpecId: FFQ_BANQI_SPEC_ID,
        rated: true,
        preferredColor: 'random',
        timeControl: { initialMs: 300000, incrementMs: 5000 },
      },
      document.createElement('span'),
      'en',
    );
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const post = fetchSpy.mock.calls.find(
      ([url, init]) => url === '/api/lobby' && init?.method === 'POST',
    );
    expect(post).toBeDefined();
    expect(JSON.parse(String(post![1]?.body))).toMatchObject({
      gameSpecId: FFQ_BANQI_SPEC_ID,
      rated: false,
    });
    await cancel();
  });

  it.each([undefined, 'false', 'true'])('requires flag=%s AND an admin, even in dev', (flag) => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', flag);
    setFFQBanqiEngineOptions([
      {
        id: 'misty-ffq-banqi-level-1',
        name: 'Misty Level 1',
        familyName: 'Misty',
        kind: 'builtin',
      },
    ]);
    const tenant = webVariantTenantForSpecId(FFQ_BANQI_SPEC_ID);
    expect(tenant).not.toBeNull();
    expect(webVariantTenantForRoomId('ffq_test')).toBe(tenant);
    expect(tenant?.loadLiveRoomClient).toBeTypeOf('function');
    expect(ffqBanqiEnabled()).toBe(flag === 'true');
    for (const admin of [undefined, false, true]) {
      setResolvedAdmin(admin);
      const offered = flag === 'true' && admin === true;
      expect(tenant?.landing?.offerInMenu()).toBe(offered);
      expect(landingPlayDeepLinkAccepts(FFQ_BANQI_SPEC_ID)).toBe(offered);
      expect(
        enabledLandingVariantGameSpecs('pvp', 'en').some(
          (entry) => entry.gameSpecId === FFQ_BANQI_SPEC_ID,
        ),
      ).toBe(offered);
      expect(variantPublicSurfaceEnabled(FFQ_BANQI_SPEC_ID)).toBe(false);
      expect(
        enabledLandingVariantGameSpecs('pve', 'en')
          .map((entry) => entry.gameSpecId)
          .includes(FFQ_BANQI_SPEC_ID),
      ).toBe(offered);
      for (const mode of ['lobby'] as const) {
        expect(
          enabledLandingVariantGameSpecs(mode, 'en').map((entry) => entry.gameSpecId),
        ).not.toContain(FFQ_BANQI_SPEC_ID);
      }
    }
    writeAdminHint(true);
    setResolvedAdmin(false);
    expect(tenant?.landing?.offerInMenu()).toBe(false);
  });

  it('keeps FFQ out of lobby and unavailable bot setups', () => {
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    setResolvedAdmin(true);
    openLandingSetupDialog({
      mode: 'pvp',
      initialGameSpecId: FFQ_BANQI_SPEC_ID,
      initialColor: 'red',
      modeSwitcher: true,
      engines: [],
    });
    const entry = () => document.querySelector('.landing-variant-card[data-game-spec="ffq-banqi"]');
    expect(entry()?.getAttribute('aria-checked')).toBe('true');
    expect(
      document.querySelector('.landing-color-option[aria-checked="true"] .landing-color-label')
        ?.textContent,
    ).toBe('Red');
    for (const mode of ['pve', 'lobby'] as const) {
      document.querySelector<HTMLButtonElement>(`[data-play-mode="${mode}"]`)?.click();
      if (mode === 'pve') expect(entry()?.getAttribute('aria-disabled')).toBe('true');
      else expect(entry()).toBeNull();
    }
  });

  it('creates casual rooms with fixed Red/Black seats and runtime-gated bot levels', () => {
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    setResolvedAdmin(true);
    const tenant = webVariantTenantForSpecId(FFQ_BANQI_SPEC_ID);
    expect(tenant?.landing?.capabilities).toMatchObject({
      firstColor: 'red',
      firstLabel: 'Red',
      secondColor: 'black',
      secondLabel: 'Black',
      supportsRated: false,
    });
    expect(tenant?.landing?.engineOptions).toBeUndefined();
    expect(variantSupportsPve(FFQ_BANQI_SPEC_ID)).toBe(false);
    const options = [1, 4].map((level) => ({
      id: `misty-ffq-banqi-level-${level}`,
      name: `Misty level ${level}`,
      familyName: 'Misty',
      kind: 'container',
    }));
    setFFQBanqiEngineOptions(options);
    expect(tenant?.landing?.engineOptions).toEqual(options);
    expect(tenant?.landing?.defaultEngineId).toBe('misty-ffq-banqi-level-4');
    expect(variantSupportsPve(FFQ_BANQI_SPEC_ID)).toBe(true);
    openLandingSetupDialog({
      mode: 'pve',
      initialGameSpecId: FFQ_BANQI_SPEC_ID,
      engines: [],
      modeSwitcher: true,
    });
    expect(
      document
        .querySelector('.landing-variant-card[data-game-spec="ffq-banqi"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');

    expect(
      landingBotLadder(FFQ_BANQI_SPEC_ID, new Set(), new Set(options.map((e) => e.id))).map(
        (r) => r.level,
      ),
    ).toEqual([1, 4]);
    expect(
      roomCreationRequestBody(
        'pve',
        {
          gameSpecId: FFQ_BANQI_SPEC_ID,
          preferredColor: 'black',
          rated: true,
          timeControl: { initialMs: 300000, incrementMs: 5000 },
        },
        'misty-ffq-banqi-level-4',
      ),
    ).toMatchObject({
      gameSpecId: FFQ_BANQI_SPEC_ID,
      mode: 'pve',
      engineId: 'misty-ffq-banqi-level-4',
      preferredColor: 'black',
      rated: false,
    });

    // Finished games draw on /games and TV from the masked public read.
    expect(tenant?.watch?.family).toBe('xiangqi');
    expect(tenant?.watch?.mountReplay).toBeTypeOf('function');
    // Finished games open the private review page (#808).
    expect(tenant?.gameRouteBase).toBe('/ffq-banqi/game');
    expect(tenant?.mountPostgame).toBeTypeOf('function');
    for (const preferredColor of ['red', 'black', 'random'] as const) {
      expect(
        roomCreationRequestBody('pvp', {
          gameSpecId: FFQ_BANQI_SPEC_ID,
          preferredColor,
          rated: true,
          timeControl: { initialMs: 600_000, incrementMs: 5_000 },
        }),
      ).toEqual({
        gameSpecId: FFQ_BANQI_SPEC_ID,
        mode: 'pvp',
        preferredColor,
        rated: false,
        timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      });
    }
  });
});
