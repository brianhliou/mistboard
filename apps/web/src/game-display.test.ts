import {
  BANQI_SPEC_ID,
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  brandedEngineName,
  displayParticipantName,
  type FeaturedGame,
  firstMoverColorName,
  type GameParticipant,
  gameOutcome,
  matchupLabel,
  matchupSeats,
  secondMoverColorName,
  terminationLabel,
  variantNameKeyForSpecId,
} from './game-display.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';

// Regression suite for the "white vs pikajieqi" bug: surfaces that hardcoded a
// 'white' seat lookup dropped the red player's name on every red/black variant
// and rendered the literal seat word instead. Every "X vs Y" surface now goes
// through matchupSeats/matchupLabel.
describe('matchupSeats', () => {
  it('resolves xiangqi to red vs black from the spec family', () => {
    expect(matchupSeats(game(XIANGQI_SPEC_ID))).toEqual(['red', 'black']);
  });

  it('resolves the jungle family to red vs black', () => {
    expect(matchupSeats(game(JUNGLE_SPEC_ID))).toEqual(['red', 'black']);
  });

  it('defaults chess-family variants to white vs black', () => {
    expect(matchupSeats(game('fog'))).toEqual(['white', 'black']);
  });

  it('lets persisted participants decide when the variant string is unknown', () => {
    expect(
      matchupSeats(game('some-legacy-alias', [participant('red', 'a'), participant('black', 'b')])),
    ).toEqual(['red', 'black']);
    expect(
      matchupSeats(game('some-legacy-alias', [participant('white', 'a'), participant('red', 'b')])),
    ).toEqual(['white', 'red']);
  });
});

describe('matchupLabel', () => {
  it('names both xiangqi players from their red/black participants', () => {
    expect(
      matchupLabel(
        game(XIANGQI_SPEC_ID, [
          participant('red', 'brianhliou-dev'),
          participant('black', 'PikaJieqi - Strong'),
        ]),
      ),
    ).toBe('brianhliou-dev vs PikaJieqi - Strong');
  });

  it('falls back to red/black seat words for xiangqi rows with no name data', () => {
    expect(matchupLabel(game(XIANGQI_SPEC_ID))).toBe('Red vs Black');
  });

  it('brands the Jungle family second seat "Blue" in the fallback matchup', () => {
    expect(matchupLabel(game(JUNGLE_SPEC_ID))).toBe('Red vs Blue');
  });

  it('reads legacy white/black name columns for chess rows without participants', () => {
    expect(matchupLabel({ ...game('fog'), whiteName: 'alice', blackName: 'bob' })).toBe(
      'alice vs bob',
    );
  });

  // Flip variants seat by move order, so a seat word is not a colour claim: naming
  // a nameless banqi seat "Red" is wrong for half of all games. The fallback names
  // the bound ink when the row carries firstColor and the move order when it does
  // not (profile / landing / database feeds never derive it).
  it('names a nameless flip seat by move order when the ink is unknown', () => {
    expect(matchupLabel(game(BANQI_SPEC_ID))).toBe('First vs Second');
    expect(matchupLabel(game(JUNGLE_FLIP_SPEC_ID))).toBe('First vs Second');
  });

  it('names a nameless flip seat by the bound ink once firstColor is known', () => {
    // First-mover seat flipped black, so it is the BLACK player, not "Red".
    expect(matchupLabel({ ...game(BANQI_SPEC_ID), firstColor: 'black' })).toBe('Black vs Red');
    expect(matchupLabel({ ...game(BANQI_SPEC_ID), firstColor: 'red' })).toBe('Red vs Black');
    // The Jungle family brands its dark ink "Blue".
    expect(matchupLabel({ ...game(JUNGLE_FLIP_SPEC_ID), firstColor: 'black' })).toBe('Blue vs Red');
  });

  it('leaves non-flip variants on the literal seat word regardless of firstColor', () => {
    expect(matchupLabel({ ...game(XIANGQI_SPEC_ID), firstColor: 'black' })).toBe('Red vs Black');
  });
});

describe('brandedEngineName', () => {
  it('collapses every Misty build to the brand', () => {
    expect(brandedEngineName('Misty DXQ 1.1')).toBe('Misty');
    expect(brandedEngineName('Misty DXQ 1.0')).toBe('Misty');
    expect(brandedEngineName('Misty DMX 1.0')).toBe('Misty');
    expect(brandedEngineName('Misty 1.5')).toBe('Misty');
    expect(brandedEngineName('Misty 1.0')).toBe('Misty');
  });

  it('leaves anything that is not a build string alone', () => {
    // A human whose name merely starts with the word, and the brand on its own.
    expect(brandedEngineName('Misty')).toBeNull();
    expect(brandedEngineName('Misty the Great')).toBeNull();
    expect(brandedEngineName('Mistyped 12')).toBeNull();
    // Other engines keep their own names — this rule is Misty-only by design.
    expect(brandedEngineName('Mistboard Engine v2.0')).toBeNull();
    expect(brandedEngineName('Pikafish')).toBeNull();
    expect(brandedEngineName('MistyBanqi · Strongest')).toBeNull();
  });
});

