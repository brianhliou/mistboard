// Shared recovery for stale Vite chunks. A tab can keep an older entry bundle
// across a deploy, then discover that a lazily imported hashed chunk no longer
// exists. Reload once to fetch the current entry bundle and its chunk map; cap
// the attempt in sessionStorage so a genuinely missing asset cannot reload-loop.
const CHUNK_RELOAD_FLAG = 'mistboard.chunkReloadAttempted';

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Failed to fetch dynamically imported module') || // Chromium
    message.includes('error loading dynamically imported module') || // Firefox
    message.includes('Importing a module script failed') // Safari
  );
}

function chunkReloadAlreadyAttempted(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG) !== null;
  } catch {
    // Storage unavailable (private mode, etc.): treat as already tried so we
    // fall through to a stable error state instead of risking a reload loop.
    return true;
  }
}

export function clearChunkReloadAttempt(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    // No-op when storage is unavailable.
  }
}

// Claims the single session-capped reload attempt: true exactly once per
// session (until a successful mount clears the flag), false when the attempt
// was already spent or storage is unavailable.
function markChunkReloadAttempt(): boolean {
  if (chunkReloadAlreadyAttempted()) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  } catch {
    return false;
  }
  return true;
}

export function shouldReloadForChunkLoadError(err: unknown): boolean {
  return isChunkLoadError(err) && markChunkReloadAttempt();
}

// True from the moment this page commits to a stale-chunk reload until the
// page unloads. Vite's import() resolves to undefined once the global handler
// below prevents the preload error, so every caller that destructures the
// module (`const { mountLanding } = await import(...)`) throws a TypeError in
// the gap before the reload lands. Those throws are a side effect of the
// recovery, not a defect: callers and error tracking check this and stay quiet.
let reloadPending = false;

export function chunkReloadPending(): boolean {
  return reloadPending;
}

export function reloadForChunkLoadError(err: unknown): boolean {
  if (!shouldReloadForChunkLoadError(err)) return false;
  reloadPending = true;
  location.reload();
  return true;
}

// Global stale-chunk recovery for lazy loads that happen AFTER bootstrap (the
// /watch page swapping games in a long-lived tab across a deploy, for example),
// where no per-mount guard wraps the dynamic import. Vite emits
// `vite:preloadError` on window whenever a dynamic-import chunk or one of its
// preloaded deps fails to load, so the event itself is the stale-chunk signal;
// no message sniffing is needed (CSS preload failures carry a message
// isChunkLoadError would not match). Shares the per-mount guards' one-shot
// session cap, so the two layers can never combine into a reload loop. Once the
// one-shot is spent the event is left alone and Vite rethrows to the import()
// caller (e.g. mountOrReport's error panel). While the one-shot is in flight,
// import() resolves to undefined (see chunkReloadPending). Returns an uninstaller (for tests;
// the app installs once for the page lifetime).
export function installGlobalChunkLoadRecovery(
  reload: () => void = () => location.reload(),
): () => void {
  const onPreloadError = (event: Event): void => {
    if (!markChunkReloadAttempt()) return;
    reloadPending = true;
    event.preventDefault();
    reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    reloadPending = false;
  };
}
