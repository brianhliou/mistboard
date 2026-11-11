import {
  applyBanqiMove,
  applyJungleFlipMove,
  banqiRulesFromView,
  banqiTruthView,
  createInitialBanqiState,
  createInitialJungleFlipState,
  getBanqiPlayerView,
  getJungleFlipPlayerView,
  jungleFlipTruthView,
  STANDARD_BANQI_DEAL,
  STANDARD_JUNGLE_FLIP_DEAL,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEmbedGame } from '../embed/embed-game-page.js';
import { jungleFlipMarkerSvg } from '../jungle-flip-render.js';
import { banqiMarkerSvg } from '../live-banqi-render.js';
import { mountBanqiReview } from './banqi-review.js';
import {
  banqiLuckDetail,
  banqiLuckPieceSvg,
  jungleFlipLuckDetail,
  jungleFlipLuckPieceSvg,
  publicFlipLuckDetail,
} from './flip-luck.js';
import { computeGameAnalysis } from './game-analysis.js';
import { mountJungleFlipReview } from './jungle-flip-review.js';
import { luckCardHtml } from './luck-mark-card.js';
import type { DecisionOverlay } from './tree-review.js';

const overlay: DecisionOverlay = {
  byPly: new Map([[1, { judgment: null, accuracy: 100, luck: 7, playedRank: 1 }]]),
  red: { reveals: 1, decisionAccuracy: 100 },
  black: { reveals: 0, decisionAccuracy: 100 },
};

describe.each(['banqi', 'jungle-flip'] as const)('%s review luck', (variant) => {
  it('draws the die and opens the shared card from the move badge', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 10,
      chancePlies: [1],
      plies: [0, 1].map((ply) => ({ ply, cp: 0, mate: null, best: null })),
    });
    const config = {
      ariaLabel: 'test',
      title: variant,
      summary: 'test',
      moves: [{ from: 'a1', to: 'a1' }] as const,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
      decisions: { fetchCached: async () => overlay, canRun: true, run: async () => overlay },
    };
    const handle =
      variant === 'banqi'
        ? mountBanqiReview(
            root,
            'luck',
            {
              deal: STANDARD_BANQI_DEAL,
              rules: banqiRulesFromView(getBanqiPlayerView(createInitialBanqiState('luck'), 'red')),
            },
            { ...config, moves: [...config.moves], tablebasePanel: false },
          )
        : mountJungleFlipReview(root, 'luck', STANDARD_JUNGLE_FLIP_DEAL, {
            ...config,
            moves: [...config.moves],
          });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.querySelector('.luck-mark[data-luck-square="a1"]')).not.toBeNull();
      const badge = root.querySelector<HTMLElement>('.review-move-list__luck[data-luck-path]');
      expect(badge).not.toBeNull();
      badge?.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
      );
      expect(document.querySelector('.luck-card--open')?.textContent).toContain('Lucky reveal');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(root.querySelector('.luck-mark')).toBeNull();
    } finally {
      handle.destroy();
      root.remove();
    }
    expect(document.querySelector('.luck-card')).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('public flip odds', () => {
  it('counts both colours for a banqi flip of the opponent ink', () => {
    const before = applyBanqiMove(createInitialBanqiState('odds'), { from: 'a1', to: 'a1' });
    const move = { from: 'b1', to: 'b1' } as const;
    const detail = banqiLuckDetail(move, { before, luck: 7 });
    expect(detail?.color).toBe('black');
    expect(detail?.odds).toMatchObject({ color: 'red', role: 'advisor', count: 2, total: 31 });
    expect(
      detail?.odds?.pool
        .filter((entry) => entry.color === 'red')
        .reduce((n, entry) => n + entry.count, 0),
    ).toBe(15);
    expect(
      detail?.odds?.pool
        .filter((entry) => entry.color === 'black')
        .reduce((n, entry) => n + entry.count, 0),
    ).toBe(16);
    const html = luckCardHtml(detail!, banqiLuckPieceSvg);
    expect(html).toContain('Lucky reveal: Red Advisor (2 in 31)');
    expect(html).toContain("Raised Black's win chance");
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('.luck-card__chip--drawn')).toHaveLength(1);
  });

  it('uses the Flip Jungle animal pool, including seen captures and the Blue ink word', () => {
    const before = applyJungleFlipMove(createInitialJungleFlipState('odds'), {
      from: 'a1',
      to: 'a1',
    });
    // The exposed red rat was captured: it stays outside the hidden inventory.
    delete before.board.a1;
    before.captures.push({ owner: 'red', role: 'rat' });
    const detail = jungleFlipLuckDetail({ from: 'b1', to: 'b1' }, { before, luck: 7 });
    expect(detail?.odds).toMatchObject({ color: 'red', role: 'cat', count: 1, total: 15 });
    expect(detail?.odds?.pool.some((entry) => entry.color === 'red' && entry.role === 'rat')).toBe(
      false,
    );
    const html = luckCardHtml(detail!, jungleFlipLuckPieceSvg);
    expect(html).toContain('Lucky reveal: Red Cat (1 in 15)');
    expect(html).toContain("Raised Blue's win chance");
    expect(html).toContain('title="Blue Rat"');
    expect(html).not.toContain('Black');
  });

  it('keeps the full banqi die and card invariant when two unresolved identities trade places', () => {
    const before = createInitialBanqiState('hidden');
    const swapped = structuredClone(before);
    [swapped.board.b1, swapped.board.h4] = [swapped.board.h4, swapped.board.b1];
    const output = (state: typeof before) => {
      const detail = banqiLuckDetail({ from: 'a1', to: 'a1' }, { before: state, luck: -14 });
      return JSON.stringify({
        detail,
        card: luckCardHtml(detail!, banqiLuckPieceSvg),
        die: banqiMarkerSvg({ square: 'a1', kind: 'luck', luck: { luck: detail!.luck } }),
      });
    };
    expect(output(swapped)).toBe(output(before));
    expect(banqiLuckDetail({ from: 'b1', to: 'h4' }, { before: swapped, luck: 90 })).toBeNull();
  });

  it('keeps the full Flip Jungle die and card invariant when two unresolved animals trade places', () => {
    const before = createInitialJungleFlipState('hidden');
    const swapped = structuredClone(before);
    [swapped.board.b1, swapped.board.d4] = [swapped.board.d4, swapped.board.b1];
    const output = (state: typeof before) => {
      const detail = jungleFlipLuckDetail({ from: 'a1', to: 'a1' }, { before: state, luck: 7 });
      return JSON.stringify({
        detail,
        card: luckCardHtml(detail!, jungleFlipLuckPieceSvg),
        die: jungleFlipMarkerSvg({ square: 'a1', kind: 'luck', luck: { luck: detail!.luck } }),
      });
    };
    expect(output(swapped)).toBe(output(before));
    expect(
      jungleFlipLuckDetail({ from: 'b1', to: 'd4' }, { before: swapped, luck: 90 }),
    ).toBeNull();
  });

  it('needs no identities underneath the public face-down tiles', () => {
    const before = createInitialJungleFlipState('public');
    const after = applyJungleFlipMove(before, { from: 'a1', to: 'a1' });
    const detail = publicFlipLuckDetail(
      'jungle-flip',
      { from: 'a1', to: 'a1' },
      7,
      getJungleFlipPlayerView(before, 'red'),
      after.board.a1!,
    );
    expect(detail?.odds).toMatchObject({ role: 'rat', color: 'red', count: 1, total: 16 });
  });
});

