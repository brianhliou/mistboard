import type { FirstMoveOwedFailure } from './correspondence-first-move.js';
import type { SeekPreferredColor } from './correspondence-model.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';

// Play the host: the site's author offers casual correspondence games. Shared by
// the /correspondence host card and the homepage Play a game dialog, so both read
// the same offer, start a game the same way and refuse with the same words.

export const HOST_PATH = '/api/correspondence/host';

export type HostInfo = {
  host: { handle: string; displayName: string };
  daysPerMove: number;
  gameSpecIds: string[];
  limits: { perPlayer: number; total: number };
  signedIn: boolean;
  isHost?: boolean;
  canPlay?: boolean;
  reason?: 'player_limit_reached' | 'host_full' | null;
};

// The offer is the author by name: every surface reads his full name and photo,
// not whatever the host account's display name says.
export const HOST_NAME = 'Brian H. Liou';
export const HOST_PHOTO = '/brand/brian-h-liou.jpg';

/** The host offer, or null while it is off (404) or unreachable. */
export async function fetchHostInfo(): Promise<HostInfo | null> {
  try {
    const res = await fetch(HOST_PATH);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<HostInfo> & { enabled?: boolean };
    if (body.enabled !== true || !body.host || !Array.isArray(body.gameSpecIds)) return null;
    return body as HostInfo;
  } catch {
    return null;
  }
}

/** The variants the host plays, in the caller's order, limited to what it offers. */
export function hostOfferedSpecIds<T extends string>(info: HostInfo, offered: readonly T[]): T[] {
  const host = new Set(info.gameSpecIds);
  return offered.filter((id) => host.has(id));
}

export function hostRefusalText(
  code: string | null | undefined,
  info: HostInfo,
  limit: number | undefined,
  locale: Locale = currentLocale(),
): string {
  const name = HOST_NAME;
  switch (code) {
    case 'player_limit_reached':
      return t(
        'correspondence.hostPlayerLimit',
        { name, limit: limit ?? info.limits.perPlayer },
        locale,
      );
    case 'host_full':
      return t('correspondence.hostFull', { name, limit: limit ?? info.limits.total }, locale);
    case 'server_draining':
      return t('setup.serverRestartTimeout', {}, locale);
    default:
      return t('correspondence.hostCouldNotStart', {}, locale);
  }
}

export function buildHostPhoto(
  size = 56,
  className = 'correspondence-host-photo',
): HTMLImageElement {
  const photo = document.createElement('img');
  photo.className = className;
  photo.src = HOST_PHOTO;
  photo.alt = '';
  photo.width = size;
  photo.height = size;
  return photo;
}

export type HostStartOutcome =
  | { kind: 'started'; url: string }
  | { kind: 'sign-in' }
  | { kind: 'first-move-owed'; failure: FirstMoveOwedFailure }
  // A cap refusal stays refused until a game ends; anything else may pass on retry.
  | { kind: 'refused'; message: string; capped: boolean; error?: string };

/** Starts a casual game against the host; the outcome says what to show. */
export async function startHostGame(
  info: HostInfo,
  request: { gameSpecId: string; side: SeekPreferredColor },
  locale: Locale = currentLocale(),
): Promise<HostStartOutcome> {
  try {
    const res = await fetch(HOST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameSpecId: request.gameSpecId, side: request.side }),
    });
    const result = (await res.json().catch(() => null)) as
      | ({ url?: string; error?: string; limit?: number } & FirstMoveOwedFailure)
      | null;
    if (res.ok && result?.url) return { kind: 'started', url: result.url };
    if (res.status === 401) return { kind: 'sign-in' };
    if (result?.error === 'first_move_owed' && result.roomId) {
      return { kind: 'first-move-owed', failure: result };
    }
    const capped = result?.error === 'player_limit_reached' || result?.error === 'host_full';
    return {
      kind: 'refused',
      message: hostRefusalText(result?.error, info, result?.limit, locale),
      capped,
      ...(result?.error ? { error: result.error } : {}),
    };
  } catch {
    return {
      kind: 'refused',
      message: t('correspondence.hostCouldNotStart', {}, locale),
      capped: false,
    };
  }
}
