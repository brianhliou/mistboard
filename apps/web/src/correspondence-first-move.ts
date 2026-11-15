import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

export type FirstMoveOwedFailure = {
  error?: string;
  roomId?: string;
  opponentName?: string | null;
};

/** Shared by every correspondence start/accept surface. Names are plain text. */
export function renderFirstMoveOwed(
  status: HTMLElement,
  failure: FirstMoveOwedFailure | null | undefined,
  locale: Locale = currentLocale(),
): boolean {
  if (failure?.error !== 'first_move_owed' || !failure.roomId) return false;
  const link = document.createElement('a');
  link.href = localizedHref(`/room/${encodeURIComponent(failure.roomId)}`, locale);
  link.textContent = t(
    'correspondence.firstMoveOwed',
    { opponent: failure.opponentName || t('correspondence.bellEndedOpponent', {}, locale) },
    locale,
  );
  status.replaceChildren(link);
  status.hidden = false;
  return true;
}
