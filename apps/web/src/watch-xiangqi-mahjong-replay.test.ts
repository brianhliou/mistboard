// Mistboard TV's Xiangqi Mahjong mount: it draws the frames the server sends
// (the spectator track while live) and nothing else, follows a live match to
// its latest view, and gives the rail the room's own hand log and points.
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomState,
  xmjBotAction,
  xmjPendingAction,
  xmjViewFor,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedRendererKindForVariant, showcaseRendererKindForSpec } from './showcase-dispatch.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';
import {
  mountXiangqiMahjongWatchReplay,
  xmjClockAtPly,
  xmjCompactFit,
  xmjTagOverflow,
  xmjWatchFrames,
} from './watch-xiangqi-mahjong-replay.js';

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function nextMove(state: XmjRoomState): XmjMove {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return { ...action, by: seat, at: 0 } as XmjMove;
  }
  const pending = xmjPendingAction(state);
  if (pending) return pending.move;
  throw new Error('nobody can act');
}

/** A live frame shaped like /api/watch/live: `plies` moves into a match. */
function liveFrame(plies: number) {
  let state = createXmjRoomState(createXmjSetup(seeded(11)), 'xmj_tv');
  const spectator: Array<{ ply: number; view: XmjPlayerView }> = [
    { ply: 0, view: xmjViewFor(state, 'spectator') },
  ];
  const timeline: Array<Record<string, unknown>> = [];
  for (let ply = 1; ply <= plies; ply += 1) {
    const move = nextMove(state);
    state = applyXmjMove(state, move);
    timeline.push({ type: 'move-played', at: ply * 1000, color: move.by, ply, move });
    spectator.push({ ply, view: xmjViewFor(state, 'spectator') });
  }
  return {
    game: { result: 'in-progress', termination: 'in-progress', plyCount: plies },
    state: { status: state.status },
    timeline,
    seatDisplayNames: { east: 'Ada', west: 'Bo' },
    view: spectator.at(-1)?.view,
    history: { spectator },
  };
}

const faceUpInRacks = (root: HTMLElement): number =>
  root.querySelectorAll('.xmj-rack .xmj-tile:not(.xmj-tile--back)').length;