describe.each(['banqi', 'jungle-flip'] as const)('%s game embed luck', (variant) => {
  it('draws the die and lets the badge open the card from public history', async () => {
    const move = { from: 'a1', to: 'a1' } as const;
    const before =
      variant === 'banqi'
        ? createInitialBanqiState('embedded')
        : createInitialJungleFlipState('embedded');
    const after =
      variant === 'banqi'
        ? applyBanqiMove(before as ReturnType<typeof createInitialBanqiState>, move)
        : applyJungleFlipMove(before as ReturnType<typeof createInitialJungleFlipState>, move);
    const view = (state: typeof before) =>
      variant === 'banqi'
        ? getBanqiPlayerView(state as ReturnType<typeof createInitialBanqiState>, 'red')
        : getJungleFlipPlayerView(state as ReturnType<typeof createInitialJungleFlipState>, 'red');
    const game = {
      roomId: 'embedded',
      variant,
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      rated: false,
      firstColor: 'red',
      visibility: 'public',
    };
    const postgame = {
      game,
      state: { status: after.status, moveNumber: after.moveNumber },
      view: view(after),
      timeline: [{ type: 'move-played', ply: 1, color: 'red', move }],
      history: {
        truth: [
          { ply: 0, view: view(before) },
          { ply: 1, view: view(after) },
        ],
        // A complete dealt stream exists, but the luck code must not count it.
        revealed: [
          {
            ply: 0,
            view:
              variant === 'banqi'
                ? banqiTruthView(before as ReturnType<typeof createInitialBanqiState>)
                : jungleFlipTruthView(before as ReturnType<typeof createInitialJungleFlipState>),
          },
        ],
      },
    };
    const bodies: Record<string, unknown> = {
      '/api/games/embedded': { game },
      [`/api/${variant}/games/embedded`]: postgame,
      [`/api/${variant}/games/embedded/analysis`]: {
        engineId: 'test',
        depth: 10,
        chancePlies: [1],
        plies: [0, 1].map((ply) => ({ ply, cp: 0, mate: null, best: null })),
      },
      [`/api/${variant}/games/embedded/decisions`]: {
        engineId: 'test',
        depth: 10,
        decisions: [
          { ply: 1, mover: 'red', bestWin: 50, playedWin: 50, realizedWin: 57, playedRank: 1 },
        ],
      },
    };
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      requests.push(String(url));
      const body = bodies[String(url)];
      return {
        ok: body !== undefined,
        status: body === undefined ? 204 : 200,
        json: async () => body,
      };
    });
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedGame(root, { roomId: 'embedded' }, { startPly: 1 });
    expect(root.querySelector('.luck-mark[data-luck-square="a1"]')).not.toBeNull();
    const badge = root.querySelector<HTMLElement>('.review-move-list__luck[data-luck-path="1"]');
    expect(badge?.textContent).toBe('🎲 +7%');
    badge?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    const card = document.querySelector('.luck-card--open');
    expect(card?.textContent).toContain(
      variant === 'banqi' ? 'Red General (1 in 32)' : 'Red Rat (1 in 16)',
    );
    expect(requests).toContain(`/api/${variant}/games/embedded`);
  });
});
