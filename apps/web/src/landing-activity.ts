// Homepage activity stats: durable game totals from /api/stats/public are the
// primary read because early live counts can legitimately sit at zero. Live
// presence still hydrates as a smaller now-line below the archive links, but
// only when it is nonzero: at Mistboard's liquidity "0 games in play" is true
// most hours of the day and reads as "nobody is here" to a visitor deciding
// whether to play. Absence is neutral; the 30-day count carries recency.
// Either source can be missing (stats/public needs persistence; live-stats
// needs the API up): rows render only for data we actually have, and the block
// removes itself when nothing is left to show.

import { t } from './i18n/catalog.js';

// "N games in play" links to the current-games page (lichess does the same).
// The two agree by construction: /api/live-stats counts rooms by the deploy
// gate's in-play rule plus the active correspondence index, and /games lists
// exactly that set.
const CURRENT_GAMES_HREF = '/games';

type LiveStats = { playing: number; online: number };
type PublicStats = { totalCompletedGames: number; last30dCompletedGames: number };

export function buildLandingActivity(options: { hydrate?: boolean } = {}): HTMLElement {
  const box = document.createElement('section');
  box.className = 'landing-activity';
  box.setAttribute('aria-label', t('home.activityAria'));
  const body = document.createElement('div');
  body.className = 'landing-activity-body';
  // No live-line placeholder: it would flash before hydrate on the (common)
  // zero case and then vanish.
  body.append(activityPrimary([activityMetric('–', t('home.gamesPlayed'), '/stats')]));
  box.append(body);
  if (options.hydrate !== false) void hydrateLandingActivity(box, body);
  return box;
}

// The durable total is the headline; the month count rides along in a
// parenthetical rather than as its own stat line. "this month" is the server's
// rolling 30-day window (persistence-site-stats.ts), so the label carries a
// title tooltip spelling that out.
function gamesPlayedLabel(monthCount: number): string {
  return t('home.gamesPlayedMonth', { count: formatCount(monthCount) });
}

async function hydrateLandingActivity(box: HTMLElement, body: HTMLElement): Promise<void> {
  const [live, totals] = await Promise.all([fetchLiveStats(), fetchPublicStats()]);

  const parts: HTMLElement[] = [];
  if (totals) {
    parts.push(
      activityPrimary([
        activityMetric(
          formatCount(totals.totalCompletedGames),
          gamesPlayedLabel(totals.last30dCompletedGames),
          '/stats',
          t('home.gamesPlayedMonthTitle'),
        ),
      ]),
    );
  }
  if (live && live.playing > 0) {
    parts.push(
      activityLiveLine([
        activityInlineStat(
          formatCount(live.playing),
          t(live.playing === 1 ? 'home.gameInPlay' : 'home.gamesInPlay'),
          CURRENT_GAMES_HREF,
        ),
      ]),
    );
  }
  if (parts.length === 0) {
    box.remove();
    return;
  }
  body.replaceChildren(...parts);
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

async function fetchPublicStats(): Promise<PublicStats | null> {
  try {
    const resp = await fetch('/api/stats/public');
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<PublicStats>;
    if (
      typeof data.totalCompletedGames !== 'number' ||
      typeof data.last30dCompletedGames !== 'number'
    ) {
      return null;
    }
    return {
      totalCompletedGames: data.totalCompletedGames,
      last30dCompletedGames: data.last30dCompletedGames,
    };
  } catch {
    return null;
  }
}
