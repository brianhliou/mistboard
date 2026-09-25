// Homepage event banners (PlayStrategy / lishogi lobby-spotlight grammar): rare,
// timely announcements — a tournament, a broadcast, a stream — rendered as big
// tappable rows under the activity stats in the play column (moved there from
// the top of the narrow left rail on 2026-09-20, where every tour name
// truncated). This is deliberately NOT the News
// feed (dated release/update rows, /feed): a banner is an event with a start or
// end moment, and the slot is empty almost all of the time.
//
// Since 2026-09-20 the broadcast rows come from the server: /api/xiangqi/broadcasts
// lists every tour, and a tour that is live, in progress, about to start, or
// finished within the last week gets a row (broadcastBanners). Before that the
// only mechanism was the hand-edited EVENT_BANNERS list below, edited, shipped
// and reverted per event, and the site's first real broadcast (the 2026 甲级联赛,
// Hangzhou, Sep 14-18, 174 boards) came and went without a banner because
// nobody made that edit. EVENT_BANNERS stays for events the API does not know
// (a stream, an arena).
import './landing-event-banners.css';
import type { Locale } from './i18n/locale.js';
import { buildUiIcon, type UiIconName } from './ui-icon.js';

export type EventBanner = {
  id: string;
  // 'tournament' | 'broadcast' pick the icon; keep kinds coarse.
  kind: 'tournament' | 'broadcast';
  title: string;
  // One meta line under the title ("17 players · playing right now",
  // "starts Aug 31, 7:00 AM"). Plain text, composed by the editor.
  subtitle: string;
  href: string;
};

// Hand-published banners for events the broadcast API does not know. Empty =
// nothing extra. Keep the whole slot to at most 2-3 rows; it is a spotlight,
// not a feed.
const EVENT_BANNERS: EventBanner[] = [];

// Dev-only samples so the slot is visible while working on the homepage layout
// on a pair with no tours seeded.
const DEV_SAMPLE_BANNERS: EventBanner[] = [
  {
    id: 'dev-sample-arena',
    kind: 'tournament',
    title: 'Fog Chess Weekly Arena',
    subtitle: '17 players · playing right now',
    href: '/watch',
  },
  {
    id: 'dev-sample-broadcast',
    kind: 'broadcast',
    title: 'Xiangqi Masters broadcast',
    subtitle: 'Round 2 · live commentary',
    href: '/watch',
  },
];

// The slice of /api/xiangqi/broadcasts a banner needs (the index route in
// apps/server/src/routes/xiangqi-broadcast; the ops page reads the same shape).
export type BroadcastTourSummary = {
  tour: {
    slug: string;
    name: string;
    nameEn?: string;
    startsAt?: string;
    endsAt?: string;
  };
  boardCount: number;
  liveBoardCount: number;
  completeBoardCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// A finished tour keeps its row for a week: long enough that a visitor who
// heard about the event finds the games, short enough that the slot is empty
// again before the next one.
const FINISHED_WINDOW_MS = 7 * DAY_MS;
// An upcoming tour appears two weeks out.
const UPCOMING_WINDOW_MS = 14 * DAY_MS;

// The slot has room for two rows; the rest are one link away.
export const MAX_BROADCAST_BANNERS = 2;

type Words = {
  live: string;
  games: string;
  starts: string;
  finished: string;
  inProgress: string;
  sections: string;
  more: (n: number) => string;
};

const WORDS: Record<Locale, Words> = {
  en: {
    live: 'Live now',
    games: 'games',
    starts: 'Starts',
    finished: 'Finished',
    inProgress: 'In progress',
    sections: 'men and women',
    more: (n) => `${n} more ${n === 1 ? 'broadcast' : 'broadcasts'}`,
  },
  'zh-Hans': {
    live: '直播中',
    games: '局',
    starts: '开始',
    finished: '已结束',
    inProgress: '进行中',
    sections: '男子组、女子组',
    more: (n) => `还有 ${n} 场转播`,
  },
  'zh-Hant': {
    live: '直播中',
    games: '局',
    starts: '開始',
    finished: '已結束',
    inProgress: '進行中',
    sections: '男子組、女子組',
    more: (n) => `還有 ${n} 場轉播`,
  },
};

function games(n: number, locale: Locale): string {
  const word = WORDS[locale].games;
  return locale === 'en' && n === 1 ? `${n} game` : `${n} ${word}`;
}

/** The day as the event itself states it: an ISO time with an offset
 *  ("2026-10-02T00:00:00+08:00") is that date, wherever the visitor is. In a
 *  US browser the plain conversion read the Asian championship's Oct 2 start
 *  as Oct 1. */
export function shortDate(iso: string, locale: Locale): string {
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  const at = Date.parse(iso);
  if (!offset || Number.isNaN(at)) {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
      new Date(iso),
    );
  }
  const sign = offset[1] === '-' ? -1 : 1;
  const shift = sign * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at + shift));
}

