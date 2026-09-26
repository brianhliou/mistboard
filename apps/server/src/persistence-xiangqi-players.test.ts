import { fileURLToPath } from 'node:url';
import { readXiangqiBroadcastFixturePack } from './import-xiangqi-broadcast.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { importXiangqiBroadcastPack } from './persistence-xiangqi-broadcasts.js';
import {
  foldPlayers,
  listXiangqiPlayerBoards,
  listXiangqiPlayers,
  playerSlugBase,
} from './persistence-xiangqi-players.js';

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample', import.meta.url),
);

function expect<T>(actual: T) {
  return {
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toBe: (expected: unknown) => assert.equal(actual, expected),
  };
}
const describe = (name: string, fn: () => void): void => {
  void name;
  fn();
};
const it = test;

// One aggregated row per (player, event), as the query returns them. Counts
// arrive as strings from pg.
function row(input: {
  name: string;
  nameEn?: string | null;
  federation?: string | null;
  tour: string;
  games: number;
  wins?: number;
  draws?: number;
  losses?: number;
  first?: string;
  last?: string;
}) {
  return {
    name: input.name,
    name_en: input.nameEn ?? null,
    federation: input.federation ?? null,
    federation_en: null,
    tour_slug: input.tour,
    tour_name: input.tour,
    tour_name_en: null,
    games: String(input.games),
    wins: String(input.wins ?? 0),
    draws: String(input.draws ?? 0),
    losses: String(input.losses ?? 0),
    first_played: input.first ? new Date(input.first) : null,
    last_played: input.last ? new Date(input.last) : null,
  };
}

describe('player pages, derived from the archive', () => {
  it('gates on one finished game in an A-level event, then counts every event', () => {
    const players = foldPlayers([
      row({
        name: '尹昇',
        nameEn: 'Yin Sheng',
        federation: '浙江',
        tour: '2026-shanghai-cup',
        games: 17,
        wins: 6,
        draws: 11,
        first: '2026-09-09',
        last: '2026-09-13',
      }),
      row({
        name: '尹昇',
        nameEn: 'Yin Sheng',
        federation: '浙江',
        tour: 'some-amateur-open',
        games: 3,
        wins: 3,
        first: '2026-08-01',
        last: '2026-08-02',
      }),
      // Seen only in an ungraded event: no page.
      row({
        name: '某人',
        nameEn: 'Mou Ren',
        federation: '杭州',
        tour: 'some-amateur-open',
        games: 5,
        wins: 5,
      }),
    ]);
    expect(players.map((p) => p.slug)).toEqual(['yin-sheng']);
    const yin = players[0]!;
    expect(yin.games).toBe(20);
    expect([yin.wins, yin.draws, yin.losses]).toEqual([9, 11, 0]);
    // Events newest first; the ungraded one still counts on the page.
    expect(yin.events.map((e) => [e.tourSlug, e.level])).toEqual([
      ['2026-shanghai-cup', 'A'],
      ['some-amateur-open', null],
    ]);
    expect([yin.firstPlayedOn, yin.lastPlayedOn]).toEqual(['2026-08-01', '2026-09-13']);
  });

  it('is one player across events that spell the federation differently', () => {
    // dpxq writes the province in a cup and the club in the league; the first
    // live read split every league player in two on this.
    const players = foldPlayers([
      row({
        name: '尹昇',
        nameEn: 'Yin Sheng',
        federation: '浙江',
        tour: '2026-shanghai-cup',
        games: 17,
        last: '2026-09-13',
      }),
      {
        ...row({
          name: '尹昇',
          nameEn: 'Yin Sheng',
          federation: '浙江民泰银行象棋队',
          tour: '2026-xiangqi-league',
          games: 14,
          last: '2026-09-16',
        }),
        federation_en: 'Zhejiang Mintai Bank Xiangqi Team',
      },
    ]);
    expect(players.map((p) => [p.slug, p.games])).toEqual([['yin-sheng', 31]]);
    // The federation shown is the latest event's, the club.
    expect(players[0]?.federationEn).toBe('Zhejiang Mintai Bank Xiangqi Team');
  });

  it('splits two people with one name only through the alias map', () => {
    const rows = [
      row({
        name: '张伟',
        nameEn: 'Zhang Wei',
        federation: '吉林',
        tour: '2026-league-qualifier',
        games: 4,
      }),
      row({
        name: '张伟',
        nameEn: 'Zhang Wei',
        federation: '广东',
        tour: '2026-league-qualifier',
        games: 2,
      }),
    ];
    // Without an alias, one player: the data cannot tell them apart and a wrong
    // merge is the lesser error than a wrong split of every team change.
    expect(foldPlayers(rows).map((p) => [p.slug, p.games])).toEqual([['zhang-wei', 6]]);
  });

  it('orders by games played, then by name', () => {
    const players = foldPlayers([
      row({ name: '甲', nameEn: 'Jia', tour: '2026-shanghai-cup', games: 2 }),
      row({ name: '乙', nameEn: 'Yi', tour: '2026-shanghai-cup', games: 9 }),
    ]);
    expect(players.map((p) => p.slug)).toEqual(['yi', 'jia']);
  });

  it('gives every CXA-listed player a page, games or none, without moving a slug', () => {
    const players = foldPlayers(
      [
        row({ name: '王浩', nameEn: 'Wang Hao', tour: '2026-shanghai-cup', games: 4 }),
        // Listed, but seen only in an ungraded open: the gate alone keeps no page.
        row({
          name: '张红萍',
          nameEn: 'Zhang Hongping',
          tour: '2026-some-open',
          games: 3,
          wins: 2,
        }),
      ],
      [
        { name: '王天一', group: 'men' },
        { name: '张红萍', group: 'women' },
        // Romanises to the gated player's slug, which stays his.
        { name: '王昊', group: 'women' },
        { name: '王浩', group: 'men' },
      ],
    );
    expect(players.map((p) => [p.slug, p.name, p.games, p.cxaOnly ?? false])).toEqual([
      ['wang-hao', '王浩', 4, false],
      ['zhang-hongping', '张红萍', 3, false],
      ['wang-hao-women', '王昊', 0, true],
      ['wang-tianyi', '王天一', 0, true],
    ]);
    const wang = players.find((p) => p.name === '王天一')!;
    expect(wang.nameEn).toBe('Wang Tianyi');
    expect(wang.events).toEqual([]);
    // Without the lists, the archive's own pages are exactly as before.
    expect(
      foldPlayers([
        row({ name: '王浩', nameEn: 'Wang Hao', tour: '2026-shanghai-cup', games: 4 }),
      ]).map((p) => p.slug),
    ).toEqual(['wang-hao']);
  });

  it('slugs from the romanised name and falls back to the source spelling', () => {
    expect(playerSlugBase('Lại Lý Huynh', '赖理兄')).toBe('lai-ly-huynh');
    expect(playerSlugBase(null, '尹昇')).toBe('尹昇');
    expect(playerSlugBase('', '')).toBe('player');
  });
});