describe('xiangqi mahjong TV mount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows a live match to its latest spectator view, never a concealed tile', async () => {
    let frame = liveFrame(6);
    const plies: Array<[number, number]> = [];
    const root = document.createElement('div');
    const handle = await mountXiangqiMahjongWatchReplay(root, 'xmj_tv', {
      autoplay: false,
      compact: true,
      live: true,
      metadataByRoomId: {},
      onPlyChange: (ply, max) => plies.push([ply, max]),
      loadPostgameOverride: async () => ({ ok: true, postgame: frame }),
    });

    expect(handle.plyCount?.()).toBe(6);
    expect(plies.at(-1)).toEqual([6, 6]);
    expect(handle.gameResult?.()).toBe('in-progress');
    expect(root.querySelector('.xiangqi-mahjong-live-board .xmj-table')).not.toBeNull();
    // The homepage viewer asks for the compact table; it is the same view, smaller.
    expect(root.querySelector('.xmj-watch-board--compact')).not.toBeNull();
    expect(root.textContent).toContain('Ada');
    expect(root.textContent).toContain('Bo');
    // A spectator during a hand: both racks are backs, and no seat can act.
    expect(frame.view?.hands).toEqual({ east: null, west: null });
    expect(faceUpInRacks(root)).toBe(0);
    expect(root.querySelector('[data-xmj-tile], .xmj-action')).toBeNull();

    // A new frame arrives: the same handle catches up to it.
    frame = liveFrame(9);
    await handle.loadGame('xmj_tv');
    expect(handle.plyCount?.()).toBe(9);
    expect(plies.at(-1)).toEqual([9, 9]);
    expect(faceUpInRacks(root)).toBe(0);
    handle.destroy();
  });

  it('gives the rail the hand log and the points table, and scrubs', async () => {
    const frame = liveFrame(8);
    const root = document.createElement('div');
    const plies: number[] = [];
    const handle = await mountXiangqiMahjongWatchReplay(root, 'xmj_tv', {
      autoplay: false,
      live: true,
      metadataByRoomId: {},
      onPlyChange: (ply) => plies.push(ply),
      loadPostgameOverride: async () => ({ ok: true, postgame: frame }),
    });
    // The full TV page keeps the full-size table.
    expect(root.querySelector('.xmj-watch-board')).not.toBeNull();
    expect(root.querySelector('.xmj-watch-board--compact')).toBeNull();
    const log = handle.moveLog?.();
    expect(log?.el.classList.contains('xmj-log')).toBe(true);
    log?.update(8, (ply) => handle.jumpToPly?.(ply));
    const rows = log?.el.querySelectorAll<HTMLElement>('[data-xmj-ply]') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(log?.el.textContent).toContain('Ada');

    // Clicking a row moves the board to that ply.
    const first = rows[0];
    first?.click();
    expect(plies.at(-1)).toBe(Number(first?.dataset.xmjPly));

    const slots = {
      top: document.createElement('div'),
      bottom: document.createElement('div'),
      pool: document.createElement('div'),
    };
    handle.fillMaterial?.(slots);
    // The room's under-board card, not a bare table floating in the rail.
    expect(slots.pool.querySelector('section.xmj-hands-under > table.xmj-hands')).not.toBeNull();
    expect(slots.pool.textContent).toContain('Ada');
    expect(slots.top.childElementCount + slots.bottom.childElementCount).toBe(0);

    // A discard sounds; the deal (ply 0) has no move.
    const discardPly = frame.timeline.findIndex(
      (entry) => (entry.move as { action?: string }).action === 'discard',
    );
    expect(handle.moveSoundAtPly?.(discardPly + 1)).not.toBeNull();
    expect(handle.moveSoundAtPly?.(0)).toBeNull();
    handle.destroy();
  });

  it('falls back to the finished game, and keeps the board when the caller says so', async () => {
    const finished = { ...liveFrame(5), history: liveFrame(5).history.spectator };
    finished.game = { result: 'east-wins', termination: 'points', plyCount: 5 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(finished), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const root = document.createElement('div');
    const handle = await mountXiangqiMahjongWatchReplay(root, 'xmj_done', {
      autoplay: false,
      live: true,
      metadataByRoomId: {},
      loadPostgameOverride: async () => ({ ok: false }),
      onLoadError: () => true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/xiangqi-mahjong/games/xmj_done', {
      credentials: 'same-origin',
    });
    expect(handle.gameResult?.()).toBe('east-wins');
    expect(handle.plyCount?.()).toBe(5);

    // The record is gone: the caller keeps its last frame.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    await handle.loadGame('xmj_gone');
    expect(root.querySelector('.xmj-table')).not.toBeNull();
    handle.destroy();
  });

  it('shows the load notice when nothing loads and no caller handles it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    const root = document.createElement('div');
    await mountXiangqiMahjongWatchReplay(root, 'xmj_none', {
      autoplay: false,
      metadataByRoomId: {},
    });
    expect(root.querySelector('.watch-empty')).not.toBeNull();
  });

  it('reads the live track and the finished history alike, in ply order', () => {
    const live = liveFrame(3);
    expect(xmjWatchFrames(live).map((frame) => frame.ply)).toEqual([0, 1, 2, 3]);
    const reversed = [...live.history.spectator].reverse();
    expect(xmjWatchFrames({ history: reversed }).map((frame) => frame.ply)).toEqual([0, 1, 2, 3]);
    expect(xmjWatchFrames({ history: { spectator: undefined } })).toEqual([]);
  });

  it('is a TV renderer, and still not a game embed', () => {
    expect(webVariantTenantForSpecId('xiangqi-mahjong')?.watch?.family).toBe('mahjong');
    expect(showcaseRendererKindForSpec('xiangqi-mahjong')).toBe('xiangqi-mahjong');
    expect(embedRendererKindForVariant('xiangqi-mahjong')).toBeNull();
  });
});

