import {
  applyThreeKingdomsBanqiMove,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiPlayerView,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachFlipFirstColors } from '../../server/src/flip-first-color.js';
import type { ThreeKingdomsBanqiEvent } from '../../server/src/three-kingdoms-banqi-tenant.js';
import { buildFinishedTile } from './current-games.js';
import { watchQueueResultLabel } from './finished-result-label.js';
import type { FeaturedGame } from './game-display.js';
import type { ThreeKingdomsBanqiPostgameResponse } from './live-three-kingdoms-banqi-postgame.js';
import { mountWatchQueuePreview, renderWatchPlayers } from './watch-route.js';

// Exercise the actual list enrichment as well as its DOM consumers. Supplying
// firstColor directly to FeaturedGame would hide the missing TK replay entry.
async function fixture(firstColor: 'red' | 'black' | null, surface: string) {
  const roomId = `tkb_disc_${surface}_${firstColor}`;
  const setup = createThreeKingdomsBanqiSetup(() => 0.5);
  const events: ThreeKingdomsBanqiEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID, setup },
  ];
  let state = createThreeKingdomsBanqiStateFromSetup(roomId, setup);
  const opening = getThreeKingdomsBanqiPlayerView(state, 'red');
  if (firstColor) {
    const square =
      THREE_KINGDOMS_BANQI_SETUP_SQUARES[
        setup.deal.findIndex((piece) => piece.color === firstColor)
      ]!;
    const move = { from: square, to: square };
    events.push({ type: 'move-played', at: 2, roomId, color: 'red', move });
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  events.push({ type: 'seat-resigned', at: 3, roomId, color: 'black' });
  state = { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
  const view = getThreeKingdomsBanqiPlayerView(state, 'red');
  expect(view.firstColor).toBe(firstColor);
  const game: FeaturedGame = {
    roomId,
    variant: THREE_KINGDOMS_BANQI_SPEC_ID,
    mode: 'pve',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: state.ply,
    whiteName: null,
    blackName: null,
    corpusId: null,
    participants: (['red', 'black'] as const).map((color) => ({
      color,
      displayName: color === 'red' ? 'Guest' : 'Misty',
      subjectType: 'guest',
      subjectId: null,
      visibility: 'public',
    })),
  };
  await attachFlipFirstColors([game], { loadRoomEvents: async () => events });
  const postgame: ThreeKingdomsBanqiPostgameResponse = {
    game: {
      ...game,
      variant: THREE_KINGDOMS_BANQI_SPEC_ID,
      mode: 'pve',
      startedAt: '2026-11-10T12:00:00Z',
      endedAt: '2026-11-10T12:00:03Z',
      rated: false,
      visibility: 'public',
      initialMs: 300_000,
      incrementMs: 5_000,
    },
    state: { status: view.status, moveNumber: view.moveNumber },
    view,
    timeline: [],
    history: {
      truth: [
        { ply: 0, view: opening },
        { ply: state.ply, view },
      ],
    },
  };
  return { game, postgame };
}

function expectDisc(root: Element, selector: string, ink: string) {
  expect(
    root.querySelector(`${selector} .seat-disc`)?.classList.contains(`seat-disc--${ink}`),
  ).toBe(true);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['black', 'red', null] as const)('TK seat ink firstColor=%s', (firstColor) => {
  const firstInk = firstColor ?? 'unbound';
  const secondInk = firstColor === null ? 'unbound' : firstColor === 'red' ? 'black' : 'red';

  it('/games finished cards use the enriched list row', async () => {
    const { game } = await fixture(firstColor, 'games');
    const tile = buildFinishedTile(game);
    expectDisc(tile, '[data-seat="first"]', firstInk);
    expectDisc(tile, '[data-seat="second"]', secondInk);
  });

  it('keeps finished result labels consistent with the winning seat disc', async () => {
    const { game } = await fixture(firstColor, 'result');
    const label =
      firstColor === null ? 'First wins' : firstColor === 'red' ? 'Red wins' : 'Black wins';
    expect(watchQueueResultLabel(game)).toBe(label);
    expect(buildFinishedTile(game).querySelector('.current-game-result')?.textContent).toBe(label);
  });

  it('/watch clock-side player rows use the enriched feed row', async () => {
    const { game } = await fixture(firstColor, 'watch');
    const root = document.createElement('div');
    const top = document.createElement('div');
    top.className = 'top';
    const bottom = document.createElement('div');
    bottom.className = 'bottom';
    root.append(top, bottom);
    renderWatchPlayers(top, bottom, game);
    expectDisc(root, '.bottom', firstInk);
    expectDisc(root, '.top', secondInk);
  });

  it('/watch Previously cards read the public postgame view', async () => {
    const { game, postgame } = await fixture(firstColor, 'previously');
    const fetch = vi.fn(async () => new Response(JSON.stringify(postgame)));
    vi.stubGlobal('fetch', fetch);
    const root = document.createElement('div');
    const handle = await mountWatchQueuePreview(
      root,
      game,
      {},
      {
        [game.roomId]: { first: 'Guest', second: 'Misty' },
      },
    );
    try {
      expect(fetch).toHaveBeenCalledWith(`/api/three-kingdoms-banqi/games/${game.roomId}`);
      expectDisc(root, '[data-seat="first"]', firstInk);
      expectDisc(root, '[data-seat="second"]', secondInk);
    } finally {
      handle.destroy();
    }
  });
});
