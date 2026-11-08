// Homepage lobby-chat widget (gate-cleared 2026-07-02). Server-driven: the
// widget renders NOTHING until the first fetch confirms the chat flag is on,
// so a flag-off deploy never shows a dead box and the env flag doubles as a
// kill switch. Windowing: the feed only ever shows the last CHAT_VISIBLE_LINES
// messages posted within CHAT_WINDOW_MS (mirrors server CHAT_POLICY
// visibleLines/quietAfterMs). Messages age out continuously via a low-frequency
// tick, and every render path goes through the same windowed store, so a new
// post can never resurrect lines older than the window. Quiet-collapse: when
// the window is empty the box renders as a one-line invitation instead of an
// empty scrollback, so a low-traffic homepage never wears a dead chat room.
// Human lines only (2026-10-17, Brian): the derived activity rows (bot wins,
// new studies) are gone, and the feed reads `lines` alone, so a server that
// still sends an `events` field renders nothing extra.

import './landing-chat.css';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildSiteBox } from './site-box.js';

export type ChatLine = { id: string; handle: string | null; text: string; createdAt: string };
// The release drain's restart notice (#651), the one system message the lobby
// keeps. The server derives it from live drain state on every read and never
// stores it as a line, so it is absent once the drain is cancelled or lapses.
export type LobbyChatNotice = {
  id: string;
  kind: 'server_restart';
  phase: 'pending' | 'restarting';
  restartAt: number;
};
type ChatState = {
  lines: ChatLine[];
  notice?: LobbyChatNotice;
  canPost: boolean;
  canReport: boolean;
  viewerHandle: string | null;
  timeoutUntil?: string;
  isAdmin: boolean;
};

const POLL_MS = 7000;
// Visibility window and cap match server chat policy (chat-policy.ts:
// quietAfterMs / visibleLines). The server retains 200 lines and serves 100;
// the client shows at most the newest 30 from the last seven days.
export const CHAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CHAT_VISIBLE_LINES = 30;
const AGE_OUT_TICK_MS = 60 * 1000;

type LandingChatMode = 'live' | 'mock';

// The mute toggle is a persistent per-browser preference: a viewer who mutes the
// lobby chat expects it to stay muted across reloads and navigations, not reset
// every page load. Mirrors the theme.ts sound-muted pattern (string boolean,
// cached fallback so a thrown localStorage degrades gracefully).
const CHAT_MUTED_STORAGE_KEY = 'mistboard.chatMuted';
let cachedChatMuted = false;

export function readStoredChatMuted(): boolean {
  try {
    cachedChatMuted = window.localStorage.getItem(CHAT_MUTED_STORAGE_KEY) === 'true';
    return cachedChatMuted;
  } catch {
    return cachedChatMuted;
  }
}

