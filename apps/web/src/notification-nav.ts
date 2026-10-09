import './notification-nav.css';
import { readAccountPreferences } from './account-preferences.js';
import { startFormPrefillHref } from './correspondence-model.js';
import { variantDisplayLabel } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';

// A reusable nav notification button: a bell + count badge that aggregates every
// registered source. account-nav owns signed-in detection and the nav
// MutationObserver, so it mounts the bell (via mountNotificationBell) and tears
// it down on sign-out; this module owns the registry, rendering, and refresh.
//
// Sources used to fetch independently, which meant every new notification kind
// cost each signed-in client another request on every poll. They now read out
// of one /api/notifications snapshot: a source is a pure function from counts
// to rows, so adding a kind costs one server field and one closure and no extra
// network traffic.

// The panel groups rows by what they ask of the user. 'waiting' is live state
// that stays until acted on (your move, a challenge, unread messages); 'new' is
// a watermarked feed told once (followers, forum replies, lapsed seeks); 'link'
// is a plain shortcut in the footer (Inbox, Correspondence with nothing
// pending), never a row. Left unset, a row takes 'new' from a source that has
// markSeen and 'waiting' from one that does not.
export type NotificationSection = 'waiting' | 'new' | 'link';
// Picks the row's icon.
export type NotificationKind =
  | 'move'
  | 'challenge'
  | 'message'
  | 'follower'
  | 'reply'
  | 'quote'
  | 'expired';

export type NotificationEntry = {
  label: string;
  href: string;
  // A muted second line, clamped to one line (a forum topic's title).
  detail?: string;
  kind?: NotificationKind;
  section?: NotificationSection;
};
export type NotificationSnapshot = { count: number; entries: NotificationEntry[] };

// A row as the panel draws it: section and icon resolved against its source,
// and the unread dot set. The dot marks rows from a watermarked source, which
// the open clears: it shows for the open that first sees the row, and the row
// is gone on the next.
type PanelEntry = NotificationEntry & {
  section: NotificationSection;
  unread: boolean;
};
type PanelSnapshot = { count: number; entries: PanelEntry[] };

// One new follower, newest first. handle is null when their profile may not be
// linked (private or closed): the row names them and links to your Followers
// list instead.
export type NewFollowerNotification = {
  handle: string | null;
  displayName: string;
};

// The private Followers list (the Followers tab of /following).
export const FOLLOWERS_LIST_HREF = '/following?tab=followers';

export type ForumWatchNotification = {
  topicId: string;
  slug: string;
  title: string;
  unread: number;
  firstUnreadPostId: string;
  // Set when one of the unread posts quotes the user: the row says who and
  // links to the quoting post instead of the oldest unread reply.
  quote: { postId: string; by: string | null } | null;
};

// One public board seek of yours that lapsed with no taker, with its terms so
// the row can offer to post it again prefilled.
export type SeekExpiryNotification = {
  seekId: string;
  gameSpecId: string;
  daysPerMove: number;
  preferredColor: 'first' | 'second' | 'random';
  rated: boolean;
  ttlDays: number;
};

// Mirrors the payload of GET /api/notifications (apps/server/src/routes/notifications.ts).
export type NotificationCounts = {
  inboxUnread: number;
  correspondenceYourMove: number;
  newFollowers: number;
  // The newest of them (capped server-side), one bell row each.
  followedBy: NewFollowerNotification[];
  // Watched forum topics with unread replies: topics, not replies, so one
  // busy thread is a 1 on the badge, not a 40.
  forumTopics: number;
  // The rows behind forumTopics, capped server-side, most recent first.
  forumWatched: ForumWatchNotification[];
  incomingChallenges: number;
  // Lapsed board seeks not yet seen, and the newest of them (capped server-side).
  seekExpiries: number;
  seekExpired: SeekExpiryNotification[];
};

