// Core account persistence: the users-row vocabulary (types, guards, defaults),
// the canonical row plumbing (USER_COLUMNS, userFromRow), and the core account
// row CRUD (create/find/exists/handle-resolve). Domain flows split out to
// sibling modules: persistence-auth.ts (challenges, rate limits, email change,
// closure), persistence-sessions.ts (session metadata/revocation),
// persistence-profiles.ts (profile + preferences + DM policy + profile reads),
// persistence-leaderboards.ts (cross-user read-side analytics). The exported
// row plumbing (USER_COLUMNS, USER_COLUMNS_QUALIFIED, UserRow, userFromRow,
// isUniqueViolation) is internal to those persistence-* modules; it is
// deliberately NOT re-exported from the persistence.ts barrel.
import type { FlairKey } from './flair.js';
import { getPool } from './persistence-db.js';
import type { PlayerTitle } from './persistence-titles.js';

export type AccountRole = 'player' | 'admin';
export type AccountLocale = 'en' | 'zh-Hans' | 'zh-Hant';
export type ProfileVisibility = 'private' | 'unlisted' | 'public';

export const ACCOUNT_LOCALES: readonly AccountLocale[] = ['en', 'zh-Hans', 'zh-Hant'];
export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = ['private', 'unlisted', 'public'];

export function isAccountLocale(value: unknown): value is AccountLocale {
  return typeof value === 'string' && ACCOUNT_LOCALES.includes(value as AccountLocale);
}

export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return typeof value === 'string' && PROFILE_VISIBILITIES.includes(value as ProfileVisibility);
}

export type PieceAnimationPreference = 'none' | 'fast' | 'normal' | 'slow';
export type AccountDisplayPreferences = { pieceAnimation?: PieceAnimationPreference };

export type ClockTenthsPreference = 'never' | 'low-time' | 'always';
export type AccountPreferenceKey =
  | 'clockTenths'
  | 'lowTimeSound'
  | 'premoves'
  | 'confirmGameActions'
  | 'inboxBell'
  | 'correspondenceBell'
  | 'challengesBell'
  | 'forumBell'
  | 'followersBell'
  | 'correspondenceDeadlineEmail'
  | 'correspondenceStartEmail';
export type AccountPreferences = {
  clockTenths: ClockTenthsPreference;
  lowTimeSound: boolean;
  premoves: boolean;
  confirmGameActions: boolean;
  inboxBell: boolean;
  correspondenceBell: boolean;
  // Bell mutes for the sources that arrived after the first two: pending
  // challenges, forum replies/quotes, new followers. All default on.
  challengesBell: boolean;
  forumBell: boolean;
  followersBell: boolean;
  correspondenceDeadlineEmail: boolean;
  // Sent once, when somebody accepts a seek you posted and walked away from.
  // Distinct from the deadline warning: that one fires late, near forfeit.
  correspondenceStartEmail: boolean;
};

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  clockTenths: 'low-time',
  lowTimeSound: true,
  premoves: true,
  confirmGameActions: true,
  inboxBell: true,
  correspondenceBell: true,
  challengesBell: true,
  forumBell: true,
  followersBell: true,
  correspondenceDeadlineEmail: true,
  correspondenceStartEmail: true,
};

export function isClockTenthsPreference(value: unknown): value is ClockTenthsPreference {
  return value === 'never' || value === 'low-time' || value === 'always';
}

export const PIECE_ANIMATION_PREFERENCES: readonly PieceAnimationPreference[] = [
  'none',
  'fast',
  'normal',
  'slow',
];

export function isPieceAnimationPreference(value: unknown): value is PieceAnimationPreference {
  return (
    typeof value === 'string' &&
    PIECE_ANIMATION_PREFERENCES.includes(value as PieceAnimationPreference)
  );
}

// Who may START a conversation with this user (#93). Replies to an existing
// thread are always allowed; the send guard in routes/inbox.ts only consults
// this for thread-creating sends. 'friends' = players this user follows.
export type DmPolicy = 'never' | 'friends' | 'always';

export const DM_POLICIES: readonly DmPolicy[] = ['never', 'friends', 'always'];

export function isDmPolicy(value: unknown): value is DmPolicy {
  return typeof value === 'string' && DM_POLICIES.includes(value as DmPolicy);
}