function writeStoredChatMuted(muted: boolean): void {
  cachedChatMuted = muted;
  try {
    window.localStorage.setItem(CHAT_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Mute state still applies for the current page.
  }
}

// The windowed view: lines newer than `now - CHAT_WINDOW_MS`, capped to the
// newest CHAT_VISIBLE_LINES. Lines with unparseable timestamps are dropped
// (fail closed: never show a line we cannot age out).
export function visibleChatWindow<T extends { createdAt: string }>(lines: T[], now: number): T[] {
  const cutoff = now - CHAT_WINDOW_MS;
  const fresh = lines.filter((line) => {
    const at = Date.parse(line.createdAt);
    return Number.isFinite(at) && at > cutoff;
  });
  return fresh.slice(-CHAT_VISIBLE_LINES);
}

export function buildLandingChat(
  options: { hydrate?: boolean; mode?: LandingChatMode } = {},
): HTMLElement {
  // A plain placeholder mount, not a site-box: nothing paints unless the API
  // says the room exists. The prerendered shell carries this empty div, so
  // there is no reserved footprint to jank when chat is disabled.
  const mount = document.createElement('div');
  mount.className = 'landing-chat-mount';
  if (options.hydrate !== false) void hydrateChat(mount, options.mode ?? 'live');
  return mount;
}

// Poll/age-out intervals are page-scoped but re-hydration is not: the quiet
// composer, the mute toggle, and the age-out empty swap all re-render into the
// same mount. Track interval ids per mount so a re-render never stacks a
// second poller on top of a live one.
const mountTimers = new WeakMap<HTMLElement, number[]>();

function registerMountTimer(mount: HTMLElement, id: number): void {
  const ids = mountTimers.get(mount) ?? [];
  ids.push(id);
  mountTimers.set(mount, ids);
}

function clearMountTimers(mount: HTMLElement): void {
  for (const id of mountTimers.get(mount) ?? []) window.clearInterval(id);
  mountTimers.delete(mount);
}

async function hydrateChat(mount: HTMLElement, mode: LandingChatMode): Promise<void> {
  clearMountTimers(mount);
  const locale = currentLocale();
  const state = mode === 'mock' ? mockChatState() : await fetchChat();
  if (!state) return; // disabled or unreachable: render nothing

  const { box, body } = buildSiteBox({
    title: mode === 'mock' ? 'Chat room' : t('chat.title', {}, locale),
    className: 'landing-chat',
  });
  const top = box.querySelector('.site-box-top');
  top?.append(buildChatToggle(box, body, mount, mode, locale));

  // Honor a persisted mute: render the box + toggle in the muted state (no feed,
  // no pollers) so a muted viewer's preference survives reload. The toggle
  // unmutes on demand. Mock mode ignores it so the preview always shows the room.
  if (mode !== 'mock' && readStoredChatMuted()) {
    box.classList.add('is-chat-muted');
    clearMountTimers(mount);
    mount.replaceChildren(box);
    return;
  }

  // Quiet when the visibility window is empty, not merely when the latest
  // line is old: the same predicate that decides what the room renders.
  if (visibleChatWindow(state.lines, Date.now()).length === 0) {
    renderQuiet(body, state, locale, mount, mode);
  } else {
    renderRoom(body, state, locale, mode, mount);
  }
  mount.replaceChildren(box);
}

function buildChatToggle(
  box: HTMLElement,
  body: HTMLElement,
  mount: HTMLElement,
  mode: LandingChatMode,
  locale: Locale,
): HTMLButtonElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'landing-chat-toggle';
  toggle.title = mode === 'mock' ? 'Toggle chat preview' : t('chat.title', {}, locale);
  toggle.addEventListener('click', () => {
    if (box.classList.contains('is-chat-muted')) {
      if (mode !== 'mock') writeStoredChatMuted(false);
      void hydrateChat(mount, mode);
      return;
    }
    if (mode !== 'mock') writeStoredChatMuted(true);
    box.classList.add('is-chat-muted');
    clearMountTimers(mount);
    body.replaceChildren();
  });
  return toggle;
}

// Quiet mode: one inviting line and, for signed-in users, the composer right
// there: the first message is the expansion. No empty scrollback ever shows.
function renderQuiet(
  body: HTMLElement,
  state: ChatState,
  locale: Locale,
  mount: HTMLElement,
  mode: LandingChatMode,
): void {
  body.replaceChildren();
  let notice: LobbyChatNotice | null = null;
  let noticeRow: HTMLElement | null = null;
  function updateNotice(next: LobbyChatNotice | undefined): void {
    const active = activeNotice(next, Date.now());
    if (
      active?.id === notice?.id &&
      active?.phase === notice?.phase &&
      active?.restartAt === notice?.restartAt
    ) {
      return;
    }
    notice = active;
    noticeRow?.remove();
    noticeRow = null;
    if (!notice) return;
    const row = buildNoticeRow(notice, locale);
    noticeRow = row;
    body.prepend(row);
    // Expire locally even if a later poll fails or the tab is hidden.
    registerMountTimer(
      mount,
      window.setTimeout(() => row.remove(), notice.restartAt - Date.now()),
    );
  }
  updateNotice(state.notice);
  const row = document.createElement('p');
  row.className = 'landing-chat-quiet';
  row.textContent = t('chat.quiet', {}, locale);
  body.append(row);
  if (state.canPost) {
    body.append(
      buildComposer(
        locale,
        () => {
          // First message: swap to the live room so the sender sees it land.
          // The room re-renders through the windowed store, so this swap can
          // only surface lines still inside the visibility window.
          void hydrateChat(mount, mode);
        },
        mode === 'mock' ? postMockLine : undefined,
      ),
    );
  } else {
    body.append(buildSignInRow(locale));
  }

  // Quiet rooms still need live drain updates. Only replace the notice so a
  // poll leaves the invitation and any unfinished composer text intact.
  if (mode === 'mock' || import.meta.env.MODE === 'test') return;
  const pollTimer = window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const fresh = await fetchChat();
    if (!fresh || !mountTimers.get(mount)?.includes(pollTimer)) return;
    updateNotice(fresh.notice);
  }, POLL_MS);
  registerMountTimer(mount, pollTimer);
}

