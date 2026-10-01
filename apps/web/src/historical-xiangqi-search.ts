// The site's game database (/games/search, lichess: "Advanced search"). The
// module name predates the variant picker: it was a xiangqi-only database until
// 2026-09, and the API still lives at /api/historical-xiangqi/games because
// other code and links use that path.
//
// Unfiltered it is a live feed of the most recently finished games across every
// launched variant, the archive and the broadcasts (issue #321: "Do not copy
// lichess here", lichess lands on an empty form). The rail on the left picks a
// variant, the form narrows further, and the URL is the whole state.
import './current-games.css';
import './seat-disc-ink.css';
import './historical-xiangqi-search.css';
import { maybeGameSpecForId, XIANGQI_SPEC_ID } from '@mistboard/game';
import { flipSeatInk, isFlipSeatVariant } from './flip-seat-ink.js';
import { colorWinsLabel, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { buildNav } from './site-shell.js';
import { buildUiIcon } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import { brandsBlackAsBlue, seatColorWord } from './variant-seat-label.js';
import { WATCH_CHANNEL_MINI_IDS } from './watch-channel-markers.js';

export type HistoricalXiangqiResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export type HistoricalXiangqiGameListItem = {
  id: string;
  kind: 'mistboard' | 'engine-match' | 'historical' | 'broadcast';
  // The row's game spec. Absent from older responses, which were xiangqi only.
  variant?: string;
  reviewUrl: string;
  sourceSlug: string;
  sourceName: string;
  sourceGameId: string | null;
  sourceUrl: string | null;
  eventName: string | null;
  eventNameEn?: string | null;
  site: string | null;
  round: string | null;
  roundNameEn?: string | null;
  board: string | null;
  playedOn: string | null;
  redNameRaw: string | null;
  redNameEn?: string | null;
  blackNameRaw: string | null;
  blackNameEn?: string | null;
  result: HistoricalXiangqiResult;
  plyCount: number;
  sortAt: string | null;
  moveFormat: string;
  // Flip variants only: the ink the first seat bound on the opening flip.
  firstColor?: 'red' | 'black' | null;
};

export type HistoricalXiangqiSearchResponse = {
  games: HistoricalXiangqiGameListItem[];
  total: number;
  offset: number;
  limit: number;
  // The launched variants this server searches, in the canonical shelf order.
  variants?: string[];
};

export type GamesSort = 'recent' | 'oldest' | 'longest' | 'shortest';

export type GamesSearchFilters = {
  sort: GamesSort;
  variant: string;
  player: string;
  event: string;
  source: string;
  result: string;
  from: string;
  to: string;
  plyMin: string;
  plyMax: string;
  offset: number;
  limit: number;
};

type Filters = GamesSearchFilters;

const DEFAULT_LIMIT = 50;
const SORTS: readonly GamesSort[] = ['recent', 'oldest', 'longest', 'shortest'];

function isGamesSort(value: string): value is GamesSort {
  return (SORTS as readonly string[]).includes(value);
}

// Variant first, so a shared link reads `?variant=jieqi&event=...`.
const STRING_FILTER_KEYS = [
  'variant',
  'player',
  'event',
  'source',
  'result',
  'from',
  'to',
  'plyMin',
  'plyMax',
] as const;

// Source values the server reads as a lane rather than an archive slug.
const SOURCE_MISTBOARD = 'mistboard';
const SOURCE_ENGINE_MATCH = 'engine-match';
const SOURCE_BROADCAST = 'broadcast';
const SOURCE_ARCHIVE = 'archive';
const LANE_SOURCES: ReadonlySet<string> = new Set([
  SOURCE_MISTBOARD,
  SOURCE_ENGINE_MATCH,
  SOURCE_BROADCAST,
  SOURCE_ARCHIVE,
]);

const EMPTY_FILTERS: Filters = {
  sort: 'recent',
  variant: '',
  player: '',
  event: '',
  source: '',
  result: '',
  from: '',
  to: '',
  plyMin: '',
  plyMax: '',
  offset: 0,
  limit: DEFAULT_LIMIT,
};

class InvalidVariantError extends Error {}

export async function mountHistoricalXiangqiSearch(root: HTMLElement): Promise<void> {
  root.classList.add('landing-page', 'historical-xiangqi-page');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section historical-xiangqi-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';

  // The /games rail, verbatim: the same anatomy picks a channel there and a
  // variant here, so the two pages read as one surface.
  const layout = document.createElement('div');
  layout.className = 'current-games-layout historical-xiangqi-layout';
  const rail = document.createElement('nav');
  rail.className = 'current-games-rail historical-xiangqi-rail';
  rail.setAttribute('aria-label', t('historical.variantRail'));
  const mainCol = document.createElement('div');
  mainCol.className = 'historical-xiangqi-main';

  const filtersHost = document.createElement('section');
  const summaryHost = document.createElement('section');
  const resultsHost = document.createElement('section');
  mainCol.append(filtersHost, summaryHost, resultsHost);
  layout.append(rail, mainCol);
  shell.append(heading, layout);
  root.append(shell);

  let filters = readFilters();
  // Known after the first response; until then the rail offers "All variants".
  let variants: readonly string[] = [];

  const render = (): void => {
    heading.textContent = filters.variant
      ? t('historical.variantHeading', { variant: variantDisplayLabel(filters.variant) })
      : t('historical.heading');
    document.title = `${heading.textContent} · Mistboard`;
    renderVariantRail(rail, variants, filters);
    filtersHost.replaceChildren(buildFilterForm(filters, applyFilters));
  };

  // Two quick rail clicks race their fetches; only the latest may render.
  let latestRun = 0;

  const run = async (): Promise<void> => {
    const thisRun = ++latestRun;
    writeFilters(filters);
    render();
    // Keep the previous results on screen, dimmed, until the new ones arrive:
    // emptying the list collapsed the page to the form and sprang it back on
    // every rail click. Only the very first load has nothing to keep.
    if (resultsHost.childElementCount === 0) {
      summaryHost.replaceChildren(statusLine(t('historical.loading')));
    }
    resultsHost.setAttribute('aria-busy', 'true');
    let data: HistoricalXiangqiSearchResponse;
    try {
      data = await fetchHistoricalXiangqiGames(filters);
    } catch (error) {
      if (thisRun !== latestRun) return;
      resultsHost.removeAttribute('aria-busy');
      // A stale or hand-edited ?variant= (a retired variant, a typo): the server
      // refuses it rather than guessing, so fall back to every variant.
      if (error instanceof InvalidVariantError && filters.variant) {
        filters = { ...filters, variant: '', offset: 0 };
        await run();
        return;
      }
      summaryHost.replaceChildren(statusLine(t('historical.searchFailed')));
      resultsHost.replaceChildren();
      return;
    }
    if (thisRun !== latestRun) return;
    if (data.variants) {
      variants = data.variants;
      renderVariantRail(rail, variants, filters);
    }
    summaryHost.replaceChildren(totalLine(data.total));
    resultsHost.replaceChildren(buildResults(data, applyFilters));
    resultsHost.removeAttribute('aria-busy');
  };

  function applyFilters(next: Filters): void {
    filters = next;
    void run();
  }

  // Rail entries are real links (shareable, middle-clickable); a plain click
  // re-runs the search in place.
  rail.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-variant]');
    if (!link) return;
    event.preventDefault();
    applyFilters(withVariant(filters, link.dataset.variant ?? ''));
  });

  await run();
}