const EMPTY_COUNTS: NotificationCounts = {
  inboxUnread: 0,
  correspondenceYourMove: 0,
  newFollowers: 0,
  followedBy: [],
  forumTopics: 0,
  forumWatched: [],
  incomingChallenges: 0,
  seekExpiries: 0,
  seekExpired: [],
};

export type NotificationSource = {
  // Pure: turns the shared snapshot into this source's badge count and panel
  // rows. Must not throw; a source that cannot read its field returns zero.
  read(counts: NotificationCounts): NotificationSnapshot;
  // Watermarked feeds (new followers, forum replies) clear when the user opens
  // the panel, which is the moment they have actually seen the rows. Live-state
  // sources (unread DMs, your-move games, pending challenges) omit this: their
  // count must survive being looked at, because the work is still outstanding.
  markSeen?(): Promise<void>;
  // The icon for rows that do not name their own kind.
  kind?: NotificationKind;
};

const sources: NotificationSource[] = [];
let lastSnapshot: PanelSnapshot = { count: 0, entries: [] };
let dismissBound = false;
let refreshTimer: number | null = null;
let visibilityBound = false;

export function registerNotificationSource(source: NotificationSource): void {
  sources.push(source);
}

// Test-only. The registry is process-wide and main.ts fills it once at boot, so
// clearNotificationBells() deliberately does NOT clear it (a sign-out must not
// leave a signed-back-in session with no sources). Tests that register their
// own sources need a way to not leak them into the next test.
export function resetNotificationSourcesForTest(): void {
  sources.length = 0;
  lastSnapshot = { count: 0, entries: [] };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

async function markKindSeen(kind: 'followers' | 'forum-replies' | 'seek-expiries'): Promise<void> {
  await fetch('/api/notifications/seen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
  }).catch(() => null);
}

// Games awaiting the player's move. The panel always offers the dashboard link
// so the bell is the entry point to /correspondence regardless of count.
export const correspondenceNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().correspondenceBell) return { count: 0, entries: [] };
    const count = counts.correspondenceYourMove;
    const entry: NotificationEntry =
      count > 0
        ? {
            label: `${count} ${plural(count, 'game needs', 'games need')} your move`,
            href: '/correspondence',
            kind: 'move',
          }
        : { label: 'Correspondence', href: '/correspondence', section: 'link' };
    return { count, entries: [entry] };
  },
};

// Unread DM threads. The panel always offers the inbox link so the bell doubles
// as the /inbox entry point.
export const inboxNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().inboxBell) return { count: 0, entries: [] };
    const count = counts.inboxUnread;
    const entry: NotificationEntry =
      count > 0
        ? {
            label: `${count} unread ${plural(count, 'message', 'messages')}`,
            href: '/inbox',
            kind: 'message',
          }
        : { label: 'Inbox', href: '/inbox', section: 'link' };
    return { count, entries: [entry] };
  },
};

// New followers since the user last opened the bell: one row per follower
// (the server caps them), naming them and linking to their profile, plus one
// overflow row to the private Followers list when there are more. Only the
// followed account sees these (2026-10-08); there is still no public
// followers list or count.
export const followersNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().followersBell) return { count: 0, entries: [] };
    const count = counts.newFollowers;
    if (count === 0) return { count: 0, entries: [] };
    const entries: NotificationEntry[] = counts.followedBy.slice(0, count).map((follower) => ({
      label: t('following.bellFollowedYou', { name: follower.displayName }),
      href: follower.handle ? `/@/${encodeURIComponent(follower.handle)}` : FOLLOWERS_LIST_HREF,
      kind: 'follower',
    }));
    const more = count - entries.length;
    if (more > 0) {
      const key: I18nKey =
        entries.length > 0
          ? more === 1
            ? 'following.bellMoreOne'
            : 'following.bellMoreMany'
          : more === 1
            ? 'following.bellNewOne'
            : 'following.bellNewMany';
      entries.push({
        label: t(key, { count: more }),
        href: FOLLOWERS_LIST_HREF,
        kind: 'follower',
      });
    }
    return { count, entries };
  },
  markSeen: () => markKindSeen('followers'),
  kind: 'follower',
};