type LandingChatFeed = {
  element: HTMLElement;
  ingest(lines: ChatLine[]): void;
  // Replaces, never appends: each lobby read carries the whole notice state.
  setNotice(notice: LobbyChatNotice | null): void;
  expireTick(): void;
  remove(lineId: string): void;
  visibleIds(): string[];
};

// The single owner of what the feed shows. All mutations (initial load, poll
// merges, local echo of a just-posted line, age-out ticks, admin hides) funnel
// into the same windowed store and re-render from it; there is no code path
// that renders an unfiltered line list. The store IS the visible window:
// anything that falls out (too old, or beyond the cap) is discarded, so it can
// never be resurrected by a later render.
export function createLandingChatFeed(options: {
  state: Pick<ChatState, 'canReport' | 'isAdmin' | 'viewerHandle'>;
  locale: Locale;
  mode: LandingChatMode;
  now?: () => number;
  onEmpty?: () => void;
}): LandingChatFeed {
  const clock = options.now ?? Date.now;
  const feed = document.createElement('div');
  feed.className = 'landing-chat-feed';
  // Lines the viewer reported this page-life: re-renders keep the mark.
  const reported = new Set<string>();
  let store: ChatLine[] = [];
  let notice: LobbyChatNotice | null = null;
  let renderedKey: string | null = null;

  const handle: LandingChatFeed = {
    element: feed,
    ingest(lines: ChatLine[]): void {
      const byId = new Map(store.map((line) => [line.id, line]));
      for (const line of lines) {
        if (!byId.has(line.id)) byId.set(line.id, line);
      }
      store = [...byId.values()].sort(byCreatedAtThenId);
      render();
    },
    setNotice(next: LobbyChatNotice | null): void {
      notice = next;
      render();
    },
    expireTick(): void {
      render();
    },
    remove(lineId: string): void {
      store = store.filter((line) => line.id !== lineId);
      render();
    },
    visibleIds(): string[] {
      return visibleChatWindow(store, clock()).map((line) => line.id);
    },
  };

  function render(): void {
    const now = clock();
    store = visibleChatWindow(store, now);
    notice = activeNotice(notice, now);
    const key = [
      ...store.map((line) => line.id),
      ...(notice ? [`notice:${notice.id}:${notice.phase}`] : []),
    ].join('\n');
    if (key === renderedKey) return;
    renderedKey = key;
    feed.replaceChildren();
    for (const line of store) {
      feed.append(
        buildLineRow(line, options.state, options.locale, options.mode, reported, handle, now),
      );
    }
    if (notice) feed.append(buildNoticeRow(notice, options.locale));
    feed.scrollTop = feed.scrollHeight;
    if (store.length === 0) options.onEmpty?.();
  }

  // render() pins to the newest line, but the first render runs before the
  // feed is laid out (the box, and on page load the homepage tree, attach
  // after it), when there is no height to scroll. Pin once it gets a size.
  if (typeof ResizeObserver !== 'undefined') {
    const pinOnLayout = new ResizeObserver(() => {
      if (feed.clientHeight === 0) return;
      feed.scrollTop = feed.scrollHeight;
      pinOnLayout.disconnect();
    });
    pinOnLayout.observe(feed);
  }

  return handle;
}

