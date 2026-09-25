import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BroadcastTourSummary,
  broadcastBanners,
  buildLandingEventBanners,
  type EventBanner,
  loadBroadcastBanners,
  shortDate,
} from './landing-event-banners.js';

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
  completeBoardCount: 174,
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
      completeBoardCount: 14,
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
    completeBoardCount: 0,
  });
  const beforeAsian = Date.parse('2026-09-25T12:00:00Z');

  afterEach(() => vi.unstubAllGlobals());

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
      completeBoardCount: 0,
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
