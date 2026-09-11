// Unlisted admin account roster (/accounts): every registered account, closed
// and private ones included, with signup date, last seen, and completed-game
// count. Admin-gated by /api/admin/accounts (open in local dev). Reached from
// the account menu's admin group beside /database and /engines; the page
// itself is English-only like the other admin tools.
//
// Sorting is by column header (click toggles direction), the roster is paged
// 50 at a time with the row number continuing across pages, and the search box
// filters as you type. Sort, search, and page live in the URL.
import './accounts-admin.css';
import { buildNav } from './site-shell.js';

type AccountRow = {
  id: string;
  email: string;
  emailVerified: boolean;
  handle: string;
  displayName: string;
  accountRole: 'player' | 'admin';
  title: string | null;
  patron: boolean;
  profileVisibility: 'private' | 'unlisted' | 'public';
  createdAt: string;
  lastSeenAt: string | null;
  closedAt: string | null;
  statsExcluded?: boolean;
  gamesPlayed: number;
};

// Mirrors ADMIN_ACCOUNT_SORTS in apps/server/src/persistence-admin-accounts.ts.
type RosterSort =
  | 'newest'
  | 'oldest'
  | 'seen'
  | 'seen-asc'
  | 'games'
  | 'games-asc'
  | 'name'
  | 'name-desc';

type RosterPage = {
  accounts: AccountRow[];
  total: number;
  summary: { accounts: number; last7d: number; last30d: number };
  offset: number;
};

// Each sortable column knows its two sorts; the header click toggles between
// them, starting on `first` (the direction an admin usually wants).
type SortColumn = { label: string; first: RosterSort; second: RosterSort };

const SORT_COLUMNS: Record<'name' | 'joined' | 'seen' | 'games', SortColumn> = {
  name: { label: 'Account', first: 'name', second: 'name-desc' },
  joined: { label: 'Joined', first: 'newest', second: 'oldest' },
  seen: { label: 'Last seen', first: 'seen', second: 'seen-asc' },
  games: { label: 'Games', first: 'games', second: 'games-asc' },
};

const ROSTER_SORTS: readonly RosterSort[] = Object.values(SORT_COLUMNS).flatMap((column) => [
  column.first,
  column.second,
]);

// Ascending-by-value sorts point up; the rest point down. Joined "newest" is
// descending by date even though it is the natural first click.
const ASCENDING_SORTS: ReadonlySet<RosterSort> = new Set([
  'oldest',
  'seen-asc',
  'games-asc',
  'name',
]);

export const ACCOUNTS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

class AdminRequiredError extends Error {}

export async function mountAccountsAdmin(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('accounts-admin-page');

  const shell = document.createElement('main');
  shell.className = 'site-section accounts-admin-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Accounts';

  const sub = document.createElement('p');
  sub.className = 'accounts-admin-sub';
  sub.textContent =
    'Internal · admin only. Every registered account, closed and private ones included, with completed games per account. Click a column to sort.';

  const state = stateFromUrl();

  const form = document.createElement('form');
  form.className = 'accounts-admin-controls';
  const search = document.createElement('input');
  search.type = 'search';
  search.name = 'q';
  search.className = 'accounts-admin-input';
  search.placeholder = 'Handle, name, or email';
  search.setAttribute('aria-label', 'Search accounts');
  search.autocomplete = 'off';
  search.value = state.search;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'accounts-admin-btn';
  submit.textContent = 'Search';
  form.append(search, submit);

  const summary = document.createElement('p');
  summary.className = 'accounts-admin-summary';

  const body = document.createElement('section');
  body.className = 'accounts-admin-body';
  body.append(statusLine('Loading…'));

  const pager = buildPager();

  shell.append(heading, sub, form, summary, body, pager.element);
  root.append(buildNav(), shell);

  let total = 0;
  // Each load gets a ticket; a stale response (typed past, paged past) is
  // dropped instead of overwriting the newer view.
  let ticket = 0;

  async function load(): Promise<void> {
    const mine = ++ticket;
    body.replaceChildren(statusLine('Loading…'));
    pager.setDisabled(true);
    try {
      const page = await fetchRoster(state);
      if (mine !== ticket) return;
      total = page.total;
      // A page past the end (stale URL after accounts closed, or a narrower
      // search) snaps back to the last real page.
      const pageCount = Math.max(1, Math.ceil(total / ACCOUNTS_PAGE_SIZE));
      if (state.page > pageCount) {
        state.page = pageCount;
        syncUrl(state);
        void load();
        return;
      }
      summary.textContent = summaryText(page.summary, total, state.search);
      body.replaceChildren(
        page.accounts.length === 0
          ? statusLine(state.search ? 'No accounts match.' : 'No accounts yet.')
          : buildTable(page.accounts, page.offset, state.sort, (sort) => {
              state.sort = sort;
              state.page = 1;
              syncUrl(state);
              void load();
            }),
      );
      pager.update(state.page, pageCount, total);
    } catch (err) {
      if (mine !== ticket) return;
      body.replaceChildren(
        statusLine(err instanceof AdminRequiredError ? err.message : 'Could not load accounts.'),
      );
      pager.update(1, 1, 0);
    }
  }

  function applySearch(): void {
    const next = search.value.trim();
    if (next === state.search) return;
    state.search = next;
    state.page = 1;
    syncUrl(state);
    void load();
  }

  let debounce: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (debounce) clearTimeout(debounce);
    applySearch();
  });
  pager.onPage((page) => {
    state.page = page;
    syncUrl(state);
    void load();
  });

  await load();
}

