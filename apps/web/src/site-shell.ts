import './site-shell.css';
import type { AccountPreferences } from './account-preferences.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref, stripLocalePrefix } from './i18n/locale.js';
import {
  adminNavItems,
  communityNavItems,
  donateNavItem,
  learnNavItems,
  type NavItem,
  playNavItems,
  primaryNavItems,
  toolsNavItems,
  watchNavItems,
} from './nav-items.js';
import { isLikelyAdmin, isLikelySignedIn } from './signed-in-state.js';
import { isBlockedForViewer } from './viewer-geo.js';

export const GITHUB_URL = 'https://github.com/brianhliou/mistboard';

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  handle: string;
  handleChangedAt: string | null;
  displayName: string;
  displayNameChangedAt: string | null;
  bio: string;
  location: string;
  profileLinks: string[];
  // Cosmetic flair key, or null for none. Kept as a plain string here: the
  // allowlist lives in flair.ts and the server validates it, so the shell type
  // does not need to enumerate the keys.
  flair: string | null;
  displayPreferences: {
    pieceAnimation?: 'none' | 'fast' | 'normal' | 'slow';
  };
  accountPreferences?: Partial<AccountPreferences>;
  profileVisibility: 'private' | 'unlisted' | 'public';
  accountRole: 'player' | 'admin';
  locale: Locale | null;
  dmPolicy: 'never' | 'friends' | 'always';
};

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const resp = await fetch('/api/auth/me');
  if (!resp.ok) throw new Error(`failed to load account: ${resp.status}`);
  const data = (await resp.json()) as { user: AuthUser | null };
  return data.user;
}

export function buildNav(locale: Locale = currentLocale()): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', t('nav.primary', {}, locale));

  const brand = document.createElement('a');
  brand.className = 'site-nav-brand';
  brand.href = '/';
  const brandLogo = document.createElement('img');
  brandLogo.className = 'site-nav-logo';
  brandLogo.src = '/logo-mark.png';
  brandLogo.alt = '';
  brandLogo.width = 28;
  brandLogo.height = 28;

  // Wordmark styled like lichess's: full name in --site-text, the TLD suffix
  // dimmed to --site-muted. Nested spans keep the mobile `.site-nav-brand span`
  // logo-only collapse working (both spans hide together).
  const brandText = document.createElement('span');
  brandText.className = 'site-nav-brand-name';
  brandText.append('mistboard');
  const brandSuffix = document.createElement('span');
  brandSuffix.className = 'site-nav-brand-suffix';
  brandSuffix.textContent = '.com';
  brandText.append(brandSuffix);
  brand.append(brandLogo, brandText);

  const links = document.createElement('div');
  links.className = 'site-nav-links';

  const [play, puzzles, watch] = primaryNavItems();
  // Play title links to the lobby; the dropdown adds Correspondence (and repeats
  // the lobby, for touch devices where the first tap opens the panel).
  links.append(navMenu('nav.play', playNavItems(), locale, play?.href ?? '/'));
  if (puzzles) links.append(navLink(puzzles, locale));
  // Rules are the Learn landing and lead its dropdown; the interactive xiangqi
  // course remains directly reachable as the second item.
  links.append(navMenu('nav.learn', learnNavItems(), locale, '/rules'));
  // Watch title links to Mistboard TV (/watch); the dropdown adds Broadcasts.
  links.append(navMenu('nav.watch', watchNavItems(), locale, watch?.href ?? '/watch'));
  // Community title itself links to the player page (lichess parity): hovering
  // opens the dropdown, clicking the word navigates to /player.
  links.append(navMenu('nav.community', communityNavItems(), locale, '/player'));
  // Tools title links to the analysis board (the anchor tool); the dropdown
  // lists it too, so touch/no-hover users can still reach it after the first tap.
  const tools = toolsNavItems();
  if (tools.length > 0)
    links.append(navMenu('nav.tools', tools, locale, tools[0]?.href ?? '/analysis/xiangqi'));
  // Donate is the rightmost public item, immediately left of the admin-only menu.
  const donate = navLink(donateNavItem(), locale);
  donate.classList.add('site-nav-link-donate');
  const donateIcon = document.createElement('span');
  donateIcon.className = 'site-nav-donate-icon';
  donateIcon.setAttribute('aria-hidden', 'true');
  donate.prepend(donateIcon);
  links.append(donate);
  // Consolidate internal tools under one admin-only menu. Initial visibility
  // comes from the persisted admin hint; account-nav reconciles it once auth
  // resolves. This is cosmetic only: both pages are admin-gated server-side.
  const adminMenu = navMenu('nav.admin', adminNavItems(), locale);
  adminMenu.classList.add('site-nav-menu-admin');
  adminMenu.dataset.adminOnly = '';
  adminMenu.hidden = !isLikelyAdmin();
  links.append(adminMenu);

  const utilities = document.createElement('div');
  utilities.className = 'site-nav-utilities';

  // The account slot (signed-out links, or the account menu once account-nav
  // mounts) sits in a container that placeNavAccount() can move: inside the
  // utilities on desktop and phones, up on the bar beside the hamburger on
  // tablets, so signing in never needs the drawer opened first.
  const account = document.createElement('div');
  account.className = 'site-nav-account';
  account.append(buildSignedOutAccountLinks(locale));
  utilities.append(account);

  // Mobile menu toggle. On desktop `.site-nav-collapse` is `display: contents`,
  // so links + utilities lay out exactly as before; on mobile the toggle reveals
  // them as a dropdown panel. theme.ts / account-nav.ts still find
  // `.site-nav-utilities` via descendant query, so injection is unaffected.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'site-nav-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', t('nav.menu', {}, locale));
  for (let i = 0; i < 3; i++) toggle.append(document.createElement('span'));
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const collapse = document.createElement('div');
  collapse.className = 'site-nav-collapse';
  collapse.append(links, utilities);

  ensureNavDismiss();
  ensureNavAutoHide();
  nav.append(brand, toggle, collapse);
  placeNavAccount(nav);
  ensureNavAccountPlacement();
  return nav;
}

