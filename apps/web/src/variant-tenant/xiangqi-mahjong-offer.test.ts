import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Launched 2026-10-25: the build flag still gates rendering, but a playtest
// grant is no longer needed for the menu or a deep link.
describe('xiangqi mahjong is offered to every visitor when enabled', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is not offered with the flag off, grant or no grant', async () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'false');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('xiangqi-mahjong')?.landing;
    setResolvedVariantGrants(['xiangqi-mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);
  });

  it('with the flag on, is offered regardless of playtest grants', async () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('xiangqi-mahjong')?.landing;

    setResolvedVariantGrants([]);
    expect(landing?.offerInMenu()).toBe(true);
    expect(landing?.acceptsDeepLink()).toBe(true);
    const { enabledLandingVariantGameSpecs } = await import('../landing-play.js');
    expect(enabledLandingVariantGameSpecs('pvp', 'en').map((spec) => spec.gameSpecId)).toContain(
      'xiangqi-mahjong',
    );
    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(true);
    expect(landing?.acceptsDeepLink()).toBe(true);

    setResolvedVariantGrants(['xiangqi-mahjong']);
    expect(landing?.offerInMenu()).toBe(true);
    expect(landing?.acceptsDeepLink()).toBe(true);
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
