// Admin-only weekly decisions and snapshot history. Summary rules are shared
// with the email on the server; the browser owns only the presentation.
import './readouts-admin.css';
import { buildReportingNav } from './admin-reporting-nav.js';
import { buildNav } from './site-shell.js';

type ReadoutVerdict = 'healthy' | 'watch' | 'action' | 'blocked' | 'unknown';
type HistoryRow = {
  snapshotId: string;
  periodStart: string;
  periodEnd: string;
};
type Metric = { label: string; current: number; previous?: number; growth?: boolean };
// Mirrors buildReadoutSummary on the server, without importing server modules.
type ReadoutSummary = {
  title: string;
  period: string;
  summary: string;
  metrics: Metric[];
  actions: { state: string; title: string; detail: string; url: string; urgent: boolean }[];
  extraActions: number;
  breakdown: Metric[];
  context: string[];
  deploy: string | null;
};
type Readout = {
  report: {
    snapshotId: string;
    verdict: ReadoutVerdict;
    generatedAt: string;
    trigger: string;
    periodStart: string;
  };
  summary?: ReadoutSummary;
  markdown: string;
};
class AdminRequiredError extends Error {}
const count = (value: number) => value.toLocaleString('en-US');

export async function mountReadoutsAdmin(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('readouts-admin-page');
  const shell = element('main', '', 'site-section readouts-admin-shell');
  shell.append(element('h1', 'Weekly readout', 'site-section-heading'));
  const toolbar = element('div', '', 'readouts-admin-toolbar');
  const label = element('label', 'Week ');
  const weeks = document.createElement('select');
  weeks.setAttribute('aria-label', 'Readout week');
  label.append(weeks);
  toolbar.append(label);
  toolbar.hidden = true;
  const body = element('section', 'Loading…', 'readouts-admin-latest');
  body.setAttribute('aria-live', 'polite');
  shell.append(toolbar, body);
  root.append(buildNav(), shell);
  let requestVersion = 0;
  let selectedId: string | null = null;
  const authorizeNav = () => {
    if (!shell.querySelector('.admin-reporting-nav')) shell.prepend(buildReportingNav('readouts'));
  };
  const show = async (id?: string) => {
    const version = ++requestVersion;
    body.textContent = 'Loading…';
    try {
      const report = await fetchReadout(
        id ? `/snapshot?id=${encodeURIComponent(id)}` : '/latest?trigger=weekly',
      );
      if (version !== requestVersion) return;
      authorizeNav();
      selectedId = report?.report.snapshotId ?? null;
      if (selectedId) weeks.value = selectedId;
      body.replaceChildren(
        report ? buildReport(report) : element('p', 'No weekly readout stored yet.'),
      );
    } catch (error) {
      if (version === requestVersion)
        body.textContent = errorText(error, 'Could not load the readout. Try again shortly.');
    }
  };
  const latest = show();
  try {
    const response = (await fetchJson('/history?limit=40&trigger=weekly')) as {
      readouts: HistoryRow[];
    };
    authorizeNav();
    for (const row of response.readouts) {
      const option = document.createElement('option');
      option.value = row.snapshotId;
      const end = new Date(Date.parse(row.periodEnd) - 1).toISOString().slice(0, 10);
      option.textContent = `${row.periodStart.slice(0, 10)} to ${end}`;
      weeks.append(option);
    }
    toolbar.hidden = response.readouts.length < 2;
    if (selectedId) weeks.value = selectedId;
  } catch {
    /* The latest report remains usable if its history is unavailable. */
  }
  weeks.addEventListener('change', () => {
    void show(weeks.value);
  });
  await latest;
}

