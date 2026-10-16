// /inbox and /inbox/:handle — the DM surface (#88). Two panes: a contacts rail
// (thread list, unread markers) and the open conversation (messages +
// composer). Realtime is polling: the open conversation re-fetches every few
// seconds while the tab is visible; the server marks a conversation read as a
// side effect of loading it, so the nav bell drains by itself.

import './inbox.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { openConfirmDialog } from './confirm-dialog.js';
import { t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { refreshNotifications } from './notification-nav.js';
import { buildLoadingState, buildNav, buildNotice, fetchCurrentUser } from './site-shell.js';

type ThreadSummary = {
  other: { handle: string; displayName: string };
  lastText: string;
  lastFromMe: boolean;
  lastAt: string;
  unread: boolean;
};

type DmMessage = { id: string; fromMe: boolean; bodyText: string; createdAt: string };
type OnlinePlayer = { handle: string; displayName: string; playing?: boolean };
type InboxRenderState = {
  threads: ThreadSummary[];
  threadsLoadFailed: boolean;
  query: string;
  onlineHandles: Set<string>;
};

const CONVO_POLL_MS = 4000;
const ONLINE_POLL_MS = 60_000;
const HANDLE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const SEND_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 3.8 20.4 12 5 20.2v-6.1L13.2 12 5 9.9z"/></svg>';
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
const REPORT_ICON =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.3 3.9 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const BACK_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"/></svg>';

// Set once per mount; renderThreads rebuilds the contacts rail on every poll
// refresh, so the admin queue link has to survive re-renders via module state.
let viewerIsAdmin = false;

export async function mountInbox(root: HTMLElement, handle: string | null): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'inbox-route');
  root.append(buildNav(locale), buildLoadingState(t('inbox.loading', {}, locale)));

  const user = await fetchCurrentUser().catch(() => null);
  const shell = document.createElement('main');
  shell.className = 'inbox-shell';
  root.replaceChildren(buildNav(locale), shell);

  if (!user) {
    window.location.href = loginHrefForCurrentPage(locale);
    return;
  }

  viewerIsAdmin = user.accountRole === 'admin';
  if (handle) shell.classList.add('inbox-has-convo');

  const state: InboxRenderState = {
    threads: [],
    threadsLoadFailed: false,
    query: '',
    onlineHandles: new Set(),
  };

  const side = document.createElement('section');
  side.className = 'inbox-side';
  side.setAttribute('aria-label', t('inbox.title', {}, locale));
  const threadContent = document.createElement('div');
  threadContent.className = 'inbox-side-content';
  const search = buildThreadSearch((query) => {
    state.query = query;
    renderThreadContent(threadContent, handle, locale, state);
  });
  side.append(search, threadContent);

  const convo = document.createElement('section');
  convo.className = 'inbox-convo';
  shell.append(side, convo);

  await Promise.all([loadThreads(state), refreshOnlinePresence(state)]);
  renderThreadContent(threadContent, handle, locale, state);
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshOnlinePresence(state).then(() => {
      renderThreadContent(threadContent, handle, locale, state);
    });
  }, ONLINE_POLL_MS);

  if (handle) {
    await openConversation(convo, threadContent, state, handle, locale);
  }
}

function buildThreadSearch(onInput: (query: string) => void): HTMLElement {
  const form = document.createElement('form');
  form.className = 'inbox-search';
  form.role = 'search';

  const input = document.createElement('input');
  input.className = 'inbox-search-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search or start new conversation';
  input.setAttribute('aria-label', input.placeholder);

  input.addEventListener('input', () => onInput(input.value));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const handle = input.value.trim();
    if (HANDLE_PATTERN.test(handle)) window.location.href = `/inbox/${encodeURIComponent(handle)}`;
  });

  form.append(input);
  return form;
}

async function loadThreads(state: InboxRenderState): Promise<void> {
  const resp = await fetch('/api/inbox').catch(() => null);
  if (!resp?.ok) {
    state.threads = [];
    state.threadsLoadFailed = true;
    return;
  }
  const data = (await resp.json()) as { threads: ThreadSummary[] };
  state.threads = data.threads;
  state.threadsLoadFailed = false;
}

