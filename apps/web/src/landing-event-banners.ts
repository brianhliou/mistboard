// Homepage event banners (PlayStrategy / lishogi lobby-spotlight grammar): rare,
// timely announcements — a tournament, a broadcast, a stream — rendered as big
// tappable rows at the top of the left rail. This is deliberately NOT the News
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

const WORDS: Record<Locale, { live: string; games: string; starts: string; finished: string }> = {
  en: { live: 'Live now', games: 'games', starts: 'Starts', finished: 'Finished' },
  'zh-Hans': { live: '直播中', games: '局', starts: '开始', finished: '已结束' },
  'zh-Hant': { live: '直播中', games: '局', starts: '開始', finished: '已結束' },
};

function shortDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

function tourTitle(tour: BroadcastTourSummary['tour'], locale: Locale): string {
  return locale === 'en' ? tour.nameEn || tour.name : tour.name;
}

/** Banner rows for the tours worth a spotlight right now, or none. Pure: the
 *  caller fetches; tests feed it payloads and a clock. */
export function broadcastBanners(
  tours: readonly BroadcastTourSummary[],
  locale: Locale,
  now: number = Date.now(),
): EventBanner[] {
  const words = WORDS[locale];
  const rows: EventBanner[] = [];
  for (const entry of tours) {
    const { tour } = entry;
    const startsAt = tour.startsAt ? Date.parse(tour.startsAt) : Number.NaN;
    const endsAt = tour.endsAt ? Date.parse(tour.endsAt) : Number.NaN;
    let subtitle: string | null = null;
    if (entry.liveBoardCount > 0) {
      subtitle = `${words.live} · ${entry.liveBoardCount} ${words.games}`;
    } else if (!Number.isNaN(startsAt) && startsAt > now) {
      if (startsAt - now <= UPCOMING_WINDOW_MS) {
        subtitle = `${words.starts} ${shortDate(tour.startsAt!, locale)}`;
      }
    } else if (!Number.isNaN(endsAt) && endsAt < now) {
      if (now - endsAt <= FINISHED_WINDOW_MS && entry.completeBoardCount > 0) {
        subtitle = `${words.finished} ${shortDate(tour.endsAt!, locale)} · ${entry.completeBoardCount} ${words.games}`;
      }
    } else if (entry.completeBoardCount > 0) {
      // Between rounds of a tour that is under way by its dates.
      subtitle = `${entry.completeBoardCount} ${words.games}`;
    }
    if (subtitle === null) continue;
    rows.push({
      id: `broadcast-${tour.slug}`,
      kind: 'broadcast',
      title: tourTitle(tour, locale),
      subtitle,
      href: `/broadcast/xiangqi/${encodeURIComponent(tour.slug)}`,
    });
  }
  return rows;
}

/** Fetch the tours and append their rows to a mounted container. Failures
 *  leave the slot as it was: a missing banner is never an error on the home page. */
export async function loadBroadcastBanners(host: HTMLElement, locale: Locale): Promise<void> {
  try {
    const resp = await fetch('/api/xiangqi/broadcasts');
    if (!resp.ok) return;
    const data = (await resp.json()) as { tours?: BroadcastTourSummary[] };
    const rows = broadcastBanners(data.tours ?? [], locale);
    for (const banner of rows) host.append(eventBannerRow(banner));
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
