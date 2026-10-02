// The profile Games tab's filters (lichess: the games filter): a result switch
// and an opponent search beside the rating rail's variant filter, all three
// held in the page URL (/@/handle?variant=jieqi&result=win&vs=bob).
//
// The server is the source of truth: the filters are query parameters of
// /api/users/:handle/games, because the list is paginated and a filter cannot
// be a narrowing of the page in hand.

import type { RatingVariant } from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';

export type ProfileGameResult = 'win' | 'loss' | 'draw';

export type ProfileGamesFilter = {
  variant: RatingVariant | null;
  result: ProfileGameResult | null;
  vs: string | null;
};

export const NO_PROFILE_GAMES_FILTER: ProfileGamesFilter = {
  variant: null,
  result: null,
  vs: null,
};

const RESULTS: readonly ProfileGameResult[] = ['win', 'loss', 'draw'];
const HANDLE = /^[a-zA-Z0-9_-]{1,40}$/;

export function hasProfileGamesFilter(filter: ProfileGamesFilter): boolean {
  return filter.variant !== null || filter.result !== null || filter.vs !== null;
}

/** The filter a profile URL holds. Anything malformed is dropped, never
 *  guessed at: `isVariant` is the rail's own list of pools. */
export function profileGamesFilterFromSearch(
  search: string,
  isVariant: (value: string) => value is RatingVariant,
): ProfileGamesFilter {
  const params = new URLSearchParams(search);
  const variant = params.get('variant') ?? '';
  const result = params.get('result') ?? '';
  const vs = (params.get('vs') ?? '').trim();
  return {
    variant: isVariant(variant) ? variant : null,
    result: (RESULTS as readonly string[]).includes(result) ? (result as ProfileGameResult) : null,
    vs: HANDLE.test(vs) ? vs : null,
  };
}

/** The query a filter adds to /api/users/:handle/games (and to the page URL). */
export function profileGamesFilterParams(filter: ProfileGamesFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.variant) params.set('variant', filter.variant);
  if (filter.result) params.set('result', filter.result);
  if (filter.vs) params.set('vs', filter.vs);
  return params;
}

/** The current page URL with the filter written in and nothing else changed. */
export function profileUrlWithFilter(href: string, filter: ProfileGamesFilter): string {
  const url = new URL(href);
  for (const key of ['variant', 'result', 'vs']) url.searchParams.delete(key);
  for (const [key, value] of profileGamesFilterParams(filter)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

const RESULT_LABEL: Record<ProfileGameResult | 'all', I18nKey> = {
  all: 'profile.filterAll',
  win: 'profile.filterWins',
  loss: 'profile.filterLosses',
  draw: 'profile.filterDraws',
};

export type ProfileGamesToolbar = {
  el: HTMLElement;
  /** Re-sync the controls after the filter changed elsewhere (the rail). */
  sync(filter: ProfileGamesFilter): void;
  /** Offer these handles as opponent suggestions. */
  suggestOpponents(handles: Iterable<string>): void;
};

/**
 * Result switch and opponent search, in one row above the list. `onChange` gets the whole next filter; the variant is carried
 * through untouched (the rail owns it).
 */
export function buildProfileGamesToolbar(opts: {
  handle: string;
  filter: ProfileGamesFilter;
  locale: Locale;
  onChange(next: ProfileGamesFilter): void;
}): ProfileGamesToolbar {
  const { locale } = opts;
  let filter = opts.filter;
  const bar = document.createElement('div');
  bar.className = 'profile-games-tools';

  const results = document.createElement('div');
  results.className = 'profile-games-results';
  results.setAttribute('role', 'group');
  results.setAttribute('aria-label', t('profile.filterResult', {}, locale));
  const resultButtons = new Map<ProfileGameResult | 'all', HTMLButtonElement>();
  for (const value of ['all', ...RESULTS] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-games-result';
    button.dataset.result = value;
    button.textContent = t(RESULT_LABEL[value], {}, locale);
    button.addEventListener('click', () => {
      const result = value === 'all' ? null : value;
      if (result === filter.result) return;
      opts.onChange({ ...filter, result });
    });
    resultButtons.set(value, button);
    results.append(button);
  }

  const opponent = document.createElement('form');
  opponent.className = 'profile-games-opponent';
  opponent.setAttribute('role', 'search');
  const opponentLabel = document.createElement('label');
  opponentLabel.className = 'profile-games-opponent-label';
  const opponentText = document.createElement('span');
  opponentText.textContent = t('profile.filterOpponent', {}, locale);
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'profile-games-opponent-input';
  input.placeholder = t('profile.filterOpponentPlaceholder', {}, locale);
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 40;
  const listId = `profile-opponents-${opts.handle}`;
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  opponentLabel.append(opponentText, input);
  opponent.append(opponentLabel, datalist);
  const applyOpponent = () => {
    const value = input.value.trim().replace(/^@/, '');
    const vs = HANDLE.test(value) ? value : null;
    if (vs?.toLowerCase() === filter.vs?.toLowerCase()) return;
    opts.onChange({ ...filter, vs });
  };
  opponent.addEventListener('submit', (event) => {
    event.preventDefault();
    applyOpponent();
  });
  // Picking a suggestion or clearing the field (the search input's own x)
  // applies at once; typing waits for Enter.
  input.addEventListener('change', applyOpponent);
  input.addEventListener('search', applyOpponent);

  bar.append(results, opponent);

  const sync = (next: ProfileGamesFilter) => {
    filter = next;
    for (const [value, button] of resultButtons) {
      button.setAttribute('aria-pressed', String((filter.result ?? 'all') === value));
    }
    if (document.activeElement !== input) input.value = filter.vs ?? '';
  };
  sync(filter);

  return {
    el: bar,
    sync,
    suggestOpponents(handles) {
      const known = new Set(Array.from(datalist.options, (option) => option.value.toLowerCase()));
      for (const handle of handles) {
        if (known.has(handle.toLowerCase())) continue;
        known.add(handle.toLowerCase());
        const option = document.createElement('option');
        option.value = handle;
        datalist.append(option);
      }
    },
  };
}