// Unread replies in topics the user watches (their own threads, threads they
// replied in, threads they chose to follow). One row per topic, deep-linked to
// the first unread reply, plus a single overflow row when the server capped
// the list. Never a row per reply.
export const forumNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().forumBell) return { count: 0, entries: [] };
    const count = counts.forumTopics;
    if (count === 0) return { count: 0, entries: [] };
    // The action leads and the topic title sits under it, muted and clamped,
    // so a long title never wraps the row to three bold lines.
    const entries: NotificationEntry[] = counts.forumWatched.map((row) => ({
      label: row.quote
        ? `${row.quote.by ?? 'Someone'} quoted you`
        : `${row.unread} new ${plural(row.unread, 'reply', 'replies')}`,
      detail: row.title,
      href: `/forum/redirect/post/${encodeURIComponent(row.quote?.postId ?? row.firstUnreadPostId)}`,
      kind: row.quote ? 'quote' : 'reply',
    }));
    const more = count - entries.length;
    if (more > 0) {
      entries.push({
        label: `${more} ${entries.length > 0 ? 'more ' : ''}${plural(more, 'topic', 'topics')} with new replies`,
        href: '/forum',
      });
    }
    return { count, entries };
  },
  markSeen: () => markKindSeen('forum-replies'),
  kind: 'reply',
};

// Direct challenges waiting on an answer. Live state, so no markSeen: an
// unanswered challenge keeps its badge until it is accepted, declined, or
// expires.
export const challengesNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().challengesBell) return { count: 0, entries: [] };
    const count = counts.incomingChallenges;
    if (count === 0) return { count: 0, entries: [] };
    return {
      count,
      entries: [
        {
          label: `${count} ${plural(count, 'challenge', 'challenges')} waiting for you`,
          // The "Challenges for you" section, which lists the same rows
          // (correspondence.ts INCOMING_ANCHOR).
          href: '/correspondence#incoming',
          kind: 'challenge',
        },
      ],
    };
  },
};

// Public board seeks that lapsed with no taker. One row per seek (the server
// caps them), each linking to /correspondence with the start form prefilled so
// posting it again is one click. Seen on open like the other feeds, so a lapsed
// seek is told once and never nags.
export const seekExpiryNotificationSource: NotificationSource = {
  read: (counts) => {
    if (!readAccountPreferences().correspondenceBell) return { count: 0, entries: [] };
    const count = counts.seekExpiries;
    if (count === 0) return { count: 0, entries: [] };
    const entries: NotificationEntry[] = counts.seekExpired.map((notice) => ({
      label: `Your open ${variantDisplayLabel(notice.gameSpecId)} game expired`,
      detail: `No taker in ${notice.ttlDays} days. Post it again`,
      href: startFormPrefillHref(notice),
    }));
    const more = count - entries.length;
    if (more > 0) {
      entries.push({
        label: `${more} more open ${plural(more, 'game', 'games')} expired with no taker`,
        href: '/correspondence',
      });
    }
    return { count, entries };
  },
  markSeen: () => markKindSeen('seek-expiries'),
  kind: 'expired',
};

