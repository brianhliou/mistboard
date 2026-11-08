import { createGomokuRoomState, gomokuFen, importXiangqiGame } from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import continuedRecords from '../../../../packages/game/fixtures/xiangqi-notation/adjudicated-records.json';
import { jieqiDecisionOverlay, summarizeDecisions } from './jieqi-decisions.js';
import { mountStudyReview } from './study-review.js';
import type { SerializedTree } from './tree-serialize.js';
import { importXiangqiPgnChapters } from './xiangqi-pgn-chapter.js';

function mainlinePlies(tree: SerializedTree): number {
  let plies = 0;
  for (let node = tree.root.children[0]; node; node = node.children[0]) plies++;
  return plies;
}

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