function tourTitle(tour: BroadcastTourSummary['tour'], locale: Locale): string {
  return locale === 'en' ? tour.nameEn || tour.name : tour.name;
}

// An event's men's and women's sections are two tours on dpxq ("…个人锦标赛
// 男子组", "… 女子组"); on a two-row spotlight they are one event.
const SECTION_SUFFIX_ZH = /\s*(男子组|女子组|男子組|女子組)$/;
const SECTION_SUFFIX_EN = /,?\s+(Men|Women)$/;

type RankedBanner = EventBanner & { rank: number; order: number };

/** Banner rows for the tours worth a spotlight right now, most pressing first:
 *  live (most live games first), between rounds, starting soonest, finished
 *  most recently. An event's two sections share one row. Pure: the caller
 *  fetches and caps; tests feed it payloads and a clock. */
export function broadcastBanners(
  tours: readonly BroadcastTourSummary[],
  locale: Locale,
  now: number = Date.now(),
): EventBanner[] {
  const words = WORDS[locale];
  const groups = new Map<string, BroadcastTourSummary[]>();
  for (const entry of tours) {
    const key = entry.tour.name.replace(SECTION_SUFFIX_ZH, '');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const rows: RankedBanner[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const sum = (pick: (entry: BroadcastTourSummary) => number) =>
      group.reduce((total, entry) => total + pick(entry), 0);
    const merged: BroadcastTourSummary = {
      tour: first.tour,
      boardCount: sum((entry) => entry.boardCount),
      liveBoardCount: sum((entry) => entry.liveBoardCount),
      completeBoardCount: sum((entry) => entry.completeBoardCount),
    };
    const state = bannerState(merged, words, locale, now);
    if (!state) continue;
    const both = group.length > 1;
    const title = both
      ? locale === 'en'
        ? (first.tour.nameEn ?? first.tour.name).replace(SECTION_SUFFIX_EN, '')
        : key
      : tourTitle(first.tour, locale);
    // Two sections open on the men's page, the one dpxq lists first; its rail
    // and the index reach the other.
    const lead = group.find((entry) => /男子/.test(entry.tour.name)) ?? first;
    rows.push({
      id: `broadcast-${lead.tour.slug}`,
      kind: 'broadcast',
      title,
      subtitle: both ? `${state.subtitle} · ${words.sections}` : state.subtitle,
      href: `/broadcast/xiangqi/${encodeURIComponent(lead.tour.slug)}`,
      rank: state.rank,
      order: state.order,
    });
  }
  return rows
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ rank: _rank, order: _order, ...banner }) => banner);
}

