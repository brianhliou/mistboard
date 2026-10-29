import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROADCAST_SLOT_PENDING_CLASS,
  type BroadcastTourSummary,
  broadcastBanners,
  broadcastSlot,
  buildLandingEventBanners,
  cardLines,
  type EventBanner,
  loadBroadcastBanners,
  shortDate,
} from './landing-event-banners.js';

// happy-dom provides no localStorage here; the smallest stand-in (the same
// shim as room-chrome.test.ts) holds the slot's cached index.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

const BANNERS: EventBanner[] = [
  {
    id: 'arena-1',
    kind: 'tournament',
    title: 'Fog Chess Weekly Arena',
    subtitle: '17 players · playing right now',
    href: '/watch',
  },
  {
    id: 'cast-1',
    kind: 'broadcast',
    title: 'Xiangqi Masters broadcast',
    subtitle: 'Round 2 · live commentary',
    href: '/watch',
  },
];

describe('landing event banners', () => {
  it('renders one linked row per banner with title, meta line, and kind icon', () => {
    const el = buildLandingEventBanners(BANNERS);

    const rows = el.querySelectorAll<HTMLAnchorElement>('a.landing-event-banner');
    expect(rows.length).toBe(2);
    expect(rows[0]?.classList.contains('landing-event-banner-tournament')).toBe(true);
    expect(rows[0]?.getAttribute('href')).toBe('/watch');
    expect(rows[0]?.querySelector('.landing-event-banner-title')?.textContent).toBe(
      'Fog Chess Weekly Arena',
    );
    expect(rows[0]?.querySelector('.landing-event-banner-subtitle')?.textContent).toBe(
      '17 players · playing right now',
    );
    expect(rows[0]?.querySelector('.landing-event-banner-icon svg')).not.toBeNull();
    expect(rows[1]?.classList.contains('landing-event-banner-broadcast')).toBe(true);
  });

  it('gives the broadcast card its TV art, one render per theme, in place of the glyph', () => {
    const el = buildLandingEventBanners(BANNERS);
    const [tournament, broadcast] =
      el.querySelectorAll<HTMLAnchorElement>('a.landing-event-banner');

    const slot = broadcast?.querySelector('.landing-event-banner-icon');
    expect(slot?.classList.contains('landing-event-banner-icon-art')).toBe(true);
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(slot?.querySelector('svg')).toBeNull();

    const art = [...(slot?.querySelectorAll<HTMLImageElement>('img') ?? [])];
    expect(art.map((img) => img.className)).toEqual([
      'landing-event-banner-art landing-event-banner-art-light',
      'landing-event-banner-art landing-event-banner-art-dark',
    ]);
    expect(art.map((img) => img.getAttribute('src'))).toEqual([
      '/icons/broadcast-tv.webp',
      '/icons/broadcast-tv-halo.webp',
    ]);
    expect(art[1]?.getAttribute('srcset')).toBe(
      '/icons/broadcast-tv-halo.webp 1x, /icons/broadcast-tv-halo@2x.webp 2x, /icons/broadcast-tv-halo@3x.webp 3x',
    );
    for (const img of art) {
      // Decorative: the card's text names the event.
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('width')).toBe('44');
      expect(img.getAttribute('height')).toBe('44');
    }

    // The tournament card keeps its glyph.
    expect(tournament?.querySelector('.landing-event-banner-icon img')).toBeNull();
    expect(tournament?.querySelector('.landing-event-banner-icon svg')).not.toBeNull();
  });

  it('ships every file the broadcast art srcset names', () => {
    const el = buildLandingEventBanners(BANNERS);
    const files = [...el.querySelectorAll<HTMLImageElement>('.landing-event-banner-art')].flatMap(
      (img) =>
        (img.getAttribute('srcset') ?? '').split(',').map((part) => part.trim().split(' ')[0]!),
    );
    expect(files).toHaveLength(6);
    for (const file of files) {
      expect(existsSync(`public${file}`), file).toBe(true);
    }
  });

  it('mounts an empty container when no event is on (CSS collapses it via :empty)', () => {
    const el = buildLandingEventBanners([]);

    expect(el.classList.contains('landing-event-banners')).toBe(true);
    expect(el.childElementCount).toBe(0);
  });
});

// The 2026 甲级联赛 as /api/xiangqi/broadcasts listed it on 2026-09-20: the
// event the homepage missed because banners were hand-published.
const LEAGUE: BroadcastTourSummary = {
  tour: {
    slug: '2026-xiangqi-league',
    name: '2026年全国象棋男子甲级联赛',
    nameEn: '2026 National Xiangqi Men Division A League',
    startsAt: '2026-09-14T00:00:00+08:00',
    endsAt: '2026-09-18T23:59:59+08:00',
  },
  boardCount: 174,
  liveBoardCount: 0,
  recordedBoardCount: 174,
};

