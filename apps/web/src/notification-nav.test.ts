import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAccountPreference } from './account-preferences.js';
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
      Array.from(nav.querySelectorAll('.notif-nav-item'), (row) => row.textContent);
    expect(badge?.textContent).toBe('1');
    expect(rows()).toEqual(['1 new reply in Scouting the center']);

    trigger?.click();
    await vi.waitFor(() => expect(badge?.hidden).toBe(true));
    expect(rows()).toEqual(['1 new reply in Scouting the center']);

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

  it('counts new followers without naming them', () => {
    const snapshot = followersNotificationSource.read(counts({ newFollowers: 3 }));
    expect(snapshot.count).toBe(3);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.label).toBe('3 new followers');
    // 069_user_relations keeps the follow edge private to the actor: there is
    // no followers surface, so the row must not pretend to link to one.
    expect(snapshot.entries[0]?.href).toBe('/following');
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
    expect(snapshot.entries.map((entry) => entry.label)).toEqual([
      '40 new replies in Scouting the center',
      '1 new reply in Endgame practice',
      '5 more topics with new replies',
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
    expect(snapshot.entries[0]?.label).toBe('Bob quoted you in Scouting the center');
    expect(snapshot.entries[0]?.href).toBe('/forum/redirect/post/post_quoting');
    // A quoter whose account is gone still produces a usable row.
    expect(
      forumNotificationSource.read(
        counts({
          forumTopics: 1,
          forumWatched: [watchedRow({ quote: { postId: 'post_quoting', by: null } })],
        }),
      ).entries[0]?.label,
    ).toBe('Someone quoted you in Scouting the center');
  });

  it('singularizes the follower, reply and challenge rows', () => {
    expect(followersNotificationSource.read(counts({ newFollowers: 1 })).entries[0]?.label).toBe(
      '1 new follower',
    );
    expect(
      forumNotificationSource.read(
        counts({ forumTopics: 1, forumWatched: [watchedRow({ unread: 1 })] }),
      ).entries[0]?.label,
    ).toBe('1 new reply in Scouting the center');
    expect(
      challengesNotificationSource.read(counts({ incomingChallenges: 1 })).entries[0]?.label,
    ).toBe('1 challenge waiting for you');
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
        label:
          'Your open Xiangqi correspondence game expired after 14 days with no taker. Post it again',
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
