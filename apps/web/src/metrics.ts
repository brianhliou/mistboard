// Public /stats and admin reporting share the aggregate stats module.
// Admin navigation separates games, return visits, activity and operations;
// every admin destination waits for an authorized metrics response.
// Public /stats keeps its translated static layout and public-only API reads.

import './metrics.css';
import { CANONICAL_VARIANT_ORDER, isRetiredGameSpec } from '@mistboard/game';
import { buildReportingNav, type ReportingTab } from './admin-reporting-nav.js';
import { variantNameKeyForSpecId } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildNav, buildNotice } from './site-shell.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import {
  formatStatNumber,
  type PublicSiteStats,
  type PublicStatsMode,
  type PublicStatsWeek,
} from './stats-charts.js';
import { buildWeeklyChart, type WeeklySeries } from './weekly-chart.js';

// The live variants shown on the public /stats surface: the public shelf
// (game-specs.ts CANONICAL_VARIANT_ORDER) minus anything retired, derived so a
// launch or a retirement moves /stats with it. A hand list here once missed
// atomic xiangqi for weeks. The server already leaves retired variants' games
// out of every number on /api/stats/public (countedPublicGame in
// apps/server/src/persistence-counted-games.ts), so the headline total, the
// series and the breakdowns carry no retired variant and need no note; this
// filter keeps the breakdown and chart filter to the public shelf. Admin
// /metrics applies the same shelf to the human split, but its own series
// still count retired variants' games; the engines block at the bottom lists
// every variant the bots played.
const STATS_VARIANTS: readonly string[] = CANONICAL_VARIANT_ORDER.filter(
  (id) => !isRetiredGameSpec(id),
);

type LiveStats = { playing: number; online: number };

// Mirrors AdminRetentionCohort in persistence-admin-metrics.ts.
export type AdminRetentionCohort = {
  weekStart: string;
  segment: 'all' | 'jieqi' | 'other';
  players: number;
  returns: { week: number; returned: number | null; percentage: number | null }[];
};

// Mirrors LoginEmailDeliveryCounts in persistence-email-delivery.ts.
type LoginEmailDeliveryCounts = {
  requested: number;
  sent: number;
  delivered: number;
  bounced: number;
  suppressed: number;
  complained: number;
  completed: number;
};

type LoginEmailDeliveryMetrics = {
  last7d: LoginEmailDeliveryCounts;
  last30d: LoginEmailDeliveryCounts;
};

// Mirrors AdminMetrics in apps/server/src/persistence-admin-metrics.ts.
export type AdminMetricsWeek = {
  weekStart: string;
  humanGames: number;
  pvpGames: number;
  pveGames: number;
  players: number;
  signedInPlayers: number;
  newPlayers: number;
  returningPlayers: number;
  activePlayers28d: number;
  guestGames: number;
  newAccounts: number;
  puzzleSessions: number;
  puzzleSolves: number;
  puzzleAttempts: number;
  puzzlePlayers: number;
  returningPuzzlePlayers: number;
  studiesCreated: number;
  studyChaptersCreated: number;
  practiceSolves: number;
  chatLines: number;
  gameChatLines: number;
  dmMessages: number;
  correspondenceSeeks: number;
  newPatrons: number;
  eveGames: number;
  internalGames: number;
};

export type AdminMetrics = {
  generatedAt: string;
  weekCount: number;
  accounts: number;
  accountsLast7d: number;
  accountsLast30d: number;
  humanGames: number;
  humanGamesLast7d: number;
  gamePace: {
    thisWeekSoFar: number;
    lastWeekSamePoint: number;
    lastWeekTotal: number;
  };
  publicHumanGames: number;
  activePlayers28d: number;
  previousActivePlayers28d: number;
  activePatrons: number;
  humanGamesByResult: Record<string, number>;
  humanGamesByVariant: Record<string, number>;
  weekly: AdminMetricsWeek[];
  retentionCohorts: AdminRetentionCohort[];
  loginEmailDelivery: LoginEmailDeliveryMetrics;
  engines: {
    eveGames: number;
    eveGamesLast7d: number;
    importedGames: number;
    manualGames: number;
    internalGames: number;
    internalGamesLast7d: number;
    preLaunchGames?: number;
    shortGames?: number;
    countedFrom?: string;
    minCountedPlies?: number;
    eveByVariant: Record<string, number>;
  };
};

export async function mountMetrics(root: HTMLElement, options: { admin: boolean }): Promise<void> {
  if (options.admin) return mountAdminMetrics(root);
  return mountPublicStats(root);
}

