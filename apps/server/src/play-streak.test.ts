import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarDay, computePlayStreak, resolveTimeZone } from './play-streak.js';

describe('computePlayStreak', () => {
  it('is empty with no counted days', () => {
    assert.deepEqual(computePlayStreak([], '2026-09-13'), {
      current: 0,
      best: 0,
      lastPlayedDay: null,
      today: '2026-09-13',
    });
  });

  it('counts a run that ends today', () => {
    const streak = computePlayStreak(['2026-09-11', '2026-09-12', '2026-09-13'], '2026-09-13');
    assert.equal(streak.current, 3);
    assert.equal(streak.best, 3);
    assert.equal(streak.lastPlayedDay, '2026-09-13');
  });

  it('keeps a run alive through the day after its last game', () => {
    const streak = computePlayStreak(['2026-09-11', '2026-09-12'], '2026-09-13');
    assert.equal(streak.current, 2);
  });

  it('drops to zero two days after the last game while the best stays', () => {
    const streak = computePlayStreak(['2026-09-10', '2026-09-11'], '2026-09-13');
    assert.equal(streak.current, 0);
    assert.equal(streak.best, 2);
    assert.equal(streak.lastPlayedDay, '2026-09-11');
  });

  it('best is the longest run, not the current one', () => {
    const streak = computePlayStreak(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-09-12', '2026-09-13'],
      '2026-09-13',
    );
    assert.equal(streak.current, 2);
    assert.equal(streak.best, 4);
  });

  it('ignores order and duplicate days, and crosses a month boundary', () => {
    const streak = computePlayStreak(
      ['2026-09-01', '2026-08-31', '2026-08-31', '2026-08-30'],
      '2026-09-01',
    );
    assert.equal(streak.current, 3);
    assert.equal(streak.best, 3);
  });
});

describe('time zones', () => {
  it('resolves a browser zone and falls back to UTC for anything else', () => {
    assert.equal(resolveTimeZone('America/New_York'), 'America/New_York');
    assert.equal(resolveTimeZone('Asia/Shanghai'), 'Asia/Shanghai');
    assert.equal(resolveTimeZone('Not/AZone'), 'UTC');
    assert.equal(resolveTimeZone("x'; DROP TABLE games; --"), 'UTC');
    assert.equal(resolveTimeZone(null), 'UTC');
    assert.equal(resolveTimeZone(''), 'UTC');
  });

  it('buckets a late US evening on the local date, not the UTC one', () => {
    const now = new Date('2026-09-14T02:30:00.000Z');
    assert.equal(calendarDay(now, 'UTC'), '2026-09-14');
    assert.equal(calendarDay(now, 'America/New_York'), '2026-09-13');
    assert.equal(calendarDay(now, 'Asia/Shanghai'), '2026-09-14');
  });
});