/** Why a tour is on the spotlight now, and where it ranks, or null. */
function bannerState(
  entry: BroadcastTourSummary,
  words: Words,
  locale: Locale,
  now: number,
): { subtitle: string; rank: number; order: number } | null {
  const { tour } = entry;
  const startsAt = tour.startsAt ? Date.parse(tour.startsAt) : Number.NaN;
  const endsAt = tour.endsAt ? Date.parse(tour.endsAt) : Number.NaN;
  if (entry.liveBoardCount > 0) {
    return {
      subtitle: `${words.live} · ${games(entry.liveBoardCount, locale)}`,
      rank: 0,
      order: -entry.liveBoardCount,
    };
  }
  if (!Number.isNaN(startsAt) && startsAt > now) {
    if (startsAt - now > UPCOMING_WINDOW_MS) return null;
    return {
      subtitle: `${words.starts} ${shortDate(tour.startsAt!, locale)}`,
      rank: 2,
      order: startsAt,
    };
  }
  if (!Number.isNaN(endsAt) && endsAt < now) {
    if (now - endsAt > FINISHED_WINDOW_MS || entry.completeBoardCount === 0) return null;
    return {
      subtitle: `${words.finished} ${shortDate(tour.endsAt!, locale)} · ${games(entry.completeBoardCount, locale)}`,
      rank: 3,
      order: -endsAt,
    };
  }
  if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt) && entry.completeBoardCount > 0) {
    // Between rounds of a tour that is under way by its dates. A tour with no
    // dates and nothing live is a record, not an event (the Team
    // Championship's 14 boards showed as a second row on 2026-09-20).
    return {
      subtitle: `${words.inProgress} · ${games(entry.completeBoardCount, locale)}`,
      rank: 1,
      order: -startsAt,
    };
  }
  return null;
}

/** Fetch the tours and append their rows to a mounted container. Failures
 *  leave the slot as it was: a missing banner is never an error on the home page. */
export async function loadBroadcastBanners(host: HTMLElement, locale: Locale): Promise<void> {
  try {
    const resp = await fetch('/api/xiangqi/broadcasts');
    if (!resp.ok) return;
    const data = (await resp.json()) as { tours?: BroadcastTourSummary[] };
    const rows = broadcastBanners(data.tours ?? [], locale);
    const shown = rows.slice(0, MAX_BROADCAST_BANNERS);
    for (const banner of shown) host.append(eventBannerRow(banner));
    if (rows.length > shown.length) {
      // lichess's "more broadcasts" under its featured ones.
      const more = document.createElement('a');
      more.className = 'landing-event-banners-more';
      more.href = '/broadcast/xiangqi';
      more.textContent = WORDS[locale].more(rows.length - shown.length);
      host.append(more);
    }
    if (rows.length > 0) {
      for (const sample of host.querySelectorAll('[data-event-id^="dev-sample-"]')) sample.remove();
    }
  } catch {
    // Offline or a dev pair without the route: the slot stays empty.
  }
}

const BANNER_ICON: Record<EventBanner['kind'], UiIconName> = {
  tournament: 'event-tournament',
  broadcast: 'event-broadcast',
};

export function eventBanners(): EventBanner[] {
  if (EVENT_BANNERS.length === 0 && import.meta.env.DEV) return DEV_SAMPLE_BANNERS;
  return EVENT_BANNERS;
}

// The container always mounts (so the layout slot exists for tests and the
// prerendered shell); CSS hides it via :empty when there are no banners.
export function buildLandingEventBanners(banners: EventBanner[] = eventBanners()): HTMLElement {
  const list = document.createElement('nav');
  list.className = 'landing-event-banners';
  list.setAttribute('aria-label', 'Events');
  for (const banner of banners) {
    list.append(eventBannerRow(banner));
  }
  return list;
}

function eventBannerRow(banner: EventBanner): HTMLElement {
  const row = document.createElement('a');
  row.className = `landing-event-banner landing-event-banner-${banner.kind}`;
  row.href = banner.href;
  row.dataset.eventId = banner.id;

  const icon = document.createElement('span');
  icon.className = 'landing-event-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(buildUiIcon(BANNER_ICON[banner.kind]));

  const text = document.createElement('span');
  text.className = 'landing-event-banner-text';
  const title = document.createElement('span');
  title.className = 'landing-event-banner-title';
  title.textContent = banner.title;
  const subtitle = document.createElement('span');
  subtitle.className = 'landing-event-banner-subtitle';
  subtitle.textContent = banner.subtitle;
  text.append(title, subtitle);

  row.append(icon, text);
  return row;
}
