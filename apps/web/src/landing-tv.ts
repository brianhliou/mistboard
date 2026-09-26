// Homepage Mistboard TV controller: a CHANNEL that keeps running while nobody
// is looking.
//
// The channel model (Brian, 2026-09-26). On every sync (boot, each live poll,
// the tab becoming visible, a pool update, an air reaching its end) the board
// asks "what is on now?":
//
//   1. A featured LIVE game: follow it live (moves arrive via a short poll of
//      /api/watch/live). When it leaves the feed, freeze on its final position.
//   2. Else a DELAYED AIR that is on now: show it, joined at the ply it is on
//      now. Only a variant that can never be shown live airs (fog; the server's
//      canServeLiveBoard is false, carried to the client as
//      ShowcaseEntry.delayedAir, and a missing field means NOT airable). A game's
//      air starts when it ended and lasts as long as the game did, played at
//      the recorded timing, so a fog game that ended three minutes before the
//      visitor arrived is three minutes into its air. An air already on the
//      board keeps it until its window closes; otherwise the newest-ended game
//      whose window contains now goes on.
//   3. Else FREEZE on the most recently finished game's final position.
//
// A live-capable variant (xiangqi, jieqi, banqi, ...) is NEVER aired after the
// fact: it had its turn on the live board, and one that finished while the tab
// was hidden simply appears frozen. An air's playback is anchored to the wall
// clock inside the renderer (ply shown = f(now - air start)), so a hidden tab
// that comes back shows the right ply, or the right later state, and never a
// stalled mid-air. Fog games can never appear live: the server's visibility
// policy is fail-closed.

import type { GameEvent } from '@mistboard/game';
import { reloadForChunkLoadError } from './chunk-load-recovery.js';
import { displayLiveName } from './game-display.js';
import { t } from './i18n/catalog.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { renderWatchReplayFailure } from './replay-skeleton.js';
import { mountShowcaseBoard } from './showcase-board.js';
import type { ShowcaseEntry } from './showcase-cycler.js';
import { showcaseRendererKindForSpec } from './showcase-dispatch.js';

const LIVE_POLL_MS = 4_000;

// A delayed air: `entry` goes on at `startMs` (when it ended) and stays on until
// `endMs` (as long again as the game lasted).
export type AirWindow = { entry: ShowcaseEntry; startMs: number; endMs: number };

