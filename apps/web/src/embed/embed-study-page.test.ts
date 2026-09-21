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
    const moves = Array.from(root.querySelectorAll('button.review-move-list__move'));
    expect(moves.length).toBe(2);
    expect(root.querySelector('.review-move-list__suffix')?.textContent?.trim()).toBe('?!');
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0 / 2');
    // The sideline hung off move one (the chapter's second child) is under its
    // row as a branch, every move a button. The embed used to drop it, so a
    // chapter arguing that a move was wrong showed the mark and not the
    // argument.
    const branch = root.querySelector<HTMLElement>('.review-move-list__branch');
    expect(branch?.dataset.atPly).toBe('1');
    const lineMoves = Array.from(branch?.querySelectorAll('.review-move-list__line-move') ?? []);
    expect(lineMoves.map((m) => m.textContent)).toEqual(['Hc3']);
    // Clicking into the line shows that position and marks the step; the
    // status reads as "ply before the line + steps into it".
    (lineMoves[0] as HTMLButtonElement).click();
    expect(lineMoves[0]?.classList.contains('review-move-list__line-move--current')).toBe(true);
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0+1');
    // Stepping back out of a one-move line lands on the position it left from.
    root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')?.click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0 / 2');
    expect(lineMoves[0]?.classList.contains('review-move-list__line-move--current')).toBe(false);
    const credit = root.querySelector<HTMLAnchorElement>('.embed-credit');
    expect(credit?.getAttribute('href')).toBe('/study/s/Ue0EgpS7');
    // It opens out of the frame it is living in.
    expect(credit?.getAttribute('target')).toBe('_blank');
    expect(credit?.getAttribute('rel')).toBe('noopener');
    root.remove();
  });

  it("shows a chess chapter's sideline, verdicts and comments, not the mainline alone", async () => {
    // Shaped like the club-move study: rooted after 1.e4 e5 2.f4 d6, the
    // mainline is the club's 3.Nf3?! played out to a verdict, the sideline the
    // engine's 3.d3! with its own verdict and comment. The embed on the post
    // showed the ?! and nothing else.
    const chess = {
      id: 'DIavcvsA',
      name: '1.e4 e5 2.f4 d6: 3.Nf3?!',
      variant: 'chess',
      orientation: 'white',
      tags: { red: 'White', black: 'Black', event: 'Lichess database' },
      root: {
        rootFen: 'rnbqkbnr/ppp2ppp/3p4/4p3/4PP2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3',
        root: {
          annotations: { comments: [{ text: '1.e4 e5 2.f4 d6.' }] },
          children: [
            {
              uci: 'g1f3',
              annotations: { glyphs: [6], comments: [{ text: 'The club move: 85% of games.' }] },
              children: [
                { uci: 'e5f4', children: [{ uci: 'd2d4', annotations: { glyphs: [15] } }] },
              ],
            },
            {
              uci: 'd2d3',
              annotations: { glyphs: [1], comments: [{ text: 'd3: +0.25 at 20M nodes.' }] },
              children: [{ uci: 'g8f6', annotations: { glyphs: [10] } }],
            },
          ],
        },
      },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [chess] });
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'DIavcvsA' });
    const moves = Array.from(root.querySelectorAll('button.review-move-list__move'));
    expect(
      moves.map((m) => m.querySelector('.review-move-list__san')?.textContent?.trim()),
    ).toEqual(['Nf3 ?!', 'exf4', 'd4']);
    // The played move's comment, then the sideline as SAN with its verdict and
    // its own comment.
    const branch = root.querySelector<HTMLElement>('.review-move-list__branch');
    expect(branch?.dataset.atPly).toBe('1');
    expect(branch?.querySelector('.review-move-list__note')?.textContent).toBe(
      'The club move: 85% of games.',
    );
    const line = Array.from(branch?.querySelectorAll('.review-move-list__line-move') ?? []);
    expect(line.map((m) => m.textContent)).toEqual(['d3', 'Nf6']);
    // Numbered like the game: the line replaces White's third move.
    expect(
      Array.from(branch?.querySelectorAll('.review-move-list__line-number') ?? []).map(
        (n) => n.textContent,
      ),
    ).toEqual(['3.']);
    expect(branch?.querySelector('.review-move-list__line-verdict')?.textContent).toBe('=');
    // The mainline plays the club move out to a verdict too (NAG 15 on 4.d4):
    // it sits in the last move's eval slot, where the study's tree view puts it.
    expect(
      Array.from(
        root.querySelectorAll('button.review-move-list__move .review-move-list__eval'),
      ).map((e) => e.textContent),
    ).toEqual(['', '', '⩱']);
    expect(branch?.querySelector('.review-move-list__note--line')?.textContent).toBe(
      'd3: +0.25 at 20M nodes.',
    );
    // Stepping into the line and along it, then out of the front of it.
    (line[1] as HTMLButtonElement).click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0+2');
    root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')?.click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0+1');
    root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')?.click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('0 / 3');
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

    // And writes the turn in the grammar every other duck surface uses. The
    // replay module had its own spelling, `b3-b5, duck d9`, which is wider than
    // a cell in the sheet beside the board: every duck turn in an embedded
    // study rendered as `b3-b5, d…`.
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toEqual(['b3-b5@d9', 'b8-b6@a8']);
    root.remove();
  });

  it('opens on the ply the link names, not always move one', async () => {
    // ?ply=N was parsed but only ever reached the GAME embed, so a study
    // chapter linked to make a point about one move always opened on move
    // one and the reader had to go find it.
    stubFetch(200, { study: { id: 's' }, chapters: [CHAPTER] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Ue0EgpS7' }, { startPly: 2 });

    // The card writes the position it is showing as "ply / max".
    expect(root.querySelector('.embed-frame')).not.toBeNull();
    expect(root.textContent).toContain('2 / ');
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
