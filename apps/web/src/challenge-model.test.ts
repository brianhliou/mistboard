import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  CORRESPONDENCE_RESTRICTED_SPEC_IDS,
  DAYS_PER_MOVE_OPTIONS,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  type CorrespondenceAgainInput,
  canOfferPostGameChallenge,
  correspondenceAgainOffer,
  correspondenceAgainRequestBody,
  finishedGameDaysPerMove,
  finishedGameViewerSeat,
  type PostGameChallengeInput,
  targetedChallengeRequestBody,
} from './challenge-model.js';

const game: PostGameChallengeInput = {
  correspondenceEnabled: true,
  finished: true,
  seated: true,
  mode: 'pvp',
  gameSpecId: 'jieqi',
  viewerHandle: 'alice',
  opponent: { handle: 'bob' },
};

describe('postgame directed-challenge eligibility', () => {
  it('accepts finished human games in each public correspondence variant', () => {
    for (const gameSpecId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      expect(canOfferPostGameChallenge({ ...game, gameSpecId }), gameSpecId).toBe(true);
    }
    expect(canOfferPostGameChallenge({ ...game, mode: 'correspondence' })).toBe(true);
  });

  it.each<Partial<PostGameChallengeInput>>([
    { correspondenceEnabled: false },
    { finished: false },
    { seated: false },
    { mode: 'pve' },
    { mode: 'unknown' },
    { viewerHandle: null },
    { viewerHandle: undefined },
    { viewerHandle: ' @ ' },
    { opponent: null },
    { opponent: {} },
    { opponent: { handle: null } },
    { opponent: { handle: ' ' } },
    { opponent: { botId: 'misty' } },
    { opponent: { handle: 'bob', botId: 'misty' } },
    { opponent: { handle: ' @ALICE ' } },
    { gameSpecId: undefined },
    { gameSpecId: 'unknown' },
    { gameSpecId: 'mini-xiangqi' },
    { gameSpecId: 'mahjong' },
  ])('fails closed for %j', (overrides) => {
    expect(canOfferPostGameChallenge({ ...game, ...overrides })).toBe(false);
  });

  // Held out of correspondence at launch (Brian, 2026-10-25), with or without a grant.
  it('refuses xiangqi mahjong even when the menu offers it', () => {
    const held = { ...game, gameSpecId: XIANGQI_MAHJONG_SPEC_ID };
    expect(canOfferPostGameChallenge(held)).toBe(false);
    expect(canOfferPostGameChallenge(held, () => false)).toBe(false);
    expect(canOfferPostGameChallenge(held, () => true)).toBe(false);
    expect(canOfferPostGameChallenge({ ...game, gameSpecId: 'unknown' }, () => true)).toBe(false);
  });
});

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

