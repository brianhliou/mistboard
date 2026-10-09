// Accepting an open correspondence seek in place: the one Accept used by every
// surface that lists someone else's seek (/games cards, /correspondence open
// seeks, the homepage lobby rows and the play panel offers). Signed in, it
// POSTs /api/correspondence/seeks/:id/accept and goes straight to the room;
// signed out, it is a sign-in link that comes back to the seek's /challenge
// page. The /challenge page shares the error copy and the sign-in href.

import { trackCorrespondenceSeekAccepted } from './analytics.js';
import { firstMoverColorName, secondMoverColorName } from './game-display.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import type { SeatSide } from './seat-start-view.js';
import { isLikelySignedIn } from './signed-in-state.js';

export type SeekAcceptSurface =
  | 'correspondence'
  | 'challenge'
  | 'games'
  | 'home-lobby'
  | 'home-panel';

export type SeekVisibility = 'public' | 'private';

// The accept endpoint's refusals that mean the seek is gone for good: someone
// else took it, its creator withdrew it, or it ran out.
const GONE_ERRORS = new Set(['seek_taken', 'seek_not_found', 'challenge_expired']);

export function isSeekGoneError(code: string | null | undefined): boolean {
  return code != null && GONE_ERRORS.has(code);
}

// The line shown when an accept fails. A public seek reads the same whether it
// was taken, withdrawn or expired (the accepter cannot tell and does not care);
// a private challenge keeps its own words.
export function seekAcceptErrorText(
  code: string | null | undefined,
  visibility: SeekVisibility = 'public',
  locale: Locale = currentLocale(),
): string {
  if (!isSeekGoneError(code)) return t('challenge.couldNotAccept', {}, locale);
  if (visibility === 'public') return t('challenge.seekClosed', {}, locale);
  return code === 'challenge_expired'
    ? t('challenge.expired', {}, locale)
    : t('challenge.challengeClosed', {}, locale);
}

// Where a signed-out Accept goes: the account page's sign-in tab, with the
// `referrer` it reads back (auth-redirect.ts) pointing at the seek's page.
export function seekSignInHref(seekId: string, locale: Locale = currentLocale()): string {
  const params = new URLSearchParams({
    tab: 'login',
    referrer: `/challenge/${encodeURIComponent(seekId)}`,
  });
  return localizedHref(`/account?${params.toString()}`, locale);
}

export type SeekAcceptOptions = {
  seek: { id: string; gameSpecId: string; daysPerMove: number };
  surface: SeekAcceptSurface;
  className: string;
  // Button text; defaults to "Accept".
  label?: string;
  locale?: Locale;
  // Defaults to the session hint; a stale hint is caught by the 401 below.
  signedIn?: boolean;
  // Where an error is written. Without one (a one-line row), the button itself
  // says "Closed" and carries the full line as its title.
  status?: HTMLElement | null;
  // Picks the error copy; every listed seek is public, a /challenge link may not be.
  visibility?: SeekVisibility;
  // Called once the seek is known to be gone (taken, withdrawn, expired).
  onGone?: () => void;
  // Test seam; defaults to a full navigation.
  navigate?: (url: string) => void;
};

export function buildSeekAcceptAction(options: SeekAcceptOptions): HTMLElement {
  const { seek, surface, className } = options;
  const locale = options.locale ?? currentLocale();
  const label = options.label ?? t('correspondence.accept', {}, locale);
  const navigate =
    options.navigate ??
    ((url: string) => {
      window.location.href = url;
    });
  const signedIn = options.signedIn ?? isLikelySignedIn();

  if (!signedIn) {
    // Correspondence needs an account: Accept signs in, then lands on this
    // seek's challenge page with its own Accept.
    const link = document.createElement('a');
    link.className = className;
    link.href = seekSignInHref(seek.id, locale);
    link.title = t('correspondence.signInToAccept', {}, locale);
    link.textContent = label;
    return link;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  const status = options.status ?? null;

  const showError = (message: string, gone: boolean): void => {
    if (status) {
      status.textContent = message;
      status.hidden = false;
    } else {
      button.title = message;
      if (gone) button.textContent = t('challenge.seekClosedShort', {}, locale);
    }
    // A seek that is gone cannot be accepted again; a transient failure can.
    button.disabled = gone;
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    if (status) status.hidden = true;
    void fetch(`/api/correspondence/seeks/${encodeURIComponent(seek.id)}/accept`, {
      method: 'POST',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (res.ok && body?.url) {
          trackCorrespondenceSeekAccepted({
            daysPerMove: seek.daysPerMove,
            gameSpecId: seek.gameSpecId,
            surface,
          });
          navigate(body.url);
          return;
        }
        // The session hint said signed in, the server disagrees.
        if (res.status === 401) {
          navigate(seekSignInHref(seek.id, locale));
          return;
        }
        const gone = isSeekGoneError(body?.error);
        showError(seekAcceptErrorText(body?.error, options.visibility ?? 'public', locale), gone);
        if (gone) options.onGone?.();
      })
      .catch(() => {
        showError(t('challenge.couldNotAccept', {}, locale), false);
      });
  });
  return button;
}

// The side the ACCEPTER plays, for someone else's seek: the poster picked
// theirs, so the label names the other one; random says so. Shown on every
// card that offers Accept and on the /challenge page.
export function accepterColorLabel(gameSpecId: string, color: string | undefined): string | null {
  if (color === 'random') return t('challenge.randomColors');
  if (color === 'first')
    return t('challenge.youPlayColor', { color: secondMoverColorName(gameSpecId) });
  if (color === 'second')
    return t('challenge.youPlayColor', { color: firstMoverColorName(gameSpecId) });
  return null;
}

// The seat the ACCEPTER would take on someone else's seek, when the poster
// picked a side; null for random (no seat is decided until the game starts).
export function accepterSide(color: string | undefined): SeatSide | null {
  if (color === 'first') return 'second';
  if (color === 'second') return 'first';
  return null;
}
