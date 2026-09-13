// Unlisted admin game browser (/database). A faceted, shareable alternative to
// poking the production Postgres with SQL: filter completed games, read a live
// win-rate / termination / length summary for the current slice, and click
// through to the variant's review route. Admin-gated by the
// /api/admin/games/query endpoint (open in local dev). No nav entry.
import './database.css';
import { findTimeControl } from '@mistboard/game';
import {
  type FeaturedGame,
  matchupLabel,
  sourceLabel,
  variantDisplayLabel,
} from './game-display.js';
import { buildNav } from './site-shell.js';
import { webVariantTenantForRoomId } from './variant-tenant/registry.js';

type GameRow = FeaturedGame & {
  initialMs?: number | null;
  incrementMs?: number | null;
  endedAt?: string;
};

type Aggregates = {
  total: number;
  results: { whiteWins: number; blackWins: number; redWins: number; draws: number };
  terminations: { termination: string; count: number }[];
  plyCount: { avg: number | null; min: number | null; max: number | null };
};

type Facets = {
  variants: string[];
  modes: string[];
  terminations: string[];
  results: string[];
};

type QueryResponse = {
  games: GameRow[];
  total: number;
  aggregates: Aggregates;
  facets: Facets;
  offset: number;
  limit: number;
};

type Filters = {
  variant: string;
  mode: string;
  result: string;
  termination: string;
  rated: string;
  timeClass: string;
  plyMin: string;
  plyMax: string;
  from: string;
  to: string;
  offset: number;
  limit: number;
};

const DEFAULT_LIMIT = 50;

// Filter keys that map 1:1 to a string query param. offset/limit are handled
// separately (numeric, with defaults).
const STRING_FILTER_KEYS = [
  'variant',
  'mode',
  'result',
  'termination',
  'rated',
  'timeClass',
  'plyMin',
  'plyMax',
  'from',
  'to',
] as const;

export async function mountDatabase(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('database-page');

  const shell = document.createElement('main');
  shell.className = 'site-section database-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Game database';

  const sub = document.createElement('p');
  sub.className = 'database-sub';
  sub.textContent = 'Internal · admin only. Filters live in the URL, so a link is a saved query.';

  const filtersHost = document.createElement('section');
  filtersHost.className = 'database-filters-host';
  const summaryHost = document.createElement('section');
  summaryHost.className = 'database-summary-host';
  const resultsHost = document.createElement('section');
  resultsHost.className = 'database-results-host';

  shell.append(heading, sub, filtersHost, summaryHost, resultsHost);
  root.append(buildNav(), shell);

  let filters = readFilters();

  const run = async (): Promise<void> => {
    writeFilters(filters);
    summaryHost.replaceChildren(statusLine('Loading…'));
    resultsHost.replaceChildren();
    let data: QueryResponse;
    try {
      data = await fetchGames(filters);
    } catch (err) {
      summaryHost.replaceChildren(
        statusLine(err instanceof AdminRequiredError ? err.message : 'Query failed.'),
      );
      return;
    }
    filtersHost.replaceChildren(buildFilterForm(filters, data.facets, applyFilters));
    summaryHost.replaceChildren(buildSummary(data.aggregates));
    resultsHost.replaceChildren(buildResults(data, applyFilters));
  };

  function applyFilters(next: Filters): void {
    filters = next;
    void run();
  }

  // Render the form once immediately (empty facets) so the page isn't blank
  // while the first query resolves; run() re-renders it with real facets.
  filtersHost.replaceChildren(
    buildFilterForm(
      filters,
      { variants: [], modes: [], terminations: [], results: [] },
      applyFilters,
    ),
  );
  await run();
}

class AdminRequiredError extends Error {}

