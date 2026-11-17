import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABOUT_NAV_GROUPS } from './about-nav-items.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { LOCALE_STORAGE_KEY } from './i18n/locale.js';
import { mountAbout } from './pages-static.js';

describe('About rail navigation', () => {
  let root: HTMLElement;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    window.history.replaceState(null, '', '/about');
    document.head.innerHTML =
      '<title>About · Mistboard</title><link rel="canonical" href="https://mistboard.com/about">';
    root = document.createElement('div');
    document.body.append(root);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('/api/')) return new Response('{}', { status: 401 });
        const path = new URL(String(input), window.location.href).pathname;
        return new Response(
          `<html lang="en"><head><title>${path} search title</title><link rel="canonical" href="https://mistboard.com${path}"></head></html>`,
        );
      }),
    );
    mountAbout(root);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function click(path: string, init: MouseEventInit = {}) {
    const link = root.querySelector<HTMLAnchorElement>(`.static-page-rail-link[href="${path}"]`)!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    link.dispatchEvent(event);
    return event;
  }

  it('keeps the header, rail and phone scroll when loading two rail pages in sequence', async () => {
    const header = root.querySelector('.site-nav');
    const rail = root.querySelector<HTMLElement>('.static-page-rail')!;
    const layout = root.querySelector('.static-page-layout');
    rail.scrollLeft = 180;
    for (const path of ['/faq', '/source']) {
      expect(click(path).defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(window.location.pathname).toBe(path));
      await vi.waitFor(() =>
        expect(root.querySelector('.static-page-rail-link.active')?.getAttribute('href')).toBe(
          path,
        ),
      );
      expect(root.querySelector('.site-nav')).toBe(header);
      expect(root.querySelector('.static-page-layout')).toBe(layout);
      expect(root.querySelector('.static-page-rail')).toBe(rail);
      expect(rail.scrollLeft).toBe(180);
      expect(document.title).toBe(`${path} search title`);
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        `https://mistboard.com${path}`,
      );
    }
    expect(root.classList.contains('about-route')).toBe(false);
    expect(root.classList.contains('faq-route')).toBe(false);
    expect(root.classList.contains('source-route')).toBe(true);
  });

  it('restores the main column on Back and Forward without replacing the shell', async () => {
    const header = root.querySelector('.site-nav');
    click('/faq');
    await vi.waitFor(() => expect(root.querySelector('.faq-section')).not.toBeNull());
    window.history.back();
    await vi.waitFor(() => expect(root.querySelector('.about-section')).not.toBeNull());
    expect(window.location.pathname).toBe('/about');
    expect(document.title).toBe('/about search title');
    window.history.forward();
    await vi.waitFor(() => expect(root.querySelector('.faq-section')).not.toBeNull());
    expect(root.querySelector('.site-nav')).toBe(header);
  });

  it.each(ABOUT_NAV_GROUPS.flat().filter((item) => !('leavesRail' in item)))(
    'loads $href using its existing page mount',
    async ({ href }) => {
      expect(click(href).defaultPrevented).toBe(true);
      await vi.waitFor(
        () =>
          expect(root.querySelector('.static-page-rail-link.active')?.getAttribute('href')).toBe(
            href,
          ),
        // The first visit to a page imports its module cold; on a busy machine
        // that alone has taken more than ten seconds.
        { timeout: 25_000 },
      );
      expect(root.querySelector('.static-page-panel')?.textContent?.length).toBeGreaterThan(0);
      expect(document.querySelectorAll('body > [data-static-page-staging]')).toHaveLength(0);
    },
    30_000,
  );

  it.each([
    ['/patron', {}],
    ['/data', {}],
    ['/faq', { ctrlKey: true }],
    ['/faq', { metaKey: true }],
    ['/faq', { shiftKey: true }],
    ['/faq', { altKey: true }],
    ['/faq', { button: 1 }],
  ] as const)('keeps browser navigation for %s %j', (path, init) => {
    expect(click(path, init).defaultPrevented).toBe(false);
  });

  it('leaves header links, downloads and new-tab links to the browser', () => {
    const header = root.querySelector<HTMLAnchorElement>('.site-nav-brand')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    header.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    const link = root.querySelector<HTMLAnchorElement>('.static-page-rail-link[href="/faq"]')!;
    link.target = '_blank';
    expect(click('/faq').defaultPrevented).toBe(false);
    link.target = '';
    link.download = 'faq.html';
    expect(click('/faq').defaultPrevented).toBe(false);
  });

  it('keeps the old panel on fetch failure and falls back to normal navigation', async () => {
    const panel = root.querySelector('.static-page-panel')!.firstElementChild;
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    click('/faq');
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(new URL('/faq', window.location.href).href),
    );
    expect(root.querySelector('.static-page-panel')!.firstElementChild).toBe(panel);
    expect(window.location.pathname).toBe('/about');
  });

  it('ignores an older navigation finishing after a newer click', async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    click('/faq');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    click('/source');
    await vi.waitFor(() => expect(root.querySelector('.source-section')).not.toBeNull());
    complete(new Response('<title>Stale FAQ</title>'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.pathname).toBe('/source');
    expect(document.title).toBe('/source search title');
    expect(root.querySelector('.source-section')).not.toBeNull();
  });

  it('cancels a pending page when the visible page is clicked again', async () => {
    const respond = vi.mocked(fetch).getMockImplementation()!;
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (input === '/api/titles/my-request') {
        return new Promise((resolve) => {
          complete = resolve;
        });
      }
      return respond(input, init);
    });
    click('/verify-title');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(window.location.pathname).toBe('/verify-title');
    click('/about');
    await vi.waitFor(() => expect(window.location.pathname).toBe('/about'));
    complete(new Response('{}', { status: 401 }));
    await vi.waitFor(() => expect(document.querySelector('[data-static-page-staging]')).toBeNull());
    expect(root.querySelector('.about-section')).not.toBeNull();
    expect(window.location.pathname).toBe('/about');
  });

  it.each(['zh-Hans', 'zh-Hant'] as const)(
    'restores a %s deep link through history',
    async (locale) => {
      await ensureLocaleCatalog(locale);
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      window.history.replaceState(null, '', `/${locale.toLowerCase()}/about`);
      root.replaceChildren();
      mountAbout(root);
      const header = root.querySelector('.site-nav');
      click('/faq');
      await vi.waitFor(() => expect(root.querySelector('.faq-section')).not.toBeNull());
      window.history.back();
      await vi.waitFor(() => expect(root.querySelector('.about-section')).not.toBeNull());
      expect(window.location.pathname).toBe(`/${locale.toLowerCase()}/about`);
      expect(root.querySelector('.site-nav')).toBe(header);
    },
  );

  it('opens a clicked page at its top, and leaves Back to the browser', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    click('/faq');
    await vi.waitFor(() => expect(root.querySelector('.faq-section')).not.toBeNull());
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    window.history.back();
    await vi.waitFor(() => expect(root.querySelector('.about-section')).not.toBeNull());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores a deep-link fragment after the history destination is mounted', async () => {
    window.history.replaceState(null, '', '/about#who');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    click('/faq');
    await vi.waitFor(() => expect(root.querySelector('.faq-section')).not.toBeNull());
    scroll.mockClear();
    window.history.back();
    await vi.waitFor(() => expect(root.querySelector('#who')).not.toBeNull());
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.instances).toContain(root.querySelector('#who'));
  });

  it('starts and retains the live lag readout after moving its content into the panel', async () => {
    click('/lag');
    await vi.waitFor(() => expect(root.querySelector('.lag-answer.bad')).not.toBeNull());
    expect(fetch).toHaveBeenCalledWith('/api/ping', { cache: 'no-store' });
    expect(root.querySelector('.lag-section')?.isConnected).toBe(true);
  });
});
