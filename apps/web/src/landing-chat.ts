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
// Activity lines: the server also sends `events` (a human beat a bot, a new
// study), derived from finished games and studies. They share the
// feed, the window and the cap with human lines, so the room shows what is
// happening on the site even when nobody is typing; human lines keep the
// handle styling and stand out against the muted activity rows.

import './landing-chat.css';
import { track } from './analytics.js';
import { variantNameKeyForSpecId } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildSiteBox } from './site-box.js';

export type ChatLine = { id: string; handle: string | null; text: string; createdAt: string };
// One server-derived activity row. `handle` is the winner (null: a guest) or
// the study owner; `opponent` is the bot. PvP results never appear: a PvP win
// would name the person who lost.
export type ActivityEvent = {
  id: string;
  kind: 'bot-win' | 'study';
  createdAt: string;
  href: string;
  handle: string | null;
  opponent?: string;
  gameSpecId?: string;
  title?: string;
  /** Consecutive wins this row stands for (same winner, bot, variant). */
  count?: number;
};
export type FeedItem = ChatLine | ActivityEvent;
type ChatState = {
  lines: ChatLine[];
  events?: ActivityEvent[];
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

function isActivityEvent(item: FeedItem): item is ActivityEvent {
  return 'kind' in item;
}

// Human lines plus the activity rows this client can label. An event whose
// variant has no catalog name is dropped (fail closed), never shown raw.
export function feedItems(state: Pick<ChatState, 'lines' | 'events'>): FeedItem[] {
  const events = (state.events ?? []).filter(
    (event) => !event.gameSpecId || variantNameKeyForSpecId(event.gameSpecId) !== null,
  );
  return [...state.lines, ...events];
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
  if (visibleChatWindow(feedItems(state), Date.now()).length === 0) {
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
}

type LandingChatFeed = {
  element: HTMLElement;
  ingest(items: FeedItem[]): void;
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
  let store: FeedItem[] = [];
  let renderedKey: string | null = null;

  const handle: LandingChatFeed = {
    element: feed,
    ingest(items: FeedItem[]): void {
      const byId = new Map(store.map((item) => [item.id, item]));
      for (const item of items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
      store = [...byId.values()].sort(byCreatedAtThenId);
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
    const key = store.map((line) => line.id).join('\n');
    if (key === renderedKey) return;
    renderedKey = key;
    feed.replaceChildren();
    for (const item of store) {
      feed.append(
        isActivityEvent(item)
          ? buildEventRow(item, options.locale, now)
          : buildLineRow(item, options.state, options.locale, options.mode, reported, handle, now),
      );
    }
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

function byCreatedAtThenId(a: FeedItem, b: FeedItem): number {
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
  feed.ingest(feedItems(state));
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
      feed.ingest(feedItems(fresh));
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

// An activity row: muted, no handle column, no report control. The whole
// sentence is one link to the game or study; names inside it are bold text,
// because a second link per row would nest anchors.
function buildEventRow(event: ActivityEvent, locale: Locale, now: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'landing-chat-line landing-chat-event';
  row.dataset.kind = event.kind;
  const link = document.createElement('a');
  link.className = 'landing-chat-text landing-chat-event-text';
  link.href = event.href;
  // The read on this feature (2026-10-03): if nobody clicks these rows in four
  // weeks they are decoration, and the box is a candidate to remove.
  link.addEventListener('click', () => {
    track('chat_activity_clicked', { kind: event.kind, variant: event.gameSpecId ?? null });
  });
  appendEventSentence(link, event, locale);
  row.append(buildChatTimestamp(event.createdAt, locale, now), link);
  return row;
}

const EVENT_TEMPLATE_KEYS: Record<ActivityEvent['kind'], I18nKey> = {
  'bot-win': 'chat.eventBotWin',
  study: 'chat.eventStudy',
};

export function appendEventSentence(
  container: HTMLElement,
  event: ActivityEvent,
  locale: Locale,
): void {
  const variantKey = event.gameSpecId ? variantNameKeyForSpecId(event.gameSpecId) : null;
  const values: Record<string, { text: string; strong: boolean }> = {
    who: { text: event.handle ?? t('chat.eventGuest', {}, locale), strong: !!event.handle },
    bot: { text: event.opponent ?? '', strong: true },
    variant: { text: variantKey ? t(variantKey, {}, locale) : '', strong: false },
    title: { text: event.title ?? '', strong: false },
  };
  // The template is read raw (no params) so each placeholder can become its
  // own node; translations reorder them freely.
  const repeated = event.kind === 'bot-win' && (event.count ?? 1) > 1;
  const template = repeated
    ? t('chat.eventBotWinRepeat', { count: event.count ?? 1 }, locale)
    : t(EVENT_TEMPLATE_KEYS[event.kind], {}, locale);
  let cursor = 0;
  for (const match of template.matchAll(/\{([a-z]+)\}/g)) {
    const index = match.index ?? cursor;
    if (index > cursor) container.append(document.createTextNode(template.slice(cursor, index)));
    const value = values[match[1] ?? ''];
    if (value?.strong) {
      const strong = document.createElement('strong');
      strong.textContent = value.text;
      container.append(strong);
    } else {
      container.append(document.createTextNode(value?.text ?? ''));
    }
    cursor = index + match[0].length;
  }
  if (cursor < template.length) container.append(document.createTextNode(template.slice(cursor)));
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
    events: [
      {
        id: 'act_mock_1',
        kind: 'study',
        createdAt: ago(300),
        href: '/study/mock',
        handle: 'mistboard',
        title: 'Cao Yanlei: 75 games, January to September 2026',
      },
      {
        id: 'act_mock_2',
        kind: 'bot-win',
        createdAt: ago(220),
        href: '/jungle/game/mock',
        handle: 'kaoru',
        opponent: 'Misty',
        gameSpecId: 'jungle',
      },
      {
        id: 'act_mock_4',
        kind: 'bot-win',
        createdAt: ago(41),
        href: '/xiangqi/game/mock',
        handle: null,
        opponent: 'Fairy-Stockfish L4',
        gameSpecId: 'xiangqi',
      },
      {
        id: 'act_mock_5',
        kind: 'bot-win',
        createdAt: ago(12),
        href: '/jieqi/game/mock',
        handle: 'rebirthfox333',
        opponent: 'Pikafish L6',
        gameSpecId: 'jieqi',
      },
    ],
  };
}
