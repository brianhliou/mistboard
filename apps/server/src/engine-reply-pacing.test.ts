import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  balanceFactor,
  botPacingEnabled,
  PACING,
  PACING_LEGAL_MEDIANS,
  pacingClockReserveMs,
  type ReplyPaceInput,
  replyPace,
} from './engine-reply-pacing.js';

const base: ReplyPaceInput = {
  variant: 'xiangqi',
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
  it('keeps variant rollout subordinate to the master switch and rejects unknown variants', () => {
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING_VARIANTS: 'jungle' }, 'jungle'), false);
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING: 'true' }, 'xiangqi'), true);
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING: 'true' }, 'jieqi'), true);
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING: 'true' }, 'jungle'), true);
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING: 'true' }, 'banqi'), true);
    assert.equal(botPacingEnabled({ MISTBOARD_BOT_PACING: 'true' }, 'dark-chess'), false);
    const env = {
      MISTBOARD_BOT_PACING: 'true',
      MISTBOARD_BOT_PACING_VARIANTS: ' jungle,banqi,typo ',
    };
    assert.equal(botPacingEnabled(env, 'jungle'), true);
    assert.equal(botPacingEnabled(env, 'xiangqi'), false);
    assert.equal(botPacingEnabled(env, 'typo'), false);
    assert.equal(botPacingEnabled({ ...env, MISTBOARD_BOT_PACING_VARIANTS: '' }, 'jungle'), false);
    assert.equal(replyPace({ ...base, variant: 'typo' }).waitMs, 0);
  });

  it('excludes correspondence even when explicitly enabled', () => {
    assert.equal(replyPace({ ...base, correspondence: true }).reason, 'correspondence');
  });

  it('keeps the absolute 5s reserve as well as 10% of the initial clock', () => {
    assert.equal(pacingClockReserveMs(null), 5_000);
    assert.equal(pacingClockReserveMs(60_000), 6_000);
    assert.equal(pacingClockReserveMs(600_000), 60_000);
    for (let i = 0; i < 100; i++) {
      const pace = replyPace({
        ...base,
        roomId: `reserve-${i}`,
        remainingMs: 12_000,
        computeMs: 0,
        incrementMs: 20_000,
      });
      assert.ok(12_000 - pace.waitMs >= 5_000);
    }
  });
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
    assert.ok(
      opening.targetMs <=
        PACING.untimedBaseMs * PACING.openingFactor * 1.4 * PACING.closeFactor * PACING.spreadMax +
          1,
    );
    assert.ok(middle.targetMs >= PACING.minTargetMs);
  });

  it('thinks longer in a level game and less in a lopsided one', () => {
    // 2026-11-11, a 5+5 jieqi game: level early (|eval| 0.1-4.5 pawns) and the bot
    // still answered in 3-4 s. Same position and jitter, only the eval moves.
    const at = (cp: number | null) =>
      replyPace({ ...base, remainingMs: 300_000, incrementMs: 5_000, cp }).targetMs;
    assert.equal(balanceFactor(0), PACING.closeFactor);
    assert.equal(balanceFactor(-150), PACING.closeFactor);
    assert.equal(balanceFactor(450), 1);
    assert.equal(balanceFactor(-900), PACING.lopsidedFactor);
    assert.equal(balanceFactor(1_400), PACING.lopsidedFactor);
    assert.equal(balanceFactor(null), 1);
    assert.ok(at(0) > at(300) && at(300) > at(450) && at(450) > at(700) && at(700) > at(1_200));
    assert.equal(at(-200), at(200), 'symmetric in sign');
    assert.equal(at(null), at(450), 'no eval paces as an even game');
  });

  it('spreads 5+5 replies like a player: mostly near 3 s, a few long', () => {
    // 2026-11-11 local 5+5 game: the player's median was 2.9 s with quartiles 0.65x
    // and 1.6x; the bot's old uniform jitter sat near 5 s on almost every move.
    // Even eval and median legal count, so only the seeded spread varies.
    const targets = Array.from(
      { length: 400 },
      (_, i) =>
        replyPace({
          ...base,
          ply: 20 + i,
          legalCount: PACING_LEGAL_MEDIANS.xiangqi,
          remainingMs: 300_000,
          incrementMs: 5_000,
          cp: 450,
        }).targetMs,
    ).sort((a, b) => a - b);
    const at = (q: number) => targets[Math.floor(q * (targets.length - 1))];
    assert.ok(at(0.5) >= 2_600 && at(0.5) <= 3_400, `median ${at(0.5)}`);
    assert.ok(at(0.25) < at(0.5) * 0.8, `p25 ${at(0.25)}`);
    assert.ok(at(0.9) > at(0.5) * 1.6, `p90 ${at(0.9)}`);
    assert.ok(at(1) <= PACING.maxTargetMs);
  });

  it('never paces an engine-vs-engine game', () => {
    assert.equal(replyPace({ ...base, engineVsEngine: true }).waitMs, 0);
  });
});

describe('fail-closed variant', () => {
  it('never paces a caller that names no variant', () => {
    const { variant: _omit, ...rest } = base;
    assert.deepEqual(replyPace({ ...rest, enabled: true }), {
      waitMs: 0,
      targetMs: 0,
      reason: 'off',
    });
  });
});
