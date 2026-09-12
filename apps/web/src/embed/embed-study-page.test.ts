import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedStudyRouteFromPath } from './embed-route.js';
import { mountEmbedStudy } from './embed-study-page.js';

const CHAPTER = {
  id: 'Ue0EgpS7',
  name: '1956 · The first national championship',
  orientation: 'red',
  tags: { red: 'Li Yiting', black: 'Yang Guanlin', event: '1956', result: '1-0' },
  root: {
    root: {
      children: [
        { uci: 'h3e3', annotations: { glyphs: [6] }, children: [{ uci: 'h8e8' }] },
        { uci: 'b1c3' },
      ],
    },
  },
};

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embedStudyRouteFromPath', () => {
  it('matches a study chapter path and nothing else', () => {
    expect(embedStudyRouteFromPath('/embed/study/abc/def')).toEqual({
      studyId: 'abc',
      chapterId: 'def',
    });
    expect(embedStudyRouteFromPath('/embed/study/abc/def/')).not.toBeNull();
    for (const bad of ['/embed/study/abc', '/embed/study', '/study/abc/def', '/embed/game/a/b']) {
      expect(embedStudyRouteFromPath(bad), bad).toBeNull();
    }
  });

  it('refuses ids that are not id-shaped', () => {
    // The route is frameable by anyone, so its inputs are hostile by default.
    expect(embedStudyRouteFromPath('/embed/study/../../etc/passwd')).toBeNull();
    expect(embedStudyRouteFromPath('/embed/study/a b/c')).toBeNull();
  });
});

describe('mountEmbedStudy', () => {
  it('renders the chapter as a board with a link back to the source', async () => {
    stubFetch(200, { study: { id: 's' }, chapters: [CHAPTER] });
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Ue0EgpS7' });

    // The shared card, the same one a game sits in: seat rows with discs in
    // the seats' inks, the board, the step controls, the score sheet, and a
    // pinned result in words rather than the tag.
    expect(root.querySelector('.embed-card')).not.toBeNull();
    expect(root.querySelector('.embed-board svg')).not.toBeNull();
    const seats = Array.from(root.querySelectorAll<HTMLElement>('.embed-card-seat'));
    expect(seats.map((s) => s.dataset.seat)).toEqual(['second', 'first']);
    expect(seats.map((s) => s.querySelector('.embed-card-seat-name')?.textContent)).toEqual([
      'Yang Guanlin',
      'Li Yiting',
    ]);
    expect(seats.map((s) => s.querySelector('.embed-seat-disc')?.className)).toEqual([
      'embed-seat-disc embed-seat-disc--black',
      'embed-seat-disc embed-seat-disc--red',
    ]);
    // A chapter has no clocks; the slots stay empty rather than reading 0:00.
    expect(seats.every((s) => s.querySelector('.embed-card-seat-clock')?.textContent === '')).toBe(
      true,
    );
    expect(root.querySelector('.embed-card-header')?.textContent).toBe('1956');
    expect(root.querySelector('.embed-card-result')?.textContent).toBe('Red wins');
    // The mainline in the shared score sheet, with the chapter's glyph as a suffix.
    const moves = Array.from(root.querySelectorAll('.review-move-list__move'));
    expect(moves.length).toBe(2);
    expect(root.querySelector('.review-move-list__suffix')?.textContent?.trim()).toBe('?!');
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0 / 2');
    const credit = root.querySelector<HTMLAnchorElement>('.embed-credit');
    expect(credit?.getAttribute('href')).toBe('/study/s/Ue0EgpS7');
    // It opens out of the frame it is living in.
    expect(credit?.getAttribute('target')).toBe('_blank');
    expect(credit?.getAttribute('rel')).toBe('noopener');
    root.remove();
  });

  it('draws a duck chapter with the DUCK board, not the xiangqi one', async () => {
    // The xiangqi board cannot render the duck: it lives in the seventh FEN
    // field and has no piece to stand for it. Before the dispatch, a duck
    // chapter came out as a xiangqi position with the duck simply absent.
    const duckChapter = {
      id: 'Duck1234',
      name: 'Game 6',
      orientation: 'red',
      variant: 'duck-xiangqi',
      tags: { red: 'Fairy-Stockfish', black: 'Fairy-Stockfish', event: 'self-play', result: '1-0' },
      root: { root: { children: [{ uci: 'b3b5@d9', children: [{ uci: 'b8b6@a8' }] }] } },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [duckChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Duck1234' });

    // Asserted on a marker the DUCK renderer emits and the xiangqi board never
    // does. Not on the duck piece itself: the card opens at ply 0, and the duck
    // is not on the board until the second half of Red's first turn, so a duck
    // token would be a false negative here.
    expect(root.innerHTML).toContain('dkx-');
    root.remove();
  });

  it('says a private or missing study is unavailable rather than looking broken', async () => {
    stubFetch(404, { error: 'not_found' });
    const root = document.createElement('div');
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'c' });
    expect(root.textContent).toContain('not available');
    expect(root.querySelector('.xq-replay')).toBeNull();
  });

  it('handles a chapter that is not in the study', async () => {
    stubFetch(200, { study: { id: 's' }, chapters: [CHAPTER] });
    const root = document.createElement('div');
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'nope' });
    expect(root.textContent).toContain('chapter is not available');
  });

  it('handles a chapter with no moves', async () => {
    stubFetch(200, {
      study: { id: 's' },
      chapters: [{ id: 'empty', name: 'Empty', root: { root: { children: [] } } }],
    });
    const root = document.createElement('div');
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'empty' });
    expect(root.textContent).toContain('no moves');
  });

  it('does not throw when the network fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const root = document.createElement('div');
    await expect(mountEmbedStudy(root, { studyId: 's', chapterId: 'c' })).resolves.toBeUndefined();
    expect(root.textContent).toContain('could not be loaded');
  });
});
