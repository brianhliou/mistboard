import { type PuzzleDashboardResults, puzzleDashboardMetrics } from '@mistboard/game';
import './dashboard.css';
import { loadCachedCurrentUser } from '../account-nav.js';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { type I18nKey, t } from '../i18n/catalog.js';
import { buildNav } from '../site-shell.js';
import { renderPuzzleMenuLayout } from './puzzle-menu.js';

const DAY_CHOICES = ['1', '2', '3', '7', '10', '14', '21', '30', '60', '90'];

export async function mountPuzzleDashboard(root: HTMLElement): Promise<void> {
  const main = document.createElement('main');
  main.className = 'puzzle-dashboard';
  const header = document.createElement('header');
  header.className = 'puzzle-dashboard__header';
  const heading = document.createElement('div');
  const title = document.createElement('h1');
  title.textContent = t('puzzle.dashboardTitle');
  const subtitle = document.createElement('p');
  subtitle.textContent = t('puzzle.dashboardSubtitle');
  heading.append(title, subtitle);

  const url = new URL(window.location.href);
  const requested = url.searchParams.get('days') ?? '30';
  let days = DAY_CHOICES.includes(requested) ? requested : '30';
  const select = document.createElement('select');
  for (const value of DAY_CHOICES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent =
      value === '1' ? t('puzzle.dashboardDay') : t('puzzle.dashboardDays', { n: value });
    select.append(option);
  }
  select.value = days;
  select.setAttribute('aria-label', t('puzzle.dashboardDays', { n: days }));
  select.disabled = true;
  header.append(heading, select);
  const content = document.createElement('div');
  content.className = 'puzzle-dashboard__content';
  content.setAttribute('aria-live', 'polite');
  content.textContent = t('puzzle.loading');
  main.append(header, content);
  root.replaceChildren(buildNav(), renderPuzzleMenuLayout('dashboard', main));

  const signIn = () => {
    select.disabled = true;
    const link = document.createElement('a');
    link.href = loginHrefForCurrentPage();
    link.textContent = t('puzzle.dashboardSignIn');
    content.replaceChildren(message(link));
  };
  if (!(await loadCachedCurrentUser())) {
    signIn();
    return;
  }

  // A late response from an earlier selection must never replace the current window.
  let request = 0;
  const load = async () => {
    const current = ++request;
    const selectedDays = days;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('days', selectedDays);
    window.history.replaceState(null, '', nextUrl);
    content.textContent = t('puzzle.loading');
    content.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/api/puzzles/dashboard?days=${selectedDays}`, {
        credentials: 'same-origin',
      });
      if (current !== request) return;
      if (response.status === 401) {
        signIn();
        return;
      }
      if (!response.ok) throw new Error(`Puzzle dashboard: ${response.status}`);
      const results = (await response.json()) as PuzzleDashboardResults;
      if (current !== request) return;
      content.replaceChildren(renderResults(results, selectedDays));
    } catch {
      if (current !== request) return;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = t('puzzle.statusTryAgain');
      retry.addEventListener('click', () => void load());
      const error = message(retry);
      error.prepend(t('stats.unavailableBody'), ' ');
      content.replaceChildren(error);
    } finally {
      if (current === request) content.removeAttribute('aria-busy');
    }
  };
  select.disabled = false;
  select.addEventListener('change', () => {
    days = select.value;
    select.setAttribute('aria-label', t('puzzle.dashboardDays', { n: days }));
    void load();
  });
  await load();
}

function message(child: HTMLElement): HTMLElement {
  const block = document.createElement('p');
  block.className = 'puzzle-dashboard__message';
  block.append(child);
  return block;
}

function tile(kind: string, value: string, labelKey: I18nKey, href?: string): HTMLElement {
  const block = document.createElement(href ? 'a' : 'div');
  block.className = `puzzle-dashboard__tile puzzle-dashboard__tile--${kind}`;
  block.dataset.metric = kind;
  if (block instanceof HTMLAnchorElement && href) block.href = href;
  const number = document.createElement('strong');
  number.textContent = value;
  const label = document.createElement('span');
  label.textContent = t(labelKey);
  block.append(number, label);
  return block;
}

function renderResults(results: PuzzleDashboardResults, days: string): HTMLElement {
  if (results.nb === 0) {
    const link = document.createElement('a');
    link.href = '/puzzles';
    link.textContent = t('puzzle.dashboardEmpty');
    return message(link);
  }
  const metrics = puzzleDashboardMetrics(results);
  const tiles = document.createElement('div');
  tiles.className = 'puzzle-dashboard__tiles';
  const solvedPercent = Math.round((results.wins * 100) / results.nb);
  const solved = tile('solved', `${solvedPercent}%`, 'puzzle.dashboardSolved');
  solved.style.backgroundImage = `linear-gradient(to right, var(--dashboard-solved) ${solvedPercent}%, var(--dashboard-failed) ${solvedPercent}%)`;
  tiles.append(
    tile('played', String(results.nb), 'puzzle.dashboardPlayed'),
    tile(
      'performance',
      metrics.performance === null ? '?' : `${metrics.performance}${metrics.clear ? '' : '?'}`,
      'puzzle.dashboardPerformance',
    ),
    solved,
  );
  if (metrics.unfixed > 0) {
    const replay = tile(
      'replay',
      String(metrics.unfixed),
      'puzzle.dashboardToReplay',
      `/puzzles/replay?days=${days}`,
    );
    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.setAttribute('aria-hidden', 'true');
    replay.querySelector('strong')!.prepend(arrow, ' ');
    tiles.append(replay);
  }
  return tiles;
}