export function mountNotificationBell(nav: HTMLElement): void {
  if (sources.length === 0) return;
  const utilities = nav.querySelector<HTMLElement>('.site-nav-utilities');
  if (!utilities) return;
  if (utilities.querySelector('[data-notification-nav]')) return;

  const control = document.createElement('div');
  control.className = 'notif-nav';
  control.dataset.notificationNav = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'notif-nav-trigger';
  trigger.setAttribute('aria-label', 'Notifications');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.innerHTML = BELL_ICON;

  const badge = document.createElement('span');
  badge.className = 'notif-nav-badge';
  badge.hidden = true;
  trigger.append(badge);

  const panel = document.createElement('div');
  panel.className = 'notif-nav-panel';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', 'Notifications');

  trigger.addEventListener('click', () => {
    if (control.classList.contains('notif-nav-open')) {
      closeBell(control);
      return;
    }
    for (const other of document.querySelectorAll<HTMLElement>('.notif-nav-open')) {
      if (other !== control) closeBell(other);
    }
    control.classList.add('notif-nav-open');
    trigger.setAttribute('aria-expanded', 'true');
    void markOpenedSourcesSeen();
  });

  control.append(trigger, panel);

  // Sit just left of the account menu. The account slot lives inside the
  // .site-nav-account container (site-shell.ts), which sits in the utilities
  // on desktop and phones and up on the bar on tablets, so look through the
  // whole nav and insert as the account's sibling rather than assuming the
  // utilities are its parent (that assumption threw NotFoundError and left
  // the signed-in menu unmounted).
  const scope = utilities.closest<HTMLElement>('.site-nav') ?? utilities;
  const account = scope.querySelector<HTMLElement>('[data-account-nav], [data-account-slot]');
  if (account) account.before(control);
  else utilities.append(control);

  ensureDismiss();
  ensureRefreshLoop();
  applySnapshot(control);
  void refreshNotifications();
}

export function clearNotificationBells(): void {
  for (const el of document.querySelectorAll('[data-notification-nav]')) el.remove();
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// Fetch the shared counts once and repaint every mounted bell. Called on mount;
// callers (e.g. after a move) can re-invoke to refresh without a page load.
export async function refreshNotifications(): Promise<void> {
  if (sources.length === 0) return;
  const counts = await fetchNotificationCounts();
  const snapshots = sources.map((source) => {
    try {
      return { source, snapshot: source.read(counts) };
    } catch {
      return { source, snapshot: { count: 0, entries: [] } as NotificationSnapshot };
    }
  });
  lastSnapshot = {
    count: snapshots.reduce((total, { snapshot }) => total + snapshot.count, 0),
    entries: snapshots.flatMap(({ source, snapshot }) =>
      snapshot.entries.map((entry) => panelEntry(entry, source)),
    ),
  };
  for (const control of document.querySelectorAll<HTMLElement>('[data-notification-nav]')) {
    applySnapshot(control);
  }
}

function panelEntry(entry: NotificationEntry, source: NotificationSource): PanelEntry {
  const watermarked = typeof source.markSeen === 'function';
  const section = entry.section ?? (watermarked ? 'new' : 'waiting');
  const kind = entry.kind ?? source.kind;
  return {
    ...entry,
    ...(kind ? { kind } : {}),
    section,
    unread: watermarked && section !== 'link',
  };
}

async function fetchNotificationCounts(): Promise<NotificationCounts> {
  const resp = await fetch('/api/notifications').catch(() => null);
  // A 401 (signed out) or a transient failure reads as "nothing pending"
  // rather than leaving the last counts on screen, so a stale badge never
  // outlives the session it belonged to.
  if (!resp?.ok) return EMPTY_COUNTS;
  const data = (await resp.json().catch(() => null)) as Partial<NotificationCounts> | null;
  if (!data) return EMPTY_COUNTS;
  const read = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return {
    inboxUnread: read(data.inboxUnread),
    correspondenceYourMove: read(data.correspondenceYourMove),
    newFollowers: read(data.newFollowers),
    followedBy: readFollowedBy(data.followedBy),
    forumTopics: read(data.forumTopics),
    forumWatched: readForumWatched(data.forumWatched),
    incomingChallenges: read(data.incomingChallenges),
    seekExpiries: read(data.seekExpiries),
    seekExpired: readSeekExpired(data.seekExpired),
  };
}

// Defensive parse of the new-follower rows, same posture as readForumWatched:
// a row with no name is dropped, and a handle that is not a string reads as
// "do not link".
function readFollowedBy(value: unknown): NewFollowerNotification[] {
  if (!Array.isArray(value)) return [];
  const rows: NewFollowerNotification[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.displayName !== 'string' || row.displayName.trim() === '') continue;
    rows.push({
      handle: typeof row.handle === 'string' && row.handle !== '' ? row.handle : null,
      displayName: row.displayName,
    });
  }
  return rows;
}

