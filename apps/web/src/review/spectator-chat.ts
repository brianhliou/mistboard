import './spectator-chat.css';
import { t } from '../i18n/catalog.js';
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

type GameChatOptions = {
  ariaLabel: string;
  live: boolean;
  pollMs: number;
  title: string;
  /** Chat API base for this room. Defaults to the per-game endpoint. */
  apiUrl?: string;
  /**
   * Where to land when the primary room refuses this viewer (401/403). The live
   * room asks for the players' private room first; a spectator (or a signed-out
   * player) is turned away by the seat gate and reads the spectator room
   * instead. Falling back is a demotion, so quick chat goes with it.
   */
  fallback?: { apiUrl: string; title: string };
  /** Desktop game/review rails can give this room a persisted height control. */
  resizable?: boolean;
};

/** Mutable per-panel resolution: which room this panel actually ended up in. */
type ChatSession = { apiUrl: string; live: boolean; demoted: boolean };

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
  renderStatus(footer, 'Loading chat...');

  panel.append(header, feed, footer);
  if (options.resizable) attachChatResize(panel);

  const session: ChatSession = {
    apiUrl: options.apiUrl ?? gameChatApiUrl(roomId),
    live: options.live,
    demoted: false,
  };
  const known = new Set<string>();
  const ui: ChatPanelUi = { tab, feed, footer };
  void hydrateGameChat(session, ui, known, options);
  if (import.meta.env.MODE !== 'test') startPolling(session, panel, ui, known, options);

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
  let result = await fetchGameChat(session.apiUrl);
  if (!result.state && options.fallback && (result.status === 401 || result.status === 403)) {
    session.apiUrl = options.fallback.apiUrl;
    session.live = false;
    session.demoted = true;
    ui.tab.textContent = options.fallback.title;
    result = await fetchGameChat(session.apiUrl);
  }
  if (!result.state || !Array.isArray(result.state.lines)) {
    renderStatus(ui.footer, 'Chat is unavailable.');
    return;
  }
  renderRoom(session, ui, known, result.state);
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
): void {
  // A player who opens a brand-new room can beat their own seat token into the
  // database, so the first player-room probe 403s and the panel demotes. Re-probe
  // for a bounded window afterwards and promote once the seat lands, rather than
  // stranding a player in the spectator room until they reload. A genuine
  // spectator burns the budget once and then polls one room like everyone else.
  let promoteAttemptsLeft = options.fallback ? PROMOTE_ATTEMPTS : 0;
  const timer = window.setInterval(async () => {
    if (!panel.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (document.visibilityState !== 'visible') return;
    if (session.demoted && promoteAttemptsLeft > 0 && options.apiUrl) {
      promoteAttemptsLeft -= 1;
      const promoted = await fetchGameChat(options.apiUrl);
      if (promoted.state) {
        session.apiUrl = options.apiUrl;
        session.live = options.live;
        session.demoted = false;
        ui.tab.textContent = options.title;
        renderRoom(session, ui, known, promoted.state);
        return;
      }
    }
    const { state } = await fetchGameChat(session.apiUrl);
    if (!state) return;
    const incoming = state.lines.filter((line) => !known.has(line.id)).slice(-VISIBLE_LINES);
    appendLines(ui.feed, incoming, known, state, session.apiUrl);
  }, options.pollMs);
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
    renderStatus(footer, 'You are temporarily timed out from chat.');
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
