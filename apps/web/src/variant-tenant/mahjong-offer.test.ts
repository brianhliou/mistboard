import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The offer follows the seat. Mahjong is allowlisted server-side (139), so the
// build flag alone must not put it in a play menu: an account is offered the
// table only when /api/auth/me named it among the variants that account can
// sit down at. Admins get every allowlisted spec there; players get their
// grant rows.
describe('mahjong is offered only to an account the server would seat', () => {
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

  it('with the flag on, follows the resolved grants and the persisted hint', async () => {
    vi.stubEnv('VITE_MAHJONG_ENABLED', 'true');
    const { setResolvedVariantGrants, writeVariantGrantsHint } = await import(
      '../signed-in-state.js'
    );
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('mahjong')?.landing;

    // Nothing resolved, nothing persisted: a visitor sees no door.
    expect(landing?.offerInMenu()).toBe(false);

    // A prior signed-in load left the hint, so the first paint offers it
    // before /api/auth/me comes back.
    writeVariantGrantsHint(['mahjong']);
    expect(landing?.offerInMenu()).toBe(true);

    // Auth settles and says otherwise: the resolved answer wins over the hint.
    setResolvedVariantGrants([]);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);

    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(true);
    // Menu and deep link stay on one predicate.
    expect(landing?.acceptsDeepLink()).toBe(true);
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
