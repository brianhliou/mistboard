import { afterEach, describe, expect, it, vi } from 'vitest';

const categories = [
  {
    id: 'strategy',
    slug: 'general-discussion',
    name: 'General Games Discussion',
    description: 'The place to discuss general games topics.',
    sortOrder: 10,
    topicWritePolicy: 'account',
    topicCount: 1,
    postCount: 2,
    latestPost: {
      post: {
        id: 'post_strategy_reply',
      },
      topic: {
        id: 'topic_strategy',
        slug: 'scouting-the-center',
        title: 'Scouting the center',
        postCount: 2,
      },
      author: { handle: 'bob', displayName: 'Bob' },
      createdAt: '2026-06-01T00:05:00.000Z',
    },
  },
  {
    id: 'support',
    slug: 'feedback',
    name: 'Mistboard Feedback',
    description: 'Bug reports, feature requests, suggestions.',
    sortOrder: 20,
    topicWritePolicy: 'account',
    topicCount: 0,
    postCount: 0,
    latestPost: null,
  },
  {
    id: 'game-analysis',
    slug: 'game-analysis',
    name: 'Game analysis',
    description: 'Show your game and analyse it with the community.',
    sortOrder: 30,
    topicWritePolicy: 'account',
    topicCount: 0,
    postCount: 0,
    latestPost: null,
  },
  {
    id: 'off-topic-discussion',
    slug: 'off-topic-discussion',
    name: 'Off-Topic Discussion',
    description: 'Everything that is not related to games.',
    sortOrder: 40,
    topicWritePolicy: 'account',
    topicCount: 0,
    postCount: 0,
    latestPost: null,
  },
];

const topic = {
  id: 'topic_strategy',
  slug: 'scouting-the-center',
  title: 'Scouting the center',
  category: { slug: 'general-discussion', name: 'General Games Discussion' },
  author: { handle: 'alice', displayName: 'Alice' },
  latestPost: {
    post: {
      id: 'post_strategy_reply',
    },
    author: { handle: 'bob', displayName: 'Bob' },
    createdAt: '2026-06-01T00:05:00.000Z',
  },
  postCount: 2,
  pinned: false,
  locked: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  lastPostAt: '2026-06-01T00:00:00.000Z',
};

const searchPost = {
  post: {
    id: 'post_strategy_reply',
    page: 1,
    snippet: 'Developing knights first keeps more fog pressure.',
  },
  topic: {
    id: 'topic_strategy',
    slug: 'scouting-the-center',
    title: 'Scouting the center',
    postCount: 2,
    category: { slug: 'general-discussion', name: 'General Games Discussion' },
  },
  author: { handle: 'bob', displayName: 'Bob' },
  createdAt: '2026-06-01T00:05:00.000Z',
};

const adminUser = {
  id: 'admin_1',
  email: 'admin@example.com',
  emailVerified: true,
  handle: 'admin',
  handleChangedAt: null,
  displayName: 'Admin',
  displayNameChangedAt: null,
  profileVisibility: 'public',
  accountRole: 'admin',
  locale: null,
};

const playerUser = {
  id: 'player_1',
  email: 'player@example.com',
  emailVerified: true,
  handle: 'charlie',
  handleChangedAt: null,
  displayName: 'Charlie',
  displayNameChangedAt: null,
  profileVisibility: 'public',
  accountRole: 'player',
  locale: null,
};