type RosterState = { sort: RosterSort; search: string; page: number };

function isRosterSort(value: string): value is RosterSort {
  return (ROSTER_SORTS as readonly string[]).includes(value);
}

// The sort, search, and page live in the URL so a filtered view can be
// reloaded or shared with another admin; defaults are dropped so the bare
// /accounts stays clean.
function stateFromUrl(): RosterState {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort') ?? '';
  const page = Number(params.get('page') ?? '1');
  return {
    sort: isRosterSort(sort) ? sort : 'newest',
    search: (params.get('q') ?? '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function syncUrl(state: RosterState): void {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

async function fetchRoster(state: RosterState): Promise<RosterPage> {
  const params = new URLSearchParams({
    sort: state.sort,
    limit: String(ACCOUNTS_PAGE_SIZE),
    offset: String((state.page - 1) * ACCOUNTS_PAGE_SIZE),
  });
  if (state.search) params.set('q', state.search);
  const resp = await fetch(`/api/admin/accounts?${params.toString()}`, {
    headers: { accept: 'application/json' },
  });
  if (resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`accounts_query_failed_${resp.status}`);
  return (await resp.json()) as RosterPage;
}

function summaryText(summary: RosterPage['summary'], total: number, search: string): string {
  const parts = [
    `${summary.accounts} ${summary.accounts === 1 ? 'account' : 'accounts'}`,
    `+${summary.last7d} this week`,
    `+${summary.last30d} this month`,
  ];
  if (search) parts.push(`${total} matching "${search}"`);
  return parts.join(' · ');
}

// ── pager ────────────────────────────────────────────────────────────────────
type Pager = {
  element: HTMLElement;
  update(page: number, pageCount: number, total: number): void;
  setDisabled(disabled: boolean): void;
  onPage(handler: (page: number) => void): void;
};

function buildPager(): Pager {
  const nav = document.createElement('nav');
  nav.className = 'accounts-admin-pager';
  nav.setAttribute('aria-label', 'Pages');
  nav.hidden = true;

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'accounts-admin-btn accounts-admin-pager-prev';
  prev.textContent = 'Previous';
  const label = document.createElement('span');
  label.className = 'accounts-admin-pager-label';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'accounts-admin-btn accounts-admin-pager-next';
  next.textContent = 'Next';
  nav.append(prev, label, next);

  let current = 1;
  let count = 1;
  let handler: (page: number) => void = () => {};
  prev.addEventListener('click', () => {
    if (current > 1) handler(current - 1);
  });
  next.addEventListener('click', () => {
    if (current < count) handler(current + 1);
  });

  return {
    element: nav,
    update(page, pageCount, total) {
      current = page;
      count = pageCount;
      nav.hidden = total <= ACCOUNTS_PAGE_SIZE;
      const from = (page - 1) * ACCOUNTS_PAGE_SIZE + 1;
      const to = Math.min(total, page * ACCOUNTS_PAGE_SIZE);
      label.textContent = `${from}–${to} of ${total} · page ${page} of ${pageCount}`;
      prev.disabled = page <= 1;
      next.disabled = page >= pageCount;
    },
    setDisabled(disabled) {
      prev.disabled = disabled;
      next.disabled = disabled;
    },
    onPage(next) {
      handler = next;
    },
  };
}

// ── table ────────────────────────────────────────────────────────────────────
function buildTable(
  accounts: AccountRow[],
  offset: number,
  activeSort: RosterSort,
  onSort: (sort: RosterSort) => void,
): HTMLElement {
  const table = document.createElement('table');
  table.className = 'accounts-admin-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.append(headerCell('#'));
  headRow.append(sortHeaderCell(SORT_COLUMNS.name, activeSort, onSort));
  headRow.append(sortHeaderCell(SORT_COLUMNS.joined, activeSort, onSort));
  headRow.append(sortHeaderCell(SORT_COLUMNS.seen, activeSort, onSort));
  headRow.append(sortHeaderCell(SORT_COLUMNS.games, activeSort, onSort));
  headRow.append(headerCell('Notes'));
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  accounts.forEach((account, index) => {
    const tr = document.createElement('tr');
    if (account.closedAt) tr.classList.add('is-closed');

    // Row number continues across pages so "the 73rd account" means the same
    // row on page 2 as it would on one long page.
    const rank = cell(String(offset + index + 1));
    rank.classList.add('accounts-admin-rank');

    const joined = cell(formatDate(account.createdAt));
    joined.title = formatDateTime(account.createdAt);

    const seen = cell(account.lastSeenAt ? formatTimeAgo(account.lastSeenAt) : '-');
    if (account.lastSeenAt) seen.title = formatDateTime(account.lastSeenAt);
    else seen.classList.add('accounts-admin-empty');

    const games = cell(String(account.gamesPlayed));
    games.classList.add('accounts-admin-games');

    tr.append(rank, accountCell(account), joined, seen, games, notesCell(account));
    tbody.append(tr);
  });
  table.append(tbody);

  // Six columns do not fit a phone; the table scrolls inside its own box so
  // the page never scrolls sideways (same as /engines).
  const scroller = document.createElement('div');
  scroller.className = 'accounts-admin-table-scroll';
  scroller.append(table);
  return scroller;
}

function headerCell(label: string): HTMLTableCellElement {
  const th = document.createElement('th');
  th.scope = 'col';
  th.textContent = label;
  return th;
}

function sortHeaderCell(
  column: SortColumn,
  activeSort: RosterSort,
  onSort: (sort: RosterSort) => void,
): HTMLTableCellElement {
  const th = document.createElement('th');
  th.scope = 'col';
  const active = activeSort === column.first || activeSort === column.second;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'accounts-admin-sort';
  if (active) button.classList.add('is-active');
  button.textContent = column.label;
  const arrow = document.createElement('span');
  arrow.className = 'accounts-admin-sort-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = active ? (ASCENDING_SORTS.has(activeSort) ? '▲' : '▼') : '';
  button.append(arrow);
  if (active) {
    th.setAttribute('aria-sort', ASCENDING_SORTS.has(activeSort) ? 'ascending' : 'descending');
  }
  button.addEventListener('click', () => {
    onSort(activeSort === column.first ? column.second : column.first);
  });
  th.append(button);
  return th;
}

function accountCell(account: AccountRow): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'accounts-admin-account';
  // A closed account has no profile to open; its name stays plain text.
  if (account.closedAt) {
    td.append(span('accounts-admin-name', account.displayName));
  } else {
    const link = document.createElement('a');
    link.className = 'accounts-admin-name accounts-admin-name-link';
    link.href = `/@/${encodeURIComponent(account.handle)}`;
    link.textContent = account.displayName;
    td.append(link);
  }
  td.append(span('accounts-admin-handle', `@${account.handle}`));
  td.append(span('accounts-admin-email', account.email));
  return td;
}

// What the public profile hides: role, title, patronage, verification,
// visibility, closure. Nothing shown when the account is a plain verified
// public account.
function notesCell(account: AccountRow): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'accounts-admin-notes';
  const badges: Array<{ label: string; tone?: 'warn' }> = [];
  if (account.accountRole === 'admin') badges.push({ label: 'Admin' });
  if (account.title) badges.push({ label: account.title });
  if (account.patron) badges.push({ label: 'Patron' });
  if (account.statsExcluded) badges.push({ label: 'Not counted in stats' });
  if (!account.emailVerified) badges.push({ label: 'Unverified', tone: 'warn' });
  if (account.profileVisibility !== 'public') {
    badges.push({ label: account.profileVisibility === 'private' ? 'Private' : 'Unlisted' });
  }
  if (account.closedAt)
    badges.push({ label: `Closed ${formatDate(account.closedAt)}`, tone: 'warn' });
  for (const badge of badges) {
    const el = span('accounts-admin-badge', badge.label);
    if (badge.tone === 'warn') el.classList.add('accounts-admin-badge--warn');
    td.append(el);
  }
  return td;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'accounts-admin-status';
  p.textContent = text;
  return p;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '-';
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
