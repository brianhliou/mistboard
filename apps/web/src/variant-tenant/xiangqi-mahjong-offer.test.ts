import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Xiangqi mahjong is allowlisted server-side like Hong Kong mahjong, so the
// build flag alone must never put it in a play menu or accept a deep link.
describe('xiangqi mahjong is offered only to an account the server would seat', () => {
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

  it('with the flag on, needs its own grant (a Hong Kong grant is not enough)', async () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('xiangqi-mahjong')?.landing;

    expect(landing?.offerInMenu()).toBe(false);
    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);

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
