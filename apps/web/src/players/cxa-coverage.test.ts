import { describe, expect, it } from 'vitest';
import { CXA_LISTED_PLAYERS } from '../../../server/src/cxa-listed-players.js';
import {
  CXA_NAME_ALIASES,
  cxaGroupFor,
  cxaListedPlayers,
  cxaPointsFor,
  cxaRatingsFor,
} from './cxa-coverage.js';
import { CXA_POINTS } from './cxa-points.js';
import { CXA_RATINGS } from './cxa-ratings.js';

describe('CXA coverage', () => {
  it('matches the server bake, so every listed player gets a page', () => {
    // Stale when a CXA module gains or renames a player: re-run
    // `npm run bake:cxa-players --workspace @mistboard/server`.
    expect([...CXA_LISTED_PLAYERS]).toEqual(cxaListedPlayers());
  });

  it('lists every name on the points and rating lists, in the archive spelling', () => {
    const names = new Set(cxaListedPlayers().map((p) => p.name));
    for (const name of [...Object.keys(CXA_POINTS), ...Object.keys(CXA_RATINGS)]) {
      expect(names.has(CXA_NAME_ALIASES[name] ?? name)).toBe(true);
    }
    for (const cxaSpelling of Object.keys(CXA_NAME_ALIASES)) {
      expect(names.has(cxaSpelling)).toBe(false);
    }
    // Wang Tianyi is on the rating lists and in no broadcast: he is listed.
    expect(names.has('王天一')).toBe(true);
  });

  it('finds a player under either spelling', () => {
    // The points list prints 粱妍婷; the archive's women's events print 梁妍婷.
    expect(cxaPointsFor('梁妍婷')).toEqual(CXA_POINTS['粱妍婷']);
    expect(cxaPointsFor('粱妍婷')).toEqual(CXA_POINTS['粱妍婷']);
    expect(cxaPointsFor('没有这个人')).toEqual([]);
    expect(cxaRatingsFor('王天一').length).toBe(14);
  });

  it('files a player by the list they are on', () => {
    expect(cxaGroupFor('梁妍婷')).toBe('women');
    expect(cxaGroupFor('孟繁睿')).toBe('men');
    // Only on the 等级分 lists, which are the men's lists.
    expect(cxaGroupFor('王天一')).toBe('men');
    expect(cxaGroupFor('没有这个人')).toBe(null);
  });
});
