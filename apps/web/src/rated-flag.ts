// Client mirror of the server's rated on-switch (MISTBOARD_RATED_ENABLED),
// fetched via /api/server-status. Lives in its own tiny module so main.ts can
// set it without eagerly importing the large landing chunk (preserving the
// code-split). Defaults off: the rated toggle stays "coming soon" until the
// server confirms rated is live.

let ratedModeEnabled = false;
// Rated CORRESPONDENCE (server MISTBOARD_CORRESPONDENCE_RATED_ENABLED, off by default:
// held until integrity tooling exists). Off hides every correspondence Casual/Rated
// control and every correspondence rating; live rated play reads only the flag above.
let correspondenceRatedModeEnabled = false;
const listeners = new Set<() => void>();

export function setRatedModeEnabled(value: boolean, correspondence = false): void {
  const changed = value !== ratedModeEnabled || correspondence !== correspondenceRatedModeEnabled;
  ratedModeEnabled = value;
  correspondenceRatedModeEnabled = correspondence;
  if (changed) for (const listener of listeners) listener();
}

export function isCorrespondenceRatedModeEnabled(): boolean {
  return ratedModeEnabled && correspondenceRatedModeEnabled;
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
