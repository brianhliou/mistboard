// Landing TV channel: live-follow via /api/watch/live, else a fog game on its
// delayed air (joined mid-air), else the newest finished game frozen. Live-capable
// variants never air after the fact. mountShowcaseBoard is mocked; the tests drive
// the poll with fake timers, a stubbed fetch and a stubbed page visibility.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

type MountRecord = {
  specId: string;
  roomId: string;
  options: {
    autoplay?: boolean;
    live?: boolean;
    airStartMs?: number;
    onGameEnd?: () => void;
    loadPostgameOverride?: (
      roomId: string,
    ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
    onLoadError?: () => boolean;
  };
  handle: {
    destroy: ReturnType<typeof vi.fn>;
    loadGame: ReturnType<typeof vi.fn>;
    jumpToPly: ReturnType<typeof vi.fn>;
  };
};

const mounts: MountRecord[] = [];

vi.mock('./showcase-board.js', () => ({
  mountShowcaseBoard: vi.fn(
    async (_root: HTMLElement, specId: string, roomId: string, options: MountRecord['options']) => {
      const handle = {
        activeSampleId: () => roomId,
        destroy: vi.fn(),
        loadGame: vi.fn(async () => {}),
        jumpToPly: vi.fn(),
        plyCount: () => 6,
        updateLoopPool: () => {},
      };
      mounts.push({ handle, options, roomId, specId });
      return handle;
    },
  ),
}));

import { airWindowFor, type LandingTvMode, mountLandingTv } from './landing-tv.js';
import type { ShowcaseEntry } from './showcase-cycler.js';

const POLL_MS = 4_000;
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);

let featuredResponse: { featured: unknown } = { featured: null };
let root: HTMLElement;
let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function liveFeatured(roomId: string, ply: number, withPayload = true): unknown {
  return {
    roomId,
    gameSpecId: 'xiangqi',
    ply,
    players: [
      { color: 'red', isEngine: false, name: 'Ada' },
      { color: 'black', isEngine: true, name: 'Pikafish' },
    ],
    ...(withPayload ? { payload: { marker: `${roomId}@${ply}` } } : {}),
  };
}

async function flush(): Promise<void> {
  // Let the poll fetch + the serialized mount chain settle.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await flush();
}

const modes: Array<{ roomId: string; mode: LandingTvMode }> = [];

function mountController(initialPool: ShowcaseEntry[]) {
  return mountLandingTv(root, initialPool, {
    isConnected: () => true,
    loaderForId: async () => [],
    metadataByRoomId: {},
    namesByRoomId: {},
    onGameChange: ({ roomId, mode }) => modes.push({ roomId, mode }),
  });
}

function lastMode(): { roomId: string; mode: LandingTvMode } | undefined {
  return modes[modes.length - 1];
}

const iso = (ms: number): string => new Date(ms).toISOString();

// A finished game in the showcase pool: `endedAgoMs` before NOW, having lasted `lengthMs`.
function finished(
  roomId: string,
  specId: string,
  endedAgoMs: number,
  lengthMs: number,
  delayedAir?: boolean,
): ShowcaseEntry {
  return {
    roomId,
    specId,
    pov: 'white',
    startedAt: iso(NOW - endedAgoMs - lengthMs),
    endedAt: iso(NOW - endedAgoMs),
    ...(delayedAir === undefined ? {} : { delayedAir }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mounts.length = 0;
  modes.length = 0;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  featuredResponse = { featured: null };
  root = document.createElement('div');
  document.body.append(root);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => featuredResponse, ok: true })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  root.remove();
});

const entryA = { pov: 'white' as const, roomId: 'gameA', specId: 'xiangqi' };
const entryB = { pov: 'white' as const, roomId: 'gameB', specId: 'xiangqi' };

test('boot FREEZES on the pool head (paused, jumped to end) and never auto-plays history', async () => {
  const tv = await mountController([entryA]);
  await flush();
  expect(mounts).toHaveLength(1);
  expect(mounts[0]!.roomId).toBe('gameA');
  expect(mounts[0]!.options.autoplay).toBe(false);
  expect(mounts[0]!.options.live).toBeUndefined();
  expect(mounts[0]!.handle.jumpToPly).toHaveBeenCalled();

  // The same head on later pool refreshes changes nothing.
  tv.updateCompletedPool([entryA]);
  await flush();
  await tick();
  expect(mounts).toHaveLength(1);
  tv.destroy();
});

