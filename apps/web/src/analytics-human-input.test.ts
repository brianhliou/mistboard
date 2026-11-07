import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('human input browser tag (#816)', () => {
  let analytics: typeof import('./analytics.js');
  let stop: (() => void) | undefined;
  const key = 'mistboard-human-input';
  const capture = vi.fn();
  const setPersonProperties = vi.fn();
  const reset = vi.fn();
  const instance = () => ({ capture, setPersonProperties, reset, identify: vi.fn() });

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const stored = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => stored.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => void stored.set(key, value)),
      },
    });
    analytics = await import('./analytics.js');
    analytics.setPostHogInstance(instance());
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  function input(type: string, trusted = true, target: EventTarget = window): void {
    const event = new Event(type);
    // DOM emulators cannot produce browser input. Plant only the read-only
    // trust bit here; ordinary dispatchEvent below stays untrusted.
    if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
    target.dispatchEvent(event);
  }

  it.each(['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'])(
    'sets the person property once after a trusted %s, and removes every listener',
    (type) => {
      const remove = vi.spyOn(window, 'removeEventListener');
      stop = analytics.initializeHumanInputTracking();
      expect(setPersonProperties).not.toHaveBeenCalled();
      input(type);
      for (const next of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) input(next);
      expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
      expect(window.localStorage.setItem).toHaveBeenCalledExactlyOnceWith(key, '1');
      expect(remove).toHaveBeenCalledTimes(5);
    },
  );

  it('ignores synthetic input without consuming the first trusted input', () => {
    stop = analytics.initializeHumanInputTracking();
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'])
      input(type, false);
    expect(setPersonProperties).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    input('pointerdown');
    expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
  });

  it('blind spot: a real visitor who reads without touching, scrolling or typing stays unflagged', () => {
    stop = analytics.initializeHumanInputTracking();
    analytics.track('$pageview', { path: '/broadcast/example/round-1' });
    expect(capture).toHaveBeenCalledWith('$pageview', { path: '/broadcast/example/round-1' });
    expect(setPersonProperties).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('tags the person after an earlier pageview without emitting another pageview', () => {
    stop = analytics.initializeHumanInputTracking();
    analytics.track('$pageview', { path: '/broadcast/example/round-1' });
    expect(setPersonProperties).not.toHaveBeenCalled();
    input('pointerdown');
    expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('remembers input while the async SDK import is still loading', async () => {
    vi.resetModules();
    analytics = await import('./analytics.js');
    stop = analytics.initializeHumanInputTracking();
    input('keydown');
    expect(setPersonProperties).not.toHaveBeenCalled();
    analytics.setPostHogInstance(instance());
    expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
    input('scroll');
    expect(setPersonProperties).toHaveBeenCalledTimes(1);
  });

  it('restores the flag on reload without waiting for more input', async () => {
    stop = analytics.initializeHumanInputTracking();
    input('pointerdown');
    vi.resetModules();
    analytics = await import('./analytics.js');
    setPersonProperties.mockClear();
    const add = vi.spyOn(window, 'addEventListener');
    stop = analytics.initializeHumanInputTracking();
    analytics.setPostHogInstance(instance());
    expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('re-tags the new anonymous person after sign-out', () => {
    stop = analytics.initializeHumanInputTracking();
    input('touchstart');
    const order: string[] = [];
    reset.mockImplementation(() => order.push('reset'));
    setPersonProperties.mockImplementation(() => order.push('tag'));
    analytics.resetIdentity();
    expect(order).toEqual(['reset', 'tag']);
    expect(setPersonProperties).toHaveBeenLastCalledWith({ human_input: true });
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('never flags sign-out alone as human input', () => {
    stop = analytics.initializeHumanInputTracking();
    analytics.resetIdentity();
    expect(setPersonProperties).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps the page flag through sign-out even if storage is blocked', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    stop = analytics.initializeHumanInputTracking();
    input('wheel');
    input('scroll');
    expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
    analytics.resetIdentity();
    expect(setPersonProperties).toHaveBeenCalledTimes(2);
    expect(setPersonProperties).toHaveBeenLastCalledWith({ human_input: true });
  });

  it('catches a trusted non-bubbling scroll inside a panel', () => {
    stop = analytics.initializeHumanInputTracking();
    const panel = document.createElement('div');
    document.body.append(panel);
    try {
      input('scroll', true, panel);
      expect(setPersonProperties).toHaveBeenCalledExactlyOnceWith({ human_input: true });
    } finally {
      panel.remove();
    }
  });

  it('installs once and allows cleanup without marking the browser', () => {
    const add = vi.spyOn(window, 'addEventListener');
    stop = analytics.initializeHumanInputTracking();
    expect(analytics.initializeHumanInputTracking()).toBe(stop);
    expect(add).toHaveBeenCalledTimes(5);
    for (const [type, , options] of add.mock.calls) {
      expect(['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']).toContain(type);
      expect(options).toEqual({ capture: true, passive: true });
    }
    stop();
    input('pointerdown');
    expect(setPersonProperties).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });
});
