import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PACING, type ReplyPaceInput, replyPace } from './engine-reply-pacing.js';

const base: ReplyPaceInput = {
  roomId: 'xq_test',
  ply: 20,
  legalCount: 40,
  cp: 30,
  mate: null,
  remainingMs: null,
  incrementMs: 0,
  computeMs: 80,
  enabled: true,
};

describe('replyPace', () => {
  it('does nothing while the flag is off', () => {
    assert.deepEqual(replyPace({ ...base, enabled: false }), {
      waitMs: 0,
      targetMs: 0,
      reason: 'off',
    });
  });

  it('holds an instant engine move in an untimed game', () => {
    const pace = replyPace(base);
    assert.equal(pace.reason, 'paced');
    assert.ok(pace.targetMs >= PACING.minTargetMs && pace.targetMs <= PACING.maxTargetMs);
    assert.equal(pace.waitMs, pace.targetMs - base.computeMs);
  });

  it('is the same wait for the same room and ply, and varies across plies', () => {
    assert.deepEqual(replyPace(base), replyPace(base));
    const targets = new Set(
      Array.from({ length: 12 }, (_, i) => replyPace({ ...base, ply: 20 + i }).targetMs),
    );
    assert.ok(targets.size > 6, `expected spread, got ${[...targets]}`);
  });

  it('subtracts the time the engine already spent, never waiting below zero', () => {
    const slow = replyPace({ ...base, computeMs: 10_000 });
    assert.equal(slow.waitMs, 0);
  });

  it('keeps a short beat when there is nothing to think about', () => {
    for (const input of [
      { ...base, legalCount: 1 },
      { ...base, cp: -PACING.decisiveCp },
      { ...base, cp: null, mate: 3 },
      { ...base, cp: null, mate: -2 },
    ]) {
      const pace = replyPace(input);
      assert.ok(Math.abs(pace.targetMs - PACING.beatMs) <= PACING.beatMs * PACING.jitter + 1);
      assert.equal(pace.waitMs, pace.targetMs - base.computeMs);
      assert.notEqual(pace.reason, 'paced');
    }
  });

  it('treats a few pawns down as a game still on', () => {
    // 10-15 local: a level-2 jieqi bot at -6 from move 3 replied on the beat all game.
    assert.equal(replyPace({ ...base, cp: -600 }).reason, 'paced');
    assert.equal(replyPace({ ...base, cp: -PACING.decisiveCp + 1 }).reason, 'paced');
  });

  it('varies the short reply too', () => {
    const beats = new Set(
      Array.from(
        { length: 12 },
        (_, i) => replyPace({ ...base, ply: 20 + i, legalCount: 1 }).targetMs,
      ),
    );
    assert.ok(beats.size > 6, `expected spread, got ${[...beats]}`);
  });

  it('plays instantly on a short clock, beat included', () => {
    const pace = replyPace({ ...base, remainingMs: PACING.lowClockMs - 1, computeMs: 0 });
    assert.deepEqual(pace, { waitMs: 0, targetMs: 0, reason: 'low-clock' });
  });

  it('scales with the clock and never spends the reserve', () => {
    const bullet = replyPace({ ...base, remainingMs: 60_000, incrementMs: 0 });
    const long = replyPace({ ...base, remainingMs: 600_000, incrementMs: 10_000 });
    assert.ok(long.targetMs > bullet.targetMs);
    const tight = replyPace({ ...base, remainingMs: 12_000, incrementMs: 20_000, computeMs: 0 });
    assert.ok(tight.waitMs <= 12_000 - PACING.clockReserveMs);
  });

  it('keeps varying on a long time control instead of sitting on the cap', () => {
    const targets = new Set(
      Array.from(
        { length: 12 },
        (_, i) =>
          replyPace({ ...base, ply: 20 + i, remainingMs: 900_000, incrementMs: 10_000 }).targetMs,
      ),
    );
    assert.ok(targets.size > 6, `expected spread, got ${[...targets]}`);
  });

  it('replies faster in the opening', () => {
    const opening = replyPace({ ...base, ply: 2 });
    const middle = replyPace({ ...base, ply: 2 + 40 });
    // Same jitter is not guaranteed across plies, so compare against the bounds.
    assert.ok(opening.targetMs <= PACING.untimedBaseMs * PACING.openingFactor * 1.4 * 1.35 + 1);
    assert.ok(middle.targetMs >= PACING.minTargetMs);
  });

  it('never paces an engine-vs-engine game', () => {
    assert.equal(replyPace({ ...base, engineVsEngine: true }).waitMs, 0);
  });
});