// Defensive parse of the expired-seek rows, same posture as readForumWatched.
function readSeekExpired(value: unknown): SeekExpiryNotification[] {
  if (!Array.isArray(value)) return [];
  const rows: SeekExpiryNotification[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.seekId !== 'string' ||
      typeof row.gameSpecId !== 'string' ||
      typeof row.daysPerMove !== 'number' ||
      !Number.isFinite(row.daysPerMove) ||
      typeof row.ttlDays !== 'number' ||
      !Number.isFinite(row.ttlDays)
    ) {
      continue;
    }
    const side = row.preferredColor;
    rows.push({
      seekId: row.seekId,
      gameSpecId: row.gameSpecId,
      daysPerMove: row.daysPerMove,
      preferredColor: side === 'first' || side === 'second' ? side : 'random',
      rated: row.rated === true,
      ttlDays: row.ttlDays,
    });
  }
  return rows;
}

// Defensive parse of the per-topic rows: a malformed row is dropped rather
// than rendered as a link to nowhere.
function readForumWatched(value: unknown): ForumWatchNotification[] {
  if (!Array.isArray(value)) return [];
  const rows: ForumWatchNotification[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.topicId !== 'string' ||
      typeof row.slug !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.firstUnreadPostId !== 'string' ||
      typeof row.unread !== 'number' ||
      !Number.isFinite(row.unread) ||
      row.unread <= 0
    ) {
      continue;
    }
    rows.push({
      topicId: row.topicId,
      slug: row.slug,
      title: row.title,
      unread: Math.floor(row.unread),
      firstUnreadPostId: row.firstUnreadPostId,
      quote: readQuote(row.quote),
    });
  }
  return rows;
}

function readQuote(value: unknown): ForumWatchNotification['quote'] {
  if (!value || typeof value !== 'object') return null;
  const quote = value as Record<string, unknown>;
  if (typeof quote.postId !== 'string') return null;
  return { postId: quote.postId, by: typeof quote.by === 'string' ? quote.by : null };
}

// Opening the panel is the read receipt for every watermarked source. Fires
// once per open, then refreshes so the cleared counts leave the badge.
async function markOpenedSourcesSeen(): Promise<void> {
  const pending = sources.filter((source) => source.markSeen).map((source) => source.markSeen?.());
  if (pending.length === 0) return;
  await Promise.all(pending);
  await refreshNotifications();
}

function applySnapshot(control: HTMLElement): void {
  const badge = control.querySelector<HTMLElement>('.notif-nav-badge');
  if (badge) {
    badge.textContent = String(lastSnapshot.count);
    badge.hidden = lastSnapshot.count === 0;
  }
  // An open panel keeps the rows it opened with. Opening is the read receipt,
  // and the refresh that follows must not pull a row out from under the cursor
  // before it can be clicked; closing re-renders from the latest snapshot, so
  // the next open starts fresh.
  if (control.classList.contains('notif-nav-open')) return;
  const panel = control.querySelector<HTMLElement>('.notif-nav-panel');
  if (!panel) return;
  panel.replaceChildren(...renderPanel(lastSnapshot.entries));
}

const SECTION_TITLES: Record<Exclude<NotificationSection, 'link'>, string> = {
  waiting: 'Waiting on you',
  new: 'New',
};

