// The production drain a release takes, as decisions the release script acts
// on. Pure functions only, so the tests can walk every path without a server.

// A release that held new games for longer than this is worth a look: players
// who tried to start a game saw "server restarting" instead. Brian, 2026-10-16:
// deploys must not leave people unable to start games for 10 to 15 minutes.
export const HELD_WARN_MS = 5 * 60 * 1000;

/**
 * What to do with this release's drain once the release has failed.
 *
 * A drain that committed ("Server restarting now") stays up until the server
 * restarts, the drain is cancelled, or its window lapses. Before the push no
 * restart is coming, so it must be cancelled. After the push the restart comes
 * only if the deploy lands; a release that failed waiting for it (hosted CI
 * red, or the revision wait gave up) left the banner up for the rest of the
 * window (2026-10-16 21:46Z, 11 minutes). Cancel it then too, unless prod
 * already serves the revision we pushed, in which case the restart happened
 * and the new server holds no drain.
 *
 * @param {{ drainCommitted: boolean, pushCompleted: boolean,
 *   productionRevision?: string | null, expectedRevision?: string | null }} state
 * @returns {'none' | 'cancel-before-push' | 'none-deployed' | 'cancel-after-push'}
 */
export function postFailureDrainAction(state) {
  if (!state.drainCommitted) return 'none';
  if (!state.pushCompleted) return 'cancel-before-push';
  if (
    state.productionRevision &&
    state.expectedRevision &&
    revisionsMatch(state.productionRevision, state.expectedRevision)
  ) {
    return 'none-deployed';
  }
  return 'cancel-after-push';
}

function revisionsMatch(a, b) {
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * How long new games were held by a release, from what its drain reported.
 * The server's commitWaitMs is the time creates were refused (pending phase);
 * without it, the drain stage's wall time is the bound. No drain, no hold.
 *
 * @param {{ drainStageMs?: number | null, commitWaitMs?: number | null,
 *   refusedCreates?: number | null }} input
 * @returns {{ heldMs: number, refusedCreates: number | null }}
 */
export function heldSummary(input) {
  const commitWait = finiteOrNull(input.commitWaitMs);
  const stage = finiteOrNull(input.drainStageMs);
  return {
    heldMs: commitWait ?? stage ?? 0,
    refusedCreates: finiteOrNull(input.refusedCreates),
  };
}

/** The one line a release prints about its hold, plus a warning when long. */
export function formatHeldLines({ heldMs, refusedCreates }) {
  const minutes = (heldMs / 60_000).toFixed(1);
  const refused = refusedCreates === null || refusedCreates === undefined ? '?' : refusedCreates;
  const lines = [`new games held ${minutes} min, ${refused} refused`];
  if (heldMs > HELD_WARN_MS) {
    lines.push(
      `WARN: new games were held over ${HELD_WARN_MS / 60_000} min; players could not start games for that long`,
    );
  }
  return lines;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
