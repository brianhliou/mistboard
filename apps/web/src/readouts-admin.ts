// Unlisted admin readout history (/readouts): the scheduled operating readout
// that used to exist only as a GitHub issue comment. Latest report in full,
// then one row per stored snapshot so a trend is visible without opening
// GitHub. Admin-gated by /api/admin/readouts (open in local dev); English-only
// like the other admin tools.
import './readouts-admin.css';
import { buildNav } from './site-shell.js';

type ReadoutVerdict = 'healthy' | 'watch' | 'action' | 'blocked' | 'unknown';

type ReadoutSummary = {
  snapshotId: string;
  trigger: 'daily' | 'weekly' | 'manual';
  periodEnd: string;
  generatedAt: string;
  verdict: ReadoutVerdict;
  completedGames: number | null;
  humanPlayers: number | null;
  activeAccounts28d?: number | null;
  actions: number;
};

type LatestReadout = {
  report: { verdict: ReadoutVerdict; generatedAt: string; trigger: string };
  markdown: string;
};

class AdminRequiredError extends Error {}

export async function mountReadoutsAdmin(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('readouts-admin-page');

  const shell = document.createElement('main');
  shell.className = 'site-section readouts-admin-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Readouts';

  const sub = document.createElement('p');
  sub.className = 'readouts-admin-sub';
  sub.textContent =
    'Internal · admin only. The scheduled operating readout: weekly on Monday, a silent daily check otherwise. Counts come from the database, so they include visitors who send Do Not Track.';

  const latestBody = document.createElement('section');
  latestBody.className = 'readouts-admin-latest';
  latestBody.append(statusLine('Loading…'));

  const historyHeading = document.createElement('h2');
  historyHeading.className = 'readouts-admin-subheading';
  historyHeading.textContent = 'History';

  const historyBody = document.createElement('section');
  historyBody.className = 'readouts-admin-history';
  historyBody.append(statusLine('Loading…'));

  shell.append(heading, sub, latestBody, historyHeading, historyBody);
  root.append(buildNav(), shell);

  // Two independent fetches: a missing latest report should not blank the
  // history, and an empty history should not hide the report.
  const [latest, history] = await Promise.allSettled([fetchLatest(), fetchHistory()]);

  if (latest.status === 'fulfilled') {
    latestBody.replaceChildren(
      latest.value ? buildLatest(latest.value) : statusLine('No readout stored yet.'),
    );
  } else {
    latestBody.replaceChildren(statusLine(errorText(latest.reason, 'Could not load the readout.')));
  }

  if (history.status === 'fulfilled') {
    historyBody.replaceChildren(
      history.value.length === 0
        ? statusLine('No snapshots stored yet.')
        : buildHistoryTable(history.value),
    );
  } else {
    historyBody.replaceChildren(
      statusLine(errorText(history.reason, 'Could not load the history.')),
    );
  }
}

function buildLatest(latest: LatestReadout): HTMLElement {
  const wrap = document.createElement('div');
  const meta = document.createElement('p');
  meta.className = 'readouts-admin-meta';
  meta.append(verdictBadge(latest.report.verdict));
  const when = document.createElement('span');
  when.textContent = `${latest.report.trigger} · ${formatDate(latest.report.generatedAt)}`;
  meta.append(when);

  // The markdown is the same text the weekly issue comment carries. Rendering
  // it verbatim keeps one source of truth for the wording instead of a second
  // renderer that can drift from it.
  const body = document.createElement('pre');
  body.className = 'readouts-admin-markdown';
  body.textContent = latest.markdown.trim();

  wrap.append(meta, body);
  return wrap;
}

function buildHistoryTable(rows: ReadoutSummary[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'readouts-admin-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of [
    'Week ending',
    'Trigger',
    'Verdict',
    'Games',
    'Accounts played',
    'Active 28d',
    'Actions',
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(cell(formatDate(row.periodEnd)), cell(row.trigger));
    const verdict = document.createElement('td');
    verdict.append(verdictBadge(row.verdict));
    tr.append(
      verdict,
      cell(formatCount(row.completedGames)),
      cell(formatCount(row.humanPlayers)),
      cell(formatCount(row.activeAccounts28d ?? null)),
      cell(row.actions === 0 ? '-' : String(row.actions)),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function verdictBadge(verdict: ReadoutVerdict): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `readouts-admin-verdict is-${verdict}`;
  badge.textContent = verdict.toUpperCase();
  return badge;
}

// A count is null for snapshots written before that field existed. "-" rather
// than 0: the number is unknown, not zero.
function formatCount(value: number | null): string {
  return value === null ? '-' : String(value);
}

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'readouts-admin-status';
  p.textContent = text;
  return p;
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof AdminRequiredError ? reason.message : fallback;
}

async function fetchLatest(): Promise<LatestReadout | null> {
  const resp = await fetch('/api/admin/readouts/latest', {
    headers: { accept: 'application/json' },
  });
  if (resp.status === 404) return null;
  if (resp.status === 401 || resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`readout_latest_failed_${resp.status}`);
  return (await resp.json()) as LatestReadout;
}

async function fetchHistory(): Promise<ReadoutSummary[]> {
  const resp = await fetch('/api/admin/readouts/history?limit=40', {
    headers: { accept: 'application/json' },
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`readout_history_failed_${resp.status}`);
  const payload = (await resp.json()) as { readouts?: ReadoutSummary[] };
  return payload.readouts ?? [];
}
