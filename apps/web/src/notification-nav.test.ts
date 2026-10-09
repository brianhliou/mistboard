import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAccountPreference } from './account-preferences.js';
import { t } from './i18n/catalog.js';
import {
  challengesNotificationSource,
  clearNotificationBells,
  correspondenceNotificationSource,
  type ForumWatchNotification,
  followersNotificationSource,
  forumNotificationSource,
  inboxNotificationSource,
  mountNotificationBell,
  type NotificationCounts,
  refreshNotifications,
  registerNotificationSource,
  resetNotificationSourcesForTest,
  type SeekExpiryNotification,
  seekExpiryNotificationSource,
} from './notification-nav.js';

const NO_COUNTS: NotificationCounts = {
  inboxUnread: 0,
  correspondenceYourMove: 0,
  newFollowers: 0,
  followedBy: [],
  forumTopics: 0,
  forumWatched: [],
  incomingChallenges: 0,
  seekExpiries: 0,
  seekExpired: [],
};

function expiredRow(overrides: Partial<SeekExpiryNotification> = {}): SeekExpiryNotification {
  return {
    seekId: 'seek_lapsed',
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    preferredColor: 'second',
    rated: false,
    ttlDays: 14,
    ...overrides,
  };
}

function counts(overrides: Partial<NotificationCounts> = {}): NotificationCounts {
  return { ...NO_COUNTS, ...overrides };
}

function watchedRow(overrides: Partial<ForumWatchNotification> = {}): ForumWatchNotification {
  return {
    topicId: 'topic_strategy',
    slug: 'scouting-the-center',
    title: 'Scouting the center',
    unread: 2,
    firstUnreadPostId: 'post_strategy_reply',
    quote: null,
    ...overrides,
  };
}