function renderPanel(entries: PanelEntry[]): HTMLElement[] {
  const header = document.createElement('div');
  header.className = 'notif-nav-header';
  header.setAttribute('aria-hidden', 'true');
  header.textContent = 'Notifications';
  const nodes: HTMLElement[] = [header];

  for (const section of ['waiting', 'new'] as const) {
    const rows = entries.filter((entry) => entry.section === section);
    if (rows.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'notif-nav-section';
    group.dataset.section = section;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', SECTION_TITLES[section]);
    const title = document.createElement('div');
    title.className = 'notif-nav-section-title';
    title.setAttribute('aria-hidden', 'true');
    title.textContent = SECTION_TITLES[section];
    group.append(title, ...rows.map(renderRow));
    nodes.push(group);
  }

  if (nodes.length === 1) {
    const empty = document.createElement('p');
    empty.className = 'notif-nav-empty';
    empty.textContent = "You're all caught up";
    nodes.push(empty);
  }

  const links = entries.filter((entry) => entry.section === 'link');
  if (links.length > 0) {
    const footer = document.createElement('div');
    footer.className = 'notif-nav-footer';
    footer.setAttribute('role', 'group');
    footer.setAttribute('aria-label', 'Shortcuts');
    for (const entry of links) {
      const link = document.createElement('a');
      link.className = 'notif-nav-link';
      link.href = entry.href;
      link.setAttribute('role', 'menuitem');
      link.textContent = entry.label;
      footer.append(link);
    }
    nodes.push(footer);
  }
  return nodes;
}

function renderRow(entry: PanelEntry): HTMLElement {
  const link = document.createElement('a');
  link.className = 'notif-nav-item';
  link.href = entry.href;
  link.setAttribute('role', 'menuitem');
  if (entry.kind) link.dataset.kind = entry.kind;

  const glyph = document.createElement('span');
  glyph.className = 'notif-nav-icon';
  glyph.innerHTML = KIND_ICONS[entry.kind ?? 'generic'];

  const text = document.createElement('span');
  text.className = 'notif-nav-text';
  const label = document.createElement('span');
  label.className = 'notif-nav-label';
  label.textContent = entry.label;
  text.append(label);
  if (entry.detail) {
    const detail = document.createElement('span');
    detail.className = 'notif-nav-detail';
    detail.textContent = entry.detail;
    detail.title = entry.detail;
    text.append(detail);
  }
  link.append(glyph, text);

  if (entry.unread) {
    link.dataset.unread = '';
    const dot = document.createElement('span');
    dot.className = 'notif-nav-dot';
    dot.setAttribute('aria-hidden', 'true');
    link.append(dot);
  }
  return link;
}

function closeBell(control: HTMLElement): void {
  control.classList.remove('notif-nav-open');
  control.querySelector('.notif-nav-trigger')?.setAttribute('aria-expanded', 'false');
  applySnapshot(control);
}

function ensureDismiss(): void {
  if (dismissBound) return;
  dismissBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    for (const control of document.querySelectorAll<HTMLElement>('.notif-nav-open')) {
      if (!control.contains(target)) closeBell(control);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const control of document.querySelectorAll<HTMLElement>('.notif-nav-open'))
      closeBell(control);
  });
}

function ensureRefreshLoop(): void {
  if (refreshTimer === null) {
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    }, 60_000);
  }
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      document.querySelector('[data-notification-nav]')
    ) {
      void refreshNotifications();
    }
  });
}

const BELL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

// Row icons in the bell's own stroke style: 24px grid, 2px round strokes,
// currentColor, drawn at 16px.
const icon = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const KIND_ICONS: Record<NotificationKind | 'generic', string> = {
  move: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  challenge: icon(
    '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/>',
  ),
  message: icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  follower: icon(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  ),
  reply: icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  quote: icon(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 8v3"/><path d="M12 8v3"/>',
  ),
  expired: icon(
    '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  ),
  generic: BELL_ICON.replace('width="18" height="18"', 'width="16" height="16"'),
};