export type UserAccount = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  handle: string;
  handleChangedAt: Date | null;
  displayName: string;
  displayNameChangedAt: Date | null;
  bio: string;
  location: string;
  profileLinks: string[];
  displayPreferences: AccountDisplayPreferences;
  accountPreferences: AccountPreferences;
  profileVisibility: ProfileVisibility;
  accountRole: AccountRole;
  // Play lock (126). Non-null = this account cannot take a game seat, post or
  // accept a correspondence challenge, or book a puzzle attempt. It is for
  // accounts that are identities rather than players (the official @mistboard
  // account), and is orthogonal to accountRole: admins play.
  playDisabledAt: Date | null;
  // Statistics exclusion (136): this account's games are not site activity.
  // Optional so fixtures that build accounts by hand keep compiling.
  statsExcludedAt?: Date | null;
  // Verified player title (088), granted only through the title-verification
  // pipeline (routes/titles.ts). NULL = untitled. Closed vocabulary; see
  // persistence-titles.ts.
  title: PlayerTitle | null;
  // Cosmetic profile flair (122): one key from the closed allowlist in
  // flair.ts, or NULL for none. Purely decorative — nothing keys behaviour off
  // it, so an unknown value read from an older row degrades to "no flair"
  // rather than breaking a profile render.
  flair: FlairKey | null;
  locale: AccountLocale | null;
  dmPolicy: DmPolicy;
  eloRating: number;
  // Patron program (078). patronSince is set while a donation is active (drives
  // the cosmetic badge); NULL = not a patron. stripeCustomerId is the stable
  // account->Stripe-customer map for reusing a customer and opening the billing
  // portal; NULL until the first checkout.
  patronSince: Date | null;
  stripeCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

// The play lock as a predicate. One import for every enforcement point (seat
// assignment, correspondence seeks, puzzle attempts) so the rule cannot drift
// between them, and null-tolerant so a signed-out caller is simply not locked.
export function isPlayDisabled(user: Pick<UserAccount, 'playDisabledAt'> | null): boolean {
  return user?.playDisabledAt != null;
}

// Canonical users-table column list for reads. Keep in lockstep with UserRow
// and userFromRow below: every SELECT/RETURNING of a full user row derives from
// this, so a column can't be silently dropped from one query (which once
// stripped elo_rating from the session-load path).
export const USER_COLUMNS = [
  'id',
  'email',
  'email_verified_at',
  'handle',
  'handle_changed_at',
  'display_name',
  'display_name_changed_at',
  'bio',
  'location',
  'profile_links',
  'display_preferences',
  'account_preferences',
  'profile_visibility',
  'account_role',
  'play_disabled_at',
  'stats_excluded_at',
  'title',
  'flair',
  'locale',
  'dm_policy',
  'elo_rating',
  'patron_since',
  'stripe_customer_id',
  'created_at',
  'updated_at',
  'closed_at',
].join(', ');

// Same columns qualified with the `users.` alias, for queries that join users to
// another table (e.g. account_sessions) where bare column names are ambiguous.
export const USER_COLUMNS_QUALIFIED = USER_COLUMNS.split(', ')
  .map((column) => `users.${column}`)
  .join(', ');

export async function findUserByEmail(email: string): Promise<UserAccount | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE lower(email) = lower($1)
       AND closed_at IS NULL
     LIMIT 1`,
    [email],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function createUser(user: {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  handle: string;
  displayName: string;
  profileVisibility?: UserAccount['profileVisibility'];
  accountRole?: AccountRole;
  now: Date;
}): Promise<UserAccount> {
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users
       (id, email, email_verified_at, handle, display_name, profile_visibility, account_role, created_at, updated_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8
     WHERE NOT EXISTS (
       SELECT 1 FROM user_handle_reservations
       WHERE lower(handle) = lower($4) AND expires_at > $8
     )
     RETURNING ${USER_COLUMNS}`,
    [
      user.id,
      user.email,
      user.emailVerifiedAt,
      user.handle,
      user.displayName,
      user.profileVisibility ?? 'public',
      user.accountRole ?? 'player',
      user.now,
    ],
  );
  if (!rows[0]) {
    const error = new Error('handle is reserved') as Error & { code: string };
    error.code = '23505';
    throw error;
  }
  return userFromRow(rows[0]!);
}

