import assert from 'node:assert/strict';
import test from 'node:test';
import { XIANGQI_BROADCAST_SCHEMA } from '@mistboard/game';
import {
  type BroadcastPageSources,
  broadcastPageFor,
  parseBroadcastRoute,
} from './broadcast-pages.js';
import type {
  StoredXiangqiBroadcastBoard,
  StoredXiangqiBroadcastRound,
  StoredXiangqiBroadcastTour,
} from './persistence-xiangqi-broadcasts.js';

const at = new Date('2026-10-01T00:00:00Z');

const tour: StoredXiangqiBroadcastTour = {
  schema: XIANGQI_BROADCAST_SCHEMA,
  slug: '2026-wuyang-cup',
  name: '第三十二届五羊杯',
  nameEn: '32nd Five Rams Cup',
  location: 'Guangzhou',
  sourceUrl: 'https://source.example/never-shown',
  startsAt: '2026-10-02T09:00:00+08:00',
  endsAt: '2026-10-08T18:00:00+08:00',
  pollMode: 'auto',
  pollEnabled: false,
  pollIntervalMs: 30_000,
  createdAt: at,
  updatedAt: at,
};

const round = (n: number, startsAt?: string): StoredXiangqiBroadcastRound => ({
  schema: XIANGQI_BROADCAST_SCHEMA,
  id: `2026-wuyang-cup-r0${n}`,
  tourSlug: tour.slug,
  name: `第${n}轮`,
  nameEn: `Round ${n}`,
  ...(startsAt ? { startsAt } : {}),
  createdAt: at,
  updatedAt: at,
});

// Stored out of order: the pages list rounds by the number in the id.
const rounds = [
  round(2, '2026-10-03T09:00:00+08:00'),
  round(1, '2026-10-02T09:00:00+08:00'),
  round(3),
];

const board = (
  id: string,
  roundId: string,
  over: Partial<StoredXiangqiBroadcastBoard>,
): StoredXiangqiBroadcastBoard => ({
  schema: XIANGQI_BROADCAST_SCHEMA,
  id,
  tourSlug: tour.slug,
  roundId,
  sourceBoardId: id,
  boardNumber: 1,
  red: { name: '王天一', nameEn: 'Wang Tianyi' },
  black: { name: '郑惟桐', nameEn: 'Zheng Weitong' },
  status: 'complete',
  result: '1-0',
  moves: [],
  plyCount: 81,
  finalStatus: { type: 'finished', winner: 'red', reason: 'resignation' },
  sourceUrl: 'https://source.example/board-never-shown',
  createdAt: at,
  updatedAt: at,
  ...over,
});

const boards: Record<string, StoredXiangqiBroadcastBoard[]> = {
  '2026-wuyang-cup-r01': [
    board('2026-wuyang-cup-2026-wuyang-cup-r01-b1', '2026-wuyang-cup-r01', {}),
    board('2026-wuyang-cup-2026-wuyang-cup-r01-b2', '2026-wuyang-cup-r01', {
      boardNumber: 2,
      red: { name: '<script>x</script>', nameEn: 'A & B <i>' },
      black: { name: '许银川', nameEn: 'Xu Yinchuan' },
      result: '1/2-1/2',
      plyCount: 120,
    }),
  ],
  '2026-wuyang-cup-r02': [
    board('2026-wuyang-cup-2026-wuyang-cup-r02-b1', '2026-wuyang-cup-r02', {
      status: 'live',
      result: '*',
      plyCount: 30,
    }),
  ],
  // Paired, not started: listed, but no game link and no round link.
  '2026-wuyang-cup-r03': [
    board('2026-wuyang-cup-2026-wuyang-cup-r03-b1', '2026-wuyang-cup-r03', {
      status: 'scheduled',
      result: '*',
      plyCount: 0,
    }),
  ],
};

function sources(over: Partial<BroadcastPageSources> = {}): BroadcastPageSources {
  const all = Object.values(boards).flat();
  return {
    listTours: async () => [tour],
    getTour: async (slug) => (slug === tour.slug ? tour : null),
    listRounds: async (slug) => (slug === tour.slug ? rounds : []),
    listBoards: async (roundId) => boards[roundId] ?? [],
    getBoard: async (id) => all.find((entry) => entry.id === id) ?? null,
    playerSlugs: async () => new Map([['王天一', 'wang-tianyi']]),
    shareMeta: async () => null,
    ...over,
  };
}

const links = (html: string): string[] =>
  [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]!);
const h1 = (html: string): string | undefined => /<h1>(.*?)<\/h1>/.exec(html)?.[1];

test('parseBroadcastRoute: index, tour, round and board; section pages are not tours', () => {
  assert.deepEqual(parseBroadcastRoute('/broadcast/xiangqi'), { kind: 'index' });
  assert.deepEqual(parseBroadcastRoute('/broadcast/xiangqi/'), { kind: 'index' });
  assert.deepEqual(parseBroadcastRoute('/broadcast/xiangqi/2026-wuyang-cup/'), {
    kind: 'tour',
    slug: '2026-wuyang-cup',
  });
  assert.deepEqual(parseBroadcastRoute('/broadcast/xiangqi/t/round/t-r01'), {
    kind: 'round',
    slug: 't',
    roundId: 't-r01',
  });
  assert.deepEqual(parseBroadcastRoute('/broadcast/xiangqi/board/t-t-r06-b1gogny0'), {
    kind: 'board',
    boardId: 't-t-r06-b1gogny0',
  });
  for (const section of ['calendar', 'about', 'ops', 'board']) {
    assert.equal(parseBroadcastRoute(`/broadcast/xiangqi/${section}`), null, section);
  }
  assert.equal(parseBroadcastRoute('/broadcast/xiangqi/%E0%A4%A'), null);
  assert.equal(parseBroadcastRoute('/players'), null);
});