describe('xiangqi mahjong compact fit', () => {
  // A table shaped like the one measured in a 230px feed card: 338px tall
  // below 280px wide, and the To discard badge reaching past the edge until
  // the table is 300px wide.
  const table = (width: number) => ({
    height: width < 280 ? 338 : 300,
    overflow: Math.max(0, (300 - width) / 2),
  });

  it('scales a table too big for a square card until the rack and the badges fit', () => {
    const { zoom, width } = xmjCompactFit(230, 230, table);
    expect(zoom).toBeLessThan(1);
    expect(width * zoom).toBeCloseTo(230);
    expect(table(width).height * zoom).toBeLessThanOrEqual(230);
    expect(table(width).overflow).toBe(0);
  });

  it('leaves a table that fits its host at full size', () => {
    expect(xmjCompactFit(320, 400, table)).toEqual({ zoom: 1, width: 320 });
  });

  // Regression: a Dealer badge 48px wide in a 38px column spilled into the
  // felt's padding, inside the table's edge, so the fit measured no overflow
  // and the rounded corner clipped the badge's first letters on /watch.
  it('counts a badge wider than its column though it stays inside the felt', () => {
    const column = { left: 10, right: 48 };
    expect(xmjTagOverflow([{ column, badge: { left: 0, right: 48 } }])).toBe(10);
    expect(xmjTagOverflow([{ column, badge: { left: 20, right: 48 } }])).toBe(0);
    expect(
      xmjTagOverflow([
        { column, badge: { left: 14, right: 48 } },
        { column: { left: 200, right: 238 }, badge: { left: 200, right: 244 } },
      ]),
    ).toBe(6);
  });
});

describe('xiangqi mahjong rail clock', () => {
  // Regression: the TV rail had no clockAtPly for this variant, so /watch drew
  // no clocks beside the players while every other variant's rail did.
  const view = liveFrame(0).view as XmjPlayerView;
  const frame = (
    ply: number,
    clock?: { east: number; west: number; active: 'east' | 'west' | null },
  ) => ({
    ply,
    view,
    ...(clock
      ? { clock: { remainingMs: { east: clock.east, west: clock.west }, active: clock.active } }
      : {}),
  });

  it('reads a finished match from the latest snapshot at or before the ply', () => {
    const match = {
      frames: [frame(0), frame(1, { east: 179_000, west: 180_000, active: 'west' }), frame(2)],
      liveClock: null,
      initialMs: 180_000,
      result: 'west-wins',
    };
    expect(xmjClockAtPly(match, 0, 0)).toBeNull();
    expect(xmjClockAtPly(match, 1, 0)).toEqual({
      first: 179_000,
      second: 180_000,
      toMove: 'second',
      initialMs: 180_000,
    });
    // The last ply of a finished match has nobody to move.
    expect(xmjClockAtPly(match, 2, 0)?.toMove).toBeNull();
    expect(xmjClockAtPly(match, 2, 0)?.first).toBe(179_000);
  });

  it('runs the live side down from the server clock at the latest ply only', () => {
    const match = {
      frames: [frame(0), frame(1, { east: 170_000, west: 175_000, active: 'east' })],
      liveClock: {
        remainingMs: { east: 170_000, west: 175_000 },
        activeColor: 'east' as const,
        runningSince: 10_000,
      },
      initialMs: 180_000,
      result: 'in-progress',
    };
    expect(xmjClockAtPly(match, 1, 14_000)).toEqual({
      first: 166_000,
      second: 175_000,
      toMove: 'first',
      initialMs: 180_000,
    });
    // Scrubbed back, the board shows the snapshot, not the running clock.
    expect(xmjClockAtPly(match, 0, 14_000)).toBeNull();
  });
});
