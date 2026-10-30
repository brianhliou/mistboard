import { t } from './i18n/catalog.js';
import { LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';

type PuzzleHistoryEntry = {
  puzzleId: string;
  variant: string;
  solved: boolean;
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  createdAt: string;
};

type PuzzleHistoryPage = {
  attempts: PuzzleHistoryEntry[];
  nextOffset: number | null;
};

type RatedEntry = PuzzleHistoryEntry & { ratingBefore: number; ratingAfter: number };
const HISTORY_PAGE_SIZE = 100;
const VISIBLE_RESULTS = 20;

// Called only for the viewer's own profile. The API selects the account from
// the session; there is deliberately no handle or account id in this request.
// Xiangqi is the public puzzle pool shown on profiles (Jungle is hidden there).
export function buildProfilePuzzleProgress(locale: Locale): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-puzzle-progress';
  const heading = document.createElement('h2');
  heading.textContent = t('profile.puzzleProgress', {}, locale);
  const privacy = document.createElement('p');
  privacy.className = 'profile-puzzle-history-note';
  privacy.textContent = t('profile.puzzleHistoryPrivate', {}, locale);
  const body = document.createElement('div');
  section.append(heading, privacy, body);

  async function load(): Promise<void> {
    body.replaceChildren();
    body.setAttribute('aria-busy', 'true');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = t('profile.loading', {}, locale);
    body.append(status);
    try {
      // The API is oldest-first. Follow every page before showing the graph so
      // an existing player never gets a misleading, truncated early timeline.
      const attempts: PuzzleHistoryEntry[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const query = new URLSearchParams({
          variant: 'xiangqi',
          limit: String(HISTORY_PAGE_SIZE),
          offset: String(offset),
        });
        const response = await fetch(`/api/puzzles/history?${query}`);
        if (!response.ok) throw new Error(`puzzle history failed: ${response.status}`);
        const page: PuzzleHistoryPage = await response.json();
        if (
          !Array.isArray(page.attempts) ||
          (page.nextOffset !== null &&
            (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset))
        ) {
          throw new Error('invalid puzzle history page');
        }
        attempts.push(...page.attempts);
        offset = page.nextOffset;
      }
      body.replaceChildren();
      if (attempts.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = t('profile.puzzleHistoryEmpty', {}, locale);
        const play = document.createElement('a');
        play.href = localizedHref('/puzzles', locale);
        play.textContent = t('nav.puzzles', {}, locale);
        body.append(empty, play);
      } else {
        body.append(buildPuzzleChart(attempts, locale), buildPuzzleResults(attempts, locale));
      }
    } catch {
      status.textContent = t('profile.puzzleHistoryFailed', {}, locale);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'profile-puzzle-history-retry';
      retry.textContent = t('profile.puzzleHistoryRetry', {}, locale);
      retry.addEventListener('click', () => void load());
      body.replaceChildren(status, retry);
    } finally {
      body.setAttribute('aria-busy', 'false');
    }
  }

  void load();
  return section;
}

function hasSavedRating(entry: PuzzleHistoryEntry): entry is RatedEntry {
  return (
    entry.ratingBefore !== null &&
    entry.ratingAfter !== null &&
    Number.isFinite(entry.ratingBefore) &&
    Number.isFinite(entry.ratingAfter)
  );
}