// Public /stats: one of the /about family, on the static rail, translated.
// Games per week leads (the growth read), then the totals a visitor asks
// about. Nothing per-person, nothing engine, nothing internal.
async function mountPublicStats(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'metrics-route', 'stats-route');

  const section = document.createElement('section');
  section.className = 'site-section stats-section';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('stats.heading', {}, locale);
  const lede = document.createElement('p');
  lede.textContent = t('stats.lede', {}, locale);
  const body = document.createElement('div');
  body.className = 'metrics-body';
  body.setAttribute('aria-live', 'polite');
  body.textContent = 'Loading…';
  section.append(heading, lede, body);
  root.append(buildNav(locale), buildStaticPageLayout('stats', section, locale));

  const [publicStats, live] = await Promise.all([fetchPublicStats(), fetchLiveStats()]);
  if (!publicStats) {
    body.replaceChildren(
      buildNotice(
        t('stats.unavailableHeading', {}, locale),
        t('stats.unavailableBody', {}, locale),
      ),
    );
    return;
  }

  const parts: HTMLElement[] = [];
  const cards = document.createElement('div');
  cards.className = 'metrics-cards';
  cards.append(
    statCard(
      t('stats.gamesPlayed', {}, locale),
      publicStats.totalCompletedGames,
      t(
        'stats.gamesThisMonth',
        { count: formatStatNumber(publicStats.last30dCompletedGames) },
        locale,
      ),
    ),
  );
  if (typeof publicStats.accounts === 'number') {
    cards.append(statCard(t('stats.accounts', {}, locale), publicStats.accounts));
  }
  if (live) cards.append(statCard(t('stats.inPlay', {}, locale), live.playing));
  parts.push(cards);
  const updated = document.createElement('time');
  updated.className = 'stats-updated';
  updated.dateTime = publicStats.generatedAt;
  parts.push(updated);

  const weekly = publicStats.weeklyCompletedGames ?? [];
  if (weekly.length > 0) {
    parts.push(
      buildChartSection(
        t('stats.gamesPerWeek', {}, locale),
        buildPublicWeeklyChart(weekly, locale),
        'metrics-weekly-section',
      ),
    );
  }

  const variantEntries = publicVariantEntries(publicStats, locale);
  if (variantEntries.length > 0) {
    parts.push(buildBreakdownSection(t('stats.byVariant', {}, locale), variantEntries));
  }
  parts.push(
    buildBreakdownSection(
      t('stats.byMode', {}, locale),
      modeEntries(publicStats.modeTotals, locale),
    ),
  );
  body.replaceChildren(...parts);
  updateStatsAge(updated, publicStats.generatedAt, locale);
}

// Recompute from the payload's timestamp, including after a sleeping tab wakes.
// Stop scheduling when navigation removes the label from the document.
function updateStatsAge(label: HTMLElement, generatedAt: string, locale: Locale): void {
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs) || !label.isConnected) return;
  const age = Math.max(0, Date.now() - generatedMs);
  const minutes = Math.floor(age / 60_000);
  label.textContent =
    minutes < 1
      ? t('stats.updatedJustNow', {}, locale)
      : t('stats.updatedMinutesAgo', { count: formatStatNumber(minutes, locale) }, locale);
  window.setTimeout(() => updateStatsAge(label, generatedAt, locale), 60_000 - (age % 60_000));
}

