import { afterEach, describe, expect, it, vi } from 'vitest';

// The locale is read from window.localStorage (i18n/locale.ts resolveLocale);
// happy-dom does not provide one here, so the smallest thing that behaves like
// it stands in (same shim as forum-i18n.test.ts).
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

describe('landing forum preview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates the homepage forum box with one dense row per active topic', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          topics: [
            {
              id: 'topic_1',
              slug: 'first-topic',
              title: 'First topic',
              category: {
                slug: 'general-discussion',
                name: 'General Games Discussion',
              },
              latestPost: {
                post: { id: 'post_2' },
                author: { handle: 'alice', displayName: 'Alice' },
                createdAt: '2026-06-01T00:05:00.000Z',
                excerpt: 'Knights first, then cannons.',
              },
              postCount: 26,
              pinned: false,
              locked: false,
              lastPostAt: '2026-06-01T00:05:00.000Z',
            },
            {
              id: 'topic_2',
              slug: 'second-topic',
              title: 'Second topic',
              category: {
                slug: 'feedback',
                name: 'Mistboard Feedback',
              },
              latestPost: null,
              postCount: 1,
              pinned: true,
              locked: false,
              lastPostAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { buildLandingForumPreview } = await import('./landing-forum-preview.js');

    const box = buildLandingForumPreview();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The reader's locale rides along so the server can overlay cached
    // translations (the auto-translate preference defaults on).
    expect(fetchSpy).toHaveBeenCalledWith('/api/forum/topics?limit=8&locale=en', {
      headers: { accept: 'application/json' },
    });
    expect(box.querySelector('.site-box-title')?.textContent).toBe('Active forum topics');
    const rows = box.querySelectorAll<HTMLAnchorElement>('a.landing-forum-topic');
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute('href')).toBe('/forum/t/topic_1/first-topic?page=2#post_post_2');
    expect(rows[0]?.textContent).toContain('First topic');
    expect(rows[0]?.textContent).toContain('General Games Discussion');
    expect(rows[0]?.textContent).toContain('Alice');
    expect(rows[0]?.textContent).toContain('25');
    expect(rows[0]?.querySelector('.landing-forum-topic-excerpt')?.textContent).toBe(
      'Knights first, then cannons.',
    );
    // No latest post: no excerpt line, the row stays title + meta.
    expect(rows[1]?.querySelector('.landing-forum-topic-excerpt')).toBeNull();
    // The row itself is the only link: no nested anchors per topic.
    expect(rows[0]?.querySelectorAll('a').length).toBe(0);
    expect(rows[1]?.getAttribute('href')).toBe('/forum/t/topic_2/second-topic');
    expect(rows[1]?.classList.contains('is-pinned')).toBe(true);
  });

  it('shows cached translations and the localized category name for a Chinese reader', async () => {
    window.localStorage.setItem('mistboard.locale', 'zh-Hans');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          topics: [
            {
              id: 'topic_1',
              slug: 'first-topic',
              title: 'Paste a game link and it shows as a board',
              category: {
                slug: 'general-discussion',
                name: 'General Games Discussion',
                i18n: { 'zh-Hans': { name: '综合游戏讨论' } },
              },
              latestPost: {
                post: { id: 'post_2' },
                author: { handle: 'alice', displayName: 'Alice' },
                createdAt: '2026-06-01T00:05:00.000Z',
                excerpt: 'You can now show a game inside a forum post.',
              },
              postCount: 1,
              pinned: false,
              locked: false,
              lastPostAt: '2026-06-01T00:05:00.000Z',
              translated: {
                title: '粘贴对局链接即可显示为棋盘',
                excerpt: '现在可以在论坛帖子中显示对局。',
              },
            },
            {
              id: 'topic_2',
              slug: 'second-topic',
              title: 'Not yet translated',
              category: { slug: 'feedback', name: 'Mistboard Feedback' },
              latestPost: null,
              postCount: 1,
              pinned: false,
              locked: false,
              lastPostAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const { buildLandingForumPreview } = await import('./landing-forum-preview.js');
      const box = buildLandingForumPreview();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).toHaveBeenCalledWith('/api/forum/topics?limit=8&locale=zh-Hans', {
        headers: { accept: 'application/json' },
      });
      const rows = box.querySelectorAll<HTMLAnchorElement>('a.landing-forum-topic');
      const title = rows[0]?.querySelector<HTMLElement>('.landing-forum-topic-title');
      expect(title?.textContent).toBe('粘贴对局链接即可显示为棋盘');
      // The original stays one hover away.
      expect(title?.title).toBe('Paste a game link and it shows as a board');
      expect(rows[0]?.querySelector('.landing-forum-topic-excerpt')?.textContent).toBe(
        '现在可以在论坛帖子中显示对局。',
      );
      expect(rows[0]?.querySelector('.landing-forum-topic-meta')?.textContent).toContain(
        '综合游戏讨论',
      );
      // Nothing cached: the source text, untouched, and no hover original.
      const plain = rows[1]?.querySelector<HTMLElement>('.landing-forum-topic-title');
      expect(plain?.textContent).toBe('Not yet translated');
      expect(plain?.title).toBe('');
    } finally {
      window.localStorage.removeItem('mistboard.locale');
    }
  });

  it('trims to whole rows against the body height and fills small slack', async () => {
    const topic = (n: number) => ({
      id: `topic_${n}`,
      slug: `topic-${n}`,
      title: `Topic ${n}`,
      category: { slug: 'general-discussion', name: 'General Games Discussion' },
      latestPost: null,
      postCount: 1,
      pinned: false,
      locked: false,
      lastPostAt: '2026-06-01T00:00:00.000Z',
    });
    // A fresh Response per call: a body reads once, and this test hydrates twice.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ topics: [topic(1), topic(2), topic(3), topic(4)] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    // jsdom has no layout: stack the rows 69px apart by DOM order, body at 0.
    const rowHeight = 69;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = this.classList.contains('landing-forum-topic')
        ? Array.from(this.parentElement?.children ?? []).indexOf(this)
        : -1;
      const top = index < 0 ? 0 : index * rowHeight;
      const bottom = index < 0 ? 0 : top + rowHeight;
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect;
    });
    const { buildLandingForumPreview } = await import('./landing-forum-preview.js');

    const box = buildLandingForumPreview();
    const body = box.querySelector<HTMLElement>('.site-box-body')!;
    // Two rows fit (138px), a third (207px) would clip; 42px of slack is
    // within the 28px-per-row spread, so the rows grow to fill it.
    Object.defineProperty(body, 'clientHeight', { value: 180, configurable: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(body.querySelectorAll('.landing-forum-topic').length).toBe(2);
    expect(body.classList.contains('landing-forum-body--fill')).toBe(true);

    // Content-starved: the same rows in a much taller body keep their slack.
    const tall = buildLandingForumPreview();
    const tallBody = tall.querySelector<HTMLElement>('.site-box-body')!;
    Object.defineProperty(tallBody, 'clientHeight', { value: 400, configurable: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tallBody.querySelectorAll('.landing-forum-topic').length).toBe(4);
    expect(tallBody.classList.contains('landing-forum-body--fill')).toBe(false);
  });
});