async function fetchGames(filters: Filters): Promise<QueryResponse> {
  const params = new URLSearchParams();
  for (const key of STRING_FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.offset > 0) params.set('offset', String(filters.offset));
  params.set('limit', String(filters.limit));

  const resp = await fetch(`/api/admin/games/query?${params.toString()}`, {
    headers: { accept: 'application/json' },
  });
  if (resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`query_failed_${resp.status}`);
  return (await resp.json()) as QueryResponse;
}

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const str = (key: string): string => params.get(key) ?? '';
  const limit = Number.parseInt(params.get('limit') ?? '', 10);
  const offset = Number.parseInt(params.get('offset') ?? '', 10);
  return {
    variant: str('variant'),
    mode: str('mode'),
    result: str('result'),
    termination: str('termination'),
    rated: str('rated'),
    timeClass: str('timeClass'),
    plyMin: str('plyMin'),
    plyMax: str('plyMax'),
    from: str('from'),
    to: str('to'),
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT,
  };
}

function writeFilters(filters: Filters): void {
  const params = new URLSearchParams();
  for (const key of STRING_FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.offset > 0) params.set('offset', String(filters.offset));
  if (filters.limit !== DEFAULT_LIMIT) params.set('limit', String(filters.limit));
  const query = params.toString();
  window.history.replaceState(null, '', query ? `/database?${query}` : '/database');
}

function buildFilterForm(
  filters: Filters,
  facets: Facets,
  onApply: (next: Filters) => void,
): HTMLElement {
  const form = document.createElement('form');
  form.className = 'database-filters';

  const selects = new Map<keyof Filters, HTMLSelectElement>();
  const inputs = new Map<keyof Filters, HTMLInputElement>();

  const addSelect = (
    key: keyof Filters,
    label: string,
    options: { value: string; label: string }[],
  ): void => {
    const select = buildSelect(label, options, String(filters[key]));
    selects.set(key, select.select);
    form.append(select.field);
  };

  addSelect('variant', 'Variant', [
    { value: '', label: 'Any variant' },
    ...facets.variants.map((v) => ({ value: v, label: variantDisplayLabel(v) })),
  ]);
  addSelect('mode', 'Mode', [
    { value: '', label: 'Any mode' },
    ...facets.modes.map((m) => ({ value: m, label: sourceLabel(m as FeaturedGame['mode']) })),
  ]);
  addSelect('timeClass', 'Time class', [
    { value: '', label: 'Any speed' },
    { value: 'bullet', label: 'Bullet' },
    { value: 'blitz', label: 'Blitz' },
    { value: 'rapid', label: 'Rapid' },
  ]);
  addSelect('result', 'Result', [
    { value: '', label: 'Any result' },
    { value: 'white-wins', label: 'White wins' },
    { value: 'black-wins', label: 'Black wins' },
    { value: 'red-wins', label: 'Red wins' },
    { value: 'draw', label: 'Draw' },
  ]);
  addSelect('termination', 'Termination', [
    { value: '', label: 'Any ending' },
    ...facets.terminations.map((t) => ({ value: t, label: terminationLabel(t) })),
  ]);
  addSelect('rated', 'Rated', [
    { value: '', label: 'Any' },
    { value: 'true', label: 'Rated' },
    { value: 'false', label: 'Casual' },
  ]);

  const addNumber = (key: keyof Filters, label: string, placeholder: string): void => {
    const input = buildNumberInput(label, placeholder, String(filters[key]));
    inputs.set(key, input.input);
    form.append(input.field);
  };
  addNumber('plyMin', 'Min plies', 'e.g. 20');
  addNumber('plyMax', 'Max plies', 'e.g. 200');

  const addDate = (key: keyof Filters, label: string): void => {
    const input = buildDateInput(label, String(filters[key]));
    inputs.set(key, input.input);
    form.append(input.field);
  };
  addDate('from', 'From (UTC)');
  addDate('to', 'To (UTC)');

  const actions = document.createElement('div');
  actions.className = 'database-filter-actions';
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'database-btn database-btn-primary';
  apply.textContent = 'Apply';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'database-btn';
  reset.textContent = 'Reset';
  actions.append(apply, reset);
  form.append(actions);

  const collect = (offset: number): Filters => {
    const next: Filters = { ...filters, offset, limit: filters.limit };
    for (const [key, select] of selects) (next[key] as string) = select.value;
    for (const [key, input] of inputs) (next[key] as string) = input.value.trim();
    return next;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onApply(collect(0));
  });
  reset.addEventListener('click', () => {
    onApply({
      variant: '',
      mode: '',
      result: '',
      termination: '',
      rated: '',
      timeClass: '',
      plyMin: '',
      plyMax: '',
      from: '',
      to: '',
      offset: 0,
      limit: DEFAULT_LIMIT,
    });
  });

  return form;
}