async function refreshOnlinePresence(state: InboxRenderState): Promise<void> {
  const resp = await fetch('/api/players/online').catch(() => null);
  if (!resp?.ok) return;
  const data = (await resp.json()) as { players: OnlinePlayer[] };
  state.onlineHandles = new Set(data.players.map((player) => player.handle.toLowerCase()));
}

function renderThreadContent(
  container: HTMLElement,
  activeHandle: string | null,
  locale: Locale,
  state: InboxRenderState,
): void {
  container.replaceChildren();

  if (viewerIsAdmin) {
    // Admin-only entry point. Amber-tint it + tag it "Admin only" (matching the
    // forum moderation badge) so it never reads as ordinary inbox navigation.
    const reports = document.createElement('a');
    reports.className = 'inbox-admin-link';
    reports.href = '/inbox/reports';
    const reportsLabel = document.createElement('span');
    reportsLabel.textContent = 'Message reports';
    const reportsBadge = document.createElement('span');
    reportsBadge.className = 'inbox-admin-badge';
    reportsBadge.textContent = 'Admin only';
    reports.append(reportsLabel, reportsBadge);
    container.append(reports);
  }

  if (state.threadsLoadFailed) {
    container.append(
      buildNotice(t('inbox.loadFailedTitle', {}, locale), t('inbox.loadFailedBody', {}, locale)),
    );
    return;
  }

  const query = state.query.trim();
  const normalizedQuery = query.toLowerCase();
  const visibleThreads = normalizedQuery
    ? state.threads.filter((thread) => threadMatchesQuery(thread, normalizedQuery))
    : state.threads;
  const exactThread = normalizedQuery
    ? state.threads.some((thread) => thread.other.handle.toLowerCase() === normalizedQuery)
    : false;
  const canStart = query.length > 0 && HANDLE_PATTERN.test(query) && !exactThread;

  if (state.threads.length === 0 && !canStart) {
    const empty = document.createElement('p');
    empty.className = 'account-copy inbox-empty';
    empty.textContent = t('inbox.empty', {}, locale);
    container.append(empty);
    return;
  }

  if (canStart) container.append(buildStartConversationRow(query));
  if (visibleThreads.length === 0) {
    if (query.length > 0 && !canStart) {
      const empty = document.createElement('p');
      empty.className = 'account-copy inbox-empty';
      empty.textContent = 'No conversations match.';
      container.append(empty);
    }
    return;
  }

  const list = document.createElement('ul');
  list.className = 'inbox-thread-list';
  for (const thread of visibleThreads) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/inbox/${encodeURIComponent(thread.other.handle)}`;
    link.className = 'inbox-thread';
    if (thread.unread) link.classList.add('inbox-thread-unread');
    if (activeHandle && thread.other.handle.toLowerCase() === activeHandle.toLowerCase()) {
      link.classList.add('inbox-thread-active');
    }

    const avatar = buildPresenceAvatar(thread.other.handle, state.onlineHandles);

    const body = document.createElement('span');
    body.className = 'inbox-thread-body';
    const top = document.createElement('span');
    top.className = 'inbox-thread-top';
    const who = document.createElement('span');
    who.className = 'inbox-thread-handle';
    who.textContent = thread.other.displayName || thread.other.handle;
    const when = document.createElement('span');
    when.className = 'inbox-thread-date';
    when.textContent = formatRelativeWhen(thread.lastAt, locale);
    top.append(who, when);

    const preview = document.createElement('span');
    preview.className = 'inbox-thread-preview';
    preview.textContent = thread.lastFromMe
      ? `${t('inbox.you', {}, locale)} ${thread.lastText}`
      : thread.lastText;

    body.append(top, preview);
    link.append(avatar, body);
    item.append(link);
    list.append(item);
  }
  container.append(list);
}

function buildStartConversationRow(handle: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'inbox-thread inbox-thread-new';
  link.href = `/inbox/${encodeURIComponent(handle)}`;
  const avatar = buildPresenceAvatar(handle, new Set());
  const body = document.createElement('span');
  body.className = 'inbox-thread-body';
  const title = document.createElement('span');
  title.className = 'inbox-thread-handle';
  title.textContent = handle;
  const preview = document.createElement('span');
  preview.className = 'inbox-thread-preview';
  preview.textContent = 'Start a new conversation';
  body.append(title, preview);
  link.append(avatar, body);
  return link;
}

function buildPresenceAvatar(handle: string, onlineHandles: Set<string>): HTMLElement {
  const avatar = document.createElement('span');
  avatar.className = 'inbox-presence-avatar';
  const online = onlineHandles.has(handle.toLowerCase());
  if (online) avatar.classList.add('inbox-presence-online');
  avatar.title = online ? 'Online' : 'Offline';
  avatar.setAttribute('aria-label', online ? 'Online' : 'Offline');
  return avatar;
}

function threadMatchesQuery(thread: ThreadSummary, query: string): boolean {
  return (
    thread.other.handle.toLowerCase().includes(query) ||
    thread.other.displayName.toLowerCase().includes(query) ||
    thread.lastText.toLowerCase().includes(query)
  );
}

async function openConversation(
  convo: HTMLElement,
  threadContent: HTMLElement,
  state: InboxRenderState,
  handle: string,
  locale: Locale,
): Promise<void> {
  convo.replaceChildren();

  const resp = await fetch(`/api/inbox/${encodeURIComponent(handle)}`).catch(() => null);
  if (resp?.status === 404) {
    convo.append(
      buildNotice(t('inbox.unknownUserTitle', {}, locale), t('inbox.unknownUserBody', {}, locale)),
    );
    return;
  }
  if (!resp?.ok) {
    convo.append(
      buildNotice(t('inbox.loadFailedTitle', {}, locale), t('inbox.loadFailedBody', {}, locale)),
    );
    return;
  }
  const data = (await resp.json()) as {
    other: { handle: string; displayName: string };
    messages: DmMessage[];
  };
  void refreshNotifications();

  const header = document.createElement('header');
  header.className = 'inbox-convo-header';

  const back = document.createElement('a');
  back.className = 'inbox-back';
  back.href = '/inbox';
  back.innerHTML = BACK_ICON;
  back.setAttribute('aria-label', t('inbox.backToList', {}, locale));

  const headerLeft = document.createElement('div');
  headerLeft.className = 'inbox-convo-head-left';
  const avatar = buildPresenceAvatar(data.other.handle, state.onlineHandles);
  avatar.classList.add('inbox-convo-avatar');

  const who = document.createElement('a');
  who.className = 'inbox-convo-handle';
  who.href = `/@/${encodeURIComponent(data.other.handle)}`;
  who.textContent = data.other.displayName || data.other.handle;
  headerLeft.append(back, avatar, who);

  const controls = document.createElement('div');
  controls.className = 'inbox-convo-controls';
  controls.append(buildReportControl(handle, locale), buildDeleteControl(handle, locale));

  header.append(headerLeft, controls);

  const feed = document.createElement('div');
  feed.className = 'inbox-messages';
  renderMessages(feed, data.messages, locale);

  // Every rendered message id, shared by the composer (own sends) and the poll
  // (incoming), so neither path can append a message the other already drew.
  const knownIds = new Set(data.messages.map((message) => message.id));

  const composer = buildComposer(handle, feed, threadContent, state, knownIds, locale);

  convo.append(header, feed, composer);
  feed.scrollTop = feed.scrollHeight;

  // Poll while visible. Page-scoped interval: navigation is a full page load
  // in this client, so there is nothing to tear down beyond tab lifetime.
  window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const refresh = await fetch(`/api/inbox/${encodeURIComponent(handle)}`).catch(() => null);
    if (!refresh?.ok) return;
    const fresh = (await refresh.json()) as { messages: DmMessage[] };
    const incoming = fresh.messages.filter((message) => !knownIds.has(message.id));
    if (incoming.length === 0) return;
    for (const message of incoming) knownIds.add(message.id);
    appendMessages(feed, incoming, locale);
    void refreshNotifications();
    void loadThreads(state).then(() => renderThreadContent(threadContent, handle, locale, state));
  }, CONVO_POLL_MS);
}

function renderMessages(feed: HTMLElement, messages: DmMessage[], locale: Locale): void {
  feed.replaceChildren();
  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'account-copy inbox-empty';
    empty.textContent = t('inbox.noMessages', {}, locale);
    feed.append(empty);
    return;
  }
  appendMessages(feed, messages, locale);
}

function appendMessages(feed: HTMLElement, messages: DmMessage[], locale: Locale): void {
  feed.querySelector('.inbox-empty')?.remove();
  let lastDay = feed.dataset.lastDay ?? '';
  for (const message of messages) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      const divider = document.createElement('div');
      divider.className = 'inbox-day';
      divider.textContent = formatDay(message.createdAt, locale);
      feed.append(divider);
      lastDay = day;
    }
    const row = document.createElement('div');
    row.className = message.fromMe ? 'inbox-message inbox-message-mine' : 'inbox-message';
    const bubble = document.createElement('p');
    bubble.className = 'inbox-bubble';
    const body = document.createElement('span');
    body.className = 'inbox-bubble-text';
    body.textContent = message.bodyText;
    const stamp = document.createElement('span');
    stamp.className = 'inbox-stamp';
    stamp.textContent = formatMessageTime(message.createdAt, locale);
    bubble.append(body, stamp);
    row.append(bubble);
    feed.append(row);
  }
  feed.dataset.lastDay = lastDay;
  feed.scrollTop = feed.scrollHeight;
}

function buildComposer(
  handle: string,
  feed: HTMLElement,
  threadContent: HTMLElement,
  state: InboxRenderState,
  knownIds: Set<string>,
  locale: Locale,
): HTMLElement {
  const form = document.createElement('form');
  form.className = 'inbox-composer';

  const input = document.createElement('textarea');
  input.className = 'inbox-input';
  input.rows = 1;
  input.maxLength = 5000;
  input.placeholder = t('inbox.composerPlaceholder', {}, locale);
  input.addEventListener('input', () => fitComposerInput(input));

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'inbox-send';
  send.innerHTML = SEND_ICON;
  send.setAttribute('aria-label', t('inbox.send', {}, locale));
  send.title = t('inbox.send', {}, locale);

  const status = document.createElement('p');
  status.className = 'inbox-status';
  status.hidden = true;

  // Enter sends, Shift+Enter for a newline (the DM convention).
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    status.hidden = true;
    try {
      const resp = await fetch(`/api/inbox/${encodeURIComponent(handle)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        status.textContent = sendErrorCopy(data.error, locale);
        status.hidden = false;
        return;
      }
      const data = (await resp.json()) as { message: DmMessage };
      knownIds.add(data.message.id);
      appendMessages(feed, [data.message], locale);
      input.value = '';
      fitComposerInput(input);
      void loadThreads(state).then(() => renderThreadContent(threadContent, handle, locale, state));
    } catch {
      status.textContent = t('inbox.sendFailed', {}, locale);
      status.hidden = false;
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  form.append(input, send, status);
  return form;
}

