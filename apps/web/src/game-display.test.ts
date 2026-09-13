import {
  BANQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  brandedEngineName,
  displayParticipantName,
  type FeaturedGame,
  type GameParticipant,
  matchupLabel,
  matchupSeats,
} from './game-display.js';

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
