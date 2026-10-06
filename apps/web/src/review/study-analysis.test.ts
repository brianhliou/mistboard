// A study chapter's stored analysis reaches the review shell cut to the prefix
// of the chapter's mainline it still covers. The mount cases run the real study
// dispatch (mountStudyReview -> xiangqi review -> tree-review), so they cover
// the page's path: chart when covered, nothing at all when not.
import { afterEach, describe, expect, it } from 'vitest';
import type { PlyEval } from './game-analysis.js';
import {
  type StudyChapterAnalysisResponse,
  storedStudyAnalysisSource,
  studyChapterGameAnalysis,
} from './study-analysis.js';
import { mountStudyReview } from './study-review.js';
import type { SerializedTree } from './tree-serialize.js';

const LINE = ['h3e3', 'h10g8', 'h1g3', 'i10h10', 'i1h1'];

function tree(ucis: readonly string[], rootFen?: string): SerializedTree {
  const root: SerializedTree['root'] = { children: [] };
  let node = root;
  for (const uci of ucis) {
    const child = { uci, children: [] };
    node.children.push(child);
    node = child;
  }
  return { version: 1, root, ...(rootFen ? { rootFen } : {}) } as SerializedTree;
}

function stored(
  moves: readonly string[],
  rootFen: string | null = null,
): StudyChapterAnalysisResponse {
  const plies: PlyEval[] = Array.from({ length: moves.length + 1 }, (_, ply) => ({
    ply,
    cp: ply % 2 === 0 ? 30 : 10,
    mate: null,
    best: null,
  }));
  return { engineId: 'pikafish-xiangqi-analysis@5', depth: 12, rootFen, moves: [...moves], plies };
}

describe('studyChapterGameAnalysis', () => {
  it('covers the whole mainline when the chapter is unchanged', () => {
    const analysis = studyChapterGameAnalysis(stored(LINE), tree(LINE));
    expect(analysis?.evals.map((entry) => entry.ply)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(analysis?.moves).toHaveLength(LINE.length);
  });

  it('covers fewer than k moves after an edit at ply k', () => {
    // Ply 4 replaced: the chart may describe positions 0..3 and nothing after.
    const edited = [...LINE.slice(0, 3), 'a10a9', 'i1h1'];
    const analysis = studyChapterGameAnalysis(stored(LINE), tree(edited));
    expect(analysis?.evals.map((entry) => entry.ply)).toEqual([0, 1, 2, 3]);
    expect(Math.max(...(analysis?.moves ?? []).map((move) => move.ply))).toBeLessThan(4);
  });

  it('gives no analysis when nothing is covered', () => {
    expect(studyChapterGameAnalysis(stored(LINE), tree(['b3e3', ...LINE.slice(1)]))).toBeNull();
    expect(
      studyChapterGameAnalysis(stored(LINE), tree(LINE, '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1')),
    ).toBeNull();
  });

  it('attributes plies from the start position: Black first after a black-to-move FEN', () => {
    const fen = '3k5/9/9/9/9/9/9/9/4A4/4K4 b - - 0 1';
    const analysis = studyChapterGameAnalysis(stored(['d10e10'], fen), tree(['d10e10'], fen));
    expect(analysis?.moves[0]?.mover).toBe('black');
  });

  it('never offers a request: the source answers from what it holds', async () => {
    const analysis = studyChapterGameAnalysis(stored(LINE), tree(LINE));
    if (!analysis) throw new Error('expected an analysis');
    const source = storedStudyAnalysisSource(analysis);
    await expect(source.fetchCached?.()).resolves.toBe(analysis);
    await expect(source.run(() => {})).rejects.toThrow();
  });
});

describe('study chapter mount', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  async function mount(
    storedAnalysis: Promise<ReturnType<typeof studyChapterGameAnalysis>> | null,
  ) {
    const root = document.createElement('div');
    document.body.append(root);
    await mountStudyReview('xiangqi', root, {
      reviewSurface: 'study',
      ariaLabel: 'Study',
      title: 'Study',
      summary: '',
      initialTree: tree(LINE),
      initialUnderboardTab: 'analysis',
      storedAnalysis,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return root;
  }

  const tabs = (root: HTMLElement) =>
    [...root.querySelectorAll('.review-underboard-tab')].map((el) => el.textContent);

  it('draws the advantage chart for a covered chapter, on the open tab', async () => {
    const root = await mount(Promise.resolve(studyChapterGameAnalysis(stored(LINE), tree(LINE))));
    const chart = root.querySelector('.advantage-chart');
    expect(chart).not.toBeNull();
    expect(chart?.closest('[hidden]')).toBeNull();
    expect(root.querySelector('.xiangqi-review__analyse')).toBeNull();
  });

  it('changes nothing for a chapter without analysis: no tab, no chart, no button', async () => {
    const root = await mount(null);
    expect(root.querySelector('.advantage-chart')).toBeNull();
    expect(root.querySelector('.xiangqi-review__analyse')).toBeNull();
    expect(tabs(root)).not.toContain('Computer analysis');
  });
});
