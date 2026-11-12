import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStudyChapterDecisions } from './study-decisions.js';

const tree = {
  version: 1,
  root: { children: [{ uci: 'i4i5', children: [{ uci: 'a7a6', children: [] }] }] },
};
afterEach(() => vi.unstubAllGlobals());
describe('study decisions read', () => {
  it('has no luck overlay when the server omits realized outcomes', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({ decisions: [{ ply: 1, mover: 'red', playedWin: 50 }] }),
    }));
    expect(await fetchStudyChapterDecisions('jieqi', 's', 'c', tree)).toBeNull();
  });
  it('keeps full stored rows luck-only and excludes an unsaved changed mainline', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({
        decisions: [{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 62, bestWin: 90 }],
      }),
    }));
    const overlay = await fetchStudyChapterDecisions('jieqi', 's', 'c', tree);
    expect(overlay?.byPly.get(1)).toEqual({ judgment: null, luck: 12, playedRank: null });
    expect(overlay?.red.reveals).toBe(0);
    expect(
      await fetchStudyChapterDecisions('jieqi', 's', 'c', tree, {
        root: { children: [{ uci: 'c4c5', children: [] }] },
      }),
    ).toBeNull();
  });
  it('treats misses and failures as no overlay', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 204 }));
    expect(await fetchStudyChapterDecisions('jieqi', 's', 'c', tree)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await fetchStudyChapterDecisions('jieqi', 's', 'c', tree)).toBeNull();
  });
});

it('uses Banqi validation and its review overlay, refusing unknown variants and changed trees', async () => {
  const fetcher = vi.fn(async () => ({
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
            { move: 'a0a0', win: 50, played: true },
          ],
        },
      ],
    }),
  }));
  vi.stubGlobal('fetch', fetcher);
  const saved = {
    rootFen: '8/8/8/XX6 r H1s1 0 1 Hs',
    root: { children: [{ uci: 'a1a1', children: [] }] },
  };
  const overlay = await fetchStudyChapterDecisions('banqi', 's', 'c', saved);
  expect(overlay?.byPly.get(1)).toMatchObject({ judgment: 'blunder', luck: 12, playedRank: 2 });
  expect(overlay?.byPly.get(1)?.candidates?.[0]?.label).toBe('b1 flip');
  for (const variant of ['unknown', 'constructor', '__proto__']) {
    fetcher.mockClear();
    expect(await fetchStudyChapterDecisions(variant, 's', 'c', saved)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  }
  expect(
    await fetchStudyChapterDecisions('banqi', 's', 'c', saved, {
      ...saved,
      root: { children: [{ uci: 'b1b1', children: [] }] },
    }),
  ).toBeNull();
  vi.stubGlobal('fetch', async () => ({
    status: 200,
    json: async () => ({ decisions: [{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 62 }] }),
  }));
  expect(await fetchStudyChapterDecisions('banqi', 's', 'c', saved)).toBeNull();
});
