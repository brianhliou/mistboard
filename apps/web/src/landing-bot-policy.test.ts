import { describe, expect, it } from 'vitest';
import {
  fairyStockfishLevel,
  LANDING_BOT_GAME_SPEC_IDS,
  landingBotLineup,
  landingBotOffer,
  landingBotRotationBucket,
  landingLobbyBotOffer,
  landingXiangqiBotOffers,
  xiangqiPrimaryLevel,
} from './landing-bot-policy.js';

describe('landing bot policy', () => {
  it('uses shared six-hour UTC buckets', () => {
    const before = landingBotRotationBucket(new Date('2026-07-23T05:59:59.999Z'));
    const after = landingBotRotationBucket(new Date('2026-07-23T06:00:00.000Z'));

    expect(landingBotRotationBucket(new Date('2026-07-23T00:00:00.000Z'))).toBe(before);
    expect(after).toBe(before + 1);
  });

  it('shows seven distinct variants and covers the full shelf in any two buckets', () => {
    for (let bucket = 0; bucket < 3; bucket++) {
      const current = landingBotLineup(bucket);
      const next = landingBotLineup(bucket + 1);

      expect(current).toHaveLength(7);
      expect(new Set(current).size).toBe(7);
      expect(new Set([...current, ...next])).toEqual(new Set(LANDING_BOT_GAME_SPEC_IDS));
    }
  });

  it('pins one stable FSF opponent per variant, at the variant default pace', () => {
    // Xiangqi is a deliberate variant: it defaults to 10+5, not the 3+2 house
    // pace, because guests flagged 36% of their games at 3+2. The offer has to
    // advertise that, since the click starts the picker on the same default.
    // A device with no remembered xiangqi engine is a first-time visitor and
    // gets the bottom rung (#365); see the memory cases below.
    expect(landingBotOffer('xiangqi')).toMatchObject({
      botId: 'fairy-stockfish-level-2',
      botName: 'Fairy-Stockfish Level 2',
      timeControlId: '10m5',
    });
    // Fortress xiangqi has no default of its own, so it keeps the house pace.
    expect(landingBotOffer('fortress-xiangqi')).toMatchObject({
      botId: 'fairy-stockfish-level-4',
      timeControlId: '3m2',
    });
  });

  it('offers the xiangqi ladder ascending, with the primary as one of its rungs', () => {
    const offers = landingXiangqiBotOffers();
    expect(offers.map((offer) => offer.botId)).toEqual([
      'fairy-stockfish-level-2',
      'fairy-stockfish-level-5',
      'fairy-stockfish-level-8',
    ]);

    // Ascending strength is the point of the block: the Rating column is read
    // top-to-bottom as one gradient, so a rung out of order is the bug.
    const levels = offers.map((offer) =>
      Number(offer.botId.slice('fairy-stockfish-level-'.length)),
    );
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    // Quick Pairing starts the canonical offer, so it has to be a rung the
    // Lobby shows or the two surfaces disagree about who "the computer" is.
    expect(offers.map((offer) => offer.botId)).toContain(landingBotOffer('xiangqi')?.botId);
    // Pikafish is the separate elite challenge, never a rung on this ladder.
    expect(offers.every((offer) => offer.botId.startsWith('fairy-stockfish-level-'))).toBe(true);
  });

  it('starts a first-time device at the bottom rung and a returning one at its last level', () => {
    expect(xiangqiPrimaryLevel(undefined)).toBe(2);
    expect(xiangqiPrimaryLevel(null)).toBe(2);
    expect(xiangqiPrimaryLevel('')).toBe(2);
    // A remembered Fairy-Stockfish level is kept exactly, rung or not: the
    // player climbs by choosing, and the chip never silently moves them.
    expect(xiangqiPrimaryLevel('fairy-stockfish-level-8')).toBe(8);
    expect(xiangqiPrimaryLevel('fairy-stockfish-level-3')).toBe(3);
    // A remembered non-ladder engine is a returning player, not a newcomer.
    expect(xiangqiPrimaryLevel('pikafish')).toBe(5);
    // Garbage in the store never produces an impossible level.
    expect(xiangqiPrimaryLevel('fairy-stockfish-level-42')).toBe(5);
    expect(fairyStockfishLevel('fairy-stockfish-level-0')).toBeNull();

    expect(
      landingBotOffer('xiangqi', { rememberedXiangqiBotId: 'fairy-stockfish-level-8' }),
    ).toMatchObject({ botId: 'fairy-stockfish-level-8', timeControlId: '10m5' });
    // Only xiangqi reads the memory; the other variants keep their fixed bot.
    expect(
      landingBotOffer('fortress-xiangqi', { rememberedXiangqiBotId: 'fairy-stockfish-level-8' }),
    ).toMatchObject({ botId: 'fairy-stockfish-level-4' });
  });

  describe('lobby rows rotate rung and clock by bucket', () => {
    const ALL_PACES = ['1m1', '3m2', '5m5', '10m5'] as const;
    const buckets = Array.from({ length: 12 }, (_, index) => 82_620 + index);
    const rowsFor = (
      gameSpecId: string,
      allowedPaces: readonly (typeof ALL_PACES)[number][] = ALL_PACES,
    ) => buckets.map((bucket) => landingLobbyBotOffer(gameSpecId, { bucket, allowedPaces })!);

    it('keeps a Fairy-Stockfish rung within one step of its tier and visits all three', () => {
      for (const gameSpecId of ['fortress-xiangqi', 'duck-xiangqi', 'atomic-xiangqi']) {
        const levels = rowsFor(gameSpecId).map((offer) => fairyStockfishLevel(offer.botId));
        expect(new Set(levels)).toEqual(new Set([3, 4, 5]));
        // Three consecutive buckets show three different rungs: a returning
        // player sees the band, never the same rung twice in a row.
        expect(new Set(levels.slice(0, 3)).size).toBe(3);
      }
    });

    it('never moves an opponent that has no ladder', () => {
      for (const gameSpecId of ['banqi', 'jungle', 'jungle-flip', 'dark-chess', 'dark-xiangqi']) {
        expect(new Set(rowsFor(gameSpecId).map((offer) => offer.botId))).toEqual(
          new Set(['misty']),
        );
      }
      expect(new Set(rowsFor('jieqi').map((offer) => offer.botId))).toEqual(new Set(['pikafish']));
    });

    it('rotates the clock through the allowed paces at or slower than the default', () => {
      // House-pace variants have three slower-or-equal paces and visit them all.
      for (const gameSpecId of ['banqi', 'fortress-xiangqi', 'jungle', 'jungle-flip']) {
        expect(new Set(rowsFor(gameSpecId).map((offer) => offer.timeControlId))).toEqual(
          new Set(['3m2', '5m5', '10m5']),
        );
      }
      expect(
        new Set(rowsFor('duck-xiangqi', ['3m2', '5m5', '10m5']).map((o) => o.timeControlId)),
      ).toEqual(new Set(['5m5', '10m5']));
      // The deliberate variants default to the slowest pace (the 2026-09-01
      // guest-pace fix), so there is nothing slower to rotate to and they
      // never drop back to the 3+2 that flagged a third of guest games.
      for (const gameSpecId of ['xiangqi', 'jieqi', 'atomic-xiangqi']) {
        expect(new Set(rowsFor(gameSpecId).map((offer) => offer.timeControlId))).toEqual(
          new Set(['10m5']),
        );
      }
    });

    it('holds a pinned engine to its pin whatever the picker offers', () => {
      for (const gameSpecId of ['dark-chess', 'dark-xiangqi']) {
        expect(new Set(rowsFor(gameSpecId).map((offer) => offer.timeControlId))).toEqual(
          new Set(['5m5']),
        );
      }
    });

    it('never advertises a pace the picker would not start', () => {
      // A narrowed picker (only 5+5 offered) narrows the rotation with it.
      expect(new Set(rowsFor('banqi', ['5m5']).map((offer) => offer.timeControlId))).toEqual(
        new Set(['5m5']),
      );
      // An empty set falls back to the variant default rather than a dead row.
      expect(new Set(rowsFor('banqi', []).map((offer) => offer.timeControlId))).toEqual(
        new Set(['3m2']),
      );
    });

    it('leaves the Quick Pairing offer untouched', () => {
      // The chip shows no name, so it cannot rotate (#365); only the row does.
      for (const bucket of buckets) {
        expect(landingBotOffer('fortress-xiangqi')).toMatchObject({
          botId: 'fairy-stockfish-level-4',
          timeControlId: '3m2',
        });
        expect(
          landingLobbyBotOffer('fortress-xiangqi', { bucket, allowedPaces: ALL_PACES }),
        ).not.toBeNull();
      }
    });
  });

  it('uses the established house bot for every other supported variant', () => {
    expect(landingBotOffer('jieqi')?.botId).toBe('pikafish');
    for (const gameSpecId of ['banqi', 'jungle', 'jungle-flip']) {
      expect(landingBotOffer(gameSpecId)).toMatchObject({
        botId: 'misty',
        timeControlId: '3m2',
      });
    }
    // The fog variants are the exception to the house pace: their engines have
    // a per-move floor a 2s increment cannot cover, so they lose on time in
    // long games (#283) and their offers take the 5+5 pin the picker and the
    // create routes also enforce (engineTimeControlPin).
    for (const gameSpecId of ['dark-chess', 'dark-xiangqi']) {
      expect(landingBotOffer(gameSpecId)).toMatchObject({
        botId: 'misty',
        timeControlId: '5m5',
      });
    }
  });
});