function buildSummary(aggregates: Aggregates): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'database-summary';

  const total = aggregates.total;
  const count = document.createElement('p');
  count.className = 'database-total';
  count.textContent = total === 1 ? '1 game match' : `${total.toLocaleString()} games match`;
  wrap.append(count);

  if (total === 0) return wrap;

  const { whiteWins, blackWins, redWins, draws } = aggregates.results;
  const bar = document.createElement('div');
  bar.className = 'database-winbar';
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    `White ${pct(whiteWins, total)}, Black ${pct(blackWins, total)}, Draw ${pct(draws, total)}`,
  );
  const segments: { label: string; value: number; cls: string }[] = [
    { label: 'White', value: whiteWins, cls: 'white' },
    { label: 'Black', value: blackWins, cls: 'black' },
    { label: 'Draw', value: draws, cls: 'draw' },
  ];
  if (redWins > 0) segments.splice(2, 0, { label: 'Red', value: redWins, cls: 'red' });
  for (const segment of segments) {
    if (segment.value === 0) continue;
    const seg = document.createElement('div');
    seg.className = `database-winseg database-winseg-${segment.cls}`;
    seg.style.width = `${(segment.value / total) * 100}%`;
    seg.title = `${segment.label}: ${segment.value} (${pct(segment.value, total)})`;
    bar.append(seg);
  }
  wrap.append(bar);

  const legend = document.createElement('div');
  legend.className = 'database-winlegend';
  for (const segment of segments) {
    const item = document.createElement('span');
    item.className = `database-winlegend-item database-winlegend-${segment.cls}`;
    item.textContent = `${segment.label} ${pct(segment.value, total)}`;
    legend.append(item);
  }
  wrap.append(legend);

  const ply = aggregates.plyCount;
  if (ply.avg != null) {
    const length = document.createElement('p');
    length.className = 'database-length';
    length.textContent = `Length: avg ${ply.avg} plies (min ${ply.min ?? '—'}, max ${ply.max ?? '—'})`;
    wrap.append(length);
  }

  if (aggregates.terminations.length > 0) {
    const terms = document.createElement('div');
    terms.className = 'database-terms';
    for (const term of aggregates.terminations) {
      const chip = document.createElement('span');
      chip.className = 'database-term-chip';
      chip.textContent = `${terminationLabel(term.termination)} · ${term.count}`;
      terms.append(chip);
    }
    wrap.append(terms);
  }

  return wrap;
}

function buildResults(data: QueryResponse, onApply: (next: Filters) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'database-results';

  if (data.games.length === 0) {
    wrap.append(statusLine('No games match these filters.'));
    return wrap;
  }

  const list = document.createElement('div');
  list.className = 'database-list';
  for (const game of data.games) list.append(buildGameRow(game));
  wrap.append(list);

  const pager = buildPager(data, onApply);
  if (pager) wrap.append(pager);

  return wrap;
}

// Review-link target for a database row. Variant-tenant games (xiangqi / jungle
// / ... families) replay only under their own postgame route: the
// legacy /game/:id review shell knows only the chess-shell event union and 403s
// on their event log (`game_not_public`). Resolve the tenant by room-id prefix
// and link to its postgame mount (gameRouteBase). Chess-family games and tenants
// without a postgame surface keep the legacy /game/:id.
export function databaseReviewHref(roomId: string): string {
  const tenant = webVariantTenantForRoomId(roomId);
  const routeBase = tenant?.gameRouteBase ?? tenant?.reviewRouteBase ?? null;
  return routeBase
    ? `${routeBase}/${encodeURIComponent(roomId)}`
    : `/game/${encodeURIComponent(roomId)}`;
}