// Tablets (601 to 1100px) get the phone bar (hamburger, drawer) but have room
// for the account slot beside the toggle; phones do not, and desktop shows the
// utilities inline anyway. CSS cannot reparent, so the slot's container moves
// on the media query. account-nav.ts finds the slot through the nav, not the
// utilities, so it mounts wherever the container currently sits.
export const navTabletMediaQuery = '(min-width: 601px) and (max-width: 1100px)';

function isTabletNav(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(navTabletMediaQuery).matches;
}

export function placeNavAccount(nav: HTMLElement): void {
  const account = nav.querySelector<HTMLElement>('.site-nav-account');
  const toggle = nav.querySelector<HTMLElement>(':scope > .site-nav-toggle');
  const utilities = nav.querySelector<HTMLElement>('.site-nav-utilities');
  if (!account || !toggle || !utilities) return;
  if (isTabletNav()) {
    if (account.nextElementSibling !== toggle) toggle.before(account);
  } else if (account.parentElement !== utilities) {
    utilities.prepend(account);
  }
}

// Bound once for the document (route swaps rebuild the nav); the handler
// re-finds the current bar, like the auto-hide listener above.
let navAccountPlacementBound = false;
function ensureNavAccountPlacement(): void {
  if (navAccountPlacementBound || typeof window.matchMedia !== 'function') return;
  navAccountPlacementBound = true;
  window.matchMedia(navTabletMediaQuery).addEventListener('change', () => {
    const nav = document.querySelector<HTMLElement>('.site-nav');
    if (nav) placeNavAccount(nav);
  });
}

// Lichess-style sticky-nav auto-hide: hide the bar when scrolling down, reveal
// it when scrolling back up (topBar.ts in lila). One listener set, bound once,
// that finds the current `.site-nav` so SPA route swaps that rebuild the nav
// don't accumulate listeners. Asymmetric thresholds (10px down / 20px up) plus
// skipping `lastY` updates on sub-threshold moves give hysteresis so a jittery
// scroll doesn't flicker the bar.
//
// The page scroller varies by route: on landing routes `body` gets
// `overflow-y: auto` (via the `overflow-x: hidden` rule) so IT scrolls; other
// routes scroll the window/documentElement. A capture-phase `scroll` listener
// on `document` catches the event from whichever element scrolls (scroll does
// not bubble, but capture reaches it), and we read the page offset as the max
// across the candidates so we don't care which one holds it.
let navAutoHideBound = false;
function ensureNavAutoHide(): void {
  if (navAutoHideBound || typeof document === 'undefined') return;
  navAutoHideBound = true;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const scrollY = () =>
    Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0,
    );
  const maxScroll = () =>
    Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
      document.body.scrollHeight - document.body.clientHeight,
    );
  let lastY = scrollY();
  const onScroll = () => {
    const nav = document.querySelector<HTMLElement>('.site-nav');
    if (!nav) return;
    const y = scrollY();
    nav.classList.toggle('scrolled', y > 0);
    if (y > lastY + 10) nav.classList.add('hide');
    else if (y <= clamp(lastY - 20, 0, maxScroll())) nav.classList.remove('hide');
    else return;
    lastY = Math.max(0, y);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}

