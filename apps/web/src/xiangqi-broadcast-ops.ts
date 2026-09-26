import './xiangqi-broadcast-ops.css';
import { buildNav } from './site-shell.js';
import { formatEventDateTime } from './xiangqi-broadcast-time.js';

type SyncLog = {
  id: number;
  tourSlug: string | null;
  roundId: string | null;
  boardId: string | null;
  sourceBoardId: string | null;
  severity: 'info' | 'warning' | 'error';
  kind: string;
  message: string;
  createdAt: string;
};

type SourceHealth = {
  state: 'ok' | 'warning' | 'error' | 'unknown' | 'missing_source';
  label: string;
  lastKind: string | null;
  lastMessage: string | null;
  checkedAt: string | null;
  buckets: {
    successfulPolls: number;
    fetchFailures: number;
    parseFailures: number;
    dataFailures: number;
    configFailures: number;
    operatorFailures: number;
    corrections: number;
  };
};

export type PollMode = 'auto' | 'on' | 'off';

/** Mirrors the server's XiangqiBroadcastPollState. */
export type PollState = {
  mode: PollMode;
  polling: boolean;
  reason: 'on' | 'off' | 'no-source' | 'auto-undated' | 'auto-before' | 'auto-open' | 'auto-closed';
  opensAt: string | null;
  closesAt: string | null;
  afterEvent: boolean;
};

export type OpsSchedule = {
  pollMode: PollMode;
  /** Derived by the server: whether the scheduler polls the tour now. */
  pollEnabled: boolean;
  pollIntervalMs: number;
  pollState: PollState;
};

export type OpsTour = {
  tour: {
    slug: string;
    name: string;
    location?: string;
    startsAt?: string;
    endsAt?: string;
  };
  sourceUrl: string | null;
  schedule: OpsSchedule;
  roundCount: number;
  boardCount: number;
  liveBoardCount: number;
  completeBoardCount: number;
  scheduledBoardCount: number;
  totalPlies: number;
  updatedAt: string | null;
  sourceHealth: SourceHealth;
  syncLogs: SyncLog[];
};

type OpsResponse = {
  tours: OpsTour[];
};

type PollResponse = {
  result?: {
    ok: boolean;
    sourceUrl: string;
    dryRun?: boolean;
    tourSlug?: string;
    roundsImported?: number;
    boardsSeen?: number;
    boardsFailed?: number;
    sourcesSeen?: number;
    sourcesFailed?: number;
    updates?: Array<{ ok: boolean; status?: string; kind?: string }>;
    kind?: string;
    message?: string;
  };
  error?: string;
};

class AdminRequiredError extends Error {}

