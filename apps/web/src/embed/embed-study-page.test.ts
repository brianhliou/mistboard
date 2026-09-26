import { createInitialJungleFlipState, jungleFlipStateToDealtFen } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JUNGLE_ART } from '../jungle-art.js';
import { STUDY_VARIANTS } from '../study-catalog.js';
import { embedStudyRouteFromPath } from './embed-route.js';
import { CHAPTER_EMBED_VARIANTS, mountEmbedStudy } from './embed-study-page.js';

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

/** A mainline as the study tree stores it: each move the first child of the last. */
function chainTree(tokens: readonly string[]): { children: unknown[] } {
  let children: unknown[] = [];
  for (const uci of [...tokens].reverse()) children = [{ uci, children }];
  return { children };
}

// Prod study NUVBVjFf chapter qh5eSTC9 (fortress), the full mainline.
const FORTRESS_GAME_1 = (
  'd1b3 c8c6 e1d1 a7a6 f2f3 a6a5 f3f4 a5a4 f1e3 a8a5 f4f5 a5c5 d1f1 c5c3 f5g5 d8f6 e3f5 ' +
  'c6b6 f5d4 d7d6 g5f5 d6d5 d4b5 c3c5 f5f6 c5b5 f6e6 N@f4 E@d1 d5d4 e6d6 b5c5 g2g3 f7f6 ' +
  'd6e6 g8f7 e6f6 f7f6 f1f6 P@c2 d1f3 d4d3 d2d3 f4d3 Q@d1 P@c3 P@a5 c5a5 d1c2 c3c2 P@d2 ' +
  'c2d2 f6d6 P@c2 g1f1 a5c5 d6d2 c2d2 P@b5 c5b5 P@a6 b6b3 b2b3 d2c2 a1b2 c2b2 c1b2 P@c2 ' +
  'f3d1 P@f2 b1a1 c2b2 f1f2 d3f2 C@f1 f2d1 P@f6 e8f7 f6f7 f8f7 A@b1 C@e1 P@c1 d1c3 f1f6 b2b1'
).split(' ');

// Prod study wd6c7qvG chapter AMY9DrPj (jieqi): the dealt root and the mainline.
const JIEQI_GAME_18_ROOT =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w ' +
  'R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB';