function byCreatedAtThenId(a: ChatLine, b: ChatLine): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function renderRoom(
  body: HTMLElement,
  state: ChatState,
  locale: Locale,
  mode: LandingChatMode,
  mount: HTMLElement,
): void {
  body.replaceChildren();
  let latestState = state;

  const feed = createLandingChatFeed({
    state,
    locale,
    mode,
    onEmpty: () => {
      // Everything aged out: collapse back to the quiet invitation instead of
      // wearing an empty scrollback.
      clearMountTimers(mount);
      renderQuiet(body, latestState, locale, mount, mode);
    },
  });
  feed.ingest(state.lines);
  feed.setNotice(state.notice ?? null);
  body.append(feed.element);

  if (state.canPost) {
    body.append(
      buildComposer(
        locale,
        (line) => {
          if (line) feed.ingest([line]);
        },
        mode === 'mock' ? postMockLine : undefined,
      ),
    );
  } else if (state.timeoutUntil) {
    const note = document.createElement('p');
    note.className = 'landing-chat-quiet';
    note.textContent = t('chat.timedOut', {}, locale);
    body.append(note);
  } else {
    body.append(buildSignInRow(locale));
  }

  // Poll while the tab is visible; a slower tick ages lines out even when no
  // poll succeeds. Both intervals are mount-scoped (see mountTimers) and are
  // never started under vitest, matching review/spectator-chat.ts.
  if (mode === 'mock' || import.meta.env.MODE === 'test') return;
  registerMountTimer(
    mount,
    window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = await fetchChat();
      if (!fresh) return;
      latestState = fresh;
      feed.ingest(fresh.lines);
      feed.setNotice(fresh.notice ?? null);
    }, POLL_MS),
  );
  registerMountTimer(
    mount,
    window.setInterval(() => feed.expireTick(), AGE_OUT_TICK_MS),
  );
}

function buildLineRow(
  line: ChatLine,
  state: Pick<ChatState, 'canReport' | 'isAdmin' | 'viewerHandle'>,
  locale: Locale,
  mode: LandingChatMode,
  reported: Set<string>,
  feed: Pick<LandingChatFeed, 'remove'>,
  now: number,
): HTMLElement {
  // Block flow, not flex: timestamp and handle are inline prefixes, so a long
  // message wraps to the full row width from its second line instead of
  // staying in a narrow column beside them.
  const row = document.createElement('div');
  row.className = 'landing-chat-line';
  const who = document.createElement('a');
  who.className = 'landing-chat-handle';
  who.href = line.handle ? `/@/${encodeURIComponent(line.handle)}` : '#';
  who.textContent = line.handle ?? t('chat.deletedAccount', {}, locale);
  const timestamp = buildChatTimestamp(line.createdAt, locale, now);
  const text = document.createElement('span');
  text.className = 'landing-chat-text';
  appendChatText(text, line.text);
  row.append(timestamp, who, text);
  if (state.isAdmin && line.handle) {
    row.append(buildAdminControls(line, feed));
  } else if (canReportLine(state, line)) {
    row.append(buildReportControl(line, locale, mode, reported));
  }
  return row;
}

// A notice past its deadline is a drain that lapsed or a restart that already
// happened: drop it without waiting for the next read.
function activeNotice(
  notice: LobbyChatNotice | null | undefined,
  now: number,
): LobbyChatNotice | null {
  return notice && notice.restartAt > now ? notice : null;
}

// Same words as the site-wide restart banner (restart-banner.ts). Not a chat
// line: no author, no timestamp, nothing to report or hide.
function buildNoticeRow(notice: LobbyChatNotice, locale: Locale): HTMLElement {
  const row = document.createElement('div');
  row.className = 'landing-chat-notice';
  row.setAttribute('role', 'status');
  const label = document.createElement('strong');
  label.className = 'landing-chat-notice-label';
  const hint = document.createElement('span');
  hint.className = 'landing-chat-notice-hint';
  if (notice.phase === 'pending') {
    label.textContent = t('connection.restartPending', {}, locale);
    hint.textContent = t('connection.restartPendingHint', {}, locale);
  } else {
    label.textContent = t('connection.restartNow', {}, locale);
    hint.textContent = t('connection.restartNowHint', {}, locale);
  }
  row.append(label, hint);
  return row;
}