describe('notification nav', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    clearNotificationBells();
    resetNotificationSourcesForTest();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  // Regression: the account slot sits inside site-shell's .site-nav-account
  // container, so the bell must insert as the slot's sibling, not as a child
  // of the utilities (that insertBefore threw and the signed-in menu never
  // mounted; the study-creator browser smoke caught it on 2026-08-27).
  it('mounts beside the real nav account slot without assuming its parent', async () => {
    const { buildNav } = await import('./site-shell.js');
    registerNotificationSource({ read: () => ({ count: 0, entries: [] }) });
    const nav = buildNav();
    document.body.append(nav);

    expect(() => mountNotificationBell(nav)).not.toThrow();

    const bell = nav.querySelector('[data-notification-nav]');
    expect(bell?.nextElementSibling?.hasAttribute('data-account-slot')).toBe(true);
    expect(bell?.parentElement?.classList.contains('site-nav-account')).toBe(true);
  });

  it('uses the standard SVG bell instead of the dobutsu notification art', () => {
    registerNotificationSource({ read: () => ({ count: 0, entries: [] }) });
    const nav = document.createElement('nav');
    nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
    document.body.append(nav);

    mountNotificationBell(nav);

    const trigger = nav.querySelector('.notif-nav-trigger');
    expect(trigger?.querySelector('svg')).not.toBeNull();
  });

  // The reason the aggregate endpoint exists: source count and request count
  // are now decoupled. Registering more sources must not add traffic.
  it('reads every source from a single /api/notifications request', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(NO_COUNTS), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    registerNotificationSource({ read: () => ({ count: 1, entries: [] }) });
    registerNotificationSource({ read: () => ({ count: 2, entries: [] }) });
    registerNotificationSource({ read: () => ({ count: 3, entries: [] }) });

    await refreshNotifications();

    const calls = fetch.mock.calls.filter(
      (call: unknown[]) => String(call[0]) === '/api/notifications',
    );
    expect(calls).toHaveLength(1);
  });

  it('treats a failed counts fetch as nothing pending rather than keeping stale counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    registerNotificationSource({ read: (c) => ({ count: c.inboxUnread, entries: [] }) });
    const nav = document.createElement('nav');
    nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
    document.body.append(nav);
    mountNotificationBell(nav);

    await refreshNotifications();

    expect(nav.querySelector<HTMLElement>('.notif-nav-badge')?.hidden).toBe(true);
  });

  // Opening the panel is the read receipt, and the refresh that follows clears
  // the count. The rows must survive that refresh while the panel stays open,
  // or a per-topic deep link vanishes before it can be clicked.
  it("keeps an open panel's rows after the seen refresh clears the badge", async () => {
    let seen = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input) === '/api/notifications/seen') {
          seen = true;
          return new Response('{"ok":true}', { status: 200 });
        }
        const payload = seen ? {} : { forumTopics: 1, forumWatched: [watchedRow({ unread: 1 })] };
        return new Response(JSON.stringify(counts(payload)), { status: 200 });
      }),
    );
    registerNotificationSource(forumNotificationSource);
    const nav = document.createElement('nav');
    nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
    document.body.append(nav);
    mountNotificationBell(nav);
    await refreshNotifications();

    const badge = nav.querySelector<HTMLElement>('.notif-nav-badge');
    const trigger = nav.querySelector<HTMLButtonElement>('.notif-nav-trigger');
    const rows = () =>
      Array.from(
        nav.querySelectorAll('.notif-nav-item .notif-nav-label'),
        (row) => row.textContent,
      );
    expect(badge?.textContent).toBe('1');
    expect(rows()).toEqual(['1 new reply']);

    trigger?.click();
    await vi.waitFor(() => expect(badge?.hidden).toBe(true));
    expect(rows()).toEqual(['1 new reply']);

    trigger?.click();
    expect(rows()).toEqual([]);
  });

  it('surfaces nothing from the inbox source when the DM bell is disabled', () => {
    writeAccountPreference('inboxBell', false);
    expect(inboxNotificationSource.read(counts({ inboxUnread: 4 }))).toEqual({
      count: 0,
      entries: [],
    });
  });

  it('surfaces nothing from the correspondence source when its bell is disabled', () => {
    writeAccountPreference('correspondenceBell', false);
    expect(correspondenceNotificationSource.read(counts({ correspondenceYourMove: 2 }))).toEqual({
      count: 0,
      entries: [],
    });
  });

  it('names each new follower and links to their profile, with an overflow row', () => {
    const snapshot = followersNotificationSource.read(
      counts({
        newFollowers: 5,
        followedBy: [
          { handle: 'conan', displayName: 'Conan' },
          { handle: 'a b', displayName: 'Spacey' },
          // A private or closed profile: named, never linked.
          { handle: null, displayName: 'Quiet One' },
        ],
      }),
    );
    expect(snapshot.count).toBe(5);
    expect(snapshot.entries.map((entry) => [entry.label, entry.href])).toEqual([
      ['Conan followed you', '/@/conan'],
      ['Spacey followed you', '/@/a%20b'],
      ['Quiet One followed you', '/following?tab=followers'],
      ['2 more new followers', '/following?tab=followers'],
    ]);
    expect(snapshot.entries.every((entry) => entry.kind === 'follower')).toBe(true);
  });

  it('singularizes the follower overflow row', () => {
    const snapshot = followersNotificationSource.read(
      counts({ newFollowers: 2, followedBy: [{ handle: 'conan', displayName: 'Conan' }] }),
    );
    expect(snapshot.entries.map((entry) => entry.label)).toEqual([
      'Conan followed you',
      '1 more new follower',
    ]);
  });

  it('falls back to one count row on the followers list when no names arrive', () => {
    const snapshot = followersNotificationSource.read(counts({ newFollowers: 3 }));
    expect(snapshot.count).toBe(3);
    expect(snapshot.entries).toEqual([
      { label: '3 new followers', href: '/following?tab=followers', kind: 'follower' },
    ]);
  });

  it('never shows more follower rows than the badge counts', () => {
    const snapshot = followersNotificationSource.read(
      counts({
        newFollowers: 1,
        followedBy: [
          { handle: 'conan', displayName: 'Conan' },
          { handle: 'bo', displayName: 'Bo' },
        ],
      }),
    );
    expect(snapshot.entries.map((entry) => entry.label)).toEqual(['Conan followed you']);
  });

  it('translates the follower rows', () => {
    expect(t('following.bellFollowedYou', { name: 'Conan' }, 'zh-Hans')).toBe('Conan 关注了你');
    expect(t('following.bellMoreMany', { count: 2 }, 'zh-Hant')).toBe('另有 2 位新粉絲');
  });

  it('renders parsed follower rows in the panel and drops malformed ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              counts({
                newFollowers: 7,
                followedBy: [
                  { handle: 'conan', displayName: 'Conan' },
                  { handle: 42, displayName: 'Odd Handle' },
                  { handle: 'nameless', displayName: '' },
                ] as unknown as NotificationCounts['followedBy'],
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    registerNotificationSource(followersNotificationSource);
    const nav = document.createElement('nav');
    nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
    document.body.append(nav);
    mountNotificationBell(nav);
    await refreshNotifications();

    const rows = Array.from(nav.querySelectorAll<HTMLAnchorElement>('.notif-nav-item'), (row) => [
      row.textContent,
      row.getAttribute('href'),
    ]);
    expect(rows).toEqual([
      ['Conan followed you', '/@/conan'],
      // A non-string handle reads as "do not link"; a nameless row is dropped.
      ['Odd Handle followed you', '/following?tab=followers'],
      ['5 more new followers', '/following?tab=followers'],
    ]);
  });

  it('lists watched forum topics one row each, deep-linked to the first unread reply', () => {
    const snapshot = forumNotificationSource.read(
      counts({
        forumTopics: 7,
        forumWatched: [
          watchedRow({ unread: 40 }),
          watchedRow({
            topicId: 'topic_endgame',
            slug: 'endgame-practice',
            title: 'Endgame practice',
            unread: 1,
            firstUnreadPostId: 'post_endgame_reply',
          }),
        ],
      }),
    );
    // The badge counts conversations, not replies: a 40-reply thread is a 1.
    expect(snapshot.count).toBe(7);
    expect(snapshot.entries.map((entry) => [entry.label, entry.detail])).toEqual([
      ['40 new replies', 'Scouting the center'],
      ['1 new reply', 'Endgame practice'],
      ['5 more topics with new replies', undefined],
    ]);
    expect(snapshot.entries[0]?.href).toBe('/forum/redirect/post/post_strategy_reply');
    expect(snapshot.entries[2]?.href).toBe('/forum');
  });

  it('says who quoted you and links to the quoting post', () => {
    const snapshot = forumNotificationSource.read(
      counts({
        forumTopics: 1,
        forumWatched: [watchedRow({ unread: 3, quote: { postId: 'post_quoting', by: 'Bob' } })],
      }),
    );
    expect(snapshot.entries[0]?.label).toBe('Bob quoted you');
    expect(snapshot.entries[0]?.detail).toBe('Scouting the center');
    expect(snapshot.entries[0]?.kind).toBe('quote');
    expect(snapshot.entries[0]?.href).toBe('/forum/redirect/post/post_quoting');
    // A quoter whose account is gone still produces a usable row.
    expect(
      forumNotificationSource.read(
        counts({
          forumTopics: 1,
          forumWatched: [watchedRow({ quote: { postId: 'post_quoting', by: null } })],
        }),
      ).entries[0]?.label,
    ).toBe('Someone quoted you');
  });

  it('singularizes the follower, reply and challenge rows', () => {
    expect(followersNotificationSource.read(counts({ newFollowers: 1 })).entries[0]?.label).toBe(
      '1 new follower',
    );
    expect(
      forumNotificationSource.read(
        counts({ forumTopics: 1, forumWatched: [watchedRow({ unread: 1 })] }),
      ).entries[0]?.label,
    ).toBe('1 new reply');
    expect(
      challengesNotificationSource.read(counts({ incomingChallenges: 1 })).entries[0]?.label,
    ).toBe('1 challenge waiting for you');
    // It lands on the list of those challenges, not the top of the inbox.
    expect(
      challengesNotificationSource.read(counts({ incomingChallenges: 2 })).entries[0]?.href,
    ).toBe('/correspondence#incoming');
  });

  it('keeps quiet rather than showing a zero row for the new sources', () => {
    expect(followersNotificationSource.read(NO_COUNTS).entries).toEqual([]);
    expect(forumNotificationSource.read(NO_COUNTS).entries).toEqual([]);
    expect(challengesNotificationSource.read(NO_COUNTS).entries).toEqual([]);
  });

  it('tells the creator a board seek expired and links to the start form set to its terms', () => {
    const snapshot = seekExpiryNotificationSource.read(
      counts({ seekExpiries: 1, seekExpired: [expiredRow()] }),
    );
    expect(snapshot.count).toBe(1);
    expect(snapshot.entries).toEqual([
      {
        label: 'Your open Xiangqi game expired',
        detail: 'No taker in 14 days. Post it again',
        href: '/correspondence?gameSpecId=xiangqi&days=3&side=second#start',
      },
    ]);
    expect(seekExpiryNotificationSource.read(NO_COUNTS).entries).toEqual([]);
  });

  it('adds one overflow row past the capped expired-seek rows', () => {
    const snapshot = seekExpiryNotificationSource.read(
      counts({ seekExpiries: 3, seekExpired: [expiredRow()] }),
    );
    expect(snapshot.entries.at(-1)).toEqual({
      label: '2 more open games expired with no taker',
      href: '/correspondence',
    });
  });

  it('hides expired seeks with the correspondence bell, and clears them on open', async () => {
    writeAccountPreference('correspondenceBell', false);
    expect(
      seekExpiryNotificationSource.read(counts({ seekExpiries: 1, seekExpired: [expiredRow()] })),
    ).toEqual({ count: 0, entries: [] });
    writeAccountPreference('correspondenceBell', true);

    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input) === '/api/notifications/seen') {
          posted.push(JSON.parse(String(init?.body)));
          return new Response('{"ok":true}', { status: 200 });
        }
        // A malformed row is dropped by the client's parse, never rendered.
        const payload =
          posted.length > 0
            ? counts()
            : {
                ...counts(),
                seekExpiries: 1,
                seekExpired: [expiredRow(), { seekId: 'malformed' }],
              };
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    registerNotificationSource(seekExpiryNotificationSource);
    const nav = document.createElement('nav');
    nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
    document.body.append(nav);
    mountNotificationBell(nav);
    await refreshNotifications();

    const badge = nav.querySelector<HTMLElement>('.notif-nav-badge');
    const links = () =>
      Array.from(nav.querySelectorAll<HTMLAnchorElement>('.notif-nav-item'), (row) =>
        row.getAttribute('href'),
      );
    expect(badge?.textContent).toBe('1');
    expect(links()).toEqual(['/correspondence?gameSpecId=xiangqi&days=3&side=second#start']);

    nav.querySelector<HTMLButtonElement>('.notif-nav-trigger')?.click();
    await vi.waitFor(() => expect(badge?.hidden).toBe(true));
    expect(posted).toEqual([{ kind: 'seek-expiries' }]);
  });

  describe('panel layout', () => {
    const ALL_SOURCES = [
      correspondenceNotificationSource,
      inboxNotificationSource,
      followersNotificationSource,
      forumNotificationSource,
      challengesNotificationSource,
      seekExpiryNotificationSource,
    ];

    function mountWith(payload: () => NotificationCounts): {
      nav: HTMLElement;
      open: () => void;
      seenPosts: unknown[];
    } {
      const seenPosts: unknown[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
          if (String(input) === '/api/notifications/seen') {
            seenPosts.push(JSON.parse(String(init?.body)));
            return new Response('{"ok":true}', { status: 200 });
          }
          return new Response(JSON.stringify(payload()), { status: 200 });
        }),
      );
      for (const source of ALL_SOURCES) registerNotificationSource(source);
      const nav = document.createElement('nav');
      nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
      document.body.append(nav);
      mountNotificationBell(nav);
      const open = () => nav.querySelector<HTMLButtonElement>('.notif-nav-trigger')?.click();
      return { nav, open, seenPosts };
    }

    const sectionRows = (nav: HTMLElement, section: string) =>
      Array.from(
        nav.querySelectorAll(`.notif-nav-section[data-section="${section}"] .notif-nav-item`),
        (row) => ({
          label: row.querySelector('.notif-nav-label')?.textContent,
          detail: row.querySelector('.notif-nav-detail')?.textContent ?? null,
          kind: (row as HTMLElement).dataset.kind,
          dot: row.querySelector('.notif-nav-dot') !== null,
        }),
      );
    const footerLinks = (nav: HTMLElement) =>
      Array.from(nav.querySelectorAll<HTMLAnchorElement>('.notif-nav-footer a'), (link) => [
        link.textContent,
        link.getAttribute('href'),
      ]);
    const sectionTitles = (nav: HTMLElement) =>
      Array.from(nav.querySelectorAll('.notif-nav-section-title'), (el) => el.textContent);

    it('splits live state from news, gives news an unread dot, and keeps nav links out of the rows', async () => {
      const { nav } = mountWith(() =>
        counts({
          correspondenceYourMove: 3,
          incomingChallenges: 1,
          inboxUnread: 0,
          newFollowers: 2,
          forumTopics: 1,
          forumWatched: [watchedRow({ quote: { postId: 'post_q', by: 'Bob' } })],
        }),
      );
      await refreshNotifications();

      expect(nav.querySelector('.notif-nav-header')?.textContent).toBe('Notifications');
      expect(sectionTitles(nav)).toEqual(['Waiting on you', 'New']);
      expect(sectionRows(nav, 'waiting')).toEqual([
        { label: '3 games need your move', detail: null, kind: 'move', dot: false },
        { label: '1 challenge waiting for you', detail: null, kind: 'challenge', dot: false },
      ]);
      expect(sectionRows(nav, 'new')).toEqual([
        { label: '2 new followers', detail: null, kind: 'follower', dot: true },
        { label: 'Bob quoted you', detail: 'Scouting the center', kind: 'quote', dot: true },
      ]);
      // A zero inbox is a quiet footer link, never a "0 unread" row, and
      // Correspondence leaves the footer while it has a row of its own.
      expect(footerLinks(nav)).toEqual([['Inbox', '/inbox']]);
      expect(nav.querySelector('.notif-nav-empty')).toBeNull();
      for (const link of nav.querySelectorAll('.notif-nav-panel a')) {
        expect(link.getAttribute('role')).toBe('menuitem');
      }
    });

    it('moves unread messages into the waiting section and drops the Inbox footer link', async () => {
      const { nav } = mountWith(() => counts({ inboxUnread: 2 }));
      await refreshNotifications();

      expect(sectionTitles(nav)).toEqual(['Waiting on you']);
      expect(sectionRows(nav, 'waiting')).toEqual([
        { label: '2 unread messages', detail: null, kind: 'message', dot: false },
      ]);
      expect(footerLinks(nav)).toEqual([['Correspondence', '/correspondence']]);
    });

    it('shows the caught-up state above the footer links when nothing is pending', async () => {
      const { nav } = mountWith(() => counts());
      await refreshNotifications();

      expect(sectionTitles(nav)).toEqual([]);
      expect(nav.querySelectorAll('.notif-nav-item')).toHaveLength(0);
      const empty = nav.querySelector('.notif-nav-empty');
      expect(empty?.textContent).toBe("You're all caught up");
      expect(empty?.nextElementSibling?.classList.contains('notif-nav-footer')).toBe(true);
      expect(footerLinks(nav)).toEqual([
        ['Correspondence', '/correspondence'],
        ['Inbox', '/inbox'],
      ]);
    });

    it('keeps a new row and its dot for the open that sees it, then drops it on the next open', async () => {
      let seen = false;
      const { nav, open, seenPosts } = mountWith(() =>
        seen
          ? counts({ correspondenceYourMove: 1 })
          : counts({ correspondenceYourMove: 1, newFollowers: 1 }),
      );
      await refreshNotifications();
      const badge = nav.querySelector<HTMLElement>('.notif-nav-badge');
      expect(badge?.textContent).toBe('2');

      seen = true;
      open();
      await vi.waitFor(() => expect(badge?.textContent).toBe('1'));
      expect(seenPosts).toContainEqual({ kind: 'followers' });
      // Frozen while open: the follower row and its dot stay put.
      expect(sectionRows(nav, 'new')).toEqual([
        { label: '1 new follower', detail: null, kind: 'follower', dot: true },
      ]);

      open(); // close
      open(); // and open again
      expect(sectionTitles(nav)).toEqual(['Waiting on you']);
      expect(nav.querySelectorAll('.notif-nav-dot')).toHaveLength(0);
    });

    it('clamps a long forum title to its own muted line under the action', async () => {
      const title = 'Banqi chain capture (連吃) and blind capture (暗吃): worth adding?';
      const { nav } = mountWith(() =>
        counts({ forumTopics: 1, forumWatched: [watchedRow({ title, unread: 2 })] }),
      );
      await refreshNotifications();

      const row = nav.querySelector('.notif-nav-item[data-kind="reply"]');
      expect(row?.querySelector('.notif-nav-label')?.textContent).toBe('2 new replies');
      expect(row?.querySelector('.notif-nav-detail')?.textContent).toBe(title);
    });

    it('gives a custom source without a kind the generic icon and the section its markSeen implies', async () => {
      registerNotificationSource({
        read: () => ({ count: 1, entries: [{ label: 'Live thing', href: '/a' }] }),
      });
      registerNotificationSource({
        read: () => ({ count: 1, entries: [{ label: 'Told once', href: '/b' }] }),
        markSeen: async () => {},
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(NO_COUNTS), { status: 200 })),
      );
      const nav = document.createElement('nav');
      nav.innerHTML = '<div class="site-nav-utilities"><div data-account-nav></div></div>';
      document.body.append(nav);
      mountNotificationBell(nav);
      await refreshNotifications();

      expect(sectionRows(nav, 'waiting')).toEqual([
        { label: 'Live thing', detail: null, kind: undefined, dot: false },
      ]);
      expect(sectionRows(nav, 'new')).toEqual([
        { label: 'Told once', detail: null, kind: undefined, dot: true },
      ]);
      expect(nav.querySelector('.notif-nav-item .notif-nav-icon svg')).not.toBeNull();
    });
  });

  // Watermarked feeds clear on open; live state must not, or the badge would
  // stop reporting work that is still outstanding.
  it('marks only the watermarked sources as seen', () => {
    expect(followersNotificationSource.markSeen).toBeTypeOf('function');
    expect(forumNotificationSource.markSeen).toBeTypeOf('function');
    expect(challengesNotificationSource.markSeen).toBeUndefined();
    expect(inboxNotificationSource.markSeen).toBeUndefined();
    expect(correspondenceNotificationSource.markSeen).toBeUndefined();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
