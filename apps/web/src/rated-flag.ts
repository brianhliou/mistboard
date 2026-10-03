// Client mirror of the server's rated on-switch (MISTBOARD_RATED_ENABLED),
// fetched via /api/server-status. Lives in its own tiny module so main.ts can
// set it without eagerly importing the large landing chunk (preserving the
// code-split). Defaults off: the rated toggle stays "coming soon" until the
// server confirms rated is live.

let ratedModeEnabled = false;
const listeners = new Set<() => void>();

export function setRatedModeEnabled(value: boolean): void {
  const changed = value !== ratedModeEnabled;
  ratedModeEnabled = value;
  if (changed) for (const listener of listeners) listener();
}

// For a control rendered before /api/server-status answers (the correspondence
// Start a game form): re-sync when the switch lands. Returns an unsubscribe.
export function onRatedModeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isRatedModeEnabled(): boolean {
  return ratedModeEnabled;
}
