import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLikelyAutomatedBrowser } from './analytics.js';

const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const chrome = (platform: string, version: number) =>
  `${platform} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
const firefox = (platform: string, version: number) =>
  `${platform} Gecko/20100101 Firefox/${version}.0`;
const edge = (platform: string, version: number) => `${chrome(platform, version)} Edg/${version}.0`;
const scraperUas = [
  ['Windows Chrome 119', chrome(windows, 119)],
  ['Windows Firefox 120', firefox(windows, 120)],
  ['Mac Chrome 119', chrome(mac, 119)],
  ['Mac Firefox 121', firefox(mac, 121)],
  ['Windows Edge 120', edge(windows, 120)],
  ['Mac Chrome 120', chrome(mac, 120)],
  ['Windows Chrome 120', chrome(windows, 120)],
  ['Windows Chrome 118', chrome(windows, 118)],
] as const;
const currentUas = [
  ['desktop Chrome 154', chrome(windows, 154)],
  ['Android Chrome 154', chrome('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 154)],
  [
    'iOS Safari 18',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ],
  ['Firefox 140', firefox(windows, 140)],
] as const;

describe('isLikelyAutomatedBrowser (#899)', () => {
  it.each(scraperUas)('suspects the scraper using %s', (_label, ua) => {
    expect(isLikelyAutomatedBrowser(ua, false)).toBe(true);
  });

  it.each(currentUas)('keeps %s', (_label, ua) => {
    expect(isLikelyAutomatedBrowser(ua, false)).toBe(false);
  });

  it.each(currentUas)('suspects webdriver even with %s', (_label, ua) => {
    expect(isLikelyAutomatedBrowser(ua, true)).toBe(true);
  });

  it.each([chrome, edge, firefox])('cuts off desktop versions at 125 (%#)', (ua) => {
    expect(isLikelyAutomatedBrowser(ua(windows, 124), false)).toBe(true);
    expect(isLikelyAutomatedBrowser(ua(windows, 125), false)).toBe(false);
  });

  it.each([
    chrome('Mozilla/5.0 (Linux; Android 10)', 120),
    firefox('Mozilla/5.0 (Android 10; Mobile; rv:120.0)', 120),
    `${chrome(windows, 120)} Mobile`,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0 Mobile/15E148',
  ])('keeps older mobile browsers: %s', (ua) => {
    expect(isLikelyAutomatedBrowser(ua, false)).toBe(false);
  });

  it.each(['', 'unknown browser', `${mac} Version/17.0 Safari/605.1.15`])(
    'keeps browsers outside the version heuristic: %s',
    (ua) => {
      expect(isLikelyAutomatedBrowser(ua, false)).toBe(false);
    },
  );

  it('uses the Edge version ahead of its Chromium compatibility token', () => {
    expect(isLikelyAutomatedBrowser(`${chrome(windows, 125)} Edg/124.0`, false)).toBe(true);
    expect(isLikelyAutomatedBrowser(`${chrome(windows, 124)} Edg/125.0`, false)).toBe(false);
  });
});

const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  init: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  setPersonProperties: vi.fn(),
}));
describe('analytics automation gate (#899)', () => {
  let analytics: typeof import('./analytics.js');
  let removeInputListeners: () => void;

  function input(type: string, trusted = true): void {
    const event = new Event(type);
    // DOM emulators cannot generate real input; ordinary dispatch stays untrusted.
    if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
    window.dispatchEvent(event);
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Refresh the factory so load() records the dynamic import in every test.
    vi.doMock('posthog-js', () => {
      sdk.load();
      return { default: sdk };
    });
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_POSTHOG_KEY', 'test-project-key');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://analytics.example.test');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 154));
    vi.spyOn(navigator, 'webdriver', 'get').mockReturnValue(false);
    const stored = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
      },
    });
    const listeners = vi.spyOn(window, 'addEventListener');
    removeInputListeners = () => {
      for (const [type, listener, options] of listeners.mock.calls) {
        window.removeEventListener(
          type,
          listener,
          typeof options === 'boolean' ? options : options?.capture,
        );
      }
    };
    analytics = await import('./analytics.js');
  });

  afterEach(() => {
    analytics?.initializeHumanInputTracking()();
    removeInputListeners();
    vi.doUnmock('posthog-js');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(scraperUas)(
    'never imports or initializes the SDK without input for %s',
    async (_label, ua) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
      analytics.track('before_init');
      analytics.captureException(new Error('before init'));
      await analytics.initializeAnalytics(false);
      analytics.track('after_init');
      analytics.captureException(new Error('after init'));
      await analytics.initializeAnalytics(false);
      expect(sdk.load).not.toHaveBeenCalled();
      expect(sdk.init).not.toHaveBeenCalled();
      expect(sdk.capture).not.toHaveBeenCalled();
      expect(sdk.captureException).not.toHaveBeenCalled();
      expect(sdk.identify).not.toHaveBeenCalled();
      expect(sdk.setPersonProperties).not.toHaveBeenCalled();
    },
  );

  it('defers webdriver with a current UA until trusted input', async () => {
    vi.spyOn(navigator, 'webdriver', 'get').mockReturnValue(true);
    await analytics.initializeAnalytics(false);
    analytics.captureException(new Error('automated browser'));
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    input('pointerdown');
    await analytics.initializeAnalytics(false);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it.each(['pointerdown', 'keydown', 'touchstart', 'wheel'])(
    'initializes once after trusted %s and flushes queued tracks in order',
    async (type) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
      analytics.track('before_init', { order: 1 });
      await analytics.initializeAnalytics(false);
      analytics.track('while_deferred', { order: 2 });
      expect(sdk.load).not.toHaveBeenCalled();
      input(type);
      analytics.track('during_import', { order: 3 });
      input(type);
      input('pointerdown');
      await analytics.initializeAnalytics(false);
      expect(sdk.load).toHaveBeenCalledTimes(1);
      expect(sdk.init).toHaveBeenCalledTimes(1);
      expect(sdk.capture.mock.calls).toEqual([
        ['$pageview', { path: window.location.pathname }],
        ['before_init', { order: 1 }],
        ['while_deferred', { order: 2 }],
        ['during_import', { order: 3 }],
      ]);
      expect(sdk.setPersonProperties).toHaveBeenCalledWith({ human_input: true });
      analytics.track('after_init');
      expect(sdk.capture).toHaveBeenLastCalledWith('after_init', undefined);
    },
  );

  it('ignores untrusted input and trusted scroll even after it sets the person tag', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
    await analytics.initializeAnalytics(false);
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'])
      input(type, false);
    expect(window.localStorage.getItem('mistboard-human-input')).toBeNull();
    input('scroll');
    expect(window.localStorage.getItem('mistboard-human-input')).toBe('1');
    await analytics.initializeAnalytics(false);
    analytics.captureException(new Error('still deferred after scroll'));
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    input('pointerdown');
    await analytics.initializeAnalytics(false);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sdk.setPersonProperties).toHaveBeenCalledWith({ human_input: true });
  });

  it('retains only the newest 200 deferred actions, including before initialization', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
    for (let i = 0; i < 205; i++) analytics.track('queued', { i });
    await analytics.initializeAnalytics(false);
    // Scroll marks the person but must not disable the deferred queue cap.
    input('scroll');
    for (let i = 205; i < 410; i++) analytics.track('queued', { i });
    expect(sdk.load).not.toHaveBeenCalled();
    input('pointerdown');
    await analytics.initializeAnalytics(false);
    expect(sdk.capture.mock.calls).toEqual([
      ['$pageview', { path: window.location.pathname }],
      ...Array.from({ length: 200 }, (_, i) => ['queued', { i: i + 210 }]),
    ]);
  });

  it('drops caught exceptions before input permanently and captures later exceptions', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
    analytics.captureException(new Error('before init'));
    await analytics.initializeAnalytics(false);
    analytics.captureException(new Error('while deferred'));
    input('pointerdown');
    const duringImport = new Error('after input during import');
    analytics.captureException(duringImport);
    await analytics.initializeAnalytics(false);
    expect(sdk.capture.mock.calls).toEqual([['$pageview', { path: window.location.pathname }]]);
    expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(duringImport, undefined);
    const afterInit = new Error('after init');
    analytics.captureException(afterInit, { context: 'after_init' });
    expect(sdk.captureException).toHaveBeenLastCalledWith(afterInit, { context: 'after_init' });
  });

  it('initializes immediately for a suspect browser with the stored human-input marker', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
    window.localStorage.setItem('mistboard-human-input', '1');
    const error = new Error('known player');
    analytics.captureException(error);
    await analytics.initializeAnalytics(false);
    expect(sdk.load).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith('$pageview', {
      path: window.location.pathname,
    });
    expect(sdk.setPersonProperties).toHaveBeenCalledWith({ human_input: true });
    expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(error, undefined);
  });

  it('releases the gate when localStorage is blocked', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(chrome(windows, 119));
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    await analytics.initializeAnalytics(false);
    expect(sdk.load).not.toHaveBeenCalled();
    input('pointerdown');
    await analytics.initializeAnalytics(false);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.setPersonProperties).toHaveBeenCalledWith({ human_input: true });
  });

  it.each(currentUas)(
    'initializes without input and keeps telemetry for %s',
    async (_label, ua) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
      window.localStorage.setItem('mistboard-internal-browser', '1');
      const error = new Error('real browser failure');
      analytics.track('before_init');
      analytics.captureException(error);
      await analytics.initializeAnalytics(false);
      expect(sdk.load).toHaveBeenCalledTimes(1);
      expect(sdk.init).toHaveBeenCalledExactlyOnceWith(
        'test-project-key',
        expect.objectContaining({
          api_host: 'https://analytics.example.test',
          capture_exceptions: true,
          respect_dnt: true,
        }),
      );
      expect(sdk.register).toHaveBeenCalledWith({ is_internal: true });
      expect(sdk.register.mock.invocationCallOrder[0]).toBeLessThan(
        sdk.capture.mock.invocationCallOrder[0],
      );
      expect(sdk.capture).toHaveBeenNthCalledWith(1, '$pageview', {
        path: window.location.pathname,
      });
      expect(sdk.capture).toHaveBeenNthCalledWith(2, 'before_init', undefined);
      expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(error, undefined);
      analytics.track('after_init');
      analytics.captureException(error, { context: 'after_init' });
      expect(sdk.capture).toHaveBeenLastCalledWith('after_init', undefined);
      expect(sdk.captureException).toHaveBeenLastCalledWith(error, { context: 'after_init' });
    },
  );

  it('still skips embedded documents', async () => {
    await analytics.initializeAnalytics(true);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('still skips development', async () => {
    vi.stubEnv('PROD', false);
    await analytics.initializeAnalytics(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it.each(['VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST'] as const)(
    'still skips an absent %s',
    async (key) => {
      vi.stubEnv(key, '');
      await analytics.initializeAnalytics(false);
      expect(sdk.init).not.toHaveBeenCalled();
    },
  );
});
