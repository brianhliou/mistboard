// Lightweight signed-in state, deliberately dependency-free so it can be shared
// by account-nav (the authoritative owner that resolves /api/auth/me) and the
// read-only consumers (theme's gear gating, landing's contact form) without an
// account-nav <-> theme import cycle.

const SIGNED_IN_HINT_KEY = 'mb_signed_in';

// undefined until account-nav resolves auth this load; then the real boolean.
let resolvedSignedIn: boolean | undefined;

// Persisted best-guess from a prior signed-in load. Lets the first paint pick
// the right shape before /api/auth/me resolves.
export function readSignedInHint(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSignedInHint(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SIGNED_IN_HINT_KEY, '1');
    else window.localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // localStorage unavailable (private mode etc.) — fall through.
  }
}

// account-nav pushes the authoritative result here: true/false once auth
// settles, or undefined to return to the unresolved (hint-only) state. Keeping
// this in sync with account-nav's cachedUser is what lets isLikelySignedIn live
// outside account-nav (and break the import cycle).
export function setResolvedSignedIn(value: boolean | undefined): void {
  resolvedSignedIn = value;
}

// Synchronous best guess used to choose the initial render shape: the resolved
// value if auth has settled this load, else the persisted hint. Stale only in
// edge cases (sign-out from another tab), reconciled by the auth fetch.
export function isLikelySignedIn(): boolean {
  if (resolvedSignedIn !== undefined) return resolvedSignedIn;
  return readSignedInHint();
}

// Admin hint, same shape as the signed-in hint: site-shell paints the
// admin-only nav links from it before /api/auth/me resolves, account-nav
// reconciles every [data-admin-only] element once auth settles. Purely
// cosmetic — /database and /engines are admin-gated server-side.
const ADMIN_HINT_KEY = 'mb_admin';

let resolvedAdmin: boolean | undefined;

export function readAdminHint(): boolean {
  try {
    return window.localStorage.getItem(ADMIN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAdminHint(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(ADMIN_HINT_KEY, '1');
    else window.localStorage.removeItem(ADMIN_HINT_KEY);
  } catch {
    // localStorage unavailable (private mode etc.) — fall through.
  }
}

export function setResolvedAdmin(value: boolean | undefined): void {
  resolvedAdmin = value;
}

export function isLikelyAdmin(): boolean {
  if (resolvedAdmin !== undefined) return resolvedAdmin;
  return readAdminHint();
}

// Variant grants, same shape again. /api/auth/me names the allowlisted
// variants this account may take a seat at (every one for an admin, the
// granted rows for a player), and the play menu offers a gated variant only
// when the account can actually sit down at it. Cosmetic like the other two
// hints: the seat check on the server is the gate, so a forged entry here
// buys a menu item and still no seat.
const VARIANT_GRANTS_HINT_KEY = 'mb_variant_grants';

let resolvedVariantGrants: readonly string[] | undefined;

export function readVariantGrantsHint(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(VARIANT_GRANTS_HINT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeVariantGrantsHint(grants: readonly string[]): void {
  try {
    if (grants.length > 0)
      window.localStorage.setItem(VARIANT_GRANTS_HINT_KEY, JSON.stringify(grants));
    else window.localStorage.removeItem(VARIANT_GRANTS_HINT_KEY);
  } catch {
    // localStorage unavailable (private mode etc.) — fall through.
  }
}

// Fired once account-nav has the account's real grants, so a surface drawn from
// the hint (a rules page's Play buttons) can redraw for an account granted since
// the hint was written.
export const variantGrantsResolvedEvent = 'mb:variant-grants-resolved';

export function setResolvedVariantGrants(grants: readonly string[] | undefined): void {
  resolvedVariantGrants = grants;
  try {
    window.dispatchEvent(new Event(variantGrantsResolvedEvent));
  } catch {
    // No window (tests outside a DOM): nothing is listening.
  }
}

export function hasLikelyVariantGrant(gameSpecId: string): boolean {
  const grants = resolvedVariantGrants ?? readVariantGrantsHint();
  return grants.includes(gameSpecId);
}

// Stats exclusion, same shape as the admin hint. An account excluded from stats
// (users.stats_excluded_at: the owner, QA) never plays rated, so the play
// surfaces grey out their rated controls for it. Cosmetic like the others: the
// server refuses the rated post, accept and seat (403
// rated_requires_counted_account) whatever this says.
const STATS_EXCLUDED_HINT_KEY = 'mb_stats_excluded';

let resolvedStatsExcluded: boolean | undefined;

export function readStatsExcludedHint(): boolean {
  try {
    return window.localStorage.getItem(STATS_EXCLUDED_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStatsExcludedHint(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(STATS_EXCLUDED_HINT_KEY, '1');
    else window.localStorage.removeItem(STATS_EXCLUDED_HINT_KEY);
  } catch {
    // localStorage unavailable (private mode etc.) — fall through.
  }
}

// Fired once account-nav knows whether the account is excluded, so a panel
// drawn from the hint can redraw its rated controls.
export const statsExcludedResolvedEvent = 'mb:stats-excluded-resolved';

export function setResolvedStatsExcluded(value: boolean | undefined): void {
  resolvedStatsExcluded = value;
  try {
    window.dispatchEvent(new Event(statsExcludedResolvedEvent));
  } catch {
    // No window (tests outside a DOM): nothing is listening.
  }
}

export function isLikelyStatsExcluded(): boolean {
  if (resolvedStatsExcluded !== undefined) return resolvedStatsExcluded;
  return readStatsExcludedHint();
}
