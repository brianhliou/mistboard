import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';

/** `2026-09` as "September 2026" (or 2026年9月), the lichess month label. Shared
 *  by the /changelog and /feed month archives. */
export function formatMonth(id: string, locale: Locale = currentLocale()): string {
  const [year, month] = id.split('-').map(Number);
  if (!year || !month) return id;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(LOCALE_META[locale].dateLocale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