test('index page: own canonical, h1, and a link to every event', async () => {
  const page = await broadcastPageFor('/broadcast/xiangqi/', sources());
  assert.equal(page?.meta?.urlPath, '/broadcast/xiangqi');
  assert.ok(page.meta.title.length >= 25 && page.meta.description.length >= 100);
  assert.equal(h1(page.body!), 'Xiangqi broadcasts');
  assert.ok(links(page.body!).includes('/broadcast/xiangqi/2026-wuyang-cup'));
  assert.match(page.body!, /3 rounds · 4 games/);
});

test('tour page: rounds in playing order, linked only once a game has started', async () => {
  const page = await broadcastPageFor('/broadcast/xiangqi/2026-wuyang-cup', sources());
  assert.equal(page?.meta?.urlPath, '/broadcast/xiangqi/2026-wuyang-cup');
  assert.match(h1(page.body!)!, /32nd Five Rams Cup/);
  assert.match(page.body!, /2-8 Oct 2026, Guangzhou/);
  const hrefs = links(page.body!);
  const r1 = hrefs.indexOf('/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r01');
  const r2 = hrefs.indexOf('/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r02');
  assert.ok(r1 >= 0 && r2 > r1, 'round 1 is listed before round 2');
  assert.ok(!hrefs.some((href) => href.endsWith('-r03')), 'an unstarted round is not linked');
  assert.ok(hrefs.includes('/players/wang-tianyi'));
});

test('round page: pairings with results, each game a crawlable link', async () => {
  const path = '/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r01';
  const page = await broadcastPageFor(path, sources());
  assert.equal(page?.meta?.urlPath, path);
  assert.ok(page.meta.description.length >= 100, page.meta.description);
  assert.match(h1(page.body!)!, /Round 1/);
  const hrefs = links(page.body!);
  assert.ok(hrefs.includes('/broadcast/xiangqi/board/2026-wuyang-cup-2026-wuyang-cup-r01-b1'));
  assert.ok(hrefs.includes('/broadcast/xiangqi/board/2026-wuyang-cup-2026-wuyang-cup-r01-b2'));
  assert.ok(hrefs.includes('/broadcast/xiangqi/2026-wuyang-cup'), 'links back to the event');
  assert.ok(hrefs.includes('/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r02'));
  assert.match(page.body!, /Wang Tianyi won with Red in 41 moves/);
  assert.match(page.body!, /½-½, drawn in 60 moves/);
});

test('round page: a scheduled board is listed without a game link', async () => {
  const path = '/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r03';
  const page = await broadcastPageFor(path, sources());
  assert.match(page!.body!, /not started/);
  assert.ok(!links(page!.body!).some((href) => href.includes('/board/')));
});

test('board page: "Red vs Black, round, event" heading, result, link back to its round', async () => {
  const path = '/broadcast/xiangqi/board/2026-wuyang-cup-2026-wuyang-cup-r01-b1';
  const page = await broadcastPageFor(path, sources());
  assert.equal(page?.meta?.urlPath, path);
  assert.equal(h1(page.body!), 'Wang Tianyi vs Zheng Weitong, Round 1, 32nd Five Rams Cup');
  assert.match(page.body!, /Result: 1-0, Wang Tianyi won with Red in 41 moves/);
  assert.ok(
    links(page.body!).includes('/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r01'),
  );
});

test('the share meta og-broadcast already builds wins over the fallback copy', async () => {
  const page = await broadcastPageFor(
    '/broadcast/xiangqi/2026-wuyang-cup',
    sources({
      shareMeta: async () => ({
        title: 'Shared title for the event | Mistboard',
        description: 'Shared description',
        imagePath: '/og/broadcast/board/x.png',
      }),
    }),
  );
  assert.equal(page?.meta?.title, 'Shared title for the event | Mistboard');
  assert.equal(page?.meta?.imagePath, '/og/broadcast/board/x.png');
  // The canonical is built from the stored slug, whatever the share meta says.
  assert.equal(page?.meta?.urlPath, '/broadcast/xiangqi/2026-wuyang-cup');
});

test('unknown event, round or game: no meta, kept out of the index', async () => {
  for (const path of [
    '/broadcast/xiangqi/no-such-tour',
    '/broadcast/xiangqi/2026-wuyang-cup/round/no-such-round',
    '/broadcast/xiangqi/board/no-such-board',
  ]) {
    assert.deepEqual(await broadcastPageFor(path, sources()), { noindex: true }, path);
  }
  assert.equal(await broadcastPageFor('/broadcast/xiangqi/calendar', sources()), null);
});

test('bodies escape names and carry no source URLs', async () => {
  const pages = await Promise.all(
    [
      '/broadcast/xiangqi',
      '/broadcast/xiangqi/2026-wuyang-cup',
      '/broadcast/xiangqi/2026-wuyang-cup/round/2026-wuyang-cup-r01',
      '/broadcast/xiangqi/board/2026-wuyang-cup-2026-wuyang-cup-r01-b2',
    ].map((path) => broadcastPageFor(path, sources())),
  );
  for (const page of pages) {
    const body = page!.body!;
    assert.ok(!body.includes('<script>'), 'a name cannot inject markup');
    assert.ok(!body.includes('source.example'), 'no source URL is serialised');
    assert.ok(!body.includes('—'), 'no em dashes in English copy');
  }
  assert.match(pages[3]!.body!, /A &amp; B &lt;i&gt;/);
});
