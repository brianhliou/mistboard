import { beforeEach, describe, expect, it, vi } from 'vitest';

// Crazyhouse Xiangqi was an admin playtest on the server's allowlist, offered
// only to an account /api/auth/me named it for. Launched 2026-10: it is in the
// play menu for every visitor, signed in or not, like the other xiangqi
// variants, and a grant list that does not name it changes nothing.
describe('crazyhouse xiangqi is offered to every visitor', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it('is in the menu and takes deep links with no grant at all', async () => {
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('crazyhouse-xiangqi')?.landing;
    expect(landing?.offerInMenu()).toBe(true);
    expect(landing?.acceptsDeepLink()).toBe(true);
  });

  it('does not depend on the resolved grants', async () => {
    const { setResolvedVariantGrants } = await import('../signed-in-state.js');
    const { webVariantTenantForSpecId } = await import('./registry.js');
    const landing = webVariantTenantForSpecId('crazyhouse-xiangqi')?.landing;
    setResolvedVariantGrants(['mahjong']);
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
