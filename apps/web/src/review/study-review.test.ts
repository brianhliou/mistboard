import { createGomokuRoomState, gomokuFen, importXiangqiGame } from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import continuedRecords from '../../../../packages/game/fixtures/xiangqi-notation/adjudicated-records.json';
import * as ceval from './engine/ceval.js';
import { makeFFQBanqiStudyTreeAdapter } from './ffq-banqi-tree-adapter.js';
import { jieqiDecisionOverlay, summarizeDecisions } from './jieqi-decisions.js';
import { fetchStudyChapterDecisions } from './study-decisions.js';
import { mountStudyReview } from './study-review.js';
import type { SerializedTree } from './tree-serialize.js';
import { deserializeTree } from './tree-serialize.js';
import { importXiangqiPgnChapters } from './xiangqi-pgn-chapter.js';

function mainlinePlies(tree: SerializedTree): number {
  let plies = 0;
  for (let node = tree.root.children[0]; node; node = node.children[0]) plies++;
  return plies;
}

describe('Fanfanqi observed study review', () => {
  const tree: SerializedTree = {
    version: 1,
    replay: 'ffq-banqi-public-v1',
    initialRevealed: [
      { color: 'red', role: 'cannon' },
      { color: 'black', role: 'horse' },
      { color: 'red', role: 'soldier' },
      { color: 'black', role: 'advisor' },
    ],
    root: {
      annotations: {
        comments: [{ text: 'Observed opening.', by: 'u1', i18n: { en: 'Observed opening.' } }],
        glyphs: [1],
        shapes: [{ kind: 'circle', brush: 'green', orig: 'b3' }],
        gamebook: { hint: 'Consider the pool.', deviation: 'Try the recorded continuation.' },
      },
      children: [
        {
          uci: 'c1a1x:G',
          annotations: { comments: [{ text: 'Public covered capture.' }] },
          children: [{ uci: '@a0:c', children: [] }],
        },
        { uci: '@b0:A', children: [] },
      ],
    },
  };
  it('round-trips public opening, observed branches and notes with pool-mean grades', async () => {
    const adapter = makeFFQBanqiStudyTreeAdapter(tree.initialRevealed!);
    const rebuilt = deserializeTree(adapter, tree);
    const frames = [
      rebuilt.root,
      ...rebuilt.root.children,
      ...rebuilt.root.children[0]!.children,
    ].map((node) => node.truth);
    for (const snapshot of frames) {
      const payload = JSON.parse(JSON.stringify(snapshot));
      for (const piece of payload.view.board)
        if (piece?.faceDown) expect(piece).toEqual({ faceDown: true });
      expect(JSON.stringify(payload)).not.toMatch(/deal|seed|unknownRole/);
    }
    expect(frames[1]!.view.hp).toEqual({ red: 30, black: 60 });
    expect(frames[1]!.damage).toEqual({ red: 30, black: 0 });
    expect(frames[2]!.view.hp).toEqual({ red: 60, black: 60 });
    expect(frames[2]!.view.board[0]).toEqual({ faceDown: true });
    const root = document.createElement('div');
    document.body.append(root);
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({
        decisions: [
          {
            ply: 1,
            mover: 'red',
            bestWin: 70,
            playedWin: 50,
            realizedWin: 62,
            playedRank: 2,
            candidates: [
              { move: 'b0b0', win: 70 },
              { move: 'c1a1', win: 50, played: true },
            ],
          },
          {
            ply: 2,
            mover: 'black',
            bestWin: 50,
            playedWin: 50,
            realizedWin: 45,
            playedRank: 1,
            candidates: [{ move: 'a0a0', win: 50, played: true }],
          },
        ],
      }),
    }));
    const overlay = await fetchStudyChapterDecisions('ffq-banqi', 's', 'c', tree);
    const handle = await mountStudyReview('ffq-banqi', root, {
      title: 'Observed game',
      summary: '',
      ariaLabel: 'Study board',
      reviewSurface: 'study',
      initialTree: tree,
      initialPosition: 'end',
      storedDecisions: Promise.resolve(overlay),
    });
    try {
      expect(overlay?.byPly.get(1)).toMatchObject({ judgment: 'blunder', luck: 12, playedRank: 2 });
      expect(overlay?.byPly.get(1)?.candidates?.[0]?.label).toBe('a2 flip');
      // Decided 2026-11-15: per-move luck only, no per-seat totals.
      expect(overlay).not.toHaveProperty('totals');
      expect(handle.serialize()).toEqual(tree);
      expect(JSON.stringify(handle.serialize())).not.toMatch(/rootFen|deal|seed|board|general/);
      await vi.waitFor(() =>
        expect(root.querySelector('.review-move-list__luck')?.textContent).toContain('+12%'),
      );
      root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
      expect(handle.serialize()).toEqual(tree);
      root.querySelector<HTMLButtonElement>('[data-replay="next"]')?.click();
      expect(handle.serialize()).toEqual(tree);
    } finally {
      handle.destroy();
      root.remove();
      vi.unstubAllGlobals();
    }
  });
  it('rejects missing opening observations and dealt roots', async () => {
    for (const initialTree of [
      { ...tree, initialRevealed: undefined },
      { ...tree, rootFen: 'secret' },
    ]) {
      await expect(
        mountStudyReview('ffq-banqi', document.createElement('div'), {
          title: '',
          summary: '',
          ariaLabel: 'Study board',
          initialTree,
        }),
      ).rejects.toThrow();
    }
  });
});

