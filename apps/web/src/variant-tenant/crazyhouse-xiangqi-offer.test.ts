import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Crazyhouse Xiangqi is an admin playtest on the server's allowlist (139), the
// mahjong terms: the build flag alone must not put it in a play menu. An
// account is offered the table only when /api/auth/me named it among the
// variants that account can sit down at (admins get every allowlisted spec).
describe('crazyhouse xiangqi is offered only to an account the server would seat', () => {
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
    vi.stubEnv('VITE_CRAZYHOUSE_XIANGQI_ENABLED', 'false');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('crazyhouse-xiangqi')?.landing;
    setResolvedVariantGrants(['crazyhouse-xiangqi']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);
  });

  it('with the flag on, follows the resolved grants', async () => {
    vi.stubEnv('VITE_CRAZYHOUSE_XIANGQI_ENABLED', 'true');
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('crazyhouse-xiangqi')?.landing;

    // A visitor, and a player whose grants name only mahjong, see no door.
    expect(landing?.offerInMenu()).toBe(false);
    setResolvedVariantGrants(['mahjong']);
    expect(landing?.offerInMenu()).toBe(false);
    expect(landing?.acceptsDeepLink()).toBe(false);

    // An admin's /api/auth/me names every allowlisted spec.
    setResolvedVariantGrants(['mahjong', 'crazyhouse-xiangqi']);
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