describe('broadcastBanners', () => {
  const day = 24 * 60 * 60 * 1000;
  const endsAt = Date.parse(LEAGUE.tour.endsAt!);

  it('keeps a finished tour on the homepage for a week, with its game count', () => {
    const rows = broadcastBanners([LEAGUE], 'en', endsAt + 2 * day);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'broadcast-2026-xiangqi-league',
      kind: 'broadcast',
      title: '2026 National Xiangqi Men Division A League',
      href: '/broadcast/xiangqi/2026-xiangqi-league',
    });
    expect(rows[0]?.subtitle).toMatch(/^Finished Sep 1[89] · 174 games$/);
  });

  it('gives a tour no row when its results came without moves', () => {
    // The 2026 women's league: six results on the source, no game records.
    const resultsOnly = { ...LEAGUE, recordedBoardCount: 0 };
    expect(broadcastBanners([resultsOnly], 'en', endsAt + 2 * day)).toEqual([]);
    const startsAt = Date.parse(LEAGUE.tour.startsAt!);
    expect(broadcastBanners([resultsOnly], 'en', startsAt + day)).toEqual([]);
  });

  it('drops a tour a week after it ended', () => {
    expect(broadcastBanners([LEAGUE], 'en', endsAt + 8 * day)).toEqual([]);
  });

  it('says live with the board count while boards are live', () => {
    const live = { ...LEAGUE, liveBoardCount: 12 };
    const rows = broadcastBanners([live], 'en', endsAt - 2 * day);
    expect(rows[0]?.subtitle).toBe('Live now · 12 games');
  });

  it('announces a tour that starts within two weeks, and not one further out', () => {
    const startsAt = Date.parse(LEAGUE.tour.startsAt!);
    expect(broadcastBanners([LEAGUE], 'en', startsAt - 3 * day)[0]?.subtitle).toMatch(
      /^Starts Sep 1[34]$/,
    );
    expect(broadcastBanners([LEAGUE], 'en', startsAt - 20 * day)).toEqual([]);
  });

  it('gives an undated tour no row unless it is live: a record is not an event', () => {
    const undated: BroadcastTourSummary = {
      tour: {
        slug: '2026-ewwox2',
        name: '2026年全国象棋团体锦标赛',
        nameEn: '2026 National Xiangqi Team Championship',
      },
      boardCount: 14,
      liveBoardCount: 0,
      recordedBoardCount: 14,
    };
    expect(broadcastBanners([undated], 'en', endsAt)).toEqual([]);
    expect(broadcastBanners([{ ...undated, liveBoardCount: 2 }], 'en', endsAt)[0]?.subtitle).toBe(
      'Live now · 2 games',
    );
  });

  it('says in progress between rounds of a dated tour', () => {
    const rows = broadcastBanners([LEAGUE], 'en', Date.parse(LEAGUE.tour.startsAt!) + day);
    expect(rows[0]?.subtitle).toBe('In progress · 174 games');
  });

  it('says one game, not one games', () => {
    const rows = broadcastBanners([{ ...LEAGUE, liveBoardCount: 1 }], 'en', endsAt - day);
    expect(rows[0]?.subtitle).toBe('Live now · 1 game');
  });

  it('uses the Chinese name and words in the Chinese locales', () => {
    const rows = broadcastBanners([{ ...LEAGUE, liveBoardCount: 3 }], 'zh-Hant', endsAt - day);
    expect(rows[0]?.title).toBe('2026年全国象棋男子甲级联赛');
    expect(rows[0]?.subtitle).toBe('直播中 · 3 局');
  });
});