function buildGameRow(game: GameRow): HTMLElement {
  const link = document.createElement('a');
  link.className = 'database-row';
  link.href = databaseReviewHref(game.roomId);

  const tag = document.createElement('span');
  const tone = resultTone(game.result);
  tag.className = `database-result database-result-${tone}`;
  tag.textContent = resultLabel(game.result);
  link.append(tag);

  const body = document.createElement('div');
  body.className = 'database-row-body';

  const players = document.createElement('div');
  players.className = 'database-row-players';
  players.textContent = databaseMatchupLabel(game);
  body.append(players);

  const meta = document.createElement('div');
  meta.className = 'database-row-meta';
  meta.append(
    metaPill(variantDisplayLabel(game.variant)),
    metaPill(timeControlLabel(game)),
    metaPill(sourceLabel(game.mode)),
    metaPill(game.rated === false ? 'Casual' : 'Rated'),
    metaPill(`${game.plyCount} plies`),
    metaPill(formatDate(game.endedAt)),
  );
  body.append(meta);

  link.append(body);
  return link;
}

export function databaseMatchupLabel(game: FeaturedGame): string {
  return matchupLabel(game);
}

function buildPager(data: QueryResponse, onApply: (next: Filters) => void): HTMLElement | null {
  const { offset, limit, total } = data;
  if (total <= limit && offset === 0) return null;

  const pager = document.createElement('div');
  pager.className = 'database-pager';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'database-btn';
  prev.textContent = '← Prev';
  prev.disabled = offset <= 0;
  prev.addEventListener('click', () => {
    onApply({ ...readFilters(), offset: Math.max(0, offset - limit), limit });
  });

  const status = document.createElement('span');
  status.className = 'database-pager-status';
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  status.textContent = `${start}–${end} of ${total.toLocaleString()}`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'database-btn';
  next.textContent = 'Next →';
  next.disabled = offset + limit >= total;
  next.addEventListener('click', () => {
    onApply({ ...readFilters(), offset: offset + limit, limit });
  });

  pager.append(prev, status, next);
  return pager;
}

// ── Small DOM + format helpers ─────────────────────────────────────────────

function buildSelect(
  label: string,
  options: { value: string; label: string }[],
  selected: string,
): { field: HTMLElement; select: HTMLSelectElement } {
  const field = document.createElement('label');
  field.className = 'database-field';
  const span = document.createElement('span');
  span.className = 'database-field-label';
  span.textContent = label;
  const select = document.createElement('select');
  select.className = 'database-select';
  for (const option of options) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    if (option.value === selected) el.selected = true;
    select.append(el);
  }
  field.append(span, select);
  return { field, select };
}

function buildNumberInput(
  label: string,
  placeholder: string,
  value: string,
): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement('label');
  field.className = 'database-field';
  const span = document.createElement('span');
  span.className = 'database-field-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.className = 'database-input';
  input.placeholder = placeholder;
  input.value = value;
  field.append(span, input);
  return { field, input };
}

function buildDateInput(
  label: string,
  value: string,
): { field: HTMLElement; input: HTMLInputElement } {
  const field = document.createElement('label');
  field.className = 'database-field';
  const span = document.createElement('span');
  span.className = 'database-field-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'database-input';
  input.value = value;
  field.append(span, input);
  return { field, input };
}

function metaPill(text: string): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'database-meta-pill';
  pill.textContent = text;
  return pill;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'database-status';
  p.textContent = text;
  return p;
}

function pct(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function resultTone(result: string): 'white' | 'black' | 'draw' | 'red' {
  if (result === 'white-wins') return 'white';
  if (result === 'black-wins') return 'black';
  if (result === 'red-wins') return 'red';
  return 'draw';
}

function resultLabel(result: string): string {
  if (result === 'white-wins') return 'White';
  if (result === 'black-wins') return 'Black';
  if (result === 'red-wins') return 'Red';
  return 'Draw';
}

// Variant labelling lives in game-display.ts (variantDisplayLabel), shared with
// the homepage showcase caption.

function terminationLabel(termination: string): string {
  return termination
    .split('-')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function timeControlLabel(game: GameRow): string {
  const spec = findTimeControl(game.initialMs ?? undefined, game.incrementMs ?? undefined);
  if (spec) return spec.label;
  if (game.initialMs == null) return 'Untimed';
  const minutes = Math.round(game.initialMs / 60000);
  const increment = Math.round((game.incrementMs ?? 0) / 1000);
  return `${minutes}+${increment}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
