import { FFQ_BANQI_SPEC_ID } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ffqBanqiEnabled } from '../feature-flags.js';
import {
  enabledLandingVariantGameSpecs,
  landingPlayDeepLinkAccepts,
  openLandingSetupDialog,
  roomCreationRequestBody,
} from '../landing-play.js';
import { setResolvedAdmin, writeAdminHint } from '../signed-in-state.js';
import { variantPublicSurfaceEnabled, variantSupportsPve } from '../variant-public-surfaces.js';
import { webVariantTenantForRoomId, webVariantTenantForSpecId } from './registry.js';

beforeEach(() => {
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
});
afterEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  setResolvedAdmin(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('FFQ hidden admin room entry', () => {
  it.each([undefined, 'false', 'true'])('requires flag=%s AND an admin, even in dev', (flag) => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', flag);
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
      for (const mode of ['pve', 'lobby'] as const) {
        expect(
          enabledLandingVariantGameSpecs(mode, 'en').map((entry) => entry.gameSpecId),
        ).not.toContain(FFQ_BANQI_SPEC_ID);
      }
    }
    writeAdminHint(true);
    setResolvedAdmin(false);
    expect(tenant?.landing?.offerInMenu()).toBe(false);
  });

  it('opens a friend setup but cannot carry FFQ into a bot or lobby setup', () => {
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
      expect(entry()).toBeNull();
    }
  });

  it('creates only casual human rooms with fixed Red/Black seats', () => {
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
    expect(tenant?.watch).toBeUndefined();
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