async function mountAdminMetrics(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'metrics-route');
  const shell = document.createElement('main');
  shell.className = 'site-section metrics-shell';
  root.append(buildNav(locale), shell);
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Metrics';
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  const tab: Exclude<ReportingTab, 'readouts'> =
    requestedTab === 'retention' || requestedTab === 'activity' || requestedTab === 'operations'
      ? requestedTab
      : window.location.hash === '#deploy-history'
        ? 'operations'
        : 'play';
  heading.textContent = {
    play: 'Games and players',
    retention: 'Returning players',
    activity: 'Activity',
    operations: 'System',
  }[tab];
  const body = document.createElement('div');
  body.className = 'metrics-body';
  body.setAttribute('aria-live', 'polite');
  body.textContent = 'Loading…';
  shell.append(heading, body);
  let admin: AdminMetrics;
  try {
    admin = await fetchAdminMetrics();
  } catch (error) {
    body.replaceChildren(
      buildNotice(
        error instanceof AdminMetricsAccessError ? 'Admin access required' : 'Metrics unavailable',
        error instanceof AdminMetricsAccessError
          ? 'Sign in with an admin account to view metrics.'
          : 'Could not load admin metrics. Try again shortly.',
      ),
    );
    return;
  }
  shell.prepend(buildReportingNav(tab));
  const [publicStats, live, deploys] = await Promise.all([
    tab === 'play' ? fetchPublicStats() : Promise.resolve(null),
    tab === 'play' ? fetchLiveStats() : Promise.resolve(null),
    tab === 'operations' ? fetchDeployHistory() : Promise.resolve(null),
  ]);
  const lede = document.createElement('p');
  lede.className = 'metrics-lede';
  lede.textContent =
    'Completed human games, counted from the database including Do Not Track visitors. Players are distinct accounts and guest browser IDs, so signing in or changing browsers can count someone twice. Returning players had played before the selected week; the Returning players tab shows how many new players came back. Weeks run Monday to Sunday UTC. Charts include the current week as a dashed partial segment.';
  const charts = buildWeeklySections(admin, locale);
  const lifetime: HTMLElement[] = [buildHeadlineCards(publicStats, live, admin)];
  const variants = sortedEntries(admin.humanGamesByVariant)
    .filter((entry) => STATS_VARIANTS.includes(entry.label))
    .map((entry) => ({ label: variantPublicName(entry.label, locale), count: entry.count }));
  if (variants.length) lifetime.push(buildBreakdownSection('Games by variant', variants));
  if (publicStats)
    lifetime.push(
      buildBreakdownSection('Games by mode', modeEntries(publicStats.modeTotals, locale)),
    );
  const results = sortedEntries(admin.humanGamesByResult).map((entry) => ({
    label: prettyResult(entry.label),
    count: entry.count,
  }));
  if (results.length) lifetime.push(buildBreakdownSection('Games by result', results));
  const parts: HTMLElement[] = [];
  if (tab === 'play')
    parts.push(
      buildWeekReview(admin),
      buildGamePace(admin.gamePace),
      lede,
      charts[2],
      charts[0],
      charts[1],
      sectionHeading('Lifetime totals and live status'),
      ...lifetime,
    );
  if (tab === 'activity') parts.push(...charts.slice(3));
  if (tab === 'retention') parts.push(buildRetentionSection(admin.retentionCohorts ?? []));
  if (tab === 'operations') {
    parts.push(buildEnginesSection(admin, locale));
    parts.push(buildLoginEmailDeliverySection(admin.loginEmailDelivery, locale));
    if (deploys) {
      const history = buildDeploysSection(deploys);
      history.id = 'deploy-history';
      parts.push(history);
    }
  }
  body.replaceChildren(...parts);
  if (window.location.hash === '#deploy-history')
    document.getElementById('deploy-history')?.scrollIntoView();
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function buildGamePace(pace: AdminMetrics['gamePace']): HTMLElement {
  const line = document.createElement('p');
  line.className = 'metrics-game-pace';
  const change =
    pace.lastWeekSamePoint === 0
      ? pace.thisWeekSoFar === 0
        ? '0%'
        : 'no games at this point last week'
      : `${pace.thisWeekSoFar >= pace.lastWeekSamePoint ? '+' : ''}${(
          (100 * (pace.thisWeekSoFar - pace.lastWeekSamePoint)) / pace.lastWeekSamePoint
        ).toFixed(1)}%`;
  line.textContent = `This week so far: ${formatStatNumber(pace.thisWeekSoFar)}, last week at the same point: ${formatStatNumber(pace.lastWeekSamePoint)} (${change}), last week total: ${formatStatNumber(pace.lastWeekTotal)}. Pacific weeks.`;
  return line;
}

function buildWeekReview(admin: AdminMetrics): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-week-review';
  const weeks = [...admin.weekly].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const complete = (week: AdminMetricsWeek) =>
    Date.parse(week.weekStart) + WEEK_MS <= Date.parse(admin.generatedAt);
  const requested = new URLSearchParams(window.location.search).get('week');
  let selected =
    weeks.find((week) => week.weekStart === requested) ??
    [...weeks].reverse().find(complete) ??
    weeks.at(-1);
  const unavailable = document.createElement('p');
  unavailable.className = 'metrics-section-note';
  if (requested && !weeks.some((week) => week.weekStart === requested)) {
    unavailable.textContent = `The requested week (${requested}) is outside the available history. Showing the latest available completed week.`;
  }
  const label = document.createElement('label');
  label.className = 'metrics-week-label';
  label.append('Review week ');
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Review week');
  for (const week of [...weeks].reverse()) {
    const option = document.createElement('option');
    option.value = week.weekStart;
    const end = new Date(Date.parse(week.weekStart) + WEEK_MS - 1).toISOString().slice(0, 10);
    option.textContent = `${week.weekStart} to ${end}${complete(week) ? '' : ' · in progress'}`;
    picker.append(option);
  }
  label.append(picker);
  const review = document.createElement('div');
  review.className = 'metrics-week-summary';
  const draw = () => {
    if (!selected) {
      review.textContent = 'No weekly activity available yet.';
      return;
    }
    picker.value = selected.weekStart;
    const priorStart = new Date(Date.parse(selected.weekStart) - WEEK_MS)
      .toISOString()
      .slice(0, 10);
    const previous = complete(selected)
      ? weeks.find((week) => week.weekStart === priorStart)
      : undefined;
    const heading = document.createElement('h2');
    heading.className = 'metrics-week-heading';
    heading.textContent = complete(selected) ? 'Completed week' : 'Week in progress';
    const note = document.createElement('p');
    note.className = 'metrics-section-note';
    note.textContent = complete(selected)
      ? `Monday–Sunday UTC${previous ? ` · compared with the week of ${previous.weekStart}` : ' · previous week unavailable'}.`
      : 'Partial UTC week. A comparison with a complete week would be misleading, so changes are unavailable.';
    const grid = document.createElement('div');
    grid.className = 'metrics-cards metrics-week-cards';
    const picks = [
      ['Completed human games', 'humanGames'],
      ['Players', 'players'],
      ['Returning players', 'returningPlayers'],
      ['New accounts', 'newAccounts'],
    ] as const;
    for (const [title, key] of picks) {
      const current = selected[key];
      const before = previous?.[key];
      let change = 'Comparison unavailable';
      if (before !== undefined) {
        const difference = current - before;
        change = `${signedDelta(difference)}${before ? ` (${Math.round((difference / before) * 100) > 0 ? '+' : ''}${Math.round((difference / before) * 100)}%)` : difference ? ' (new)' : ' (flat)'} vs ${formatStatNumber(before)}`;
      }
      const card = statCard(title, current, change);
      if (before !== undefined && current > before && key === 'humanGames')
        card.classList.add('is-up');
      grid.append(card);
    }
    const split = document.createElement('p');
    split.className = 'metrics-section-note';
    split.textContent = `Games: ${formatStatNumber(selected.pvpGames)} vs people · ${formatStatNumber(selected.pveGames)} vs bots. New accounts count sign-ups whether or not they played.`;
    review.replaceChildren(heading, note, grid, split);
  };
  picker.addEventListener('change', () => {
    selected = weeks.find((week) => week.weekStart === picker.value);
    const url = new URL(window.location.href);
    unavailable.textContent = '';
    url.searchParams.set('week', picker.value);
    window.history.replaceState(null, '', url);
    draw();
  });
  if (unavailable.textContent) section.append(unavailable);
  section.append(label, review);
  draw();
  return section;
}

