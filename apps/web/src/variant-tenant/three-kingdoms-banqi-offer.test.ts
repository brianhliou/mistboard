import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Three Kingdoms banqi rides the prod bundle as an admin-only playtest (#684):
// no build flag on mistboard.com, so the play entry (menu, ?play deep link, the
// bot picker) is offered only when the signed-in session is admin. The server
// refuses anyone else at create, join and seat; this is the door, not the lock.
describe('Three Kingdoms banqi is offered only to an admin session on prod', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENGINE', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a guest and a signed-in player see no entry anywhere in the play picker', async () => {
    const { setResolvedAdmin } = await import('../signed-in-state.js');
    const { webVariantOfferedInMenu, webVariantTenantForSpecId } = await import('./registry.js');
    const { enabledLandingVariantGameSpecs } = await import('../landing-play.js');
    const tenant = webVariantTenantForSpecId('three-kingdoms-banqi');
    expect(tenant).not.toBeNull();

    for (const resolved of [undefined, false] as const) {
      setResolvedAdmin(resolved);
      expect(tenant?.enabled()).toBe(false);
      expect(webVariantOfferedInMenu('three-kingdoms-banqi')).toBe(false);
      expect(tenant?.landing?.acceptsDeepLink()).toBe(false);
      expect(tenant?.landing?.engineOptions ?? []).toEqual([]);
      for (const mode of ['pve', 'pvp', 'lobby'] as const) {
        const ids = enabledLandingVariantGameSpecs(mode, 'en').map((spec) => spec.gameSpecId);
        expect(ids).not.toContain('three-kingdoms-banqi');
        // The list is not empty for some other reason: banqi is still there.
        expect(ids).toContain('banqi');
      }
    }
  });

  it('an admin session gets the menu entry, the deep link and the bot', async () => {
    const { setResolvedAdmin } = await import('../signed-in-state.js');
    const { webVariantOfferedInMenu, webVariantTenantForSpecId } = await import('./registry.js');
    const { enabledLandingVariantGameSpecs } = await import('../landing-play.js');
    const tenant = webVariantTenantForSpecId('three-kingdoms-banqi');

    setResolvedAdmin(true);
    expect(tenant?.enabled()).toBe(true);
    expect(webVariantOfferedInMenu('three-kingdoms-banqi')).toBe(true);
    expect(tenant?.landing?.acceptsDeepLink()).toBe(true);
    expect(tenant?.landing?.engineOptions?.length).toBeGreaterThan(0);
    expect(tenant?.landing?.defaultEngineId).toBeTruthy();
    expect(enabledLandingVariantGameSpecs('pve', 'en').map((spec) => spec.gameSpecId)).toContain(
      'three-kingdoms-banqi',
    );

    // Auth settles to a non-admin over a stale admin hint: the resolved answer wins.
    const { writeAdminHint } = await import('../signed-in-state.js');
    writeAdminHint(true);
    setResolvedAdmin(false);
    expect(webVariantOfferedInMenu('three-kingdoms-banqi')).toBe(false);
  });

  it('the public surfaces stay on the build flag alone, admin or not', async () => {
    const { setResolvedAdmin } = await import('../signed-in-state.js');
    const { variantPlaytestSurfaceEnabled } = await import('../variant-public-surfaces.js');
    setResolvedAdmin(true);
    expect(variantPlaytestSurfaceEnabled('three-kingdoms-banqi')).toBe(false);
  });
});

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}