export function historicalXiangqiReviewUrl(id: string): string {
  return `/historical-xiangqi/game/${encodeURIComponent(id)}`;
}

function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of STRING_FILTER_KEYS) {
    const value = (filters[key] ?? '').trim();
    if (value) params.set(key, value);
  }
  if (filters.sort !== 'recent') params.set('sort', filters.sort);
  if (filters.offset > 0) params.set('offset', String(filters.offset));
  return params;
}

export function historicalXiangqiSearchApiUrl(filters: Filters): string {
  const params = filterParams(filters);
  params.set('limit', String(filters.limit));
  return `/api/historical-xiangqi/games?${params.toString()}`;
}

/** The page URL for a set of filters: the canonical path plus only what differs
 *  from the defaults, so a plain /games/search link stays canonical. */
export function gamesSearchPageUrl(filters: Filters): string {
  const params = filterParams(filters);
  if (filters.limit !== DEFAULT_LIMIT) params.set('limit', String(filters.limit));
  const query = params.toString();
  // Write the canonical path. `/historical-xiangqi/games` is retired: the server
  // 301s it back here and isClientRoute rejects it, so rewriting the bar to it
  // meant a filtered URL survived neither a copy-paste nor a reload.
  return query ? `${SEARCH_PATH}?${query}` : SEARCH_PATH;
}