const JIEQI_GAME_18 = (
  'i4i5 a7a6 g4g5 g7g6 c4c5 h8h1 i1h1 c7c6 c5d3 g6i5 d3e5 c10e8 e5c6 b8b1 a1b1 a6a5 c6e7 ' +
  'a5a4 h3h9 i10i9 b3b9 i9h9 e4e5 i5g4 f1e2 h9h1 e2e3 h1g1 e1e2 b10d9 g5h7 g1d1 h7f8 e10e9 ' +
  'e7c8 e9f9 c8d10 a10d10 b1b2 d9d2'
).split(' ');

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

  it('draws a jungle chapter on the JUNGLE board, not the xiangqi one', async () => {
    // The first jungle study embed (2026-09-21) fell through to the xiangqi
    // branch: a 7x9 game drawn on a 9x10 xiangqi start position with the jungle
    // move squares ringed on it. A jungle chapter's root is a jungle FEN and its
    // tokens are kernel coordinates; the xiangqi conversion cannot read either.
    const jungleChapter = {
      id: 'Jngl1234',
      name: 'Game 67',
      orientation: 'red',
      variant: 'jungle',
      tags: { red: 'MistyJungle', black: 'KataGo-AnimalChess', event: 'match', result: '0-1' },
      root: {
        rootFen: 't5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1',
        root: {
          children: [{ uci: 'a1b1', children: [{ uci: 'a9b9', children: [{ uci: 'b1c1' }] }] }],
        },
      },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [jungleChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Jngl1234' });

    // The jungle renderer names its squares in jungle coordinates; a xiangqi
    // board has no g9 and no a1-based 7x9 grid.
    expect(root.innerHTML).toContain('data-piece-square="g9"');
    expect(root.innerHTML).not.toContain('data-piece-square="i10"');
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toEqual(['a1-b1', 'a9-b9', 'b1-c1']);
    root.remove();
  });

  it('draws a fortress chapter on the FORTRESS board with both hands, drops included', async () => {
    // Prod study NUVBVjFf, chapter qh5eSTC9, as stored: no rootFen (the
    // standard start), no tags, FSF UCI with the treasure dropped as `Q@`.
    const fortressChapter = {
      id: 'qh5eSTC9',
      name: 'Game 1: Black mates on move 43',
      orientation: 'red',
      variant: 'fortress-xiangqi',
      tags: {},
      root: { root: chainTree(FORTRESS_GAME_1) },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [fortressChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'qh5eSTC9' }, { startPly: 999 });

    // The fortress renderer's board, 7x8: a g8 square exists, no xiangqi i10.
    const board = root.querySelector('.embed-board');
    expect(board?.querySelector('svg.fxq-board')).not.toBeNull();
    expect(board?.innerHTML).not.toContain('data-piece-square="i10"');
    // Both hands, every droppable role a slot.
    const hands = Array.from(root.querySelectorAll<HTMLElement>('.fxq-embed-hand'));
    expect(hands.map((h) => h.dataset.owner)).toEqual(['black', 'red']);
    expect(hands[0]?.querySelectorAll('.drop-mini-reserve-piece')).toHaveLength(7);
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toHaveLength(86);
    expect(moves[0]).toBe('d1-b3');
    expect(moves[27]).toBe('N@f4');
    // The treasure's drop letter, the one spelling the article's tokens differ on.
    expect(moves[44]).toBe('T@d1');
    // No result tag: the mate is read off the final position.
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('86 / 86');
    expect(root.querySelector('.embed-card-result')?.textContent).toBe('Black wins');
    const seats = Array.from(root.querySelectorAll<HTMLElement>('.embed-card-seat'));
    expect(seats.map((s) => s.querySelector('.embed-card-seat-name')?.textContent)).toEqual([
      'Black',
      'Red',
    ]);
    root.remove();
  });

  it('stops a fortress line at the first token the kernel refuses', async () => {
    const tokens = [...FORTRESS_GAME_1.slice(0, 4), 'a1a8', ...FORTRESS_GAME_1.slice(4, 8)];
    stubFetch(200, {
      study: { id: 's' },
      chapters: [
        {
          id: 'FxqBad01',
          name: 'broken',
          variant: 'fortress-xiangqi',
          tags: { result: '1-0' },
          root: { root: chainTree(tokens) },
        },
      ],
    });
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'FxqBad01' }, { startPly: 999 });
    expect(root.querySelectorAll('.review-move-list__move')).toHaveLength(4);
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('4 / 4');
    // A tag, when the chapter has one, is the result.
    expect(root.querySelector('.embed-card-result')?.textContent).toBe('Red wins');
    root.remove();
  });

  it('draws a jieqi chapter from its dealt root, dark pieces dark until they move', async () => {
    // Prod study wd6c7qvG, chapter AMY9DrPj, as stored: the deal rides in the
    // root's sixth FEN field, no tags.
    const jieqiChapter = {
      id: 'AMY9DrPj',
      name: 'Game 18: Black mates on move 20',
      orientation: 'red',
      variant: 'jieqi',
      tags: {},
      root: { rootFen: JIEQI_GAME_18_ROOT, root: chainTree(JIEQI_GAME_18) },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [jieqiChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'AMY9DrPj' });

    const board = root.querySelector('.embed-board');
    expect(board?.querySelector('svg.jieqi-board')).not.toBeNull();
    const hidden = () => board?.querySelectorAll('[aria-label$="hidden piece"]').length ?? 0;
    // The start: every piece but the generals face down.
    expect(hidden()).toBe(30);
    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    // i4i5 moved a dark piece: it shows what the deal made it.
    expect(hidden()).toBe(29);
    expect(board?.querySelector('[data-piece-square="i5"]')?.innerHTML).not.toContain(
      'hidden piece',
    );
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toHaveLength(40);
    expect(moves[11]).toBe('c10-e8');
    const toEnd = [...root.querySelectorAll<HTMLButtonElement>('.embed-card-menu-item')].find(
      (item) => item.textContent === 'Jump to the end',
    );
    toEnd?.click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('40 / 40');
    expect(root.querySelector('.embed-card-result')?.textContent).toBe('Black wins');
    root.remove();
  });

  it('refuses a jieqi chapter whose root carries no deal', async () => {
    // A five-field FEN would have the parser sample identities: a board of
    // pieces that were never there.
    const publicFen = JIEQI_GAME_18_ROOT.split(' ').slice(0, 5).join(' ');
    stubFetch(200, {
      study: { id: 's' },
      chapters: [
        {
          id: 'JqNoDeal',
          name: 'no deal',
          variant: 'jieqi',
          root: { rootFen: publicFen, root: chainTree(JIEQI_GAME_18.slice(0, 4)) },
        },
      ],
    });
    const root = document.createElement('div');
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'JqNoDeal' });
    expect(root.textContent).toBe('This chapter has no dealt position to show.');
    expect(root.querySelector('svg')).toBeNull();
  });

  it('draws a flip jungle chapter face down until each tile is flipped', async () => {
    // No flip jungle study exists on prod yet; this is the shape the study
    // builder writes (scripts/banqi-study.ts): the dealt root, seat-keyed
    // result tag, flips as self-moves. The fourth token re-flips a tile that
    // is already face up, which the kernel refuses, so the line ends at three.
    const start = createInitialJungleFlipState('t');
    const flipChapter = {
      id: 'Flip1234',
      name: 'Game 1',
      orientation: 'red',
      variant: 'jungle-flip',
      tags: { red: 'MistyFlip A', black: 'MistyFlip B', event: 'self-play', result: '1-0' },
      root: {
        rootFen: jungleFlipStateToDealtFen(start),
        root: chainTree(['a1a1', 'd4d4', 'b2b2', 'a1a1', 'c3c3']),
      },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [flipChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Flip1234' });

    const board = root.querySelector('.embed-board');
    const faceDown = () =>
      (board?.innerHTML ?? '').split(`fill="${JUNGLE_ART.faceDown.fill}"`).length - 1;
    expect(board?.querySelector('[data-piece-square="d4"]')).not.toBeNull();
    expect(board?.innerHTML).not.toContain('data-piece-square="e5"');
    expect(faceDown()).toBe(16);
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toEqual(['a1', 'd4', 'b2']);
    const toEnd = [...root.querySelectorAll<HTMLButtonElement>('.embed-card-menu-item')].find(
      (item) => item.textContent === 'Jump to the end',
    );
    toEnd?.click();
    expect(faceDown()).toBe(13);
    // The first flip bound the first seat's ink: the discs and the result
    // name the colour on the board, not the seat.
    const firstInk = start.board.a1?.color;
    const seats = Array.from(root.querySelectorAll<HTMLElement>('.embed-card-seat'));
    expect(seats.map((s) => s.querySelector('.embed-card-seat-name')?.textContent)).toEqual([
      'MistyFlip B',
      'MistyFlip A',
    ]);
    expect(seats[1]?.querySelector('.embed-seat-disc')?.className).toBe(
      `embed-seat-disc embed-seat-disc--${firstInk}`,
    );
    expect(root.querySelector('.embed-card')?.getAttribute('data-seat-ink-family')).toBe('jungle');
    expect(root.querySelector('.embed-card-result')?.textContent).toBe(
      firstInk === 'red' ? 'Red wins' : 'Blue wins',
    );
    root.remove();
  });

  it('draws a fog chess chapter on the truth board through castling to the king capture', async () => {
    // A fog chess chapter used to be refused ("A dark-chess game cannot be
    // framed yet."). It is a finished record, so the embed shows the revealed
    // truth board, like a finished room and the study page's primary board.
    // White castles in the kernel's spelling of the stored king-to-g1 move and
    // Black in the king-onto-rook spelling: both must replay (#451). The game
    // ends the way only fog chess can: Bxg8 takes the king, which the standard
    // chess kernel would refuse as a move at all.
    const line = [
      'e2e4',
      'e7e5',
      'g1f3',
      'g8f6',
      'f1c4',
      'f8e7',
      'e1g1',
      'e8h8',
      'c4f7',
      'a7a6',
      'f7g8',
    ];
    const tree = line.reduceRight<{ uci?: string; children?: unknown[] }>(
      (child, uci) => ({ uci, children: child.uci ? [child] : [] }),
      {},
    );
    const fogChapter = {
      id: 'Fog12345',
      name: 'Seed 1: White wins in 6 moves',
      orientation: 'red',
      variant: 'dark-chess',
      tags: {},
      root: {
        root: {
          children: [
            {
              ...tree,
              annotations: { comments: [{ text: 'Both sides open in the fog.' }] },
            },
          ],
        },
      },
    };
    stubFetch(200, { study: { id: 's' }, chapters: [fogChapter] });
    const root = document.createElement('div');
    document.body.append(root);

    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Fog12345' }, { startPly: 99 });

    expect(root.textContent).not.toContain('cannot be framed');
    expect(root.querySelector('.embed-board svg')).not.toBeNull();
    const moves = Array.from(root.querySelectorAll('button.review-move-list__move')).map((m) =>
      m.querySelector('.review-move-list__san')?.textContent?.trim(),
    );
    expect(moves).toHaveLength(line.length);
    expect(moves[6]).toBe('O-O');
    expect(moves[7]).toBe('O-O');
    expect(moves[10]).toBe('Bxg8');
    // An out-of-range link clamps to the last ply: the king capture.
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('11 / 11');
    // No result tag on the chapter: the ending is read off the final position.
    expect(root.querySelector('.embed-card-result')?.textContent).toBe('White wins');
    expect(root.querySelector('.review-move-list__note')?.textContent).toBe(
      'Both sides open in the fog.',
    );
    // The truth board: no fog square anywhere, at the end or mid-game, where
    // either seat's own view would shroud most of the other side's pieces.
    expect(root.querySelector('.embed-board')?.innerHTML).not.toContain('dark-chess-fog-square');
    const seats = Array.from(root.querySelectorAll<HTMLElement>('.embed-card-seat'));
    expect(seats.map((s) => s.querySelector('.embed-card-seat-name')?.textContent)).toEqual([
      'Black',
      'White',
    ]);
    // Stepping works from the end.
    root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')?.click();
    expect(root.querySelector('.embed-card-status')?.textContent).toBe('10 / 11');
    expect(root.querySelector('.embed-board')?.innerHTML).not.toContain('dark-chess-fog-square');
    root.remove();
  });

  it('refuses a chapter of a variant it cannot draw, by name', async () => {
    stubFetch(200, {
      study: { id: 's' },
      chapters: [{ ...CHAPTER, id: 'Unknown1', variant: 'made-up-chess' }],
    });
    const root = document.createElement('div');
    await mountEmbedStudy(root, { studyId: 's', chapterId: 'Unknown1' });
    expect(root.textContent).toBe('A made-up-chess game cannot be framed yet.');
    expect(root.querySelector('svg')).toBeNull();
  });

  it('dispatches only study variants, fog chess among them', () => {
    // Fail-closed: every variant the card draws is one a study can hold, and
    // nothing else reaches a board.
    const studyIds = new Set<string>(STUDY_VARIANTS.map((v) => v.id));
    for (const variant of CHAPTER_EMBED_VARIANTS) {
      expect(studyIds.has(variant), variant).toBe(true);
    }
    expect(CHAPTER_EMBED_VARIANTS.has('dark-chess')).toBe(true);
    expect(CHAPTER_EMBED_VARIANTS.has('made-up-chess')).toBe(false);
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