definePersistenceTests('xiangqi players', () => {
  test('lists the fixture pack players from finished boards only, with their boards', async () => {
    await importXiangqiBroadcastPack(await readXiangqiBroadcastFixturePack(FIXTURE_DIR, false));
    const all = await listXiangqiPlayers();
    const players = all.filter((p) => !p.cxaOnly);
    // The CXA-listed players come after, each with a page and no games.
    assert.ok(all.some((p) => p.cxaOnly && p.name === '王天一' && p.slug === 'wang-tianyi'));
    // The live board's two players have no finished game and no page.
    assert.deepEqual(
      players.map((p) => [p.slug, p.games, p.wins, p.losses]),
      [
        ['black-master', 1, 0, 1],
        ['red-master', 1, 1, 0],
      ],
    );
    const red = players.find((p) => p.slug === 'red-master')!;
    assert.equal(red.events[0]?.level, 'A');
    const boards = await listXiangqiPlayerBoards(
      red,
      (name) => players.find((p) => p.name === name)?.slug ?? null,
    );
    assert.equal(boards.length, 1);
    assert.equal(boards[0]?.colour, 'red');
    assert.equal(boards[0]?.outcome, 'win');
    assert.equal(boards[0]?.opponent.slug, 'black-master');
    // The fixture names no opening; a board whose source does carries it
    // through, ECCO code and all, for the page's openings table.
    assert.equal(boards[0]?.opening, null);
    await getPool().query(
      `UPDATE xiangqi_broadcast_boards
          SET payload = jsonb_set(payload, '{details}', $2::jsonb)
        WHERE id = $1`,
      [boards[0]!.boardId, JSON.stringify({ opening: 'C70 五七炮对屏风马进３卒' })],
    );
    const withOpening = await listXiangqiPlayerBoards(red, () => null);
    assert.equal(withOpening[0]?.opening, 'C70 五七炮对屏风马进３卒');
  });
});