// The composer grows with its text up to COMPOSER_MAX_HEIGHT, then scrolls.
// Past one line it drops the pill shape: a 999px radius clips the corners of
// a multi-line message and leaves no room for the scrollbar.
const COMPOSER_MAX_HEIGHT = 220;
const COMPOSER_SINGLE_LINE_HEIGHT = 60;

export function fitComposerInput(input: HTMLTextAreaElement): void {
  input.style.height = 'auto';
  // border-box sizing: scrollHeight covers padding but not the border.
  const border = input.offsetHeight - input.clientHeight;
  const height = Math.min(input.scrollHeight + border, COMPOSER_MAX_HEIGHT);
  if (height > 0) input.style.height = `${height}px`;
  input.classList.toggle('is-multiline', height > COMPOSER_SINGLE_LINE_HEIGHT);
  input.style.overflowY = input.scrollHeight + border > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden';
}

function buildDeleteControl(handle: string, locale: Locale): HTMLElement {
  const button = buildHeaderIconButton(t('inbox.delete', {}, locale), TRASH_ICON);
  button.addEventListener('click', () => {
    openConfirmDialog({
      title: t('inbox.deleteConfirmTitle', {}, locale),
      body: t('inbox.deleteConfirmBody', {}, locale),
      confirmLabel: t('inbox.delete', {}, locale),
      confirmTone: 'danger',
      onConfirm: () => {
        void fetch(`/api/inbox/${encodeURIComponent(handle)}`, { method: 'DELETE' }).then(() => {
          window.location.href = '/inbox';
        });
      },
    });
  });
  return button;
}