describe('the two-row spotlight', () => {
  const day = 24 * 60 * 60 * 1000;
  const asian = (section: '男子组' | '女子组', en: 'Men' | 'Women'): BroadcastTourSummary => ({
    tour: {
      slug: `2026-asian-individual-${en.toLowerCase()}`,
      name: `2026年第21届亚洲象棋个人锦标赛 ${section}`,
      nameEn: `2026 21st Asian Xiangqi Individual Championship ${en}`,
      startsAt: '2026-10-02T00:00:00+08:00',
      endsAt: '2026-10-08T23:59:59+08:00',
    },
    boardCount: 0,
    liveBoardCount: 0,
    recordedBoardCount: 0,
  });
  const beforeAsian = Date.parse('2026-09-25T12:00:00Z');

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.removeItem('mistboard:home-broadcasts:v1');
  });

  it("dates an event by its own day, not the visitor's", () => {
    // Midnight Oct 2 in Manila is still Oct 1 in any US timezone.
    expect(shortDate('2026-10-02T00:00:00+08:00', 'en')).toBe('Oct 2');
    expect(shortDate('2026-10-08T23:59:59+08:00', 'en')).toBe('Oct 8');
  });

  it("gives an event's men's and women's sections one row, on the men's page", () => {
    const rows = broadcastBanners(
      [asian('女子组', 'Women'), asian('男子组', 'Men')],
      'en',
      beforeAsian,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('2026 21st Asian Xiangqi Individual Championship');
    expect(rows[0]?.subtitle).toBe('Starts Oct 2 · men and women');
    expect(rows[0]?.href).toBe('/broadcast/xiangqi/2026-asian-individual-men');
    const zh = broadcastBanners(
      [asian('女子组', 'Women'), asian('男子组', 'Men')],
      'zh-Hans',
      beforeAsian,
    );
    expect(zh[0]?.title).toBe('2026年第21届亚洲象棋个人锦标赛');
  });

  it('ranks live first, then between rounds, then soonest to start, then latest finished', () => {
    const at = Date.parse('2026-09-16T12:00:00Z');
    const live = {
      ...LEAGUE,
      tour: { ...LEAGUE.tour, slug: 'live', name: '直播' },
      liveBoardCount: 4,
    };
    const running = { ...LEAGUE, tour: { ...LEAGUE.tour, slug: 'running', name: '进行' } };
    const soon = {
      ...LEAGUE,
      recordedBoardCount: 0,
      tour: {
        ...LEAGUE.tour,
        slug: 'soon',
        name: '将开',
        startsAt: new Date(at + 3 * day).toISOString(),
      },
    };
    const done = {
      ...LEAGUE,
      tour: {
        ...LEAGUE.tour,
        slug: 'done',
        name: '已完',
        endsAt: new Date(at - 2 * day).toISOString(),
      },
    };
    const rows = broadcastBanners([done, soon, running, live], 'zh-Hans', at);
    expect(rows.map((row) => row.id)).toEqual([
      'broadcast-live',
      'broadcast-running',
      'broadcast-soon',
      'broadcast-done',
    ]);
  });

  it('shows two rows and links the rest', async () => {
    const at = Date.parse('2026-09-16T12:00:00Z');
    const tour = (slug: string, live: number): BroadcastTourSummary => ({
      ...LEAGUE,
      tour: { ...LEAGUE.tour, slug, name: slug },
      liveBoardCount: live,
    });
    vi.useFakeTimers({ now: at, toFake: ['Date'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tours: [tour('a', 1), tour('b', 5), tour('c', 3), tour('d', 2)] }),
      })),
    );
    const host = document.createElement('nav');
    await loadBroadcastBanners(host, 'en');
    vi.useRealTimers();
    expect(
      [...host.querySelectorAll('.landing-event-banner')].map((row) =>
        row.getAttribute('data-event-id'),
      ),
    ).toEqual(['broadcast-b', 'broadcast-c']);
    const more = host.querySelector<HTMLAnchorElement>('.landing-event-banners-more');
    expect(more?.textContent).toBe('2 more broadcasts');
    expect(more?.getAttribute('href')).toBe('/broadcast/xiangqi');
  });
});

