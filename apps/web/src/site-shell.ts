import './site-shell.css';
import './hover-grammar.css';
import type { AccountPreferences } from './account-preferences.js';
import { t } from './i18n/catalog.js';
import {
  currentLocale,
  LOCALE_META,
  type Locale,
  localizedHref,
  stripLocalePrefix,
} from './i18n/locale.js';
import {
  adminNavItems,
  communityNavItems,
  donateNavItem,
  footerNavItems,
  learnNavItems,
  type NavItem,
  type NavSection,
  playNavItems,
  primaryNavItems,
  puzzleNavItems,
  siteMenuSections,
  toolsNavItems,
  watchNavItems,
} from './nav-items.js';
import { isLikelyAdmin, isLikelySignedIn } from './signed-in-state.js';
import {
  buildAppearanceMenuAt,
  buildQuickPickerAt,
  type QuickPickerKind,
  readStoredXiangqiPieceSet,
  setSiteThemePreference,
  siteThemeChangedEvent,
  xiangqiAppearanceChangedEvent,
} from './theme.js';
import { isBlockedForViewer } from './viewer-geo.js';
import { type XiangqiPieceSet, xiangqiPieceTilePreview } from './xiangqi-piece-sets.js';

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
  // Puzzles title links to the trainer; the dropdown adds Puzzle Themes and Streak.
  links.append(navMenu('nav.puzzles', puzzleNavItems(), locale, puzzles?.href ?? '/puzzles'));
  // Rules are the Learn landing and lead its dropdown; the interactive xiangqi
  // course remains directly reachable as the second item.
  links.append(navMenu('nav.learn', learnNavItems(), locale, '/rules'));
  // Watch title links to Mistboard TV (/watch); the dropdown adds Broadcasts.
  links.append(navMenu('nav.watch', watchNavItems(), locale, watch?.href ?? '/watch'));
  // Community title itself links to the leaderboard (lichess parity): hovering
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
  // Internal tools sit under one admin-only menu, rendered from the persisted
  // admin hint and reconciled by account-nav once auth resolves. Absent, not
  // hidden, for everyone else: the signed-out nav is what the prerender bakes,
  // and a hidden menu still put 管理 / 数据库 / 运营简报 in the HTML a crawler
  // indexes. The pages themselves are admin-gated server-side.
  navLinksLocale.set(links, locale);
  if (isLikelyAdmin()) links.append(buildAdminNavMenu(locale));

  const utilities = document.createElement('div');
  utilities.className = 'site-nav-utilities';

  // The account slot (signed-out links, or the account menu once account-nav
  // mounts) sits in a container that placeNavAccount() can move: inside the
  // utilities on desktop, up on the bar beside the hamburger on tablets, and at
  // the right edge of the bar on phones, so signing in never needs a menu.
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
    // Phones open the full-screen site menu; tablets keep the drawer below.
    if (isPhoneNav()) {
      openSiteMenu(toggle, locale);
      return;
    }
    const open = nav.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const collapse = document.createElement('div');
  collapse.className = 'site-nav-collapse';
  collapse.append(links, utilities);

  ensureNavDismiss();
  ensureNavAutoHide();
  nav.append(brand, buildNavQuickControls(locale), toggle, collapse);
  placeNavAccount(nav);
  ensureNavAccountPlacement();
  observeNavBrandFit(nav);
  return nav;
}

// The locale each bar was built in, so a menu added after auth resolves speaks
// the same language as the rest of its bar.
const navLinksLocale = new WeakMap<HTMLElement, Locale>();

function buildAdminNavMenu(locale: Locale): HTMLElement {
  const adminMenu = navMenu('nav.admin', adminNavItems(), locale);
  adminMenu.classList.add('site-nav-menu-admin');
  adminMenu.dataset.adminOnly = '';
  return adminMenu;
}

// Adds or removes the admin menu on every nav bar so it exists only for an
// admin. Idempotent: account-nav calls it on each DOM-observer pass. The menu
// is the last item on the bar, right after Donate.
export function syncAdminNavMenus(isAdmin: boolean): void {
  for (const links of document.querySelectorAll<HTMLElement>('.site-nav .site-nav-links')) {
    const existing = links.querySelector<HTMLElement>(':scope > [data-admin-only]');
    if (isAdmin && !existing)
      links.append(buildAdminNavMenu(navLinksLocale.get(links) ?? currentLocale()));
    else if (!isAdmin && existing) existing.remove();
  }
}