function historyDate(entry: PuzzleHistoryEntry, locale: Locale): string {
  return new Date(entry.createdAt).toLocaleString(LOCALE_META[locale].dateLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildPuzzleChart(attempts: PuzzleHistoryEntry[], locale: Locale): HTMLElement {
  const chart = document.createElement('div');
  chart.className = 'profile-puzzle-chart';
  const segments: RatedEntry[][] = [];
  let segment: RatedEntry[] = [];
  for (const entry of attempts) {
    if (!entry.rated) continue;
    if (!hasSavedRating(entry)) {
      segment = [];
      continue;
    }
    // A missing snapshot or a discontinuity starts a new segment. Never infer
    // the rating of an old result from today's aggregate or the next result.
    if (segment.at(-1)?.ratingAfter !== entry.ratingBefore) segment = [];
    if (segment.length === 0) segments.push(segment);
    segment.push(entry);
  }
  const points = segments.flat();
  if (points.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = t('profile.puzzleChartEmpty', {}, locale);
    chart.append(empty);
  } else {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 640 220');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('profile.puzzleProgress', {}, locale));
    const firstTime = Date.parse(points[0]!.createdAt);
    const lastTime = Date.parse(points.at(-1)!.createdAt);
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      low = Math.min(low, point.ratingBefore, point.ratingAfter);
      high = Math.max(high, point.ratingBefore, point.ratingAfter);
    }
    const padding = Math.max(20, (high - low) * 0.15);
    low = Math.floor((low - padding) / 10) * 10;
    high = Math.ceil((high + padding) / 10) * 10;
    const x = (entry: PuzzleHistoryEntry) =>
      firstTime === lastTime
        ? 340
        : 64 + ((Date.parse(entry.createdAt) - firstTime) / (lastTime - firstTime)) * 552;
    const y = (rating: number) => 188 - ((rating - low) / (high - low)) * 164;
    for (let i = 0; i <= 4; i += 1) {
      const rating = low + ((high - low) * i) / 4;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '64');
      line.setAttribute('x2', '616');
      line.setAttribute('y1', String(y(rating)));
      line.setAttribute('y2', String(y(rating)));
      line.setAttribute('class', 'profile-puzzle-chart-grid');
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', '54');
      label.setAttribute('y', String(y(rating) + 5));
      label.setAttribute('text-anchor', 'end');
      label.textContent = String(Math.round(rating));
      svg.append(line, label);
    }
    for (const entries of segments) {
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('class', 'profile-puzzle-chart-line');
      line.setAttribute(
        'points',
        [
          `${x(entries[0]!)},${y(entries[0]!.ratingBefore)}`,
          ...entries.map((entry) => `${x(entry)},${y(entry.ratingAfter)}`),
        ].join(' '),
      );
      svg.append(line);
    }
    for (const point of points) {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'profile-puzzle-chart-dot');
      dot.setAttribute('cx', String(x(point)));
      dot.setAttribute('cy', String(y(point.ratingAfter)));
      dot.setAttribute('r', '3');
      dot.setAttribute('data-rating', String(point.ratingAfter));
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${historyDate(point, locale)}: ${point.ratingBefore} → ${point.ratingAfter}`;
      dot.append(title);
      svg.append(dot);
    }
    const dates = document.createElement('div');
    dates.className = 'profile-puzzle-chart-dates';
    for (const point of [points[0]!, points.at(-1)!]) {
      const date = document.createElement('time');
      date.dateTime = point.createdAt;
      date.textContent = new Date(point.createdAt).toLocaleDateString(
        LOCALE_META[locale].dateLocale,
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        },
      );
      dates.append(date);
    }
    chart.append(svg, dates);
  }
  if (attempts.some((entry) => entry.rated && !hasSavedRating(entry))) {
    const note = document.createElement('p');
    note.className = 'profile-puzzle-history-note';
    note.textContent = t('profile.puzzleHistoryLegacy', {}, locale);
    chart.append(note);
  }
  return chart;
}

function buildPuzzleResults(attempts: PuzzleHistoryEntry[], locale: Locale): HTMLElement {
  const results = document.createElement('div');
  const heading = document.createElement('h3');
  heading.textContent = t('profile.puzzleHistory', {}, locale);
  const list = document.createElement('ol');
  list.className = 'profile-puzzle-history';
  const newestFirst = [...attempts].reverse();
  let shown = 0;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'profile-puzzle-history-more';
  more.textContent = t('profile.loadMore', {}, locale);

  function appendPage(): void {
    for (const entry of newestFirst.slice(shown, shown + VISIBLE_RESULTS)) {
      const row = document.createElement('li');
      row.className = 'profile-puzzle-history-row';
      const link = document.createElement('a');
      link.href = localizedHref(`/puzzles/${encodeURIComponent(entry.puzzleId)}`, locale);
      link.textContent = t(
        entry.solved ? 'puzzle.streakOutcomeSolved' : 'puzzle.streakOutcomeFailed',
        {},
        locale,
      );
      link.setAttribute('aria-label', `${link.textContent} · ${historyDate(entry, locale)}`);
      const date = document.createElement('time');
      date.dateTime = entry.createdAt;
      date.textContent = historyDate(entry, locale);
      const rating = document.createElement('span');
      rating.className = 'profile-puzzle-history-rating';
      if (!entry.rated) {
        rating.textContent = t('profile.unrated', {}, locale);
      } else if (!hasSavedRating(entry)) {
        rating.textContent = t('profile.puzzleRatingUnavailable', {}, locale);
      } else {
        const delta = entry.ratingAfter - entry.ratingBefore;
        rating.textContent = `${entry.ratingAfter} (${delta > 0 ? '+' : ''}${delta})`;
      }
      row.append(link, date, rating);
      list.append(row);
    }
    shown = list.children.length;
    if (shown >= newestFirst.length) more.remove();
  }

  more.addEventListener('click', appendPage);
  results.append(heading, list, more);
  appendPage();
  return results;
}
