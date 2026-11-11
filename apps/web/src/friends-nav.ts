// Friends in the site header (lichess parity, lila#21916): a people icon just
// left of the notification bell that opens a panel of the followed players who
// are online right now, with a Watch link for a friend seated in a live game.
// It replaced the bottom-corner friends-online pill, which sat on the phone
// move-nav bar (#674).
//
// - account-nav owns signed-in detection, so it mounts this (mountFriendsNav)
//   beside the bell and clears it on sign-out (clearFriendsNavs). account-nav
//   never runs in an embed, so neither does this.
// - The list is fetched when the panel opens, not polled: presence is a
//   five-minute window on the server, and a closed panel shows nothing.
// - Phones (600px and under) have no header icon (friends-nav.css hides it);
//   the site menu's Community > Friends item carries the count instead
//   (decorateSiteMenuFriends), and /following marks online rows
//   (decorateFollowingRows).
//
// The trigger shows no count today. renderTriggerCount is the one place a badge
// or dot would go, so adding one is a few lines there and a style.

import './friends-nav.css';
import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { prependTitleBadge } from './player-titles.js';
import { attachUserCard } from './user-card.js';

export type OnlineFriend = {
  handle: string;
  displayName: string;
  title?: string | null;
  rating: { variant: string; eloRating: number; provisional: boolean } | null;
  playing: boolean;
  // The live room's page, set only while the friend is seated in a playing game.
  roomUrl: string | null;
};

export type FriendsSurface = 'header' | 'menu' | 'following';

const ENDPOINT = '/api/relations/online-following';

// The followed players online now, or null when the list could not be read
// (signed out, network, server). Callers treat null as "say nothing".
export async function fetchOnlineFriends(): Promise<OnlineFriend[] | null> {
  try {
    const resp = await fetch(ENDPOINT, { credentials: 'same-origin' });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { players?: unknown };
    if (!Array.isArray(data.players)) return null;
    return data.players.filter(isOnlineFriend).map((friend) => ({
      ...friend,
      roomUrl: safeRoomUrl(friend.roomUrl),
    }));
  } catch {
    return null;
  }
}

function isOnlineFriend(value: unknown): value is OnlineFriend {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.handle === 'string' && typeof row.displayName === 'string';
}

// Only a same-site room page becomes a link.
function safeRoomUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/room/') ? value : null;
}

function countLabel(count: number, locale: Locale): string {
  return t(count === 1 ? 'friends.online.countOne' : 'friends.online.countMany', { count }, locale);
}

// ---------------------------------------------------------------------------
// Header control

let dismissBound = false;
// Each open bumps the control's request number, so a slow answer to an earlier
// open never paints over a newer one.
const requestByControl = new WeakMap<HTMLElement, number>();

