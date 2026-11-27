import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { XIANGQI_BROADCAST_SCHEMA } from '@mistboard/game';
import {
  type DpxqArchiveEvent,
  type DpxqArchiveReader,
  parseDpxqArchiveEventList,
  parseDpxqGameListRows,
  planDpxqArchiveEvent,
  runDpxqArchiveImport,
} from './import-dpxq-archive.js';
import { getPool, withTransaction } from './persistence-db.js';
import { definePersistenceTests } from './persistence-test-support.js';
import { importXiangqiBroadcastPackOn } from './persistence-xiangqi-broadcasts.js';
import { translatedXiangqiBroadcastRound } from './xiangqi-broadcast-translate.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/dpxq/${name}`, import.meta.url), 'utf-8');

const PAGES: Record<string, string> = {
  '131470': 'view_m_131470-asian-2024.html',
  '131471': 'view_m_131471-asian-2024.html',
  '128342': 'view_m_128342-asian-2024.html',
  '128343': 'view_m_128343-asian-2024.html',
};

function fixtureReader(missing: string[] = []): DpxqArchiveReader {
  return {
    gameList: (tourId) =>
      tourId === '9503' ? fixture('movelist_9503-asian-2024-men-r01-r07.html') : null,
    gamePage: (id) => (PAGES[id] && !missing.includes(id) ? fixture(PAGES[id]!) : null),
  };
}

const EVENT: DpxqArchiveEvent = {
  slug: '2024-asian-individual-men',
  dpxqId: '9503',
  nameEn: '2024 20th Asian Xiangqi Individual Championship Men',
  nameZh: '2024年第20届亚洲象棋个人锦标赛 男子组',
  startsOn: '2024-12-02',
};

test('the event list reads by header and refuses a malformed row', () => {
  const header =
    'slug\tdpxq_id\tname_en\tyear\trung\tgames\trounds\tcomplete\tname_zh\tstarts_on\tmissing';
  const events = parseDpxqArchiveEventList(
    `${header}\n${EVENT.slug}\t9503\t${EVENT.nameEn}\t2024\t2\t13\t7\tyes\t${EVENT.nameZh}\t2024-12-02\t\n`,
  );
  assert.deepEqual(events, [EVENT]);
  assert.throws(() =>
    parseDpxqArchiveEventList(`${header}\nBad Slug\t9503\tx\t\t\t\t\t\tzh\t\t\n`),
  );
});

test('a game list row keeps every record it links, not only the first', () => {
  const rows = parseDpxqGameListRows(fixture('movelist_9503-asian-2024-men-r01-r07.html'));
  assert.deepEqual(rows, [
    { ids: ['131470'], roundNumber: 1, table: 13 },
    { ids: ['131471'], roundNumber: 1, table: 15 },
    { ids: ['128342', '128343'], roundNumber: 7, table: 1 },
  ]);
});

test('an archived event maps to the tour, round and board rows the poller writes', () => {
  const plan = planDpxqArchiveEvent(EVENT, fixtureReader());
  assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.problems));
  assert.deepEqual(plan.tour, {
    schema: XIANGQI_BROADCAST_SCHEMA,
    slug: EVENT.slug,
    name: EVENT.nameZh,
    sourceUrl: 'mistboard-discover://dpxq-tour?tour=9503&tourSlug=2024-asian-individual-men',
    startsAt: '2024-12-03T00:00:00+08:00',
    endsAt: `${plan.boards.at(-1)!.details!.playedAt!.slice(0, 10)}T23:59:59+08:00`,
  });
  assert.deepEqual(
    plan.rounds.map((round) => [round.id, round.name, round.sourceUrl]),
    [
      ['2024-asian-individual-men-r01', '第1轮', 'http://www.dpxq.com/hldcg/round_9503_1.html'],
      ['2024-asian-individual-men-r07', '第7轮', 'http://www.dpxq.com/hldcg/round_9503_7.html'],
    ],
  );
  assert.equal(plan.rounds[0]!.startsAt, '2024-12-03T14:00:00+08:00');
  assert.equal(translatedXiangqiBroadcastRound(plan.rounds[0]!).nameEn, 'Round 1');
  // A round of single games at distinct tables keys on the table; the round
  // whose one row links two games numbers them in list order.
  assert.deepEqual(
    plan.boards.map((board) => [board.id, board.sourceBoardId, board.boardNumber, board.sourceUrl]),
    [
      [
        '2024-asian-individual-men-2024-asian-individual-men-r01-r01t13',
        'r01t13',
        13,
        'http://www.dpxq.com/hldcg/search/view_m_131470.html',
      ],
      [
        '2024-asian-individual-men-2024-asian-individual-men-r01-r01t15',
        'r01t15',
        15,
        'http://www.dpxq.com/hldcg/search/view_m_131471.html',
      ],
      [
        '2024-asian-individual-men-2024-asian-individual-men-r07-r07b01',
        'r07b01',
        1,
        'http://www.dpxq.com/hldcg/search/view_m_128342.html',
      ],
      [
        '2024-asian-individual-men-2024-asian-individual-men-r07-r07b02',
        'r07b02',
        2,
        'http://www.dpxq.com/hldcg/search/view_m_128343.html',
      ],
    ],
  );
  for (const board of plan.boards) {
    assert.equal(board.status, 'complete');
    assert.ok(board.moves.length > 0);
  }
  assert.equal(plan.boards[0]!.red.name, '胡敬斌');
  assert.equal(plan.boards[0]!.result, '0-1');
  assert.equal(plan.undatedRounds, 0);
});

