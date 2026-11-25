import { describe, expect, it } from 'vitest';
import { hasAppTranslation, t } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import {
  correspondenceTimeLeftLabel,
  ENGINE_OFFER_AFTER_MS,
  escapeHtml,
  firstMoveAbortCountdownText,
  formatClock,
  formatDayClock,
  isColor,
  oppositeColor,
  shouldOfferEngine,
} from './web-utils.js';

describe('firstMoveAbortCountdownText', () => {
  it('shows m:ss above a minute, as in a five-minute bot window (#668)', () => {
    expect(firstMoveAbortCountdownText(299_100, true, 'en')).toBe(
      'Make your first move, aborting in 5:00',
    );
    expect(firstMoveAbortCountdownText(298_500, true, 'en')).toBe(
      'Make your first move, aborting in 4:59',
    );
    expect(firstMoveAbortCountdownText(90_000, false, 'en')).toBe(
      'Waiting for first move, aborting in 1:30',
    );
  });

  it('keeps seconds at a minute and below, as in the 30 s window', () => {
    expect(firstMoveAbortCountdownText(60_000, true, 'en')).toBe(
      'Make your first move, aborting in 60s',
    );
    expect(firstMoveAbortCountdownText(29_500, false, 'en')).toBe(
      'Waiting for first move, aborting in 30s',
    );
    expect(firstMoveAbortCountdownText(-1_000, true, 'en')).toBe(
      'Make your first move, aborting in 0s',
    );
  });
});

