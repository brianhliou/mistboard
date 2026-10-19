// Shared recovery for stale Vite chunks. A tab can keep an older entry bundle
// across a deploy, then discover that a lazily imported hashed chunk no longer
// exists. Reload once to fetch the current entry bundle and its chunk map; cap
// the attempt in sessionStorage so a genuinely missing asset cannot reload-loop.
const CHUNK_RELOAD_FLAG = 'mistboard.chunkReloadAttempted';
let reloadStorageBlocked = false;

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Failed to fetch dynamically imported module') || // Chromium
    message.includes('error loading dynamically imported module') || // Firefox
    message.includes('Importing a module script failed') || // Safari
    message.includes('Unable to preload CSS for ') // Vite stylesheet dependency
  );
}

function chunkReloadState(): 'not_attempted' | 'already_attempted' | 'storage_unavailable' {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG) !== null
      ? 'already_attempted'
      : 'not_attempted';
  } catch {
    // Storage unavailable (private mode, etc.): treat as already tried so we
    // fall through to a stable error state instead of risking a reload loop.
    return 'storage_unavailable';
  }
}

export function clearChunkReloadAttempt(): void {
  // A concurrent successful mount must not re-arm recovery before an already
  // requested reload actually leaves this document.
  if (reloadPending) return;
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    reloadStorageBlocked = false;
  } catch {
    // No-op when storage is unavailable.
  }
}

// Claims the single session-capped reload attempt: true exactly once per
// session (until a successful mount clears the flag), false when the attempt
// was already spent or storage is unavailable.
function markChunkReloadAttempt(): boolean {
  if (reloadPending || chunkReloadState() !== 'not_attempted') return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
    reloadStorageBlocked = false;
  } catch {
    reloadStorageBlocked = true;
    return false;
  }
  return true;
}

export function shouldReloadForChunkLoadError(err: unknown): boolean {
  return isChunkLoadError(err) && markChunkReloadAttempt();
}

// Only unrecovered failures reach reporting. These fields distinguish blocked
// storage from an exhausted retry without guessing from browser identity or
// dropping possible player errors. Never include an asset's query or fragment.
export function chunkLoadFailureContext(
  err: unknown,
): Record<string, string | number | boolean | null> {
  if (!isChunkLoadError(err)) return {};
  const message = err instanceof Error ? err.message : String(err);
  const asset = message.match(/https?:\/\/[^\s]+|\/assets\/[^\s]+/)?.[0];
  let assetPath: string | null = null;
  if (asset) {
    try {
      assetPath = new URL(asset, location.href).pathname;
    } catch {
      // Browser messages without a valid URL still carry the recovery state.
    }
  }
  return {
    asset_path: assetPath,
    asset_reload_state: reloadStorageBlocked ? 'storage_unavailable' : chunkReloadState(),
    asset_browser_online: navigator.onLine,
    asset_document_age_ms: Math.round(performance.now()),
    asset_document_visibility: document.visibilityState,
  };
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
// no message sniffing is needed. Shares the per-mount guards' one-shot
// session cap, so the two layers can never combine into a reload loop. Once the
// one-shot is spent the event is left alone and Vite rethrows to the import()
// caller (e.g. mountOrReport's error panel). While the one-shot is in flight,
// import() resolves to undefined (see chunkReloadPending). Returns an uninstaller (for tests;
// the app installs once for the page lifetime).
export function installGlobalChunkLoadRecovery(
  reload: () => void = () => location.reload(),
): () => void {
  const onPreloadError = (event: Event): void => {
    if (reloadPending) {
      event.preventDefault();
      return;
    }
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
