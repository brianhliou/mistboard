import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

const AUTH_REFERRER_PARAM = 'referrer';

export function loginHrefForCurrentPage(locale: Locale = currentLocale()): string {
  return authHrefForCurrentPage('login', locale);
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
): string {
  return authHref('login', safeLocalPath(referrerPath), locale);
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