function buildChatTimestamp(createdAt: string, locale: Locale, now: number): HTMLTimeElement {
  const date = new Date(createdAt);
  const nowDate = new Date(now);
  // Same-day lines show time only; the weekday earns its width only once a
  // line is a day old (the seven-day window makes that common). The full date
  // stays one hover away in the title either way.
  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();
  const timestamp = document.createElement('time');
  timestamp.className = 'landing-chat-timestamp';
  timestamp.dateTime = createdAt;
  timestamp.textContent = new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : { weekday: 'short' as const }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  timestamp.title = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
  return timestamp;
}

function canReportLine(
  state: Pick<ChatState, 'canReport' | 'viewerHandle'>,
  line: ChatLine,
): boolean {
  return !!state.canReport && !!line.handle && line.handle !== state.viewerHandle;
}

// Admin-only inline moderation: hide the line, or 15-min timeout its author
// (which also strikes their other lines server-side). English-only, admin
// surface convention.
function buildAdminControls(line: ChatLine, feed: Pick<LandingChatFeed, 'remove'>): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'landing-chat-admin';

  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'landing-chat-admin-action';
  hide.title = 'Hide line';
  hide.textContent = '✕';
  hide.addEventListener('click', async () => {
    const resp = await fetch('/api/chat/lobby/hide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineId: line.id }),
    }).catch(() => null);
    // Remove from the store, not just the DOM: a later re-render would put a
    // DOM-only removal straight back.
    if (resp?.ok) feed.remove(line.id);
  });

  const timeout = document.createElement('button');
  timeout.type = 'button';
  timeout.className = 'landing-chat-admin-action';
  timeout.title = 'Timeout 15 min';
  timeout.textContent = '⏱';
  timeout.addEventListener('click', async () => {
    const resp = await fetch('/api/chat/lobby/timeout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: line.handle }),
    }).catch(() => null);
    if (resp?.ok) window.location.reload();
  });

  wrap.append(hide, timeout);
  return wrap;
}

function buildReportControl(
  line: ChatLine,
  locale: Locale,
  mode: LandingChatMode,
  reported: Set<string>,
): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'landing-chat-admin-action landing-chat-report-action';
  button.title = t('chat.report', {}, locale);
  button.textContent = '!';
  if (reported.has(line.id)) {
    markReportDone(button, locale);
    button.disabled = true;
    return button;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (mode === 'mock') {
      reported.add(line.id);
      markReportDone(button, locale);
      return;
    }
    const resp = await fetch('/api/chat/lobby/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineId: line.id, reason: 'Chat message report' }),
    }).catch(() => null);
    if (resp?.ok || resp?.status === 409) {
      reported.add(line.id);
      markReportDone(button, locale);
      return;
    }
    button.removeAttribute('aria-busy');
    button.textContent = '!';
    button.title = t('chat.reportFailed', {}, locale);
    button.disabled = false;
  });
  return button;
}

function markReportDone(button: HTMLButtonElement, locale: Locale): void {
  button.removeAttribute('aria-busy');
  button.textContent = t('chat.reportedShort', {}, locale);
  button.title = t('chat.reported', {}, locale);
  button.classList.add('is-reported');
}

function buildComposer(
  locale: Locale,
  onSent: (line: ChatLine | null) => void,
  postLine: (text: string) => Promise<ChatLine> = postLiveLine,
): HTMLElement {
  const form = document.createElement('form');
  form.className = 'landing-chat-composer';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 140;
  input.placeholder = t('chat.placeholder', {}, locale);
  input.className = 'landing-chat-input';

  // input[type=text] drops pasted newlines outright, gluing the surrounding
  // words together ("easyhttps://..."). Re-insert the paste with newlines
  // collapsed to single spaces instead.
  input.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text/plain');
    if (!pasted || !/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const normalized = pasted.replace(/\s*[\r\n]+\s*/g, ' ');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const next = (input.value.slice(0, start) + normalized + input.value.slice(end)).slice(
      0,
      input.maxLength,
    );
    input.value = next;
    const caret = Math.min(start + normalized.length, next.length);
    input.setSelectionRange(caret, caret);
  });

  const status = document.createElement('span');
  status.className = 'landing-chat-status';
  status.hidden = true;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    status.hidden = true;
    try {
      const line = await postLine(text);
      input.value = '';
      onSent(line);
    } catch (error) {
      const code = error instanceof ChatPostError ? error.code : undefined;
      status.textContent = postErrorCopy(code, locale);
      status.hidden = false;
      onSent(null);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  form.append(input, status);
  return form;
}