test('a jumpNow baseline refresh freezes on the new head instead of airing it', async () => {
  const tv = await mountController([entryA]);
  await flush();
  expect(mounts).toHaveLength(1);

  // First REAL pool replacing the static fallback: pre-session history, so it
  // re-freezes (paused) rather than airing, even though gameB is unseen. The
  // frozen handle is reused (same renderer kind + flags), so gameB loads into
  // the existing mount and re-jumps to its end.
  tv.updateCompletedPool([entryB], { jumpNow: true });
  await flush();
  expect(mounts).toHaveLength(1);
  expect(mounts[0]!.handle.loadGame).toHaveBeenCalledWith('gameB');
  expect(mounts[0]!.handle.jumpToPly).toHaveBeenCalled();
  tv.destroy();
});

// A followed game can leave the feed without ever becoming a retrievable
// finished game: abandoned by both players and reaped, or lost to a restart.
// Its last live frame is a dead position, so the hero goes back to the pool head
// rather than parking the homepage on a game that went nowhere.
test('a handoff whose finished-game load fails falls back to the pool head', async () => {
  featuredResponse = { featured: liveFeatured('deadGame', 2) };
  const tv = await mountController([entryA]);
  await flush();

  // Boot froze on gameA, then the live game took the board.
  expect(mounts).toHaveLength(2);
  const live = mounts[1]!;
  expect(live.roomId).toBe('deadGame');
  expect(live.options.live).toBe(true);

  // The room vanishes and its finished-game load 404s.
  live.handle.loadGame.mockImplementation(async () => {
    live.options.onLoadError?.();
  });
  featuredResponse = { featured: null };
  await tick();

  expect(mounts).toHaveLength(3);
  expect(mounts[2]!.roomId).toBe('gameA');
  expect(mounts[2]!.options.live).toBeUndefined();
  expect(mounts[2]!.options.autoplay).toBe(false);
  tv.destroy();
});

test('a live featured game mounts paused+live, follows new plies, and hands off on finish', async () => {
  featuredResponse = { featured: liveFeatured('liveGame', 3) };
  const tv = await mountController([]);
  await flush();

  // Live mount: paused board in live mode, jumped to the latest ply.
  expect(mounts).toHaveLength(1);
  const live = mounts[0]!;
  expect(live.roomId).toBe('liveGame');
  expect(live.options.live).toBe(true);
  expect(live.options.autoplay).toBe(false);
  expect(live.handle.jumpToPly).toHaveBeenCalled();
  // The live handle keeps its last frame on a failed load rather than wiping to
  // the error notice (the live→frozen handoff relies on this).
  expect(live.options.onLoadError?.()).toBe(true);

  // The override serves the poll payload for the live room.
  const served = await live.options.loadPostgameOverride?.('liveGame');
  expect(served).toEqual({ ok: true, postgame: { marker: 'liveGame@3' } });

  // A new ply arrives: same handle reloads and re-jumps (no re-mount).
  featuredResponse = { featured: liveFeatured('liveGame', 4) };
  await tick();
  expect(mounts).toHaveLength(1);
  expect(live.handle.loadGame).toHaveBeenCalledWith('liveGame');

  // The game leaves the feed: the handoff reuses the SAME live handle to load
  // the finished replay (no fresh mount), so a failed finished-game load can
  // keep the last frame instead of leaving an empty error box.
  live.handle.loadGame.mockClear();
  featuredResponse = { featured: null };
  await tick();
  expect(mounts).toHaveLength(1);
  expect(live.handle.loadGame).toHaveBeenCalledWith('liveGame');
  expect(live.handle.jumpToPly).toHaveBeenCalled();
  tv.destroy();
});

test('after a live handoff, stale history never clobbers the just-ended game', async () => {
  const tv = await mountController([{ ...entryA, endedAt: iso(NOW - 3_600_000) }]);
  await flush();
  featuredResponse = { featured: liveFeatured('liveGame', 2) };
  await tick();
  featuredResponse = { featured: null };
  await tick();
  const beforeCount = mounts.length;
  expect(mounts[beforeCount - 1]!.roomId).toBe('liveGame');
  expect(lastMode()).toEqual({ mode: 'frozen', roomId: 'liveGame' });

  // A pool still headed by an older game: the board keeps the game that just ended.
  tv.updateCompletedPool([{ ...entryA, endedAt: iso(NOW - 3_600_000) }]);
  await tick();
  expect(mounts).toHaveLength(beforeCount);
  tv.destroy();
});

test('the live game is never cut by pool updates', async () => {
  featuredResponse = { featured: liveFeatured('liveGame', 2) };
  const tv = await mountController([]);
  await flush();
  expect(mounts).toHaveLength(1);

  // Pool refresh while live: no board change, even with jumpNow.
  tv.updateCompletedPool([entryB], { jumpNow: true });
  await flush();
  expect(mounts).toHaveLength(1);
  tv.destroy();
});

