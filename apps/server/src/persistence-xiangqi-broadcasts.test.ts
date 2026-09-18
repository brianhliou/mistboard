import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { XiangqiBroadcastBoard } from '@mistboard/game';
import { readXiangqiBroadcastFixturePack } from './import-xiangqi-broadcast.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import {
  applyXiangqiBroadcastBoardUpdate,
  backfillXiangqiBroadcastTranslations,
  deleteXiangqiBroadcastTour,
  getXiangqiBroadcastBoard,
  getXiangqiBroadcastTour,
  importXiangqiBroadcastPack,
  listXiangqiBroadcastBoards,
  listXiangqiBroadcastRounds,
  listXiangqiBroadcastScheduledTours,
  listXiangqiBroadcastSyncLogs,
  listXiangqiBroadcastTours,
  queryCompletedXiangqiBroadcastBoards,
  setXiangqiBroadcastTourSchedule,
} from './persistence-xiangqi-broadcasts.js';
import {
  xiangqiBroadcastBoardStreamForApi,
  xiangqiBroadcastRoundStreamForApi,
} from './routes/xiangqi-broadcasts.js';
import {
  pollXiangqiBroadcastSourceOnce,
  type XiangqiBroadcastSourceFetch,
} from './xiangqi-broadcast-poller.js';
import {
  runXiangqiBroadcastTape,
  xiangqiBroadcastSourceResponse,
} from './xiangqi-broadcast-sim.js';

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample', import.meta.url),
);
const FIXTURE_SOURCE_POLICY = { allowedHosts: ['fixture.invalid'], allowLocal: false } as const;
const WXF_FIXTURE_HTML = readFileSync(
  fileURLToPath(new URL('../fixtures/wxf-dhtmlxq/2019-wxc-men-r1a-mini.html', import.meta.url)),
  'utf-8',
);
const WXF_FIXTURE_HTML_PAGE_B = readFileSync(
  fileURLToPath(new URL('../fixtures/wxf-dhtmlxq/2019-wxc-men-manifest/r1b.html', import.meta.url)),
  'utf-8',
);

// Legal 89-ply movelist of a real dpxq game; slicing a prefix stays legal
// because a prefix of a legal game is legal.
const DPXQ_FULL_MOVELIST =
  '77477062796780708979727666651242192710222625001009191016273576663554707967792241191863645442204265644264186816176866171479670304665641335655644255356254474330413555546243631464677564666947664655516270517146767583768683628666636533253948254462746676656776776766403071704456485777577073563749483745663657777333304074534553335377765333232429077646333460823433';

// A dpxq live-room per-board feed (view.asp): [DhtmlXQ_*] tags inline, no
// [DhtmlXQiFrame] wrapper, empty binit = standard start, empty result = live.
function dpxqLiveBoardPage(input: { plies: number; result?: string }): string {
  return [
    '<html><head><title>象棋直播室</title></head><body>',
    '[DhtmlXQ_event]赛事测试杯[/DhtmlXQ_event]<br>',
    '[DhtmlXQ_round]第01轮[/DhtmlXQ_round]<br>',
    '[DhtmlXQ_binit][/DhtmlXQ_binit]<br>',
    `[DhtmlXQ_result]${input.result ?? ''}[/DhtmlXQ_result]<br>`,
    '[DhtmlXQ_red]王天一[/DhtmlXQ_red]<br>',
    '[DhtmlXQ_black]郑惟桐[/DhtmlXQ_black]<br>',
    `[DhtmlXQ_movelist]${DPXQ_FULL_MOVELIST.slice(0, input.plies * 4)}[/DhtmlXQ_movelist]<br>`,
    '</body></html>',
  ].join('');
}

async function fixturePack(includeGameFiles = false) {
  return await readXiangqiBroadcastFixturePack(FIXTURE_DIR, includeGameFiles);
}

