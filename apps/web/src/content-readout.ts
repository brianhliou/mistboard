import './content-readout.css';

// Read-only projection of the stored admin readout contract. Aggregate-only;
// the server owns collection, eligibility, attribution and shared prose.
type Metrics = Record<string, number>;
export type ContentArticle = {
  slug: string;
  title: string;
  publishedAt: string | null;
  ageDays: number | null;
  current: Metrics;
  previous: Metrics;
};
export type ContentPayload = {
  report: {
    content?: {
      status: string;
      collectedAt: string;
      periodStart: string;
      periodEnd: string;
      previousPeriodStart: string;
      articles: ContentArticle[];
    };
  };
  summary?: { content?: string[]; contentCaveats?: string[] };
};
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
export async function loadContentReadout(): Promise<HTMLElement> {
  try {
    const response = await fetch('/api/admin/readouts/latest', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('unavailable');
    return buildContentReadout((await response.json()) as ContentPayload);
  } catch {
    return buildContentReadout(null);
  }
}
export function buildContentReadout(payload: ContentPayload | null): HTMLElement {
  const section = element('section');
  section.id = 'content';
  section.className = 'content-readout';
  section.append(element('h2', 'Article engagement'));
  const content = payload?.report.content;
  for (const line of payload?.summary?.content ?? [
    'Content engagement unavailable (no stored snapshot).',
  ])
    section.append(element('p', line));
  if (content?.status !== 'available') return section;
  section.append(
    element(
      'p',
      `Observed analytics, not the database human-game headline. Current: ${content.periodStart.slice(0, 10)} to ${content.periodEnd.slice(0, 10)} UTC, end exclusive. Previous: ${content.previousPeriodStart.slice(0, 10)} to ${content.periodStart.slice(0, 10)}. As of ${content.collectedAt}.`,
    ),
  );
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Search articles';
  search.setAttribute('aria-label', 'Search articles');
  const label = element('label', 'Search articles ');
  label.append(search);
  section.append(label);
  const scroll = element('div');
  scroll.className = 'content-readout-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Article engagement comparison');
  const table = element('table');
  const caption = element(
    'caption',
    'Each row is one article; outcomes can overlap. Use column buttons to sort; scroll horizontally for more metrics.',
  );
  table.append(caption);
  const columns = [
    ['title', 'Article'],
    ['visitors', 'Visitors'],
    ['previous', 'Previous visitors'],
    ['boardUsers', 'Board users'],
    ['ctaUsers', 'CTA users'],
    ['entryFirstPlayers', 'Entry first players / entry visits'],
    ['studyUsers', 'Study users'],
    ['puzzleUsers', 'Puzzle users'],
    ['returnedVisitors', 'Returns / mature visitors'],
    ['views', 'Pageviews'],
    ['visits', 'Visits'],
    ['startedVisits', 'Later start visits'],
    ['movedVisits', 'Later first-move visits'],
    ['finishedVisits', 'Later finish visits'],
    ['priorPlayers', 'Visitors with prior play'],
    ['firstPlayers', 'First recorded players'],
    ['publishedAt', 'Published / age'],
  ] as const;
  const head = element('thead');
  const headRow = element('tr');
  const body = element('tbody');
  let sort = 'visitors';
  let descending = true;
  const headers = new Map<string, HTMLTableCellElement>();
  for (const [key, title] of columns) {
    const th = element('th');
    th.scope = 'col';
    headers.set(key, th);
    const button = element('button', title);
    button.type = 'button';
    button.addEventListener('click', () => {
      descending = sort === key ? !descending : key !== 'title' && key !== 'publishedAt';
      sort = key;
      render();
    });
    th.append(button);
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head, body);
  scroll.append(table);
  section.append(scroll);
  const value = (a: ContentArticle, key: string): number | string =>
    key === 'title'
      ? a.title
      : key === 'publishedAt'
        ? (a.publishedAt ?? '')
        : key === 'previous'
          ? a.previous.visitors
          : (a.current[key] ?? 0);
  const display = (a: ContentArticle, key: string): string => {
    if (key === 'title') return a.title;
    if (key === 'publishedAt')
      return `${a.publishedAt ?? 'Legacy / unknown'}${a.ageDays === null ? '' : ` / ${a.ageDays} days`}`;
    if (key === 'entryFirstPlayers')
      return `${a.current.entryFirstPlayers} / ${a.current.entryVisits}`;
    if (key === 'returnedVisitors')
      return `${a.current.returnedVisitors} / ${a.current.matureVisitors}`;
    if (key === 'movedVisits') {
      if (content.periodEnd <= '2026-10-25T00:00:00.000Z') return 'Unavailable';
      return `${a.current.movedVisits}${content.periodStart < '2026-10-25T00:00:00.000Z' ? ' (partial coverage)' : ''}`;
    }
    return String(value(a, key));
  };
  function render() {
    for (const [key, th] of headers)
      th.setAttribute(
        'aria-sort',
        key === sort ? (descending ? 'descending' : 'ascending') : 'none',
      );
    const term = search.value.toLocaleLowerCase();
    const rows = content!.articles
      .filter((a) => `${a.title} ${a.slug}`.toLocaleLowerCase().includes(term))
      .sort((a, b) => {
        const av = value(a, sort),
          bv = value(b, sort);
        const delta =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv));
        return (descending ? -delta : delta) || a.slug.localeCompare(b.slug);
      });
    body.replaceChildren(
      ...rows.map((a) => {
        const row = element('tr');
        for (const [key] of columns) {
          const cell = element(key === 'title' ? 'th' : 'td');
          if (key === 'title') {
            (cell as HTMLTableCellElement).scope = 'row';
            const link = element('a', a.title);
            link.href = `/blog/${encodeURIComponent(a.slug)}`;
            cell.append(link);
          } else cell.textContent = display(a, key);
          row.append(cell);
        }
        return row;
      }),
    );
    if (!rows.length) {
      const row = element('tr');
      const cell = element('td', 'No matching articles.');
      cell.colSpan = columns.length;
      row.append(cell);
      body.append(row);
    }
  }
  search.addEventListener('input', render);
  render();
  const definitions = element('details');
  definitions.append(element('summary', 'Definitions and coverage'));
  for (const line of payload?.summary?.contentCaveats ?? []) definitions.append(element('p', line));
  definitions.append(
    element(
      'p',
      'Board, CTA, study and puzzle columns count distinct observed visitors. Starts, first moves and finishes count article sessions, ordered after its first view; lifecycle events are joined by gameId. First recorded players and prior players count distinct visitors. Publication age is measured at the current window end.',
    ),
  );
  section.append(definitions);
  return section;
}
