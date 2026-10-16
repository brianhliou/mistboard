// /following — the Friends page (lichess.org/@/user/following parity): the
// signed-in viewer's followed players, one row each with best current rating
// (any pool, any time class), visible completed-game total, last-active time,
// and an unfollow affordance. Self-only surface: the API lists only the
// viewer's own follows, and anonymous visitors get a sign-in prompt instead of
// a redirect so the deep link explains itself.
//
// /following?tab=followers is the private Followers list (2026-10-08): who
// follows the viewer, newest first. Same self-only posture: the endpoint is
// keyed by the session, and nobody else can see an account's followers.

import './following.css';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { prependTitleBadge } from './player-titles.js';
import { buildLoadingState, buildNav, buildNotice, fetchCurrentUser } from './site-shell.js';
import { attachUserCard } from './user-card.js';
import { ratingVariantLabel } from './variants.js';

type FollowingEntry = {
  handle: string;
  displayName: string;
  title?: string | null;
  createdAt: string;
  bestRating: { variant: string; eloRating: number; provisional: boolean } | null;
  gamesTotal: number;
  lastSeenAt: string | null;
};

type FollowingPage = {
  entries: FollowingEntry[];
  total: number;
};

// handle is null when the follower's profile may not be linked (private or
// closed): the row shows the name without a link.
type FollowerEntry = {
  handle: string | null;
  displayName: string;
  title?: string | null;
  createdAt: string;
};

type FollowersPage = {
  entries: FollowerEntry[];
  total: number;
};

type FriendsTab = 'following' | 'followers';

const PAGE_SIZE = 50;

function currentTab(): FriendsTab {
  return new URLSearchParams(window.location.search).get('tab') === 'followers'
    ? 'followers'
    : 'following';
}

export async function mountFollowing(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  const tab = currentTab();
  root.replaceChildren();
  root.classList.add('landing-page', 'following-route');
  root.append(
    buildNav(locale),
    buildLoadingState(
      t(tab === 'followers' ? 'following.followersLoading' : 'following.loading', {}, locale),
    ),
  );

  const user = await fetchCurrentUser().catch(() => null);

  const shell = document.createElement('main');
  shell.className = 'site-section following-shell';
  root.replaceChildren(buildNav(locale), shell);

  if (!user) {
    shell.append(buildSignedOutPrompt(locale));
    return;
  }

  const header = document.createElement('header');
  header.className = 'following-header';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('following.title', {}, locale);

  const sub = document.createElement('p');
  sub.className = 'following-sub';
  sub.textContent = t(
    tab === 'followers' ? 'following.followersIntro' : 'following.intro',
    {},
    locale,
  );

  header.append(heading, buildTabs(tab, locale), sub);

  const body = document.createElement('section');
  body.className = 'following-body';
  shell.append(header, body);

  if (tab === 'followers') {
    const firstFollowers = await fetchFollowersPage(0);
    if (!firstFollowers) {
      body.append(
        buildNotice(
          t('following.tabFollowers', {}, locale),
          t('following.followersLoadFailed', {}, locale),
        ),
      );
      return;
    }
    renderFollowers(body, sub, firstFollowers, locale);
    return;
  }

  const first = await fetchFollowingPage(0);
  if (!first) {
    body.append(
      buildNotice(t('following.title', {}, locale), t('following.loadFailed', {}, locale)),
    );
    return;
  }

  renderFollowing(body, sub, first, locale);
}

