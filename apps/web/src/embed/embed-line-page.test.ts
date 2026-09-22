import { describe, expect, it } from 'vitest';
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

  it('says so when there are no moves rather than showing an empty board', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedLine(root, { variant: 'jungle' }, embedLineFromSearch(''), {});
    expect(root.textContent).toContain('No moves to show');
    root.remove();
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