async function fetchHistoricalXiangqiGames(
  filters: Filters,
): Promise<HistoricalXiangqiSearchResponse> {
  const response = await fetch(historicalXiangqiSearchApiUrl(filters), {
    headers: { accept: 'application/json' },
  });
  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'invalid_variant') throw new InvalidVariantError('invalid_variant');
  }
  if (!response.ok) throw new Error(`historical_xiangqi_search_failed_${response.status}`);
  return (await response.json()) as HistoricalXiangqiSearchResponse;
}

// The canonical route for this page (lichess: /games/search). It sat at /games
// until 2026-09-02, when /games became the current-games page; the server 301s
// `/historical-xiangqi`, `/historical-xiangqi/games`, and any `/games?<filter>`
// link here.
const SEARCH_PATH = '/games/search';

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const str = (key: string): string => params.get(key) ?? '';
  const offset = Number.parseInt(params.get('offset') ?? '', 10);
  const limit = Number.parseInt(params.get('limit') ?? '', 10);
  const sort = str('sort');
  return {
    sort: isGamesSort(sort) ? sort : 'recent',
    variant: str('variant').trim(),
    player: str('player'),
    event: str('event'),
    source: str('source'),
    result: str('result'),
    from: str('from'),
    to: str('to'),
    plyMin: str('plyMin'),
    plyMax: str('plyMax'),
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT,
  };
}

function writeFilters(filters: Filters): void {
  window.history.replaceState(null, '', gamesSearchPageUrl(filters));
}

/** Broadcasts and the archive are xiangqi only; every other source spans variants. */
function sourceFitsVariant(source: string, variant: string): boolean {
  if (!variant || variant === XIANGQI_SPEC_ID) return true;
  return source === '' || source === SOURCE_MISTBOARD || source === SOURCE_ENGINE_MATCH;
}

/** The filters with another variant picked: back to the first page, and a
 *  source the new variant cannot have (a broadcast for jieqi) is dropped
 *  rather than left to return nothing. */
export function withVariant(filters: Filters, variant: string): Filters {
  return {
    ...filters,
    variant,
    offset: 0,
    source: sourceFitsVariant(filters.source, variant) ? filters.source : '',
  };
}

