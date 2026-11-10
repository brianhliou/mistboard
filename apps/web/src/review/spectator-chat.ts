import './spectator-chat.css';
import { t } from '../i18n/catalog.js';
import { isSignedIn, signedInResolvedEvent } from '../signed-in-state.js';
import { attachChatResize } from './chat-resize.js';

type ChatLine = { id: string; handle: string | null; text: string; createdAt: string };
type ChatState = {
  lines: ChatLine[];
  canPost: boolean;
  canReport: boolean;
  viewerHandle: string | null;
  timeoutUntil?: string;
};

const POLL_MS = 7000;
const LIVE_POLL_MS = 2000;
const VISIBLE_LINES = 80;
const TOKEN_PATTERN = /(@[a-z0-9_-]+|(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/gi;
const QUICK_CHAT_MESSAGES = ['GG', 'WP', 'TY', 'GTG', 'BYE'] as const;
/** Poll ticks a demoted panel keeps re-probing its gated room before settling. */
const PROMOTE_ATTEMPTS = 5;
/**
 * How long the live room's chat waits for the socket's hello to say whether this
 * viewer holds a seat before it probes the player room anyway.
 */
const SEAT_WAIT_MS = 5000;

/** Fired on window by a live room's socket once its hello names this viewer's seat. */
export const LIVE_ROOM_SEAT_EVENT = 'mistboard:live-room-seat';
type LiveRoomSeatDetail = { roomId: string; seated: boolean };
const announcedSeats = new Map<string, boolean>();

/**
 * The room's socket calls this on every hello. The server persists the seat
 * before it sends the hello, so a player-room probe made after it cannot beat
 * the seat into the database, and a viewer the hello names a spectator never
 * probes the seat-gated room at all.
 */
export function announceLiveRoomSeat(roomId: string, seated: boolean): void {
  announcedSeats.set(roomId, seated);
  window.dispatchEvent(
    new CustomEvent<LiveRoomSeatDetail>(LIVE_ROOM_SEAT_EVENT, { detail: { roomId, seated } }),
  );
}

/** Resolves with the hello's answer, or null when none arrives in time. */
function awaitLiveRoomSeat(roomId: string, timeoutMs: number): Promise<boolean | null> {
  const known = announcedSeats.get(roomId);
  if (known !== undefined) return Promise.resolve(known);
  return new Promise((resolve) => {
    const onSeat = (event: Event) => {
      const detail = (event as CustomEvent<LiveRoomSeatDetail>).detail;
      if (detail?.roomId === roomId) finish(detail.seated);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    function finish(seated: boolean | null): void {
      window.clearTimeout(timer);
      window.removeEventListener(LIVE_ROOM_SEAT_EVENT, onSeat);
      resolve(seated);
    }
    window.addEventListener(LIVE_ROOM_SEAT_EVENT, onSeat);
  });
}

type GameChatOptions = {
  ariaLabel: string;
  live: boolean;
  pollMs: number;
  title: string;
  /** Chat API base for this room. Defaults to the per-game endpoint. */
  apiUrl?: string;
  /**
   * Public room for guests and viewers refused by the player seat gate (403).
   * Falling back is a demotion, so quick chat goes with it.
   */
  fallback?: { apiUrl: string; title: string };
  /** Live room: hold the first probe until the socket's hello names the seat. */
  seatOf?: string;
  /** Desktop game/review rails can give this room a persisted height control. */
  resizable?: boolean;
};

/**
 * Mutable per-panel resolution: which room this panel actually ended up in.
 * `settled` stays false until the first load picks a room, so polling never
 * probes the gated room ahead of it; `promoteAttemptsLeft` is the re-probe budget.
 */
type ChatSession = {
  active: boolean;
  stop: () => void;
  apiUrl: string;
  live: boolean;
  demoted: boolean;
  settled: boolean;
  promoteAttemptsLeft: number;
};

/** The three regions a room's state renders into. */
type ChatPanelUi = { tab: HTMLElement; feed: HTMLElement; footer: HTMLElement };

export function buildSpectatorChat(roomId: string): HTMLElement {
  return buildGameChat(roomId, {
    ariaLabel: 'Spectator chat',
    live: false,
    pollMs: POLL_MS,
    title: t('review.spectatorRoom'),
    resizable: true,
  });
}

/**
 * The live room's chat panel. Players talk in the seat-gated player room; that
 * conversation is theirs, and never shows up in the spectator room the review
 * page serves. Anyone without a seat is demoted to the spectator room, which is
 * the same room the review page reads, so spectators see one continuous
 * conversation across the live game and its review.
 */
export function buildLiveRoomChat(roomId: string): HTMLElement {
  return buildGameChat(roomId, {
    ariaLabel: 'Game chat',
    live: true,
    pollMs: LIVE_POLL_MS,
    title: t('study.chatRoom'),
    apiUrl: playerChatApiUrl(roomId),
    fallback: { apiUrl: gameChatApiUrl(roomId), title: t('review.spectatorRoom') },
    seatOf: roomId,
    resizable: true,
  });
}

/** Per-study chat room (lichess study anatomy) — same component, study-scoped API. */
export function buildStudyChat(studyId: string): HTMLElement {
  return buildGameChat(studyId, {
    ariaLabel: 'Study chat',
    live: false,
    pollMs: POLL_MS,
    title: t('study.chatRoom'),
    apiUrl: studyChatApiUrl(studyId),
    // The live and review chats have had the drag separator all along; the study
    // chat was the one call site that never asked for it, so a study reader had
    // no way to give a busy thread more room.
    resizable: true,
  });
}

/**
 * A broadcast event's room (lichess's relay chat): one per event, shared by
 * its boards grid and every board, so the conversation stays put while a
 * reader moves between boards.
 */
export function buildBroadcastChat(tourSlug: string): HTMLElement {
  return buildGameChat(tourSlug, {
    ariaLabel: 'Broadcast chat',
    live: false,
    pollMs: POLL_MS,
    title: t('broadcast.chatRoom'),
    apiUrl: `/api/chat/broadcast/${encodeURIComponent(tourSlug)}`,
  });
}

/** Fired (bubbling) from a chat panel when a poll brings in lines. */
export const CHAT_LINES_EVENT = 'mistboard:chat-lines';

/** The event's detail: how many of the new lines someone else wrote (the
 *  viewer's own, posted from another tab, do not count as news). */
export interface ChatLinesDetail {
  fromOthers: number;
}

/** A poll's new lines as the event reports them: the viewer's own lines
 *  (posted from another tab) are not news. */
export function chatLinesDetail(
  incoming: readonly { handle: string | null }[],
  viewerHandle: string | null | undefined,
): ChatLinesDetail {
  return {
    fromOthers: incoming.filter((line) => !viewerHandle || line.handle !== viewerHandle).length,
  };
}

function buildGameChat(roomId: string, options: GameChatOptions): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'review-spectator-chat';
  if (options.live) panel.classList.add('review-spectator-chat--live');
  panel.setAttribute('aria-label', options.ariaLabel);

  const header = document.createElement('div');
  header.className = 'review-spectator-chat__tabs';
  const tab = document.createElement('div');
  tab.className = 'review-spectator-chat__tab review-spectator-chat__tab--active';
  tab.textContent = options.title;
  header.append(tab);

  const feed = document.createElement('div');
  feed.className = 'review-spectator-chat__feed';

  const footer = document.createElement('div');
  footer.className = 'review-spectator-chat__footer';
  renderStatus(footer, t('live.chatLoading'));

  panel.append(header, feed, footer);
  if (options.resizable) attachChatResize(panel);

  const known = new Set<string>();
  const ui: ChatPanelUi = { tab, feed, footer };
  let session: ChatSession;
  let signedIn = isSignedIn();
  const restart = () => {
    session?.stop();
    let stopPolling: (() => void) | undefined;
    const next: ChatSession = {
      active: true,
      stop: () => {
        next.active = false;
        stopPolling?.();
      },
      apiUrl: options.apiUrl ?? gameChatApiUrl(roomId),
      live: options.live,
      demoted: false,
      settled: false,
      promoteAttemptsLeft: options.fallback ? PROMOTE_ATTEMPTS : 0,
    };
    session = next;
    feed.replaceChildren();
    known.clear();
    tab.textContent = options.title;
    renderStatus(footer, t('live.chatLoading'));
    void hydrateGameChat(next, ui, known, options).then(() => {
      if (next.active) stopPolling = startPolling(next, panel, ui, known, options);
    });
  };
  restart();

  if (options.live) {
    const onAuth = () => {
      if (signedIn === isSignedIn()) return;
      signedIn = isSignedIn();
      restart();
    };
    window.addEventListener(signedInResolvedEvent, onAuth);
    // Live panels listen for auth even when a 401 has stopped their timer.
    // Release that listener and invalidate pending reads when the route leaves.
    const observer = new MutationObserver((records) => {
      if (panel.isConnected) return;
      if (
        !records.some((record) => [...record.removedNodes].some((node) => node.contains(panel)))
      ) {
        return;
      }
      session.stop();
      window.removeEventListener(signedInResolvedEvent, onAuth);
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return panel;
}

export function gameChatApiUrl(roomId: string): string {
  return `/api/chat/game/${encodeURIComponent(roomId)}`;
}

export function playerChatApiUrl(roomId: string): string {
  return `/api/chat/player/${encodeURIComponent(roomId)}`;
}

export function studyChatApiUrl(studyId: string): string {
  return `/api/chat/study/${encodeURIComponent(studyId)}`;
}

async function hydrateGameChat(
  session: ChatSession,
  ui: ChatPanelUi,
  known: Set<string>,
  options: GameChatOptions,
): Promise<void> {
  const signedIn = isSignedIn();
  const seated =
    options.seatOf && signedIn ? await awaitLiveRoomSeat(options.seatOf, SEAT_WAIT_MS) : null;
  if (!session.active) return;
  const demote = (fallback: { apiUrl: string; title: string }) => {
    session.apiUrl = fallback.apiUrl;
    session.live = false;
    session.demoted = true;
    ui.tab.textContent = fallback.title;
  };
  let result: Awaited<ReturnType<typeof fetchGameChat>>;
  if ((!signedIn || seated === false) && options.fallback) {
    // The hello says spectator: read the spectator room and never knock on
    // the players' door (a refused probe is a 403 in every viewer's console).
    demote(options.fallback);
    session.promoteAttemptsLeft = 0;
    result = await fetchSessionChat(session, session.apiUrl, ui);
  } else {
    result = await fetchSessionChat(session, session.apiUrl, ui);
    if (session.active && !result.state && options.fallback && result.status === 403) {
      demote(options.fallback);
      result = await fetchSessionChat(session, session.apiUrl, ui);
    }
  }
  if (!session.active) return;
  session.settled = true;
  if (!result.state || !Array.isArray(result.state.lines)) {
    renderStatus(ui.footer, t('live.chatUnavailable'));
    return;
  }
  renderRoom(session, ui, known, result.state);
}

/** Invalidate a refused or superseded read before it can render or retry. */
async function fetchSessionChat(session: ChatSession, apiUrl: string, ui: ChatPanelUi) {
  if (!session.active) return { state: null, status: 0 };
  const result = await fetchGameChat(apiUrl);
  if (!session.active) return { state: null, status: 0 };
  if (result.status === 401) {
    session.stop();
    renderStatus(ui.footer, t('live.chatUnavailable'));
  }
  return result;
}

/** Replace the panel's contents with a room's state (first load, or a promotion). */
function renderRoom(
  session: ChatSession,
  ui: ChatPanelUi,
  known: Set<string>,
  state: ChatState,
): void {
  ui.feed.replaceChildren();
  known.clear();
  appendLines(ui.feed, state.lines.slice(-VISIBLE_LINES), known, state, session.apiUrl);
  renderFooter(ui.footer, state, session, ui.feed, known);
}

function startPolling(
  session: ChatSession,
  panel: HTMLElement,
  ui: ChatPanelUi,
  known: Set<string>,
  options: GameChatOptions,
): () => void {
  // The live room waits for the hello (announceLiveRoomSeat) before its first
  // probe, so a player no longer beats their own seat token into the database.
  // When no hello arrives in time the panel probes anyway and may demote; then
  // it re-probes for a bounded window and promotes once the seat lands, rather
  // than stranding a player in the spectator room until they reload. A viewer
  // the hello names a spectator has no budget and polls one room.
  let polling = false;
  const timer = window.setInterval(async () => {
    if (!panel.isConnected) {
      session.stop();
      return;
    }
    if (document.visibilityState !== 'visible') return;
    if (!session.active || !session.settled || polling) return;
    polling = true;
    try {
      if (session.demoted && session.promoteAttemptsLeft > 0 && options.apiUrl) {
        session.promoteAttemptsLeft -= 1;
        const promoted = await fetchSessionChat(session, options.apiUrl, ui);
        if (!session.active) return;
        if (promoted.state) {
          session.apiUrl = options.apiUrl;
          session.live = options.live;
          session.demoted = false;
          ui.tab.textContent = options.title;
          renderRoom(session, ui, known, promoted.state);
          return;
        }
      }
      const { state } = await fetchSessionChat(session, session.apiUrl, ui);
      if (!session.active) return;
      if (!state) return;
      const incoming = state.lines.filter((line) => !known.has(line.id)).slice(-VISIBLE_LINES);
      appendLines(ui.feed, incoming, known, state, session.apiUrl);
      // The phone room and the phone game review keep the chat in a closed sheet
      // and mark ☰ unread. Lines already shown at load are in `known`, so only a
      // poll's new lines reach here.
      if (incoming.length > 0) {
        panel.dispatchEvent(
          new CustomEvent<ChatLinesDetail>(CHAT_LINES_EVENT, {
            bubbles: true,
            detail: chatLinesDetail(incoming, state.viewerHandle),
          }),
        );
      }
    } finally {
      polling = false;
    }
  }, options.pollMs);
  return () => window.clearInterval(timer);
}

function renderFooter(
  footer: HTMLElement,
  state: ChatState,
  session: ChatSession,
  feed: HTMLElement,
  known: Set<string>,
): void {
  footer.replaceChildren();
  if (state.canPost) {
    footer.append(buildComposer(session.apiUrl, feed, known, state, session.live));
    return;
  }
  if (state.timeoutUntil) {
    renderStatus(footer, t('live.chatTimedOut'));
    return;
  }
  const signIn = document.createElement('a');
  signIn.className = 'review-spectator-chat__signin';
  signIn.href = '/account?tab=login';
  signIn.textContent = t('study.chatSignIn');
  footer.append(signIn);
}

function buildComposer(
  apiUrl: string,
  feed: HTMLElement,
  known: Set<string>,
  state: ChatState,
  includeQuickChat: boolean,
): HTMLElement {
  const form = document.createElement('form');
  form.className = 'review-spectator-chat__composer';

  const input = document.createElement('input');
  input.className = 'review-spectator-chat__input';
  input.type = 'text';
  input.maxLength = 140;
  input.placeholder = t('study.chatPlaceholder');

  const status = document.createElement('span');
  status.className = 'review-spectator-chat__status';
  status.hidden = true;

  const sendMessage = async (text: string): Promise<boolean> => {
    if (!text) return false;
    setComposerDisabled(form, true);
    status.hidden = true;
    try {
      const line = await postGameChatLine(apiUrl, text);
      input.value = '';
      appendLines(feed, [line], known, state, apiUrl);
      return true;
    } catch (error) {
      status.textContent = postErrorCopy(error instanceof ChatPostError ? error.code : undefined);
      status.hidden = false;
      return false;
    } finally {
      setComposerDisabled(form, false);
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    await sendMessage(text);
    input.focus();
  });

  form.append(input, status);
  if (includeQuickChat) form.append(buildQuickChat(sendMessage));
  return form;
}

function buildQuickChat(sendMessage: (text: string) => Promise<boolean>): HTMLElement {
  const quickChat = document.createElement('div');
  quickChat.className = 'review-spectator-chat__quick';
  quickChat.setAttribute('aria-label', 'Quick chat');
  for (const message of QUICK_CHAT_MESSAGES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-spectator-chat__quick-button';
    button.textContent = message;
    button.addEventListener('click', () => void sendMessage(message));
    quickChat.append(button);
  }
  return quickChat;
}

function setComposerDisabled(form: HTMLFormElement, disabled: boolean): void {
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    'input, button',
  )) {
    control.disabled = disabled;
  }
}

function appendLines(
  feed: HTMLElement,
  lines: ChatLine[],
  known: Set<string>,
  state: Pick<ChatState, 'canReport' | 'viewerHandle'>,
  apiUrl: string,
): void {
  if (lines.length === 0) return;
  const wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
  for (const line of lines) {
    if (known.has(line.id)) continue;
    known.add(line.id);
    const row = document.createElement('div');
    row.className = 'review-spectator-chat__line';
    const who = document.createElement('a');
    who.className = 'review-spectator-chat__handle';
    who.href = line.handle ? `/@/${encodeURIComponent(line.handle)}` : '#';
    who.textContent = line.handle ?? 'deleted';
    const text = document.createElement('span');
    text.className = 'review-spectator-chat__text';
    appendChatText(text, line.text);
    row.append(who, text);
    if (canReportLine(state, line)) row.append(buildReportControl(apiUrl, line));
    feed.append(row);
  }
  if (wasAtBottom) feed.scrollTop = feed.scrollHeight;
}

function canReportLine(
  state: Pick<ChatState, 'canReport' | 'viewerHandle'>,
  line: ChatLine,
): boolean {
  return !!state.canReport && !!line.handle && line.handle !== state.viewerHandle;
}

function buildReportControl(apiUrl: string, line: ChatLine): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-spectator-chat__report';
  button.title = 'Report message';
  button.textContent = '!';
  button.addEventListener('click', async () => {
    button.disabled = true;
    const resp = await fetch(`${apiUrl}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineId: line.id, reason: 'Chat message report' }),
    }).catch(() => null);
    if (resp?.ok || resp?.status === 409) {
      button.textContent = 'reported';
      button.title = 'Reported';
      button.classList.add('is-reported');
      return;
    }
    button.disabled = false;
    button.title = 'Report failed';
  });
  return button;
}

function renderStatus(container: HTMLElement, text: string): void {
  container.replaceChildren();
  const status = document.createElement('p');
  status.className = 'review-spectator-chat__empty';
  status.textContent = text;
  container.append(status);
}

function appendChatText(container: HTMLElement, text: string): void {
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? cursor;
    if (index > cursor) container.append(document.createTextNode(text.slice(cursor, index)));
    const token = document.createElement('span');
    token.className = 'review-spectator-chat__token';
    token.textContent = match[0];
    container.append(token);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

/** Status comes back with the state so a refusal (401/403) can be told apart from
 *  a network failure — only the former should demote the panel to its fallback. */
async function fetchGameChat(apiUrl: string): Promise<{ state: ChatState | null; status: number }> {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return { state: null, status: response.status };
    return { state: (await response.json()) as ChatState, status: response.status };
  } catch {
    return { state: null, status: 0 };
  }
}

class ChatPostError extends Error {
  constructor(readonly code: string | undefined) {
    super(code ?? 'chat_post_failed');
  }
}

async function postGameChatLine(apiUrl: string, text: string): Promise<ChatLine> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ChatPostError(data.error);
  }
  const data = (await response.json()) as { line: ChatLine };
  return data.line;
}

function postErrorCopy(error: string | undefined): string {
  if (error === 'rate_limited' || error === 'repeated_message') return 'Please slow down.';
  if (error === 'links_not_allowed') return 'Links are not available for this account yet.';
  if (error === 'timed_out') return 'You are temporarily timed out from chat.';
  return 'Could not send that message.';
}