test('an event with a game missing from disk is refused whole', () => {
  const plan = planDpxqArchiveEvent(EVENT, fixtureReader(['131471']));
  assert.equal(plan.ok, false);
  assert.match(!plan.ok ? plan.problems.join(' ') : '', /1 game pages not on disk: 131471/);
});

test('an event whose English name would differ from the list is refused', () => {
  const plan = planDpxqArchiveEvent({ ...EVENT, nameEn: 'Asian Championship' }, fixtureReader());
  assert.equal(plan.ok, false);
  assert.match(!plan.ok ? plan.problems[0]! : '', /English name/);
});

test('an event with no game list on disk is refused', () => {
  const plan = planDpxqArchiveEvent({ ...EVENT, dpxqId: '1' }, fixtureReader());
  assert.equal(plan.ok, false);
  assert.match(!plan.ok ? plan.problems.join(' ') : '', /movelist_1 not on disk/);
});

async function tableCounts() {
  const { rows } = await getPool().query<{
    tours: number;
    rounds: number;
    boards: number;
    logs: number;
  }>(
    `SELECT (SELECT count(*)::int FROM xiangqi_broadcast_tours) AS tours,
            (SELECT count(*)::int FROM xiangqi_broadcast_rounds) AS rounds,
            (SELECT count(*)::int FROM xiangqi_broadcast_boards) AS boards,
            (SELECT count(*)::int FROM xiangqi_broadcast_sync_logs) AS logs`,
  );
  return rows[0]!;
}

const quiet = () => {};

definePersistenceTests('dpxq archive import', () => {
  test('a dry run writes nothing', async () => {
    const before = await tableCounts();
    const summary = await runDpxqArchiveImport({
      events: [EVENT],
      reader: fixtureReader(),
      dryRun: true,
      log: quiet,
    });
    assert.deepEqual(summary.wouldImport, [
      { slug: EVENT.slug, rounds: 2, boards: 4, newBoards: 4 },
    ]);
    assert.deepEqual(await tableCounts(), before);
  });

  test('the import writes a listed, unpolled tour and a second run changes nothing', async () => {
    const first = await runDpxqArchiveImport({
      events: [EVENT],
      reader: fixtureReader(),
      dryRun: false,
      log: quiet,
    });
    assert.deepEqual(first.imported[0]!.result, {
      tourWritten: true,
      roundsWritten: 2,
      boards: { created: 4 },
    });
    const { rows } = await getPool().query<{
      listed: boolean;
      poll_mode: string;
      poll_enabled: boolean;
      starts_at: Date;
      updated_at: Date;
    }>(
      `SELECT listed, poll_mode, poll_enabled, starts_at, updated_at FROM xiangqi_broadcast_tours WHERE slug = $1`,
      [EVENT.slug],
    );
    assert.equal(rows[0]!.listed, true);
    assert.equal(rows[0]!.poll_mode, 'off');
    assert.equal(rows[0]!.poll_enabled, false);
    const { rows: roundRows } = await getPool().query<{ starts_at: Date }>(
      `SELECT starts_at FROM xiangqi_broadcast_rounds WHERE id = $1`,
      [`${EVENT.slug}-r01`],
    );
    assert.equal(roundRows[0]!.starts_at.toISOString(), '2024-12-03T06:00:00.000Z');
    const counts = await tableCounts();

    const second = await runDpxqArchiveImport({
      events: [EVENT],
      reader: fixtureReader(),
      dryRun: false,
      log: quiet,
    });
    assert.deepEqual(second.imported[0]!.result, {
      tourWritten: false,
      roundsWritten: 0,
      boards: { unchanged: 4 },
    });
    assert.deepEqual(await tableCounts(), counts);
    const { rows: after } = await getPool().query<{ updated_at: Date }>(
      `SELECT updated_at FROM xiangqi_broadcast_tours WHERE slug = $1`,
      [EVENT.slug],
    );
    assert.equal(after[0]!.updated_at.getTime(), rows[0]!.updated_at.getTime());
  });

  test('a stored tour polled for the same slug is a clash and is left alone', async () => {
    await withTransaction((client) =>
      importXiangqiBroadcastPackOn(client, {
        tour: {
          schema: XIANGQI_BROADCAST_SCHEMA,
          slug: EVENT.slug,
          name: EVENT.nameZh,
          sourceUrl: 'mistboard-discover://dpxq-tour?tour=9503',
        },
        rounds: [],
        boards: [],
      }),
    );
    const before = await tableCounts();
    const summary = await runDpxqArchiveImport({
      events: [EVENT],
      reader: fixtureReader(),
      dryRun: false,
      log: quiet,
    });
    assert.equal(summary.clashes.length, 1);
    assert.match(summary.clashes[0]!.reason, /poll_mode=auto/);
    assert.deepEqual(summary.imported, []);
    assert.deepEqual(await tableCounts(), before);
  });

  test('a different slug already relaying the dpxq event is a clash', async () => {
    await withTransaction((client) =>
      importXiangqiBroadcastPackOn(client, {
        tour: {
          schema: XIANGQI_BROADCAST_SCHEMA,
          slug: '2024-asian-men',
          name: EVENT.nameZh,
          sourceUrl: 'mistboard-discover://dpxq-tour?tour=9503',
        },
        rounds: [],
        boards: [],
      }),
    );
    const summary = await runDpxqArchiveImport({
      events: [EVENT],
      reader: fixtureReader(),
      dryRun: true,
      log: quiet,
    });
    assert.match(summary.clashes[0]?.reason ?? '', /already relayed as 2024-asian-men/);
  });
});