// Split a pasted blob into distinct source URLs: one per line (also tolerates
// spaces/commas), trimmed, de-duplicated in first-seen order. A URL never
// contains whitespace, so whitespace is always a separator.
export function parseSourceUrls(raw: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const url = token.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

// Compact label for per-URL failure lines (e.g. "view_m_140660.html").
function shortSourceLabel(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

export async function mountXiangqiBroadcastOps(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('xqb-ops-route');

  const shell = document.createElement('main');
  shell.className = 'site-section xqb-ops-shell';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Xiangqi broadcast ops';
  const sub = document.createElement('p');
  sub.className = 'xqb-ops-sub';
  sub.textContent =
    'Internal · admin only. Source health, latest sync results, and local/manual poll controls.';
  const body = document.createElement('section');
  body.className = 'xqb-ops-body';
  body.append(statusLine('Loading...'));

  shell.append(heading, sub, importPanel(body), body);
  root.append(buildNav(), shell);

  await refresh(body);
}

function importPanel(body: HTMLElement): HTMLElement {
  const panel = document.createElement('article');
  panel.className = 'xqb-ops-panel xqb-ops-import';

  const title = document.createElement('h2');
  title.textContent = 'Add broadcast from source';
  const hint = document.createElement('p');
  hint.className = 'xqb-ops-sub';
  hint.textContent =
    'Paste one or more source URLs (one per line): canonical JSON, WXF/DhtmlXQ, dpxq, or manifest pages. Preview dry-runs them all without writing; Import creates or updates each broadcast.';

  const row = document.createElement('div');
  row.className = 'xqb-ops-import-row';
  const input = document.createElement('textarea');
  input.rows = 3;
  input.placeholder = 'https://example.org/event-page.html\n(one URL per line)';
  input.className = 'xqb-ops-import-url';
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = 'Preview';
  preview.className = 'xqb-ops-button xqb-ops-button-secondary';
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = 'Import';
  importButton.className = 'xqb-ops-button';
  const result = document.createElement('div');
  result.className = 'xqb-ops-poll-result xqb-ops-import-result';
  row.append(input, preview, importButton, result);

  const resultLine = (text: string, extraClass?: string): HTMLElement => {
    const line = document.createElement('div');
    line.className = extraClass ? `xqb-ops-result-line ${extraClass}` : 'xqb-ops-result-line';
    line.textContent = text;
    return line;
  };

  const run = async (dryRun: boolean) => {
    const urls = parseSourceUrls(input.value);
    if (urls.length === 0) {
      result.replaceChildren(resultLine('Enter at least one source URL.'));
      return;
    }
    preview.disabled = true;
    importButton.disabled = true;
    const verb = dryRun ? 'Previewing' : 'Importing';
    let ok = 0;
    const failures: string[] = [];
    try {
      for (let index = 0; index < urls.length; index += 1) {
        const sourceUrl = urls[index]!;
        result.replaceChildren(resultLine(`${verb} ${index + 1}/${urls.length}...`));
        try {
          const response = await fetch('/api/admin/xiangqi/broadcasts/import', {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ sourceUrl, dryRun, allowCorrection: false }),
          });
          const payload = (await response.json()) as PollResponse;
          if (!response.ok || !payload.result?.ok) {
            failures.push(
              `${shortSourceLabel(sourceUrl)}: ${payload.result?.message ?? payload.error ?? 'failed'}`,
            );
          } else {
            ok += 1;
            if (urls.length === 1) {
              result.replaceChildren(
                resultLine(
                  `${pollSummary(payload.result)} (tour: ${payload.result.tourSlug ?? '?'})`,
                ),
              );
            }
          }
        } catch {
          failures.push(`${shortSourceLabel(sourceUrl)}: request failed`);
        }
      }
      if (urls.length > 1 || failures.length > 0) {
        const summary = `${dryRun ? 'Previewed' : 'Imported'} ${ok}/${urls.length}${
          failures.length ? `, ${failures.length} failed` : ''
        }`;
        result.replaceChildren(
          resultLine(summary),
          ...failures.slice(0, 10).map((message) => resultLine(message, 'xqb-ops-result-fail')),
        );
      }
      if (!dryRun && ok > 0) await refresh(body);
    } finally {
      preview.disabled = false;
      importButton.disabled = false;
    }
  };
  preview.onclick = () => {
    void run(true);
  };
  importButton.onclick = () => {
    void run(false);
  };

  panel.append(title, hint, row);
  return panel;
}

async function refresh(body: HTMLElement): Promise<void> {
  body.replaceChildren(statusLine('Loading...'));
  try {
    const data = await fetchOps();
    if (data.tours.length === 0) {
      body.replaceChildren(statusLine('No xiangqi broadcasts have been imported yet.'));
      return;
    }
    body.replaceChildren(...data.tours.map((tour) => tourPanel(tour, body)));
  } catch (err) {
    body.replaceChildren(
      statusLine(err instanceof AdminRequiredError ? err.message : 'Could not load ops data.'),
    );
  }
}

async function fetchOps(): Promise<OpsResponse> {
  const response = await fetch('/api/admin/xiangqi/broadcasts', {
    headers: { accept: 'application/json' },
  });
  if (response.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!response.ok) throw new Error(`broadcast_ops_failed_${response.status}`);
  return (await response.json()) as OpsResponse;
}

