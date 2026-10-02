import type { RatingVariant } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { profileGamesFilterFromSearch, profileUrlWithFilter } from './profile-games-tools.js';

const isVariant = (value: string): value is RatingVariant =>
  ['xiangqi', 'jieqi', 'fog'].includes(value);

describe('profile games filter URL', () => {
  it('reads variant, result and opponent, dropping anything malformed', () => {
    expect(profileGamesFilterFromSearch('?variant=jieqi&result=win&vs=Bob', isVariant)).toEqual({
      variant: 'jieqi',
      result: 'win',
      vs: 'Bob',
    });
    expect(
      profileGamesFilterFromSearch('?variant=chess&result=won&vs=two%20words', isVariant),
    ).toEqual({ variant: null, result: null, vs: null });
  });

  it('writes only what is set, and keeps the rest of the URL', () => {
    expect(
      profileUrlWithFilter('https://mistboard.com/@/alice?tz=x&result=loss#games', {
        variant: null,
        result: 'draw',
        vs: 'bob',
      }),
    ).toBe('/@/alice?tz=x&result=draw&vs=bob#games');
    expect(
      profileUrlWithFilter('https://mistboard.com/@/alice?variant=jieqi&result=win', {
        variant: null,
        result: null,
        vs: null,
      }),
    ).toBe('/@/alice');
  });
});
