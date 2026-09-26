import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  XiangqiPlayerBoardRecord,
  XiangqiPlayerRecord,
} from './persistence-xiangqi-players.js';
import {
  type PlayerPageSources,
  parsePlayerRoute,
  playerCardContent,
  playerCardPath,
  playerDescription,
  playerPageFor,
  playerSitemapEntries,
  teamsOf,
} from './player-pages.js';
import {
  EMPTY_PLAYER_REFERENCE,
  type PlayerReference,
  readPlayerReference,
} from './player-reference.js';

function player(overrides: Partial<XiangqiPlayerRecord>): XiangqiPlayerRecord {
  return {
    slug: 'meng-fanrui',
    name: '孟繁睿',
    nameEn: 'Meng Fanrui',
    federation: '浙江',
    federationEn: 'Zhejiang',
    games: 12,
    wins: 6,
    draws: 5,
    losses: 1,
    events: [
      {
        tourSlug: '2026-xiangqi-league',
        tourName: '2026年全国象棋甲级联赛',
        tourNameEn: '2026 National Xiangqi League',
        level: 'A',
        games: 12,
        wins: 6,
        draws: 5,
        losses: 1,
        firstPlayedOn: '2026-04-01',
        lastPlayedOn: '2026-09-20',
      },
    ],
    firstPlayedOn: '2026-04-01',
    lastPlayedOn: '2026-09-20',
    ...overrides,
  };
}

const MENG = player({});
const YIN = player({
  slug: 'yin-sheng',
  name: '尹昇',
  nameEn: 'Yin Sheng',
  games: 1,
  wins: 1,
  draws: 0,
  losses: 0,
  lastPlayedOn: '2026-09-22',
});
const NO_TEAM = player({
  slug: 'lone',
  name: '独行',
  nameEn: null,
  federation: null,
  federationEn: null,
  lastPlayedOn: null,
});

const REFERENCE: PlayerReference = {
  points: {
    孟繁睿: { points: 3105, rank: 1, group: 'men', of: 50, listDate: '2025-12-28' },
  },
  ratings: {
    孟繁睿: { rating: 2650, rank: 3, of: 151, listLabel: '2023-09-30' },
    尹昇: { rating: 2510, rank: 40, of: 151, listLabel: '2023-09-30' },
  },
  titlesByName: { 孟繁睿: 'GM' },
  titlesBySlug: { 'yin-sheng': 'NM' },
};

const BOARD: XiangqiPlayerBoardRecord = {
  boardId: 'b-1',
  tourSlug: '2026-xiangqi-league',
  tourName: '2026年全国象棋甲级联赛',
  tourNameEn: '2026 National Xiangqi League',
  roundId: 'r-9',
  roundName: 'Round 9',
  playedOn: '2026-09-20',
  colour: 'black',
  opponent: { name: '尹昇', nameEn: 'Yin Sheng', slug: 'yin-sheng' },
  result: '0-1',
  outcome: 'win',
  plyCount: 81,
  sourceUrl: null,
  opening: null,
};

function sources(boards: XiangqiPlayerBoardRecord[] = [BOARD]): PlayerPageSources {
  return {
    listPlayers: async () => [MENG, YIN, NO_TEAM],
    listBoards: async (p) => (p.slug === 'meng-fanrui' ? boards : []),
    reference: async () => REFERENCE,
  };
}

test('player routes parse the four shapes, trailing slash and encoded slugs', () => {
  assert.deepEqual(parsePlayerRoute('/players'), { kind: 'index' });
  assert.deepEqual(parsePlayerRoute('/players/'), { kind: 'index' });
  assert.deepEqual(parsePlayerRoute('/players/teams'), { kind: 'teams' });
  assert.deepEqual(parsePlayerRoute('/players/teams/zhejiang'), {
    kind: 'team',
    key: 'zhejiang',
  });
  assert.deepEqual(parsePlayerRoute('/players/meng-fanrui'), {
    kind: 'player',
    slug: 'meng-fanrui',
  });
  assert.deepEqual(parsePlayerRoute(`/players/${encodeURIComponent('独行')}`), {
    kind: 'player',
    slug: '独行',
  });
  assert.equal(parsePlayerRoute('/players/%E0%A4%A'), null);
  assert.equal(parsePlayerRoute('/player'), null);
  assert.equal(parsePlayerRoute('/players/a/b'), null);
  assert.equal(parsePlayerRoute('/broadcast/xiangqi'), null);
});