test('a guest seat (null name on the live frame) is labelled Guest, matching the finished record', async () => {
  const namesByRoomId: Record<string, { first: string; second: string }> = {};
  const tv = await mountLandingTv(root, [entryA], {
    isConnected: () => true,
    loaderForId: async () => [],
    metadataByRoomId: {},
    namesByRoomId,
  });
  await flush();
  featuredResponse = {
    featured: {
      roomId: 'liveG',
      gameSpecId: 'jungle',
      ply: 3,
      players: [
        { color: 'red', isEngine: true, name: 'Misty' },
        { color: 'black', isEngine: false, name: null },
      ],
      payload: { marker: 'liveG@3' },
    },
  };
  await tick();
  expect(namesByRoomId.liveG).toEqual({ first: 'Misty', second: 'Guest' });
  tv.destroy();
});

// ---- The channel model (2026-09-26) ----

test('airWindowFor: an air runs from the end for as long as the game lasted, and fails closed', () => {
  const fog = finished('fog', 'dark-xiangqi', 60_000, 600_000, true);
  expect(airWindowFor(fog)).toEqual({ entry: fog, startMs: NOW - 60_000, endMs: NOW + 540_000 });
  // No field, or false: never airable.
  expect(airWindowFor(finished('fog', 'dark-xiangqi', 60_000, 600_000))).toBeNull();
  expect(airWindowFor(finished('fog', 'dark-xiangqi', 60_000, 600_000, false))).toBeNull();
  // Missing or inconsistent timestamps: never airable.
  expect(airWindowFor({ ...fog, startedAt: undefined })).toBeNull();
  expect(airWindowFor({ ...fog, startedAt: iso(NOW + 1_000) })).toBeNull();
});

test('(1) a live-capable game that finishes while the tab is hidden shows frozen, never replayed', async () => {
  const older = finished('olderGame', 'xiangqi', 3_600_000, 900_000);
  const tv = await mountController([older]);
  await flush();
  expect(mounts).toHaveLength(1);

  // The tab goes away; a jieqi game is played and finishes. Hidden tabs skip the
  // live poll, so the board never followed it; the pool refresh still lands.
  setVisibility('hidden');
  await tick();
  const jieqi = finished('jieqiGame', 'jieqi', 540_000, 600_000, false);
  tv.updateCompletedPool([jieqi, older]);
  await flush();

  // Back 9 minutes after it ended: the board shows its FINAL position, paused.
  vi.setSystemTime(NOW);
  setVisibility('visible');
  await flush();
  await tick();
  const last = mounts[mounts.length - 1]!;
  expect(last.roomId).toBe('jieqiGame');
  expect(last.options.autoplay).toBe(false);
  expect(last.options.airStartMs).toBeUndefined();
  expect(last.handle.jumpToPly).toHaveBeenCalledWith(6);
  expect(mounts.some((mount) => mount.options.autoplay)).toBe(false);
  expect(lastMode()).toEqual({ mode: 'frozen', roomId: 'jieqiGame' });
  tv.destroy();
});

test('(2) a fog game that ended N seconds ago airs now, joined N seconds into its air', async () => {
  const older = finished('olderGame', 'xiangqi', 3_600_000, 900_000);
  const fog = finished('fogGame', 'dark-xiangqi', 90_000, 600_000, true);
  const tv = await mountController([older, fog]);
  await flush();
  const air = mounts[mounts.length - 1]!;
  expect(air.roomId).toBe('fogGame');
  expect(air.options.autoplay).toBe(true);
  // The renderer shows f(now - airStartMs): 90 s into the game's recorded timeline.
  expect(air.options.airStartMs).toBe(NOW - 90_000);
  expect(NOW - air.options.airStartMs!).toBe(90_000);
  expect(lastMode()).toEqual({ mode: 'replay', roomId: 'fogGame' });

  // Later polls leave the air alone: the renderer is wall-anchored.
  await tick();
  await tick();
  expect(mounts[mounts.length - 1]).toBe(air);
  tv.destroy();
});

