// /stats (public) and /metrics (admin) share this module, the way coach.ts
// serves both the directory and a detail view. Public is one of the /about
// family (static rail, translated): games per week, totals, mode + variant
// splits. Admin adds the Postgres-true weekly series
// from /api/stats/admin (players, games, accounts, puzzles, study, community),
// the result split, the live in-play/online figures, and an "Engines and
// corpus" block at the bottom that is the ONLY place bot-vs-bot appears. The
// admin endpoint 401s for non-admins (open in local dev); the page is otherwise
// unlinked, so it is direct-URL only like /database.
// Plan and status: docs-private/metrics-roadmap.md.

import './metrics.css';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildNav, buildNotice } from './site-shell.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import {
  type ActivitySeries,
  buildInteractiveActivityChart,
  formatStatNumber,
  type PublicSiteStats,
  type PublicStatsMode,
} from './stats-charts.js';
import { buildWeeklyChart, type WeeklySeries } from './weekly-chart.js';

// The curated set of live variants shown on the public /stats surface, matching
// game-specs.ts CANONICAL_VARIANT_ORDER. Retired experiments (mini/drop,
// dark-shogi, luzhanqi) and hidden chess variants stay off the public breakdown
// and chart filter. Admin /metrics applies the same shelf to the human split;
// the engines block at the bottom lists every variant the bots played.
const STATS_VARIANTS: readonly string[] = [
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
];

type LiveStats = { playing: number; online: number };

// Mirrors AdminMetrics in apps/server/src/persistence-admin-metrics.ts.
export type AdminMetricsWeek = {
  weekStart: string;
  humanGames: number;
  pvpGames: number;
  pveGames: number;
  players: number;
  newPlayers: number;
  returningPlayers: number;
  activePlayers28d: number;
  guestGames: number;
  newAccounts: number;
  puzzleSessions: number;
  puzzleSolves: number;
  puzzleAttempts: number;
  studiesCreated: number;
  studyChaptersCreated: number;
  practiceSolves: number;
  chatLines: number;
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
  publicHumanGames: number;
  activePlayers28d: number;
  previousActivePlayers28d: number;
  activePatrons: number;
  humanGamesByResult: Record<string, number>;
  humanGamesByVariant: Record<string, number>;
  weekly: AdminMetricsWeek[];
  engines: {
    eveGames: number;
    eveGamesLast7d: number;
    importedGames: number;
    manualGames: number;
    internalGames: number;
    internalGamesLast7d: number;
    preLaunchGames?: number;
    countedFrom?: string;
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

  const weekly = publicStats.weeklyCompletedGames ?? [];
  if (weekly.length > 0) {
    parts.push(
      buildChartSection(
        t('stats.gamesPerWeek', {}, locale),
        buildWeeklyChart({
          weeks: weekly.map((week) => week.weekStart),
          series: [
            {
              key: 'games',
              label: t('stats.gamesPerWeekSeries', {}, locale),
              values: weekly.map((week) => week.completedGames),
            },
          ],
          ariaLabel: t('stats.gamesPerWeekLabel', { count: String(weekly.length) }, locale),
          locale,
        }),
        'metrics-weekly-section',
      ),
    );
  }

  if (publicStats.dailyCompletedGames.length > 0) {
    parts.push(
      buildChartSection(
        t('stats.gamesOverTime', {}, locale),
        buildInteractiveActivityChart(buildActivitySeries(publicStats, locale), locale),
      ),
    );
  }

  const variantEntries = publicStats.variantTotals
    .filter((v) => STATS_VARIANTS.includes(v.variant))
    .map((v) => ({ label: variantPublicName(v.variant, locale), count: v.count }));
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
  shell.append(heading);

  const body = document.createElement('div');
  body.className = 'metrics-body';
  body.setAttribute('aria-live', 'polite');
  body.textContent = 'Loading…';
  shell.append(body);

  const [publicStats, live, admin] = await Promise.all([
    fetchPublicStats(),
    fetchLiveStats(),
    fetchAdminMetrics(),
  ]);

  if (!publicStats && !admin) {
    body.replaceChildren(
      buildNotice('Statistics unavailable', 'Could not load statistics. Try again shortly.'),
    );
    return;
  }

  const parts: HTMLElement[] = [];
  parts.push(buildHeadlineCards(publicStats, live, admin));

  if (admin) {
    const lede = document.createElement('p');
    lede.className = 'metrics-lede';
    lede.textContent =
      'Every number above the last block is visitor play only: games between people or against a bot, with no seat held by an account excluded from statistics, counted from the database at game end, so Do Not Track visitors are included. Player counts are signed-in accounts: a guest seat carries no identity, so guests appear only as games with a guest seat. Weeks start on Monday; the last week is in progress.';
    parts.push(lede);
    parts.push(...buildWeeklySections(admin, locale));
  }

  if (publicStats && publicStats.dailyCompletedGames.length > 0) {
    parts.push(
      buildChartSection(
        'Games over time',
        buildInteractiveActivityChart(buildActivitySeries(publicStats, locale), locale),
      ),
    );
  }

  // Variant split, narrowed to the curated live shelf (STATS_VARIANTS), from
  // the admin endpoint's counted human games.
  const variantEntries = admin
    ? sortedEntries(admin.humanGamesByVariant)
        .filter((e) => STATS_VARIANTS.includes(e.label))
        .map((e) => ({ label: variantPublicName(e.label, locale), count: e.count }))
    : [];
  if (variantEntries.length > 0) {
    parts.push(buildBreakdownSection('Games by variant', variantEntries));
  }

  if (publicStats) {
    // Bot-vs-bot is never a mode row here: it lives in the last block.
    parts.push(buildBreakdownSection('Games by mode', modeEntries(publicStats.modeTotals, locale)));
  }

  if (admin) {
    const resultEntries = sortedEntries(admin.humanGamesByResult).map((entry) => ({
      label: prettyResult(entry.label),
      count: entry.count,
    }));
    if (resultEntries.length > 0) {
      parts.push(buildBreakdownSection('Games by result', resultEntries));
    }
    parts.push(buildEnginesSection(admin, locale));
  }

  body.replaceChildren(...parts);
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
        'Active accounts',
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
        `+${formatStatNumber(admin.humanGamesLast7d)} this week`,
      ),
    );
  } else if (publicStats) {
    grid.append(
      statCard(
        'Games played',
        publicStats.totalCompletedGames,
        `+${formatStatNumber(publicStats.last30dCompletedGames)} this month`,
      ),
    );
  }
  if (admin) {
    grid.append(
      statCard(
        'Accounts',
        admin.accounts,
        `+${formatStatNumber(admin.accountsLast30d)} this month`,
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

// "All games" (the true cumulative total, matching the headline) plus one
// cumulative series per curated live variant that has games, in canonical order.
function buildActivitySeries(publicStats: PublicSiteStats, locale: Locale): ActivitySeries[] {
  const all: ActivitySeries = {
    key: '__all',
    label: 'All games',
    days: publicStats.dailyCompletedGames,
  };
  const byVariant = new Map((publicStats.variantDaily ?? []).map((v) => [v.variant, v]));
  const variantSeries: ActivitySeries[] = [];
  for (const id of STATS_VARIANTS) {
    const series = byVariant.get(id);
    if (series && series.total > 0) {
      variantSeries.push({
        key: id,
        label: variantPublicName(id, locale),
        days: series.days,
      });
    }
  }
  return [all, ...variantSeries];
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
      'Signed-in players per week',
      [
        { key: 'players', label: 'Players' },
        { key: 'newPlayers', label: 'New' },
        { key: 'returningPlayers', label: 'Returning' },
      ],
      'Distinct accounts that finished a game each week, split into first-timers and returning',
    ),
    chart(
      'Active accounts, rolling 28 days',
      [{ key: 'activePlayers28d', label: 'Active accounts' }],
      'Distinct accounts that finished a game in the 28 days ending each week',
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
      'Puzzles per week',
      [
        { key: 'puzzleSessions', label: 'Sessions' },
        { key: 'puzzleSolves', label: 'Solves' },
        { key: 'puzzleAttempts', label: 'Signed-in attempts' },
      ],
      'Puzzle visits that started a puzzle, puzzles solved, and rated attempts per week',
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
        { key: 'dmMessages', label: 'Direct messages' },
        { key: 'correspondenceSeeks', label: 'Correspondence seeks' },
      ],
      'Lobby chat lines, direct messages, and correspondence seeks per week',
    ),
  ];
}

