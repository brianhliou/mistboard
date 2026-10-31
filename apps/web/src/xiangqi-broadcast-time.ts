// Broadcast dates in the EVENT's clock, not the viewer's.
//
// A seeded round carries its own offset ("2026-09-13T14:30:00+08:00"), and the
// Intl default renders that in the viewer's zone: a Shanghai round at 14:30
// read "Sep 12, 11:30 PM" from California, one day off and the wrong afternoon.
// Nobody following a tournament wants the viewer-local time of a game they are
// not attending; they want the time on the venue's wall. So: keep the offset the
// string carries, and format the clock reading as if it were UTC.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';

const OFFSET = /([+-])(\d{2}):?(\d{2})$/;

/** The offset the ISO string carries, in minutes east of UTC; 0 for `Z`, null when it carries none. */
export function isoOffsetMinutes(value: string): number | null {
  if (/Z$/i.test(value)) return 0;
  const match = OFFSET.exec(value);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** A Date whose UTC fields read as the source's local clock. */
export function shiftedToOffset(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const offset = isoOffsetMinutes(value);
  return offset === null ? date : new Date(date.getTime() + offset * 60_000);
}

function hasClock(value: string): boolean {
  return value.includes('T');
}

// A source that dates its games but gives no time ("2026-07-28", an XQBase
// file) is written date-only, and a date-only string is a calendar day, not a
// moment: JavaScript reads it as UTC midnight, so it is formatted in UTC or a
// viewer west of Greenwich sees the day before.
function readsAsUtc(value: string): boolean {
  return isoOffsetMinutes(value) !== null || !hasClock(value);
}

// Dates read in the site's language (its locale setting), not the browser's:
// a zh reader on an English browser saw "Sep 18" beside 第9轮.

/** "Sep 13, 2026, 2:30 PM" in the event's clock; a date-only string stays a date. */
export function formatEventDateTime(
  value: string | undefined,
  locale: string = currentLocale(),
): string | null {
  if (!value) return null;
  const shifted = shiftedToOffset(value);
  if (!shifted) return value;
  const inSourceZone = readsAsUtc(value);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(hasClock(value) ? { hour: 'numeric', minute: '2-digit' } : {}),
    ...(inSourceZone ? { timeZone: 'UTC' } : {}),
  }).format(shifted);
}

/** "Sep 13" (year only outside the current one), in the event's clock. */
export function formatEventDay(
  value: string | undefined,
  locale: string = currentLocale(),
): string | null {
  if (!value) return null;
  const shifted = shiftedToOffset(value);
  if (!shifted) return null;
  const inSourceZone = readsAsUtc(value);
  const year = inSourceZone ? shifted.getUTCFullYear() : shifted.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(year === new Date().getFullYear() ? {} : { year: 'numeric' }),
    ...(inSourceZone ? { timeZone: 'UTC' } : {}),
  }).format(shifted);
}

/** "Sep 9 to Sep 13, 2026": days only, since a tour's ends-at is the last day, not a moment. */
export function formatEventDateRange(
  startsAt: string | undefined,
  endsAt: string | undefined,
  locale: string = currentLocale(),
): string | null {
  const start = formatEventDay(startsAt, locale);
  const end = formatEventDay(endsAt, locale);
  if (start && end && start !== end) {
    // The joiner follows the dates' language; a raw tag ('en-US') reads English.
    const catalog: Locale = locale.startsWith('zh') ? (locale as Locale) : 'en';
    return t('broadcast.dateRange', { start, end }, catalog);
  }
  return start ?? end;
}

/** "UTC+8" for the hero, so the clock readings say whose clock they are. */
export function formatEventOffset(value: string | undefined): string | null {
  if (!value) return null;
  const minutes = isoOffsetMinutes(value);
  if (minutes === null) return null;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}