function buildSignInRow(locale: Locale): HTMLElement {
  const row = document.createElement('a');
  row.className = 'landing-chat-signin';
  row.href = '/account?tab=login';
  row.textContent = t('chat.signInToChat', {}, locale);
  return row;
}

function postErrorCopy(error: string | undefined, locale: Locale): string {
  const key: I18nKey =
    error === 'rate_limited'
      ? 'chat.rateLimited'
      : error === 'links_not_allowed'
        ? 'inbox.linksNotAllowed'
        : error === 'timed_out'
          ? 'chat.timedOut'
          : 'chat.sendFailed';
  return t(key, {}, locale);
}

const TOKEN_PATTERN = /(@[a-z0-9_-]+|(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/gi;

const INTERNAL_LINK_HOSTS = new Set(['mistboard.com', 'www.mistboard.com']);

// URL and @mention tokens render as real anchors. Mistboard links become
// path-relative same-tab hrefs (so they also resolve on dev/preview hosts);
// external links open in a new tab with the full ugc/noopener rel set. The
// label is always textContent, and only the tokenizer's https?/bare-domain
// shapes reach here, so no other scheme can end up in an href.
export function chatTokenElement(token: string): HTMLElement {
  if (token.startsWith('@')) {
    const mention = document.createElement('a');
    mention.className = 'landing-chat-token';
    mention.href = `/@/${encodeURIComponent(token.slice(1))}`;
    mention.textContent = token;
    return mention;
  }
  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(token) ? token : `https://${token}`);
  } catch {
    url = null;
  }
  if (!url) {
    const span = document.createElement('span');
    span.className = 'landing-chat-token';
    span.textContent = token;
    return span;
  }
  const anchor = document.createElement('a');
  anchor.className = 'landing-chat-token';
  anchor.textContent = token;
  if (INTERNAL_LINK_HOSTS.has(url.hostname.toLowerCase())) {
    anchor.href = `${url.pathname}${url.search}${url.hash}`;
  } else {
    anchor.href = url.href;
    anchor.target = '_blank';
    anchor.rel = 'ugc nofollow noopener noreferrer';
  }
  return anchor;
}

export function appendChatText(container: HTMLElement, text: string): void {
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) container.append(document.createTextNode(text.slice(cursor, index)));
    container.append(chatTokenElement(match[0]));
    cursor = index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

async function fetchChat(): Promise<ChatState | null> {
  try {
    const resp = await fetch('/api/chat/lobby');
    if (!resp.ok) return null;
    return (await resp.json()) as ChatState;
  } catch {
    return null;
  }
}

class ChatPostError extends Error {
  constructor(readonly code: string | undefined) {
    super(code ?? 'chat_post_failed');
  }
}

async function postLiveLine(text: string): Promise<ChatLine> {
  const resp = await fetch('/api/chat/lobby', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new ChatPostError(data.error);
  }
  const data = (await resp.json()) as { line: ChatLine };
  return data.line;
}

async function postMockLine(text: string): Promise<ChatLine> {
  return {
    id: `mock_${Date.now().toString(36)}`,
    handle: 'you',
    text,
    createdAt: new Date().toISOString(),
  };
}

function mockChatState(): ChatState {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60 * 1000).toISOString();
  return {
    canPost: true,
    canReport: true,
    viewerHandle: 'you',
    isAdmin: false,
    lines: [
      {
        id: 'mock_chat_1',
        handle: 'lin_xq',
        text: 'anyone up for a 5+5 jieqi?',
        createdAt: ago(95),
      },
      {
        id: 'mock_chat_2',
        handle: 'brianhliou-dev',
        text: 'Congrats on the Pikafish win @rebirthfox333, not easy',
        createdAt: ago(9),
      },
    ],
  };
}
