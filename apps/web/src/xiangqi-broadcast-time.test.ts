import { describe, expect, it } from 'vitest';
import {
  formatEventDateRange,
  formatEventDateTime,
  formatEventDay,
  formatEventOffset,
  isoOffsetMinutes,
} from './xiangqi-broadcast-time.js';

describe('broadcast times read in the event clock', () => {
  it('keeps a Shanghai afternoon an afternoon wherever the viewer sits', () => {
    // From California the Intl default made this "Sep 12, 11:30 PM".
    expect(formatEventDateTime('2026-09-13T14:30:00+08:00', 'en-US')).toBe('Sep 13, 2026, 2:30 PM');
    expect(formatEventDateTime('2026-09-13T14:30:00-05:00', 'en-US')).toBe('Sep 13, 2026, 2:30 PM');
  });

  it('reads offsets with and without a colon, and Z', () => {
    expect(isoOffsetMinutes('2026-09-13T14:30:00+0800')).toBe(480);
    expect(isoOffsetMinutes('2026-09-13T14:30:00-05:30')).toBe(-330);
    expect(isoOffsetMinutes('2026-09-13T14:30:00Z')).toBe(0);
    expect(isoOffsetMinutes('2026-09-13')).toBeNull();
  });

  it('ranges over days, never moments', () => {
    expect(
      formatEventDateRange('2026-09-09T00:00:00+08:00', '2026-09-13T23:59:59+08:00', 'en-US'),
    ).toBe('Sep 9 to Sep 13');
    expect(formatEventDay('2025-09-22T00:00:00+08:00', 'en-US')).toBe('Sep 22, 2025');
  });

  it('names the clock', () => {
    expect(formatEventOffset('2026-09-13T14:30:00+08:00')).toBe('UTC+8');
    expect(formatEventOffset('2026-09-13T14:30:00-05:30')).toBe('UTC-5:30');
    expect(formatEventOffset('2026-09-13')).toBeNull();
  });

  it('shows a date-only round as its day, with no clock, in any viewer zone', () => {
    // XQBase dates its games but gives no time: the round read "Jul 28, 2026,
    // 12:00 AM" when the import guessed midnight, and a date-only string read
    // as UTC midnight is the day before for a viewer in California.
    const zone = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Asia/Ho_Chi_Minh', 'UTC']) {
        process.env.TZ = tz;
        expect(formatEventDateTime('2026-07-28', 'en-US')).toBe('Jul 28, 2026');
        expect(formatEventDay('2025-07-28', 'en-US')).toBe('Jul 28, 2025');
        expect(formatEventDateRange('2025-07-24', '2025-07-28', 'en-US')).toBe(
          'Jul 24, 2025 to Jul 28, 2025',
        );
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('passes an unparseable value through rather than hiding it', () => {
    expect(formatEventDateTime('soon')).toBe('soon');
    expect(formatEventDateTime(undefined)).toBeNull();
  });
});
