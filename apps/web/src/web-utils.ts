import type { Color, Square } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';

export const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const ranks = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const allSquares: Square[] = ranks.flatMap((r) => files.map((f) => `${f}${r}` as Square));

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function isColor(value: unknown): value is Color {
  return value === 'white' || value === 'black';
}

export function formatClock(ms: number, showTenths = false): string {
  const bounded = Math.max(0, ms);
  const totalTenths = showTenths ? Math.ceil(bounded / 100) : Math.ceil(bounded / 1000) * 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const suffix = showTenths ? `.${tenths}` : '';
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${suffix}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}${suffix}`;
}

// Day-scale clock for correspondence (days-per-move) rooms: two significant
// units while days or hours remain, then the live M:SS format inside the final
// hour so the endgame countdown stays readable. The units are catalog phrases
// ("23h 58m", "23小時58分鐘"), never English letters under another locale.
export function formatDayClock(ms: number, locale?: Locale): string {
  const bounded = Math.max(0, ms);
  const totalMinutes = Math.floor(bounded / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return t('correspondence.clockDaysHours', { days, hours }, locale);
  if (hours > 0) return t('correspondence.clockHoursMinutes', { hours, minutes }, locale);
  return formatClock(bounded);
}

/**
 * The live first-move abort countdown. Seconds inside the last minute; M:SS
 * above it, since a bot game's window is five minutes (#668) and "aborting in
 * 300s" reads as noise.
 */
export function firstMoveAbortCountdownText(
  remainingMs: number,
  isSideToMove: boolean,
  locale?: Locale,
): string {
  const bounded = Math.max(0, remainingMs);
  if (bounded > 60_000) {
    const time = formatClock(bounded);
    return isSideToMove
      ? t('live.makeFirstMoveAbortingInTime', { time }, locale)
      : t('live.waitingFirstMoveAbortingInTime', { time }, locale);
  }
  const seconds = Math.ceil(bounded / 1000);
  return isSideToMove
    ? t('live.makeFirstMoveAbortingIn', { seconds }, locale)
    : t('live.waitingFirstMoveAbortingIn', { seconds }, locale);
}

/** One deadline label for correspondence cards and compact inbox rows. */
export function correspondenceTimeLeftLabel(dueAt: string, now: number, locale?: Locale): string {
  const remaining = Date.parse(dueAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return t('correspondence.dueNow', {}, locale);
  return t('correspondence.timeLeft', { time: formatDayClock(remaining, locale) }, locale);
}

export function oppositeColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

// How long a player waits in the lobby before we surface the play-the-engine
// offer. Empty-lobby backstop so a cold site is never a dead end.
export const ENGINE_OFFER_AFTER_MS = 15_000;

export function shouldOfferEngine(params: {
  elapsedMs: number;
  thresholdMs: number;
  stillWaiting: boolean;
  hasEngine: boolean;
}): boolean {
  return params.stillWaiting && params.hasEngine && params.elapsedMs >= params.thresholdMs;
}
