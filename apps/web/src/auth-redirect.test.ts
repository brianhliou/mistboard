import { afterEach, describe, expect, it, vi } from 'vitest';

describe('auth redirect helpers', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('builds a login URL with the current local path as referrer', async () => {
    window.history.replaceState(null, '', '/inbox/ana?filter=unread#latest');

    const { loginHrefForCurrentPage } = await import('./auth-redirect.js');

    expect(loginHrefForCurrentPage()).toBe(
      '/account?tab=login&referrer=%2Finbox%2Fana%3Ffilter%3Dunread%23latest',
    );
  });

  it('rejects non-local auth referrers', async () => {
    window.history.replaceState(null, '', '/account?tab=login&referrer=https://example.com');

    const { requestedAuthReferrer } = await import('./auth-redirect.js');

    expect(requestedAuthReferrer()).toBeNull();
  });
});

describe('auth attribution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  it('captures nav clicks once opened and keeps source through reload', async () => {
    const { initializeAuthSourceTracking, authContextForOpen } = await import('./auth-redirect.js');
    window.history.replaceState(null, '', '/puzzles/private@example.com?code=87654321');
    const nav = document.createElement('nav');
    nav.innerHTML = '<a href="/account?tab=login"><span>Sign in</span></a>';
    document.body.append(nav);
    const stop = initializeAuthSourceTracking();
    try {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      nav.querySelector('a')!.addEventListener('click', (event) => event.preventDefault());
      nav.querySelector('span')!.dispatchEvent(click);
      window.history.replaceState(null, '', '/account?tab=login');
      expect(authContextForOpen()).toEqual({ source: 'nav', path: '/puzzles/:id' });
      expect(authContextForOpen()).toEqual({ source: 'nav', path: '/puzzles/:id' });
    } finally {
      stop();
      nav.remove();
    }
  });

  it.each([
    ['/challenge/secret-code', 'challenge-accept', '/challenge/:id'],
    ['/correspondence', 'correspondence', '/correspondence'],
    ['/banqi/game/secret-code', 'post-game', '/banqi/game/:id'],
    ['/room/live-room', 'route', '/room/:id'],
  ])('uses the route when storage is blocked: %s', async (referrer, source, path) => {
    const { authContextForOpen } = await import('./auth-redirect.js');
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    window.history.replaceState(
      null,
      '',
      `/account?source=private%40example.com&referrer=${encodeURIComponent(referrer)}`,
    );
    expect(authContextForOpen()).toEqual({ source, path });
  });

  it('ignores stale or malformed attribution and strips private URL components', async () => {
    const { authContextForOpen } = await import('./auth-redirect.js');
    window.history.replaceState(
      null,
      '',
      '/account?source=87654321&email=private@example.com#code',
    );
    window.sessionStorage.setItem('mistboard.auth-source', '{bad');
    expect(authContextForOpen()).toEqual({ source: 'account', path: '/account' });
    window.sessionStorage.setItem(
      'mistboard.auth-source',
      JSON.stringify({
        source: 'nav',
        path: '/',
        destination: window.location.pathname + window.location.search,
        at: Date.now() - 31 * 60_000,
      }),
    );
    expect(authContextForOpen()).toEqual({ source: 'account', path: '/account' });
  });
});
