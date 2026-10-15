import { xiangqiEndgamePracticeRouteFromPath } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { resolvePracticeChapterHref } from './practice-chapter-redirect.js';

// The article-level cases (every table row on prod and on a local pair) live in
// articles/xiangqi-endgames.test.ts; these are the bounce page's degradations.

const PATH = '/practice/endgames-horse/horse-vs-advisor';
const FEN = xiangqiEndgamePracticeRouteFromPath(PATH)?.chapter.fen ?? '';

const catalogue = { sections: [{ cards: [{ slug: 'endgames-horse', studyId: 'Horse1' }] }] };

describe('resolvePracticeChapterHref', () => {
  it('opens the first chapter whose root is the position', async () => {
    const href = await resolvePracticeChapterHref(PATH, async (url) =>
      url === '/api/practice'
        ? catalogue
        : {
            chapters: [
              { id: 'other', root: { rootFen: '4k4/9/9/9/9/9/9/9/9/4K4 r - - 0 1' } },
              { id: 'first', root: { rootFen: FEN } },
              { id: 'orphan', root: { rootFen: FEN } },
            ],
          },
    );
    expect(href).toBe('/study/Horse1/first');
  });

  it('sends a path that is no set/position pair to the shelf without fetching', async () => {
    const fetched: string[] = [];
    const fetchJson = async (url: string) => {
      fetched.push(url);
      return catalogue;
    };
    expect(
      await resolvePracticeChapterHref('/practice/endgames-soldier/horse-vs-advisor', fetchJson),
    ).toBe('/practice');
    expect(fetched).toEqual([]);
  });

  it('falls back to the shelf when the catalogue fails, and to the set when the study does', async () => {
    expect(
      await resolvePracticeChapterHref(PATH, async () => {
        throw new Error('500');
      }),
    ).toBe('/practice');
    expect(
      await resolvePracticeChapterHref(PATH, async (url) => {
        if (url === '/api/practice') return catalogue;
        throw new Error('404');
      }),
    ).toBe('/study/Horse1');
  });
});
