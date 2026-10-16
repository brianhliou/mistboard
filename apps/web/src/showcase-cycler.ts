// The homepage showcase viewer: one board that cycles through the latest finished
// games across variants from a rolling pool. It owns cross-game advancement (the
// chess replay engine used to own it via loopSamples) so it can cross renderer
// kinds — same kind loads the next game in place, a different kind (e.g. chess ->
// jieqi) tears down and re-mounts. The pool is refreshed live (drop oldest /
// ingest newest); the current game finishes before the swap unless jumpNow cuts
// it short.

import type { GameEvent } from '@mistboard/game';
import { reloadForChunkLoadError } from './chunk-load-recovery.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { renderWatchReplayFailure, renderWatchReplaySkeleton } from './replay-skeleton.js';
import { mountShowcaseBoard } from './showcase-board.js';
import { nextShowcaseIndex, showcaseRendererKindForSpec } from './showcase-dispatch.js';

export type ShowcaseEntry = {
  roomId: string;
  specId: string;
  pov: 'white' | 'black';
  // When the game finished (ISO, from the showcase API). Absent for the bundled
  // cold-start demos, which have no real finish time. Pool ORDER cannot stand in
  // for this: the server pool is variety-interleaved across variants, not sorted
  // by recency, so anything that needs "the newest game" has to compare this.
  endedAt?: string;
  // When the game started (ISO, from the showcase API). With endedAt it sizes a
  // delayed air: the game airs from its end for as long as it lasted.
  startedAt?: string;
  // Server-set (/api/games/showcase, airsOnDelay): true only for a variant that can
  // never be shown live (fog), which the homepage TV airs after the fact. Absent
  // means NOT airable: the entry only ever shows as a frozen final position.
  delayedAir?: boolean;
};

// The air fields of a showcase API game, for an entry built from it.
export function showcaseAirFields(game: {
  startedAt?: string;
  delayedAir?: boolean;
}): Pick<ShowcaseEntry, 'startedAt' | 'delayedAir'> {
  return {
    ...(game.startedAt ? { startedAt: game.startedAt } : {}),
    ...(game.delayedAir === true ? { delayedAir: true } : {}),
  };
}

export type ShowcaseCyclerOptions = {
  metadataByRoomId: Record<string, GameMeta>;
  // Player names for tenant compact seats (first = red, second = black), by room id.
  namesByRoomId: Record<string, { first: string; second: string }>;
  loaderForId: (roomId: string) => Promise<GameEvent[]>;
  // Fired when the viewer commits to showing a game (before its moves load), so the
  // caller can update out-of-board chrome (e.g. the "recent · 2h ago" caption).
  onGameChange?: (roomId: string) => void;
};

export type ShowcaseCyclerHandle = {
  // Swap the rolling pool. By default the current game finishes and the next pick
  // comes from the new pool; { jumpNow: true } cuts the current game short.
  updatePool: (next: ShowcaseEntry[], options?: { jumpNow?: boolean }) => void;
  destroy: () => void;
};

