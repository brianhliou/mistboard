import { BANQI_SPEC_ID, JUNGLE_SPEC_ID, MAHJONG_SPEC_ID, XIANGQI_SPEC_ID } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  databaseMatchupLabel,
  databaseReviewHref,
  dropForeignResult,
  resultFilterOptions,
  sliceWinSegments,
} from './database.js';
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

describe('sliceWinSegments', () => {
  // The prod read that prompted this: 2,586 games across every variant showed
  // White 15% / Black 50% / Red 29%, the Black segment being chess-black and
  // xiangqi-black added together. A mixed slice has no seat split.
  const results = { whiteWins: 388, blackWins: 1293, redWins: 750, draws: 155 };

  it('shows decisive vs draw for the mixed slice, with a note', () => {
    const { segments, note } = sliceWinSegments('', results, 2586);
    expect(segments.map((s) => [s.label, s.value, s.cls])).toEqual([
      ['Decisive', 2431, 'decisive'],
      ['Draw', 155, 'draw'],
    ]);
    expect(note).toMatch(/one variant/);
  });

  it('names xiangqi seats red and black, red first', () => {
    const { segments, note } = sliceWinSegments(XIANGQI_SPEC_ID, results, 2586);
    expect(segments.map((s) => [s.label, s.value, s.cls])).toEqual([
      ['Red', 750, 'red'],
      ['Black', 1293, 'black'],
      ['Draw', 155, 'draw'],
    ]);
    expect(note).toBeNull();
  });

  it('names chess-family seats white and black', () => {
    const { segments } = sliceWinSegments('fog', results, 2586);
    expect(segments.map((s) => [s.label, s.cls])).toEqual([
      ['White', 'white'],
      ['Black', 'black'],
      ['Draw', 'draw'],
    ]);
  });

  it('brands the jungle dark seat Blue, word and swatch together', () => {
    const { segments } = sliceWinSegments(JUNGLE_SPEC_ID, results, 2586);
    expect(segments[1]).toMatchObject({ label: 'Blue', cls: 'blue' });
  });

  it('calls flip-variant seats First and Second, never a colour', () => {
    const { segments } = sliceWinSegments(BANQI_SPEC_ID, results, 2586);
    expect(segments.map((s) => s.label)).toEqual(['First', 'Second', 'Draw']);
  });

  it('has no seat split for mahjong and no note either', () => {
    const { segments, note } = sliceWinSegments(MAHJONG_SPEC_ID, results, 2586);
    expect(segments.map((s) => s.label)).toEqual(['Decisive', 'Draw']);
    expect(note).toBeNull();
  });
});

describe('result filter options follow the variant', () => {
  it('offers every seat result on the mixed slice', () => {
    expect(resultFilterOptions('').map((o) => o.value)).toEqual([
      'white-wins',
      'black-wins',
      'red-wins',
      'draw',
    ]);
  });

  it('never offers White wins on a xiangqi slice', () => {
    expect(resultFilterOptions(XIANGQI_SPEC_ID).map((o) => o.label)).toEqual([
      'Red wins',
      'Black wins',
      'Draw',
    ]);
  });

  it('drops a result the chosen variant cannot produce', () => {
    const filters = {
      variant: XIANGQI_SPEC_ID,
      mode: '',
      result: 'white-wins',
      termination: '',
      rated: '',
      timeClass: '',
      plyMin: '',
      plyMax: '',
      from: '',
      to: '',
      offset: 0,
      limit: 50,
    };
    expect(dropForeignResult(filters).result).toBe('');
    expect(dropForeignResult({ ...filters, result: 'red-wins' }).result).toBe('red-wins');
    expect(dropForeignResult({ ...filters, variant: '' }).result).toBe('white-wins');
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