let navDismissBound = false;
function ensureNavDismiss(): void {
  if (navDismissBound) return;
  navDismissBound = true;
  const closeAll = () => {
    for (const nav of document.querySelectorAll<HTMLElement>('.site-nav.nav-open')) {
      nav.classList.remove('nav-open');
      nav.querySelector('.site-nav-toggle')?.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    for (const nav of document.querySelectorAll<HTMLElement>('.site-nav.nav-open')) {
      if (!nav.contains(target)) {
        nav.classList.remove('nav-open');
        nav.querySelector('.site-nav-toggle')?.setAttribute('aria-expanded', 'false');
      }
    }
    for (const menu of document.querySelectorAll<HTMLElement>(
      '.site-nav-menu.site-nav-menu-open',
    )) {
      if (!menu.contains(target)) closeNavMenu(menu);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAll();
      for (const menu of document.querySelectorAll<HTMLElement>('.site-nav-menu-open')) {
        closeNavMenu(menu);
      }
    }
  });
}

function buildSignedOutAccountLinks(locale: Locale = currentLocale()): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'site-nav-auth';
  wrap.dataset.accountSlot = '';

  const path = currentPath();
  const tab: 'login' | 'register' =
    new URLSearchParams(window.location.search).get('tab') === 'register' ? 'register' : 'login';

  const signIn = document.createElement('a');
  signIn.href = localizedHref('/account?tab=login', locale);
  signIn.className = 'site-nav-link site-nav-link-signin';
  signIn.textContent = t('nav.signIn', {}, locale);
  if (path === '/account' && tab === 'login') {
    signIn.classList.add('active');
    signIn.setAttribute('aria-current', 'page');
  }

  const register = document.createElement('a');
  register.href = localizedHref('/account?tab=register', locale);
  register.className = 'site-nav-link site-nav-link-register';
  register.textContent = t('nav.register', {}, locale);
  if (path === '/account' && tab === 'register') {
    register.classList.add('active');
    register.setAttribute('aria-current', 'page');
  }

  wrap.append(signIn, register);
  return wrap;
}

function navLink(item: NavItem, locale: Locale): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = item.external ? item.href : localizedHref(item.href, locale);
  link.textContent = t(item.labelKey, {}, locale);
  link.className = 'site-nav-link';
  if (item.external) {
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    return link;
  }
  if (item.signedInOnly) {
    // Initial visibility comes from the persisted signed-in hint so the common
    // case paints right immediately (no reveal jank); account-nav reconciles
    // every [data-signed-in-only] element once auth actually resolves.
    link.dataset.signedInOnly = '';
    link.hidden = !isLikelySignedIn();
  }
  const path = currentPath();
  if (pathMatchesNavItem(path, item.href)) {
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
  }
  return link;
}

function navMenu(
  labelKey: NavItem['labelKey'],
  items: NavItem[],
  locale: Locale,
  titleHref?: string,
): HTMLElement {
  // Off-site items unreachable from the viewer's country are not rendered.
  const visibleItems = items.filter((item) => !isBlockedForViewer(item.blockedIn));
  const menu = document.createElement('div');
  menu.className = 'site-nav-menu';

  // With a titleHref the toggle is a real link (clicking navigates, hovering
  // opens the panel — lichess split-menu behavior). Without one it's a button
  // that only toggles the panel.
  const toggle = document.createElement(titleHref ? 'a' : 'button');
  toggle.className = 'site-nav-link site-nav-menu-toggle';
  toggle.textContent = t(labelKey, {}, locale);

  const openMenu = () => {
    for (const other of document.querySelectorAll<HTMLElement>('.site-nav-menu-open')) {
      if (other !== menu) closeNavMenu(other);
    }
    menu.classList.add('site-nav-menu-open');
    toggle.setAttribute('aria-expanded', 'true');
  };
  const toggleMenu = () => {
    if (menu.classList.contains('site-nav-menu-open')) {
      closeNavMenu(menu);
    } else {
      openMenu();
    }
  };

  if (titleHref && toggle instanceof HTMLAnchorElement) {
    toggle.href = localizedHref(titleHref, locale);
    // Pointer devices open the panel on hover (CSS), so let the click navigate.
    // On touch/no-hover devices there is no hover, so intercept the first tap to
    // reveal the panel instead of jumping away from the submenu items.
    toggle.addEventListener('click', (event) => {
      const canHover =
        typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
      if (canHover) return;
      event.preventDefault();
      toggleMenu();
    });
  } else {
    (toggle as HTMLButtonElement).type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', toggleMenu);
  }

  const panel = document.createElement('div');
  panel.className = 'site-nav-menu-panel';
  for (const item of visibleItems) {
    const link = navLink(item, locale);
    panel.append(link);
  }

  if (items.some((item) => pathMatchesNavItem(currentPath(), item.href))) {
    toggle.classList.add('active');
  }

  menu.append(toggle, panel);
  return menu;
}