function buildLoginEmailDeliverySection(
  metrics: LoginEmailDeliveryMetrics,
  locale: Locale,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section metrics-login-email';
  const title = t('metrics.loginEmail.heading', {}, locale);
  section.append(sectionHeading(title));
  const note = document.createElement('p');
  note.className = 'metrics-section-note';
  note.textContent = t('metrics.loginEmail.note', {}, locale);
  section.append(note);
  const scroller = document.createElement('div');
  scroller.className = 'metrics-retention-scroll';
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', title);
  const table = document.createElement('table');
  table.className = 'metrics-retention-table';
  const head = table.createTHead().insertRow();
  for (const key of ['status', 'last7d', 'last30d'] as const) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t(`metrics.loginEmail.${key}`, {}, locale);
    head.append(th);
  }
  const body = table.createTBody();
  for (const key of [
    'requested',
    'sent',
    'delivered',
    'bounced',
    'suppressed',
    'complained',
    'completed',
  ] as const) {
    const row = body.insertRow();
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = t(`metrics.loginEmail.${key}`, {}, locale);
    row.append(label);
    row.insertCell().textContent = formatStatNumber(metrics.last7d[key], locale);
    row.insertCell().textContent = formatStatNumber(metrics.last30d[key], locale);
  }
  scroller.append(table);
  section.append(scroller);
  return section;
}

function buildRetentionSection(cohorts: AdminRetentionCohort[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section metrics-retention';
  section.append(sectionHeading('Do new players come back?'));
  const intro = document.createElement('p');
  intro.className = 'metrics-section-note';
  intro.textContent =
    'Retention means coming back to play. Start with people who finished their first game in a given week, then count how many finished another game the next week or four weeks later.';
  const label = document.createElement('label');
  label.className = 'metrics-return-filter';
  label.append('First game variant ');
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'First game variant');
  for (const [value, text] of [
    ['all', 'All variants'],
    ['jieqi', 'Jieqi'],
    ['other', 'Other variants'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    picker.append(option);
  }
  label.append(picker);
  const body = document.createElement('div');
  const draw = () => {
    const rows = cohorts
      .filter((cohort) => cohort.segment === picker.value)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
      .slice(0, 12);
    body.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No first-game players in this window.';
      body.append(empty);
      return;
    }
    const latest = rows.find((row) =>
      row.returns.some(
        (cell) => cell.week === 1 && cell.returned !== null && cell.percentage !== null,
      ),
    );
    if (latest) {
      const cell = latest.returns.find((cell) => cell.week === 1)!;
      const example = document.createElement('p');
      example.className = 'metrics-return-example';
      example.textContent = `Of the ${formatStatNumber(latest.players)} players who first played in the week of ${formatReturnDate(latest.weekStart)}, ${formatStatNumber(cell.returned!)} came back the next week (${cell.percentage!.toFixed(1)}%).`;
      body.append(example);
    }
    const table = document.createElement('table');
    table.className = 'metrics-return-table';
    const head = table.createTHead().insertRow();
    for (const text of ['First played', 'New players', 'Next week', '4 weeks later']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      head.append(th);
    }
    const tbody = table.createTBody();
    for (const cohort of rows) {
      const row = tbody.insertRow();
      const first = document.createElement('th');
      first.scope = 'row';
      first.textContent = formatReturnDate(cohort.weekStart);
      row.append(first);
      row.insertCell().textContent = formatStatNumber(cohort.players);
      for (const week of [1, 4]) {
        const td = row.insertCell();
        const cell = cohort.returns.find((entry) => entry.week === week);
        if (!cell || cell.returned === null || cell.percentage === null) {
          td.textContent = cell ? 'Not ready' : 'Unavailable';
          td.className = 'metrics-return-pending';
        } else {
          const rate = document.createElement('strong');
          rate.textContent = `${cell.percentage.toFixed(1)}%`;
          const count = document.createElement('span');
          count.textContent = `${formatStatNumber(cell.returned)} of ${formatStatNumber(cohort.players)}`;
          td.append(rate, count);
        }
      }
    }
    body.append(table);
  };
  const note = document.createElement('p');
  note.className = 'metrics-section-note';
  note.textContent =
    'Last 12 first-game weeks, Monday to Sunday UTC. A return can be in any variant. “4 weeks later” checks that particular week, not any time in the first month. Not ready means that whole return week has not finished yet. Players are accounts and guest browsers; changing browser or signing in can count someone twice. Guest history starts on 2026-09-11.';
  picker.addEventListener('change', draw);
  section.append(intro, label, body, note);
  draw();
  return section;
}
function formatReturnDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(date));
}

