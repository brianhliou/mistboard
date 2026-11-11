import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
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
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(async () => {
  const { closeActiveLandingDialog, setRoomNavigator } = await import('../landing-play.js');
  closeActiveLandingDialog();
  setRoomNavigator(null);
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

for (const enabled of [false, true]) {
  for (const admin of [undefined, false, true]) {
    it(`Gomoku web entry: admin ${admin}, flag ${enabled}`, async () => {
      vi.stubEnv('VITE_GOMOKU_ENABLED', String(enabled));
      const { setResolvedAdmin } = await import('../signed-in-state.js');
      setResolvedAdmin(admin);
      const { webVariantTenantForSpecId, webVariantOfferedInMenu } = await import('./registry.js');
      const { landingPlayDeepLinkAccepts, enabledLandingVariantGameSpecs } = await import(
        '../landing-play.js'
      );
      const tenant = webVariantTenantForSpecId('gomoku')!;
      expect(tenant.enabled()).toBe(enabled || admin === true);
      expect(landingPlayDeepLinkAccepts('gomoku')).toBe(enabled || admin === true);
      // Even an admitted admin does not add Gomoku to listing surfaces.
      expect(webVariantOfferedInMenu('gomoku')).toBe(enabled);
      for (const mode of ['pvp', 'pve', 'lobby'] as const) {
        expect(
          enabledLandingVariantGameSpecs(mode, 'en').some((spec) => spec.gameSpecId === 'gomoku'),
        ).toBe(enabled);
      }
    });
  }
}

it.each(['friend', 'computer'])(
  'an admin can create Gomoku through the %s deep link with the flag off',
  async (play) => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { setResolvedAdmin } = await import('../signed-in-state.js');
    setResolvedAdmin(true);
    const { maybeOpenPlayDeepLink, setRoomNavigator } = await import('../landing-play.js');
    const navigate = vi.fn();
    setRoomNavigator(navigate);
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify(String(input) === '/api/rooms' ? { url: '/room/gmk_created' } : {}),
          { status: String(input) === '/api/rooms' ? 201 : 404 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', `/?play=${play}&gameSpecId=gomoku`);
    maybeOpenPlayDeepLink([]);
    const start = document.querySelector<HTMLButtonElement>('.landing-setup-start');
    expect(start).not.toBeNull();
    start!.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    const post = fetchSpy.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(post).toBeDefined();
    const init = post![1]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      gameSpecId: 'gomoku',
      mode: play === 'computer' ? 'pve' : 'pvp',
      rated: false,
      ...(play === 'computer' ? { engineId: 'rapfi-level-1' } : {}),
    });
  },
);

it('an admin cannot expose Gomoku public surfaces with the flag off, and a stale hint does not admit a resolved player', async () => {
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
  const { setResolvedAdmin, writeAdminHint } = await import('../signed-in-state.js');
  const { variantPlaytestSurfaceEnabled } = await import('../variant-public-surfaces.js');
  const { webVariantTenantForSpecId } = await import('./registry.js');
  setResolvedAdmin(true);
  expect(variantPlaytestSurfaceEnabled('gomoku')).toBe(false);
  writeAdminHint(true);
  setResolvedAdmin(false);
  expect(webVariantTenantForSpecId('gomoku')!.landing!.acceptsDeepLink()).toBe(false);
});