function closeNavMenu(menu: HTMLElement): void {
  menu.classList.remove('site-nav-menu-open');
  menu.querySelector('.site-nav-menu-toggle')?.setAttribute('aria-expanded', 'false');
}

function pathMatchesNavItem(path: string, href: string): boolean {
  const normalizedPath = stripLocalePrefix(path);
  return (
    normalizedPath === href ||
    (href === '/puzzles' && normalizedPath.startsWith('/puzzles/')) ||
    (href === '/player' && normalizedPath.startsWith('/player/')) ||
    (href === '/account' && normalizedPath.startsWith('/account/')) ||
    (href === '/bots' && normalizedPath.startsWith('/bot/')) ||
    (href === '/forum' && normalizedPath.startsWith('/forum/')) ||
    (href === '/rules' && normalizedPath.startsWith('/rules/')) ||
    (href === '/blog' && normalizedPath.startsWith('/blog/'))
  );
}

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

export function buildLoadingState(label: string): HTMLElement {
  const section = document.createElement('main');
  section.className = 'site-loading';
  section.setAttribute('aria-live', 'polite');

  const mark = document.createElement('div');
  mark.className = 'site-loading-mark';
  mark.setAttribute('aria-hidden', 'true');

  const text = document.createElement('p');
  text.textContent = label;

  section.append(mark, text);
  return section;
}

export function buildNotice(titleText: string, bodyText: string): HTMLElement {
  const notice = document.createElement('section');
  notice.className = 'site-section game-notice';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = titleText;
  const body = document.createElement('p');
  body.textContent = bodyText;
  notice.append(heading, body);
  return notice;
}

// Homepage-only footer. Rendered blended into the bottom of the landing stage
// (no `.site-footer` bar chrome). Static info pages carry their own side rail,
// and the register form independently surfaces Terms + Privacy so signup still
// has an assent surface. One quiet row, deliberately NOT a lichess-style grouped
// fat footer: with our route count the columns read busier than the site is
// (Brian, 2026-06-10).
//
// Every entry is an on-site page. `external`/`blockedIn` stay wired for the next
// off-site link: the Discord invite was the last one to use them, until it came
// out of the footer on 2026-08-31 (see nav-items.ts).
const HOME_FOOTER_LINKS: ReadonlyArray<{
  href: string;
  labelKey: I18nKey;
  external?: boolean;
  blockedIn?: readonly string[];
}> = [
  { href: '/about', labelKey: 'footer.about' },
  { href: '/stats', labelKey: 'footer.stats' },
  { href: '/feed', labelKey: 'footer.news' },
  { href: '/faq', labelKey: 'footer.faq' },
  { href: '/patron', labelKey: 'footer.patron' },
  { href: '/contact', labelKey: 'footer.contact' },
  { href: '/source', labelKey: 'footer.source' },
  { href: '/developers', labelKey: 'footer.developers' },
  { href: '/terms', labelKey: 'footer.terms' },
  { href: '/privacy', labelKey: 'footer.privacy' },
];

export function buildHomeFooter(locale: Locale = currentLocale()): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'landing-footer';

  const links = document.createElement('div');
  links.className = 'landing-footer-links';
  for (const link of HOME_FOOTER_LINKS) {
    if (isBlockedForViewer(link.blockedIn)) continue;
    const anchor = document.createElement('a');
    anchor.href = link.external ? link.href : localizedHref(link.href, locale);
    anchor.textContent = t(link.labelKey, {}, locale);
    if (link.external) {
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
    }
    links.append(anchor);
  }

  const identity = document.createElement('span');
  identity.className = 'landing-footer-identity';
  identity.textContent = '© 2026 Mistboard · AGPL-3.0';

  links.append(identity);
  footer.append(links);
  return footer;
}