test('a player page names the player in both scripts, the standing and the record', async () => {
  const page = await playerPageFor('/players/meng-fanrui', sources());
  assert.ok(page?.meta);
  assert.equal(page.meta.title, 'Meng Fanrui (孟繁睿) · Xiangqi player · Mistboard');
  assert.equal(
    page.meta.description,
    'Xiangqi grandmaster for Zhejiang. CXA points 3,105, #1 of 50 men (2025-12-28 list). 12 games in the Mistboard archive (6 wins, 5 draws, 1 loss).',
  );
  assert.equal(page.meta.urlPath, '/players/meng-fanrui');
  assert.match(page.meta.imagePath ?? '', /^\/og\/player\/meng-fanrui\.png\?v=1&k=[0-9a-f]{12}$/);
  assert.doesNotMatch(page.meta.description, /—/);
  // The body a crawler reads: both scripts, the team link, the list lines, the
  // game as a link and the opponent's page.
  const body = page.body ?? '';
  assert.match(
    body,
    /<h1><abbr title="Grandmaster">GM<\/abbr> Meng Fanrui <span lang="zh">孟繁睿<\/span><\/h1>/,
  );
  assert.match(
    body,
    /<a href="\/players\/teams\/zhejiang">Zhejiang <span lang="zh">浙江<\/span><\/a>/,
  );
  assert.match(body, /CXA points 3,105, #1 of 50 men/);
  assert.match(body, /Last CXA rating 2,650 \(#3 of 151, 2023-09-30 list\)/);
  assert.match(body, /<a href="\/broadcast\/xiangqi\/board\/b-1">0-1, won<\/a>/);
  assert.match(body, /<a href="\/players\/yin-sheng">Yin Sheng<\/a> vs Meng Fanrui \(black\)/);
  assert.match(
    body,
    /<a href="\/broadcast\/xiangqi\/2026-xiangqi-league">2026 National Xiangqi League<\/a>/,
  );
});

test('a player off the points list falls back to the closed rating; an authored title wins', () => {
  assert.equal(
    playerDescription(YIN, REFERENCE),
    'Xiangqi national master for Zhejiang. Last CXA rating 2,510 (#40 of 151, 2023-09-30 list). 1 game in the Mistboard archive (1 win, 0 draws, 0 losses).',
  );
  assert.equal(
    playerDescription(NO_TEAM, EMPTY_PLAYER_REFERENCE),
    'Xiangqi player. 12 games in the Mistboard archive (6 wins, 5 draws, 1 loss).',
  );
  // A CXA-listed player we have not relayed: no zero record.
  assert.equal(
    playerDescription(
      { ...NO_TEAM, games: 0, wins: 0, draws: 0, losses: 0 },
      EMPTY_PLAYER_REFERENCE,
    ),
    'Xiangqi player. No games in the Mistboard archive yet.',
  );
});

test('the card URL changes when the card content does, and only then', () => {
  const content = playerCardContent(MENG, [BOARD], REFERENCE);
  assert.deepEqual(content, {
    title: ['Meng Fanrui'],
    subtitle: 'CXA #1 · 3,105 points',
    boardId: 'b-1',
    plies: 81,
  });
  const path = playerCardPath('meng-fanrui', content);
  assert.equal(path, playerCardPath('meng-fanrui', playerCardContent(MENG, [BOARD], REFERENCE)));
  const newGame = playerCardContent(MENG, [{ ...BOARD, boardId: 'b-2' }, BOARD], REFERENCE);
  assert.notEqual(playerCardPath('meng-fanrui', newGame), path);
  const newList = playerCardContent(MENG, [BOARD], {
    ...REFERENCE,
    points: { 孟繁睿: { points: 3200, rank: 1, group: 'men', of: 50, listDate: '2026-06-30' } },
  });
  assert.notEqual(playerCardPath('meng-fanrui', newList), path);
  // Off the list, the team; no team, the game count.
  assert.equal(playerCardContent(YIN, [], REFERENCE).subtitle, 'Zhejiang');
  assert.equal(playerCardContent(NO_TEAM, [], REFERENCE).subtitle, '12 games');
  assert.deepEqual(playerCardContent(NO_TEAM, [], REFERENCE).title, ['Xiangqi player']);
});

test('an unknown player or team keeps the generic meta and is noindex', async () => {
  assert.deepEqual(await playerPageFor('/players/nobody', sources()), { noindex: true });
  assert.deepEqual(await playerPageFor('/players/teams/nowhere', sources()), { noindex: true });
  assert.equal(await playerPageFor('/bots', sources()), null);
});

test('the index, the teams index and a team page each carry their own meta and links', async () => {
  const index = await playerPageFor('/players', sources());
  assert.equal(index?.meta?.title, 'Xiangqi players · CXA points and games · Mistboard');
  assert.match(
    index?.meta?.description ?? '',
    /3 players with their current CXA tournament points/,
  );
  // Ordered by standing: points first, then the closed rating.
  const body = index?.body ?? '';
  assert.ok(body.indexOf('/players/meng-fanrui') < body.indexOf('/players/yin-sheng'));
  assert.match(body, /<a href="\/players\/lone"><span lang="zh">独行<\/span><\/a>/);

  const teams = await playerPageFor('/players/teams', sources());
  assert.equal(teams?.meta?.title, 'Xiangqi teams · Mistboard');
  assert.match(
    teams?.body ?? '',
    /<a href="\/players\/teams\/zhejiang">Zhejiang <span lang="zh">浙江<\/span><\/a> · 2 players · 13 games/,
  );

  const team = await playerPageFor('/players/teams/zhejiang', sources());
  assert.equal(team?.meta?.title, 'Zhejiang (浙江) · Xiangqi team · Mistboard');
  assert.equal(team?.meta?.urlPath, '/players/teams/zhejiang');
  assert.equal(
    team?.meta?.description,
    'Xiangqi team: 2 players and 13 games in the Mistboard archive (7 wins, 5 draws, 1 loss). Players include Meng Fanrui and Yin Sheng.',
  );
  assert.equal(team?.meta?.imagePath, undefined);
});

test('the players sitemap lists every page, dated from its latest game', () => {
  const entries = playerSitemapEntries([MENG, YIN, NO_TEAM]);
  assert.deepEqual(entries, [
    { path: '/players', lastmod: '2026-09-22' },
    { path: '/players/teams', lastmod: '2026-09-22' },
    { path: '/players/meng-fanrui', lastmod: '2026-09-20' },
    { path: '/players/yin-sheng', lastmod: '2026-09-22' },
    { path: '/players/lone', lastmod: undefined },
    { path: '/players/teams/zhejiang', lastmod: '2026-09-22' },
  ]);
  assert.equal(teamsOf([NO_TEAM]).length, 0);
});

test('the reference file is read from dist, and a missing one reads as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-players-ref-'));
  assert.deepEqual(await readPlayerReference(dir), EMPTY_PLAYER_REFERENCE);
  const other = await mkdtemp(join(tmpdir(), 'mistboard-players-ref-'));
  await writeFile(join(other, 'players-reference.json'), JSON.stringify(REFERENCE), 'utf-8');
  assert.deepEqual(await readPlayerReference(other), REFERENCE);
  const broken = await mkdtemp(join(tmpdir(), 'mistboard-players-ref-'));
  await writeFile(join(broken, 'players-reference.json'), '{nope', 'utf-8');
  assert.deepEqual(await readPlayerReference(broken), EMPTY_PLAYER_REFERENCE);
});

test('a card for a player with no games and no team leads with the last rating, never "0 games"', () => {
  const unrelayed = { ...NO_TEAM, name: '尹昇', games: 0, wins: 0, draws: 0, losses: 0 };
  assert.equal(
    playerCardContent(unrelayed, [], REFERENCE).subtitle,
    'CXA rating 2,510 · #40 (2023)',
  );
  assert.equal(playerCardContent(unrelayed, [], EMPTY_PLAYER_REFERENCE).subtitle, 'Xiangqi player');
});
