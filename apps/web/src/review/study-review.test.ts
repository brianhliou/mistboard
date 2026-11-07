import { importXiangqiGame } from '@mistboard/game';
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