describe('formatClock', () => {
  it('formats zero ms as 0:00', () => {
    expect(formatClock(0)).toBe('0:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatClock(90_000)).toBe('1:30');
    expect(formatClock(60_000)).toBe('1:00');
    expect(formatClock(1_000)).toBe('0:01');
  });

  it('formats hours:minutes:seconds when duration exceeds one hour', () => {
    expect(formatClock(3_661_000)).toBe('1:01:01');
    expect(formatClock(3_600_000)).toBe('1:00:00');
  });

  it('rounds up to the next second when sub-second ms remain', () => {
    expect(formatClock(500)).toBe('0:01');
    expect(formatClock(59_999)).toBe('1:00');
  });

  it('clamps negative values to 0:00', () => {
    expect(formatClock(-5_000)).toBe('0:00');
  });

  it('shows tenths when showTenths is true', () => {
    expect(formatClock(0, true)).toBe('0:00.0');
    expect(formatClock(100, true)).toBe('0:00.1');
    expect(formatClock(1_500, true)).toBe('0:01.5');
    expect(formatClock(3_661_000, true)).toBe('1:01:01.0');
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes all special characters in a combined string', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('isColor', () => {
  it('returns true for white and black', () => {
    expect(isColor('white')).toBe(true);
    expect(isColor('black')).toBe(true);
  });

  it('returns false for spectator', () => {
    expect(isColor('spectator')).toBe(false);
  });

  it('returns false for undefined, null, and other values', () => {
    expect(isColor(undefined)).toBe(false);
    expect(isColor(null)).toBe(false);
    expect(isColor('')).toBe(false);
    expect(isColor(42)).toBe(false);
  });
});

describe('oppositeColor', () => {
  it('returns black for white', () => {
    expect(oppositeColor('white')).toBe('black');
  });

  it('returns white for black', () => {
    expect(oppositeColor('black')).toBe('white');
  });
});

describe('shouldOfferEngine', () => {
  const base = {
    elapsedMs: ENGINE_OFFER_AFTER_MS,
    thresholdMs: ENGINE_OFFER_AFTER_MS,
    stillWaiting: true,
    hasEngine: true,
  };

  it('offers once the threshold is reached while still waiting', () => {
    expect(shouldOfferEngine(base)).toBe(true);
  });

  it('does not offer before the threshold', () => {
    expect(shouldOfferEngine({ ...base, elapsedMs: ENGINE_OFFER_AFTER_MS - 1 })).toBe(false);
  });

  it('does not offer once a match arrives (no longer waiting)', () => {
    expect(shouldOfferEngine({ ...base, stillWaiting: false })).toBe(false);
  });

  it('does not offer when no engine is available', () => {
    expect(shouldOfferEngine({ ...base, hasEngine: false })).toBe(false);
  });
});

describe('formatDayClock', () => {
  it('shows days and hours while a day or more remains', () => {
    expect(formatDayClock(3 * 24 * 3_600_000)).toBe('3d 0h');
    expect(formatDayClock(2 * 24 * 3_600_000 + 14 * 3_600_000 + 30 * 60_000)).toBe('2d 14h');
  });

  it('shows hours and minutes inside the final day', () => {
    expect(formatDayClock(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(formatDayClock(3_600_000)).toBe('1h 0m');
  });

  it('falls back to the live M:SS format inside the final hour', () => {
    expect(formatDayClock(59 * 60_000)).toBe('59:00');
    expect(formatDayClock(90_000)).toBe('1:30');
    expect(formatDayClock(0)).toBe('0:00');
  });

  it('clamps negative values', () => {
    expect(formatDayClock(-5_000)).toBe('0:00');
  });
});

// Every served locale writes the day-scale clock in its own units: the /games
// card read "剩餘 23h 58m" under Traditional Chinese before the units moved
// into the catalog.
describe('formatDayClock and correspondenceTimeLeftLabel per locale', () => {
  const H23M58 = 23 * 3_600_000 + 58 * 60_000;
  const D2H4 = 2 * 24 * 3_600_000 + 4 * 3_600_000;
  const NOW = Date.parse('2026-11-24T00:00:00.000Z');
  const dueIn = (ms: number) => new Date(NOW + ms).toISOString();
  // English unit letters glued to a number ("23h", "58m", "2d").
  const ENGLISH_UNITS = /\d\s*[dhm]\b/;

  // Keyed by every served locale: a locale added to SUPPORTED_LOCALES without
  // a row here fails below instead of passing on the English fallback.
  const EXPECTED: Record<string, { hm: string; dh: string; left: string }> = {
    en: { hm: '23h 58m', dh: '2d 4h', left: '23h 58m left' },
    'zh-Hans': { hm: '23小时58分钟', dh: '2天4小时', left: '剩余 23小时58分钟' },
    'zh-Hant': { hm: '23小時58分鐘', dh: '2天4小時', left: '剩餘 23小時58分鐘' },
  };

  it('has an expectation for every served locale', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(SUPPORTED_LOCALES)('%s renders its own units', (locale) => {
    const row = EXPECTED[locale];
    if (!row) throw new Error(`no expected day-clock text for locale ${locale}`);
    expect(formatDayClock(H23M58, locale)).toBe(row.hm);
    expect(formatDayClock(D2H4, locale)).toBe(row.dh);
    expect(correspondenceTimeLeftLabel(dueIn(H23M58), NOW, locale)).toBe(row.left);
    if (locale !== 'en') {
      expect(formatDayClock(H23M58, locale)).not.toMatch(ENGLISH_UNITS);
      expect(formatDayClock(D2H4, locale)).not.toMatch(ENGLISH_UNITS);
      for (const key of [
        'correspondence.clockDaysHours',
        'correspondence.clockHoursMinutes',
      ] as const) {
        expect(hasAppTranslation(locale, key), `${locale} ${key}`).toBe(true);
      }
    }
  });

  it('the English-units check catches the string seen on /games (planted)', () => {
    expect('剩餘 23h 58m').toMatch(ENGLISH_UNITS);
    expect('2d 4h').toMatch(ENGLISH_UNITS);
    expect('剩餘 23小時58分鐘').not.toMatch(ENGLISH_UNITS);
  });

  it('uses the current locale when none is passed', () => {
    expect(formatDayClock(H23M58)).toBe(
      t('correspondence.clockHoursMinutes', { hours: 23, minutes: 58 }),
    );
  });
});