describe('displayParticipantName', () => {
  it('names an engine seat by brand, whichever build actually played', () => {
    const seated = (displayName: string, subjectId: string): FeaturedGame => ({
      ...game(XIANGQI_SPEC_ID),
      participants: [
        {
          color: 'red',
          displayName: 'Human',
          subjectType: 'user',
          subjectId: 'u1',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName,
          subjectType: 'engine-version',
          subjectId,
          visibility: 'public',
        },
      ],
    });
    // Resolved through the id map (python-dmx-v1.0 -> "Misty DMX 1.0")...
    expect(displayParticipantName(seated('whatever', 'python-dmx-v1.0'), 'black')).toBe('Misty');
    // ...and straight off a persisted build name with no id mapping.
    expect(displayParticipantName(seated('Misty DXQ 1.1', 'python-fdx-v1.1'), 'black')).toBe(
      'Misty',
    );
  });

  it('leaves human seats untouched', () => {
    const human = {
      ...game(XIANGQI_SPEC_ID),
      participants: [
        {
          color: 'red' as const,
          displayName: 'Misty the Great',
          subjectType: 'user' as const,
          subjectId: 'u1',
          visibility: 'public' as const,
        },
      ],
    };
    expect(displayParticipantName(human, 'red')).toBe('Misty the Great');
  });

  // The server writes the English literal 'Guest' into a nameless guest seat's
  // displayName; the /watch meta card showed it verbatim beside translated copy.
  it('routes the server guest placeholder through the catalog', async () => {
    await ensureLocaleCatalog('zh-Hans');
    const guest = {
      ...game(XIANGQI_SPEC_ID),
      participants: [
        {
          color: 'red' as const,
          displayName: 'Guest',
          subjectType: 'guest' as const,
          subjectId: null,
          visibility: 'public' as const,
        },
      ],
    };
    expect(displayParticipantName(guest, 'red')).toBe('Guest');
    window.history.pushState(null, '', '/zh-hans/watch');
    try {
      expect(displayParticipantName(guest, 'red')).toBe('访客');
    } finally {
      window.history.pushState(null, '', '/');
    }
  });
});

// Xiangqi mahjong's seat ids are bookkeeping; with no names at hand the outcome
// is seat-neutral, never "West wins". The Hong Kong table keeps its winds.
describe('gameOutcome for wind seats', () => {
  it('is seat-neutral for xiangqi mahjong and keeps the wind for mahjong', () => {
    expect(gameOutcome('west-wins', 'xiangqi-mahjong')).toEqual({ label: 'Won' });
    expect(gameOutcome('east-wins', 'xiangqi-mahjong')).toEqual({ label: 'Won' });
    expect(gameOutcome('east-wins', 'mahjong')).toEqual({ winner: 'East' });
  });

  it('pairs xiangqi mahjong seats east vs west', () => {
    expect(matchupSeats(game('xiangqi-mahjong'))).toEqual(['east', 'west']);
  });
});

// The watch meta card humanized the kebab code ("General captured") in every
// locale; every persisted GameTermination now has a catalog entry.
describe('terminationLabel', () => {
  it('names every persisted termination in English', () => {
    expect(terminationLabel('general-captured')).toBe('General captured');
    expect(terminationLabel('king-captured')).toBe('King captured');
    expect(terminationLabel('progress-clock')).toBe('Progress clock');
    expect(terminationLabel('race')).toBe('Den entered');
    // Xiangqi Mahjong's match win (migration 169), once printed as Checkmate.
    expect(terminationLabel('points')).toBe('On points');
    expect(terminationLabel('')).toBe('');
  });

  it('translates through the catalog for a zh locale', async () => {
    await ensureLocaleCatalog('zh-Hans');
    expect(terminationLabel('general-captured', 'zh-Hans')).toBe('将帅被擒');
    expect(terminationLabel('timeout', 'zh-Hans')).toBe('超时');
  });

  it('humanizes an unknown code instead of throwing', () => {
    expect(terminationLabel('some-future-code')).toBe('Some future code');
  });
});

function game(variant: string, participants?: GameParticipant[]): FeaturedGame {
  return {
    roomId: 'game_test',
    variant,
    mode: 'pvp',
    rated: false,
    result: 'draw',
    termination: 'agreement',
    plyCount: 12,
    whiteName: null,
    blackName: null,
    corpusId: null,
    participants,
  };
}

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return {
    color,
    displayName,
    subjectType: 'user',
    subjectId: null,
    visibility: 'public',
  };
}

// The correspondence side picker names move order in each variant's own words.
// Fog Xiangqi read "White" before every variant joined (2026-10-02).
describe('correspondence side names', () => {
  it('names the sides of every eligible variant', () => {
    const sides = Object.fromEntries(
      CORRESPONDENCE_ELIGIBLE_SPEC_IDS.map((id) => [
        id,
        `${firstMoverColorName(id)}/${secondMoverColorName(id)}`,
      ]),
    );
    expect(sides).toEqual({
      xiangqi: 'Red/Black',
      'dark-chess': 'White/Black',
      jieqi: 'Red/Black',
      banqi: 'First/Second',
      'duck-xiangqi': 'Red/Black',
      'crazyhouse-xiangqi': 'Red/Black',
      'dark-xiangqi': 'Red/Black',
      jungle: 'Red/Blue',
      'jungle-flip': 'First/Second',
    });
    // A retired variant left the create list, but a game in progress still
    // names its sides.
    expect(firstMoverColorName('fortress-xiangqi')).toBe('Red');
    // Xiangqi Mahjong seats east and west; east deals first.
    expect(firstMoverColorName('xiangqi-mahjong')).toBe('East');
    expect(secondMoverColorName('xiangqi-mahjong')).toBe('West');
    // and goes by its catalog name, so zh readers see 象棋麻将, not the English.
    expect(variantNameKeyForSpecId('xiangqi-mahjong')).toBe('variant.xiangqiMahjong.name');
    expect(firstMoverColorName('no-such-spec')).toBe('White');
  });
});
