import { jieqiLuckEnabled } from './feature-flags.js';

export type JieqiLuckViewer = { id: string } | null;

/** The viewer policy seam for a later allowlist or entitlement check. */
export function jieqiLuckAllowed(_viewer: JieqiLuckViewer): boolean {
  return jieqiLuckEnabled();
}

/** Project at the read boundary, including cached results. Never mutate stored data. */
export function jieqiDecisionsForViewer<T extends { realizedWin?: number }>(
  decisions: readonly T[],
  viewer: JieqiLuckViewer,
): (Omit<T, 'realizedWin'> & { realizedWin?: number })[] {
  return jieqiLuckAllowed(viewer)
    ? [...decisions]
    : decisions.map(({ realizedWin: _luck, ...grade }) => grade);
}