function renderVariantRail(rail: HTMLElement, variants: readonly string[], filters: Filters): void {
  // A rail click changes only which entry is active and where each link
  // points; rebuilding every entry (icons included) on each click made the
  // rail flash. Rebuild only when the set of entries itself changes.
  const wanted = ['', ...railVariants(variants, filters)];
  const current = Array.from(rail.querySelectorAll<HTMLAnchorElement>('a[data-variant]'));
  if (
    current.length === wanted.length &&
    current.every((link, index) => link.dataset.variant === wanted[index])
  ) {
    for (const link of current) {
      const variant = link.dataset.variant ?? '';
      link.href = gamesSearchPageUrl(withVariant(filters, variant));
      const active = variant === filters.variant;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    return;
  }
  const all = variantRailLink(filters, '', t('historical.allVariants'));
  all
    .querySelector('.current-games-rail-thumb')
    ?.append(buildUiIcon('featured-channel', 'current-games-rail-crown'));
  const links = [all];
  for (const variant of railVariants(variants, filters)) {
    const label = variantDisplayLabel(variant);
    const link = variantRailLink(filters, variant, label);
    const miniId = WATCH_CHANNEL_MINI_IDS[variant];
    const thumb = link.querySelector<HTMLElement>('.current-games-rail-thumb');
    if (thumb && miniId) {
      thumb.classList.add('notranslate');
      thumb.setAttribute('translate', 'no');
      thumb.innerHTML = renderVariantMarker(miniId, { size: 112, label: `${label} marker` });
    }
    links.push(link);
  }
  rail.replaceChildren(...links);
}

// The selected variant stays in the rail even before (or without) the list,
// so the page never hides what it is filtered to.
function railVariants(variants: readonly string[], filters: Filters): readonly string[] {
  return filters.variant && !variants.includes(filters.variant)
    ? [...variants, filters.variant]
    : variants;
}

function variantRailLink(filters: Filters, variant: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'current-games-rail-link';
  link.dataset.variant = variant;
  link.href = gamesSearchPageUrl(withVariant(filters, variant));
  const text = document.createElement('span');
  text.className = 'current-games-rail-text';
  const name = document.createElement('span');
  name.className = 'current-games-rail-name';
  name.textContent = label;
  text.append(name);
  const thumb = document.createElement('span');
  thumb.className = 'current-games-rail-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  link.append(text, thumb);
  if (variant === filters.variant) {
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  }
  return link;
}

function buildFilterForm(filters: Filters, onApply: (next: Filters) => void): HTMLElement {
  const form = document.createElement('form');
  form.className = 'historical-xiangqi-filters';

  const inputs = new Map<keyof Filters, HTMLInputElement>();
  const selects = new Map<keyof Filters, HTMLSelectElement>();

  const addText = (key: keyof Filters, label: string, placeholder: string): void => {
    const field = textInput(label, placeholder, String(filters[key]));
    inputs.set(key, field.input);
    form.append(field.field);
  };
  addText('player', t('historical.playerLabel'), t('historical.playerPlaceholder'));
  addText('event', t('historical.eventLabel'), t('historical.eventPlaceholder'));

  const source = selectInput(
    t('historical.sourceLabel'),
    sourceOptions(filters.variant, filters.source),
    filters.source,
  );
  selects.set('source', source.select);
  form.append(source.field);

  const result = selectInput(
    t('historical.resultLabel'),
    resultOptions(filters.variant),
    filters.result,
  );
  selects.set('result', result.select);
  form.append(result.field);

  const from = dateInput(t('historical.fromLabel'), filters.from);
  inputs.set('from', from.input);
  form.append(from.field);
  const to = dateInput(t('historical.toLabel'), filters.to);
  inputs.set('to', to.input);
  form.append(to.field);
  const plyMin = numberInput(t('historical.minPlies'), filters.plyMin);
  inputs.set('plyMin', plyMin.input);
  form.append(plyMin.field);
  const plyMax = numberInput(t('historical.maxPlies'), filters.plyMax);
  inputs.set('plyMax', plyMax.input);
  form.append(plyMax.field);

  const sortField = selectInput(
    t('historical.sortLabel'),
    [
      { value: 'recent', label: t('historical.sortRecent') },
      { value: 'oldest', label: t('historical.sortOldest') },
      { value: 'longest', label: t('historical.sortLongest') },
      { value: 'shortest', label: t('historical.sortShortest') },
    ],
    filters.sort,
  );
  selects.set('sort', sortField.select);
  form.append(sortField.field);

  const limit = selectInput(
    t('historical.rowsLabel'),
    [
      { value: '25', label: '25' },
      { value: '50', label: '50' },
      { value: '100', label: '100' },
      { value: '200', label: '200' },
    ],
    String(filters.limit),
  );
  selects.set('limit', limit.select);
  form.append(limit.field);

  const actions = document.createElement('div');
  actions.className = 'historical-xiangqi-actions';
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'historical-xiangqi-btn historical-xiangqi-btn-primary';
  apply.textContent = t('historical.search');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'historical-xiangqi-btn';
  reset.textContent = t('historical.reset');
  actions.append(apply, reset);
  form.append(actions);

  const collect = (offset: number): Filters => {
    const next: Filters = { ...filters, offset };
    for (const [key, input] of inputs) (next[key] as string) = input.value.trim();
    for (const [key, select] of selects) {
      if (key === 'limit') next.limit = Number.parseInt(select.value, 10);
      else if (key === 'sort') next.sort = isGamesSort(select.value) ? select.value : 'recent';
      else (next[key] as string) = select.value;
    }
    return next;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onApply(collect(0));
  });
  // Reset clears the form, not the variant: the rail is where that is chosen.
  reset.addEventListener('click', () => {
    onApply({ ...EMPTY_FILTERS, variant: filters.variant });
  });
  return form;
}

