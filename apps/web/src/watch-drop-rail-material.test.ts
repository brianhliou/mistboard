// Mistboard TV's rail for the drop variants: each seat's hand, drawn as the game
// page's pocket, at the board's ply. Black (the second mover) sits on top.
import {
  createInitialCrazyhouseXiangqiState,
  createInitialFortressXiangqiState,
  getCrazyhouseXiangqiPlayerView,
  getFortressXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { mountCrazyhouseXiangqiWatchReplay } from './watch-crazyhouse-xiangqi-replay.js';
import { mountFortressXiangqiWatchReplay } from './watch-fortress-xiangqi-replay.js';
import { createWatchMaterialRail } from './watch-route.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drop variant TV rail', () => {
  it('fills Crazyhouse Xiangqi hands as pockets, per ply', async () => {
    const start = getCrazyhouseXiangqiPlayerView(createInitialCrazyhouseXiangqiState('chx'), 'red');
    const after = {
      ...start,
      hands: { red: { ...start.hands.red, soldier: 2 }, black: { ...start.hands.black } },
    };
    const postgame = dropPostgame('crazyhouse-xiangqi', start, after);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgame)),
    );
    const handle = await mountCrazyhouseXiangqiWatchReplay(document.createElement('div'), 'chx', {
      autoplay: false,
      compact: true,
    });
    const slots = railSlots();

    expect(handle.fillMaterial).toBeTypeOf('function');
    handle.jumpToPly?.(0);
    handle.fillMaterial?.(slots);
    expect(slots.top.dataset.hand).toBe('black');
    expect(slots.bottom.dataset.hand).toBe('red');
    expect(slots.bottom.classList.contains('drop-pocket')).toBe(true);
    expect(heldTiles(slots.bottom)).not.toContain('red soldier x2');

    handle.jumpToPly?.(1);
    handle.fillMaterial?.(slots);
    expect(heldTiles(slots.bottom)).toContain('red soldier x2');
    expect(heldTiles(slots.top).every((label) => label.startsWith('black '))).toBe(true);
    handle.destroy();
  });

  it('fills Fortress Xiangqi hands as pockets, per ply', async () => {
    const start = getFortressXiangqiPlayerView(createInitialFortressXiangqiState('fxq'), 'red');
    const after = {
      ...start,
      hands: { red: { ...start.hands.red }, black: { ...start.hands.black, chariot: 1 } },
    };
    const postgame = dropPostgame('fortress-xiangqi', start, after);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgame)),
    );
    const handle = await mountFortressXiangqiWatchReplay(document.createElement('div'), 'fxq', {
      autoplay: false,
      compact: true,
    });
    const slots = railSlots();

    expect(handle.fillMaterial).toBeTypeOf('function');
    handle.jumpToPly?.(1);
    handle.fillMaterial?.(slots);
    expect(slots.top.dataset.hand).toBe('black');
    expect(slots.top.classList.contains('drop-pocket')).toBe(true);
    expect(heldTiles(slots.top)).toContain('black chariot x1');
    handle.destroy();
  });
});

describe('createWatchMaterialRail', () => {
  it('resets the slots to their mounted shape before every fill, and on clear', () => {
    const slots = railSlots();
    slots.top.className = 'captures-strip captures-strip-top rail-material';
    let fill: ((s: typeof slots) => void) | undefined = (s) => {
      // A drop variant's pocket: classes, an owner tag and a slot count.
      s.top.classList.add('drop-mini-reserve-strip', 'drop-pocket', 'has-captures');
      s.top.dataset.hand = 'black';
      s.top.style.setProperty('--pocket-slots', '6');
      s.top.append(document.createElement('span'));
    };
    const rail = createWatchMaterialRail(slots, () => ({ fillMaterial: fill }));

    rail.sync();
    expect(slots.top.classList.contains('drop-pocket')).toBe(true);

    // The next game has no material hook: nothing of the pocket survives.
    fill = undefined;
    rail.sync();
    expect(slots.top.className).toBe('captures-strip captures-strip-top rail-material');
    expect(slots.top.dataset.hand).toBeUndefined();
    expect(slots.top.style.getPropertyValue('--pocket-slots')).toBe('');
    expect(slots.top.childElementCount).toBe(0);

    fill = (s) => s.bottom.append(document.createElement('span'));
    rail.sync();
    expect(slots.bottom.childElementCount).toBe(1);
    rail.clear();
    expect(slots.bottom.childElementCount).toBe(0);
  });

  it('leaves the slots empty when no game is on the board', () => {
    const slots = railSlots();
    slots.pool.append(document.createElement('span'));
    createWatchMaterialRail(slots, () => null).sync();
    expect(slots.pool.childElementCount).toBe(0);
  });
  it('redraws the strips when the piece set or 3D look changes, until aborted', () => {
    const slots = railSlots();
    const fill = vi.fn();
    const controller = new AbortController();
    createWatchMaterialRail(slots, () => ({ fillMaterial: fill }), controller.signal);

    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));
    expect(fill).toHaveBeenCalledTimes(1);

    controller.abort();
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));
    expect(fill).toHaveBeenCalledTimes(1);
  });
});

function railSlots(): { top: HTMLElement; bottom: HTMLElement; pool: HTMLElement } {
  return {
    top: document.createElement('div'),
    bottom: document.createElement('div'),
    pool: document.createElement('div'),
  };
}

// Pocket tiles for roles actually held (a zero count is a ghosted slot).
function heldTiles(slot: HTMLElement): string[] {
  return [...slot.querySelectorAll<HTMLElement>('[data-role]')]
    .map((tile) => tile.getAttribute('aria-label') ?? '')
    .filter((label) => !label.endsWith(' x0'));
}

function dropPostgame<V extends object>(
  variant: 'crazyhouse-xiangqi' | 'fortress-xiangqi',
  start: V,
  after: V,
): unknown {
  // Served as JSON, so the shape only has to match what each loader reads.
  const move = { from: 'a4', to: 'a5' };
  const finished = { type: 'finished', winner: 'red', reason: 'resignation' };
  return {
    game: {
      roomId: `${variant}-rail`,
      variant,
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-10-16T12:00:00.000Z',
      endedAt: '2026-10-16T12:05:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 180_000,
      incrementMs: 2_000,
    },
    state: {
      status: finished,
      moveNumber: 1,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    },
    timeline: [
      { type: 'move-played', at: 2, color: 'red', move, ply: 1 },
      { type: 'seat-resigned', at: 3, color: 'black', winner: 'red' },
    ],
    view: { ...after, status: finished, lastMove: move },
    views: { truth: { ...after, status: finished, lastMove: move } },
    history: {
      truth: [
        { ply: 0, view: start },
        { ply: 1, view: { ...after, status: finished, lastMove: move } },
      ],
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}
