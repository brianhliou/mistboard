import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mahjong retired on 2026-11-06, so nobody is offered a table. The grant
// plumbing below is shared with the other playtest variants.
describe('mahjong is offered to nobody', () => {
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
    vi.stubEnv('VITE_MAHJONG_ENABLED', 'false');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('mahjong')?.landing;
    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);
  });

  it('is not offered once retired, even with the flag on and a grant', async () => {
    vi.stubEnv('VITE_MAHJONG_ENABLED', 'true');
    const { setResolvedVariantGrants, writeVariantGrantsHint } = await import(
      '../signed-in-state.js'
    );
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('mahjong')?.landing;
    writeVariantGrantsHint(['mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);
  });

  it('account-nav writes the grants through on every auth resolution and clears them on sign-out', async () => {
    vi.stubEnv('VITE_MAHJONG_ENABLED', 'true');
    const { hasLikelyVariantGrant, readVariantGrantsHint } = await import('../signed-in-state.js');
    const { setAccountNavUser } = await import('../account-nav.js');

    setAccountNavUser({ ...testUser('boss'), variantGrants: ['mahjong'] });
    expect(hasLikelyVariantGrant('mahjong')).toBe(true);
    expect(readVariantGrantsHint()).toEqual(['mahjong']);

    // A payload from before the field existed parses as "no grants".
    setAccountNavUser(testUser('misty'));
    expect(hasLikelyVariantGrant('mahjong')).toBe(false);
    expect(readVariantGrantsHint()).toEqual([]);

    setAccountNavUser({ ...testUser('boss'), variantGrants: ['mahjong'] });
    setAccountNavUser(null);
    expect(hasLikelyVariantGrant('mahjong')).toBe(false);
    expect(readVariantGrantsHint()).toEqual([]);
  });
});

function testUser(handle: string) {
  return {
    id: `user-${handle}`,
    email: `${handle}@example.com`,
    emailVerified: true,
    handle,
    handleChangedAt: null,
    displayName: handle,
    displayNameChangedAt: null,
    profileVisibility: 'public' as const,
    accountRole: 'player' as const,
    locale: null,
  };
}

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