function timestampMs(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// The air window of a pool entry, or null when it may not air: not flagged
// airable by the server (fail closed), or missing/inconsistent timestamps.
export function airWindowFor(entry: ShowcaseEntry): AirWindow | null {
  if (entry.delayedAir !== true) return null;
  const endedAt = timestampMs(entry.endedAt);
  const startedAt = timestampMs(entry.startedAt);
  if (!Number.isFinite(endedAt) || !Number.isFinite(startedAt) || startedAt > endedAt) {
    return null;
  }
  return { entry, startMs: endedAt, endMs: endedAt + (endedAt - startedAt) };
}

export type LandingTvMode = 'live' | 'replay' | 'frozen';

type LiveFeatured = {
  roomId: string;
  gameSpecId: string;
  ply: number;
  players?: Array<{ color: string; name: string | null; isEngine: boolean }>;
  payload?: Record<string, unknown>;
};

export type LandingTvOptions = {
  metadataByRoomId: Record<string, GameMeta>;
  namesByRoomId: Record<string, { first: string; second: string }>;
  loaderForId: (roomId: string) => Promise<GameEvent[]>;
  // Fired when the board commits to a game/mode, so the caller can update the
  // out-of-board caption ("Xiangqi · live" / "recent · 2h ago").
  onGameChange?: (info: { roomId: string; specId: string; mode: LandingTvMode }) => void;
  // Polling stops for good once this reports false (landing unmounted).
  isConnected: () => boolean;
  // Which /api/watch/live channel to follow. The homepage follows 'top' (the
  // cross-channel election); the TV embed can pin one variant's channel.
  channel?: string;
};

export type LandingTvController = {
  // The completed-games showcase pool. It is a breadth interleave across
  // variants, NOT recency order, so "the newest" always compares endedAt, never
  // pool position. Every update re-asks what is on now (see the header).
  // `jumpNow` marks a BASELINE refresh (the first real pool replacing the static
  // fallback): whatever the fallback put on the board gives way. A live game is
  // never cut by pool updates.
  updateCompletedPool(entries: ShowcaseEntry[], opts?: { jumpNow?: boolean }): void;
  destroy(): void;
};

export async function mountLandingTv(
  root: HTMLElement,
  initialPool: ShowcaseEntry[],
  options: LandingTvOptions,
): Promise<LandingTvController> {
  let destroyed = false;
  let handle: ReplayHandle | null = null;
  let handleKind: string | null = null;
  // Whether the mounted handle was created live / autoplaying — a handle is
  // only reused across games when both match (the flags are baked at mount).
  let handleLive = false;
  let handleAutoplay = false;
  let mode: LandingTvMode | null = null;
  let currentRoomId: string | null = null;
  let currentSpecId: string | null = null;
  let completedPool = initialPool.slice();
  // The delayed air on the board (mode 'replay'), kept until its window closes.
  let airing: AirWindow | null = null;
  // When the frozen game on the board finished, so a pool update only replaces it
  // with a NEWER finished game (a live game that just ended is not in the pool yet).
  let shownFinishedAtMs = Number.NEGATIVE_INFINITY;
  // Airs whose game failed to load: skipped for the rest of the session so a broken
  // payload cannot re-mount every poll.
  const failedAirRoomIds = new Set<string>();
  // Latest live payload per featured room; the loadPostgameOverride below reads
  // it, and clearing it makes the override fall back to the real finished-game
  // endpoint (the live→finished handoff).
  let livePayload: { roomId: string; payload: Record<string, unknown> } | null = null;
  let shownLivePly = -1;
  // Set by the live handle's onLoadError. Only the live->frozen handoff can
  // trip it: while following, loadPostgameOverride always answers.
  let liveLoadFailed = false;
  let pollTimer: number | null = null;

  // Serializes every mount/load: poll ticks, pool swaps, and onGameEnd all
  // funnel through here so re-mounts can't interleave.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): void => {
    chain = chain
      .then(() => (destroyed ? undefined : task()))
      .catch((err) => {
        console.warn('[landing-tv] step failed', err);
        reloadForChunkLoadError(err);
      });
  };

  const notify = (roomId: string, specId: string, nextMode: LandingTvMode): void => {
    mode = nextMode;
    currentRoomId = roomId;
    currentSpecId = specId;
    options.onGameChange?.({ mode: nextMode, roomId, specId });
  };

  const loadPostgameOverride = async (
    roomId: string,
  ): Promise<{ ok: true; postgame: unknown } | { ok: false }> => {
    if (livePayload && livePayload.roomId === roomId) {
      return { ok: true, postgame: livePayload.payload };
    }
    return { ok: false };
  };

  const destroyHandle = (): void => {
    handle?.destroy();
    handle = null;
    handleKind = null;
  };

  // Mount (or re-mount) the board for a game. Same renderer kind reloads in
  // place; a different kind tears down and re-mounts, pinning the panel height
  // so the page doesn't jump across the swap (cycler behavior, kept).
  const mountGame = async (
    entry: { roomId: string; specId: string; pov: 'white' | 'black' },
    mountOptions: {
      autoplay: boolean;
      live: boolean;
      onGameEnd?: () => void;
      airStartMs?: number;
      onLoadError?: () => boolean;
    },
  ): Promise<void> => {
    const kind = showcaseRendererKindForSpec(entry.specId);
    // Reuse the mounted handle only when its baked flags match; live and
    // autoplay are mount-time options, so a mismatch needs a fresh mount.
    if (
      handle &&
      handleKind === kind &&
      handleLive === mountOptions.live &&
      handleAutoplay === mountOptions.autoplay &&
      !mountOptions.live &&
      !mountOptions.onGameEnd
    ) {
      await handle.loadGame(entry.roomId);
      return;
    }
    const priorHeight = handle ? root.offsetHeight : 0;
    destroyHandle();
    if (priorHeight > 0) root.style.minHeight = `${priorHeight}px`;
    try {
      const next = await mountShowcaseBoard(root, entry.specId, entry.roomId, {
        metadataByRoomId: options.metadataByRoomId,
        namesByRoomId: options.namesByRoomId,
        loaderForId: options.loaderForId,
        pov: entry.pov,
        autoplay: mountOptions.autoplay,
        ...(mountOptions.onGameEnd ? { onGameEnd: mountOptions.onGameEnd } : {}),
        ...(mountOptions.airStartMs !== undefined ? { airStartMs: mountOptions.airStartMs } : {}),
        ...(mountOptions.onLoadError ? { onLoadError: mountOptions.onLoadError } : {}),
        // The live handle keeps its last frame on any load failure rather than
        // wiping to an error: normal following never sees one (the override
        // always answers), and the live→frozen handoff drives its finished-game
        // load through THIS handle, so an idle/unpersisted game freezes in place.
        ...(mountOptions.live
          ? {
              live: true,
              loadPostgameOverride,
              onLoadError: () => {
                liveLoadFailed = true;
                return true;
              },
            }
          : {}),
      });
      if (destroyed) {
        next.destroy();
        return;
      }
      handle = next;
      handleKind = kind;
      handleLive = mountOptions.live;
      handleAutoplay = mountOptions.autoplay;
    } finally {
      root.style.minHeight = '';
    }
  };

  const jumpToEnd = (glideFrom?: number): void => {
    if (!handle?.jumpToPly || !handle.plyCount) return;
    const end = handle.plyCount();
    if (glideFrom !== undefined && end - glideFrom === 1 && end > 0) {
      // One new move: paint the previous position, then step so the piece glides.
      handle.jumpToPly(end - 1);
    }
    handle.jumpToPly(end);
  };

  // First/second seat names from the featured players (red is the first mover
  // for every live-capable tenant today; fall back to seat order). A null name is
  // a guest seat (live frames carry no privacy redaction), so it reads "Guest",
  // matching what the finished record will say.
  const registerLiveNames = (featured: LiveFeatured): void => {
    const players = featured.players ?? [];
    if (players.length < 2 || options.namesByRoomId[featured.roomId]) return;
    const first = players.find((player) => player.color === 'red') ?? players[0]!;
    const second = players.find((player) => player !== first)!;
    options.namesByRoomId[featured.roomId] = {
      first: displayLiveName(first.name, t('watch.guest')),
      second: displayLiveName(second.name, t('watch.guest')),
    };
  };

  const showLive = async (featured: LiveFeatured): Promise<void> => {
    if (featured.payload) {
      livePayload = { payload: featured.payload, roomId: featured.roomId };
    }
    registerLiveNames(featured);
    const following = mode === 'live' && currentRoomId === featured.roomId;
    if (!following) {
      if (!featured.payload) return; // need a payload to mount; next poll carries one
      await mountGame(
        { pov: 'white', roomId: featured.roomId, specId: featured.gameSpecId },
        { autoplay: false, live: true },
      );
      airing = null;
      jumpToEnd();
      shownLivePly = featured.ply;
      notify(featured.roomId, featured.gameSpecId, 'live');
      return;
    }
    if (featured.ply > shownLivePly && featured.payload && handle) {
      const from = shownLivePly === featured.ply - 1 ? (handle.plyCount?.() ?? 0) : undefined;
      await handle.loadGame(featured.roomId);
      jumpToEnd(from);
      shownLivePly = featured.ply;
    }
  };

  // The live game left the feed (finished, went idle past the fresh window, or
  // the server restarted). Try to upgrade the live board to the real finished
  // replay by reloading through the SAME live handle: clearing livePayload makes
  // its override answer {ok:false}, so the load falls through to the finished-game
  // endpoint. That endpoint 404s whenever the game isn't retrievable as finished
  // yet (idle-but-still-playing, unpersisted, or gone after a restart); the live
  // handle's onLoadError then keeps the last frame instead of wiping the board to
  // "This game could not be loaded." Re-mounting a fresh finished handle (the old
  // approach) could not do this: destroy() clears root before the failing load
  // runs, so a 404 left an empty error box.
  //
  // A failed load means the game never became a retrievable finished game, so
  // its last live frame is a dead position and the hero hands back to the pool.
  // Keeping that frame is only right when there is no completed game to fall
  // back to.
  const finishLiveHandoff = async (): Promise<void> => {
    const roomId = currentRoomId;
    const specId = currentSpecId;
    if (!roomId || !specId) return;
    livePayload = null;
    if (!handle) {
      // No live handle to reuse (shouldn't happen while mode === 'live'): fall
      // back to the pool rather than leaving a blank board. syncChannel notifies
      // for the game it actually mounts.
      mode = 'frozen';
      await syncChannel({ rebaseline: true });
      return;
    }
    liveLoadFailed = false;
    await handle.loadGame(roomId);
    if (liveLoadFailed && completedPool.length > 0) {
      mode = 'frozen';
      await syncChannel({ rebaseline: true });
      return;
    }
    jumpToEnd();
    // It just ended, so nothing in the pool is newer; the next poll's sync decides
    // whether an air goes on instead.
    shownFinishedAtMs = Date.now();
    notify(roomId, specId, 'frozen');
  };

  // When a pool entry finished; entries without endedAt (bundled demos) sort last.
  const finishedAtMs = (entry: ShowcaseEntry): number => {
    const parsed = timestampMs(entry.endedAt);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  // The most recently finished game in the pool (pool head on a tie, which is
  // also what an all-demo pool with no finish times falls back to).
  const newestFinished = (): ShowcaseEntry | null => {
    let best: ShowcaseEntry | null = null;
    for (const entry of completedPool) {
      if (!best || finishedAtMs(entry) > finishedAtMs(best)) best = entry;
    }
    return best;
  };

  // The delayed air that is on now: the one on the board while its window is open,
  // else the newest-ended airable game whose window contains `now`.
  const onAirNow = (now: number): AirWindow | null => {
    if (airing && mode === 'replay' && airing.startMs <= now && now < airing.endMs) {
      return airing;
    }
    let best: AirWindow | null = null;
    for (const entry of completedPool) {
      if (failedAirRoomIds.has(entry.roomId)) continue;
      const window = airWindowFor(entry);
      if (!window || now < window.startMs || now >= window.endMs) continue;
      if (!best || window.startMs > best.startMs) best = window;
    }
    return best;
  };

  // Put an air on the board, joined at the ply it is on now (the renderer derives
  // the ply from airStartMs and the wall clock, and keeps doing so every tick).
  const showAir = async (air: AirWindow): Promise<void> => {
    const target = air.entry;
    let loadFailed = false;
    try {
      await mountGame(target, {
        autoplay: true,
        live: false,
        airStartMs: air.startMs,
        onGameEnd: () => {
          // Every move is out; the board holds the final position (result marks)
          // until the window closes and a sync moves on.
          if (!destroyed) enqueue(() => syncChannel());
        },
        onLoadError: () => {
          loadFailed = true;
          return false;
        },
      });
    } catch (err) {
      console.warn('[landing-tv] air failed to load', target.roomId, err);
      reloadForChunkLoadError(err);
      loadFailed = true;
    }
    if (loadFailed) {
      failedAirRoomIds.add(target.roomId);
      airing = null;
      mode = null;
      await freezeOnNewest(true);
      return;
    }
    airing = air;
    notify(target.roomId, target.specId, 'replay');
  };

  // Freeze on the most recently finished game's final position. A frozen board
  // keeps its game unless the pool holds a newer one (or `rebaseline` says the
  // board is showing a fallback that must give way).
  const freezeOnNewest = async (rebaseline = false): Promise<void> => {
    const target = newestFinished();
    if (!target) return;
    if (mode === 'replay' && currentRoomId === target.roomId) {
      // The air that just closed is the newest game: settle on its final position
      // in place (the renderer stops playing and parks on the last ply).
      airing = null;
      jumpToEnd();
      shownFinishedAtMs = finishedAtMs(target);
      notify(target.roomId, target.specId, 'frozen');
      return;
    }
    if (mode === 'frozen' && currentRoomId === target.roomId) return;
    if (
      !rebaseline &&
      mode === 'frozen' &&
      currentRoomId !== null &&
      shownFinishedAtMs >= finishedAtMs(target)
    ) {
      return;
    }
    airing = null;
    await mountGame(target, { autoplay: false, live: false });
    jumpToEnd();
    shownFinishedAtMs = finishedAtMs(target);
    notify(target.roomId, target.specId, 'frozen');
  };

  // "What is on now?" for everything but the live game, which the poll decides.
  const syncChannel = async (opts: { rebaseline?: boolean } = {}): Promise<void> => {
    if (destroyed || mode === 'live') return;
    const air = onAirNow(Date.now());
    if (air) {
      // Already airing it: the renderer is wall-anchored, nothing to re-mount.
      if (mode === 'replay' && currentRoomId === air.entry.roomId) return;
      await showAir(air);
      return;
    }
    await freezeOnNewest(opts.rebaseline === true);
  };

  const stopPolling = (): void => {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const schedulePoll = (): void => {
    if (destroyed) return;
    pollTimer = window.setTimeout(() => void pollLive(), LIVE_POLL_MS);
  };

  const pollLive = async (): Promise<void> => {
    if (destroyed) return;
    if (!options.isConnected()) {
      stopPolling();
      return;
    }
    if (document.visibilityState === 'hidden') {
      schedulePoll();
      return;
    }
    try {
      const following = mode === 'live' && currentRoomId !== null;
      const channel = encodeURIComponent(options.channel ?? 'top');
      const query = following
        ? `?channel=${channel}&room=${encodeURIComponent(currentRoomId!)}&ply=${shownLivePly}`
        : `?channel=${channel}`;
      const resp = await fetch(`/api/watch/live${query}`);
      if (resp.ok) {
        const data = (await resp.json()) as { featured: LiveFeatured | null };
        if (data.featured) {
          const featured = data.featured;
          enqueue(() => showLive(featured));
        } else if (mode === 'live') {
          enqueue(finishLiveHandoff);
        } else {
          enqueue(() => syncChannel());
        }
      }
    } catch {
      // Transient network failure: keep whatever is on the board.
    }
    schedulePoll();
  };

  // Hidden tabs skip the fetch (see pollLive), so poll immediately when the
  // tab comes back instead of waiting out the current interval. The poll's sync
  // then puts on whatever the channel is showing NOW.
  const onVisibilityChange = (): void => {
    if (destroyed || document.visibilityState !== 'visible') return;
    stopPolling();
    void pollLive();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Boot: tune in (an air on now, else the last game's final position), then
  // start watching for live games.
  enqueue(async () => {
    try {
      await syncChannel();
    } catch (err) {
      renderWatchReplayFailure(root);
      throw err;
    }
  });
  void pollLive();

  return {
    updateCompletedPool: (entries, opts) => {
      if (destroyed) return;
      completedPool = entries.slice();
      if (mode === 'live') return; // live wins; the poll hands off when it ends
      const rebaseline = opts?.jumpNow === true;
      enqueue(() => syncChannel({ rebaseline }));
    },
    destroy: () => {
      destroyed = true;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      destroyHandle();
    },
  };
}