describe('forum pages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.history.pushState(null, '', '/');
  });

  it('renders the forum index as a single panel of categories', async () => {
    const fetchedUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) return json({ topics: [topic] });
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(fetchedUrls).not.toContain('/api/forum/topics?limit=26&offset=0');
    expect(root.textContent).toContain('Forum');
    expect(root.textContent).toContain('Topics');
    expect(root.textContent).toContain('Posts');
    expect(root.textContent).toContain('Bob');
    expect(root.querySelector('.forum-panel')).not.toBeNull();
    expect(root.querySelector('.forum-search-form-compact')).not.toBeNull();
    expect(root.querySelector('.forum-category-latest-meta')?.textContent).toContain('by Bob');
    expect(root.textContent).toContain('Scouting the center');
    expect(root.textContent).not.toContain('Sign in to start a topic.');
    expect(root.querySelector('.forum-form')).toBeNull();
    expect(
      root.querySelector<HTMLAnchorElement>('a.forum-category-index-main')?.getAttribute('href'),
    ).toBe('/forum/general-discussion');
    expect(
      root.querySelector<HTMLAnchorElement>('a.forum-category-latest-title')?.getAttribute('href'),
    ).toBe('/forum/t/topic_strategy/scouting-the-center#post_post_strategy_reply');
    expect(
      root.querySelector<HTMLAnchorElement>('.forum-category-latest-author')?.getAttribute('href'),
    ).toBe('/@/bob');
    expect(root.querySelector('.forum-topic-title')).toBeNull();
  });

  it('links admins to the forum report queue from the forum index', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    const reports = root.querySelector<HTMLAnchorElement>('.forum-report-admin-link');
    expect(reports?.textContent).toBe('Reports');
    expect(reports?.getAttribute('href')).toBe('/forum/reports');
  });

  // The forum home was the last surface handing out the Discord invite: it left
  // the top nav 2026-08-28 and the homepage footer and this page on 2026-08-31,
  // because the room is not ready to be promoted. Held as a test because the
  // link moved three times in five days.
  it('hands out no Discord invite from the forum home', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(root.querySelector('.forum-panel-actions')).not.toBeNull();
    expect(root.querySelector('a[href^="https://discord.gg/"]')).toBeNull();
  });

  it('renders a selected category as a focused topic view', async () => {
    const fetchedUrls: string[] = [];
    window.history.pushState(null, '', '/forum/general-discussion');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) return json({ topics: [topic] });
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(fetchedUrls).toContain(
      '/api/forum/topics?category=general-discussion&limit=26&offset=0',
    );
    expect(root.querySelector('.forum-panel-header-category')?.textContent).toContain(
      'General Games Discussion',
    );
    expect(root.querySelector<HTMLAnchorElement>('.forum-panel-back')?.getAttribute('href')).toBe(
      '/forum',
    );
    expect(root.querySelector('.forum-panel-action')?.textContent).toBe('Sign in to post');
    expect(
      root.querySelector('.forum-topic-row:not(.forum-topic-list-header) .forum-topic-flags'),
    ).toBeNull();
  });

  it('defaults new topics to the selected category when the user can post there', async () => {
    window.history.pushState(null, '', '/forum?category=general-discussion');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) return json({ topics: [topic] });
      if (url.startsWith('/api/auth/me')) {
        return json({
          user: {
            id: 'alice_1',
            email: 'alice@example.com',
            emailVerified: true,
            handle: 'alice',
            handleChangedAt: null,
            displayName: 'Alice',
            displayNameChangedAt: null,
            profileVisibility: 'public',
            accountRole: 'player',
            locale: null,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    const action = root.querySelector<HTMLButtonElement>('button.forum-panel-action');
    const composer = root.querySelector<HTMLElement>('.forum-topic-composer');
    expect(action?.textContent).toBe('Create a new topic');
    expect(composer?.hidden).toBe(true);
    action?.click();
    expect(composer?.hidden).toBe(false);
    const select = root.querySelector<HTMLSelectElement>('select[name="categorySlug"]');
    const announcement = root.querySelector<HTMLOptionElement>('option[value="announcements"]');
    const feedback = root.querySelector<HTMLOptionElement>('option[value="feedback"]');
    expect(select?.value).toBe('general-discussion');
    expect(announcement).toBeNull();
    expect(feedback?.disabled).toBe(false);
    const body = composer?.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const previewTab = Array.from(
      composer?.querySelectorAll<HTMLButtonElement>('.forum-composer-tab') ?? [],
    ).find((button) => button.textContent === 'Preview');
    body!.value = '> Alice wrote:\n> Scout the center\n\nThen develop.';
    previewTab?.click();
    expect(body?.hidden).toBe(true);
    expect(composer?.querySelector('.forum-composer-preview')?.textContent).toContain(
      'Alice wrote:\nScout the center',
    );
    expect(composer?.querySelector('.forum-composer-preview')?.textContent).toContain(
      'Then develop.',
    );
  });

  it('paginates forum topic lists with stable page URLs', async () => {
    const fetchedUrls: string[] = [];
    window.history.pushState(null, '', '/forum/general-discussion?page=2');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) {
        return json({
          topics: Array.from({ length: 26 }, (_, index) => ({
            ...topic,
            id: `topic_strategy_${index}`,
            title: `Scouting the center ${index}`,
            slug: `scouting-the-center-${index}`,
          })),
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(fetchedUrls).toContain(
      '/api/forum/topics?category=general-discussion&limit=26&offset=25',
    );
    expect(root.querySelector('.forum-topic-list-header')?.textContent).toContain('Replies');
    expect(root.querySelector('.forum-topic-list-header')?.textContent).toContain('Last post');
    expect(root.querySelectorAll('.forum-topic-row:not(.forum-topic-list-header)')).toHaveLength(
      25,
    );
    expect(
      root.querySelector('.forum-topic-row:not(.forum-topic-list-header) .forum-topic-row-replies')
        ?.textContent,
    ).toBe('1');
    const pagers = Array.from(root.querySelectorAll<HTMLElement>('.forum-pager'));
    expect(pagers).toHaveLength(1);
    expect(pagers[0]?.getAttribute('aria-label')).toBe('Forum topic pages');
    expect(pagers[0]?.querySelector('.forum-pager-current')?.textContent).toBe('2');
    const pageLinks = Array.from(
      pagers[0]?.querySelectorAll<HTMLAnchorElement>('.forum-pager-link') ?? [],
    );
    expect(pageLinks.map((link) => link.textContent)).toEqual(['1', '3']);
    expect(pageLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/forum/general-discussion',
      '/forum/general-discussion?page=3',
    ]);
    expect(root.querySelector('.forum-topic-autopager')).not.toBeNull();
  });

  it('auto-loads the next topic page when the list sentinel becomes visible', async () => {
    const fetchedUrls: string[] = [];
    window.history.pushState(null, '', '/forum/general-discussion');
    const observed: Element[] = [];
    let intersect: (() => void) | undefined;
    class FakeIntersectionObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        intersect = () => {
          callback([{ isIntersecting: true }]);
        };
      }
      observe(target: Element): void {
        observed.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const topicsForOffset = (offset: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...topic,
        id: `topic_auto_${offset + index}`,
        title: `Auto topic ${offset + index}`,
        slug: `auto-topic-${offset + index}`,
      }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) {
        const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset') ?? '0');
        return json({ topics: topicsForOffset(offset, offset === 0 ? 26 : 4) });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    // The auto-pager ignores intersections while detached, so mount for real.
    document.body.append(root);
    const { mountForum } = await import('./forum.js');

    await mountForum(root);
    try {
      expect(root.querySelectorAll('.forum-topic-row:not(.forum-topic-list-header)')).toHaveLength(
        25,
      );
      expect(root.querySelector('.forum-pager')).toBeNull();
      const sentinel = root.querySelector('.forum-topic-autopager');
      expect(sentinel).not.toBeNull();
      expect(observed).toContain(sentinel);

      intersect?.();
      await vi.waitFor(() => {
        expect(fetchedUrls).toContain(
          '/api/forum/topics?category=general-discussion&limit=26&offset=25',
        );
      });
      await vi.waitFor(() => {
        expect(
          root.querySelectorAll('.forum-topic-row:not(.forum-topic-list-header)'),
        ).toHaveLength(29);
      });
      // The short second page ends the list: the sentinel unmounts.
      expect(root.querySelector('.forum-topic-autopager')).toBeNull();
      expect(root.querySelector<HTMLAnchorElement>('.forum-topic-title')?.textContent).toBe(
        'Auto topic 0',
      );
    } finally {
      root.remove();
      vi.unstubAllGlobals();
    }
  });

  it('renders backend forum search with paginated result URLs', async () => {
    const fetchedUrls: string[] = [];
    window.history.pushState(null, '', '/forum?q=central%20fog&page=2');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/search')) {
        return json({
          total: 42,
          posts: Array.from({ length: 26 }, (_, index) => ({
            ...searchPost,
            post: {
              id: `post_search_${index}`,
              page: index === 0 ? 2 : 1,
              snippet: `Search snippet ${index}`,
            },
            topic: {
              ...searchPost.topic,
              id: `topic_search_${index}`,
              title: `Search result ${index}`,
              slug: `search-result-${index}`,
            },
          })),
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(fetchedUrls).toContain('/api/forum/search?q=central+fog&limit=26&offset=25');
    expect(root.textContent).toContain('Search results');
    expect(root.textContent).toContain('"central fog"');
    expect(root.textContent).toContain('42 forum posts');
    expect(root.textContent).toContain('Search snippet 0');
    expect(root.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe('central fog');
    expect(root.querySelector('.forum-topic-list-header')).toBeNull();
    expect(root.querySelectorAll('.forum-search-row')).toHaveLength(25);
    expect(root.querySelector<HTMLAnchorElement>('.forum-search-title')?.getAttribute('href')).toBe(
      '/forum/t/topic_search_0/search-result-0?page=2#post_post_search_0',
    );
    const pagers = Array.from(root.querySelectorAll<HTMLElement>('.forum-pager'));
    expect(pagers).toHaveLength(2);
    expect(pagers[0]?.querySelector('.forum-pager-current')?.textContent).toBe('2');
    const pageLinks = Array.from(
      pagers[0]?.querySelectorAll<HTMLAnchorElement>('.forum-pager-link') ?? [],
    );
    expect(pageLinks.map((link) => link.textContent)).toEqual(['1', '3']);
    expect(pageLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/forum?q=central+fog',
      '/forum?q=central+fog&page=3',
    ]);
  });

  it('links latest topic rows to their topic page when threads are long', async () => {
    const longTopic = { ...topic, postCount: 26 };
    const longCategories = categories.map((category) =>
      category.slug === 'general-discussion' && category.latestPost
        ? {
            ...category,
            latestPost: {
              ...category.latestPost,
              topic: {
                ...category.latestPost.topic,
                postCount: 26,
              },
            },
          }
        : category,
    );
    window.history.pushState(null, '', '/forum/general-discussion');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories: longCategories });
      if (url.startsWith('/api/forum/topics')) return json({ topics: [longTopic] });
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(
      root.querySelector<HTMLAnchorElement>('.forum-topic-latest-link')?.getAttribute('href'),
    ).toBe('/forum/t/topic_strategy/scouting-the-center?page=2#post_post_strategy_reply');
    const pageLinks = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('.forum-topic-page-link'),
    );
    expect(pageLinks.map((link) => link.textContent)).toEqual(['2']);
    expect(pageLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/forum/t/topic_strategy/scouting-the-center?page=2',
    ]);
  });

  it('allows admins to start feedback topics', async () => {
    window.history.pushState(null, '', '/forum/feedback');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics')) return json({ topics: [topic] });
      if (url.startsWith('/api/auth/me')) {
        return json({ user: adminUser });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForum } = await import('./forum.js');

    await mountForum(root);

    expect(root.querySelector<HTMLButtonElement>('button.forum-panel-action')?.textContent).toBe(
      'Create a new topic',
    );
    const select = root.querySelector<HTMLSelectElement>('select[name="categorySlug"]');
    const feedback = root.querySelector<HTMLOptionElement>('option[value="feedback"]');
    expect(feedback?.disabled).toBe(false);
    expect(select?.value).toBe('feedback');
  });

  it('lets a signed-in reader watch and unwatch a topic', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url === '/api/forum/topics/topic_strategy/watch') {
        return json({ watching: init?.method === 'PUT' });
      }
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({ topic: { ...topic, posts: [], viewer: { watching: false } } });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: playerUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    const button = root.querySelector<HTMLButtonElement>('button.forum-topic-watch');
    expect(button?.textContent).toBe('Watch');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    // Not watching, so this visit sends no read receipt.
    expect(calls.some((call) => call.endsWith('/seen'))).toBe(false);

    button?.click();
    await vi.waitFor(() => expect(button?.textContent).toBe('Watching'));
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(calls).toContain('PUT /api/forum/topics/topic_strategy/watch');

    button?.click();
    await vi.waitFor(() => expect(button?.textContent).toBe('Watch'));
    expect(calls).toContain('DELETE /api/forum/topics/topic_strategy/watch');
  });

  it('sends a read receipt when a watcher opens the topic', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url === '/api/forum/topics/topic_strategy/seen') return json({ ok: true });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({ topic: { ...topic, posts: [], viewer: { watching: true } } });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: playerUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(root.querySelector('button.forum-topic-watch')?.textContent).toBe('Watching');
    expect(calls).toContain('POST /api/forum/topics/topic_strategy/seen');
  });

  it('renders topic moderation controls for admins', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    const buttonLabels = Array.from(root.querySelectorAll('button'), (button) =>
      button.textContent?.trim(),
    );
    expect(root.textContent).toContain('Moderation');
    expect(buttonLabels).toContain('Pin');
    expect(buttonLabels).toContain('Lock');
    expect(buttonLabels).toContain('Hide topic');
    expect(buttonLabels).toContain('Hide post');
    expect(buttonLabels).toContain('Move');
    expect(root.querySelector('.forum-topic-move-form')?.textContent).toContain('Move to');
  });

  it('sends admin moderation reasons when hiding forum content', async () => {
    window.history.pushState(null, '', '/forum/t/topic_strategy/scouting-the-center');
    vi.stubGlobal(
      'prompt',
      vi.fn().mockReturnValueOnce('duplicate topic').mockReturnValueOnce('spam post'),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/forum/topics/topic_strategy/moderation' && init?.method === 'POST') {
        return json({ ok: true });
      }
      if (url === '/api/forum/posts/post_1/moderation' && init?.method === 'POST') {
        return json({ ok: true, topicHidden: true });
      }
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const hideTopic = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Hide topic',
    );
    const hidePost = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Hide post',
    );
    if (!hideTopic || !hidePost) throw new Error('missing hide moderation buttons');

    hideTopic.click();
    await flushPromises();
    hidePost.click();
    await flushPromises();

    const topicCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/topics/topic_strategy/moderation' && init?.method === 'POST',
    );
    const postCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/posts/post_1/moderation' && init?.method === 'POST',
    );
    expect(JSON.parse(String(topicCall?.[1]?.body))).toEqual({
      action: 'hide',
      reason: 'duplicate topic',
    });
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      action: 'hide',
      reason: 'spam post',
    });
  });

  it('lets signed-in users report topics and posts with reasons', async () => {
    window.history.pushState(null, '', '/forum/t/topic_strategy/scouting-the-center');
    vi.stubGlobal(
      'prompt',
      vi.fn().mockReturnValueOnce('bad topic').mockReturnValueOnce('bad post'),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/forum/topics/topic_strategy/report' && init?.method === 'POST') {
        return json({ report: { id: 'forum_report_topic' } });
      }
      if (url === '/api/forum/posts/post_1/report' && init?.method === 'POST') {
        return json({ report: { id: 'forum_report_post' } });
      }
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: playerUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const reportTopic = root.querySelector<HTMLButtonElement>('.forum-topic-report');
    const reportPost = root.querySelector<HTMLButtonElement>('.forum-post-report');
    if (!reportTopic || !reportPost) throw new Error('missing report buttons');

    reportTopic.click();
    await flushPromises();
    reportPost.click();
    await flushPromises();

    const topicCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/topics/topic_strategy/report' && init?.method === 'POST',
    );
    const postCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/posts/post_1/report' && init?.method === 'POST',
    );
    expect(JSON.parse(String(topicCall?.[1]?.body))).toEqual({ reason: 'bad topic' });
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ reason: 'bad post' });
    expect(reportTopic.textContent).toBe('Reported');
    expect(reportPost.textContent).toBe('Reported');
  });

  it('renders an admin forum report queue and resolves reports', async () => {
    window.history.pushState(null, '', '/forum/reports');
    vi.stubGlobal('prompt', vi.fn().mockReturnValueOnce('handled'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/forum/reports?limit=51&offset=0') {
        return json({
          reports: [
            {
              id: 'forum_report_post',
              status: 'open',
              targetType: 'post',
              reason: 'bad post',
              resolutionNote: null,
              reporter: { handle: 'charlie', displayName: 'Charlie' },
              resolver: null,
              createdAt: '2026-06-01T00:10:00.000Z',
              updatedAt: '2026-06-01T00:10:00.000Z',
              resolvedAt: null,
              topic: {
                id: 'topic_strategy',
                slug: 'scouting-the-center',
                title: 'Scouting the center',
                category: { slug: 'general-discussion', name: 'General Games Discussion' },
                hidden: false,
              },
              post: {
                id: 'post_1',
                page: 1,
                snippet: 'Opening post.',
                author: { handle: 'alice', displayName: 'Alice' },
                createdAt: '2026-06-01T00:00:00.000Z',
                hidden: false,
              },
            },
          ],
        });
      }
      if (url === '/api/forum/reports/forum_report_post' && init?.method === 'PATCH') {
        return json({ report: { id: 'forum_report_post', status: 'resolved' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumReports } = await import('./forum.js');

    await mountForumReports(root);

    expect(root.textContent).toContain('Forum reports');
    expect(root.textContent).toContain('bad post');
    expect(root.textContent).toContain('Opening post.');
    expect(root.querySelector<HTMLAnchorElement>('.forum-report-title')?.getAttribute('href')).toBe(
      '/forum/t/topic_strategy/scouting-the-center#post_post_1',
    );
    expect(
      Array.from(root.querySelectorAll('button'), (button) => button.textContent?.trim()),
    ).toContain('Hide post');
    const resolve = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Resolve',
    );
    if (!resolve) throw new Error('missing resolve button');

    resolve.click();
    await flushPromises();

    const resolutionCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/reports/forum_report_post' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(resolutionCall?.[1]?.body))).toEqual({
      status: 'resolved',
      resolutionNote: 'handled',
    });
  });

  it('hides reported posts from the admin report queue', async () => {
    window.history.pushState(null, '', '/forum/reports');
    vi.stubGlobal('prompt', vi.fn().mockReturnValueOnce('bad post'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/forum/reports?limit=51&offset=0') {
        return json({
          reports: [
            {
              id: 'forum_report_post',
              status: 'open',
              targetType: 'post',
              reason: 'bad post',
              resolutionNote: null,
              reporter: { handle: 'charlie', displayName: 'Charlie' },
              resolver: null,
              createdAt: '2026-06-01T00:10:00.000Z',
              updatedAt: '2026-06-01T00:10:00.000Z',
              resolvedAt: null,
              topic: {
                id: 'topic_strategy',
                slug: 'scouting-the-center',
                title: 'Scouting the center',
                category: { slug: 'general-discussion', name: 'General Games Discussion' },
                hidden: false,
              },
              post: {
                id: 'post_1',
                page: 1,
                snippet: 'Opening post.',
                author: { handle: 'alice', displayName: 'Alice' },
                createdAt: '2026-06-01T00:00:00.000Z',
                hidden: false,
              },
            },
          ],
        });
      }
      if (url === '/api/forum/posts/post_1/moderation' && init?.method === 'POST') {
        return json({ ok: true, topicHidden: false });
      }
      if (url === '/api/forum/reports/forum_report_post' && init?.method === 'PATCH') {
        return json({ report: { id: 'forum_report_post', status: 'resolved' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumReports } = await import('./forum.js');

    await mountForumReports(root);

    const hidePost = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Hide post',
    );
    if (!hidePost) throw new Error('missing hide post button');

    hidePost.click();
    await flushPromises();
    await flushPromises();

    const moderationCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/posts/post_1/moderation' && init?.method === 'POST',
    );
    const resolutionCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/reports/forum_report_post' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(moderationCall?.[1]?.body))).toEqual({
      action: 'hide',
      reason: 'bad post',
    });
    expect(JSON.parse(String(resolutionCall?.[1]?.body))).toEqual({
      status: 'resolved',
      resolutionNote: 'Hidden reported post.',
    });
  });

  it('moves a topic category from moderation controls', async () => {
    window.history.pushState(null, '', '/forum/t/topic_strategy/scouting-the-center');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url === '/api/forum/topics/topic_strategy/category' && init?.method === 'PATCH') {
        return json({
          topic: {
            ...topic,
            category: { slug: 'feedback', name: 'Mistboard Feedback' },
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    document.body.append(root);
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const form = root.querySelector<HTMLFormElement>('.forum-topic-move-form');
    const select = form?.querySelector<HTMLSelectElement>('select[name="categorySlug"]');
    if (!form || !select) throw new Error('missing topic move form');
    select.value = 'feedback';

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    const moveCall = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/forum/topics/topic_strategy/category' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(moveCall?.[1]?.body))).toEqual({ categorySlug: 'feedback' });
    expect(window.location.pathname).toBe('/forum/t/topic_strategy/scouting-the-center');
  });

  it('badges a titled post author before the name', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice', title: 'xim' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
              {
                id: 'post_2',
                author: { handle: 'bob', displayName: 'Bob', title: null },
                bodyText: 'Reply.',
                createdAt: '2026-06-01T00:01:00.000Z',
                updatedAt: '2026-06-01T00:01:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    const links = [...root.querySelectorAll('.forum-post-author-name')];
    const badge = links[0]?.querySelector('.title-badge');
    expect(badge?.textContent).toBe('XIM');
    expect(badge?.getAttribute('title')).toBe('Xiangqi International Master');
    expect(links[0]?.firstElementChild).toBe(badge);
    expect(links[0]?.querySelector('.forum-author-name')?.textContent).toBe('Alice');
    // An untitled author renders exactly as before.
    expect(links[1]?.querySelector('.title-badge')).toBeNull();
    expect(links[1]?.textContent).toBe('Bob');
  });

  it('renders topic back navigation and post author metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    const back = root.querySelector<HTMLAnchorElement>('.forum-panel-back');
    expect(back?.getAttribute('href')).toBe('/forum/general-discussion');
    expect(back?.getAttribute('aria-label')).toBe('Back to General Games Discussion');
    expect(root.querySelector<HTMLInputElement>('input[name="q"]')).toBeNull();
    expect(root.querySelector<HTMLAnchorElement>('.forum-post-author-name')?.textContent).toBe(
      'Alice',
    );
    expect(
      root.querySelector<HTMLAnchorElement>('.forum-post-author-name')?.getAttribute('href'),
    ).toBe('/@/alice');
    // Single identifier only: the redundant "@handle" sub-line is gone.
    expect(root.querySelector('.forum-post-author-handle')).toBeNull();
    expect(root.querySelector('.forum-post-permalink')?.textContent).toBe('#1');
  });

  it('shows an online dot for a post author flagged online', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice', online: true },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(root.querySelector('.forum-post-author .forum-online-dot')).not.toBeNull();
  });

  it('quotes a post into the reply form', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.\nSecond line',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    document.body.append(root);
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const quote = root.querySelector<HTMLButtonElement>('.forum-post-quote');
    const body = root.querySelector<HTMLTextAreaElement>('.forum-reply-form textarea[name="body"]');
    if (!quote || !body) throw new Error('missing quote controls');

    quote.click();

    expect(body.value).toBe('> Alice wrote:\n> Opening post.\n> Second line\n\n');
    expect(document.activeElement).toBe(body);
  });

  it('renders plaintext quote markers as safe blockquotes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText:
                  '> Alice wrote:\n> Opening <script>alert(1)</script>\n\nReply stays plaintext.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('.forum-post-quote-block')?.textContent).toBe(
      'Alice wrote:\nOpening <script>alert(1)</script>',
    );
    expect(root.querySelector('.forum-post-paragraph')?.textContent).toBe('Reply stays plaintext.');
  });

  it('redirects a new reply to its stable post anchor', async () => {
    window.history.pushState(null, '', '/forum/t/topic_strategy/scouting-the-center');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/forum/topics/topic_strategy') && init?.method !== 'POST') {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url === '/api/forum/topics/topic_strategy/posts') {
        return json({
          post: {
            id: 'post_created',
            author: { handle: 'bob', displayName: 'Bob' },
            bodyText: 'A sharper reply.',
            createdAt: '2026-06-01T00:05:00.000Z',
            updatedAt: '2026-06-01T00:05:00.000Z',
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const body = root.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if (!body) throw new Error('missing reply textarea');
    body.value = 'A sharper reply.';
    const form = root.querySelector<HTMLFormElement>('form.forum-form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const postCall = fetchSpy.mock.calls.find(
      ([input]) => String(input) === '/api/forum/topics/topic_strategy/posts',
    );
    expect(postCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      body: 'A sharper reply.',
      quotedPostIds: [],
    });
    expect(window.location.pathname).toBe('/forum/t/topic_strategy/scouting-the-center');
    expect(window.location.hash).toBe('#post_post_created');
  });

  it('links the quoted post on submit, unless the writer deleted the quote again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return json({ categories });
      if (url === '/api/forum/topics/topic_strategy/posts') {
        return json({
          post: {
            id: 'post_created',
            author: { handle: 'bob', displayName: 'Bob' },
            bodyText: 'Reply.',
            createdAt: '2026-06-01T00:05:00.000Z',
            updatedAt: '2026-06-01T00:05:00.000Z',
          },
        });
      }
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
              {
                id: 'post_2',
                author: { handle: 'carol', displayName: 'Carol' },
                bodyText: 'Second post.',
                createdAt: '2026-06-01T00:01:00.000Z',
                updatedAt: '2026-06-01T00:01:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    document.body.append(root);
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');
    const quotes = root.querySelectorAll<HTMLButtonElement>('.forum-post-quote');
    const body = root.querySelector<HTMLTextAreaElement>('.forum-reply-form textarea[name="body"]');
    const form = root.querySelector<HTMLFormElement>('form.forum-reply-form');
    if (quotes.length !== 2 || !body || !form) throw new Error('missing quote controls');

    quotes[0]?.click();
    quotes[1]?.click();
    // Carol's quote is deleted again before sending; only Alice stays linked.
    body.value = `${body.value.split('> Carol wrote:')[0]}My answer.`;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const postCall = fetchSpy.mock.calls.find(
      ([input]) => String(input) === '/api/forum/topics/topic_strategy/posts',
    );
    expect(JSON.parse(String(postCall?.[1]?.body)).quotedPostIds).toEqual(['post_1']);
  });

  it('paginates topic posts with stable page URLs', async () => {
    const fetchedUrls: string[] = [];
    window.history.pushState(null, '', '/forum/t/topic_strategy/scouting-the-center?page=2');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            postCount: 52,
            posts: Array.from({ length: 26 }, (_, index) => ({
              id: `post_page_${index}`,
              author: { handle: 'alice', displayName: 'Alice' },
              bodyText: `Post ${index}`,
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            })),
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(fetchedUrls).toContain('/api/forum/topics/topic_strategy?limit=26&offset=25');
    expect(root.querySelectorAll('.forum-post')).toHaveLength(25);
    expect(root.querySelector<HTMLElement>('.forum-post')?.id).toBe('post_post_page_0');
    expect(
      root.querySelector<HTMLAnchorElement>('.forum-post-permalink')?.getAttribute('href'),
    ).toBe('/forum/t/topic_strategy/scouting-the-center?page=2#post_post_page_0');
    expect(root.querySelector('.forum-post-permalink')?.textContent).toBe('#26');
    expect(
      root.querySelector<HTMLAnchorElement>('.forum-post-author-name')?.getAttribute('href'),
    ).toBe('/@/alice');
    const pagers = Array.from(root.querySelectorAll<HTMLElement>('.forum-pager'));
    expect(pagers).toHaveLength(2);
    expect(pagers.map((pager) => pager.getAttribute('aria-label'))).toEqual([
      'Forum post pages',
      'Forum post pages',
    ]);
    expect(pagers[0]?.querySelector('.forum-pager-current')?.textContent).toBe('2');
    const pageLinks = Array.from(
      pagers[0]?.querySelectorAll<HTMLAnchorElement>('.forum-pager-link') ?? [],
    );
    expect(pageLinks.map((link) => link.textContent)).toEqual(['1', '3']);
    expect(pageLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/forum/t/topic_strategy/scouting-the-center',
      '/forum/t/topic_strategy/scouting-the-center?page=3',
    ]);
  });

  it('autolinks safe forum post URLs without rendering unsafe schemes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText:
                  'Study https://mistboard.com/rules/fog-chess.\n> Source http://example.com/thread\nNo javascript:alert(1)',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.forum-post-body a'));
    expect(links.map((link) => link.textContent)).toEqual([
      'https://mistboard.com/rules/fog-chess',
      'http://example.com/thread',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://mistboard.com/rules/fog-chess',
      'http://example.com/thread',
    ]);
    expect(links.every((link) => link.target === '_blank')).toBe(true);
    expect(links.every((link) => link.rel === 'nofollow noopener noreferrer')).toBe(true);
    expect(root.querySelector('.forum-post-body')?.textContent).toContain(
      'https://mistboard.com/rules/fog-chess.',
    );
    expect(root.querySelector('.forum-post-body')?.textContent).toContain('javascript:alert(1)');
    expect(links.some((link) => (link.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(
      false,
    );
  });

  describe('link expansion', () => {
    function topicWith(bodyText: string, oembed: (url: string) => Response | null) {
      const oembedUrls: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith('/api/forum/topics/topic_strategy')) {
          return json({
            topic: {
              ...topic,
              posts: [
                {
                  id: 'post_1',
                  author: { handle: 'alice', displayName: 'Alice' },
                  bodyText,
                  createdAt: '2026-06-01T00:00:00.000Z',
                  updatedAt: '2026-06-01T00:00:00.000Z',
                },
              ],
            },
          });
        }
        if (url.startsWith('/api/auth/me')) return json({ user: null });
        if (url.startsWith('/api/oembed?url=')) {
          const target = decodeURIComponent(url.slice('/api/oembed?url='.length));
          oembedUrls.push(target);
          return oembed(target) ?? new Response('{"error":"not_found"}', { status: 404 });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      return oembedUrls;
    }
    const frame = (title: string) => json({ title, width: 760, height: 700, html: '<iframe>' });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('expands a Mistboard link that is alone on its line into a same-origin frame', async () => {
      const asked = topicWith(
        'My best fog game yet:\nhttps://mistboard.com/dark-xiangqi/game/room-1/black#30\nSee move 30.',
        () => frame('Alice vs Bob · red-wins · Mistboard'),
      );
      const root = document.createElement('div');
      const { mountForumTopic } = await import('./forum.js');
      await mountForumTopic(root, 'topic_strategy');
      await settle();

      expect(asked).toEqual(['https://mistboard.com/dark-xiangqi/game/room-1/black#30']);
      const figure = root.querySelector<HTMLElement>('.forum-post-body .forum-embed');
      expect(figure).not.toBeNull();
      expect(figure?.classList.contains('forum-embed-live')).toBe(true);
      const iframe = figure?.querySelector<HTMLIFrameElement>('iframe.forum-embed-frame');
      // Same-origin path, never the pasted URL: the tenant segment is not
      // trusted, and the embed page reads the game's own record. The side and
      // the ply ride along, in lichess's spelling or ours.
      expect(iframe?.getAttribute('src')).toBe('/embed/game/room-1?ply=30&pov=black');
      expect(iframe?.getAttribute('loading')).toBe('lazy');
      expect(iframe?.title).toBe('Alice vs Bob · red-wins · Mistboard');
      // The link was the placeholder; the frame replaces it outright (the
      // embed carries its own credit link to the same game).
      expect(figure?.querySelector('.forum-embed-caption')).toBeNull();
      expect(figure?.querySelector('a')).toBeNull();
      // The prose around it is untouched.
      const paragraphs = Array.from(root.querySelectorAll('.forum-post-paragraph'));
      expect(paragraphs.map((p) => p.textContent)).toEqual([
        'My best fog game yet:',
        'See move 30.',
      ]);
    });

    it('leaves a link that is not the whole line, or not a board, as a link', async () => {
      const asked = topicWith(
        [
          'Look at https://mistboard.com/game/room-1 here',
          'https://mistboard.com/rules/fog-chess',
          'https://example.com/game/room-1',
          '> https://mistboard.com/game/room-2',
        ].join('\n'),
        () => frame('never'),
      );
      const root = document.createElement('div');
      const { mountForumTopic } = await import('./forum.js');
      await mountForumTopic(root, 'topic_strategy');
      await settle();

      // Mid-sentence, a page, another site, and a quoted line: none asked the
      // provider, none became a frame.
      expect(asked).toEqual([]);
      expect(root.querySelector('.forum-embed')).toBeNull();
      expect(root.querySelector('iframe')).toBeNull();
      const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.forum-post-body a'));
      expect(links).toHaveLength(4);
    });

    it('keeps the link when the provider refuses: an unfinished game is never framed', async () => {
      const asked = topicWith('https://mistboard.com/dark-chess/game/live-fog-game', () => null);
      const root = document.createElement('div');
      const { mountForumTopic } = await import('./forum.js');
      await mountForumTopic(root, 'topic_strategy');
      await settle();

      expect(asked).toEqual(['https://mistboard.com/dark-chess/game/live-fog-game']);
      const figure = root.querySelector<HTMLElement>('.forum-embed');
      expect(figure?.classList.contains('forum-embed-live')).toBe(false);
      expect(root.querySelector('iframe')).toBeNull();
      expect(
        figure?.querySelector<HTMLAnchorElement>('.forum-embed-caption a')?.getAttribute('href'),
      ).toBe('https://mistboard.com/dark-chess/game/live-fog-game');
    });

    it('caps the frames per post and asks the provider once per distinct URL', async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `https://mistboard.com/game/room-${i}`);
      // The first URL is pasted twice: one provider call, two frames.
      const asked = topicWith([lines[0], ...lines].join('\n'), () => frame('t'));
      const root = document.createElement('div');
      const { mountForumTopic } = await import('./forum.js');
      await mountForumTopic(root, 'topic_strategy');
      await settle();

      expect(root.querySelectorAll('.forum-embed')).toHaveLength(10);
      expect(root.querySelectorAll('iframe')).toHaveLength(10);
      expect(new Set(asked).size).toBe(asked.length);
      // Past the cap the lines are ordinary autolinked prose.
      const overflow = Array.from(
        root.querySelectorAll<HTMLAnchorElement>('.forum-post-paragraph a'),
      );
      expect(overflow.map((a) => a.getAttribute('href'))).toEqual([
        'https://mistboard.com/game/room-9',
        'https://mistboard.com/game/room-10',
        'https://mistboard.com/game/room-11',
      ]);
    });
  });

  it('renders topic posts as escaped plaintext', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Hello <script>alert(1)</script>\nSecond line',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: null });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector<HTMLElement>('.forum-post')?.id).toBe('post_post_1');
    expect(
      root.querySelector<HTMLAnchorElement>('.forum-post-permalink')?.getAttribute('href'),
    ).toBe('/forum/t/topic_strategy/scouting-the-center#post_post_1');
    expect(root.querySelector('.forum-post-body')?.textContent).toContain(
      'Hello <script>alert(1)</script>',
    );
  });

  it('keeps hidden posts as deleted tombstones with stable anchors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/forum/topics/topic_strategy')) {
        return json({
          topic: {
            ...topic,
            posts: [
              {
                id: 'post_1',
                author: { handle: 'alice', displayName: 'Alice' },
                bodyText: 'Opening post.',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
              {
                id: 'post_hidden',
                author: { handle: 'bob', displayName: 'Bob' },
                bodyText: '',
                createdAt: '2026-06-01T00:01:00.000Z',
                updatedAt: '2026-06-01T00:02:00.000Z',
                hidden: true,
                hiddenAt: '2026-06-01T00:02:00.000Z',
              },
            ],
          },
        });
      }
      if (url.startsWith('/api/auth/me')) return json({ user: adminUser });
      throw new Error(`unexpected fetch ${url}`);
    });
    const root = document.createElement('div');
    const { mountForumTopic } = await import('./forum.js');

    await mountForumTopic(root, 'topic_strategy');

    expect(root.querySelectorAll('.forum-post')).toHaveLength(2);
    const tombstone = root.querySelector<HTMLElement>('.forum-post-erased');
    expect(tombstone?.id).toBe('post_post_hidden');
    expect(tombstone?.textContent).toContain('Comment deleted by moderator.');
    expect(tombstone?.querySelector('.forum-post-permalink')?.textContent).toBe('#2');
    expect(tombstone?.querySelector('.forum-post-quote')).toBeNull();
    expect(tombstone?.querySelector('.forum-post-edit')).toBeNull();
    expect(tombstone?.querySelector('.forum-moderation-actions')).toBeNull();
  });

  it('renders the dedicated forum etiquette page', async () => {
    const root = document.createElement('div');
    const { mountForumEtiquette } = await import('./forum.js');

    await mountForumEtiquette(root);

    const panel = root.querySelector('.forum-etiquette-panel');
    expect(panel?.querySelector('.forum-etiquette-title')?.textContent).toBe('Forum etiquette');
    expect(root.querySelector<HTMLAnchorElement>('.forum-panel-back')?.getAttribute('href')).toBe(
      '/forum',
    );
    // Do/don't example lines render with a marker.
    expect(root.querySelectorAll('.forum-etiquette-example').length).toBeGreaterThan(0);
    // The cheating-reports section points at the private contact page.
    const contact = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('.forum-etiquette-para a'),
    ).find((link) => link.getAttribute('href') === '/contact');
    expect(contact).toBeTruthy();
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