test('(3) a hidden tab across a fog air ending shows the later state, not a stalled mid-air', async () => {
  const fog = finished('fogGame', 'dark-xiangqi', 30_000, 120_000, true);
  const tv = await mountController([fog]);
  await flush();
  const air = mounts[0]!;
  expect(air.options.airStartMs).toBe(NOW - 30_000);

  // Hidden for ten minutes: the air's window (90 s left) closes while nobody looks, and
  // the renderer's own end-of-game hand-off never fires (throttled timers).
  setVisibility('hidden');
  vi.setSystemTime(NOW + 600_000);
  await tick();
  expect(lastMode()).toEqual({ mode: 'replay', roomId: 'fogGame' });

  // Back: the channel settles the board on the game's final position, in place.
  setVisibility('visible');
  await flush();
  expect(mounts).toHaveLength(1);
  expect(air.handle.jumpToPly).toHaveBeenCalledWith(6);
  expect(lastMode()).toEqual({ mode: 'frozen', roomId: 'fogGame' });
  tv.destroy();
});

test('(3b) back from hidden, a newer air that is on now replaces a closed one', async () => {
  const first = finished('fogOne', 'dark-xiangqi', 30_000, 60_000, true);
  const tv = await mountController([first]);
  await flush();
  setVisibility('hidden');
  vi.setSystemTime(NOW + 300_000);
  // A second fog game ended 60 s ago (in this later "now") after 10 minutes of play.
  const second: ShowcaseEntry = {
    roomId: 'fogTwo',
    specId: 'dark-chess',
    pov: 'white',
    startedAt: iso(NOW + 300_000 - 60_000 - 600_000),
    endedAt: iso(NOW + 300_000 - 60_000),
    delayedAir: true,
  };
  tv.updateCompletedPool([second, first]);
  await flush();
  setVisibility('visible');
  await flush();
  const last = mounts[mounts.length - 1]!;
  expect(last.roomId).toBe('fogTwo');
  expect(last.options.airStartMs).toBe(NOW + 300_000 - 60_000);
  expect(lastMode()).toEqual({ mode: 'replay', roomId: 'fogTwo' });
  tv.destroy();
});

test('an air on the board is not cut for a newer one; the newer one joins mid-air after', async () => {
  const first = finished('fogOne', 'dark-xiangqi', 10_000, 60_000, true); // on until NOW+50s
  const tv = await mountController([first]);
  await flush();
  expect(mounts[0]!.roomId).toBe('fogOne');

  const second = finished('fogTwo', 'dark-xiangqi', 5_000, 600_000, true); // on until NOW+595s
  tv.updateCompletedPool([second, first]);
  await flush();
  expect(mounts).toHaveLength(1);

  // fogOne's window closes; the next sync puts fogTwo on at ITS current position.
  await vi.advanceTimersByTimeAsync(52_000);
  await flush();
  const last = mounts[mounts.length - 1]!;
  expect(last.roomId).toBe('fogTwo');
  expect(last.options.airStartMs).toBe(NOW - 5_000);
  tv.destroy();
});

test('(4) a live game wins over an air that is on', async () => {
  const fog = finished('fogGame', 'dark-xiangqi', 30_000, 600_000, true);
  featuredResponse = { featured: liveFeatured('liveGame', 5) };
  const tv = await mountController([fog]);
  await flush();
  const last = mounts[mounts.length - 1]!;
  expect(last.roomId).toBe('liveGame');
  expect(last.options.live).toBe(true);
  expect(lastMode()).toEqual({ mode: 'live', roomId: 'liveGame' });

  // Pool updates while live change nothing.
  tv.updateCompletedPool([fog]);
  await tick();
  expect(mounts[mounts.length - 1]!.roomId).toBe('liveGame');
  tv.destroy();
});

test('(5) an entry without the airable field only ever shows frozen, even inside its window', async () => {
  const unflagged = finished('fogNoField', 'dark-xiangqi', 30_000, 600_000);
  const tv = await mountController([unflagged]);
  await flush();
  await tick();
  expect(mounts).toHaveLength(1);
  expect(mounts[0]!.options.autoplay).toBe(false);
  expect(mounts[0]!.options.airStartMs).toBeUndefined();
  expect(lastMode()).toEqual({ mode: 'frozen', roomId: 'fogNoField' });

  tv.updateCompletedPool([finished('fogFalse', 'dark-xiangqi', 10_000, 600_000, false), unflagged]);
  await flush();
  expect(mounts.every((mount) => mount.options.autoplay === false)).toBe(true);
  tv.destroy();
});

test('a fog game whose air already closed before the visitor arrived shows frozen', async () => {
  const fog = finished('fogGame', 'dark-xiangqi', 700_000, 600_000, true);
  const tv = await mountController([fog]);
  await flush();
  expect(mounts).toHaveLength(1);
  expect(mounts[0]!.options.autoplay).toBe(false);
  expect(lastMode()).toEqual({ mode: 'frozen', roomId: 'fogGame' });
  tv.destroy();
});