function tourPanel(entry: OpsTour, body: HTMLElement): HTMLElement {
  const section = document.createElement('article');
  section.className = 'xqb-ops-panel';

  const top = document.createElement('div');
  top.className = 'xqb-ops-panel-top';
  const copy = document.createElement('div');
  copy.className = 'xqb-ops-copy';
  const title = document.createElement('h2');
  title.textContent = entry.tour.name;
  const meta = document.createElement('p');
  meta.textContent = [
    entry.tour.location ?? null,
    entry.tour.startsAt ? formatDate(entry.tour.startsAt) : null,
    `Updated ${formatDateTime(entry.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  copy.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'xqb-ops-actions';
  const view = document.createElement('a');
  view.href = `/broadcast/xiangqi/${encodeURIComponent(entry.tour.slug)}`;
  view.textContent = 'View';
  view.className = 'xqb-ops-link';
  const correctionLabel = document.createElement('label');
  correctionLabel.className = 'xqb-ops-correction';
  const correction = document.createElement('input');
  correction.type = 'checkbox';
  correction.disabled = !entry.sourceUrl;
  const correctionText = document.createElement('span');
  correctionText.textContent = 'Allow corrections';
  correctionLabel.append(correction, correctionText);
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = 'Preview';
  preview.className = 'xqb-ops-button xqb-ops-button-secondary';
  preview.disabled = !entry.sourceUrl;
  preview.title = 'Dry run: shows what this poll would change without writing anything';
  const poll = document.createElement('button');
  poll.type = 'button';
  poll.textContent = 'Poll';
  poll.className = 'xqb-ops-button';
  poll.disabled = !entry.sourceUrl;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.className = 'xqb-ops-button xqb-ops-button-danger';
  remove.title = 'Permanently delete this broadcast (boards, rounds, and sync logs)';
  const result = document.createElement('span');
  result.className = 'xqb-ops-poll-result';
  actions.append(view, correctionLabel, preview, poll, remove, result);
  top.append(copy, actions);

  const stats = document.createElement('dl');
  stats.className = 'xqb-ops-stats';
  stats.append(
    stat('Rounds', entry.roundCount),
    stat('Boards', entry.boardCount),
    stat('Live', entry.liveBoardCount),
    stat('Complete', entry.completeBoardCount),
    stat('Scheduled', entry.scheduledBoardCount),
    stat('Plies', entry.totalPlies),
  );

  const source = document.createElement('p');
  source.className = entry.sourceUrl ? 'xqb-ops-source' : 'xqb-ops-source xqb-ops-source-missing';
  source.textContent = entry.sourceUrl ? `Source: ${entry.sourceUrl}` : 'Source: not configured';

  const schedule = schedulePanel(entry);

  const health = sourceHealthPanel(entry.sourceHealth);

  const logs = document.createElement('div');
  logs.className = 'xqb-ops-logs';
  const logsTitle = document.createElement('h3');
  logsTitle.textContent = 'Recent sync';
  logs.append(logsTitle);
  if (entry.syncLogs.length === 0) {
    logs.append(statusLine('No sync logs yet.'));
  } else {
    const list = document.createElement('ul');
    for (const log of entry.syncLogs) list.append(logRow(log));
    logs.append(list);
  }

  poll.onclick = () => {
    void runPoll(entry, { allowCorrection: correction.checked, dryRun: false }, poll, result, body);
  };
  preview.onclick = () => {
    void runPoll(
      entry,
      { allowCorrection: correction.checked, dryRun: true },
      preview,
      result,
      body,
    );
  };
  remove.onclick = () => {
    if (
      !confirm(`Delete broadcast "${entry.tour.name}" (${entry.tour.slug})? This cannot be undone.`)
    )
      return;
    void (async () => {
      remove.disabled = true;
      result.textContent = 'Deleting...';
      try {
        const response = await fetch(
          `/api/admin/xiangqi/broadcasts/${encodeURIComponent(entry.tour.slug)}`,
          { method: 'DELETE', headers: { accept: 'application/json' } },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          result.textContent = payload.error ?? 'Delete failed';
          remove.disabled = false;
          return;
        }
        await refresh(body);
      } catch {
        result.textContent = 'Delete failed';
        remove.disabled = false;
      }
    })();
  };

  section.append(top, stats, source, schedule, health, logs);
  return section;
}

const POLL_MODE_LABELS: Record<PollMode, string> = { auto: 'Auto', on: 'On', off: 'Off' };

function windowTime(value: string | null): string {
  return formatEventDateTime(value ?? undefined, 'en-US') ?? 'unknown';
}

/** One line: whether the tour polls now, and why. The window reads on the
 *  event's clock, like every other broadcast date. */
export function pollStatusText(schedule: OpsSchedule): string {
  const state = schedule.pollState;
  const cadence = state.afterEvent
    ? 'every 30 min while late records land'
    : `every ${Math.round(schedule.pollIntervalMs / 1000)}s`;
  switch (state.reason) {
    case 'on':
      return `Polling now, ${cadence} (on: always)`;
    case 'auto-open':
      return `Polling now, ${cadence} (auto: window closes ${windowTime(state.closesAt)})`;
    case 'off':
      return 'Not polling (off)';
    case 'no-source':
      return 'Not polling (no source URL)';
    case 'auto-undated':
      return 'Not polling (auto: the tour has no dates; choose On to poll it)';
    case 'auto-before':
      return `Not polling (auto: window opens ${windowTime(state.opensAt)})`;
    case 'auto-closed':
      return `Not polling (auto: window closed ${windowTime(state.closesAt)})`;
  }
}

export function schedulePanel(entry: OpsTour): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'xqb-ops-schedule';

  const modes = document.createElement('div');
  modes.className = 'xqb-ops-poll-modes';
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'Polling');
  const modeInputs = new Map<PollMode, HTMLInputElement>();
  for (const mode of ['auto', 'on', 'off'] as const) {
    const label = document.createElement('label');
    label.className = 'xqb-ops-poll-mode';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `xqb-poll-mode-${entry.tour.slug}`;
    input.value = mode;
    input.checked = entry.schedule.pollMode === mode;
    // On needs a source; auto and off are always valid.
    input.disabled = mode === 'on' && !entry.sourceUrl;
    const text = document.createElement('span');
    text.textContent = POLL_MODE_LABELS[mode];
    label.append(input, text);
    modes.append(label);
    modeInputs.set(mode, input);
  }

  const intervalLabel = document.createElement('label');
  intervalLabel.className = 'xqb-ops-schedule-interval';
  const interval = document.createElement('input');
  interval.type = 'number';
  interval.min = '5';
  interval.max = '300';
  interval.step = '5';
  interval.value = String(Math.round(entry.schedule.pollIntervalMs / 1000));
  const intervalText = document.createElement('span');
  intervalText.textContent = 'seconds';
  intervalLabel.append(interval, intervalText);

  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save schedule';
  save.className = 'xqb-ops-button xqb-ops-button-secondary';

  const status = document.createElement('span');
  status.className = 'xqb-ops-poll-result';
  status.dataset.polling = String(entry.schedule.pollState.polling);
  status.textContent = pollStatusText(entry.schedule);

  save.onclick = async () => {
    const seconds = Number(interval.value);
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 300) {
      status.textContent = 'Interval must be 5-300 seconds.';
      return;
    }
    const mode = [...modeInputs.entries()].find(([, input]) => input.checked)?.[0] ?? 'auto';
    save.disabled = true;
    status.textContent = 'Saving...';
    try {
      const response = await fetch(
        `/api/admin/xiangqi/broadcasts/${encodeURIComponent(entry.tour.slug)}/schedule`,
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ mode, intervalMs: seconds * 1000 }),
        },
      );
      const payload = (await response.json()) as { schedule?: OpsSchedule; error?: string };
      if (!response.ok || !payload.schedule) {
        status.textContent = payload.error ?? 'Save failed';
        return;
      }
      status.dataset.polling = String(payload.schedule.pollState.polling);
      status.textContent = pollStatusText(payload.schedule);
    } catch {
      status.textContent = 'Save failed';
    } finally {
      save.disabled = false;
    }
  };

  panel.append(modes, intervalLabel, save, status);
  return panel;
}

function pollSummary(result: NonNullable<PollResponse['result']>): string {
  const counts = new Map<string, number>();
  for (const update of result.updates ?? []) {
    const key = update.ok ? (update.status ?? 'ok') : (update.kind ?? 'failed');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const statusSummary = [...counts.entries()].map(([key, count]) => `${key}=${count}`).join(' ');
  const sourceSummary =
    (result.sourcesSeen ?? 1) > 1 || (result.sourcesFailed ?? 0) > 0
      ? `, ${result.sourcesFailed ?? 0}/${result.sourcesSeen ?? 1} sources failed`
      : '';
  const prefix = result.dryRun ? 'Preview (no writes): ' : '';
  return `${prefix}${result.boardsSeen ?? 0} boards, ${result.boardsFailed ?? 0} failed${sourceSummary}${
    statusSummary ? ` (${statusSummary})` : ''
  }`;
}

async function runPoll(
  entry: OpsTour,
  options: { allowCorrection: boolean; dryRun: boolean },
  button: HTMLButtonElement,
  result: HTMLElement,
  body: HTMLElement,
): Promise<void> {
  button.disabled = true;
  result.textContent = options.dryRun ? 'Previewing...' : 'Polling...';
  try {
    const response = await fetch(
      `/api/admin/xiangqi/broadcasts/${encodeURIComponent(entry.tour.slug)}/poll`,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(options),
      },
    );
    const payload = (await response.json()) as PollResponse;
    if (!response.ok || !payload.result?.ok) {
      result.textContent = payload.result?.message ?? payload.error ?? 'Poll failed';
      return;
    }
    result.textContent = pollSummary(payload.result);
    if (!options.dryRun) await refresh(body);
  } catch {
    result.textContent = options.dryRun ? 'Preview failed' : 'Poll failed';
  } finally {
    button.disabled = !entry.sourceUrl;
  }
}

function stat(label: string, value: number): HTMLElement {
  const item = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = String(value);
  item.append(dt, dd);
  return item;
}

function logRow(log: SyncLog): HTMLElement {
  const item = document.createElement('li');
  item.className = `xqb-ops-log xqb-ops-log-${log.severity}`;
  const top = document.createElement('div');
  const badge = document.createElement('span');
  badge.textContent = log.severity;
  const kind = document.createElement('strong');
  kind.textContent = log.kind;
  const time = document.createElement('time');
  time.dateTime = log.createdAt;
  time.textContent = formatDateTime(log.createdAt);
  top.append(badge, kind, time);
  const message = document.createElement('p');
  message.textContent = log.message;
  item.append(top, message);
  return item;
}

function sourceHealthPanel(health: SourceHealth): HTMLElement {
  const panel = document.createElement('div');
  panel.className = `xqb-ops-health xqb-ops-health-${health.state}`;

  const summary = document.createElement('div');
  summary.className = 'xqb-ops-health-summary';
  const badge = document.createElement('span');
  badge.textContent = health.state.replace('_', ' ');
  const label = document.createElement('strong');
  label.textContent = health.label;
  const checked = document.createElement('time');
  if (health.checkedAt) checked.dateTime = health.checkedAt;
  checked.textContent = `Checked ${formatDateTime(health.checkedAt)}`;
  summary.append(badge, label, checked);

  const detail = document.createElement('p');
  detail.textContent =
    health.lastKind && health.lastMessage ? `${health.lastKind}: ${health.lastMessage}` : '';

  const buckets = document.createElement('dl');
  buckets.className = 'xqb-ops-health-buckets';
  buckets.append(
    bucket('OK', health.buckets.successfulPolls),
    bucket('Fetch', health.buckets.fetchFailures),
    bucket('Parse', health.buckets.parseFailures),
    bucket('Data', health.buckets.dataFailures),
    bucket('Config', health.buckets.configFailures),
    bucket('Operator', health.buckets.operatorFailures),
    bucket('Corrections', health.buckets.corrections),
  );

  panel.append(summary);
  if (detail.textContent) panel.append(detail);
  panel.append(buckets);
  return panel;
}

function bucket(label: string, value: number): HTMLElement {
  const item = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = String(value);
  item.append(dt, dd);
  return item;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'xqb-ops-status';
  p.textContent = text;
  return p;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