function sourceOptions(variant: string, current: string): { value: string; label: string }[] {
  const options = [
    { value: '', label: t('historical.anySource') },
    { value: SOURCE_MISTBOARD, label: t('historical.sourcePlayedHere') },
    { value: SOURCE_ENGINE_MATCH, label: t('historical.sourceEngineMatches') },
  ];
  if (sourceFitsVariant(SOURCE_BROADCAST, variant)) {
    options.push(
      { value: SOURCE_BROADCAST, label: t('historical.sourceBroadcasts') },
      { value: SOURCE_ARCHIVE, label: t('historical.sourceArchive') },
    );
    // A link naming one archive source by slug (?source=xqbase) keeps it.
    if (current && !LANE_SOURCES.has(current)) options.push({ value: current, label: current });
  }
  return options;
}

// Result options in the picked variant's own colours. With no variant, or a
// flip variant whose colours bind per game, the seats are named by move order.
function resultOptions(variant: string): { value: string; label: string }[] {
  const seatWords = variant && !isFlipSeatVariant(variant) ? fixedSeatColors(variant) : null;
  return [
    { value: '', label: t('historical.anyResult') },
    {
      value: '1-0',
      label: seatWords
        ? colorWinsLabel(seatColorWord(variant, seatWords.first))
        : t('historical.firstWins'),
    },
    {
      value: '0-1',
      label: seatWords
        ? colorWinsLabel(seatColorWord(variant, seatWords.second))
        : t('historical.secondWins'),
    },
    { value: '1/2-1/2', label: t('historical.draw') },
    { value: '*', label: t('historical.unfinished') },
  ];
}

/** The stored colours of a fixed-colour variant's two seats: chess plays White
 *  first, every other family Red. The second seat is stored as black even where
 *  the product brands it Blue (seatColorWord renders that). */
function fixedSeatColors(variant: string): { first: 'white' | 'red'; second: 'black' } {
  const family = maybeGameSpecForId(variant)?.family;
  return { first: family === 'chess' ? 'white' : 'red', second: 'black' };
}

export type ResultTone = 'red' | 'black' | 'white' | 'blue' | 'draw' | 'neutral';

/** The result chip for a row: the winner's colour word and the ink to paint it
 *  in, in the row's own variant (Red/Black, White/Black, Red/Blue; a flip
 *  variant through the ink its first seat bound on the opening flip). */
export function resultChip(game: HistoricalXiangqiGameListItem): {
  label: string;
  tone: ResultTone;
} {
  if (game.result === '1/2-1/2') return { label: t('historical.draw'), tone: 'draw' };
  if (game.result === '*') return { label: '*', tone: 'neutral' };
  const firstSeat = game.result === '1-0';
  const variant = game.variant ?? XIANGQI_SPEC_ID;
  let color: 'red' | 'black' | 'white';
  if (isFlipSeatVariant(variant)) {
    const ink = flipSeatInk(firstSeat ? 'red' : 'black', game.firstColor ?? null);
    if (ink === null) {
      return { label: firstSeat ? t('setup.first') : t('setup.second'), tone: 'neutral' };
    }
    color = ink;
  } else {
    const seats = fixedSeatColors(variant);
    color = firstSeat ? seats.first : seats.second;
  }
  const tone: ResultTone = color === 'black' && brandsBlackAsBlue(variant) ? 'blue' : color;
  return { label: seatColorWord(variant, color), tone };
}

function buildResults(
  data: HistoricalXiangqiSearchResponse,
  onApply: (next: Filters) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  if (data.games.length === 0) {
    wrap.append(statusLine(t('historical.noGamesMatch')));
    return wrap;
  }
  const list = document.createElement('div');
  list.className = 'historical-xiangqi-results';
  for (const game of data.games) list.append(gameRow(game));
  wrap.append(list);
  const pager = buildPager(data, onApply);
  if (pager) wrap.append(pager);
  return wrap;
}