function buildReport(readout: Readout): HTMLElement {
  const wrap = element('div');
  const meta = element('p', '', 'readouts-admin-meta');
  meta.append(
    verdictBadge(readout.report.verdict),
    `Checked ${readout.report.generatedAt.slice(0, 10)} UTC`,
  );
  wrap.append(meta);
  const summary = readout.summary;
  if (!summary) {
    wrap.append(element('pre', readout.markdown.trim(), 'readouts-admin-markdown'));
    return wrap;
  }
  wrap.append(element('p', summary.period, 'readouts-admin-sub'), element('p', summary.summary));
  const table = document.createElement('table');
  table.className = 'readouts-admin-numbers';
  const head = table.createTHead().insertRow();
  for (const text of ['This week', 'Total', 'Change']) {
    const th = element('th', text);
    th.scope = 'col';
    head.append(th);
  }
  const rows = table.createTBody();
  for (const metric of summary.metrics) {
    const row = rows.insertRow();
    const label = element(
      'th',
      metric.label === 'Completed human games' ? 'Games played' : metric.label,
    );
    label.scope = 'row';
    row.append(
      label,
      element('td', count(metric.current), 'readouts-admin-number'),
      element(
        'td',
        delta(metric),
        metric.growth && metric.previous !== undefined && metric.current > metric.previous
          ? 'is-up'
          : '',
      ),
    );
  }
  wrap.append(
    table,
    element(
      'p',
      'Players are accounts and guest browsers who finished a game. Returning players had played before this week. New accounts are sign-ups.',
      'readouts-admin-definitions',
    ),
  );
  wrap.append(element('h2', 'Needs attention', 'readouts-admin-subheading'));
  if (!summary.actions.length) wrap.append(element('p', 'No action needed.'));
  for (const action of summary.actions) {
    const article = element(
      'article',
      '',
      `readouts-admin-action ${action.urgent ? 'is-urgent' : action.state === 'Resolved' ? 'is-resolved' : 'is-review'}`,
    );
    article.append(
      element('p', action.urgent ? 'Urgent' : action.state, 'readouts-admin-action-state'),
      element('h3', action.title),
      element('p', action.detail),
      link(action.url.includes('/puzzles/') ? 'Open puzzle →' : 'Review evidence →', action.url),
    );
    wrap.append(article);
  }
  if (summary.extraActions)
    wrap.append(
      element('p', `${summary.extraActions} more actions in the downloadable full report.`),
    );
  if (summary.deploy) {
    wrap.append(
      element('h2', 'Release follow-up', 'readouts-admin-subheading'),
      element('p', summary.deploy),
      link('View release history →', '/ops?tab=operations#deploy-history'),
    );
  }
  if (summary.context.length) {
    const list = element('ul', '', 'readouts-admin-context');
    for (const text of summary.context) list.append(element('li', text));
    wrap.append(element('h2', 'Other changes', 'readouts-admin-subheading'), list);
  }
  const footer = element('p', '', 'readouts-admin-footer');
  footer.append(
    link('Explore the numbers →', `/ops?tab=play&week=${readout.report.periodStart.slice(0, 10)}`),
  );
  const download = element('button', 'Download full report');
  download.type = 'button';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([readout.markdown], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mistboard-readout-${readout.report.generatedAt.slice(0, 10)}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  footer.append(download);
  wrap.append(footer);
  return wrap;
}

function delta(metric: Metric): string {
  if (metric.previous === undefined) return 'Comparison unavailable';
  const change = metric.current - metric.previous;
  const signed = `${change > 0 ? '+' : ''}${count(change)}`;
  const percent = metric.previous
    ? ` (${change > 0 ? '+' : ''}${Math.round((change / metric.previous) * 100)}%)`
    : change
      ? ' (new)'
      : ' (flat)';
  return `${signed}${percent} vs ${count(metric.previous)}`;
}
function verdictBadge(verdict: ReadoutVerdict): HTMLElement {
  return element(
    'span',
    {
      healthy: 'No action',
      watch: 'Watch',
      action: 'Needs review',
      blocked: 'Blocked',
      unknown: 'Data unavailable',
    }[verdict],
    `readouts-admin-verdict is-${verdict}`,
  );
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function link(text: string, href: string): HTMLAnchorElement {
  const anchor = element('a', text);
  // The API supplies links, but a stored snapshot must not inject a script URL.
  const url = new URL(href, window.location.origin);
  anchor.href =
    url.protocol === 'https:' ||
    (url.origin === window.location.origin && url.protocol === window.location.protocol)
      ? url.href
      : '/ops';
  return anchor;
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof AdminRequiredError ? error.message : fallback;
}
async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`/api/admin/readouts${path}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (response.status === 401 || response.status === 403)
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  if (!response.ok) throw new Error(`readout_failed_${response.status}`);
  return response.json();
}
async function fetchReadout(path: string): Promise<Readout | null> {
  try {
    return (await fetchJson(path)) as Readout;
  } catch (error) {
    if (error instanceof Error && error.message === 'readout_failed_404') return null;
    throw error;
  }
}
