import { describe, expect, it } from 'vitest';
import { mountJieqiReplayBoard, replayJieqiLine } from '../jieqi-replay-board.js';
import { lineToChapter, mountEmbedLine } from './embed-line-page.js';
import { embedLineFromSearch } from './embed-route.js';

describe('mountEmbedLine', () => {
  it('draws a jungle line on the jungle board with the seats and result from the query', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const line = embedLineFromSearch(
      '?moves=a1b1,a9a8,b1a1&red=MistyJungle&black=KataGo-AnimalChess&event=Game%2067&result=0-1',
    );
    await mountEmbedLine(root, { variant: 'jungle' }, line, { startPly: 2 });
    expect(root.innerHTML).toContain('data-piece-square="g9"');
    expect(root.textContent).toContain('KataGo-AnimalChess');
    expect(root.textContent).toContain('Game 67');
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toEqual(['a1-b1', 'a9-a8', 'b1-a1']);
    // the credit goes to the analysis board: there is no study page to send the reader to
    expect(root.querySelector('a[href="/analysis/jungle"]')).not.toBeNull();
    root.remove();
  });

  it('draws a xiangqi line on the xiangqi board', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedLine(root, { variant: 'xiangqi' }, embedLineFromSearch('?moves=h3e3,h8e8'), {});
    // the xiangqi replay wraps its board in the xq stepper frame; the jungle board has none
    expect(root.innerHTML).toContain('raw-svg-stepper-frame-xq');
    expect(root.innerHTML).not.toContain('data-piece-square="g9"');
    root.remove();
  });

  it('draws a crazyhouse line with drops on the board with both pockets', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedLine(
      root,
      { variant: 'crazyhouse-xiangqi' },
      embedLineFromSearch('?moves=h3h10,i10h10,N@e5&red=A&black=B'),
      { startPly: 3 },
    );
    expect(root.querySelectorAll('.chx-embed-hand')).toHaveLength(2);
    expect(root.innerHTML).toContain('data-piece-square="e5"');
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toEqual(['h3-h10', 'i10-h10', 'N@e5']);
    expect(root.querySelector('a[href="/analysis/crazyhouse-xiangqi"]')).not.toBeNull();
    root.remove();
  });

  it('says so when there are no moves rather than showing an empty board', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedLine(root, { variant: 'jungle' }, embedLineFromSearch(''), {});
    expect(root.textContent).toContain('No moves to show');
    root.remove();
  });

  it('draws a jieqi line from a dealt position, seated as the query asks', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    // the deal rides in the sixth FEN field; a10 is a soldier that moves as the chariot it stands in for
    const fen =
      'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X_b_R0A0C0P0N0B2r0a0c0p1n1b0_0_28_pnBB';
    const line = embedLineFromSearch(`?fen=${fen}&moves=a10a1&orientation=black`);
    expect(line.orientation).toBe('black');
    expect(lineToChapter({ variant: 'jieqi' }, line).orientation).toBe('black');
    await mountEmbedLine(root, { variant: 'jieqi' }, line, {});
    const moves = Array.from(root.querySelectorAll('.review-move-list__move')).map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toHaveLength(1);
    expect(root.textContent).not.toContain('no dealt position');
    expect(root.querySelector('a[href="/analysis/jieqi"]')).not.toBeNull();
    // no arrow unless the frame asks for one
    expect(root.querySelector('.xq-arrow--best')).toBeNull();
    root.remove();
  });

  it('draws the move about to be played as an arrow when the frame asks (arrows=1)', async () => {
    const fen =
      'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X_b_R0A0C0P0N0B2r0a0c0p1n1b0_0_28_pnBB';
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedLine(
      root,
      { variant: 'jieqi' },
      embedLineFromSearch(`?fen=${fen}&moves=a10a1&arrows=1`),
      { startPly: 0 },
    );
    // one arrow, in the review's best-move style, on the position before a10-a1
    expect(root.querySelectorAll('.xq-arrow--best')).toHaveLength(1);
    root.remove();
  });

  it('draws the arrow on the opening frame only; stepping on shows the plain marks', () => {
    // no face-down piece: i10-f10, g8-f8, e9xf8
    const line = replayJieqiLine(
      '8C/3kA4/6r2/B2N5/9/P4p2P/1A2Pn3/9/3K5/9 w R0A0C0P0N0B0r0a0c0p0n0b0 15 62 -',
      ['i10f10', 'g8f8', 'e9f8'],
    );
    if (!line) throw new Error('line did not replay');
    const host = document.createElement('div');
    document.body.append(host);
    const board = mountJieqiReplayBoard(host, line, { openingArrowPly: 1 });
    const arrows = () => host.querySelectorAll('.xq-arrow--best').length;
    expect(arrows()).toBe(0); // ply 0 is not the frame the board opens on
    board.jumpToPly(1);
    expect(arrows()).toBe(1); // the opening frame: g8-f8, the move it is about
    board.jumpToPly(2);
    expect(arrows()).toBe(0);
    board.jumpToPly(3);
    expect(arrows()).toBe(0);
    board.destroy();
    host.remove();
  });

  it('draws a named move on the opening frame in place of the one played (arrow=)', () => {
    const line = replayJieqiLine(
      '8C/3kA4/6r2/B2N5/9/P4p2P/1A2Pn3/9/3K5/9 w R0A0C0P0N0B0r0a0c0p0n0b0 15 62 -',
      ['i10f10', 'g8f8'],
    );
    if (!line) throw new Error('line did not replay');
    const host = document.createElement('div');
    document.body.append(host);
    const named = mountJieqiReplayBoard(host, line, {
      openingArrowPly: 0,
      openingArrowMove: 'i10i9',
    });
    const drawn = host.innerHTML;
    named.destroy();
    const played = mountJieqiReplayBoard(host, line, { openingArrowPly: 0 });
    expect(host.querySelectorAll('.xq-arrow--best')).toHaveLength(1);
    expect(host.innerHTML).not.toBe(drawn); // a different arrow: i10-i9, not i10-f10
    played.destroy();
    host.remove();
  });

  it('builds the chapter shape the study card reads: a single-child chain and the tags', () => {
    const chapter = lineToChapter(
      { variant: 'banqi' },
      {
        fen: 'X7/8/8/8 r 0 1',
        moves: ['a1a1', 'b1b1'],
        red: 'A',
        black: null,
        event: null,
        result: '1-0',
      },
    );
    expect(chapter.variant).toBe('banqi');
    expect(chapter.root?.rootFen).toBe('X7/8/8/8 r 0 1');
    expect(chapter.root?.root?.children?.[0]?.uci).toBe('a1a1');
    expect(chapter.root?.root?.children?.[0]?.children?.[0]?.uci).toBe('b1b1');
    expect(chapter.tags).toEqual({ red: 'A', result: '1-0' });
  });
});
