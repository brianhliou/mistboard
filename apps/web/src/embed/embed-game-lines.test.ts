import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, expect, it, vi } from 'vitest';
import { pinXiangqiNotation } from '../xiangqi-notation.js';
import type { EmbedBoardHandle } from './embed-card.js';
import { installEmbedGameLines } from './embed-game-lines.js';
import { mountEmbedGame } from './embed-game-page.js';

afterEach(() => {
  vi.unstubAllGlobals();
  pinXiangqiNotation(null);
});

it('opens cached Xiangqi advice in the game card and returns with the shared stepper', async () => {
  pinXiangqiNotation('coordinate');
  const before = createInitialXiangqiState('xq_embed');
  const move = { from: 'a4', to: 'a5' } as const;
  const after = applyStandardXiangqiMove(before, move);
  const view = getStandardXiangqiPlayerView(after, 'red');
  const game = {
    roomId: 'xq_embed',
    variant: 'xiangqi',
    result: 'red-wins',
    mode: 'pvp',
    termination: 'resignation',
    plyCount: 1,
    rated: false,
    initialMs: null,
    incrementMs: null,
  };
  const postgame = {
    game,
    state: { status: after.status, moveNumber: 1 },
    view,
    timeline: [{ type: 'move-played', at: 1, move }],
    history: {
      truth: [
        { ply: 0, view: getStandardXiangqiPlayerView(before, 'red') },
        { ply: 1, view },
      ],
    },
  };
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const body =
      url === '/api/games/xq_embed'
        ? { game }
        : url === '/api/xiangqi/games/xq_embed'
          ? postgame
          : url === '/api/xiangqi/games/xq_embed/analysis'
            ? {
                engineId: 'cached',
                depth: 12,
                plies: [
                  { ply: 0, cp: 250, mate: null, best: 'b3e3' },
                  { ply: 1, cp: -300, mate: null, best: 'h8e8' },
                ],
              }
            : undefined;
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
    };
  });
  const root = document.createElement('div');
  document.body.append(root);
  await mountEmbedGame(root, { roomId: 'xq_embed' });
  const branch = root.querySelector<HTMLButtonElement>('.review-move-list__line-move');
  expect(branch?.textContent).toBe('b3-e3');
  expect(root.querySelectorAll('.review-move-list__line-move')).toHaveLength(1);
  branch!.click();
  expect(root.querySelector('.embed-card-status')?.textContent).toBe('0+1');
  expect(root.querySelector('.embed-game-alternative')?.hasAttribute('hidden')).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(root.querySelector('.embed-card-status')?.textContent).toBe('0+1');
  root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')!.click();
  expect(root.querySelector('.embed-card-status')?.textContent).toBe('0 / 1');
  expect(root.querySelector('.embed-game-alternative')?.hasAttribute('hidden')).toBe(true);
  branch!.click();
  root.querySelector<HTMLButtonElement>('.review-move-list__move[data-ply="1"]')!.click();
  expect(root.querySelector('.embed-card-status')?.textContent).toBe('1 / 1');
  expect(calls.every(({ method }) => method === 'GET')).toBe(true);
  root.remove();
});

