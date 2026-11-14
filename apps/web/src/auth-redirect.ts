import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

const AUTH_REFERRER_PARAM = 'referrer';

export function loginHrefForCurrentPage(locale: Locale = currentLocale(), source?: string): string {
  const href = authHrefForCurrentPage('login', locale);
  return source ? `${href}&source=${encodeURIComponent(source)}` : href;
}

// Register with the same way back: account creation redirects to the referrer.
export function registerHrefForCurrentPage(locale: Locale = currentLocale()): string {
  return authHrefForCurrentPage('register', locale);
}

// Sign in, then return to a given local path rather than the current URL: a
// setup dialog names the deep link that reopens it with the same picks.
export function loginHrefWithReferrer(
  referrerPath: string,
  locale: Locale = currentLocale(),
  source?: string,
): string {
  const href = authHref('login', safeLocalPath(referrerPath), locale);
  return source ? `${href}&source=${encodeURIComponent(source)}` : href;
}

function authHrefForCurrentPage(tab: 'login' | 'register', locale: Locale): string {
  const referrer = safeLocalPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  return authHref(tab, referrer, locale);
}

function authHref(tab: 'login' | 'register', referrer: string | null, locale: Locale): string {
  const params = new URLSearchParams({ tab });
  if (referrer && !referrer.startsWith('/account')) params.set(AUTH_REFERRER_PARAM, referrer);
  return localizedHref(`/account?${params.toString()}`, locale);
}

export function requestedAuthReferrer(): string | null {
  return safeLocalPath(new URLSearchParams(window.location.search).get(AUTH_REFERRER_PARAM));
}

function safeLocalPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

// Only fixed source labels and route shapes reach analytics. URL queries,
// hashes and dynamic path segments may contain email addresses or login codes.
const AUTH_SOURCE_KEY = 'mistboard.auth-source';
const AUTH_SOURCE_TTL_MS = 30 * 60 * 1000;
type AuthContext = { source: string; path: string };

function safeAuthSource(value: unknown): string | null {
  return typeof value === 'string' &&
    /^(nav|post-game|rated-toggle|correspondence|challenge-accept|account|route)$/.test(value)
    ? value
    : null;
}

function authRoute(path: string): string {
  const pathname = new URL(path, window.location.origin).pathname;
  const parts = pathname.split('/').filter(Boolean);
  if (/^zh-han[st]$/i.test(parts[0] ?? '')) parts.shift();
  if (!parts.length) return '/';
  const first =
    /^(account|correspondence|challenge|room|game|games|study|puzzles|inbox|analysis|xiangqi|jieqi|banqi|jungle|jungle-flip|duck-xiangqi|dark-xiangqi|dark-chess|gomoku|three-kingdoms-banqi|rules|blog)$/.test(
      parts[0]!,
    )
      ? parts[0]
      : ':id';
  return `/${[first, ...parts.slice(1).map((part) => (/^(game|room|settings)$/.test(part) ? part : ':id'))].join('/')}`;
}

function sourceForRoute(path: string): string {
  if (path.startsWith('/challenge/')) return 'challenge-accept';
  if (path.startsWith('/correspondence')) return 'correspondence';
  if (/(^|\/)game\/:id(?:\/|$)/.test(path)) return 'post-game';
  return path.startsWith('/account') ? 'account' : 'route';
}

// Capture real sign-in links, including the prerendered nav and links built
// outside authHref. Merely rendering a link must never start a funnel.
export function initializeAuthSourceTracking(): () => void {
  const onClick = (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.target === '_blank') return;
    const target = new URL(link.href, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== '/account') return;
    const path = authRoute(window.location.pathname);
    const source =
      safeAuthSource(target.searchParams.get('source')) ??
      (link.closest('nav, .account-nav, .site-nav')
        ? 'nav'
        : sourceForRoute(
            authRoute(target.searchParams.get('referrer') ?? window.location.pathname),
          ));
    try {
      window.sessionStorage.setItem(
        AUTH_SOURCE_KEY,
        JSON.stringify({
          source,
          path,
          destination: target.pathname + target.search,
          at: Date.now(),
        }),
      );
    } catch {
      /* Storage blocked: the destination/referrer still identifies the route. */
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

export function authContextForOpen(): AuthContext {
  const params = new URLSearchParams(window.location.search);
  const path = authRoute(requestedAuthReferrer() ?? window.location.pathname);
  let context: AuthContext = {
    source: safeAuthSource(params.get('source')) ?? sourceForRoute(path),
    path,
  };
  try {
    const raw = window.sessionStorage.getItem(AUTH_SOURCE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (
      saved &&
      safeAuthSource(saved.source) &&
      typeof saved.path === 'string' &&
      saved.destination === window.location.pathname + window.location.search &&
      Date.now() - saved.at >= 0 &&
      Date.now() - saved.at < AUTH_SOURCE_TTL_MS
    ) {
      context = { source: saved.source, path: authRoute(saved.path) };
    }
    window.sessionStorage.setItem(
      AUTH_SOURCE_KEY,
      JSON.stringify({
        ...context,
        destination: window.location.pathname + window.location.search,
        at: Date.now(),
      }),
    );
  } catch {
    /* Every storage operation is optional, including malformed data. */
  }
  return context;
}
