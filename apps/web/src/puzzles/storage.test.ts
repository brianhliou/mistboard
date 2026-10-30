import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleSummary } from './adapter.js';
import { loadSeenPuzzles, rotatePuzzleOrder, saveSeenPuzzles } from './storage.js';

function puzzle(id: string, rating: number, theme: string): PuzzleSummary {
  return {
    id,
    variant: 'xiangqi',
    title: id,
    sideToMove: 'red',
    goal: { type: 'winning-advantage', winner: 'red' },
    themes: [theme],
    motifs: [],
    solutionPlyCount: 3,
    rating,
    ratingProvisional: false,
  };
}

describe('adaptive puzzle rotation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts near the player rating, explores, then appends oldest seen puzzles', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const puzzles = [
      puzzle('far', 2100, 'mate'),
      puzzle('near', 1510, 'fork'),
      puzzle('nearer', 1495, 'pin'),
      puzzle('mid', 1650, 'capture'),
      puzzle('explore', 2300, 'quiet'),
      puzzle('seen-new', 1500, 'fork'),
      puzzle('seen-old', 1500, 'fork'),
    ];
    const ordered = rotatePuzzleOrder(
      puzzles,
      new Map([
        ['seen-new', 20],
        ['seen-old', 10],
      ]),
      new Map([['xiangqi', 1500]]),
    );

    // The two unseen puzzles within 100 of the target come first, in either
    // order; seen puzzles stay last, oldest first.
    expect(new Set(ordered.slice(0, 2).map(({ id }) => id))).toEqual(new Set(['near', 'nearer']));
    expect(ordered[2]?.id).toBe('mid');
    expect(ordered.slice(0, 5).map(({ id }) => id)).toContain('explore');
    expect(ordered.slice(-2).map(({ id }) => id)).toEqual(['seen-old', 'seen-new']);
  });

  // A corpus shaped like prod's around 1500: a few dozen puzzles per 100 points.
  const corpus = Array.from({ length: 300 }, (_, i) =>
    puzzle(`p-${i}`, 1200 + ((i * 37) % 600), ['mate', 'fork', 'pin', 'capture'][i % 4]!),
  );
  it('opens fresh visits on different first five puzzles', () => {
    // Puzzles 45 points apart, more than the old 0-30 jitter, and only five
    // within the explore window: nearest-first served this exact first five on
    // every visit with nothing seen. A band draw varies it.
    const sparse = [
      ...[1500, 1545, 1590, 1635, 1680].map((rating, i) => puzzle(`s-${i}`, rating, `t${i}`)),
      ...Array.from({ length: 20 }, (_, i) => puzzle(`far-${i}`, 2400 + i, `f${i}`)),
    ];
    const visit = (): string =>
      rotatePuzzleOrder(sparse, new Map(), new Map([['xiangqi', 1500]]))
        .slice(0, 5)
        .map(({ id }) => id)
        .join(',');
    const firstFives = new Set(Array.from({ length: 10 }, visit));
    expect(firstFives.size).toBeGreaterThan(1);
  });

  it('opens on any puzzle in the near band, not only the nearest few', () => {
    const openers = new Set(
      Array.from(
        { length: 40 },
        () => rotatePuzzleOrder(corpus, new Map(), new Map([['xiangqi', 1500]]))[0]!.id,
      ),
    );
    expect(openers.size).toBeGreaterThan(20);
  });

  it('draws the matched picks inside the band around the target', () => {
    for (let visit = 0; visit < 20; visit += 1) {
      const ordered = rotatePuzzleOrder(corpus, new Map(), new Map([['xiangqi', 1500]]));
      for (const [index, { rating }] of ordered.slice(0, 20).entries()) {
        // Every fifth pick explores within 300; the rest stay within 100.
        expect(Math.abs(rating - 1500)).toBeLessThanOrEqual(index % 5 === 4 ? 300 : 100);
      }
    }
  });

  it('widens outward once the near band is used up', () => {
    const ordered = rotatePuzzleOrder(corpus, new Map(), new Map([['xiangqi', 1500]]));
    const meanDistance = (slice: readonly PuzzleSummary[]) =>
      slice.reduce((sum, { rating }) => sum + Math.abs(rating - 1500), 0) / slice.length;
    expect(meanDistance(ordered.slice(0, 50))).toBeLessThan(meanDistance(ordered.slice(-50)));
  });
});

describe('seen-set capacity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('remembers more puzzles than the served corpus so rotation does not recycle', () => {
    // The cap bounds localStorage, but if it falls below the corpus then
    // eviction re-serves puzzles the visitor has already seen while genuinely
    // unseen ones wait. At 200 against a 1,605-puzzle corpus that happened
    // after 200 puzzles with ~1,400 untouched.
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });

    const CORPUS = 1_605;
    const seen = new Map<string, number>();
    for (let index = 0; index < CORPUS; index += 1) seen.set(`puzzle-${index}`, index);
    saveSeenPuzzles(seen);

    const reloaded = loadSeenPuzzles();
    expect(reloaded.size).toBe(CORPUS);
    // The oldest entry must survive: it is the one eviction drops first, and
    // dropping it is what makes an already-seen puzzle look unseen.
    expect(reloaded.has('puzzle-0')).toBe(true);
    expect(reloaded.has(`puzzle-${CORPUS - 1}`)).toBe(true);
  });
});

describe('bounded explore', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the explore pick near the viewer rating instead of anywhere in the pool', () => {
    // The explore pick ignores rating scoring on purpose. Drawing it uniformly
    // was harmless while every puzzle shared one of four depth-derived
    // ratings; once a real difficulty prior spread them across 1255-2600 it
    // started handing a 1300-rated viewer a 2600 puzzle.
    const near = Array.from({ length: 20 }, (_, i) => puzzle(`near-${i}`, 1300 + i, 'fork'));
    const wild = Array.from({ length: 20 }, (_, i) => puzzle(`wild-${i}`, 2400 + i, 'mate'));

    // Sweep the random draw across its whole range so the assertion does not
    // depend on one lucky value.
    const picked = new Set<string>();
    for (let r = 0; r < 1; r += 0.05) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      for (const p of rotatePuzzleOrder(
        [...near, ...wild],
        new Map(),
        new Map([['xiangqi', 1300]]),
      )) {
        picked.add(p.id);
      }
      vi.restoreAllMocks();
    }
    // Everything still appears -- this bounds WHERE the explore pick draws
    // from, it does not remove puzzles from the queue.
    expect(picked.size).toBe(40);

    // With a 1300 target, the first several picks must all come from the near
    // band: the four scored picks by rating, and the 5th by the explore window.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const ordered = rotatePuzzleOrder([...near, ...wild], new Map(), new Map([['xiangqi', 1300]]));
    const firstTen = ordered.slice(0, 10);
    expect(firstTen.every(({ id }) => id.startsWith('near-'))).toBe(true);
  });

  it('widens the window when nothing sits near the target', () => {
    // A viewer far outside the corpus still gets variety, from the closest
    // band available rather than nothing.
    const only = Array.from({ length: 10 }, (_, i) => puzzle(`only-${i}`, 2400 + i, 'mate'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ordered = rotatePuzzleOrder(only, new Map(), new Map([['xiangqi', 1000]]));
    expect(ordered).toHaveLength(10);
    expect(new Set(ordered.map(({ id }) => id)).size).toBe(10);
  });
});
