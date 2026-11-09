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
    expect(await fetchStudyChapterDecisions('s', 'c', tree)).toBeNull();
  });
  it('keeps full stored rows luck-only and excludes an unsaved changed mainline', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({
        decisions: [{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 62, bestWin: 90 }],
      }),
    }));
    const overlay = await fetchStudyChapterDecisions('s', 'c', tree);
    expect(overlay?.byPly.get(1)).toEqual({ judgment: null, luck: 12, playedRank: null });
    expect(overlay?.red.reveals).toBe(0);
    expect(
      await fetchStudyChapterDecisions('s', 'c', tree, {
        root: { children: [{ uci: 'c4c5', children: [] }] },
      }),
    ).toBeNull();
  });
  it('treats misses and failures as no overlay', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 204 }));
    expect(await fetchStudyChapterDecisions('s', 'c', tree)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await fetchStudyChapterDecisions('s', 'c', tree)).toBeNull();
  });
});
