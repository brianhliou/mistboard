import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A review board that draws the Board coordinates setting must re-render when
// it changes; banqi, Jungle, Flip Jungle and both chess reviews drew it once at
// mount and ignored the toggle until reload (2026-11-05).
const here = dirname(fileURLToPath(import.meta.url));

// Reviews whose board draws no coordinates, so a settings change has nothing to redraw.
const NO_COORDINATES = new Set(['three-kingdoms-banqi-review.ts']);

function treeReviewMounts(): string[] {
  return readdirSync(here).filter(
    (name) =>
      name.endsWith('-review.ts') &&
      name !== 'tree-review.ts' &&
      readFileSync(join(here, name), 'utf8').includes('mountTreeReview('),
  );
}

describe('review boards follow the coordinates setting', () => {
  it('finds the tree review mounts', () => {
    expect(treeReviewMounts()).toEqual(
      expect.arrayContaining(['banqi-review.ts', 'jungle-review.ts', 'gomoku-review.ts']),
    );
  });

  it('every tree review mount re-renders on an appearance event', () => {
    const missing = treeReviewMounts().filter(
      (name) =>
        !NO_COORDINATES.has(name) &&
        !/appearanceEvent:/.test(readFileSync(join(here, name), 'utf8')),
    );
    expect(missing).toEqual([]);
  });

  it('the snapshot Duck Xiangqi review re-renders and re-fits on the setting', () => {
    const source = readFileSync(join(here, '..', 'duck-xiangqi-postgame.ts'), 'utf8');
    expect(source).toMatch(/appearanceEvent: DISPLAY_PREFERENCES_CHANGE_EVENT/);
    expect(source).toMatch(/resolveBoardAspect:/);
  });
});