function renderFollowing(
  body: HTMLElement,
  countLine: HTMLElement,
  first: FollowingPage,
  locale: Locale,
): void {
  let total = first.total;
  let loaded = first.entries.length;

  const updateCount = () => {
    countLine.textContent = t(
      total === 1 ? 'following.countOne' : 'following.countMany',
      { count: total },
      locale,
    );
  };

  if (total === 0) {
    const empty = document.createElement('p');
    empty.className = 'following-empty';
    empty.textContent = t('following.empty', {}, locale);
    body.replaceChildren(empty);
    return;
  }
  updateCount();

  const table = document.createElement('table');
  table.className = 'following-table';
  table.append(buildHead(locale));
  const tbody = document.createElement('tbody');
  table.append(tbody);

  const onUnfollowed = (row: HTMLTableRowElement) => {
    row.remove();
    total = Math.max(0, total - 1);
    loaded = Math.max(0, loaded - 1);
    updateCount();
    if (tbody.childElementCount === 0 && loaded >= total) {
      const empty = document.createElement('p');
      empty.className = 'following-empty';
      empty.textContent = t('following.empty', {}, locale);
      body.replaceChildren(empty);
    }
  };

  for (const entry of first.entries) tbody.append(buildRow(entry, locale, onUnfollowed));
  body.replaceChildren(table);

  if (loaded < total) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'following-load-more';
    more.textContent = t('following.loadMore', {}, locale);
    more.addEventListener('click', () => {
      more.disabled = true;
      void fetchFollowingPage(loaded).then((page) => {
        if (!page) {
          more.disabled = false;
          return;
        }
        total = page.total;
        loaded += page.entries.length;
        for (const entry of page.entries) tbody.append(buildRow(entry, locale, onUnfollowed));
        updateCount();
        if (loaded < total && page.entries.length > 0) more.disabled = false;
        else more.remove();
      });
    });
    body.append(more);
  }
}

// Following | Followers. Plain links rather than script tabs, so each list
// has its own URL (the bell's overflow row deep-links the Followers one).
function buildTabs(active: FriendsTab, locale: Locale): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'following-tabs';
  nav.setAttribute('aria-label', t('following.tabsLabel', {}, locale));
  const tabs: Array<[FriendsTab, string, string]> = [
    ['following', '/following', t('following.tabFollowing', {}, locale)],
    ['followers', '/following?tab=followers', t('following.tabFollowers', {}, locale)],
  ];
  for (const [tab, href, label] of tabs) {
    const link = document.createElement('a');
    link.className = 'following-tab';
    link.href = href;
    link.textContent = label;
    link.dataset.tab = tab;
    if (tab === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}

function renderFollowers(
  body: HTMLElement,
  countLine: HTMLElement,
  first: FollowersPage,
  locale: Locale,
): void {
  let total = first.total;
  let loaded = first.entries.length;

  if (total === 0) {
    const empty = document.createElement('p');
    empty.className = 'following-empty';
    empty.textContent = t('following.followersEmpty', {}, locale);
    body.replaceChildren(empty);
    return;
  }
  const updateCount = () => {
    countLine.textContent = t(
      total === 1 ? 'following.countOne' : 'following.countMany',
      { count: total },
      locale,
    );
  };
  updateCount();

  const table = document.createElement('table');
  table.className = 'following-table following-table-followers';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const key of ['following.colPlayer', 'following.colFollowed'] as const) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t(key, {}, locale);
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  for (const entry of first.entries) tbody.append(buildFollowerRow(entry, locale));
  body.replaceChildren(table);

  if (loaded < total) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'following-load-more';
    more.textContent = t('following.loadMore', {}, locale);
    more.addEventListener('click', () => {
      more.disabled = true;
      void fetchFollowersPage(loaded).then((page) => {
        if (!page) {
          more.disabled = false;
          return;
        }
        total = page.total;
        loaded += page.entries.length;
        for (const entry of page.entries) tbody.append(buildFollowerRow(entry, locale));
        updateCount();
        if (loaded < total && page.entries.length > 0) more.disabled = false;
        else more.remove();
      });
    });
    body.append(more);
  }
}

function buildFollowerRow(entry: FollowerEntry, locale: Locale): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'following-row follower-row';

  const playerCell = document.createElement('td');
  playerCell.className = 'following-player';
  // A follower whose profile may not be linked gets the same look without
  // the link (or the hover card, which would fetch that profile).
  const holder = document.createElement(entry.handle ? 'a' : 'span');
  holder.className = 'following-player-link';
  if (entry.handle && holder instanceof HTMLAnchorElement) {
    holder.href = `/@/${encodeURIComponent(entry.handle)}`;
  }
  prependTitleBadge(holder, entry.title, locale);
  const name = document.createElement('span');
  name.className = 'following-player-name';
  name.textContent = entry.displayName;
  holder.append(name);
  if (entry.handle) attachUserCard(holder, entry.handle);
  playerCell.append(holder);

  const followedCell = document.createElement('td');
  followedCell.className = 'follower-since';
  followedCell.textContent = formatLastSeen(entry.createdAt, locale);

  row.append(playerCell, followedCell);
  return row;
}