function gameRow(game: HistoricalXiangqiGameListItem): HTMLElement {
  const link = document.createElement('a');
  link.className = 'historical-xiangqi-row';
  link.href = game.reviewUrl;

  const chip = resultChip(game);
  const result = document.createElement('span');
  result.className = `historical-xiangqi-result historical-xiangqi-result-${chip.tone}`;
  result.textContent = chip.label;
  link.append(result);

  const body = document.createElement('div');
  body.className = 'historical-xiangqi-row-main';
  const matchup = document.createElement('div');
  matchup.className = 'historical-xiangqi-matchup';
  const variant = game.variant ?? XIANGQI_SPEC_ID;
  const firstName = resultlessSeatName(variant, 'first');
  const secondName = resultlessSeatName(variant, 'second');
  // English primary; the original Chinese follows as a muted inline secondary
  // when a cached translation exists.
  const matchupEn = t('historical.matchup', {
    red: game.redNameEn ?? game.redNameRaw ?? firstName,
    black: game.blackNameEn ?? game.blackNameRaw ?? secondName,
  });
  const matchupRaw = t('historical.matchup', {
    red: game.redNameRaw ?? firstName,
    black: game.blackNameRaw ?? secondName,
  });
  matchup.textContent = matchupEn;
  if ((game.redNameEn || game.blackNameEn) && matchupRaw !== matchupEn) {
    const zh = document.createElement('span');
    zh.className = 'historical-xiangqi-zh';
    zh.textContent = matchupRaw;
    matchup.append(' ', zh);
  }
  body.append(matchup);
  const meta = document.createElement('div');
  meta.className = 'historical-xiangqi-meta';
  const variantPill = pill(variantDisplayLabel(variant));
  variantPill.classList.add('historical-xiangqi-pill-variant');
  meta.append(
    variantPill,
    pill(gameKindLabel(game.kind)),
    pill(formatDate(game.playedOn)),
    pill(t('historical.plies', { count: game.plyCount })),
  );
  // The archive's own name (XQBase, ElephantChess) says where the game came from.
  if (game.kind === 'historical' && game.sourceName) meta.append(pill(game.sourceName));
  body.append(meta);
  link.append(body);

  const event = document.createElement('div');
  event.className = 'historical-xiangqi-event';
  event.textContent = eventLine(game);
  const eventZh = eventLineZh(game);
  if (eventZh) {
    const zh = document.createElement('span');
    zh.className = 'historical-xiangqi-zh';
    zh.textContent = eventZh;
    event.append(' ', zh);
  }
  link.append(event);

  const review = document.createElement('span');
  review.className = 'historical-xiangqi-review-link';
  review.textContent = t('historical.review');
  link.append(review);
  return link;
}

// A seat's colour word for a row with no stored name.
function resultlessSeatName(variant: string, seat: 'first' | 'second'): string {
  if (isFlipSeatVariant(variant)) return seat === 'first' ? t('setup.first') : t('setup.second');
  const seats = fixedSeatColors(variant);
  return seatColorWord(variant, seat === 'first' ? seats.first : seats.second);
}

function buildPager(
  data: HistoricalXiangqiSearchResponse,
  onApply: (next: Filters) => void,
): HTMLElement | null {
  const { offset, limit, total } = data;
  if (total <= limit && offset === 0) return null;
  const pager = document.createElement('div');
  pager.className = 'historical-xiangqi-pager';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'historical-xiangqi-btn';
  prev.textContent = t('historical.prev');
  prev.disabled = offset <= 0;
  prev.addEventListener('click', () => {
    onApply({ ...readFilters(), offset: Math.max(0, offset - limit), limit });
  });

  const status = document.createElement('span');
  status.className = 'historical-xiangqi-pager-status';
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  status.textContent = `${start}-${end} of ${total.toLocaleString()}`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'historical-xiangqi-btn';
  next.textContent = t('historical.next');
  next.disabled = offset + limit >= total;
  next.addEventListener('click', () => {
    onApply({ ...readFilters(), offset: offset + limit, limit });
  });

  pager.append(prev, status, next);
  return pager;
}

