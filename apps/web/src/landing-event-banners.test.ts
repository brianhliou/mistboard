import { describe, expect, it } from 'vitest';
import {
  type BroadcastTourSummary,
  broadcastBanners,
  buildLandingEventBanners,
  type EventBanner,
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

  it('uses the Chinese name and words in the Chinese locales', () => {
    const rows = broadcastBanners([{ ...LEAGUE, liveBoardCount: 3 }], 'zh-Hant', endsAt - day);
    expect(rows[0]?.title).toBe('2026年全国象棋男子甲级联赛');
    expect(rows[0]?.subtitle).toBe('直播中 · 3 局');
  });
});
