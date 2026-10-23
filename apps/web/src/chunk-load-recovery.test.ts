import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chunkLoadFailureContext,
  chunkReloadPending,
  clearChunkReloadAttempt,
  installGlobalChunkLoadRecovery,
  isChunkLoadError,
  shouldReloadForChunkLoadError,
} from './chunk-load-recovery.js';

describe('chunk load recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearChunkReloadAttempt();
  });

  it.each([
    'Failed to fetch dynamically imported module: /assets/watch-old.js',
    'error loading dynamically imported module',
    'Importing a module script failed',
    'Unable to preload CSS for https://mistboard.com/assets/seat-disc-old.css',
  ])('recognizes browser chunk failures: %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('ignores ordinary application errors', () => {
    expect(isChunkLoadError(new Error('malformed replay'))).toBe(false);
    expect(shouldReloadForChunkLoadError(new Error('malformed replay'))).toBe(false);
  });

  it('grants one reload attempt until an explicit retry clears it', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
    expect(shouldReloadForChunkLoadError(error)).toBe(false);
    clearChunkReloadAttempt();
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
  });

  it('reports the exhausted recovery and asset path without URL secrets', () => {
    const error = new Error(
      'Unable to preload CSS for https://mistboard.com/assets/old.css?private=redacted#fragment',
    );
    expect(shouldReloadForChunkLoadError(error)).toBe(true);
    expect(chunkLoadFailureContext(error)).toMatchObject({
      asset_path: '/assets/old.css',
      asset_reload_state: 'already_attempted',
    });
    expect(JSON.stringify(chunkLoadFailureContext(error))).not.toContain('redacted');
    expect(chunkLoadFailureContext(new Error('ordinary error'))).toEqual({});
  });

  it.each(['getItem', 'setItem'] as const)(
    'does not reload-loop when storage %s is blocked',
    (method) => {
      const blocked = () => {
        throw new DOMException('Storage blocked', 'SecurityError');
      };
      vi.stubGlobal('sessionStorage', {
        getItem: method === 'getItem' ? blocked : () => null,
        setItem: method === 'setItem' ? blocked : () => {},
      });
      try {
        const error = new Error('Unable to preload CSS for /assets/old.css');
        expect(shouldReloadForChunkLoadError(error)).toBe(false);
        expect(shouldReloadForChunkLoadError(error)).toBe(false);
        expect(chunkLoadFailureContext(error)).toMatchObject({
          asset_reload_state: 'storage_unavailable',
        });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
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

  it('reloads once and suppresses further preload errors while that reload is pending', () => {
    const reloads: number[] = [];
    install(() => reloads.push(1));

    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(reloads).toHaveLength(1);
    // preventDefault tells Vite not to rethrow: we are reloading instead.
    expect(first.defaultPrevented).toBe(true);

    // One import can preload several stylesheets. Their failures all belong
    // to the same pending reload; Vite must not rethrow the second one.
    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(reloads).toHaveLength(1);
    expect(second.defaultPrevented).toBe(true);
    clearChunkReloadAttempt();
    expect(
      shouldReloadForChunkLoadError(new Error('Unable to preload CSS for /assets/other.css')),
    ).toBe(false);
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

    // An explicit user retry clears the flag and re-arms the global handler.
    clearChunkReloadAttempt();
    const rearmed = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(rearmed);
    expect(reloads).toHaveLength(1);
    expect(rearmed.defaultPrevented).toBe(true);
  });

  it('keeps the cap across documents and late optional failures, but allows a new deploy', () => {
    const entry = document.createElement('script');
    entry.type = 'module';
    entry.src = '/assets/index-before.js';
    const entryQuery = vi.spyOn(document, 'querySelector').mockReturnValue(entry);
    try {
      const reload = vi.fn();
      const leaveDocument = install(reload);
      window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      expect(reload).toHaveBeenCalledTimes(1);
      leaveDocument();

      // A reload creates a new document but keeps sessionStorage. Its static
      // route can mount before a background import fails again.
      install(reload);
      const lateFailure = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(lateFailure);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(lateFailure.defaultPrevented).toBe(false);
      expect(chunkReloadPending()).toBe(false);

      // The shared recovery module may keep its own hash across deploys; the
      // HTML entry's new hash must still allow recovery for that new version.
      entry.src = '/assets/index-after.js?ignored=1#fragment';
      window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      expect(reload).toHaveBeenCalledTimes(2);
      expect(sessionStorage.getItem('mistboard.chunkReloadAttempted')).toBe(
        '/assets/index-after.js',
      );
    } finally {
      entryQuery.mockRestore();
    }
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