function buildHead(locale: Locale): HTMLTableSectionElement {
  const thead = document.createElement('thead');
  const row = document.createElement('tr');
  for (const key of [
    'following.colPlayer',
    'following.colRating',
    'following.colGames',
    'following.colLastSeen',
  ] as const) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t(key, {}, locale);
    row.append(th);
  }
  // The unfollow column carries no header text.
  const actions = document.createElement('th');
  actions.scope = 'col';
  actions.setAttribute('aria-label', t('following.unfollow', {}, locale));
  row.append(actions);
  thead.append(row);
  return thead;
}

function buildRow(
  entry: FollowingEntry,
  locale: Locale,
  onUnfollowed: (row: HTMLTableRowElement) => void,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'following-row';

  const playerCell = document.createElement('td');
  playerCell.className = 'following-player';
  const link = document.createElement('a');
  link.className = 'following-player-link';
  link.href = `/@/${encodeURIComponent(entry.handle)}`;
  prependTitleBadge(link, entry.title, locale);
  const name = document.createElement('span');
  name.className = 'following-player-name';
  name.textContent = entry.displayName;
  link.append(name);
  attachUserCard(link, entry.handle);
  playerCell.append(link);

  const ratingCell = document.createElement('td');
  ratingCell.className = 'following-rating';
  if (entry.bestRating) {
    ratingCell.textContent = `${entry.bestRating.eloRating}${entry.bestRating.provisional ? '?' : ''}`;
    const label = ratingVariantLabel(entry.bestRating.variant);
    if (label) ratingCell.title = label;
  } else {
    ratingCell.textContent = '–';
  }

  const gamesCell = document.createElement('td');
  gamesCell.className = 'following-games';
  gamesCell.textContent = String(entry.gamesTotal);

  const lastSeenCell = document.createElement('td');
  lastSeenCell.className = 'following-last-seen';
  lastSeenCell.textContent = formatLastSeen(entry.lastSeenAt, locale);

  const actionsCell = document.createElement('td');
  actionsCell.className = 'following-actions';
  const unfollow = document.createElement('button');
  unfollow.type = 'button';
  unfollow.className = 'following-unfollow';
  unfollow.textContent = t('following.unfollow', {}, locale);
  unfollow.addEventListener('click', () => {
    unfollow.disabled = true;
    void fetch(`/api/users/${encodeURIComponent(entry.handle)}/follow`, { method: 'DELETE' })
      .then((resp) => {
        if (resp.ok) onUnfollowed(row);
        else unfollow.disabled = false;
      })
      .catch(() => {
        unfollow.disabled = false;
      });
  });
  actionsCell.append(unfollow);

  row.append(playerCell, ratingCell, gamesCell, lastSeenCell, actionsCell);
  return row;
}

function buildSignedOutPrompt(locale: Locale): HTMLElement {
  const notice = buildNotice(
    t('following.signedOutTitle', {}, locale),
    t('following.signedOutBody', {}, locale),
  );
  notice.classList.add('following-signed-out');
  const signIn = document.createElement('a');
  signIn.className = 'landing-cta-primary following-sign-in';
  signIn.href = loginHrefForCurrentPage(locale);
  signIn.textContent = t('nav.signIn', {}, locale);
  notice.append(signIn);
  return notice;
}

async function fetchFollowingPage(offset: number): Promise<FollowingPage | null> {
  const resp = await fetch(`/api/relations/following?offset=${offset}&limit=${PAGE_SIZE}`).catch(
    () => null,
  );
  if (!resp?.ok) return null;
  try {
    return (await resp.json()) as FollowingPage;
  } catch {
    return null;
  }
}

async function fetchFollowersPage(offset: number): Promise<FollowersPage | null> {
  const resp = await fetch(`/api/relations/followers?offset=${offset}&limit=${PAGE_SIZE}`).catch(
    () => null,
  );
  if (!resp?.ok) return null;
  try {
    return (await resp.json()) as FollowersPage;
  } catch {
    return null;
  }
}

// Last-active as a coarse relative time. NULL (no durable activity recorded)
// renders the quiet "a while ago" fallback rather than an error or a blank.
// Intl.RelativeTimeFormat handles all four locales without catalog plumbing.
function formatLastSeen(iso: string | null, locale: Locale): string {
  if (!iso) return t('following.lastSeenUnknown', {}, locale);
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return t('following.lastSeenUnknown', {}, locale);
  const rtf = new Intl.RelativeTimeFormat(LOCALE_META[locale].dateLocale, { numeric: 'auto' });
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}
