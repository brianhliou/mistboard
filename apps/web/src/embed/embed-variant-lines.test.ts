import {
  applyBanqiMove,
  applyJungleFlipMove,
  banqiTruthView,
  createInitialBanqiState,
  createInitialJungleFlipState,
  type GameEvent,
  getBanqiPlayerView,
  getJungleFlipPlayerView,
  jungleFlipTruthView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicXiangqiTreeAdapter } from '../review/atomic-xiangqi-tree-adapter.js';
import { makeBanqiTreeAdapter, recoverBanqiDeal } from '../review/banqi-tree-adapter.js';
import { darkChessTreeAdapter } from '../review/dark-chess-tree-adapter.js';
import { fortressXiangqiTreeAdapter } from '../review/fortress-xiangqi-tree-adapter.js';
import type { VariantTreeAdapter } from '../review/game-tree.js';
import {
  makeJungleFlipTreeAdapter,
  recoverJungleFlipDeal,
} from '../review/jungle-flip-tree-adapter.js';
import { jungleTreeAdapter } from '../review/jungle-tree-adapter.js';
import { xiangqiTreeAdapter } from '../review/xiangqi-tree-adapter.js';
import { loadStoredAlternatives, storedAlternativeViews } from './embed-variant-lines.js';

afterEach(() => vi.unstubAllGlobals());

function openFixture<Move, Truth, View extends { legalMoves: Move[] }>(
  adapter: VariantTreeAdapter<Move, Truth, View>,
) {
  const root = adapter.initialTruth();
  const moves = adapter.project(root)[0]!.view.legalMoves;
  const played = moves[0]!;
  const alternative = moves[1]!;
  const timeline = [{ type: 'move-played', move: played }];
  const bestMoves = new Map([[1, adapter.toEngineUci(alternative)]]);
  const lines = storedAlternativeViews(adapter, timeline, bestMoves);
  const expected = adapter.project(adapter.applyMove(root, alternative))[0]!.view;
  return { root, played, alternative, timeline, bestMoves, lines, expected };
}

