import {
  applyThreeKingdomsBanqiMove,
  createInitialThreeKingdomsBanqiState,
  getThreeKingdomsBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, expect, it, vi } from 'vitest';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';
import { mountThreeKingdomsBanqiWatchReplay } from './watch-three-kingdoms-banqi-replay.js';

function fixture() {
  const state = createInitialThreeKingdomsBanqiState('tkb_watch', 628);
  const square = Object.keys(state.board)[0] as keyof typeof state.board;
  const move = { from: square, to: square };
  const next = applyThreeKingdomsBanqiMove(state, move);
  return {
    game: {
      roomId: state.id,
      variant: 'three-kingdoms-banqi',
      mode: 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: 1,
      rated: false,
      visibility: 'public',
      initialMs: null,
      incrementMs: null,
    },
    state: { status: next.status, moveNumber: next.moveNumber },
    view: getThreeKingdomsBanqiPlayerView(next, 'red'),
    timeline: [{ type: 'move-played', at: 100, color: 'red', move, ply: 1 }],
    history: {
      truth: [
        { ply: 0, view: getThreeKingdomsBanqiPlayerView(state, 'red') },
        { ply: 1, view: getThreeKingdomsBanqiPlayerView(next, 'red') },
      ],
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('draws a live TK public board and its revealed flip on the TV controls', async () => {
  const root = document.createElement('div');
  const postgame = fixture();
  const handle = await mountThreeKingdomsBanqiWatchReplay(root, 'tkb_watch', {
    autoplay: false,
    loadPostgameOverride: async () => ({ ok: true, postgame }),
  });
  expect(root.querySelector('svg')).not.toBeNull();
  expect(root.textContent).toContain('Ply 0 / 1');
  expect(handle.moveEntries?.()[0]?.label).toMatch(/\w\d\([A-Za-z]\)/);
  root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
  expect(root.textContent).toContain('Ply 1 / 1');
  handle.destroy();
  expect(root.childElementCount).toBe(0);
});

it('fetches finished TK games through its own route and registers its watch renderer', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture()), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const root = document.createElement('div');
  const handle = await mountThreeKingdomsBanqiWatchReplay(root, 'tkb_watch', {
    autoplay: false,
    compact: true,
  });
  expect(fetcher).toHaveBeenCalledWith('/api/three-kingdoms-banqi/games/tkb_watch');
  expect(webVariantTenantForSpecId('three-kingdoms-banqi')?.watch).toBeTruthy();
  handle.destroy();
});
