import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { databaseMatchupLabel, databaseReviewHref } from './database.js';
import type { FeaturedGame } from './game-display.js';

describe('database game rows', () => {
  it('keeps dark chess rows as white vs black', () => {
    expect(
      databaseMatchupLabel({
        ...baseGame(),
        variant: 'fog',
        participants: [participant('white', 'White Player'), participant('black', 'Black Player')],
      }),
    ).toBe('White Player vs Black Player');
  });

  // Regression: xiangqi seats are red/black. The old label hardcoded the
  // 'white' seat, which has no participant, so rows read "White vs <black>".
  it('labels xiangqi rows as red vs black', () => {
    expect(
      databaseMatchupLabel({
        ...baseGame(),
        variant: XIANGQI_SPEC_ID,
        participants: [participant('red', 'Red Player'), participant('black', 'Black Player')],
      }),
    ).toBe('Red Player vs Black Player');
  });

  it('falls back to red/black seat words for xiangqi rows with no participants', () => {
    expect(
      databaseMatchupLabel({
        ...baseGame(),
        variant: XIANGQI_SPEC_ID,
      }),
    ).toBe('Red vs Black');
  });
});

describe('databaseReviewHref', () => {
  // Regression: variant-tenant games replay only under their own postgame route.
  // The legacy /game/:id review shell knows only the chess-shell event union and
  // 403s (game_not_public) on a variant event log, so linking a jungle-flip /
  // xiangqi row to /game/:id produced "failed to load events: 403".
  it('routes variant-tenant games to their own postgame route by room-id prefix', () => {
    expect(databaseReviewHref('jgf_abc123')).toBe('/jungle-flip/game/jgf_abc123');
    expect(databaseReviewHref('xq_deadbeef')).toBe('/xiangqi/game/xq_deadbeef');
    expect(databaseReviewHref('dxq_dark01')).toBe('/dark-xiangqi/game/dxq_dark01');
    // Retired tenants no longer register, so their old prefixes fall through
    // to the legacy /game/:id link (which 404s: those games are gone with them).
    expect(databaseReviewHref('dchess_cr1')).toBe('/game/dchess_cr1');
  });

  it('keeps chess-family / prefix-less games on the legacy /game/:id shell', () => {
    expect(databaseReviewHref('game_test')).toBe('/game/game_test');
    expect(databaseReviewHref('dchx_fog01')).toBe('/game/dchx_fog01');
  });
});

function baseGame(): FeaturedGame {
  return {
    roomId: 'game_test',
    variant: 'fog',
    mode: 'pvp',
    rated: false,
    result: 'draw',
    termination: 'agreement',
    plyCount: 12,
    whiteName: null,
    blackName: null,
    corpusId: null,
  };
}

function participant(color: 'white' | 'black' | 'red', displayName: string) {
  return {
    color,
    displayName,
    subjectType: 'guest' as const,
    subjectId: null,
    visibility: 'public' as const,
  };
}
