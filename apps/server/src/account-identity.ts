import { randomInt } from 'node:crypto';

export const maxHandleLength = 24;
export const maxDisplayNameLength = 40;

const maxEmailLength = 254;
const fallbackHandlePrefix = 'player';
const reservedHandles = new Set([
  'about',
  'account',
  'admin',
  'api',
  'arena',
  'auth',
  'engine',
  'engines',
  'forum',
  'game',
  'games',
  // Inbox route literals: /api/inbox/:handle shares its namespace with these
  // fixed segments (see routes/inbox.ts), so a user with one of these handles
  // could never be messaged by URL.
  'inbox',
  'learn',
  'login',
  'logout',
  'profile',
  'reports',
  'room',
  'settings',
  'threads',
  'unread-count',
  'watch',
]);

export function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > maxEmailLength) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting non-ASCII / control chars in emails is the rule's intent
  if (!/^[\x00-\x7F]+$/.test(email)) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) return null;
  const [, domain = ''] = email.split('@');
  if (
    domain
      .split('.')
      .some((label) => label.length === 0 || label.startsWith('-') || label.endsWith('-'))
  ) {
    return null;
  }
  return email;
}

// Only for recognizing legacy generated handles. Never use an email stem to
// allocate a new public identity.
export function historicalEmailHandleStem(email: string): string | null {
  const local = email.split('@', 1)[0] ?? '';
  const publicStem = local.split('+', 1)[0] ?? '';
  const normalized = publicStem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxHandleLength)
    .replace(/-+$/g, '');
  // Historical signup never minted a bare reserved or too-short stem.
  if (normalized.length < 3 || reservedHandles.has(normalized)) return null;
  return normalized;
}

// True when a handle is one historical signup minted from this email: the
// bare stem, or the stem cut to fit plus the five-digit collision suffix
// (`stem-48213`), which still shows the stem.
export function isHistoricalEmailHandle(handle: string, email: string): boolean {
  const stem = historicalEmailHandleStem(email);
  if (!stem) return false;
  const value = handle.toLowerCase();
  if (value === stem) return true;
  const prefix = stem.slice(0, maxHandleLength - 6).replace(/-+$/g, '');
  return (
    value.length === prefix.length + 6 &&
    value.startsWith(`${prefix}-`) &&
    /^[0-9]{5}$/.test(value.slice(prefix.length + 1))
  );
}

// A fully-random `player-xxxxx` handle (36^5 ≈ 60M space), independent of email.
export function randomFallbackHandle(): string {
  return `${fallbackHandlePrefix}-${randomHandleSuffix()}`;
}

export function normalizeProfileHandle(value: string | null): string | null {
  if (!value) return null;
  const handle = value.trim().toLowerCase();
  if (handle.length < 3 || handle.length > maxHandleLength) return null;
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(handle)) return null;
  if (reservedHandles.has(handle)) return null;
  return handle;
}

export function normalizeDisplayName(value: string | null): string | null {
  if (!value) return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > maxDisplayNameLength) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars in display names is the rule's intent
  if (/[\u0000-\u001F\u007F]/.test(name)) return null;
  return name;
}

function randomHandleSuffix(): string {
  return randomInt(0, 36 ** 5)
    .toString(36)
    .padStart(5, '0');
}