function textInput(
  label: string,
  placeholder: string,
  value: string,
): { field: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'historical-xiangqi-input';
  input.placeholder = placeholder;
  input.value = value;
  return fieldFor(label, input);
}

function numberInput(
  label: string,
  value: string,
): { field: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.className = 'historical-xiangqi-input';
  input.value = value;
  return fieldFor(label, input);
}

function dateInput(label: string, value: string): { field: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'historical-xiangqi-input';
  input.value = value;
  return fieldFor(label, input);
}

function selectInput(
  label: string,
  options: { value: string; label: string }[],
  selected: string,
): { field: HTMLElement; select: HTMLSelectElement } {
  const select = document.createElement('select');
  select.className = 'historical-xiangqi-select';
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    select.append(item);
  }
  // Assign through the select, not by setting `selected` on each option before
  // appending it. Appending an option re-runs the selectedness reset, which
  // discards a flag set while the option was still detached for anything past
  // the second position: `?result=0-1`, `1/2-1/2` and `*` all rendered as the
  // "Red wins" row while the results below them were correctly filtered.
  select.value = selected;
  const { field } = fieldFor(label, select);
  return { field, select };
}

function fieldFor<T extends HTMLInputElement | HTMLSelectElement>(
  label: string,
  control: T,
): { field: HTMLElement; input: T } {
  const field = document.createElement('label');
  field.className = 'historical-xiangqi-field';
  const text = document.createElement('span');
  text.className = 'historical-xiangqi-field-label';
  text.textContent = label;
  field.append(text, control);
  return { field, input: control };
}

function pill(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'historical-xiangqi-pill';
  el.textContent = text;
  return el;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'historical-xiangqi-status';
  p.textContent = text;
  return p;
}

function totalLine(total: number): HTMLElement {
  const p = document.createElement('p');
  p.className = 'historical-xiangqi-total';
  p.textContent =
    total === 1
      ? t('historical.oneGameFound')
      : t('historical.gamesFound', { count: total.toLocaleString() });
  return p;
}

export function historicalXiangqiResultLabel(result: HistoricalXiangqiResult): string {
  if (result === '1-0') return t('setup.red');
  if (result === '0-1') return t('setup.black');
  if (result === '1/2-1/2') return t('historical.draw');
  return '*';
}

export function historicalXiangqiOutcomeLabel(result: HistoricalXiangqiResult): string {
  if (result === '1-0') return t('historical.redWins');
  if (result === '0-1') return t('historical.blackWins');
  if (result === '1/2-1/2') return t('historical.draw');
  return t('historical.unfinished');
}

function gameKindLabel(kind: HistoricalXiangqiGameListItem['kind']): string {
  if (kind === 'mistboard') return t('historical.sourceMistboard');
  if (kind === 'engine-match') return t('historical.sourceEngineMatch');
  if (kind === 'broadcast') return t('historical.sourceBroadcast');
  return t('historical.sourceArchive');
}

/** A round as shown: a bare number becomes "Round 5"; a stored label ("Round 5",
 *  "第5轮", "Final") is already one and is shown as it is. */
export function roundLabel(round: string | null | undefined): string | null {
  const value = round?.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? t('historical.round', { round: value }) : value;
}

export function eventLine(game: HistoricalXiangqiGameListItem): string {
  const roundPart = roundLabel(game.roundNameEn ?? game.round);
  const parts = [game.eventNameEn ?? game.eventName, roundPart, game.site].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  // A game played here has no event to name, and its room id is not one.
  if (game.kind === 'mistboard' || game.kind === 'engine-match') return '';
  if (game.sourceGameId) return `Source game ${game.sourceGameId}`;
  return 'No event metadata';
}

// The original Chinese event/round line, shown as a secondary span whenever a
// cached translation replaced it in the primary line.
function eventLineZh(game: HistoricalXiangqiGameListItem): string | null {
  if (!game.eventNameEn && !game.roundNameEn) return null;
  const parts = [
    game.eventNameEn && game.eventNameEn !== game.eventName ? game.eventName : null,
    game.roundNameEn && game.roundNameEn !== game.round ? game.round : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatDate(value: string | null): string {
  if (!value) return t('historical.unknownDate');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