describe('stored public alternatives', () => {
  it.each([
    ['xiangqi', () => openFixture(xiangqiTreeAdapter)],
    ['atomic-xiangqi', () => openFixture(atomicXiangqiTreeAdapter)],
    ['fortress-xiangqi', () => openFixture(fortressXiangqiTreeAdapter)],
    ['jungle', () => openFixture(jungleTreeAdapter)],
  ] as const)(
    'replays one legal %s recommendation and mounts its board',
    async (specId, fixture) => {
      const { timeline, bestMoves, lines, expected } = fixture();
      expect(lines.size).toBe(1);
      expect(JSON.parse(JSON.stringify([...lines]))[0][1].view).toEqual(
        JSON.parse(JSON.stringify(expected)),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ timeline }),
        })),
      );
      const loaded = await loadStoredAlternatives(specId, 'public-game', bestMoves, 'black');
      expect(loaded.size).toBe(1);
      const host = document.createElement('div');
      loaded.get(1)!.mount(host);
      expect(host.querySelector('svg')).not.toBeNull();
      if (specId === 'fortress-xiangqi')
        expect(host.querySelectorAll('.fxq-embed-hand')).toHaveLength(2);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/${specId}/games/public-game`);
    },
  );

  it('rejects illegal, malformed, out-of-record and same-as-played advice', () => {
    const { timeline, played } = openFixture(xiangqiTreeAdapter);
    for (const uci of [
      'a1a10',
      'garbage',
      'z1z2',
      'b3e3 trailing',
      xiangqiTreeAdapter.toEngineUci(played),
    ]) {
      expect(storedAlternativeViews(xiangqiTreeAdapter, timeline, new Map([[1, uci]])).size).toBe(
        0,
      );
    }
    expect(storedAlternativeViews(xiangqiTreeAdapter, timeline, new Map([[2, 'b3e3']])).size).toBe(
      0,
    );
    expect(
      storedAlternativeViews(xiangqiTreeAdapter, [{ type: 'move-played' }], new Map([[1, 'b3e3']]))
        .size,
    ).toBe(0);
    expect(
      storedAlternativeViews(
        xiangqiTreeAdapter,
        [...timeline, { type: 'move-played', move: { from: 'a1', to: 'a10' } }],
        new Map([[1, 'b3e3']]),
      ).size,
    ).toBe(0);
  });

  it('rejects unknown variants and unavailable records without starting compute', async () => {
    const fetcher = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetcher);
    for (const id of ['toString', 'unknown', 'jieqi', 'chess', 'dark-xiangqi']) {
      expect((await loadStoredAlternatives(id, 'r', new Map([[1, 'b3e3']]), null)).size).toBe(0);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect((await loadStoredAlternatives('xiangqi', 'r', new Map([[1, 'b3e3']]), null)).size).toBe(
      0,
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/xiangqi/games/r');
  });

  it('replays fortress drops using the stored engine dialect and updates the hand', () => {
    const root = fortressXiangqiTreeAdapter.initialTruth();
    root.hands.red.horse = 1;
    const adapter = { ...fortressXiangqiTreeAdapter, initialTruth: () => root };
    const played = adapter.project(root)[0]!.view.legalMoves.find((m) => 'from' in m)!;
    const lines = storedAlternativeViews(
      adapter,
      [{ type: 'move-played', move: played }],
      new Map([[1, 'N@b4']]),
    );
    expect(lines.get(1)?.view.board.b4).toMatchObject({ color: 'red', role: 'horse' });
    expect(lines.get(1)?.view.hands.red.horse ?? 0).toBe(0);
  });
});

describe('hidden deal alternatives', () => {
  it.each(['banqi', 'jungle-flip'] as const)(
    'uses only actual public reveals for %s',
    async (specId) => {
      const flipA = { from: 'a1', to: 'a1' } as const;
      const flipB = { from: 'b1', to: 'b1' } as const;
      const timeline = [flipA, flipB].map((move) => ({ type: 'move-played', move }));
      const banqiRoot = createInitialBanqiState('r');
      const jungleRoot = createInitialJungleFlipState('r');
      const record =
        specId === 'banqi'
          ? {
              timeline,
              view: getBanqiPlayerView(
                applyBanqiMove(applyBanqiMove(banqiRoot, flipA), flipB),
                'red',
              ),
              history: { revealed: [{ ply: 0, view: banqiTruthView(banqiRoot) }] },
            }
          : {
              timeline,
              view: getJungleFlipPlayerView(
                applyJungleFlipMove(applyJungleFlipMove(jungleRoot, flipA), flipB),
                'red',
              ),
              history: { revealed: [{ ply: 0, view: jungleFlipTruthView(jungleRoot) }] },
            };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => record })),
      );
      // b1 was actually revealed later. Engine rank 0 is platform rank 1.
      const known = await loadStoredAlternatives(specId, 'r', new Map([[1, 'b0b0']]), null);
      expect(known.size).toBe(1);
      const host = document.createElement('div');
      known.get(1)!.mount(host);
      expect(host.querySelectorAll('svg').length).toBeGreaterThan(0);
      // c1 never turned over in the public record, even though the revealed
      // root knows its identity. It cannot become a playable recommendation.
      expect((await loadStoredAlternatives(specId, 'r', new Map([[1, 'c0c0']]), null)).size).toBe(
        0,
      );
      expect((await loadStoredAlternatives(specId, 'r', new Map([[1, 'b0c0']]), null)).size).toBe(
        0,
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => ({ ...record, history: {} }) })),
      );
      expect((await loadStoredAlternatives(specId, 'r', new Map([[1, 'b0b0']]), null)).size).toBe(
        0,
      );

      const banqi = makeBanqiTreeAdapter('r', {
        deal: recoverBanqiDeal(banqiTruthView(banqiRoot)),
        rules: {},
      });
      const jungle = makeJungleFlipTreeAdapter(
        'r',
        recoverJungleFlipDeal(jungleFlipTruthView(jungleRoot)),
      );
      const data =
        specId === 'banqi'
          ? storedAlternativeViews(banqi, timeline, new Map([[1, 'b1b1']]))
          : storedAlternativeViews(jungle, timeline, new Map([[1, 'b1b1']]));
      // Serialize the entire branch data boundary, including legal moves and
      // captures. No truth state or unflipped colour/role may accompany the view.
      const serialized = JSON.parse(JSON.stringify([...data]));
      expect(serialized).toHaveLength(1);
      const branch = serialized[0][1];
      expect(Object.keys(branch).sort()).toEqual(['label', 'view']);
      for (const [square, piece] of Object.entries(branch.view.board)) {
        if (square === 'b1') expect(piece).toMatchObject({ faceDown: false });
        else expect(piece).toEqual({ faceDown: true });
      }
      expect(branch.view).not.toHaveProperty('deal');
      expect(branch.view).not.toHaveProperty('truth');
    },
  );
});

it('projects fog alternatives for the selected side without truth in the serialized view', () => {
  const timeline: GameEvent[] = [
    { type: 'move-played', at: 1, roomId: 'r', color: 'white', move: { from: 'e2', to: 'e4' } },
  ];
  const lines = storedAlternativeViews(darkChessTreeAdapter, timeline, new Map([[1, 'd2d4']]), {
    viewKey: 'white',
  });
  const serialized = JSON.parse(JSON.stringify([...lines]));
  expect(serialized).toHaveLength(1);
  const view = serialized[0][1].view;
  expect(view.lastMove).toEqual({ from: 'd2', to: 'd4' });
  expect(view.board.d4).toMatchObject({ color: 'white', role: 'pawn' });
  expect(view.board.e8).toBeUndefined();
  expect(view.board.d8).toBeUndefined();
  expect(Object.keys(view.board).every((square) => view.visibleSquares.includes(square))).toBe(
    true,
  );
});
