import { importXiangqiGame } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import continuedRecords from '../../../../packages/game/fixtures/xiangqi-notation/adjudicated-records.json';
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
