// A LIVE room's per-ply history from the server, for tenants whose clients
// cannot rebuild a live game from their own event log: a fog seat never sees
// the opponent's moves, a flip variant's deal is a server secret. The server
// sends the viewer's own per-ply views in its hello (`liveHistory`, built by
// the same per-client view builder that served each ply live; see
// tenantLiveHistoryExtras on the server). This validates that list against the
// live view and installs it as sent, deriving nothing.

import type { TenantReplaySnapshot } from './replay-controller.js';

type ViewLike = { status: { type: string }; board?: unknown; perspective?: unknown };

/**
 * The history from a hello frame, or null to keep the captured one. Accepted
 * only when it is exactly what this viewer should hold: the room is playing,
 * plies run 0, 1, 2, ... with no gap, every view shares the live view's
 * perspective and has a board, and the last ply is the live view's ply (a
 * stale or mismatched list is dropped, never partially used). Frames without
 * it (every broadcast snapshot) return null.
 */
export function adoptLiveHistory<V extends ViewLike>(
  liveHistory: unknown,
  view: V,
  livePly: number,
): TenantReplaySnapshot<V>[] | null {
  if (view.status.type !== 'playing') return null;
  if (!Array.isArray(liveHistory) || liveHistory.length === 0) return null;
  const snapshots: TenantReplaySnapshot<V>[] = [];
  for (const [index, entry] of liveHistory.entries()) {
    if (!entry || typeof entry !== 'object') return null;
    const { ply, view: plyView } = entry as { ply?: unknown; view?: unknown };
    if (ply !== index) return null;
    if (!plyView || typeof plyView !== 'object') return null;
    const candidate = plyView as V;
    if (candidate.perspective !== view.perspective) return null;
    if (!candidate.board || typeof candidate.board !== 'object') return null;
    snapshots.push({ ply: index, view: candidate });
  }
  if (snapshots.length - 1 !== livePly) return null;
  return snapshots;
}
