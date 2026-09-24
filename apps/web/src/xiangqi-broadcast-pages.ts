// The broadcast section's own pages beside the index, lichess-style: a left
// rail (Broadcasts, Calendar, About, then Pro players and Pro teams, lichess's
// FIDE players and federations) shared by every page it lists, the
// calendar of top events, and the about page. Also the "top players" ranking
// the index cards use, from the CXA data the player pages already carry.

import './xiangqi-broadcast.css';
import { t } from './i18n/catalog.js';
import { CXA_POINTS } from './players/cxa-points.js';
import { CXA_RATINGS } from './players/cxa-ratings.js';
import { buildNav } from './site-shell.js';
import { formatEventDateRange } from './xiangqi-broadcast-time.js';

export type BroadcastRailItem = 'broadcasts' | 'calendar' | 'about' | 'players' | 'teams';

/** The section's left rail; `active` marks the page it sits on. */
export function broadcastRail(active: BroadcastRailItem): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'xqb-rail';
  nav.setAttribute('aria-label', t('broadcast.sectionNav'));
  // The people start a second group, set apart by a gap, as on lichess.
  const items: Array<{ id: BroadcastRailItem; href: string; label: string; group?: true }> = [
    { id: 'broadcasts', href: '/broadcast/xiangqi', label: t('broadcast.broadcasts') },
    { id: 'calendar', href: '/broadcast/xiangqi/calendar', label: t('broadcast.calendar') },
    { id: 'about', href: '/broadcast/xiangqi/about', label: t('broadcast.about') },
    { id: 'players', href: '/players', label: t('nav.proPlayers'), group: true },
    { id: 'teams', href: '/players/teams', label: t('nav.proTeams') },
  ];
  for (const item of items) {
    const link = document.createElement('a');
    link.className = item.id === active ? 'xqb-rail-link xqb-rail-link-active' : 'xqb-rail-link';
    if (item.group) link.classList.add('xqb-rail-link-group');
    link.href = item.href;
    link.textContent = item.label;
    if (item.id === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}

/** The rail and a centred panel, the index, calendar and about pages' frame. */
export function broadcastSectionLayout(
  active: BroadcastRailItem,
  ...content: HTMLElement[]
): HTMLElement {
  const main = document.createElement('main');
  main.className = 'xqb-shell xqb-section-page';
  const layout = document.createElement('div');
  layout.className = 'xqb-section-layout';
  const panel = document.createElement('div');
  panel.className = 'xqb-section-panel';
  panel.append(...content);
  layout.append(broadcastRail(active), panel);
  main.append(layout);
  return main;
}

export type BroadcastPlayerRef = { name: string; nameEn?: string; title?: string };

/**
 * The strongest few players of an event, for the card's "who is playing" line
 * (lichess lists the top-rated). Ranked by the latest CXA points list the
 * player is on, then by the last CXA rating, both from the data the player
 * pages carry; a player on neither list does not make the line. A 特 or 大
 * title on the rating list reads GM or NM, as on the player pages.
 */
export function topBroadcastPlayers(players: readonly BroadcastPlayerRef[], count = 3): string[] {
  const ranked = players
    .map((player) => {
      const points = CXA_POINTS[player.name];
      const pointsRank = points?.[points.length - 1]?.rank;
      const ratings = CXA_RATINGS[player.name];
      const last = ratings?.[ratings.length - 1];
      return { player, pointsRank, rating: last?.rating, title: last?.title ?? null };
    })
    .filter((entry) => entry.pointsRank !== undefined || entry.rating !== undefined)
    .sort(
      (a, b) =>
        (a.pointsRank ?? Number.POSITIVE_INFINITY) - (b.pointsRank ?? Number.POSITIVE_INFINITY) ||
        (b.rating ?? 0) - (a.rating ?? 0),
    );
  return ranked.slice(0, count).map(({ player, title }) => {
    const name = player.nameEn?.trim() || player.name;
    const shown = player.title ?? (title === '特' ? 'GM' : title === '大' ? 'NM' : null);
    return shown ? `${shown} ${name}` : name;
  });
}

export type BroadcastCalendarEvent = {
  name: string;
  nameEn?: string;
  location: string;
  startsOn: string;
  endsOn: string;
  status: 'live' | 'upcoming' | 'finished';
  tourSlug: string | null;
  sourceUrl: string | null;
};

export type BroadcastCalendarResponse = {
  sourceReadable: boolean;
  events: BroadcastCalendarEvent[];
};

export async function fetchBroadcastCalendar(): Promise<BroadcastCalendarResponse | null> {
  try {
    const response = await fetch('/api/xiangqi/broadcasts/calendar');
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<BroadcastCalendarResponse> | null;
    // The index renders without the calendar; a malformed answer must not take
    // the page down with it.
    if (!body || !Array.isArray(body.events)) return null;
    return { sourceReadable: body.sourceReadable === true, events: body.events };
  } catch {
    return null;
  }
}

/** One calendar row: dates, the event, where, and where to watch it. */
export function calendarEventRow(event: BroadcastCalendarEvent): HTMLElement {
  const row = document.createElement('li');
  row.className = `xqb-cal-row xqb-cal-row-${event.status}`;
  const when = document.createElement('span');
  when.className = 'xqb-cal-when';
  when.textContent =
    formatEventDateRange(`${event.startsOn}T12:00:00+08:00`, `${event.endsOn}T12:00:00+08:00`) ??
    event.startsOn;
  const what = document.createElement('span');
  what.className = 'xqb-cal-what';
  const name = document.createElement('strong');
  name.textContent = event.nameEn ?? event.name;
  what.append(name);
  const sub = [event.nameEn ? event.name : null, event.location || null]
    .filter(Boolean)
    .join(' · ');
  if (sub) {
    const line = document.createElement('span');
    line.className = 'xqb-cal-sub';
    line.textContent = sub;
    what.append(line);
  }
  const status = document.createElement('span');
  status.className = `xqb-cal-status xqb-cal-status-${event.status}`;
  status.textContent =
    event.status === 'live'
      ? t('broadcast.statusLive')
      : event.status === 'upcoming'
        ? t('broadcast.statusUpcoming')
        : t('broadcast.statusFinished');
  const link = document.createElement('a');
  link.className = 'xqb-link';
  if (event.tourSlug) {
    link.href = `/broadcast/xiangqi/${encodeURIComponent(event.tourSlug)}`;
    link.textContent = t('broadcast.watch');
  } else if (event.sourceUrl) {
    link.href = event.sourceUrl;
    link.rel = 'noreferrer';
    link.textContent = t('broadcast.source');
  }
  row.append(when, what, status);
  if (link.href) row.append(link);
  return row;
}

export async function mountXiangqiBroadcastCalendar(root: HTMLElement): Promise<void> {
  root.classList.add('landing-page', 'xiangqi-broadcast-route');
  document.title = `${t('broadcast.calendarTitle')} · Mistboard`;
  const heading = document.createElement('h1');
  heading.className = 'xqb-section-title';
  heading.textContent = t('broadcast.calendarTitle');
  const note = document.createElement('p');
  note.className = 'xqb-note';
  note.textContent = t('broadcast.calendarNote');
  const body = document.createElement('div');
  body.className = 'xqb-cal';
  body.textContent = t('broadcast.loadingBroadcasts');
  root.replaceChildren(buildNav(), broadcastSectionLayout('calendar', heading, note, body));

  const calendar = await fetchBroadcastCalendar();
  body.replaceChildren();
  if (!calendar || calendar.events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'xqb-empty';
    empty.textContent = t('broadcast.calendarUnavailable');
    body.append(empty);
    return;
  }
  // Grouped by the month an event starts in, the way lichess's calendar reads.
  const byMonth = new Map<string, BroadcastCalendarEvent[]>();
  for (const event of calendar.events) {
    const month = event.startsOn.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(event);
    byMonth.set(month, list);
  }
  for (const [month, events] of byMonth) {
    const section = document.createElement('section');
    section.className = 'xqb-cal-month';
    const title = document.createElement('h2');
    title.textContent = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    const list = document.createElement('ul');
    list.className = 'xqb-cal-list';
    for (const event of events) list.append(calendarEventRow(event));
    section.append(title, list);
    body.append(section);
  }
}

export function mountXiangqiBroadcastAbout(root: HTMLElement): void {
  root.classList.add('landing-page', 'xiangqi-broadcast-route');
  document.title = `${t('broadcast.aboutTitle')} · Mistboard`;
  const heading = document.createElement('h1');
  heading.className = 'xqb-section-title';
  heading.textContent = t('broadcast.aboutTitle');
  const article = document.createElement('div');
  article.className = 'xqb-about';
  const blocks: Array<[string, string]> = [
    ['', t('broadcast.aboutIntro')],
    [t('broadcast.aboutSourcesTitle'), t('broadcast.aboutSources')],
    [t('broadcast.aboutAnalysisTitle'), t('broadcast.aboutAnalysis')],
    [t('broadcast.aboutPlayersTitle'), t('broadcast.aboutPlayers')],
    [t('broadcast.aboutNotationTitle'), t('broadcast.aboutNotation')],
  ];
  for (const [title, text] of blocks) {
    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      article.append(h);
    }
    const p = document.createElement('p');
    p.textContent = text;
    article.append(p);
  }
  root.replaceChildren(buildNav(), broadcastSectionLayout('about', heading, article));
}