// The wordmark stays on the bar whenever it fits and drops to the logo alone
// when it does not. A width breakpoint would have to be sized for the widest
// bar (admin link plus a long handle), which takes the wordmark from everyone
// else ~130px early. Re-checked when the bar resizes or the account slot fills
// in; the observer fires before paint, so there is no flash.
export function fitNavBrand(nav: HTMLElement): void {
  const brand = nav.querySelector<HTMLElement>('.site-nav-brand');
  const links = nav.querySelector<HTMLElement>('.site-nav-links');
  const utilities = nav.querySelector<HTMLElement>('.site-nav-utilities');
  if (!brand || !links || !utilities) return;
  nav.removeAttribute('data-brand');
  // Under the drawer breakpoint the links sit in the closed drawer and the
  // drawer CSS shows the logo alone anyway.
  if (links.offsetParent === null || nav.clientWidth === 0) return;
  const style = getComputedStyle(nav);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const needed =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0) +
    brand.offsetWidth +
    links.scrollWidth +
    utilities.scrollWidth +
    2 * gap;
  if (needed > nav.clientWidth) nav.dataset.brand = 'mark';
}

function observeNavBrandFit(nav: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  const links = nav.querySelector<HTMLElement>('.site-nav-links');
  const utilities = nav.querySelector<HTMLElement>('.site-nav-utilities');
  const observer = new ResizeObserver(() => fitNavBrand(nav));
  // Hiding the wordmark resizes only the brand, never these three, so the
  // callback cannot feed itself.
  for (const el of [nav, links, utilities]) if (el) observer.observe(el);
}

// Tablets (601 to 939px) get the hamburger and drawer but have room for the
// account slot beside the toggle; phones (below) put it at the bar's right
// edge, and desktop shows the utilities inline anyway. CSS cannot reparent, so the slot's container moves
// on the media query. account-nav.ts finds the slot through the nav, not the
// utilities, so it mounts wherever the container currently sits.
export const navTabletMediaQuery = '(min-width: 601px) and (max-width: 939px)';

function isTabletNav(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(navTabletMediaQuery).matches;
}

// Phones (600px and under) get the one-row 52px bar: menu button, brand, then
// the account slot (bell + account, or Sign in) at the right edge, and the
// full-screen site menu instead of the drawer. The 600 edge pairs with the
// tablet query above; site-shell.css keys the phone bar on the same width.
export const navPhoneMediaQuery = '(max-width: 600px)';

function isPhoneNav(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(navPhoneMediaQuery).matches;
}