describe('xiangqi study record loading', () => {
  for (const record of continuedRecords.cases) {
    it(`preserves ${record.key} past ${record.reason} when loading and saving a chapter`, async () => {
      const imported = importXiangqiGame(record.iccs);
      expect(imported.error).toBeUndefined();
      const pgn = `${imported.moves.map((move) => `${move.from}${move.to}`).join(' ')} {Played on} *`;
      const { chapters, skipped } = importXiangqiPgnChapters(pgn);
      expect(skipped).toEqual([]);
      expect(chapters).toHaveLength(1);
      const chapter = chapters[0]!;
      expect(chapter.warning).toBeUndefined();
      expect(chapter.plyCount).toBe(record.plies);

      const root = document.createElement('div');
      document.body.append(root);
      const handle = await mountStudyReview('xiangqi', root, {
        title: chapter.name,
        summary: '',
        ariaLabel: 'Study board',
        initialTree: chapter.root,
        initialPosition: 'start',
      });
      try {
        expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
        // A study rebuilds positions from UCIs. Its saved tree must retain the
        // entire imported line and its annotations, including after the draw.
        const saved = handle.serialize();
        expect(mainlinePlies(saved)).toBe(record.plies);
        expect(saved).toEqual(chapter.root);
      } finally {
        handle.destroy();
        root.remove();
      }
    });
  }
});

describe('Jieqi study rule selection', () => {
  it.each([0, 85])(
    'preserves local rules at clock %i while the engine uses jqe-v1',
    async (clock) => {
      vi.spyOn(ceval, 'cevalSupported').mockReturnValue(true);
      const evaluate = vi.fn(async (_request: ceval.CevalRequest) => ({
        depth: 0,
        seldepth: 0,
        nodes: 0,
        nps: 0,
        lines: [],
      }));
      vi.spyOn(ceval, 'createCeval').mockReturnValue({
        variant: 'jieqi',
        preload: async () => {},
        evaluate,
        stop: vi.fn(),
        dispose: vi.fn(),
      });
      const root = document.createElement('div');
      document.body.append(root);
      const rootFen = `xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 ${clock} 1 prnabpbrccppanpCNPNAPAPBRPPRCB`;
      const tree: SerializedTree = {
        version: 1,
        rootFen,
        root: { children: [{ uci: 'i4i5', children: [{ uci: 'a7a6', children: [] }] }] },
      };
      const handle = await mountStudyReview('jieqi', root, {
        title: 'Rules',
        summary: '',
        ariaLabel: 'Study board',
        reviewSurface: 'study',
        rootFen,
        initialTree: tree,
        initialPosition: 'end',
      });
      try {
        // Loading must retain the whole chapter for the owner's next autosave,
        // including the second quiet move past jqe-v1's 80-ply limit.
        expect(handle.serialize()).toEqual(tree);
        root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
        expect(evaluate.mock.lastCall![0]).toMatchObject({ jieqiRule: 'jqe-v1', movesUci: [] });
        expect(evaluate.mock.lastCall![0].initialFen?.split(' ')[3]).toBe(String(clock + 2));
        root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
        expect(evaluate.mock.lastCall![0].jieqiRule).toBe('jqe-v1');
        expect(handle.serialize()).toEqual(tree);
      } finally {
        handle.destroy();
        root.remove();
        vi.restoreAllMocks();
      }
    },
  );
});

