// Homepage activity stats: durable game totals are the primary read because
// early live counts can legitimately sit at zero. Live presence still shows as
// a smaller now-line below the archive links, but only when it is nonzero: at
// Mistboard's liquidity "0 games in play" is true most hours of the day and
// reads as "nobody is here" to a visitor deciding whether to play. Absence is
// neutral; the 30-day count carries recency.
//
// Both come from /api/live-stats, which carries the totals from a 30-second
// server cache (site-counters.ts), and the block re-polls it every
// ACTIVITY_POLL_MS while the tab is visible, updating the numbers in place.
// A hidden tab stops polling and refreshes the moment it is shown again.
// Rows render only for data we actually have; a failed poll keeps the last
// values, and the block removes itself when the first read has nothing to show.

import { t } from './i18n/catalog.js';

// "N games in play" links to the current-games page (lichess does the same).
// The two agree by construction: /api/live-stats counts rooms by the deploy
// gate's in-play rule plus the active correspondence index, and /games lists
// exactly that set.
const CURRENT_GAMES_HREF = '/games';

export const ACTIVITY_POLL_MS = 15_000;

type Totals = { totalCompletedGames: number; last30dCompletedGames: number };
type Counters = { playing: number; totals: Totals | null };

export function buildLandingActivity(
  options: { hydrate?: boolean; pollMs?: number } = {},
): HTMLElement {
  const box = document.createElement('section');
  box.className = 'landing-activity';
  box.setAttribute('aria-label', t('home.activityAria'));
  const body = document.createElement('div');
  body.className = 'landing-activity-body';
  // No live-line placeholder: it would flash before hydrate on the (common)
  // zero case and then vanish.
  const primary = activityPrimary([activityMetric('–', t('home.gamesPlayed'), '/stats')]);
  body.append(primary);
  box.append(body);
  if (options.hydrate !== false) {
    void hydrateLandingActivity(box, body, primary, options.pollMs ?? ACTIVITY_POLL_MS);
  }
  return box;
}

// The durable total is the headline; the month count rides along in a
// parenthetical rather than as its own stat line. "this month" is the server's
// rolling 30-day window (persistence-site-stats.ts), so the label carries a
// title tooltip spelling that out.
function gamesPlayedLabel(monthCount: number): string {
  return t('home.gamesPlayedMonth', { count: formatCount(monthCount) });
}

async function hydrateLandingActivity(
  box: HTMLElement,
  body: HTMLElement,
  primary: HTMLElement,
  pollMs: number,
): Promise<void> {
  let hasTotals = false;
  let live: HTMLElement | null = null;

  const render = (counters: Counters | null): void => {
    if (counters?.totals) {
      const { totalCompletedGames, last30dCompletedGames } = counters.totals;
      const value = primary.querySelector('.landing-activity-value');
      const label = primary.querySelector('.landing-activity-label');
      if (value) value.textContent = formatCount(totalCompletedGames);
      if (label) {
        label.textContent = gamesPlayedLabel(last30dCompletedGames);
        label.setAttribute('title', t('home.gamesPlayedMonthTitle'));
      }
      if (!primary.isConnected) body.prepend(primary);
      hasTotals = true;
    } else if (!hasTotals) {
      // Never a placeholder dash beside a real live line.
      primary.remove();
    }
    if (!counters) return; // a failed poll keeps the live line it had
    if (counters.playing > 0) {
      const next = activityLiveLine([
        activityInlineStat(
          formatCount(counters.playing),
          t(counters.playing === 1 ? 'home.gameInPlay' : 'home.gamesInPlay'),
          CURRENT_GAMES_HREF,
        ),
      ]);
      if (live) live.replaceWith(next);
      else body.append(next);
      live = next;
    } else {
      live?.remove();
      live = null;
    }
  };

  render(await fetchCounters());
  if (!hasTotals && !live) {
    box.remove();
    return;
  }
  pollWhileVisible(box, async () => render(await fetchCounters()), pollMs);
}

// Re-run `tick` every `pollMs` while `box` is on the page and the tab is
// visible. A hidden tab schedules nothing; showing it again ticks at once.
// Everything tears down the first time a tick or a visibility change finds
// the block gone (the landing unmounted).
function pollWhileVisible(box: HTMLElement, tick: () => Promise<void>, pollMs: number): void {
  // A call, not an inline read: TypeScript would otherwise carry the narrowing
  // from the check before the await to the one after it.
  const hidden = (): boolean => document.visibilityState === 'hidden';
  let timer: number | null = null;
  let running = false;
  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const run = async (): Promise<void> => {
    timer = null;
    if (!box.isConnected) return stop();
    if (hidden() || running) return;
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
    if (!box.isConnected) return stop();
    if (!hidden()) timer = window.setTimeout(() => void run(), pollMs);
  };
  const onVisibility = (): void => {
    if (!box.isConnected) {
      stop();
      return;
    }
    if (hidden()) {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    } else if (timer === null && !running) {
      void run();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  timer = window.setTimeout(() => void run(), pollMs);
}

function activityPrimary(metrics: HTMLElement[]): HTMLElement {
  const primary = document.createElement('div');
  primary.className = 'landing-activity-primary';
  primary.append(...metrics);
  return primary;
}

function activityMetric(
  value: string,
  label: string,
  href?: string,
  labelTitle?: string,
): HTMLElement {
  const row = href ? document.createElement('a') : document.createElement('div');
  row.className = href
    ? 'landing-activity-metric landing-activity-link'
    : 'landing-activity-metric';
  if (href) row.setAttribute('href', href);
  const valueEl = document.createElement('strong');
  valueEl.className = 'landing-activity-value';
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'landing-activity-label';
  labelEl.textContent = label;
  if (labelTitle) labelEl.setAttribute('title', labelTitle);
  row.append(valueEl, labelEl);
  return row;
}

function activityLiveLine(stats: HTMLElement[]): HTMLElement {
  const line = document.createElement('div');
  line.className = 'landing-activity-live';
  line.append(...stats);
  return line;
}

function activityInlineStat(value: string, label: string, href?: string): HTMLElement {
  const stat = href ? document.createElement('a') : document.createElement('span');
  stat.className = 'landing-activity-inline-stat';
  if (href) stat.setAttribute('href', href);
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;
  stat.append(valueEl, ` ${label}`);
  return stat;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

async function fetchCounters(): Promise<Counters | null> {
  try {
    const resp = await fetch('/api/live-stats');
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      playing?: unknown;
      totalCompletedGames?: unknown;
      last30dCompletedGames?: unknown;
    };
    if (typeof data.playing !== 'number') return null;
    const totals =
      typeof data.totalCompletedGames === 'number' && typeof data.last30dCompletedGames === 'number'
        ? {
            totalCompletedGames: data.totalCompletedGames,
            last30dCompletedGames: data.last30dCompletedGames,
          }
        : null;
    return { playing: data.playing, totals };
  } catch {
    return null;
  }
}