export function placeNavAccount(nav: HTMLElement): void {
  const account = nav.querySelector<HTMLElement>('.site-nav-account');
  const toggle = nav.querySelector<HTMLElement>(':scope > .site-nav-toggle');
  const utilities = nav.querySelector<HTMLElement>('.site-nav-utilities');
  if (!account || !toggle || !utilities) return;
  if (isTabletNav()) {
    if (account.nextElementSibling !== toggle) toggle.before(account);
  } else if (isPhoneNav()) {
    // Last on the bar, so it sits at the right edge; CSS moves the toggle to
    // the left edge with `order`.
    if (account.parentElement !== nav || account.nextElementSibling) nav.append(account);
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
  const place = () => {
    const nav = document.querySelector<HTMLElement>('.site-nav');
    if (nav) placeNavAccount(nav);
  };
  window.matchMedia(navTabletMediaQuery).addEventListener('change', place);
  window.matchMedia(navPhoneMediaQuery).addEventListener('change', (event) => {
    place();
    // The site menu is a phone surface; widening past it closes the menu.
    if (!event.matches) closeSiteMenu({ restoreFocus: false });
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
    if (y > lastY + 10) {
      nav.classList.add('hide');
      closeQuickPicker({ restoreFocus: false });
    } else if (y <= clamp(lastY - 20, 0, maxScroll())) nav.classList.remove('hide');
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

// Phone bar quick controls (#575): language, pieces and dark mode as three
// icons between the brand and the account slot, in place of the chip row that
// sat at the bottom of the site menu. Language and Pieces open their picker
// straight away in a dropdown under the bar (the language list, the piece-set
// tiles); dark mode toggles in place. Hidden above the phone breakpoint
// (site-shell.css), where the bar has the gear and the account menu instead.
function buildNavQuickControls(locale: Locale): HTMLElement {
  const group = document.createElement('div');
  group.className = 'site-nav-quick';

  const quickButton = (key: string, label: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-nav-quick-button';
    button.dataset.siteNavQuick = key;
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  };

  const languageName = LOCALE_META[locale]?.displayName;
  const language = quickButton(
    'language',
    languageName
      ? `${t('nav.language', {}, locale)}: ${languageName}`
      : t('nav.language', {}, locale),
  );
  language.innerHTML = QUICK_GLOBE_ICON;
  language.setAttribute('aria-haspopup', 'dialog');
  language.setAttribute('aria-expanded', 'false');
  language.addEventListener('click', () => toggleQuickPicker(language, 'language', locale));

  // The red general of the reader's own xiangqi set, the same mark the Pieces
  // picker tiles draw, so the button previews the choice it opens.
  const pieces = quickButton('pieces', t('nav.boardAndPieces', {}, locale));
  const piece = document.createElement('span');
  piece.className = 'site-nav-quick-piece';
  piece.setAttribute('aria-hidden', 'true');
  pieces.append(piece);
  renderQuickPiece(piece);
  pieces.setAttribute('aria-haspopup', 'dialog');
  pieces.setAttribute('aria-expanded', 'false');
  pieces.addEventListener('click', () => toggleQuickPicker(pieces, 'pieces', locale));

  const dark = quickButton('dark', t('nav.darkMode', {}, locale));
  dark.innerHTML = QUICK_MOON_ICON;
  syncQuickDark(dark);
  dark.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.effectiveTheme === 'dark';
    setSiteThemePreference(isDark ? 'light' : 'dark');
    syncQuickDark(dark);
  });

  group.append(language, pieces, dark);
  ensureNavQuickSync();
  return group;
}

// The quick picker dropdown: one at a time, a child of the bar so it rides
// under it (full width on a phone), closed by an outside tap, Escape, a pick,
// or the bar hiding on scroll.
type OpenQuickPicker = {
  panel: HTMLElement;
  button: HTMLButtonElement;
  teardown: () => void;
};
let openQuickPickerState: OpenQuickPicker | null = null;

export function isQuickPickerOpen(): boolean {
  return openQuickPickerState !== null;
}

function toggleQuickPicker(button: HTMLButtonElement, kind: QuickPickerKind, locale: Locale): void {
  const wasThis = openQuickPickerState?.button === button;
  closeQuickPicker({ restoreFocus: false });
  if (wasThis) return;

  const panel = document.createElement('div');
  panel.className = 'site-nav-quick-panel';
  panel.id = `site-nav-quick-panel-${kind}`;
  panel.dataset.siteNavQuickPanel = kind;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute(
    'aria-label',
    kind === 'language' ? t('nav.language', {}, locale) : t('nav.boardAndPieces', {}, locale),
  );
  (button.closest<HTMLElement>('.site-nav') ?? document.body).append(panel);
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', panel.id);

  const onPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || button.contains(target))) return;
    closeQuickPicker({ restoreFocus: false });
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeQuickPicker();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown);
  openQuickPickerState = {
    panel,
    button,
    teardown: () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown);
    },
  };

  void buildQuickPickerAt(kind, { onPick: () => closeQuickPicker() })
    .then((picker) => {
      if (openQuickPickerState?.panel !== panel) return;
      panel.append(picker);
      // Pieces is the one picker with settings beside it (board, sound,
      // notation, device theme); with the gear off the phone bar, this row is
      // the way to them.
      if (kind === 'pieces') panel.append(buildQuickMoreSettings(button, locale));
      panel.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
    })
    .catch((err) => console.warn('quick picker failed to load', err));
}

function buildQuickMoreSettings(button: HTMLButtonElement, locale: Locale): HTMLButtonElement {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'site-nav-quick-more';
  more.textContent = t('account.settings', {}, locale);
  more.addEventListener('click', () => {
    closeQuickPicker({ restoreFocus: false });
    openSiteMenu(button, locale, { view: 'root', includeLanguage: false });
  });
  return more;
}

