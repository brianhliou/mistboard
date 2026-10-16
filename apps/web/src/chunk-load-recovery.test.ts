import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunkReloadPending,
  clearChunkReloadAttempt,
  installGlobalChunkLoadRecovery,
  isChunkLoadError,
  shouldReloadForChunkLoadError,
} from './chunk-load-recovery.js';

describe('chunk load recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it.each([
    'Failed to fetch dynamically imported module: /assets/watch-old.js',
    'error loading dynamically imported module',
    'Importing a module script failed',
  ])('recognizes browser chunk failures: %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('ignores ordinary application errors', () => {
    expect(isChunkLoadError(new Error('malformed replay'))).toBe(false);
    expect(shouldReloadForChunkLoadError(new Error('malformed replay'))).toBe(false);
  });

  it('grants one reload attempt until a successful mount clears it', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
    expect(shouldReloadForChunkLoadError(error)).toBe(false);
    clearChunkReloadAttempt();
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
  });
});

describe('installGlobalChunkLoadRecovery', () => {
  const uninstalls: Array<() => void> = [];
  const install = (reload: () => void) => {
    const uninstall = installGlobalChunkLoadRecovery(reload);
    uninstalls.push(uninstall);
    return uninstall;
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    while (uninstalls.length > 0) uninstalls.pop()?.();
  });

  it('reloads once on vite:preloadError, then lets Vite rethrow', () => {
    const reloads: number[] = [];
    install(() => reloads.push(1));

    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(reloads).toHaveLength(1);
    // preventDefault tells Vite not to rethrow: we are reloading instead.
    expect(first.defaultPrevented).toBe(true);

    // The one-shot is spent: no second reload, and the error propagates so the
    // failure surfaces (error panel / error tracking) instead of looping.
    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(reloads).toHaveLength(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it('shares the one-shot session cap with the per-mount guards', () => {
    // A per-mount guard already spent the attempt this session…
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
    expect(shouldReloadForChunkLoadError(error)).toBe(true);

    // …so the global handler must not reload again (no reload loop).
    const reloads: number[] = [];
    install(() => reloads.push(1));
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(reloads).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);

    // A successful mount clears the flag and re-arms the global handler.
    clearChunkReloadAttempt();
    const rearmed = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(rearmed);
    expect(reloads).toHaveLength(1);
    expect(rearmed.defaultPrevented).toBe(true);
  });

  it('marks a reload pending only when it claims the one-shot', () => {
    // Vite resolves the failed import() to undefined once the event is
    // prevented, so callers that destructure the module throw before the
    // reload lands. chunkReloadPending is how they (and error tracking) tell
    // that throw apart from a real mount failure.
    install(() => {});
    expect(chunkReloadPending()).toBe(false);
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(chunkReloadPending()).toBe(true);
  });

  it('leaves nothing pending when the one-shot was already spent', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
    install(() => {});
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    // No reload is coming, so the error that follows is real and must report.
    expect(chunkReloadPending()).toBe(false);
  });
});
