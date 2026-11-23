import type { FlairKey } from './flair.js';
import type { ProfileVisibility } from './persistence-accounts.js';
import type { PlayerTitle } from './persistence-titles.js';

/**
 * The public profile decorations a live seat carries beside its account
 * (#1083): the verified title and the cosmetic flair. Both are omitted when
 * unset, so an undecorated seat keeps the token shape it always had.
 *
 * They follow the linkable-handle gate of `linkableIdentitySql`: a closed or
 * private account yields neither. Guests and engine seats have no account, so
 * they never carry them. The seat learns them when it is minted or loaded; a
 * flair changed mid-game shows from the next game.
 */
export type SeatDecorations = {
  userTitle?: PlayerTitle;
  userFlair?: FlairKey;
};

/** The account identity a pre-issued seat (rematch, account rooms) is minted for. */
export type SeatIdentity = {
  userId: string | null;
  userHandle: string | null;
  userDisplayName: string | null;
} & SeatDecorations;

type DecoratedAccount = {
  title?: PlayerTitle | null;
  flair?: FlairKey | null;
  profileVisibility?: ProfileVisibility | null;
  closedAt?: Date | null;
};

/** The gated decorations for an account about to hold a seat. */
export function seatDecorationsForAccount(
  account: DecoratedAccount | null | undefined,
): SeatDecorations {
  if (!account || account.closedAt != null || account.profileVisibility === 'private') return {};
  return {
    ...(account.title ? { userTitle: account.title } : {}),
    ...(account.flair ? { userFlair: account.flair } : {}),
  };
}

/** Copy the decorations already on a seat identity (rematch, hydration). */
export function seatDecorationsOf(
  source: { userTitle?: PlayerTitle | null; userFlair?: FlairKey | null } | null | undefined,
): SeatDecorations {
  return {
    ...(source?.userTitle ? { userTitle: source.userTitle } : {}),
    ...(source?.userFlair ? { userFlair: source.userFlair } : {}),
  };
}

/** A seat identity with its decorations replaced by `next`'s. */
export function withSeatDecorations<T extends SeatDecorations>(state: T, next: SeatDecorations): T {
  const { userTitle: _title, userFlair: _flair, ...rest } = state;
  return { ...rest, ...next } as T;
}