// ── headline number cards ────────────────────────────────────────────────────
function buildHeadlineCards(
  publicStats: PublicSiteStats | null,
  live: LiveStats | null,
  admin: AdminMetrics | null,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'metrics-cards';

  if (admin) {
    grid.append(
      statCard(
        'Active players',
        admin.activePlayers28d,
        `played in the last 28 days, ${signedDelta(admin.activePlayers28d - admin.previousActivePlayers28d)} vs the 28 before`,
      ),
    );
  }
  if (admin) {
    grid.append(
      statCard(
        'Games played',
        admin.humanGames,
        `+${formatStatNumber(admin.humanGamesLast7d)} in the last 7 days`,
      ),
    );
  } else if (publicStats) {
    grid.append(
      statCard(
        'Games played',
        publicStats.totalCompletedGames,
        `+${formatStatNumber(publicStats.last30dCompletedGames)} in the last 30 days`,
      ),
    );
  }
  if (admin) {
    grid.append(
      statCard(
        'Accounts',
        admin.accounts,
        `+${formatStatNumber(admin.accountsLast30d)} in the last 30 days`,
      ),
      statCard('Patrons', admin.activePatrons),
    );
  } else if (publicStats) {
    grid.append(statCard('Public games', publicStats.publicGames));
  }
  if (live) {
    grid.append(statCard('In play now', live.playing));
    if (admin) grid.append(statCard('Online now', live.online));
  }
  return grid;
}

function signedDelta(value: number): string {
  if (value > 0) return `+${formatStatNumber(value)}`;
  if (value < 0) return `-${formatStatNumber(-value)}`;
  return '±0';
}

function statCard(label: string, value: number, note?: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'metrics-card';
  const valueEl = document.createElement('strong');
  valueEl.className = 'metrics-card-value';
  valueEl.textContent = formatStatNumber(value);
  const labelEl = document.createElement('span');
  labelEl.className = 'metrics-card-label';
  labelEl.textContent = label;
  card.append(valueEl, labelEl);
  if (note) {
    const noteEl = document.createElement('span');
    noteEl.className = 'metrics-card-note';
    noteEl.textContent = note;
    card.append(noteEl);
  }
  return card;
}

// ── sections ─────────────────────────────────────────────────────────────────
function buildChartSection(title: string, chart: HTMLElement, extraClass?: string): HTMLElement {
  const section = document.createElement('section');
  section.className = `metrics-section metrics-chart-section${extraClass ? ` ${extraClass}` : ''}`;
  section.append(sectionHeading(title));
  section.append(chart);
  return section;
}

// The public weekly chart: one line, all games. It carried a chip per variant
// until 2026-10-17 (Brian: "simplifying this page"); the variant split is the
// breakdown below it. Full weeks only. The current week used to end the line as
// a dashed dive on the day people look, since a Monday's week is one day of
// games; it is a line of text under the chart instead.
export function publicVariantEntries(
  publicStats: PublicSiteStats,
  locale: Locale,
): Array<{ label: string; count: number }> {
  return publicStats.variantTotals
    .filter((v) => STATS_VARIANTS.includes(v.variant))
    .map((v) => ({ label: variantPublicName(v.variant, locale), count: v.count }));
}

// The weeks a public chart plots: every week but the one still in progress
// (the series ends on the current Monday-start week), unless that is all there is.
export function completedWeeks<T>(weeks: T[]): T[] {
  return weeks.length > 1 ? weeks.slice(0, -1) : weeks;
}