describe('jieqi study face-down faces', () => {
  it('draws a hover face on the face-down tiles, like the finished-game review', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountStudyReview('jieqi', root, {
      title: 'Faces',
      summary: '',
      ariaLabel: 'Study board',
      reviewSurface: 'study',
      rootFen:
        'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB',
      initialTree: { version: 1, root: { children: [{ uci: 'i4i5', children: [] }] } },
      initialPosition: 'end',
    });
    try {
      await vi.waitFor(() =>
        expect(root.querySelectorAll('.facedown-face').length).toBeGreaterThan(0),
      );
    } finally {
      handle.destroy();
      root.remove();
    }
  });
});

describe('jieqi study luck without analysis', () => {
  it('renders the move badge, calls the board luck marker and opens the reveal card', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const overlay = jieqiDecisionOverlay(
      summarizeDecisions([{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 62 }]),
    );
    const handle = await mountStudyReview('jieqi', root, {
      title: 'Luck',
      summary: '',
      ariaLabel: 'Study board',
      reviewSurface: 'study',
      rootFen:
        'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB',
      initialTree: { version: 1, root: { children: [{ uci: 'i4i5', children: [] }] } },
      initialPosition: 'end',
      storedDecisions: Promise.resolve(overlay),
    });
    try {
      await vi.waitFor(() =>
        expect(root.querySelector('.review-move-list__luck')?.textContent).toBe('🎲 +12%'),
      );
      // This die is produced only by the presentation's moveLuckMarker hook.
      expect(root.querySelector('.luck-mark[data-luck-square="i5"]')).not.toBeNull();
      expect(root.querySelector('.review-move-list__suffix')?.textContent).toBe('');
      const badge = root.querySelector<HTMLElement>('.review-move-list__luck')!;
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => expect(document.querySelector('.luck-card')).not.toBeNull());
    } finally {
      handle.destroy();
      root.remove();
    }
  });
});

describe('Gomoku study chapters', () => {
  const opening = {
    stones: [{ square: 'h8' as const, color: 'black' as const }],
    turn: 'white' as const,
  };
  const dealtFen = gomokuFen(createGomokuRoomState('study-test', opening));

  for (const rootFen of [undefined, gomokuFen(createGomokuRoomState('empty')), dealtFen]) {
    it(`opens and saves a chapter from ${rootFen === dealtFen ? 'a White-to-move dealt root' : rootFen ? 'an explicit empty root' : 'an implicit empty root'}`, async () => {
      const root = document.createElement('div');
      document.body.append(root);
      const tree: SerializedTree = {
        version: 1,
        ...(rootFen ? { rootFen } : {}),
        root: {
          children: [
            {
              uci: 'a1',
              annotations: { comments: [{ text: 'First placement' }] },
              children: [{ uci: 'o15', children: [] }],
            },
          ],
        },
      };
      const config = {
        title: 'Gomoku chapter',
        summary: '',
        ariaLabel: 'Study board',
        reviewSurface: 'study' as const,
        rootFen,
        initialTree: tree,
        initialPosition: 'end' as const,
      };
      let handle = await mountStudyReview('gomoku', root, config);
      try {
        const stones = () => [...root.querySelectorAll('[data-piece-square]')];
        expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
        expect(stones()).toHaveLength(rootFen === dealtFen ? 3 : 2);
        expect(
          root.querySelector(
            `[data-piece-square="a1"].gomoku-stone--${rootFen === dealtFen ? 'white' : 'black'}`,
          ),
        ).not.toBeNull();
        expect(handle.serialize()).toEqual(tree);
        root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
        expect(stones()).toHaveLength(rootFen === dealtFen ? 1 : 0);
        root
          .querySelector('[data-square="b2"] .gomoku-hit')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const saved = handle.serialize();
        expect(saved.root.children.map((node) => node.uci)).toEqual(['a1', 'b2']);
        handle.destroy();
        handle = await mountStudyReview('gomoku', root, { ...config, initialTree: saved });
        expect(handle.serialize()).toEqual(saved);
      } finally {
        handle.destroy();
        root.remove();
      }
    });
  }

  it('refuses an unknown variant without mounting another board', async () => {
    const root = document.createElement('div');
    await expect(
      mountStudyReview('unknown' as Parameters<typeof mountStudyReview>[0], root, {
        title: '',
        summary: '',
        ariaLabel: 'Study board',
      }),
    ).rejects.toThrow('unsupported study variant: unknown');
    expect(root.children).toHaveLength(0);
  });
});
