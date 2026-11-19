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

it('reads Three Kingdoms pool-mean grades in its own 1-based move dialect', async () => {
  const saved = {
    replay: 'three-kingdoms-banqi-public-v1',
    root: { children: [{ uci: '@a1:R', children: [] }] },
  };
  const row = {
    ply: 1,
    mover: 'red',
    bestWin: 70,
    playedWin: 50,
    realizedWin: 62,
    playedRank: 2,
    candidates: [
      { move: 'b1b1', win: 70 },
      { move: 'a1a1', win: 50, played: true },
    ],
  };
  const fetcher = vi.fn(async () => ({ status: 200, json: async () => ({ decisions: [row] }) }));
  vi.stubGlobal('fetch', fetcher);
  const overlay = await fetchStudyChapterDecisions('three-kingdoms-banqi', 's', 'c', saved);
  expect(overlay?.byPly.get(1)).toMatchObject({ judgment: 'blunder', luck: 12, playedRank: 2 });
  expect(overlay?.byPly.get(1)?.candidates?.[0]).toMatchObject({ label: 'b1 flip', uci: 'b1b1' });
  expect(overlay?.red.reveals).toBe(1);
  expect(
    await fetchStudyChapterDecisions('three-kingdoms-banqi', 's', 'c', saved, {
      ...saved,
      root: { children: [{ uci: '@b1:R', children: [] }] },
    }),
  ).toBeNull();
  for (const bad of [
    { bestWin: NaN },
    { candidates: [{ move: 'a0a0', win: 70 }] },
    { capturedRole: 'horse' },
    { candidates: [{ move: 'a1a1', win: 70, capturedRole: 'horse' }] },
  ]) {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({ decisions: [{ ...row, ...bad }] }),
    }));
    expect(await fetchStudyChapterDecisions('three-kingdoms-banqi', 's', 'c', saved)).toBeNull();
  }
});

it('reads Fanfanqi public pool means and refuses identities or a changed opening', async () => {
  const saved = {
    replay: 'ffq-banqi-public-v1',
    initialRevealed: [
      { color: 'red', role: 'cannon' },
      { color: 'black', role: 'horse' },
      { color: 'red', role: 'soldier' },
      { color: 'black', role: 'advisor' },
    ],
    root: { children: [{ uci: 'c1a1x:G', children: [] }] },
  };
  const row = {
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
  };
  vi.stubGlobal('fetch', async () => ({ status: 200, json: async () => ({ decisions: [row] }) }));
  const overlay = await fetchStudyChapterDecisions('ffq-banqi', 's', 'c', saved);
  expect(overlay?.byPly.get(1)).toMatchObject({ judgment: 'blunder', luck: 12, playedRank: 2 });
  expect(overlay?.byPly.get(1)?.candidates?.map((candidate) => candidate.label)).toEqual([
    'a2 flip',
    'b3-b1',
  ]);
  // Decided 2026-11-15: Fanfanqi shows per-move luck only, with no per-seat totals.
  expect(overlay).not.toHaveProperty('totals');
  expect(JSON.parse(JSON.stringify({ ...overlay, byPly: [...overlay!.byPly] }))).toMatchObject({
    byPly: [[1, { judgment: 'blunder', luck: 12 }]],
  });
  for (const changed of [
    { ...saved, initialRevealed: [...saved.initialRevealed].reverse() },
    { ...saved, replay: 'unknown' },
    { ...saved, root: { children: [{ uci: 'c1a1x:g', children: [] }] } },
  ])
    expect(await fetchStudyChapterDecisions('ffq-banqi', 's', 'c', saved, changed)).toBeNull();
  for (const bad of [
    { hiddenRole: { square: 'b0', role: 'general' } },
    { candidates: [{ move: '@a0:G', win: 70 }] },
    { candidates: [{ move: 'a0a0', win: 70, hiddenRole: 'general' }] },
  ]) {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({ decisions: [{ ...row, ...bad }] }),
    }));
    expect(await fetchStudyChapterDecisions('ffq-banqi', 's', 'c', saved)).toBeNull();
  }
});

it('maps Flip Jungle engine coordinates and rejects identity-bearing or malformed rows', async () => {
  const saved = { rootFen: 'dealt', root: { children: [{ uci: 'a1a1', children: [] }] } };
  const row = {
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
  };
  const serve = (value: unknown) =>
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({ decisions: [value] }),
    }));
  serve(row);
  const overlay = await fetchStudyChapterDecisions('jungle-flip', 's', 'c', saved);
  expect(overlay?.byPly.get(1)).toMatchObject({ judgment: 'blunder', luck: 12, playedRank: 2 });
  expect(overlay?.byPly.get(1)?.candidates?.[0]).toMatchObject({ label: 'b1 flip', uci: 'b0b0' });
  for (const bad of [
    { capturedRole: 'rat' },
    { playedRank: undefined },
    { bestWin: NaN },
    { candidates: [{ move: 'e0e0', win: 70 }] },
    { candidates: [{ move: 'a4a4', win: 70 }] },
    { candidates: [{ move: 'a0a0', win: 70, role: 'rat' }] },
  ]) {
    serve({ ...row, ...bad });
    expect(await fetchStudyChapterDecisions('jungle-flip', 's', 'c', saved)).toBeNull();
  }
  serve(row);
  expect(
    await fetchStudyChapterDecisions('jungle-flip', 's', 'c', saved, {
      ...saved,
      root: { children: [{ uci: 'b1b1' }] },
    }),
  ).toBeNull();
});