function buildPublicWeeklyChart(weeks: PublicStatsWeek[], locale: Locale): HTMLElement {
  const figure = document.createElement('div');
  figure.className = 'stats-weekly';
  const plot = document.createElement('div');
  plot.className = 'stats-weekly-plot';
  const plotted = completedWeeks(weeks);
  plot.append(
    buildWeeklyChart({
      weeks: plotted.map((week) => week.weekStart),
      series: [
        {
          key: 'games',
          label: t('stats.gamesPerWeekSeries', {}, locale),
          values: plotted.map((week) => week.completedGames),
        },
      ],
      ariaLabel: t('stats.gamesPerWeekLabel', { count: String(plotted.length) }, locale),
      partialLast: false,
      locale,
      table: false,
    }),
  );
  figure.append(plot);
  const current = weeks.length > 1 ? weeks.at(-1) : undefined;
  if (current) {
    const soFar = document.createElement('p');
    soFar.className = 'stats-weekly-so-far';
    soFar.textContent = t(
      'stats.thisWeekSoFar',
      { count: formatStatNumber(current.completedGames, locale) },
      locale,
    );
    figure.append(soFar);
  }
  return figure;
}

// ── weekly series (admin) ────────────────────────────────────────────────────
type WeeklyPick = { key: keyof AdminMetricsWeek; label: string };

function weeklySeries(admin: AdminMetrics, picks: WeeklyPick[]): WeeklySeries[] {
  return picks.map((pick) => ({
    key: String(pick.key),
    label: pick.label,
    values: admin.weekly.map((week) => Number(week[pick.key]) || 0),
  }));
}

function buildWeeklySections(admin: AdminMetrics, locale: Locale): HTMLElement[] {
  const weeks = admin.weekly.map((week) => week.weekStart);
  const chart = (title: string, picks: WeeklyPick[], ariaLabel: string): HTMLElement =>
    buildChartSection(
      title,
      buildWeeklyChart({ weeks, series: weeklySeries(admin, picks), ariaLabel, locale }),
      'metrics-weekly-section',
    );
  return [
    chart(
      'Players per week',
      [
        { key: 'players', label: 'Players' },
        { key: 'signedInPlayers', label: 'Signed in' },
        { key: 'newPlayers', label: 'New' },
        { key: 'returningPlayers', label: 'Returning' },
      ],
      'Distinct accounts and guest browsers that finished a game each week, with the signed-in, first-time and returning shares',
    ),
    chart(
      'Active players, rolling 28 days',
      [{ key: 'activePlayers28d', label: 'Active players' }],
      'Distinct accounts and guest browsers that finished a game in the 28 days ending each week',
    ),
    chart(
      'Games per week',
      [
        { key: 'humanGames', label: 'All' },
        { key: 'pvpGames', label: 'vs human' },
        { key: 'pveGames', label: 'vs bot' },
        { key: 'guestGames', label: 'With a guest seat' },
      ],
      'Completed human games per week, split by opponent, plus games with at least one guest seat',
    ),
    chart(
      'Accounts per week',
      [
        { key: 'newAccounts', label: 'New accounts' },
        { key: 'newPatrons', label: 'New patrons' },
      ],
      'Accounts created and patrons started per week',
    ),
    chart(
      'Puzzle players per week',
      [
        { key: 'puzzlePlayers', label: 'Puzzle players' },
        { key: 'returningPuzzlePlayers', label: 'Returning' },
      ],
      'Distinct accounts and guest browsers that made a move on a puzzle each week, and those who had in an earlier week. Counted from 2026-10-25; earlier weeks have no player identity',
    ),
    chart(
      'Puzzles per week',
      [
        { key: 'puzzleSessions', label: 'Puzzles started' },
        { key: 'puzzleSolves', label: 'Solves' },
        { key: 'puzzleAttempts', label: 'Signed-in attempts' },
      ],
      'Puzzles started (one person starting five is five), puzzles solved, and rated attempts by counted accounts per week',
    ),
    chart(
      'Study and practice per week',
      [
        { key: 'studiesCreated', label: 'Studies created' },
        { key: 'studyChaptersCreated', label: 'Chapters added' },
        { key: 'practiceSolves', label: 'Practice solves' },
      ],
      'Studies created, chapters added, and practice positions solved per week',
    ),
    chart(
      'Community per week',
      [
        { key: 'chatLines', label: 'Lobby chat' },
        { key: 'gameChatLines', label: 'Game chat' },
        { key: 'dmMessages', label: 'Direct messages' },
        { key: 'correspondenceSeeks', label: 'Correspondence seeks' },
      ],
      'Lobby chat lines, chat lines in game rooms (players and spectators), direct messages, and correspondence seeks per week',
    ),
  ];
}