// Report is an inline reveal (no browser prompt dialogs): the button swaps to
// a reason input + submit, and collapses to a "reported" note on success.
function buildReportControl(handle: string, locale: Locale): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'inbox-report';

  const button = buildHeaderIconButton(t('inbox.report', {}, locale), REPORT_ICON);

  const form = document.createElement('form');
  form.className = 'inbox-report-form';
  form.hidden = true;
  const reason = document.createElement('input');
  reason.type = 'text';
  reason.maxLength = 240;
  reason.placeholder = t('inbox.reportPrompt', {}, locale);
  reason.className = 'inbox-report-reason';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'inbox-report-submit';
  submit.textContent = t('inbox.report', {}, locale);
  form.append(reason, submit);

  button.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) reason.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = reason.value.trim();
    if (!text) return;
    submit.disabled = true;
    const resp = await fetch(`/api/inbox/${encodeURIComponent(handle)}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: text }),
    }).catch(() => null);
    submit.disabled = false;
    if (resp && (resp.ok || resp.status === 409)) {
      const note = document.createElement('span');
      note.className = 'inbox-reported-note';
      note.textContent = t('inbox.reported', {}, locale);
      wrap.replaceChildren(note);
    }
  });

  wrap.append(button, form);
  return wrap;
}

function buildHeaderIconButton(label: string, icon: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inbox-header-action';
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

function sendErrorCopy(error: string | undefined, locale: Locale): string {
  if (error === 'rate_limited') return t('inbox.rateLimited', {}, locale);
  if (error === 'message_not_allowed') return t('inbox.notAllowed', {}, locale);
  if (error === 'links_not_allowed') return t('inbox.linksNotAllowed', {}, locale);
  return t('inbox.sendFailed', {}, locale);
}

function formatRelativeWhen(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const divisions: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(LOCALE_META[locale].dateLocale, { numeric: 'auto' });
  for (const [unit, seconds] of divisions) {
    if (absSeconds >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return rtf.format(0, 'minute');
}

function formatMessageTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, { timeStyle: 'short' }).format(
    date,
  );
}

function formatDay(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    LOCALE_META[locale].dateLocale,
    sameDay ? { month: 'numeric', day: 'numeric', year: 'numeric' } : { dateStyle: 'medium' },
  ).format(date);
}

function formatWhen(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    LOCALE_META[locale].dateLocale,
    sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date);
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ── /inbox/reports — admin DM report queue ──────────────────────────────────
// Admin-only surface (English-only, forum-reports precedent): the API 403s
// non-admins in production, and this page just renders that refusal. Admins
// see reported threads only; there is no browse-all-DMs surface anywhere.

type DmReport = {
  id: string;
  threadId: string;
  reporterHandle: string | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
};

type AdminThread = {
  threadId: string;
  participants: { handle: string; displayName: string }[];
  messages: { senderHandle: string | null; bodyText: string; createdAt: string }[];
};

const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export async function mountInboxReports(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'inbox-route');

  const shell = document.createElement('main');
  shell.className = 'inbox-shell inbox-reports-shell';
  root.append(buildNav(locale), shell);

  const query = new URLSearchParams(window.location.search);
  const statusParam = query.get('status');
  const status = statusParam === 'resolved' || statusParam === 'dismissed' ? statusParam : 'open';

  const resp = await fetch(`/api/inbox/reports?status=${status}`).catch(() => null);
  if (resp?.status === 403) {
    shell.append(
      buildNotice('Admin access required', 'Message reports are available to moderators.'),
    );
    return;
  }
  if (!resp?.ok) {
    shell.append(buildNotice('Reports unavailable', 'The report queue could not load.'));
    return;
  }
  const data = (await resp.json()) as { reports: DmReport[] };

  const panel = document.createElement('section');
  panel.className = 'inbox-reports-panel';

  const header = document.createElement('header');
  header.className = 'inbox-reports-header';
  const title = document.createElement('h1');
  title.className = 'inbox-heading';
  title.textContent = 'Message reports';
  const back = document.createElement('a');
  back.className = 'inbox-back-link';
  back.href = '/inbox';
  back.textContent = '← Inbox';
  header.append(back, title);

  const filters = document.createElement('nav');
  filters.className = 'inbox-reports-filters';
  for (const option of REPORT_STATUSES) {
    const link = document.createElement('a');
    link.href = `/inbox/reports?status=${option}`;
    link.textContent = option;
    link.className =
      option === status
        ? 'inbox-reports-filter inbox-reports-filter-active'
        : 'inbox-reports-filter';
    filters.append(link);
  }

  panel.append(header, filters);

  if (data.reports.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'account-copy inbox-empty';
    empty.textContent = `No ${status} reports.`;
    panel.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'inbox-reports-list';
    for (const report of data.reports) {
      list.append(buildReportRow(report, locale));
    }
    panel.append(list);
  }

  shell.replaceChildren(panel);
}

function buildReportRow(report: DmReport, locale: Locale): HTMLElement {
  const item = document.createElement('li');
  item.className = 'inbox-reports-row';

  const summary = document.createElement('div');
  summary.className = 'inbox-reports-summary';
  const meta = document.createElement('span');
  meta.className = 'inbox-reports-meta';
  meta.textContent = `${report.reporterHandle ? `@${report.reporterHandle}` : 'deleted account'} · ${formatWhen(report.createdAt, locale)}`;
  const reason = document.createElement('p');
  reason.className = 'inbox-reports-reason';
  reason.textContent = report.reason;
  summary.append(meta, reason);

  const actions = document.createElement('div');
  actions.className = 'inbox-reports-actions';

  const threadSlot = document.createElement('div');
  threadSlot.className = 'inbox-reports-thread';
  threadSlot.hidden = true;

  const view = document.createElement('button');
  view.type = 'button';
  view.className = 'inbox-header-action';
  view.textContent = 'View thread';
  view.addEventListener('click', async () => {
    if (!threadSlot.hidden) {
      threadSlot.hidden = true;
      return;
    }
    if (threadSlot.childElementCount === 0) {
      view.disabled = true;
      const loaded = await fetchAdminThread(report.threadId);
      view.disabled = false;
      if (!loaded) {
        threadSlot.textContent = 'Thread could not load.';
      } else {
        renderAdminThread(threadSlot, loaded, locale);
      }
    }
    threadSlot.hidden = false;
  });
  actions.append(view);

  if (report.status === 'open') {
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 240;
    note.placeholder = 'Resolution note (optional)';
    note.className = 'inbox-report-reason';

    for (const [label, status] of [
      ['Resolve', 'resolved'],
      ['Dismiss', 'dismissed'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inbox-header-action';
      button.textContent = label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        const resp = await fetch(`/api/inbox/reports/${encodeURIComponent(report.id)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, note: note.value.trim() || undefined }),
        }).catch(() => null);
        if (resp?.ok) item.remove();
        else button.disabled = false;
      });
      actions.append(button);
    }
    actions.append(note);
  }

  item.append(summary, actions, threadSlot);
  return item;
}

async function fetchAdminThread(threadId: string): Promise<AdminThread | null> {
  const resp = await fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}`).catch(() => null);
  if (!resp?.ok) return null;
  const data = (await resp.json()) as { thread: AdminThread };
  return data.thread;
}

function renderAdminThread(slot: HTMLElement, thread: AdminThread, locale: Locale): void {
  slot.replaceChildren();
  const who = document.createElement('p');
  who.className = 'inbox-reports-meta';
  who.textContent = thread.participants.map((p) => `@${p.handle}`).join(' ↔ ');
  slot.append(who);
  for (const message of thread.messages) {
    const line = document.createElement('p');
    line.className = 'inbox-reports-line';
    line.textContent = `${message.senderHandle ? `@${message.senderHandle}` : 'deleted'} · ${formatWhen(message.createdAt, locale)}: ${message.bodyText}`;
    slot.append(line);
  }
}
