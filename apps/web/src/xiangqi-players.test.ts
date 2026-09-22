import { describe, expect, it } from 'vitest';
import { displayName, recordText, scorePercent, sortPlayers } from './xiangqi-players.js';

function player(input: {
  name: string;
  nameEn?: string | null;
  games: number;
  wins?: number;
  draws?: number;
}) {
  const wins = input.wins ?? 0;
  const draws = input.draws ?? 0;
  return {
    slug: (input.nameEn ?? input.name).toLowerCase().replace(/\s+/g, '-'),
    name: input.name,
    nameEn: input.nameEn ?? null,
    federation: null,
    federationEn: null,
    games: input.games,
    wins,
    draws,
    losses: input.games - wins - draws,
    events: [],
    firstPlayedOn: null,
    lastPlayedOn: null,
  };
}

describe('player pages', () => {
  it('shows both scripts of a name, once', () => {
    expect(displayName({ name: '尹昇', nameEn: 'Yin Sheng' })).toBe('Yin Sheng 尹昇');
    expect(displayName({ name: '尹昇', nameEn: null })).toBe('尹昇');
    expect(displayName({ name: 'Red Master', nameEn: 'Red Master' })).toBe('Red Master');
  });

  it('scores a win as one and a draw as a half', () => {
    expect(recordText({ wins: 11, draws: 20, losses: 0 })).toBe('11-20-0');
    expect(scorePercent({ games: 31, wins: 11, draws: 20 })).toBe(68);
    expect(scorePercent({ games: 0, wins: 0, draws: 0 })).toBe(0);
  });

  it('sorts by games, by score, or by name', () => {
    const players = [
      player({ name: '甲', nameEn: 'Jia', games: 10, wins: 2, draws: 8 }),
      player({ name: '乙', nameEn: 'Yi', games: 4, wins: 4 }),
      player({ name: '丙', nameEn: 'Bing', games: 10, wins: 5, draws: 5 }),
    ];
    expect(sortPlayers(players, 'games').map((p) => p.slug)).toEqual(['bing', 'jia', 'yi']);
    expect(sortPlayers(players, 'score').map((p) => p.slug)).toEqual(['yi', 'bing', 'jia']);
    expect(sortPlayers(players, 'name').map((p) => p.slug)).toEqual(['bing', 'jia', 'yi']);
  });
});