it('preserves a board with existing study branches and skips empty advice', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const jumpToLine = vi.fn();
  const entries = () => [{ ply: 1, label: 'a4-a5', line: { moves: ['b3-e3', 'h8-e8'] } }];
  const handle: EmbedBoardHandle = {
    destroy() {},
    jumpToPly() {},
    jumpToLine,
    moveEntries: entries,
  };
  await installEmbedGameLines(
    document.createElement('div'),
    handle,
    'xiangqi',
    'r',
    new Map([[1, 'b3e3']]),
    null,
  );
  expect(handle.jumpToLine).toBe(jumpToLine);
  expect(handle.moveEntries).toBe(entries);
  await installEmbedGameLines(
    document.createElement('div'),
    { destroy() {}, jumpToPly() {} },
    'xiangqi',
    'r',
    new Map(),
    null,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('discards a late public record after its board was replaced', async () => {
  let finish!: (response: unknown) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const host = document.createElement('div');
  host.textContent = 'Replacement board';
  const destroy = vi.fn();
  const handle: EmbedBoardHandle = {
    destroy,
    jumpToPly() {},
    moveEntries: () => [{ ply: 1, label: 'a4-a5' }],
  };
  const install = installEmbedGameLines(host, handle, 'xiangqi', 'r', new Map([[1, 'b3e3']]), null);
  handle.destroy();
  finish({
    ok: true,
    json: async () => ({ timeline: [{ type: 'move-played', move: { from: 'a4', to: 'a5' } }] }),
  });
  await install;
  expect(destroy).toHaveBeenCalledOnce();
  expect(host.textContent).toBe('Replacement board');
  expect(handle.jumpToLine).toBeUndefined();
});

it('reinstalls fog branches for each picked view and keeps side views masked', async () => {
  const game = { roomId: 'fog_embed', variant: 'dark-chess', result: 'white-wins', mode: 'pvp' };
  const events = [
    { type: 'room-created', at: 1, roomId: 'fog_embed', variant: 'dark-chess' },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fog_embed',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  vi.stubGlobal('fetch', async (url: string) => {
    const body =
      url === '/api/games/fog_embed'
        ? { game }
        : url.endsWith('/events')
          ? { events }
          : url.endsWith('/analysis')
            ? {
                engineId: 'cached',
                depth: 12,
                plies: [
                  { ply: 0, cp: 250, mate: null, best: 'g1f3' },
                  { ply: 1, cp: -300, mate: null, best: 'g8f6' },
                ],
              }
            : url.endsWith('/decisions')
              ? {
                  engineId: 'cached',
                  depth: 12,
                  decisions: [
                    {
                      ply: 1,
                      mover: 'white',
                      bestWin: 90,
                      playedWin: 40,
                      playedRank: 10,
                      candidates: [
                        { move: 'd2d4', win: 90 },
                        { move: 'e2e4', win: 40, played: true },
                      ],
                    },
                  ],
                }
              : undefined;
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
    };
  });
  const root = document.createElement('div');
  document.body.append(root);
  await mountEmbedGame(root, { roomId: 'fog_embed' }, { pov: 'white' });
  const branch = () => root.querySelector<HTMLButtonElement>('.review-move-list__line-move');
  expect(branch()?.textContent).toBe('d4');
  branch()!.click();
  await vi.waitFor(() =>
    expect(root.querySelectorAll('.embed-game-alternative piece').length).toBeGreaterThan(0),
  );
  expect(root.querySelector('.embed-game-alternative piece.black.king')).toBeNull();
  const whiteBoard = root.querySelector('.embed-game-alternative');
  root.querySelector<HTMLButtonElement>('.embed-pov__button[data-pov="black"]')!.click();
  await vi.waitFor(() =>
    expect(root.querySelector('.embed-game-alternative')).not.toBe(whiteBoard),
  );
  expect(branch()?.textContent).toBe('d4');
  branch()!.click();
  await vi.waitFor(() =>
    expect(root.querySelector('.embed-game-alternative piece.black.king')).not.toBeNull(),
  );
  const blackBoard = root.querySelector('.embed-game-alternative');
  root.querySelector<HTMLButtonElement>('.embed-pov__button[data-pov="truth"]')!.click();
  await vi.waitFor(() =>
    expect(root.querySelector('.embed-game-alternative')).not.toBe(blackBoard),
  );
  branch()!.click();
  await vi.waitFor(() =>
    expect(root.querySelectorAll('.embed-game-alternative piece')).toHaveLength(32),
  );
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(root.querySelector('.embed-game-alternative')?.hasAttribute('hidden')).toBe(true);
  root.remove();
});