describe('the broadcast slot', () => {
  const day = 24 * 60 * 60 * 1000;
  const at = Date.parse('2026-10-27T12:00:00Z');
  const tour = (
    slug: string,
    extra: Partial<BroadcastTourSummary> & { startsAt?: string; endsAt?: string } = {},
  ): BroadcastTourSummary => ({
    tour: {
      slug,
      name: slug,
      nameEn: `2026 ${slug}`,
      startsAt: extra.startsAt ?? new Date(at - 10 * day).toISOString(),
      endsAt: extra.endsAt ?? new Date(at + 4 * day).toISOString(),
    },
    boardCount: extra.boardCount ?? 40,
    liveBoardCount: extra.liveBoardCount ?? 0,
    recordedBoardCount: extra.recordedBoardCount ?? 40,
  });
  const rapid = tour('World Rapid Championship', {
    startsAt: '2026-11-10T00:00:00+08:00',
    endsAt: '2026-11-15T23:59:59+08:00',
    boardCount: 0,
    recordedBoardCount: 0,
  });
  const stubIndex = (tours: BroadcastTourSummary[]) => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ tours }) }));
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.removeItem('mistboard:home-broadcasts:v1');
  });

  // A card for an event with no games led to an empty intro page (Brian,
  // 2026-10-27: "4th World Rapid Championship · Starts Nov 10").
  it('announces an event with no games yet as a plain line, not a card or a link', async () => {
    vi.useFakeTimers({ now: at, toFake: ['Date'] });
    stubIndex([rapid, tour('League', { liveBoardCount: 3 })]);
    const host = buildLandingEventBanners([]);
    await loadBroadcastBanners(host, 'en');
    const cards = [...host.querySelectorAll<HTMLAnchorElement>('a.landing-event-banner')];
    expect(cards.map((card) => card.dataset.eventId)).toEqual(['broadcast-League']);
    const line = host.querySelector<HTMLElement>('.landing-event-upcoming-line');
    expect(line?.textContent).toBe('World Rapid Championship · Starts Nov 10');
    expect(line?.closest('a')).toBeNull();
    expect(line?.querySelector('a')).toBeNull();
    expect(line?.hasAttribute('href')).toBe(false);
    expect(
      host.querySelector(
        '[data-event-id="broadcast-World Rapid Championship"].landing-event-banner',
      ),
    ).toBeNull();
    // The lines come after the cards, and are not counted as "more".
    expect(host.lastElementChild?.className).toBe('landing-event-upcoming');
  });

  it('keeps the card for an event that is on, and caps the lines at two', () => {
    const rows = broadcastBanners(
      [
        rapid,
        { ...rapid, tour: { ...rapid.tour, slug: 'b', name: 'b', nameEn: 'b' } },
        { ...rapid, tour: { ...rapid.tour, slug: 'c', name: 'c', nameEn: 'c' } },
        tour('League', { liveBoardCount: 3 }),
      ],
      'en',
      at,
    );
    const slot = broadcastSlot(rows);
    expect(slot.cards.map((row) => row.id)).toEqual(['broadcast-League']);
    expect(slot.upcoming).toHaveLength(2);
    expect(slot.more).toBe(1);
  });

  it('paints the last index this browser saw before the fetch answers', async () => {
    vi.useFakeTimers({ now: at, toFake: ['Date'] });
    stubIndex([tour('League', { liveBoardCount: 3 })]);
    await loadBroadcastBanners(buildLandingEventBanners([]), 'en');
    let answer: (value: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => (answer = resolve))),
    );
    const host = buildLandingEventBanners([]);
    host.classList.add(BROADCAST_SLOT_PENDING_CLASS);
    const loading = loadBroadcastBanners(host, 'en');
    // Synchronously, before the fetch resolves.
    expect(host.querySelectorAll('.landing-event-banner')).toHaveLength(1);
    expect(host.classList.contains(BROADCAST_SLOT_PENDING_CLASS)).toBe(false);
    answer({ ok: true, json: async () => ({ tours: [tour('League'), tour('Cup')] }) });
    await loading;
    // The fresh answer replaces the cached rows, never adds to them.
    expect(host.querySelectorAll('.landing-event-banner')).toHaveLength(2);
  });
});

describe('cardLines', () => {
  it("moves a tour name's leading year to the start of the meta line", () => {
    expect(
      cardLines({
        title: "2026 National Xiangqi Men's Division A League",
        subtitle: 'In progress · 174 games',
      }),
    ).toEqual({
      title: "National Xiangqi Men's Division A League",
      meta: '2026 · In progress · 174 games',
    });
    expect(cardLines({ title: '2026年全国象棋男子甲级联赛', subtitle: '直播中 · 3 局' })).toEqual({
      title: '全国象棋男子甲级联赛',
      meta: '2026 · 直播中 · 3 局',
    });
  });

  it('leaves a name with no leading year, or nothing after it, as it is', () => {
    const arena = { title: 'Fog Chess Weekly Arena', subtitle: '17 players' };
    expect(cardLines(arena)).toEqual({ title: arena.title, meta: arena.subtitle });
    expect(cardLines({ title: '2026', subtitle: 'Live now' })).toEqual({
      title: '2026',
      meta: 'Live now',
    });
    expect(cardLines({ title: '2025-26 Season League', subtitle: 'x' }).title).toBe(
      '2025-26 Season League',
    );
  });

  it('renders the split on the card and keeps the year in the data', () => {
    const banner: EventBanner = {
      id: 'broadcast-league',
      kind: 'broadcast',
      title: '2026 4th World Rapid Championship',
      subtitle: 'Starts Nov 10',
      href: '/broadcast/xiangqi/league',
    };
    const row = buildLandingEventBanners([banner]).querySelector('a.landing-event-banner');
    expect(row?.querySelector('.landing-event-banner-title')?.textContent).toBe(
      '4th World Rapid Championship',
    );
    expect(row?.querySelector('.landing-event-banner-subtitle')?.textContent).toBe(
      '2026 · Starts Nov 10',
    );
    expect(banner.title).toBe('2026 4th World Rapid Championship');
  });
});