// Cheap existence probe by account id — used to validate a challenge target
// before writing a directed seek (a clean 404 instead of an FK violation).
export async function userExists(userId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ one: number }>(
    `SELECT 1 AS one FROM users WHERE id = $1 AND closed_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

// Resolve a user's id by handle (case-insensitive), or null. Directed challenges
// address the target by handle like the rest of the social API; this maps it to
// the id the directed-seek path expects without exposing ids to the client.
export async function userIdForHandle(handle: string): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM users WHERE lower(handle) = lower($1) AND closed_at IS NULL LIMIT 1`,
    [handle],
  );
  return rows[0]?.id ?? null;
}

export type UserRow = {
  id: string;
  email: string;
  email_verified_at: Date | null;
  handle: string;
  handle_changed_at: Date | null;
  display_name: string;
  display_name_changed_at: Date | null;
  bio: string;
  location: string;
  profile_links: string[];
  display_preferences: unknown;
  account_preferences: unknown;
  profile_visibility: UserAccount['profileVisibility'];
  account_role: AccountRole;
  play_disabled_at: Date | null;
  stats_excluded_at: Date | null;
  title: PlayerTitle | null;
  flair: FlairKey | null;
  locale: AccountLocale | null;
  dm_policy: DmPolicy;
  elo_rating: number;
  patron_since: Date | null;
  stripe_customer_id: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
};

export function userFromRow(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    handle: row.handle,
    handleChangedAt: row.handle_changed_at,
    displayName: row.display_name,
    displayNameChangedAt: row.display_name_changed_at,
    bio: row.bio,
    location: row.location,
    profileLinks: row.profile_links,
    displayPreferences: displayPreferencesFromJson(row.display_preferences),
    accountPreferences: accountPreferencesFromJson(row.account_preferences),
    profileVisibility: row.profile_visibility,
    accountRole: row.account_role,
    playDisabledAt: row.play_disabled_at,
    statsExcludedAt: row.stats_excluded_at,
    title: row.title,
    flair: row.flair,
    locale: row.locale,
    dmPolicy: row.dm_policy,
    eloRating: row.elo_rating,
    patronSince: row.patron_since,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function displayPreferencesFromJson(value: unknown): AccountDisplayPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const pieceAnimation = (value as Record<string, unknown>).pieceAnimation;
  return isPieceAnimationPreference(pieceAnimation) ? { pieceAnimation } : {};
}

function accountPreferencesFromJson(value: unknown): AccountPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_ACCOUNT_PREFERENCES };
  }
  const parsed = value as Record<string, unknown>;
  return {
    clockTenths: isClockTenthsPreference(parsed.clockTenths)
      ? parsed.clockTenths
      : DEFAULT_ACCOUNT_PREFERENCES.clockTenths,
    lowTimeSound: booleanOrDefault(parsed.lowTimeSound, DEFAULT_ACCOUNT_PREFERENCES.lowTimeSound),
    premoves: booleanOrDefault(parsed.premoves, DEFAULT_ACCOUNT_PREFERENCES.premoves),
    confirmGameActions: booleanOrDefault(
      parsed.confirmGameActions,
      DEFAULT_ACCOUNT_PREFERENCES.confirmGameActions,
    ),
    inboxBell: booleanOrDefault(parsed.inboxBell, DEFAULT_ACCOUNT_PREFERENCES.inboxBell),
    correspondenceBell: booleanOrDefault(
      parsed.correspondenceBell,
      DEFAULT_ACCOUNT_PREFERENCES.correspondenceBell,
    ),
    challengesBell: booleanOrDefault(
      parsed.challengesBell,
      DEFAULT_ACCOUNT_PREFERENCES.challengesBell,
    ),
    forumBell: booleanOrDefault(parsed.forumBell, DEFAULT_ACCOUNT_PREFERENCES.forumBell),
    followersBell: booleanOrDefault(
      parsed.followersBell,
      DEFAULT_ACCOUNT_PREFERENCES.followersBell,
    ),
    correspondenceStartEmail: booleanOrDefault(
      parsed.correspondenceStartEmail,
      DEFAULT_ACCOUNT_PREFERENCES.correspondenceStartEmail,
    ),
    correspondenceDeadlineEmail: booleanOrDefault(
      parsed.correspondenceDeadlineEmail,
      DEFAULT_ACCOUNT_PREFERENCES.correspondenceDeadlineEmail,
    ),
  };
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