export function closeQuickPicker({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
  const state = openQuickPickerState;
  if (!state) return;
  openQuickPickerState = null;
  state.teardown();
  state.panel.remove();
  state.button.setAttribute('aria-expanded', 'false');
  state.button.removeAttribute('aria-controls');
  if (restoreFocus) state.button.focus();
}

function renderQuickPiece(slot: HTMLElement): void {
  const set: XiangqiPieceSet = readStoredXiangqiPieceSet();
  if (slot.dataset.pieceSet === set) return;
  slot.dataset.pieceSet = set;
  slot.innerHTML = xiangqiPieceTilePreview(set).markup;
}

function syncQuickDark(button: HTMLElement): void {
  button.setAttribute(
    'aria-pressed',
    document.documentElement.dataset.effectiveTheme === 'dark' ? 'true' : 'false',
  );
}

// Bound once for the document (route swaps rebuild the nav): a set picked in
// the settings view, another tab, or an OS theme flip re-syncs every bar.
let navQuickSyncBound = false;
function ensureNavQuickSync(): void {
  if (navQuickSyncBound || typeof window === 'undefined') return;
  navQuickSyncBound = true;
  window.addEventListener(xiangqiAppearanceChangedEvent, () => {
    for (const slot of document.querySelectorAll<HTMLElement>('.site-nav-quick-piece'))
      renderQuickPiece(slot);
  });
  window.addEventListener(siteThemeChangedEvent, () => {
    for (const button of document.querySelectorAll<HTMLElement>('[data-site-nav-quick="dark"]'))
      syncQuickDark(button);
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
  // A mode of a page (/puzzles?mode=streak) is its own destination: it matches
  // only with its query, and the bare page stops matching while a mode is on.
  const [hrefPath, hrefQuery] = href.split('?');
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (hrefQuery !== undefined)
    return normalizedPath === hrefPath && window.location.search === `?${hrefQuery}`;
  if (href === '/puzzles' && normalizedPath === '/puzzles' && mode === 'streak') return false;
  // The themes index is its own menu item; puzzle detail pages stay the trainer's.
  if (href === '/puzzles' && normalizedPath === '/puzzles/themes') return false;
  return (
    normalizedPath === href ||
    (href === '/puzzles' && normalizedPath.startsWith('/puzzles/')) ||
    (href === '/player' &&
      (normalizedPath === '/leaderboard' || normalizedPath.startsWith('/player/'))) ||
    // Pro player pages, team pages and the teams index all sit under /players/.
    (href === '/players' && normalizedPath.startsWith('/players/')) ||
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

// ---------------------------------------------------------------------------
// Phone site menu (#576). On phones the hamburger opens a full-screen panel in
// place of the tablet drawer: every bar destination grouped into sections
// (siteMenuSections, plus Admin for admins). Language and board and piece
// settings open in the same panel from the bar's quick controls (#575), which
// replaced the chip row this menu used to end with. The panel is built on open
// and appended to <body>, not the nav: the bar's auto-hide translates the nav
// off screen, which would carry a fixed child with it.

type MenuLocaleSelectHandler = (locale: Locale) => void;
let menuLocaleSelectHandler: MenuLocaleSelectHandler | null = null;

// account-nav registers the signed-in handler that saves a language picked
// here to the account (the account's locale otherwise wins on the next load).
// A registration rather than an import, to keep site-shell free of account-nav.
export function registerMenuLocaleSelectHandler(handler: MenuLocaleSelectHandler | null): void {
  menuLocaleSelectHandler = handler;
}

// Called with the freshly built panel each time the menu opens; account-nav
// registers the signed-in decoration (the Friends item's online count).
type SiteMenuOpenHandler = (panel: HTMLElement, locale: Locale) => void;
let siteMenuOpenHandler: SiteMenuOpenHandler | null = null;

export function registerSiteMenuOpenHandler(handler: SiteMenuOpenHandler | null): void {
  siteMenuOpenHandler = handler;
}

interface OpenSiteMenuState {
  panel: HTMLElement;
  toggle: HTMLElement;
  onKeydown: (event: KeyboardEvent) => void;
}
let openSiteMenuState: OpenSiteMenuState | null = null;

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const CLOSE_ICON = `<svg ${SVG_ATTRS} width="24" height="24"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const QUICK_GLOBE_ICON = `<svg ${SVG_ATTRS} width="20" height="20"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`;
const QUICK_MOON_ICON = `<svg ${SVG_ATTRS} width="20" height="20"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`;

// A settings view to open the menu on (a drill-in key of the appearance menu,
// or 'root' for its list), instead of the link sections.
export type SiteMenuView = { view: string; includeLanguage: boolean };

export function isSiteMenuOpen(): boolean {
  return openSiteMenuState !== null;
}

export function openSiteMenu(
  toggle: HTMLElement,
  locale: Locale = currentLocale(),
  initialView?: SiteMenuView,
): void {
  if (openSiteMenuState) {
    closeSiteMenu();
    return;
  }
  const { panel, showSettings } = buildSiteMenu(locale);
  document.body.append(panel);
  document.documentElement.classList.add('site-menu-open');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', panel.id);
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSiteMenu();
    } else if (event.key === 'Tab') {
      trapSiteMenuFocus(panel, event);
    }
  };
  document.addEventListener('keydown', onKeydown);
  openSiteMenuState = { panel, toggle, onKeydown };
  panel.querySelector<HTMLElement>('.site-menu-close')?.focus();
  if (initialView) showSettings(initialView.view, initialView.includeLanguage);
  siteMenuOpenHandler?.(panel, locale);
}

export function closeSiteMenu({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
  const state = openSiteMenuState;
  if (!state) return;
  openSiteMenuState = null;
  document.removeEventListener('keydown', state.onKeydown);
  state.panel.remove();
  document.documentElement.classList.remove('site-menu-open');
  state.toggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) state.toggle.focus();
}

function trapSiteMenuFocus(panel: HTMLElement, event: KeyboardEvent): void {
  const focusable = [
    ...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.closest('[hidden]'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function buildSiteMenu(locale: Locale): {
  panel: HTMLElement;
  showSettings: (view: string, includeLanguage: boolean) => void;
} {
  const panel = document.createElement('div');
  panel.className = 'site-menu';
  panel.id = 'site-menu';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('nav.menu', {}, locale));

  const bar = document.createElement('div');
  bar.className = 'site-menu-bar';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'site-menu-close';
  close.setAttribute('aria-label', t('nav.closeMenu', {}, locale));
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', () => closeSiteMenu());
  const brand = document.createElement('a');
  brand.className = 'site-menu-brand';
  brand.href = '/';
  const logo = document.createElement('img');
  logo.src = '/logo-mark.png';
  logo.alt = '';
  logo.width = 28;
  logo.height = 28;
  const name = document.createElement('span');
  name.textContent = 'Mistboard';
  brand.append(logo, name);
  bar.append(close, brand);

  const body = document.createElement('div');
  body.className = 'site-menu-body';
  const sectionsView = document.createElement('div');
  sectionsView.className = 'site-menu-sections';
  const sections: NavSection[] = siteMenuSections({ admin: isLikelyAdmin() });
  const path = currentPath();
  for (const section of sections) {
    const items = section.items.filter((item) => !isBlockedForViewer(item.blockedIn));
    if (items.length === 0) continue;
    const group = document.createElement('section');
    group.className = 'site-menu-section';
    const heading = document.createElement('h2');
    heading.className = 'site-menu-heading';
    heading.textContent = t(section.labelKey, {}, locale);
    group.append(heading);
    for (const item of items) group.append(siteMenuLink(item, locale, path));
    sectionsView.append(group);
  }

  const settingsView = document.createElement('div');
  settingsView.className = 'site-menu-settings';
  settingsView.hidden = true;

  body.append(sectionsView, settingsView);
  // Following a link leaves the page; close first so a back-forward cache
  // restore never shows the menu still open.
  body.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest?.('.site-menu-section a[href]')) {
      closeSiteMenu({ restoreFocus: false });
    }
  });

  const showSettings = (view: string, includeLanguage: boolean) => {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'site-menu-back';
    back.textContent = `‹ ${t('nav.menu', {}, locale)}`;
    back.addEventListener('click', () => {
      settingsView.hidden = true;
      settingsView.replaceChildren();
      sectionsView.hidden = false;
    });
    settingsView.replaceChildren(back);
    sectionsView.hidden = true;
    settingsView.hidden = false;
    back.focus();
    void buildAppearanceMenuAt(view, {
      includeLanguage,
      onLocaleSelect: (next) => menuLocaleSelectHandler?.(next),
    })
      .then((menu) => {
        if (!settingsView.hidden && back.isConnected) settingsView.append(menu);
      })
      .catch((err) => console.warn('site menu settings failed to load', err));
  };

  panel.append(bar, body);
  return { panel, showSettings };
}

function siteMenuLink(item: NavItem, locale: Locale, path: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'site-menu-link';
  link.href = item.external ? item.href : localizedHref(item.href, locale);
  // The unlocalized destination, so a decoration can find its item.
  link.dataset.navHref = item.href;
  const label = document.createElement('span');
  label.textContent = t(item.labelKey, {}, locale);
  link.append(label);
  if (item.external) {
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    return link;
  }
  if (item.signedInOnly) {
    link.dataset.signedInOnly = '';
    link.hidden = !isLikelySignedIn();
  }
  if (pathMatchesNavItem(path, item.href)) {
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
    const dot = document.createElement('span');
    dot.className = 'site-menu-dot';
    dot.setAttribute('aria-hidden', 'true');
    link.append(dot);
  }
  return link;
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
// (Brian, 2026-06-10). Four links since 2026-10-17, the same on every width:
// footerNavItems (nav-items.ts).
export function buildHomeFooter(locale: Locale = currentLocale()): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'landing-footer';

  const links = document.createElement('div');
  links.className = 'landing-footer-links';
  for (const link of footerNavItems()) {
    if (isBlockedForViewer(link.blockedIn)) continue;
    const anchor = document.createElement('a');
    anchor.className = 'hover-link';
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