// Bot-vs-bot, the corpus modes, and the operator's own games, kept out of
// every number above.
function buildEnginesSection(admin: AdminMetrics, locale: Locale): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section metrics-engines-section';
  section.append(sectionHeading('Engine and corpus activity'));
  const note = document.createElement('p');
  note.className = 'metrics-section-note';
  note.textContent = `Bot vs bot games are the engine ladder, imported and manual games are corpus, internal games have a seat held by an account excluded from statistics (the operator's own), pre-launch games finished before ${admin.engines.countedFrom ?? 'the launch date'}, when the site had no visitors yet, and short games ended before both sides had moved (fewer than ${admin.engines.minCountedPlies ?? 2} plies: opened a bot game and resigned or left). None of them count as play anywhere above.`;
  section.append(note);

  const grid = document.createElement('div');
  grid.className = 'metrics-cards';
  grid.append(
    statCard(
      'Bot vs bot',
      admin.engines.eveGames,
      `+${formatStatNumber(admin.engines.eveGamesLast7d)} this week`,
    ),
    statCard(
      'Internal',
      admin.engines.internalGames,
      `+${formatStatNumber(admin.engines.internalGamesLast7d)} this week`,
    ),
    statCard('Pre-launch', admin.engines.preLaunchGames ?? 0),
    statCard('Short', admin.engines.shortGames ?? 0),
    statCard('Imported', admin.engines.importedGames),
    statCard('Manual', admin.engines.manualGames),
  );
  section.append(grid);

  const weeks = admin.weekly.map((week) => week.weekStart);
  section.append(
    buildWeeklyChart({
      weeks,
      series: weeklySeries(admin, [
        { key: 'eveGames', label: 'Bot vs bot' },
        { key: 'internalGames', label: 'Internal' },
      ]),
      ariaLabel: 'Bot vs bot and internal games completed per week',
      locale,
    }),
  );

  const byVariant = sortedEntries(admin.engines.eveByVariant).map((entry) => ({
    label: variantPublicName(entry.label, locale),
    count: entry.count,
  }));
  if (byVariant.length > 0) {
    section.append(buildBreakdownList(byVariant));
  }
  return section;
}

type BreakdownEntry = { label: string; count: number };

function buildBreakdownSection(title: string, entries: BreakdownEntry[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section';
  section.append(sectionHeading(title));
  section.append(buildBreakdownList(entries));
  return section;
}

function buildBreakdownList(entries: BreakdownEntry[]): HTMLElement {
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  const list = document.createElement('ul');
  list.className = 'metrics-breakdown';
  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'metrics-breakdown-row';

    const label = document.createElement('span');
    label.className = 'metrics-breakdown-label';
    label.textContent = entry.label;

    const bar = document.createElement('span');
    bar.className = 'metrics-breakdown-bar';
    const fill = document.createElement('span');
    fill.className = 'metrics-breakdown-fill';
    fill.style.width = `${Math.round((entry.count / max) * 100)}%`;
    bar.append(fill);

    const value = document.createElement('strong');
    value.className = 'metrics-breakdown-value';
    value.textContent = formatStatNumber(entry.count);

    item.append(label, bar, value);
    list.append(item);
  }
  return list;
}

function sectionHeading(text: string): HTMLElement {
  const heading = document.createElement('h2');
  heading.className = 'about-subheading metrics-section-heading';
  heading.textContent = text;
  return heading;
}

// ── data ─────────────────────────────────────────────────────────────────────
function modeEntries(
  modeTotals: Record<PublicStatsMode, number>,
  locale: Locale,
): BreakdownEntry[] {
  const labels: Record<'pvp' | 'pve', I18nKey> = {
    pvp: 'about.modePvp',
    pve: 'about.modePve',
  };
  return (['pvp', 'pve'] as const)
    .map((mode) => ({ label: t(labels[mode], {}, locale), count: modeTotals[mode] ?? 0 }))
    .filter((entry) => entry.count > 0);
}

