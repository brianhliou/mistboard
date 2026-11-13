import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayHandle } from './replay.js';
import {
  mountTenantWatchReplay,
  type TenantWatchAdapter,
  type WatchPostgameMeta,
} from './watch-tenant-replay.js';

type View = { ply: number };
type Postgame = WatchPostgameMeta & { history: View[] };

function payload(plies: number, finished = false): Postgame {
  return {
    game: {
      mode: 'pvp',
      result: finished ? 'red-wins' : 'in-progress',
      termination: finished ? 'resignation' : 'in-progress',
      plyCount: plies,
      rated: false,
      initialMs: null,
      incrementMs: null,
    },
    state: {},
    history: Array.from({ length: plies + 1 }, (_, ply) => ({ ply })),
  };
}

describe('tenant replay following the latest position', () => {
  let handle: ReplayHandle | null = null;

  afterEach(() => {
    handle?.destroy();
    handle = null;
  });

  async function mount(followEnd = true, finished = false) {
    let postgame = payload(1, finished);
    const root = document.createElement('div');
    const animateMove = vi.fn();
    const adapter: TenantWatchAdapter<Postgame, View, 'truth'> = {
      variant: 'banqi',
      installStyles: () => {},
      loadPostgame: async () => ({ ok: true, postgame }),
      maxPly: (game) => game.game.plyCount,
      viewEntries: () => [{ key: 'truth', label: 'Board' }],
      viewAtPly: (game, _key, ply) => game.history[ply] ?? null,
      paneKind: () => 'truth',
      renderBoard: (view) => `<svg data-ply="${view.ply}"></svg>`,
      fillCaptures: () => {},
      animateMove,
    };
    handle = await mountTenantWatchReplay(
      root,
      'room-a',
      {
        autoplay: false,
        compact: true,
        live: !finished,
        ...(followEnd ? { followEnd: true } : {}),
      },
      adapter,
    );
    return {
      animateMove,
      shownPly: () => root.querySelector('svg')?.getAttribute('data-ply'),
      reload: async (plies: number, roomId = 'room-a') => {
        postgame = payload(plies, finished);
        await handle?.loadGame(roomId);
      },
    };
  }

  it.each([false, true])(
    'paints a one-ply game at the end without gliding (finished=%s)',
    async (finished) => {
      const card = await mount(true, finished);
      expect(card.shownPly()).toBe('1');
      expect(card.animateMove).not.toHaveBeenCalled();
    },
  );

  it('glides exactly once, forward, when the same room adds one move', async () => {
    const card = await mount();
    await card.reload(2);
    expect(card.shownPly()).toBe('2');
    expect(card.animateMove).toHaveBeenCalledTimes(1);
    expect(card.animateMove.mock.calls[0]?.slice(1, 4)).toEqual([
      { ply: 2 },
      { ply: 1 },
      'forward',
    ]);
    await card.reload(2);
    expect(card.animateMove).toHaveBeenCalledTimes(1);
  });

  it('jumps without gliding when a poll catches up three moves', async () => {
    const card = await mount();
    await card.reload(4);
    expect(card.shownPly()).toBe('4');
    expect(card.animateMove).not.toHaveBeenCalled();
  });

  it('paints a different room without carrying over its previous ply', async () => {
    const card = await mount();
    await card.reload(2, 'room-b');
    expect(card.shownPly()).toBe('2');
    expect(card.animateMove).not.toHaveBeenCalled();
  });

  it('keeps the homepage default at ply zero on mount and reload', async () => {
    const card = await mount(false);
    expect(card.shownPly()).toBe('0');
    await card.reload(2);
    expect(card.shownPly()).toBe('0');
    expect(card.animateMove).not.toHaveBeenCalled();
  });
});
