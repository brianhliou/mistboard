import { describe, expect, it } from 'vitest';
import { gameDetails, studyOwnerByline } from './study.js';

// A chapter of a real game carries PGN-style tags: who had Red, who had Black,
// the event, the date, the result, the source. The study page rendered exactly
// one of those, the pair of names beside the board, and stored the rest
// nowhere a reader could see. A nine-chapter study of world-championship games
// could not say which championship or who won without replaying the moves.
//
// These tags are also write-once-shaped in the author's mind: they come in from
// an import and are rarely revisited, so nothing else notices when they are
// wrong or absent.
const chapter = (tags: Record<string, string>) =>
  ({ tags }) as unknown as Parameters<typeof gameDetails>[0];

describe('chapter game details in the About tab', () => {
  it('shows the event, the date and the result', () => {
    const el = gameDetails(
      chapter({
        red: 'Xu Chao',
        black: 'Huang Xueqian',
        event: '2019 16th World Xiangqi Championship',
        date: '2019-10-07',
        result: '1-0',
      }),
    );
    const text = el.textContent ?? '';
    expect(text).toContain('2019 16th World Xiangqi Championship');
    expect(text).toContain('2019-10-07');
    expect(text).toContain('1-0');
    // The players are already beside the board; repeating them here would be
    // the same fact twice on one screen.
    expect(text).not.toContain('Huang Xueqian');
  });

  it('renders the source as a link to its host, not a raw URL', () => {
    const el = gameDetails(
      chapter({ event: 'x', site: 'http://www.dpxq.com/hldcg/search/view_m_17036.html' }),
    );
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('http://www.dpxq.com/hldcg/search/view_m_17036.html');
    expect(link?.textContent).toBe('dpxq.com');
    // An outbound link to a third-party archive: no referrer, no window handle,
    // and no endorsement passed along.
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('nofollow');
  });

  it('skips a tag it does not have, and renders nothing at all when it has none', () => {
    const partial = gameDetails(chapter({ result: '1-0' }));
    expect(partial.textContent).toContain('1-0');
    expect(partial.querySelectorAll('dd').length).toBe(1);

    // A chapter with no tags must not leave an empty labelled shell behind.
    expect(gameDetails(chapter({})).children.length).toBe(0);
  });

  it('ignores a site tag that is not an http URL', () => {
    // The tag is free text: a javascript: or data: value must never become an
    // href, and a plain note is not a link either.
    for (const site of ['javascript:alert(1)', 'data:text/html,x', 'from my own notes']) {
      const el = gameDetails(chapter({ site }));
      expect(el.querySelector('a'), `${site} became a link`).toBeNull();
    }
  });
});

describe('study owner in the About tab', () => {
  it('names the owner and links to their profile', () => {
    const el = studyOwnerByline({ owner: { handle: 'mistboard', displayName: 'Mistboard' } });
    expect(el?.textContent).toBe('Study by Mistboard');
    expect(el?.querySelector('a')?.getAttribute('href')).toBe('/@/mistboard');
  });

  it('falls back to the handle, and renders nothing without an owner', () => {
    const el = studyOwnerByline({ owner: { handle: 'a b', displayName: '' } });
    expect(el?.textContent).toBe('Study by @a b');
    expect(el?.querySelector('a')?.getAttribute('href')).toBe('/@/a%20b');
    expect(studyOwnerByline({})).toBeNull();
  });
});