export async function mountShowcaseCycler(
  root: HTMLElement,
  initialPool: ShowcaseEntry[],
  options: ShowcaseCyclerOptions,
): Promise<ShowcaseCyclerHandle> {
  let pool = initialPool.slice();
  let destroyed = false;
  let handle: ReplayHandle | null = null;
  let handleKind: string | null = null;
  let currentRoomId: string | null = null;
  // Skip a failed game for the current pass through the pool. A successful load
  // clears the set so a transient failure can be retried on a later cycle without
  // immediately hammering the same broken entry.
  const failedRoomIds = new Set<string>();
  // Serializes mounts: a re-mount is async, and both onGameEnd and a jumpNow pool
  // swap can call advance(); the guard drops overlapping requests.
  let mounting = false;

  const nextEntry = (): ShowcaseEntry | null => {
    if (pool.length === 0) return null;
    const idx = currentRoomId ? pool.findIndex((entry) => entry.roomId === currentRoomId) : -1;
    for (let offset = 0; offset < pool.length; offset += 1) {
      const candidate = pool[nextShowcaseIndex(pool.length, idx + offset)];
      if (candidate && !failedRoomIds.has(candidate.roomId)) return candidate;
    }
    return null;
  };

  const advanceAfterFailure = (entry: ShowcaseEntry): void => {
    failedRoomIds.add(entry.roomId);
    currentRoomId = entry.roomId;
    const next = nextEntry();
    if (next) {
      void advance(next);
      return;
    }
    handle?.destroy();
    handle = null;
    handleKind = null;
    renderWatchReplayFailure(root);
  };

  const onGameEnd = (): void => {
    if (destroyed) return;
    void advance(nextEntry());
  };

  // Warm the next pick's move data while the current game plays, so a same-kind
  // advance is instant. Only possible when the next game shares the mounted
  // renderer (a cross-kind advance re-mounts a different renderer, so there's
  // nothing to prefetch into). Best-effort; loadGame re-fetches on a miss.
  const prefetchNext = (): void => {
    if (destroyed || !handle?.prefetchGame) return;
    const next = nextEntry();
    if (!next || next.roomId === currentRoomId) return;
    if (showcaseRendererKindForSpec(next.specId) !== handleKind) return;
    handle.prefetchGame(next.roomId);
  };

  async function advance(entry: ShowcaseEntry | null): Promise<void> {
    if (destroyed || mounting || !entry) return;
    const kind = showcaseRendererKindForSpec(entry.specId);
    options.onGameChange?.(entry.roomId);

    // Same renderer kind: keep the mounted handle, just load the next game.
    if (handle && handleKind === kind) {
      currentRoomId = entry.roomId;
      try {
        await handle.loadGame(entry.roomId);
        failedRoomIds.clear();
        prefetchNext();
      } catch (err) {
        console.warn('[showcase] loadGame failed, skipping', entry.roomId, err);
        if (reloadForChunkLoadError(err)) return;
        advanceAfterFailure(entry);
      }
      return;
    }

    // Different kind: tear down and re-mount. Skeleton fills the gap so the slot
    // doesn't flash blank while the new renderer (and its chunk) loads — but only
    // when replacing an existing board; the initial mount paints into the already
    // rendered shell without a "Loading game" flash. Pin the panel's height across
    // the swap: the widget is fit-content, so without the pin it collapses to the
    // skeleton's height and the page jumps twice per cross-variant advance.
    mounting = true;
    const hadHandle = handle !== null;
    const priorHeight = hadHandle ? root.offsetHeight : 0;
    handle?.destroy();
    handle = null;
    handleKind = null;
    if (hadHandle) {
      if (priorHeight > 0) root.style.minHeight = `${priorHeight}px`;
      renderWatchReplaySkeleton(root);
    }
    try {
      const next = await mountShowcaseBoard(root, entry.specId, entry.roomId, {
        metadataByRoomId: options.metadataByRoomId,
        namesByRoomId: options.namesByRoomId,
        onGameEnd,
        pov: entry.pov,
        loaderForId: options.loaderForId,
      });
      if (destroyed) {
        next.destroy();
        return;
      }
      handle = next;
      handleKind = kind;
      currentRoomId = entry.roomId;
      failedRoomIds.clear();
      prefetchNext();
    } catch (err) {
      console.warn('[showcase] mount failed, skipping', entry.roomId, err);
      root.style.minHeight = '';
      mounting = false;
      if (reloadForChunkLoadError(err)) return;
      advanceAfterFailure(entry);
      return;
    }
    root.style.minHeight = '';
    mounting = false;
  }

  await advance(pool[0] ?? null);

  return {
    updatePool: (next, opts) => {
      if (destroyed) return;
      pool = next.slice();
      failedRoomIds.clear();
      if (opts?.jumpNow) void advance(pool[0] ?? nextEntry());
    },
    destroy: () => {
      destroyed = true;
      handle?.destroy();
      handle = null;
    },
  };
}