export function mountFriendsNav(nav: HTMLElement): void {
  if (nav.querySelector('[data-friends-nav]')) return;
  const locale = currentLocale();

  const control = document.createElement('div');
  control.className = 'notif-nav friends-nav';
  control.dataset.friendsNav = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'notif-nav-trigger friends-nav-trigger';
  trigger.setAttribute('aria-label', t('friends.online.aria', {}, locale));
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.innerHTML = FRIENDS_ICON;

  const panel = document.createElement('div');
  panel.className = 'notif-nav-panel friends-nav-panel';
  panel.id = `friends-nav-panel-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', t('friends.online.aria', {}, locale));
  trigger.setAttribute('aria-controls', panel.id);

  trigger.addEventListener('click', () => {
    if (control.classList.contains('friends-nav-open')) {
      closeFriendsNav(control);
      return;
    }
    for (const other of document.querySelectorAll<HTMLElement>('.friends-nav-open')) {
      if (other !== control) closeFriendsNav(other);
    }
    control.classList.add('friends-nav-open');
    trigger.setAttribute('aria-expanded', 'true');
    void loadPanel(control, panel, locale);
  });

  control.append(trigger, panel);

  // Immediately left of the bell; left of the account menu when there is no
  // bell. Looked up through the whole nav: the account container moves between
  // the utilities and the bar with the breakpoint (site-shell placeNavAccount).
  const anchor = nav.querySelector<HTMLElement>(
    '[data-notification-nav], [data-account-nav], [data-account-slot]',
  );
  if (anchor) anchor.before(control);
  else nav.querySelector('.site-nav-utilities')?.append(control);

  ensureDismiss();
}

export function clearFriendsNavs(): void {
  for (const el of document.querySelectorAll('[data-friends-nav]')) el.remove();
}

async function loadPanel(control: HTMLElement, panel: HTMLElement, locale: Locale): Promise<void> {
  const request = (requestByControl.get(control) ?? 0) + 1;
  requestByControl.set(control, request);
  const loading = panelNote('loading');
  loading.textContent = t('friends.online.loading', {}, locale);
  panel.replaceChildren(panelHeader(t('friends.online.aria', {}, locale)), loading);

  const friends = await fetchOnlineFriends();
  if (requestByControl.get(control) !== request) return;
  if (!control.classList.contains('friends-nav-open')) return;

  if (!friends) {
    const failed = panelNote('error');
    failed.textContent = t('friends.online.loadFailed', {}, locale);
    panel.replaceChildren(
      panelHeader(t('friends.online.aria', {}, locale)),
      failed,
      footer(locale),
    );
    return;
  }
  renderTriggerCount(control, friends.length);
  panel.replaceChildren(...renderPanel(friends, locale));
  track('friends_menu_opened', { online: friends.length, surface: 'header' });
}

// The one place the trigger reflects the count. Today it only records it; a
// badge or an online dot is added here (and styled in friends-nav.css).
function renderTriggerCount(control: HTMLElement, count: number): void {
  control.dataset.online = String(count);
}

function panelHeader(text: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'notif-nav-header friends-nav-header';
  header.setAttribute('aria-hidden', 'true');
  header.textContent = text;
  return header;
}

function panelNote(state: 'loading' | 'error'): HTMLElement {
  const note = document.createElement('p');
  note.className = 'notif-nav-empty friends-nav-note';
  note.dataset.state = state;
  return note;
}

function renderPanel(friends: OnlineFriend[], locale: Locale): HTMLElement[] {
  const nodes: HTMLElement[] = [panelHeader(countLabel(friends.length, locale))];
  if (friends.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'friends-nav-empty';
    const title = document.createElement('p');
    title.className = 'friends-nav-empty-title';
    title.textContent = t('friends.online.empty', {}, locale);
    const hint = document.createElement('p');
    hint.className = 'friends-nav-empty-hint';
    hint.textContent = t('friends.online.emptyHint', {}, locale);
    empty.append(title, hint);
    nodes.push(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'friends-nav-list';
    list.setAttribute('role', 'group');
    for (const friend of friends) list.append(renderRow(friend, locale));
    nodes.push(list);
  }
  nodes.push(footer(locale));
  return nodes;
}

function renderRow(friend: OnlineFriend, locale: Locale): HTMLElement {
  const row = document.createElement('div');
  row.className = 'friends-nav-row';
  row.dataset.handle = friend.handle;

  const link = document.createElement('a');
  link.className = 'friends-nav-link';
  link.href = `/@/${encodeURIComponent(friend.handle)}`;
  link.setAttribute('role', 'menuitem');
  link.append(onlineDot(locale));
  prependTitleBadge(link, friend.title, locale);
  const name = document.createElement('span');
  name.className = 'friends-nav-name';
  name.textContent = friend.displayName;
  link.append(name);
  attachUserCard(link, friend.handle, { online: true, playing: friend.playing });
  row.append(link);

  const watch = buildWatchLink(friend, locale, 'header');
  if (watch) {
    watch.setAttribute('role', 'menuitem');
    row.append(watch);
  }
  return row;
}

function footer(locale: Locale): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'notif-nav-footer friends-nav-footer';
  const all = document.createElement('a');
  all.className = 'notif-nav-link friends-nav-all';
  all.href = localizedHref('/following', locale);
  all.setAttribute('role', 'menuitem');
  all.textContent = t('friends.online.all', {}, locale);
  footer.append(all);
  return footer;
}

function onlineDot(locale: Locale): HTMLElement {
  const dot = document.createElement('span');
  dot.className = 'friends-nav-dot';
  dot.title = t('friends.online.online', {}, locale);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

// "Watch" for a friend seated in a live game; null otherwise.
export function buildWatchLink(
  friend: OnlineFriend,
  locale: Locale,
  surface: FriendsSurface,
): HTMLAnchorElement | null {
  if (!friend.playing || !friend.roomUrl) return null;
  const watch = document.createElement('a');
  watch.className = 'friends-nav-watch';
  watch.href = friend.roomUrl;
  watch.textContent = t('friends.online.watch', {}, locale);
  watch.setAttribute(
    'aria-label',
    t('friends.online.watchLabel', { name: friend.displayName }, locale),
  );
  watch.addEventListener('click', () => track('friends_watch_clicked', { surface }));
  return watch;
}

function closeFriendsNav(control: HTMLElement, { restoreFocus = false } = {}): void {
  control.classList.remove('friends-nav-open');
  const trigger = control.querySelector<HTMLElement>('.friends-nav-trigger');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

function ensureDismiss(): void {
  if (dismissBound) return;
  dismissBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    for (const control of document.querySelectorAll<HTMLElement>('.friends-nav-open')) {
      if (!control.contains(target)) closeFriendsNav(control);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const control of document.querySelectorAll<HTMLElement>('.friends-nav-open')) {
      closeFriendsNav(control, { restoreFocus: control.contains(document.activeElement) });
    }
  });
}

// ---------------------------------------------------------------------------
// Phone site menu: Community > Friends reads "Friends  2 online" when any are.

export async function decorateSiteMenuFriends(panel: HTMLElement, locale: Locale): Promise<void> {
  const link = panel.querySelector<HTMLElement>('a[data-nav-href="/following"]');
  if (!link) return;
  const friends = await fetchOnlineFriends();
  if (!friends || !link.isConnected) return;
  track('friends_menu_opened', { online: friends.length, surface: 'menu' });
  if (friends.length === 0) return;
  link.querySelector('.site-menu-count')?.remove();
  const count = document.createElement('span');
  count.className = 'site-menu-count';
  count.textContent = t('friends.online.menuCount', { count: friends.length }, locale);
  const label = link.querySelector('span');
  if (label) label.after(count);
  else link.append(count);
}

// ---------------------------------------------------------------------------
// /following: an online dot on each online friend's row, and Watch beside
// Unfollow for one in a live game. Rows carry data-handle (following.ts).

export function decorateFollowingRows(
  rows: ParentNode,
  friends: readonly OnlineFriend[],
  locale: Locale,
): void {
  const byHandle = new Map(friends.map((friend) => [friend.handle.toLowerCase(), friend]));
  for (const row of rows.querySelectorAll<HTMLElement>('tr[data-handle]')) {
    if (row.dataset.onlineDecorated === '1') continue;
    const friend = byHandle.get((row.dataset.handle ?? '').toLowerCase());
    if (!friend) continue;
    row.dataset.onlineDecorated = '1';
    row.dataset.online = '';
    row.querySelector('.following-player-link')?.prepend(onlineDot(locale));
    const watch = buildWatchLink(friend, locale, 'following');
    if (watch) row.querySelector('.following-actions')?.prepend(watch);
  }
}

// Lucide "users": two heads, the nav's 18px outline weight.
const FRIENDS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
