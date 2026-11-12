// Change notice for the runtime bot rosters (Three Kingdoms Banqi, FFQ banqi,
// Flip Jungle's neural tier) that /api/engines/playable fills in after a page
// has painted. Whatever rendered from the old roster (the Play dialog's variant
// grid, the hero panel's bot rows) subscribes and re-reads it, so a roster that
// lands late never leaves a variant greyed out until something else re-renders.

type RosterListener = () => void;

const listeners = new Set<RosterListener>();

/** Calls `listener` after any runtime roster changes; returns the unsubscribe. */
export function onRuntimeEngineRostersChanged(listener: RosterListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyRuntimeEngineRostersChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Whether two rosters offer the same engines in the same order; setters skip
 *  the notice when a refetch returns what is already there. */
export function sameRuntimeRoster(
  a: readonly { id: string }[],
  b: readonly { id: string }[],
): boolean {
  return a.length === b.length && a.every((engine, i) => engine.id === b[i]?.id);
}