// Bot-vs-bot, the corpus modes, and the operator's own games, kept out of
// every number above.
function buildEnginesSection(admin: AdminMetrics, locale: Locale): HTMLElement {
  const section = document.createElement('section');
  section.className = 'metrics-section metrics-engines-section';
  section.append(sectionHeading('Not counted above'));
  const note = document.createElement('p');
  note.className = 'metrics-section-note';
  note.textContent = `Bot vs bot games are the engine ladder, imported and manual games are corpus, internal games have a seat held by an account excluded from statistics (the operator's own), and pre-launch games finished before ${admin.engines.countedFrom ?? 'the launch date'}, when the site had no visitors yet. None of them count as play anywhere above.`;
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
// equals the game-spec id). The canonical source is the lobby's exhaustive
// switch in landing-play.ts (variantNameKeyForGameSpec); this display-only map
// mirrors it with a safe prettify fallback, so an unmapped/new id degrades
// gracefully instead of throwing.
const VARIANT_NAME_KEYS: Record<string, I18nKey> = {
  xiangqi: 'variant.xiangqi.name',
  'dark-xiangqi': 'variant.darkXiangqi.name',
  'dark-chess': 'variant.darkChess.name',
  'fortress-xiangqi': 'variant.fortressXiangqi.name',
  'duck-xiangqi': 'variant.duckXiangqi.name',
  jieqi: 'variant.jieqi.name',
  banqi: 'variant.banqi.name',
  jungle: 'variant.jungle.name',
  'jungle-flip': 'variant.jungleFlip.name',
  'mini-xiangqi': 'variant.miniXiangqi.name',
  'dark-mini-xiangqi': 'variant.darkMiniXiangqi.name',
  'drop-mini-xiangqi': 'variant.dropMiniXiangqi.name',
};

function variantPublicName(variant: string, locale: Locale): string {
  const key = VARIANT_NAME_KEYS[variant];
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

async function fetchAdminMetrics(): Promise<AdminMetrics | null> {
  try {
    const resp = await fetch('/api/stats/admin', { credentials: 'same-origin' });
    if (!resp.ok) return null;
    return (await resp.json()) as AdminMetrics;
  } catch {
    return null;
  }
}
