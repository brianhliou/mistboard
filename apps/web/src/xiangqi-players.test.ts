import { describe, expect, it } from 'vitest';
import {
  currentSeason,
  displayName,
  indexFilterFromSearch,
  indexSearchFromFilter,
  latestPoints,
  matchesFilter,
  matchesQuery,
  playerGroup,
  playerTitle,
  recordText,
  scorePercent,
  sortPlayers,
  sortTeams,
  teamKey,
  teamStrength,
  teamsOf,
} from './xiangqi-players.js';

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

  it('matches a search in either script or by team', () => {
    const p = {
      ...player({ name: '尹昇', nameEn: 'Yin Sheng', games: 1 }),
      federationEn: 'Zhejiang',
    };
    expect(matchesQuery(p, 'yin')).toBe(true);
    expect(matchesQuery(p, '昇')).toBe(true);
    expect(matchesQuery(p, 'zhe')).toBe(true);
    expect(matchesQuery(p, 'wang')).toBe(false);
    expect(matchesQuery(p, '  ')).toBe(true);
  });

  it('titles a player from the authored profile, else the last official list', () => {
    expect(playerTitle({ slug: 'yin-sheng', name: '尹昇' })).toBe('NM');
    expect(playerTitle({ slug: 'wang-tianyi', name: '王天一' })).toBe('GM');
    expect(playerTitle({ slug: 'nobody', name: '无名' })).toBe(null);
  });

  it('leads with the CXA points list, then the last rating, then games', () => {
    expect(latestPoints('孟繁睿')).toEqual({ points: 3105, rank: 1 });
    expect(latestPoints('无名')).toBe(null);
    const players = [
      player({ name: '无名', nameEn: 'Nobody', games: 40 }),
      player({ name: '王天一', nameEn: 'Wang Tianyi', games: 2 }),
      player({ name: '孟辰', nameEn: 'Meng Chen', games: 5 }),
      player({ name: '孟繁睿', nameEn: 'Meng Fanrui', games: 3 }),
    ];
    // Points first; a player off the points list falls to the rating, then games.
    expect(sortPlayers(players, 'points')[0]?.name).toBe('孟繁睿');
    expect(sortPlayers(players, 'points')[1]?.name).toBe('孟辰');
    expect(sortPlayers(players, 'points').at(-1)?.name).toBe('无名');
    // The women's list is its own ranking: its leader (2775) sorts after the
    // men's list, not between two men with fewer points.
    const mixed = [
      player({ name: '李沁', nameEn: 'Li Qin', games: 0 }),
      player({ name: '曹岩磊', nameEn: 'Cao Yanlei', games: 30 }),
    ];
    expect(sortPlayers(mixed, 'points').map((p) => p.name)).toEqual(['曹岩磊', '李沁']);
    expect(sortPlayers(players, 'rating')[0]?.name).toBe('王天一');
  });

  it('groups players into teams by their latest team, keyed by the English name', () => {
    const on = (name: string, federation: string, federationEn: string | null, games: number) => ({
      ...player({ name, games, wins: games }),
      federation,
      federationEn,
    });
    const players = [
      on('孟繁睿', '河北队', 'Hebei Team', 10),
      on('孟辰', '上海队', 'Shanghai Team', 4),
      on('甲', '河北队', 'Hebei Team', 6),
      on('乙', '某队', null, 1),
      { ...player({ name: '丙', games: 2 }) },
    ];
    expect(teamKey({ federation: '河北队', federationEn: 'Hebei Team' })).toBe('hebei-team');
    expect(teamKey({ federation: '某队', federationEn: null })).toBe('某队');
    expect(teamKey({ federation: null, federationEn: null })).toBe(null);
    const teams = teamsOf(players);
    expect(teams.map((t) => t.key)).toEqual(['hebei-team', 'shanghai-team', '某队']);
    const hebei = teams[0]!;
    expect(hebei.players.map((p) => p.name)).toEqual(['孟繁睿', '甲']);
    expect(hebei.games).toBe(16);
    // Only 孟繁睿 is on the points list; the rest add nothing.
    expect(teamStrength(hebei)).toBe(3105);
    expect(teamStrength({ players: [players[0]!, players[1]!] })).toBe(3105 + 2980);
    expect(teamStrength(teams[2]!)).toBe(null);
    expect(sortTeams(teams, 'players').map((t) => t.key)[0]).toBe('hebei-team');
    expect(sortTeams(teams, 'strength').map((t) => t.key)).toEqual([
      'hebei-team',
      'shanghai-team',
      '某队',
    ]);
  });

  it('reads the CXA points under the CXA spelling of a name', () => {
    // The points list prints 粱妍婷; the archive prints 梁妍婷.
    expect(latestPoints('梁妍婷')).toEqual({ points: 1198, rank: 7 });
  });

  it('files a player as men or women from the list, else from the events', () => {
    const event = (tourSlug: string, tourName: string) => ({ tourSlug, tourName });
    expect(playerGroup({ name: '孟繁睿', events: [] })).toBe('men');
    expect(
      playerGroup({
        name: '某人',
        events: [event('2026-womens-xiangqi-team-championship', '2026年全国象棋女子团体赛')],
      }),
    ).toBe('women');
    expect(
      playerGroup({ name: '某人', events: [event('2026-xiangqi-league', '全国象棋男子甲级联赛')] }),
    ).toBe('men');
    expect(playerGroup({ name: '某人', events: [event('2026-shanghai-cup', '上海杯')] })).toBe(
      null,
    );
  });

  it('filters the index by title, list and season, and keeps it in the URL', () => {
    const meng = {
      ...player({ name: '孟繁睿', nameEn: 'Meng Fanrui', games: 4 }),
      federation: '河北队',
      federationEn: 'Hebei Team',
      lastPlayedOn: '2026-09-18',
    };
    const listed = {
      ...player({ name: '王天一', nameEn: 'Wang Tianyi', games: 0 }),
      cxaOnly: true,
    };
    expect(currentSeason([meng, listed])).toBe('2026');
    expect(matchesFilter(listed, { title: 'GM' })).toBe(true);
    expect(matchesFilter(meng, { title: 'GM' })).toBe(false);
    expect(matchesFilter(meng, { title: 'none', group: 'men' })).toBe(true);
    expect(matchesFilter(meng, { group: 'women' })).toBe(false);
    expect(matchesFilter(meng, { season: '2026' })).toBe(true);
    expect(matchesFilter(listed, { season: '2026' })).toBe(false);
    const search = indexSearchFromFilter({
      title: 'NM',
      group: 'women',
      season: '2026',
    });
    expect(search).toBe('?title=NM&list=women&active=2026');
    expect(indexFilterFromSearch(search)).toEqual({
      title: 'NM',
      group: 'women',
      season: '2026',
    });
    expect(indexFilterFromSearch('?title=IM&list=other&active=soon')).toEqual({});
  });

  it('sorts a player with no games below every scored player', () => {
    const listed = {
      ...player({ name: '王天一', nameEn: 'Wang Tianyi', games: 0 }),
      cxaOnly: true,
    };
    const loser = player({ name: '乙', nameEn: 'Yi', games: 2 });
    expect(sortPlayers([listed, loser], 'score').map((p) => p.name)).toEqual(['乙', '王天一']);
  });
});