function fixtureTape(): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/tape.json`, 'utf-8')) as unknown;
}

function sourceBodyText(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function sourceFetch(body: unknown, status = 200): XiangqiBroadcastSourceFetch {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return sourceBodyText(body);
    },
  });
}

function multiSourceFetch(bodies: Record<string, unknown>): XiangqiBroadcastSourceFetch {
  return async (url) => {
    const body = bodies[url];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      async text() {
        return sourceBodyText(body ?? { error: 'not_found' });
      },
    };
  };
}

function timeoutFetch(): XiangqiBroadcastSourceFetch {
  return async (_url, init) =>
    await new Promise((_, reject) => {
      const rejectAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init.signal?.aborted) {
        rejectAbort();
        return;
      }
      init.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
}

definePersistenceTests('xiangqi broadcasts', () => {
  test('a source that states no schedule does not erase the seeded one', async () => {
    // The seeded tour/round dates are what the calendar shows and what
    // resolveScheduledRound reads to pick a poll's round. A converted game page
    // states neither, so a plain upsert nulled them on the FIRST successful
    // import: the event imported one round, lost its schedule, and every later
    // poll then found no active round and quietly imported nothing.
    // The fixture pack is deliberately `unknown`-typed (validation happens at
    // import), so shape it here.
    const pack = await fixturePack();
    const baseTour = pack.tour as Record<string, unknown>;
    const baseRounds = pack.rounds as Record<string, unknown>[];
    const slug = baseTour.slug as string;

    const seededTour = {
      ...baseTour,
      location: 'Shanghai',
      startsAt: '2026-09-09T13:30:00+08:00',
      endsAt: '2026-09-13T23:59:59+08:00',
    };
    const seededRounds = baseRounds.map((round) => ({
      ...round,
      startsAt: '2026-09-09T13:30:00+08:00',
    }));
    await importXiangqiBroadcastPack({ tour: seededTour, rounds: seededRounds, boards: [] });

    // Re-import the same tour and rounds as a poll would rebuild them: no
    // location, no dates, and the source's own event name.
    const { startsAt: _s, endsAt: _e, location: _l, ...tourNoDates } = seededTour;
    await importXiangqiBroadcastPack({
      tour: { ...tourNoDates, name: '2026年全国象棋男子甲级联赛' },
      rounds: seededRounds.map(({ startsAt: _r, ...round }) => round),
      boards: [],
    });

    const tours = await listXiangqiBroadcastTours();
    const tour = tours.find((row) => row.slug === slug);
    assert.ok(tour, 'tour survives the re-import');
    assert.equal(tour.startsAt, '2026-09-09T13:30:00+08:00');
    assert.equal(tour.endsAt, '2026-09-13T23:59:59+08:00');
    assert.equal(tour.location, 'Shanghai');
    // The name is not curated the same way: a re-poll is allowed to correct it.
    assert.equal(tour.name, '2026年全国象棋男子甲级联赛');

    const rounds = await listXiangqiBroadcastRounds(slug);
    assert.ok(rounds.length > 0);
    for (const round of rounds) {
      assert.equal(round.startsAt, '2026-09-09T13:30:00+08:00');
    }
  });

  test('imports the M0 fixture pack into tour, round, and board rows', async () => {
    const result = await importXiangqiBroadcastPack(await fixturePack());

    assert.deepEqual(
      {
        tourSlug: result.tourSlug,
        roundsImported: result.roundsImported,
        boardsImported: result.boardsImported,
        boardsSkipped: result.boardsSkipped,
      },
      {
        tourSlug: '2025-wxc-sample',
        roundsImported: 1,
        boardsImported: 2,
        boardsSkipped: 0,
      },
    );

    const tour = await getXiangqiBroadcastTour('2025-wxc-sample');
    assert.equal(tour?.name, '2025 World Xiangqi Championship Sample');

    const rounds = await listXiangqiBroadcastRounds('2025-wxc-sample');
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.id, 'men-r1');

    const boards = await listXiangqiBroadcastBoards('men-r1');
    assert.equal(boards.length, 2);
    assert.equal(boards[0]?.plyCount, 8);
    assert.equal(boards[1]?.status, 'live');
  });

  test('deleteXiangqiBroadcastTour removes the tour and everything under it', async () => {
    await importXiangqiBroadcastPack(await fixturePack());
    assert.ok(await getXiangqiBroadcastTour('2025-wxc-sample'));

    const deleted = await deleteXiangqiBroadcastTour('2025-wxc-sample');
    assert.equal(deleted, true);

    assert.equal(await getXiangqiBroadcastTour('2025-wxc-sample'), null);
    assert.equal((await listXiangqiBroadcastRounds('2025-wxc-sample')).length, 0);
    assert.equal((await listXiangqiBroadcastBoards('men-r1')).length, 0);
    assert.equal((await listXiangqiBroadcastSyncLogs({ tourSlug: '2025-wxc-sample' })).length, 0);

    // Deleting a slug that no longer exists is a no-op, not an error.
    assert.equal(await deleteXiangqiBroadcastTour('2025-wxc-sample'), false);
  });

  test('re-importing the same fixture pack is idempotent for public rows', async () => {
    await importXiangqiBroadcastPack(await fixturePack());
    await importXiangqiBroadcastPack(await fixturePack());

    assert.equal((await listXiangqiBroadcastRounds('2025-wxc-sample')).length, 1);
    assert.equal((await listXiangqiBroadcastBoards('men-r1')).length, 2);
    assert.equal((await listXiangqiBroadcastSyncLogs({ tourSlug: '2025-wxc-sample' })).length, 0);
  });

  test('invalid boards are logged and do not replace an existing valid board', async () => {
    const pack = await fixturePack();
    const validBoard = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    await importXiangqiBroadcastPack({ ...pack, boards: [validBoard] });

    const invalidReplacement: XiangqiBroadcastBoard = {
      ...validBoard,
      status: 'live',
      result: '*',
      moves: [{ from: 'a7', to: 'a6' }],
    };
    const result = await importXiangqiBroadcastPack({ ...pack, boards: [invalidReplacement] });

    assert.equal(result.boardsImported, 0);
    assert.equal(result.boardsSkipped, 1);
    assert.equal(result.errors[0]?.kind, 'illegal_move');

    const stored = await getXiangqiBroadcastBoard(validBoard.id);
    assert.equal(stored?.result, '1-0');
    assert.equal(stored?.moves.length, validBoard.moves.length);

    const logs = await listXiangqiBroadcastSyncLogs({ boardId: validBoard.id });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.kind, 'illegal_move');
  });

  test('including individual game files exercises invalid fixture rejection', async () => {
    const result = await importXiangqiBroadcastPack(await fixturePack(true));

    assert.equal(result.boardsImported, 2);
    assert.equal(result.boardsSkipped, 1);
    assert.equal(result.errors[0]?.boardId, '2025-wxc-sample-men-r1-b03-invalid');
    assert.equal((await listXiangqiBroadcastBoards('men-r1')).length, 2);
  });

  test('live board updates create, dedupe, extend, ignore stale, and reject incompatible moves', async () => {
    const pack = await fixturePack();
    const fullBoard = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });

    const emptyBoard: XiangqiBroadcastBoard = {
      ...fullBoard,
      status: 'live',
      result: '*',
      moves: [],
    };
    const onePly = { ...emptyBoard, moves: fullBoard.moves.slice(0, 1) };
    const twoPly = { ...emptyBoard, moves: fullBoard.moves.slice(0, 2) };
    const incompatible = {
      ...emptyBoard,
      moves: [fullBoard.moves[0]!, fullBoard.moves[2]!],
    };

    assert.deepEqual(await applyXiangqiBroadcastBoardUpdate(emptyBoard), {
      ok: true,
      boardId: fullBoard.id,
      status: 'created',
      plyCount: 0,
    });
    const duplicate = await applyXiangqiBroadcastBoardUpdate(emptyBoard);
    assert.equal(duplicate.ok ? duplicate.status : duplicate.kind, 'unchanged');
    const extended = await applyXiangqiBroadcastBoardUpdate(twoPly);
    assert.equal(extended.ok ? extended.status : extended.kind, 'extended');
    const stale = await applyXiangqiBroadcastBoardUpdate(onePly);
    assert.equal(stale.ok ? stale.status : stale.kind, 'unchanged');

    const rejected = await applyXiangqiBroadcastBoardUpdate(incompatible);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.ok ? '' : rejected.kind, 'illegal_move');
    assert.equal((await getXiangqiBroadcastBoard(fullBoard.id))?.moves.length, 2);
  });

  // #416 follow-through: the derived board key changed to include the source
  // page's game id, so the first poll after the change files a polling tour's
  // derived boards under new ids. The record under the old id is the same game
  // and must go, while a second game from a different page keeps its own row.
  test('creating a re-keyed derived board retires the same game under the old key', async () => {
    const pack = await fixturePack();
    const fullBoard = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });

    const pageA = 'http://www.dpxq.com/hldcg/search/view_m_143679.html';
    const derived = (id: string, sourceUrl: string, plies: number): XiangqiBroadcastBoard => ({
      ...fullBoard,
      id: `${fullBoard.tourSlug}-${fullBoard.roundId}-${id}`,
      sourceBoardId: id,
      sourceUrl,
      status: 'live',
      result: '*',
      moves: fullBoard.moves.slice(0, plies),
    });

    const legacy = derived('b1legacy', pageA, 2);
    const rekeyed = derived('b1rekeyed', pageA, 4);
    const otherGame = derived('b2other', 'http://www.dpxq.com/hldcg/search/view_m_143681.html', 3);
    const titled = derived('mr1t02', pageA, 3);

    for (const board of [legacy, otherGame, titled]) {
      const created = await applyXiangqiBroadcastBoardUpdate(board);
      assert.equal(created.ok ? created.status : created.kind, 'created');
    }

    const created = await applyXiangqiBroadcastBoardUpdate(rekeyed);
    assert.equal(created.ok ? created.status : created.kind, 'created');

    const remaining = (await listXiangqiBroadcastBoards(fullBoard.roundId)).map((b) => b.id);
    assert.equal(remaining.includes(legacy.id), false, 'old key retired');
    assert.equal(remaining.includes(rekeyed.id), true);
    assert.equal(remaining.includes(otherGame.id), true, 'a different page is a different game');
    assert.equal(remaining.includes(titled.id), true, 'title-named boards are never retired');

    const logs = await listXiangqiBroadcastSyncLogs({ tourSlug: fullBoard.tourSlug });
    const rekeyLog = logs.find((log) => log.kind === 'rekeyed');
    assert.equal(rekeyLog?.payload.retiredBoardId, legacy.id);
  });

  test('explicit correction can replace a non-prefix legal board update', async () => {
    const pack = await fixturePack();
    const fullBoard = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });

    const sideLine: XiangqiBroadcastBoard = {
      ...fullBoard,
      status: 'live',
      result: '*',
      moves: [
        { from: 'h3', to: 'e3' },
        { from: 'h8', to: 'e8' },
        { from: 'a1', to: 'a2' },
      ],
    };
    const correction: XiangqiBroadcastBoard = {
      ...fullBoard,
      status: 'live',
      result: '*',
      moves: [
        { from: 'h3', to: 'e3' },
        { from: 'h8', to: 'e8' },
        { from: 'b1', to: 'c3' },
      ],
    };

    const created = await applyXiangqiBroadcastBoardUpdate(sideLine);
    assert.equal(created.ok ? created.status : created.kind, 'created');
    const rejected = await applyXiangqiBroadcastBoardUpdate(correction);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.ok ? '' : rejected.kind, 'incompatible_update');

    const corrected = await applyXiangqiBroadcastBoardUpdate(correction, { allowCorrection: true });
    assert.equal(corrected.ok, true);
    assert.equal(corrected.ok ? corrected.status : '', 'corrected');
    assert.deepEqual((await getXiangqiBroadcastBoard(fullBoard.id))?.moves, correction.moves);

    const logs = await listXiangqiBroadcastSyncLogs({ boardId: fullBoard.id });
    assert.equal(
      logs.some((log) => log.kind === 'corrected'),
      true,
    );
  });

  test('fixture tape runner applies a full local live simulation', async () => {
    const pack = await fixturePack();
    const result = await runXiangqiBroadcastTape({ pack, tape: fixtureTape(), speed: 'instant' });

    assert.equal(result.framesApplied, 9);
    assert.deepEqual(
      result.updates.map((update) => (update.ok ? update.status : update.kind)),
      [
        'created',
        'created',
        'extended',
        'extended',
        'unchanged',
        'extended',
        'extended',
        'extended',
        'extended',
      ],
    );

    const board1 = await getXiangqiBroadcastBoard('2025-wxc-sample-men-r1-b01');
    const board2 = await getXiangqiBroadcastBoard('2025-wxc-sample-men-r1-b02');
    assert.equal(board1?.status, 'complete');
    assert.equal(board1?.result, '1-0');
    assert.equal(board1?.moves.length, 8);
    assert.equal(board2?.status, 'live');
    assert.equal(board2?.moves.length, 4);
  });

  test('source poller imports tour rounds and live board snapshots', async () => {
    const pack = await fixturePack();
    const source = xiangqiBroadcastSourceResponse(pack, fixtureTape(), 16000, 'clean');
    assert.equal(source.status, 200);
    assert.ok(!('malformed' in source.body));
    if ('malformed' in source.body) return;

    const updatedBody = {
      ...source.body,
      rounds: [{ ...(source.body.rounds[0] as Record<string, unknown>), name: 'Round 1 Live' }],
    };
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch(updatedBody),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.roundsImported : 0, 1);
    assert.equal(result.ok ? result.boardsSeen : 0, 2);
    assert.deepEqual(
      result.ok ? result.updates.map((update) => (update.ok ? update.status : update.kind)) : [],
      ['created', 'created'],
    );

    const rounds = await listXiangqiBroadcastRounds('2025-wxc-sample');
    assert.equal(rounds[0]?.name, 'Round 1 Live');
    assert.equal((await getXiangqiBroadcastBoard('2025-wxc-sample-men-r1-b01'))?.moves.length, 8);
    assert.equal((await getXiangqiBroadcastBoard('2025-wxc-sample-men-r1-b02'))?.moves.length, 2);
  });

  test('source poller updates persisted broadcast stream snapshots', async () => {
    const pack = await fixturePack();
    const fullBoard = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });
    await applyXiangqiBroadcastBoardUpdate({
      ...fullBoard,
      status: 'live',
      result: '*',
      moves: [],
    });

    const boardBefore = await xiangqiBroadcastBoardStreamForApi(fullBoard.id);
    const roundBefore = await xiangqiBroadcastRoundStreamForApi(
      fullBoard.tourSlug,
      fullBoard.roundId,
    );
    const source = xiangqiBroadcastSourceResponse(pack, fixtureTape(), 16000, 'clean');
    assert.equal(source.status, 200);
    assert.ok(!('malformed' in source.body));
    if ('malformed' in source.body) return;

    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch(source.body),
    });

    assert.equal(result.ok, true);
    const boardAfter = await xiangqiBroadcastBoardStreamForApi(fullBoard.id);
    const roundAfter = await xiangqiBroadcastRoundStreamForApi(
      fullBoard.tourSlug,
      fullBoard.roundId,
    );

    assert.ok(boardBefore);
    assert.ok(boardAfter);
    assert.ok(roundBefore);
    assert.ok(roundAfter);
    assert.notEqual(boardBefore.version, boardAfter.version);
    assert.notEqual(roundBefore.version, roundAfter.version);
    assert.equal(boardBefore.payload.timeline.length, 0);
    assert.equal(boardAfter.payload.timeline.length, 8);
    assert.equal(roundBefore.payload.boards.length, 1);
    assert.equal(roundAfter.payload.boards.length, 2);
  });

  test('source poller logs malformed HTTP and timeout failures', async () => {
    const httpError = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch({ error: 'fixture_source_error' }, 500),
    });
    assert.equal(httpError.ok, false);
    assert.equal(httpError.ok ? '' : httpError.kind, 'source_http_error');

    const malformed = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch({ malformed: true, boards: { bad: true } }),
    });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.ok ? '' : malformed.kind, 'source_malformed');

    const timedOut = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      timeoutMs: 1,
      fetchImpl: timeoutFetch(),
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.ok ? '' : timedOut.kind, 'source_timeout');

    const logs = await listXiangqiBroadcastSyncLogs({});
    assert.deepEqual(logs.map((log) => log.kind).sort(), [
      'source_http_error',
      'source_malformed',
      'source_timeout',
    ]);
    const malformedLog = logs.find((log) => log.kind === 'source_malformed');
    assert.deepEqual(malformedLog?.payload.bodySummary, {
      type: 'object',
      keys: ['boards', 'malformed'],
      keyCount: 2,
    });
    assert.equal(Object.hasOwn(malformedLog?.payload ?? {}, 'body'), false);
  });

  test('source poller stamps its failure logs with the tour it was polling for', async () => {
    const malformed = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      tourSlug: '2026-shanghai-cup',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch({ malformed: true, boards: { bad: true } }),
    });
    assert.equal(malformed.ok, false);
    // The tour endpoint reads health as the newest log WITH its slug, so an
    // unstamped error is invisible there: five days of source_malformed on the
    // 2026 Shanghai Cup read as "no sync log" while the source was misconfigured.
    const logs = await listXiangqiBroadcastSyncLogs({ tourSlug: '2026-shanghai-cup' });
    assert.deepEqual(
      logs.map((log) => log.kind),
      ['source_malformed'],
    );
  });

  test('source poller rejects disallowed URLs before fetch', async () => {
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://unapproved.example/source.json',
      sourcePolicy: { allowedHosts: [], allowLocal: false },
      fetchImpl: async () => {
        throw new Error('fetch should not run');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.kind, 'source_disallowed');

    const logs = await listXiangqiBroadcastSyncLogs({});
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.kind, 'source_disallowed');
    assert.equal(logs[0]?.payload.reason, 'host_not_allowed');
    assert.equal(logs[0]?.payload.sourceUrl, 'https://unapproved.example/source.json');
  });

  test('dry-run poll previews board updates without persisting anything', async () => {
    const pack = await fixturePack();
    const source = xiangqiBroadcastSourceResponse(pack, fixtureTape(), 16000, 'clean');
    assert.equal(source.status, 200);
    assert.ok(!('malformed' in source.body));
    if ('malformed' in source.body) return;

    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch(source.body),
      dryRun: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(
      result.ok ? result.updates.map((update) => (update.ok ? update.status : update.kind)) : [],
      ['created', 'created'],
    );

    assert.equal(await getXiangqiBroadcastTour('2025-wxc-sample'), null);
    assert.equal((await listXiangqiBroadcastRounds('2025-wxc-sample')).length, 0);
    assert.equal((await listXiangqiBroadcastSyncLogs({})).length, 0);
  });

  test('dry-run poll previews corrections against existing persisted state', async () => {
    const pack = await fixturePack();
    await importXiangqiBroadcastPack(pack);

    const board = (pack.boards as XiangqiBroadcastBoard[])[0]!;
    const divergent: XiangqiBroadcastBoard = {
      ...board,
      status: 'live',
      result: '*',
      moves: [{ from: 'a4', to: 'a5' }],
    };
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch({ tour: pack.tour, rounds: pack.rounds, boards: [divergent] }),
      dryRun: true,
      allowCorrection: true,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.ok ? result.updates.map((update) => (update.ok ? update.status : update.kind)) : [],
      ['corrected'],
    );

    const persisted = await getXiangqiBroadcastBoard(board.id);
    assert.deepEqual(persisted?.moves, board.moves);
    assert.equal((await listXiangqiBroadcastSyncLogs({})).length, 0);
  });

  test('dry-run poll failures record no sync logs', async () => {
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/source.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch({ error: 'fixture_source_error' }, 500),
      dryRun: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.kind, 'source_http_error');
    assert.equal((await listXiangqiBroadcastSyncLogs({})).length, 0);
  });

  test('source poller converts a WXF DhtmlXQ page directly', async () => {
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/r1a.html',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch(WXF_FIXTURE_HTML),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.boardsSeen : 0, 2);
    assert.equal(result.ok ? result.boardsFailed : 1, 0);

    const tour = await getXiangqiBroadcastTour(result.ok ? result.tourSlug : '');
    assert.ok(tour);
    const rounds = await listXiangqiBroadcastRounds(tour.slug);
    assert.equal(rounds.length, 1);
    assert.equal((await listXiangqiBroadcastBoards(rounds[0]!.id)).length, 2);
  });

  test('source poller broadcasts a growing dpxq live board: created then extended to complete', async () => {
    const sourceUrl = 'https://fixture.invalid/view.asp?owner=u&id=1';
    const poll = (page: string) =>
      pollXiangqiBroadcastSourceOnce({
        sourceUrl,
        sourcePolicy: FIXTURE_SOURCE_POLICY,
        fetchImpl: sourceFetch(page),
      });

    const first = await poll(dpxqLiveBoardPage({ plies: 4 }));
    assert.equal(first.ok, true);
    assert.deepEqual(first.ok ? first.updates.map((u) => (u.ok ? u.status : u.kind)) : [], [
      'created',
    ]);

    const second = await poll(dpxqLiveBoardPage({ plies: 12 }));
    assert.deepEqual(second.ok ? second.updates.map((u) => (u.ok ? u.status : u.kind)) : [], [
      'extended',
    ]);

    const third = await poll(dpxqLiveBoardPage({ plies: 30, result: '和' }));
    assert.deepEqual(third.ok ? third.updates.map((u) => (u.ok ? u.status : u.kind)) : [], [
      'extended',
    ]);

    // The persisted board reflects the final live state: full ply count, drawn,
    // complete. This is the live-broadcast loop end to end through the DB path.
    const tourSlug = third.ok ? third.tourSlug : '';
    const rounds = await listXiangqiBroadcastRounds(tourSlug);
    const boards = await listXiangqiBroadcastBoards(rounds[0]!.id);
    assert.equal(boards.length, 1);
    assert.equal(boards[0]?.moves.length, 30);
    assert.equal(boards[0]?.status, 'complete');
    assert.equal(boards[0]?.result, '1/2-1/2');

    // Ingestion caches English names next to the Chinese originals on every
    // persisted level (tour, round, both players).
    const tour = await getXiangqiBroadcastTour(tourSlug);
    assert.equal(tour?.name, '赛事测试杯');
    assert.match(tour?.nameEn ?? '', /Cup$/);
    assert.equal(rounds[0]?.name, '第01轮');
    assert.equal(rounds[0]?.nameEn, 'Round 1');
    assert.equal(boards[0]?.red.name, '王天一');
    assert.equal(boards[0]?.red.nameEn, 'Wang Tianyi');
    assert.equal(boards[0]?.black.name, '郑惟桐');
    assert.equal(boards[0]?.black.nameEn, 'Zheng Weitong');

    // The completed-game search projection surfaces the cached English names
    // and matches English queries against them.
    const found = await queryCompletedXiangqiBroadcastBoards({ player: 'Wang Tianyi' });
    assert.equal(found.boards.length, 1);
    // The count describes the same filtered slice as the rows, not the table.
    assert.equal(found.total, 1);
    assert.equal(found.boards[0]?.redName, '王天一');
    assert.equal(found.boards[0]?.redNameEn, 'Wang Tianyi');
    assert.equal(found.boards[0]?.blackNameEn, 'Zheng Weitong');
    assert.equal(found.boards[0]?.roundNameEn, 'Round 1');
    assert.match(found.boards[0]?.tourNameEn ?? '', /Cup$/);
  });

  test('translate-backfill recomputes cached English names without re-importing', async () => {
    // Ingest a Chinese dpxq game, then strip the cached translations with raw
    // SQL to simulate rows persisted before translation existed.
    const polled = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/view.asp?owner=u&id=1',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: sourceFetch(dpxqLiveBoardPage({ plies: 30, result: '和' })),
    });
    assert.equal(polled.ok, true);
    const tourSlug = polled.ok ? polled.tourSlug : '';

    const client = new pg.Client({ connectionString: TEST_DATABASE_URL ?? '' });
    await client.connect();
    try {
      await client.query(`UPDATE xiangqi_broadcast_tours SET payload = payload - 'nameEn'`);
      await client.query(`UPDATE xiangqi_broadcast_rounds SET payload = payload - 'nameEn'`);
      await client.query(
        `UPDATE xiangqi_broadcast_boards
            SET red = red - 'nameEn',
                black = black - 'nameEn',
                payload = jsonb_set(
                  jsonb_set(payload, '{red}', (payload->'red') - 'nameEn'),
                  '{black}',
                  (payload->'black') - 'nameEn'
                )`,
      );
    } finally {
      await client.end();
    }
    assert.equal((await getXiangqiBroadcastTour(tourSlug))?.nameEn, undefined);

    // Dry run reports the pending changes but writes nothing.
    const preview = await backfillXiangqiBroadcastTranslations({ dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.changes.length, 3);
    assert.equal((await getXiangqiBroadcastTour(tourSlug))?.nameEn, undefined);

    // The real run restores every cached translation.
    const applied = await backfillXiangqiBroadcastTranslations();
    assert.equal(applied.changes.length, 3);
    const tour = await getXiangqiBroadcastTour(tourSlug);
    assert.match(tour?.nameEn ?? '', /Cup$/);
    const rounds = await listXiangqiBroadcastRounds(tourSlug);
    assert.equal(rounds[0]?.nameEn, 'Round 1');
    const boards = await listXiangqiBroadcastBoards(rounds[0]!.id);
    assert.equal(boards[0]?.red.nameEn, 'Wang Tianyi');
    assert.equal(boards[0]?.black.nameEn, 'Zheng Weitong');

    // Re-running is a no-op once the caches match.
    const repeat = await backfillXiangqiBroadcastTranslations();
    assert.equal(repeat.changes.length, 0);
  });

  test('source poller walks a manifest of multiple pages through one policy gate', async () => {
    const manifest = {
      schema: 'mistboard.xiangqi.broadcast.manifest.v1',
      sources: [
        {
          url: 'https://fixture.invalid/r1a.html',
          tourSlug: 'wxc-manifest',
          tourName: 'WXC Manifest',
          roundId: 'wxc-manifest-r1a',
          roundName: 'Round 1 Page A',
        },
        {
          url: 'https://fixture.invalid/r1b.html',
          tourSlug: 'wxc-manifest',
          tourName: 'WXC Manifest',
          roundId: 'wxc-manifest-r1b',
          roundName: 'Round 1 Page B',
        },
        {
          url: 'https://unapproved.example/r1c.html',
          tourSlug: 'wxc-manifest',
          roundId: 'wxc-manifest-r1c',
        },
      ],
    };
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/manifest.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: multiSourceFetch({
        'https://fixture.invalid/manifest.json': manifest,
        'https://fixture.invalid/r1a.html': WXF_FIXTURE_HTML,
        'https://fixture.invalid/r1b.html': WXF_FIXTURE_HTML_PAGE_B,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.tourSlug : '', 'wxc-manifest');
    assert.equal(
      (await getXiangqiBroadcastTour('wxc-manifest'))?.sourceUrl,
      'https://fixture.invalid/manifest.json',
    );
    assert.equal(result.ok ? result.sourcesSeen : 0, 3);
    assert.equal(result.ok ? result.sourcesFailed : 0, 1);
    assert.equal(result.ok ? result.roundsImported : 0, 2);
    assert.equal(result.ok ? result.boardsSeen : 0, 4);
    assert.equal(result.ok ? result.boardsFailed : 1, 0);

    const rounds = await listXiangqiBroadcastRounds('wxc-manifest');
    assert.deepEqual(
      rounds.map((round) => round.id),
      ['wxc-manifest-r1a', 'wxc-manifest-r1b'],
    );
    assert.equal((await listXiangqiBroadcastBoards('wxc-manifest-r1a')).length, 2);
    assert.equal((await listXiangqiBroadcastBoards('wxc-manifest-r1b')).length, 2);

    const logs = await listXiangqiBroadcastSyncLogs({});
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.kind, 'source_disallowed');
    assert.equal(logs[0]?.payload.manifestUrl, 'https://fixture.invalid/manifest.json');
  });

  test('tour poll schedules persist and list only enabled tours', async () => {
    const pack = await fixturePack();
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });

    assert.deepEqual(await listXiangqiBroadcastScheduledTours(), []);

    const updated = await setXiangqiBroadcastTourSchedule('2025-wxc-sample', {
      pollEnabled: true,
      pollIntervalMs: 15_000,
    });
    assert.deepEqual(updated, {
      slug: '2025-wxc-sample',
      sourceUrl: 'https://www.wxf-xiangqi.org/',
      pollEnabled: true,
      pollIntervalMs: 15_000,
    });

    const scheduled = await listXiangqiBroadcastScheduledTours();
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]?.slug, '2025-wxc-sample');

    const tour = await getXiangqiBroadcastTour('2025-wxc-sample');
    assert.equal(tour?.pollEnabled, true);
    assert.equal(tour?.pollIntervalMs, 15_000);

    // Re-importing the pack must not clobber the operator's schedule.
    await importXiangqiBroadcastPack({ tour: pack.tour, rounds: pack.rounds, boards: [] });
    assert.equal((await getXiangqiBroadcastTour('2025-wxc-sample'))?.pollEnabled, true);

    assert.equal(
      await setXiangqiBroadcastTourSchedule('missing-tour', {
        pollEnabled: true,
        pollIntervalMs: 15_000,
      }),
      null,
    );
  });

  test('nested manifests are rejected as malformed manifest entries', async () => {
    const nested = {
      schema: 'mistboard.xiangqi.broadcast.manifest.v1',
      sources: [{ url: 'https://fixture.invalid/inner.json' }],
    };
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: 'https://fixture.invalid/manifest.json',
      sourcePolicy: FIXTURE_SOURCE_POLICY,
      fetchImpl: multiSourceFetch({
        'https://fixture.invalid/manifest.json': nested,
        'https://fixture.invalid/inner.json': nested,
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.kind, 'source_malformed');
    const logs = await listXiangqiBroadcastSyncLogs({});
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.kind, 'source_malformed');
  });
});
