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
  // A broadcast that has not started and has no games yet. Its tour page is an
  // empty intro, so it shows as a plain announcement line, never a card or a
  // link (Brian, 2026-10-27).
  upcoming?: true;
};

// Hand-published banners for events the broadcast API does not know. Empty =
// nothing extra. Keep the whole slot to at most 2-3 rows; it is a spotlight,
// not a feed.
const EVENT_BANNERS: EventBanner[] = [];

// Dev-only sample so the slot is visible while working on the homepage layout
// on a pair with no tours seeded. No arena sample: tournaments are not live yet.
const DEV_SAMPLE_BANNERS: EventBanner[] = [
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
  /** Finished games with moves. Results alone are not something to watch. */
  recordedBoardCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// A finished tour keeps its row for a week: long enough that a visitor who
// heard about the event finds the games, short enough that the slot is empty
// again before the next one.
const FINISHED_WINDOW_MS = 7 * DAY_MS;
// An upcoming tour appears two weeks out.
const UPCOMING_WINDOW_MS = 14 * DAY_MS;

// The slot has room for two cards; the rest are one link away.
export const MAX_BROADCAST_BANNERS = 2;
// Under the cards, up to two one-line announcements of events about to start.
export const MAX_UPCOMING_LINES = 2;

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

const RANK_UPCOMING = 2;

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
      recordedBoardCount: sum((entry) => entry.recordedBoardCount),
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
      ...(state.rank === RANK_UPCOMING && merged.recordedBoardCount === 0
        ? { upcoming: true as const }
        : {}),
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
      rank: RANK_UPCOMING,
      order: startsAt,
    };
  }
  if (!Number.isNaN(endsAt) && endsAt < now) {
    if (now - endsAt > FINISHED_WINDOW_MS || entry.recordedBoardCount === 0) return null;
    return {
      subtitle: `${words.finished} ${shortDate(tour.endsAt!, locale)} · ${games(entry.recordedBoardCount, locale)}`,
      rank: 3,
      order: -endsAt,
    };
  }
  if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt) && entry.recordedBoardCount > 0) {
    // Between rounds of a tour that is under way by its dates. A tour with no
    // dates and nothing live is a record, not an event (the Team
    // Championship's 14 boards showed as a second row on 2026-09-20).
    return {
      subtitle: `${words.inProgress} · ${games(entry.recordedBoardCount, locale)}`,
      rank: 1,
      order: -startsAt,
    };
  }
  return null;
}

/** What the broadcast part of the slot shows: up to two cards for events
 *  with games to watch, up to two announcement lines for events still to
 *  start, and how many rows are left for the "more" link. */
export function broadcastSlot(rows: readonly EventBanner[]): {
  cards: EventBanner[];
  upcoming: EventBanner[];
  more: number;
} {
  const cards = rows.filter((row) => !row.upcoming).slice(0, MAX_BROADCAST_BANNERS);
  const upcoming = rows.filter((row) => row.upcoming).slice(0, MAX_UPCOMING_LINES);
  return { cards, upcoming, more: rows.length - cards.length - upcoming.length };
}

// The last index this browser saw, so a repeat visit paints the cards with the
// page instead of a second later (the index read took ~850ms on prod). Rows
// are recomputed from it with the current clock and replaced when the fetch
// lands; past a few hours it is not shown at all.
const BROADCAST_CACHE_KEY = 'mistboard:home-broadcasts:v1';
const BROADCAST_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function readCachedTours(now: number): BroadcastTourSummary[] | null {
  try {
    const raw = window.localStorage.getItem(BROADCAST_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at?: unknown; tours?: unknown };
    if (typeof cached.at !== 'number' || !Array.isArray(cached.tours)) return null;
    if (now - cached.at > BROADCAST_CACHE_MAX_AGE_MS || cached.at > now) return null;
    return cached.tours as BroadcastTourSummary[];
  } catch {
    return null;
  }
}

function writeCachedTours(tours: readonly BroadcastTourSummary[], now: number): void {
  // Only what a banner reads: the full index carries players and rounds.
  const slim = tours.map(({ tour, boardCount, liveBoardCount, recordedBoardCount }) => ({
    tour: {
      slug: tour.slug,
      name: tour.name,
      nameEn: tour.nameEn,
      startsAt: tour.startsAt,
      endsAt: tour.endsAt,
    },
    boardCount,
    liveBoardCount,
    recordedBoardCount,
  }));
  try {
    window.localStorage.setItem(BROADCAST_CACHE_KEY, JSON.stringify({ at: now, tours: slim }));
  } catch {
    // Storage full or blocked: the next visit fetches, as before.
  }
}

/** Replace the slot's broadcast part (hand-published banners stay). */
function renderBroadcastSlot(host: HTMLElement, rows: readonly EventBanner[], locale: Locale) {
  for (const el of host.querySelectorAll('[data-broadcast-slot]')) el.remove();
  const { cards, upcoming, more } = broadcastSlot(rows);
  for (const banner of cards) {
    const row = eventBannerRow(banner);
    row.dataset.broadcastSlot = '';
    host.append(row);
  }
  if (upcoming.length > 0) {
    const list = document.createElement('div');
    list.className = 'landing-event-upcoming';
    list.dataset.broadcastSlot = '';
    list.append(...upcoming.map(upcomingLine));
    host.append(list);
  }
  if (more > 0) {
    // lichess's "more broadcasts" under its featured ones.
    const link = document.createElement('a');
    link.className = 'landing-event-banners-more';
    link.dataset.broadcastSlot = '';
    link.href = '/broadcast/xiangqi';
    link.textContent = WORDS[locale].more(more);
    host.append(link);
  }
  if (rows.length > 0) {
    for (const sample of host.querySelectorAll('[data-event-id^="dev-sample-"]')) sample.remove();
  }
}

