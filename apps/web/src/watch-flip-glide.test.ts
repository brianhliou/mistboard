import {
  applyThreeKingdomsBanqiMove,
  createInitialThreeKingdomsBanqiState,
  getThreeKingdomsBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { animateBanqiBoardMove, animateBanqiReveal } from './live-banqi-render.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
} from './three-kingdoms-banqi-diagrams.js';
import { ffqBanqiWatchAnimateMove } from './watch-ffq-banqi-replay.js';
import {
  mountThreeKingdomsBanqiWatchReplay,
  threeKingdomsBanqiWatchAnimateMove,
} from './watch-three-kingdoms-banqi-replay.js';

// The animators only touch the DOM; spying on them is how a step proves it glided.
vi.mock('./three-kingdoms-banqi-diagrams.js', async (original) => ({
  ...(await original<typeof import('./three-kingdoms-banqi-diagrams.js')>()),
  animateThreeKingdomsBanqiBoardMove: vi.fn(),
  animateThreeKingdomsBanqiReveal: vi.fn(() => true),
}));
vi.mock('./live-banqi-render.js', async (original) => ({
  ...(await original<typeof import('./live-banqi-render.js')>()),
  animateBanqiBoardMove: vi.fn(),
  animateBanqiReveal: vi.fn(),
}));

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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Three Kingdoms Banqi TV steps glide', () => {
  it('turns the flipped tile over when Next steps onto a flip', async () => {
    const root = document.createElement('div');
    const postgame = fixture();
    const handle = await mountThreeKingdomsBanqiWatchReplay(root, 'tkb_watch', {
      autoplay: false,
      loadPostgameOverride: async () => ({ ok: true, postgame }),
    });
    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    expect(animateThreeKingdomsBanqiReveal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(animateThreeKingdomsBanqiReveal).mock.calls[0]?.[1]).toBe(
      postgame.timeline[0]?.move.to,
    );
    handle.destroy();
  });

  it('glides a move forward and reverses it on a back step; a flip undone does not glide', () => {
    const el = document.createElement('div');
    type View = Parameters<typeof threeKingdomsBanqiWatchAnimateMove>[1];
    const moved = { lastMove: { from: 'a1', to: 'a2' } } as unknown as View;
    const flipped = { lastMove: { from: 'b1', to: 'b1' } } as unknown as View;
    threeKingdomsBanqiWatchAnimateMove(el, moved, null, 'forward');
    threeKingdomsBanqiWatchAnimateMove(el, flipped, moved, 'back');
    threeKingdomsBanqiWatchAnimateMove(el, moved, flipped, 'back');
    expect(vi.mocked(animateThreeKingdomsBanqiBoardMove).mock.calls).toEqual([
      [el, { from: 'a1', to: 'a2' }, { reverse: false }],
      [el, { from: 'a1', to: 'a2' }, { reverse: true }],
    ]);
    expect(animateThreeKingdomsBanqiReveal).not.toHaveBeenCalled();
  });
});

describe('Fanfanqi TV steps glide', () => {
  type View = Parameters<typeof ffqBanqiWatchAnimateMove>[1];
  const view = (from: number, to: number) => ({ lastMove: { from, to } }) as unknown as View;

  it('turns a flip over on the board square for its index', () => {
    const el = document.createElement('div');
    ffqBanqiWatchAnimateMove(el, view(6, 6), null, 'forward');
    expect(animateBanqiReveal).toHaveBeenCalledWith(el, 'b3');
    expect(animateBanqiBoardMove).not.toHaveBeenCalled();
  });

  it('glides a move by its squares, reversed on a back step', () => {
    const el = document.createElement('div');
    ffqBanqiWatchAnimateMove(el, view(5, 9), null, 'forward');
    ffqBanqiWatchAnimateMove(el, view(0, 0), view(5, 9), 'back');
    expect(vi.mocked(animateBanqiBoardMove).mock.calls).toEqual([
      [el, { from: 'b2', to: 'c2' }, { reverse: false }],
      [el, { from: 'b2', to: 'c2' }, { reverse: true }],
    ]);
  });

  it('does not turn a tile face down again on a step back over a flip', () => {
    const el = document.createElement('div');
    ffqBanqiWatchAnimateMove(el, view(1, 2), view(6, 6), 'back');
    expect(animateBanqiReveal).not.toHaveBeenCalled();
    expect(animateBanqiBoardMove).not.toHaveBeenCalled();
  });
});
