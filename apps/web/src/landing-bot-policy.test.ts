import { describe, expect, it } from 'vitest';
import {
  fairyStockfishLevel,
  LANDING_BOT_GAME_SPEC_IDS,
  landingBotLadder,
  landingBotLadderIndex,
  landingBotLineup,
  landingBotOffer,
  landingBotRotationBucket,
  landingLobbyBotOffer,
  landingXiangqiBotOffers,
  pveEngineIdForRememberedPick,
  xiangqiPrimaryLevel,
} from './landing-bot-policy.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';

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

  it('pins one stable FSF opponent per variant, at the bot default pace', () => {
    // Every bot game defaults to 10+5, not the 3+2 house pace, because guests
    // flagged a third of their xiangqi and jieqi bot games at 3+2. The offer has
    // to advertise that, since the click starts the picker on the same default.
    // A device with no remembered xiangqi engine is a first-time visitor and
    // gets the bottom rung (#365); see the memory cases below.
    expect(landingBotOffer('xiangqi')).toMatchObject({
      botId: 'fairy-stockfish-level-2',
      botName: 'Fairy-Stockfish Level 2',
      timeControlId: '10m5',
    });
    // Fortress xiangqi keeps 3+2 for human games, but its bot game is 10+5.
    expect(landingBotOffer('fortress-xiangqi')).toMatchObject({
      botId: 'fairy-stockfish-level-4',
      timeControlId: '10m5',
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
      // Jieqi's ladder rows stay on level 4 until the ladder is rated.
      expect(new Set(rowsFor('jieqi').map((offer) => offer.botId))).toEqual(
        new Set(['pikafish-level-4']),
      );
    });

    it('never rotates the clock below the bot default', () => {
      // The bot default is the slowest pace, so there is nothing slower to
      // rotate to, and no row drops back to the 3+2 that flagged a third of
      // guest games. Holds for the fog engines too: 10+5 clears their floor.
      for (const gameSpecId of LANDING_BOT_GAME_SPEC_IDS) {
        expect(new Set(rowsFor(gameSpecId).map((offer) => offer.timeControlId))).toEqual(
          new Set(['10m5']),
        );
      }
    });

    it('never advertises a pace the picker would not start', () => {
      // An empty set falls back to the bot default rather than a dead row.
      expect(new Set(rowsFor('banqi', []).map((offer) => offer.timeControlId))).toEqual(
        new Set(['10m5']),
      );
    });

    it('leaves the Quick Pairing offer untouched', () => {
      // The chip shows no name, so it cannot rotate (#365); only the row does.
      for (const bucket of buckets) {
        expect(landingBotOffer('fortress-xiangqi')).toMatchObject({
          botId: 'fairy-stockfish-level-4',
          timeControlId: '10m5',
        });
        expect(
          landingLobbyBotOffer('fortress-xiangqi', { bucket, allowedPaces: ALL_PACES }),
        ).not.toBeNull();
      }
    });
  });

  it('uses the established house bot for every other supported variant', () => {
    expect(landingBotOffer('jieqi')?.botId).toBe('pikafish-level-4');
    // Every Misty variant, fog included, advertises the 10+5 bot default. For
    // the fog engines it also clears the 5s increment floor (#283) the picker
    // and the create routes enforce (isAllowedEngineTimeControl).
    for (const gameSpecId of ['banqi', 'jungle', 'jungle-flip', 'dark-chess', 'dark-xiangqi']) {
      expect(landingBotOffer(gameSpecId)).toMatchObject({
        botId: 'misty',
        timeControlId: '10m5',
      });
    }
  });

  it('maps a remembered jieqi bot to the engine the setup menu lists', () => {
    const menu = webVariantTenantForSpecId('jieqi')?.landing?.engineOptions?.map((e) => e.id) ?? [];
    for (const botId of ['pikafish', 'pikafish-level-1', 'pikafish-level-4', 'pikafish-level-7']) {
      expect(menu).toContain(pveEngineIdForRememberedPick('jieqi', botId));
    }
    expect(pveEngineIdForRememberedPick('jieqi', 'pikafish')).toBe('pikafish-jieqi-strongest');
    expect(pveEngineIdForRememberedPick('jieqi', 'pikafish-jieqi-level-3')).toBe(
      'pikafish-jieqi-level-3',
    );
    expect(pveEngineIdForRememberedPick('xiangqi', 'pikafish')).toBe('pikafish');
  });
});

describe('landing bot ladder (homepage play panel)', () => {
  const ids = (spec: string) => landingBotLadder(spec).map((rung) => rung.botId);

  // These ids must exist in apps/server/src/first-party-bots.ts for the variant,
  // or the one-click create fails. Pinned here because the web cannot import it.
  it('walks xiangqi Fairy-Stockfish 1-8, then full-strength Pikafish', () => {
    expect(ids('xiangqi')).toEqual([
      ...Array.from({ length: 8 }, (_, i) => `fairy-stockfish-level-${i + 1}`),
      'pikafish',
    ]);
  });

  it('walks jieqi Pikafish Levels 1-8 (Level 8 is the pikafish bot), then AB-JChess', () => {
    expect(ids('jieqi')).toEqual([
      ...Array.from({ length: 7 }, (_, i) => `pikafish-level-${i + 1}`),
      'pikafish',
      'ab-jchess',
    ]);
    expect(landingBotLadder('jieqi').map((rung) => rung.level)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      null,
    ]);
  });

  it('gives the other Fairy-Stockfish variants eight levels and no named top', () => {
    for (const spec of ['fortress-xiangqi', 'duck-xiangqi', 'atomic-xiangqi']) {
      expect(ids(spec)).toEqual(
        Array.from({ length: 8 }, (_, i) => `fairy-stockfish-level-${i + 1}`),
      );
    }
  });

  it('gives the house-built variants a single Misty', () => {
    for (const spec of ['dark-chess', 'dark-xiangqi', 'banqi', 'jungle', 'jungle-flip']) {
      expect(ids(spec)).toEqual(['misty']);
    }
    expect(ids('not-a-variant')).toEqual([]);
  });

  it('starts every ladder variant on a rung its canonical offer names', () => {
    for (const spec of LANDING_BOT_GAME_SPEC_IDS) {
      const offer = landingBotOffer(spec);
      expect(landingBotLadderIndex(landingBotLadder(spec), offer?.botId)).toBeGreaterThanOrEqual(0);
    }
  });

  it('maps the setup dialog’s remembered jieqi engines back onto the ladder', () => {
    const ladder = landingBotLadder('jieqi');
    expect(ladder[landingBotLadderIndex(ladder, 'pikafish-jieqi-level-5')]?.botId).toBe(
      'pikafish-level-5',
    );
    expect(ladder[landingBotLadderIndex(ladder, 'pikafish-jieqi-strongest')]?.botId).toBe(
      'pikafish',
    );
    expect(ladder[landingBotLadderIndex(ladder, 'ab-jchess-jieqi')]?.botId).toBe('ab-jchess');
    expect(landingBotLadderIndex(ladder, 'something-else')).toBe(-1);
    expect(landingBotLadderIndex(ladder, null)).toBe(-1);
  });
});