/** An event still to start: its name and start date as plain text. */
function upcomingLine(banner: EventBanner): HTMLElement {
  const lines = cardLines(banner);
  const line = document.createElement('p');
  line.className = 'landing-event-upcoming-line';
  line.dataset.eventId = banner.id;
  const title = document.createElement('span');
  title.className = 'landing-event-upcoming-title';
  title.textContent = lines.title;
  // cardLines moved the year to the front of the meta; the line reads
  // "World Rapid Championship · Starts Nov 10", so the year stays out.
  line.append(title, ` · ${banner.subtitle}`);
  return line;
}

/** While the index loads, the slot keeps the room two cards and the "more"
 *  link take, so their arrival does not grow band 1 and push the viewer
 *  beside it down (it moved 57px on prod, 2026-10-27). */
export const BROADCAST_SLOT_PENDING_CLASS = 'landing-event-banners--pending';

/** Fill the slot: from this browser's last copy of the index at once when it
 *  has one, then from the API. Failures leave the slot as it was: a missing
 *  banner is never an error on the home page. */
export async function loadBroadcastBanners(host: HTMLElement, locale: Locale): Promise<void> {
  const cached = readCachedTours(Date.now());
  if (cached) {
    renderBroadcastSlot(host, broadcastBanners(cached, locale), locale);
    host.classList.remove(BROADCAST_SLOT_PENDING_CLASS);
  }
  try {
    const resp = await fetch('/api/xiangqi/broadcasts');
    if (!resp.ok) return;
    const data = (await resp.json()) as { tours?: BroadcastTourSummary[] };
    const tours = data.tours ?? [];
    writeCachedTours(tours, Date.now());
    renderBroadcastSlot(host, broadcastBanners(tours, locale), locale);
  } catch {
    // Offline or a dev pair without the route: the slot stays as it was.
  } finally {
    host.classList.remove(BROADCAST_SLOT_PENDING_CLASS);
  }
}

const BANNER_ICON: Record<EventBanner['kind'], UiIconName> = {
  tournament: 'event-tournament',
  broadcast: 'event-broadcast',
};

// The broadcast card's art: a Dobutsu-style TV showing a xiangqi board
// (2026-10-26; it replaces the RadioTower glyph on this card only). Two
// renders: plain for the light theme, and one with a cream sticker border for
// the dark theme, where the navy body and black outline sink into the panel.
// CSS shows one. Decorative: the card's text names the event.
const BROADCAST_ART = [
  { theme: 'light', stem: '/icons/broadcast-tv' },
  { theme: 'dark', stem: '/icons/broadcast-tv-halo' },
] as const;

function broadcastArt(): HTMLImageElement[] {
  return BROADCAST_ART.map(({ theme, stem }) => {
    const img = document.createElement('img');
    img.className = `landing-event-banner-art landing-event-banner-art-${theme}`;
    img.src = `${stem}.webp`;
    img.srcset = `${stem}.webp 1x, ${stem}@2x.webp 2x, ${stem}@3x.webp 3x`;
    img.alt = '';
    img.width = 44;
    img.height = 44;
    img.decoding = 'async';
    return img;
  });
}

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

// A tour name's leading year ("2026 National Xiangqi Men's Division A
// League", "2026年全国象棋甲级联赛"), and the rest of the name after it.
const LEADING_YEAR = /^(\d{4})(?:年\s*|\s+)(?=\S)/;

/** The card's two lines: a tour name's leading year moves to the start of the
 *  meta line ("National Xiangqi Men's Division A League" over "2026 · In
 *  progress · 174 games"), so the name fits one line of the card instead of
 *  wrapping to two (Brian, 2026-10-26: a shorter card, no name cut). Display
 *  only: the stored name and the banner data keep the year. */
export function cardLines(banner: Pick<EventBanner, 'title' | 'subtitle'>): {
  title: string;
  meta: string;
} {
  const year = LEADING_YEAR.exec(banner.title);
  if (!year) return { title: banner.title, meta: banner.subtitle };
  return {
    title: banner.title.slice(year[0].length),
    meta: banner.subtitle ? `${year[1]} · ${banner.subtitle}` : year[1]!,
  };
}

function eventBannerRow(banner: EventBanner): HTMLElement {
  const lines = cardLines(banner);
  const row = document.createElement('a');
  row.className = `landing-event-banner landing-event-banner-${banner.kind}`;
  row.href = banner.href;
  row.dataset.eventId = banner.id;

  const icon = document.createElement('span');
  icon.className = 'landing-event-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (banner.kind === 'broadcast') {
    icon.classList.add('landing-event-banner-icon-art');
    icon.append(...broadcastArt());
  } else {
    icon.append(buildUiIcon(BANNER_ICON[banner.kind]));
  }

  const text = document.createElement('span');
  text.className = 'landing-event-banner-text';
  const title = document.createElement('span');
  title.className = 'landing-event-banner-title';
  title.textContent = lines.title;
  const subtitle = document.createElement('span');
  subtitle.className = 'landing-event-banner-subtitle';
  subtitle.textContent = lines.meta;
  text.append(title, subtitle);

  row.append(icon, text);
  return row;
}
