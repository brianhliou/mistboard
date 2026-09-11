// Unlisted admin review queue for title-verification requests (/titles).
// Pending requests (oldest first) with the submitted evidence and approve /
// reject actions, plus a recent-decisions history. Admin-gated by the
// /api/admin/titles endpoints (open in local dev), same idiom as /database.
// No nav entry; internal copy stays plain English like the other admin pages.

import './titles-admin.css';
import { isPlayerTitle, titleAbbr, titleFullName } from './player-titles.js';
import { buildNav } from './site-shell.js';

type AdminTitleRequest = {
  id: string;
  title: string;
  evidence: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  createdAt: string;
  handle: string;
  displayName: string;
  currentTitle: string | null;
};

class AdminRequiredError extends Error {}

export async function mountTitlesAdmin(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('titles-admin-page');

  const shell = document.createElement('main');
  shell.className = 'site-section titles-admin-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Title verification';

  const sub = document.createElement('p');
  sub.className = 'titles-admin-sub';
  sub.textContent = 'Internal · admin only. Player-facing form lives at /verify-title.';

  const pendingHost = document.createElement('section');
  pendingHost.className = 'titles-admin-pending-host';
  const decidedHost = document.createElement('section');
  decidedHost.className = 'titles-admin-decided-host';

  shell.append(heading, sub, pendingHost, decidedHost);
  // Same shell as /accounts and /metrics: the page sits under the site nav.
  root.append(buildNav(), shell);

  const refresh = async (): Promise<void> => {
    pendingHost.replaceChildren(statusLine('Loading…'));
    decidedHost.replaceChildren();
    let pending: AdminTitleRequest[];
    let decided: AdminTitleRequest[];
    try {
      [pending, decided] = await Promise.all([fetchRequests('pending'), fetchRequests('decided')]);
    } catch (err) {
      pendingHost.replaceChildren(
        statusLine(err instanceof AdminRequiredError ? err.message : 'Loading requests failed.'),
      );
      return;
    }
    pendingHost.replaceChildren(buildPendingQueue(pending, refresh));
    decidedHost.replaceChildren(buildDecidedHistory(decided));
  };

  await refresh();
}

async function fetchRequests(view: 'pending' | 'decided'): Promise<AdminTitleRequest[]> {
  const resp = await fetch(`/api/admin/titles/requests?status=${view}`);
  if (resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`admin titles fetch failed: ${resp.status}`);
  const data = (await resp.json()) as { requests: AdminTitleRequest[] };
  return data.requests;
}

function buildPendingQueue(
  requests: AdminTitleRequest[],
  refresh: () => Promise<void>,
): HTMLElement {
  const section = document.createElement('div');
  const head = document.createElement('h2');
  head.className = 'titles-admin-section-head';
  head.textContent = `Pending (${requests.length})`;
  section.append(head);

  if (requests.length === 0) {
    section.append(statusLine('No pending requests.'));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'titles-admin-list';
  for (const request of requests) {
    list.append(buildPendingRow(request, refresh));
  }
  section.append(list);
  return section;
}

function buildPendingRow(request: AdminTitleRequest, refresh: () => Promise<void>): HTMLElement {
  const item = document.createElement('li');
  item.className = 'titles-admin-row';

  const header = document.createElement('div');
  header.className = 'titles-admin-row-head';

  const claim = document.createElement('span');
  claim.className = 'titles-admin-claim';
  claim.textContent = titleDisplay(request.title);

  const who = document.createElement('a');
  who.href = `/@/${encodeURIComponent(request.handle)}`;
  who.textContent = `@${request.handle}`;

  const meta = document.createElement('span');
  meta.className = 'titles-admin-meta';
  const submitted = formatDate(request.createdAt);
  const held = isPlayerTitle(request.currentTitle)
    ? ` · holds ${titleAbbr(request.currentTitle)}`
    : '';
  meta.textContent = `${submitted}${held}`;

  header.append(claim, who, meta);

  const evidence = document.createElement('pre');
  evidence.className = 'titles-admin-evidence';
  evidence.textContent = request.evidence;

  const actions = document.createElement('div');
  actions.className = 'titles-admin-actions';
  const status = document.createElement('span');
  status.className = 'titles-admin-action-status';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'titles-admin-approve';
  approve.textContent = 'Approve';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'titles-admin-reject';
  reject.textContent = 'Reject';

  const decide = async (decision: 'approve' | 'reject'): Promise<void> => {
    approve.disabled = true;
    reject.disabled = true;
    status.textContent = 'Saving…';
    try {
      const resp = await fetch(
        `/api/admin/titles/requests/${encodeURIComponent(request.id)}/${decision}`,
        { method: 'POST' },
      );
      if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `decision failed: ${resp.status}`);
      }
      await refresh();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Decision failed.';
      approve.disabled = false;
      reject.disabled = false;
    }
  };
  approve.addEventListener('click', () => void decide('approve'));
  reject.addEventListener('click', () => void decide('reject'));

  actions.append(approve, reject, status);
  item.append(header, evidence, actions);
  return item;
}

function buildDecidedHistory(requests: AdminTitleRequest[]): HTMLElement {
  const section = document.createElement('div');
  const head = document.createElement('h2');
  head.className = 'titles-admin-section-head';
  head.textContent = 'Recent decisions';
  section.append(head);

  if (requests.length === 0) {
    section.append(statusLine('No decisions yet.'));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'titles-admin-list titles-admin-history';
  for (const request of requests) {
    const item = document.createElement('li');
    item.className = `titles-admin-history-row titles-admin-history-${request.status}`;

    const outcome = document.createElement('span');
    outcome.className = 'titles-admin-outcome';
    outcome.textContent = request.status === 'approved' ? 'Approved' : 'Rejected';

    const detail = document.createElement('span');
    detail.textContent = ` ${titleDisplay(request.title)} for @${request.handle}`;

    const when = document.createElement('span');
    when.className = 'titles-admin-meta';
    when.textContent = request.decidedAt ? ` · ${formatDate(request.decidedAt)}` : '';

    item.append(outcome, detail, when);
    list.append(item);
  }
  section.append(list);
  return section;
}

function titleDisplay(title: string): string {
  // Fail-closed on vocabulary drift: an unknown wire value renders as-is in
  // this internal tool instead of pretending to be a known title.
  return isPlayerTitle(title) ? `${titleAbbr(title)} (${titleFullName(title)})` : title;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'titles-admin-status';
  p.textContent = text;
  return p;
}