function sortedEntries(record: Record<string, number>): BreakdownEntry[] {
  return Object.entries(record)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Public-facing variant names, keyed by the persisted games.variant id (which
// equals the game-spec id). Live specs take the catalog's exhaustive table
// (game-display.ts variantNameKeyForSpecId), so a new variant is named here
// without an edit; this page still counts games in variants deleted from
// GameSpecId, which keep their names below. Anything else degrades to a
// prettified id instead of throwing.
const RETIRED_VARIANT_NAME_KEYS: Record<string, I18nKey> = {
  'mini-xiangqi': 'variant.miniXiangqi.name',
  'dark-mini-xiangqi': 'variant.darkMiniXiangqi.name',
};

function variantPublicName(variant: string, locale: Locale): string {
  const key = variantNameKeyForSpecId(variant) ?? RETIRED_VARIANT_NAME_KEYS[variant];
  if (key) return t(key, {}, locale);
  return variant
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function prettyResult(result: string): string {
  const known: Record<string, string> = {
    'red-win': 'Red win',
    'red-wins': 'Red win',
    'black-win': 'Black win',
    'black-wins': 'Black win',
    'white-win': 'White win',
    'white-wins': 'White win',
    draw: 'Draw',
    // A null result (grouped under the "null" key) is a game with no recorded
    // outcome: still running, aborted, or abandoned.
    null: 'Unfinished',
    abandoned: 'Abandoned',
    aborted: 'Aborted',
  };
  if (known[result]) return known[result];
  return result
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function fetchPublicStats(): Promise<PublicSiteStats | null> {
  try {
    const resp = await fetch('/api/stats/public', { credentials: 'same-origin' });
    if (!resp.ok) return null;
    return (await resp.json()) as PublicSiteStats;
  } catch {
    return null;
  }
}

async function fetchLiveStats(): Promise<LiveStats | null> {
  try {
    const resp = await fetch('/api/live-stats');
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<LiveStats>;
    if (typeof data.playing !== 'number' || typeof data.online !== 'number') return null;
    return { playing: data.playing, online: data.online };
  } catch {
    return null;
  }
}

// ── restarts and drains ─────────────────────────────────────────────────────
// Mirrors DeployHistoryEntry in apps/server/src/deploy-history.ts.
export type DeployHistoryEntry = {
  at: string;
  kind: 'restart' | 'drain-cancelled' | 'drain-lapsed';
  buildRevision: string | null;
  drain: {
    durationMs: number;
    committed: boolean;
    commitWaitMs: number | null;
    activeGamesAtStart: number;
    peakActiveGames: number;
    refusedCreates: number;
  } | null;
  withoutDrain: boolean;
  activeGamesAtShutdown: number | null;
  pausedOnShutdown: number;
  resumedPlayersBack: number;
  resumedAfterGrace: number;
};

const DEPLOY_COLUMNS = [
  'When',
  'What',
  'Drain',
  'Games waited on',
  'New games refused',
  'Live at shutdown',
  'Resumed (back / grace)',
] as const;

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

// One table row per restart or drain. A restart with a drain summary reads its
// numbers; one without says whether the server logged going down undrained or
// simply predates the summaries.
export function deployRowCells(entry: DeployHistoryEntry, locale = 'en-US'): string[] {
  const when = new Date(entry.at).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const what =
    entry.kind === 'restart'
      ? 'Restart'
      : entry.kind === 'drain-cancelled'
        ? 'Drain cancelled'
        : 'Drain lapsed';
  const drain = entry.drain;
  const drainCell = drain
    ? `${formatDuration(drain.durationMs)}${drain.committed ? '' : ', never committed'}`
    : entry.withoutDrain
      ? entry.activeGamesAtShutdown === 0
        ? 'not needed (0 live)'
        : 'none (undrained)'
      : 'not recorded';
  const waited = drain
    ? drain.peakActiveGames > drain.activeGamesAtStart
      ? `${drain.activeGamesAtStart} (peak ${drain.peakActiveGames})`
      : String(drain.activeGamesAtStart)
    : '';
  const refused = drain ? String(drain.refusedCreates) : '';
  const live =
    entry.kind === 'restart' && entry.activeGamesAtShutdown !== null
      ? String(entry.activeGamesAtShutdown)
      : '';
  const resumed =
    entry.pausedOnShutdown > 0
      ? `${entry.resumedPlayersBack} / ${entry.resumedAfterGrace} of ${entry.pausedOnShutdown}`
      : '';
  return [when, what, drainCell, waited, refused, live, resumed];
}

function buildDeploysSection(entries: DeployHistoryEntry[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section metrics-deploys';
  section.append(sectionHeading('Restarts and drains, last 30 days'));
  const note = document.createElement('p');
  note.className = 'metrics-section-note';
  note.textContent =
    'Live at shutdown should be 0 for a drained restart. Resumed counts chess-stack rooms paused by the shutdown: players back on both seats, or the grace timer resuming with a seat empty. Xiangqi-family rooms are not paused on shutdown and do not appear there.';
  section.append(note);
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'metrics-section-note';
    empty.textContent = 'No restarts recorded.';
    section.append(empty);
    return section;
  }
  const scroller = document.createElement('div');
  scroller.className = 'metrics-deploys-scroll';
  const table = document.createElement('table');
  table.className = 'metrics-deploys-table';
  const head = table.createTHead().insertRow();
  for (const label of DEPLOY_COLUMNS) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const body = table.createTBody();
  for (const entry of entries) {
    const row = body.insertRow();
    // Warn on what cost players: games live at shutdown, creates the drain
    // refused, or an undrained restart whose live count was not recorded. An
    // undrained restart with 0 live is release-prod's intended path (#478).
    const live = entry.activeGamesAtShutdown;
    if (
      (live ?? 0) > 0 ||
      (entry.drain?.refusedCreates ?? 0) > 0 ||
      (entry.withoutDrain && live === null)
    ) {
      row.classList.add('is-warning');
    }
    for (const cell of deployRowCells(entry)) row.insertCell().textContent = cell;
  }
  scroller.append(table);
  section.append(scroller);
  return section;
}

async function fetchDeployHistory(): Promise<DeployHistoryEntry[] | null> {
  try {
    const resp = await fetch('/api/admin/deploys', { credentials: 'same-origin' });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { deploys?: DeployHistoryEntry[] };
    return Array.isArray(data.deploys) ? data.deploys : null;
  } catch {
    return null;
  }
}

class AdminMetricsAccessError extends Error {}
async function fetchAdminMetrics(): Promise<AdminMetrics> {
  const response = await fetch('/api/stats/admin', { credentials: 'same-origin' });
  if (response.status === 401 || response.status === 403) throw new AdminMetricsAccessError();
  if (!response.ok) throw new Error('admin_metrics_unavailable');
  return (await response.json()) as AdminMetrics;
}