// #606: "Play again by correspondence" after a finished game.
describe('play again by correspondence', () => {
  const finished: CorrespondenceAgainInput = {
    ...game,
    viewerMovedFirst: true,
    daysPerMove: null,
  };

  it('offers a game between two accounts in every correspondence variant', () => {
    for (const gameSpecId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      expect(correspondenceAgainOffer({ ...finished, gameSpecId }), gameSpecId).toEqual({
        gameSpecId,
        opponentHandle: 'bob',
        preferredColor: 'second',
        daysPerMove: 1,
      });
    }
  });

  it.each<[string, Partial<CorrespondenceAgainInput>]>([
    ['a bot opponent', { mode: 'pve', opponent: { handle: 'misty', botId: 'misty-l3' } }],
    ['a bot seat in a pvp-shaped game', { opponent: { handle: 'misty', botId: 'misty-l3' } }],
    ['a guest opponent', { opponent: { handle: undefined } }],
    ['a guest viewer', { viewerHandle: null }],
    ['a spectator', { seated: false }],
    ['a variant without correspondence', { gameSpecId: XIANGQI_MAHJONG_SPEC_ID }],
    ['an unknown variant', { gameSpecId: 'chess' }],
    ['correspondence switched off', { correspondenceEnabled: false }],
    ['a game still running', { finished: false }],
    ['an unknown move order', { viewerMovedFirst: null }],
  ])('offers nothing for %s', (_label, patch) => {
    expect(correspondenceAgainOffer({ ...finished, ...patch })).toBeNull();
  });

  it('swaps the side: the first mover is offered second, the second mover first', () => {
    expect(correspondenceAgainOffer(finished)?.preferredColor).toBe('second');
    expect(correspondenceAgainOffer({ ...finished, viewerMovedFirst: false })?.preferredColor).toBe(
      'first',
    );
  });

  it("keeps a correspondence game's pace and gives a live game one day", () => {
    for (const days of DAYS_PER_MOVE_OPTIONS) {
      expect(correspondenceAgainOffer({ ...finished, daysPerMove: days })?.daysPerMove).toBe(days);
    }
    // A correspondence room's mode is not 'correspondence' on the tenant stack;
    // its days per move is what makes it one.
    expect(
      correspondenceAgainOffer({ ...finished, mode: 'unknown', daysPerMove: 3 })?.daysPerMove,
    ).toBe(3);
    expect(correspondenceAgainOffer({ ...finished, daysPerMove: 4 })?.daysPerMove).toBe(1);
    expect(correspondenceAgainOffer({ ...finished, daysPerMove: undefined })?.daysPerMove).toBe(1);
  });

  it('posts a casual, directed seek with target, variant, swapped side and pace', () => {
    const offer = correspondenceAgainOffer({
      ...finished,
      gameSpecId: 'xiangqi',
      viewerMovedFirst: false,
      opponent: { handle: '@Bob' },
      daysPerMove: 7,
    });
    expect(offer).not.toBeNull();
    const body = correspondenceAgainRequestBody(offer!);
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      targetHandle: 'Bob',
      gameSpecId: 'xiangqi',
      daysPerMove: 7,
      preferredColor: 'first',
    });
    expect(body).not.toHaveProperty('rated');
  });

  it('offers a restricted playtest variant only while the menu offers it', () => {
    for (const gameSpecId of CORRESPONDENCE_RESTRICTED_SPEC_IDS) {
      const input = { ...finished, gameSpecId };
      expect(correspondenceAgainOffer(input), gameSpecId).toBeNull();
      const offer = correspondenceAgainOffer(input, () => true);
      expect(offer?.gameSpecId).toBe(gameSpecId);
      expect(correspondenceAgainRequestBody(offer!, () => true)).toMatchObject({ gameSpecId });
      expect(correspondenceAgainRequestBody(offer!, () => false)).toBeNull();
    }
  });
});

describe('finished game seats on the review page', () => {
  const players = [
    { color: 'red', handle: 'alice' },
    { color: 'black', handle: 'bob' },
  ];

  it('finds the viewer by handle and reads red or white as first', () => {
    expect(finishedGameViewerSeat(players, '@ALICE')).toMatchObject({
      opponent: { handle: 'bob' },
      viewerMovedFirst: true,
    });
    expect(finishedGameViewerSeat(players, 'bob')?.viewerMovedFirst).toBe(false);
    expect(
      finishedGameViewerSeat(
        [
          { color: 'white', handle: 'alice' },
          { color: 'black', handle: 'bob' },
        ],
        'alice',
      )?.viewerMovedFirst,
    ).toBe(true);
  });

  it('uses the named first mover when the page gives one (Gomoku)', () => {
    const gomoku = [
      { color: 'black', handle: 'alice' },
      { color: 'white', handle: 'bob' },
    ];
    expect(finishedGameViewerSeat(gomoku, 'alice', 'black')?.viewerMovedFirst).toBe(true);
    expect(finishedGameViewerSeat(gomoku, 'alice', 'white')?.viewerMovedFirst).toBe(false);
  });

  it('returns nothing for a spectator, a signed-out reader or a bot seat', () => {
    expect(finishedGameViewerSeat(players, 'carol')).toBeNull();
    expect(finishedGameViewerSeat(players, null)).toBeNull();
    expect(finishedGameViewerSeat([players[0]!], 'alice')).toBeNull();
    expect(
      finishedGameViewerSeat([{ color: 'red', handle: 'alice', botId: 'x' }, players[1]!], 'alice'),
    ).toBeNull();
  });

  it('reads days per move off the time control or the persisted clock', () => {
    const DAY = 24 * 60 * 60 * 1000;
    expect(finishedGameDaysPerMove({ timeControl: { daysPerMove: 5 } })).toBe(5);
    expect(finishedGameDaysPerMove({ initialMs: 3 * DAY, incrementMs: 0 })).toBe(3);
    expect(finishedGameDaysPerMove({ initialMs: 300_000, incrementMs: 3_000 })).toBeNull();
    expect(finishedGameDaysPerMove({})).toBeNull();
  });
});
