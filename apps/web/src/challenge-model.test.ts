import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  DAYS_PER_MOVE_OPTIONS,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { targetedChallengeRequestBody } from './challenge-model.js';

describe('targeted correspondence challenge payload', () => {
  const input = {
    handle: '  @bob ',
    gameSpecId: 'jieqi',
    daysPerMove: 3,
    preferredColor: 'random',
  };

  it('serializes only challenge terms, with a normalized target and no game state', () => {
    const result = targetedChallengeRequestBody({
      ...input,
      ...{ board: { a1: 'secret' }, events: ['secret'], targetUserId: 'private-id' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(JSON.stringify(result.body))).toEqual({
      targetHandle: 'bob',
      gameSpecId: 'jieqi',
      daysPerMove: 3,
      preferredColor: 'random',
    });
  });

  it('preserves every supported cadence and side for each public variant', () => {
    for (const gameSpecId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      for (const daysPerMove of DAYS_PER_MOVE_OPTIONS) {
        for (const preferredColor of ['random', 'first', 'second']) {
          expect(
            targetedChallengeRequestBody({ ...input, gameSpecId, daysPerMove, preferredColor }),
          ).toEqual({
            ok: true,
            body: { targetHandle: 'bob', gameSpecId, daysPerMove, preferredColor },
          });
        }
      }
    }
  });

  it.each(['', ' ', ' @ ', '@@'])('refuses an empty target %j', (handle) => {
    expect(targetedChallengeRequestBody({ ...input, handle })).toEqual({
      ok: false,
      error: 'handle_required',
    });
  });

  it.each(['', 'unknown', 'mini-xiangqi', 'mahjong'])('refuses variant %j', (gameSpecId) => {
    expect(targetedChallengeRequestBody({ ...input, gameSpecId }, true, () => true)).toEqual({
      ok: false,
      error: 'correspondence_unsupported_spec',
    });
  });

  it.each([0, -1, 1.5, 14, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses cadence %j',
    (daysPerMove) => {
      expect(targetedChallengeRequestBody({ ...input, daysPerMove })).toEqual({
        ok: false,
        error: 'invalid_days_per_move',
      });
    },
  );

  it.each(['', 'red', 'white', 'third'])('refuses side %j', (preferredColor) => {
    expect(targetedChallengeRequestBody({ ...input, preferredColor })).toEqual({
      ok: false,
      error: 'invalid_preferred_color',
    });
  });

  it('keeps rated correspondence behind its own flag', () => {
    const rated = { ...input, rated: true };
    const casual = targetedChallengeRequestBody(input);
    expect(targetedChallengeRequestBody(rated)).toEqual(casual);
    expect(targetedChallengeRequestBody(rated, false)).toEqual(casual);
    expect(targetedChallengeRequestBody(rated, true)).toEqual({
      ok: true,
      body: {
        targetHandle: 'bob',
        gameSpecId: 'jieqi',
        daysPerMove: 3,
        preferredColor: 'random',
        rated: true,
      },
    });
  });

  it('refuses xiangqi mahjong, held out of correspondence, even when offered', () => {
    const held = { ...input, gameSpecId: XIANGQI_MAHJONG_SPEC_ID, rated: true };
    for (const offered of [undefined, () => true]) {
      expect(targetedChallengeRequestBody(held, true, offered)).toEqual({
        ok: false,
        error: 'correspondence_unsupported_spec',
      });
    }
  });
});
