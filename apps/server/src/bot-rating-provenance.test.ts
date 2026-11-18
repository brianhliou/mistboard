import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { insertBotRatingSnapshotDrafts } from './bot-rating-import.js';
import {
  collectStaleBotRatings,
  findStaleBotRatings,
  loadBotRatingPins,
  readBotRatingStamp,
  stampBotRatingSourceRef,
} from './bot-rating-provenance.js';
import { FIRST_PARTY_BOT_PROFILES } from './first-party-bots.js';
import { collectMistboardReadoutFacts } from './persistence-mistboard-readout.js';

const engineId = 'pikafish-xiangqi-level-8';
const pins = loadBotRatingPins([engineId]);
const snapshot = {
  botId: 'pikafish',
  gameSpecId: 'xiangqi',
  timeClass: 'blitz',
  engineId,
  sourceRef: stampBotRatingSourceRef('engine-elo;variant=xiangqi', pins),
};

test('pins follow the net used by each neural engine, while classical tiers stay explicit', () => {
  const current = loadBotRatingPins([
    engineId,
    'fairy-stockfish-xiangqi-level-8',
    'fairy-stockfish-xiangqi-level-1',
    'ab-jchess-jieqi',
    'jqe-jieqi',
    'katago-jungle',
  ]);
  assert.equal(
    current.nets[engineId],
    'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11',
  );
  assert.equal(current.nets['fairy-stockfish-xiangqi-level-8'], current.nets[engineId]);
  assert.equal(current.nets['fairy-stockfish-xiangqi-level-1'], null);
  assert.equal(
    current.nets['ab-jchess-jieqi'],
    'fdb6245b868bb204cf2b64fc4f8440d7a1e22b73abdd2a13dce180b65b01619e',
  );
  assert.equal(
    current.nets['jqe-jieqi'],
    'f90bd44e8ee244405eb08eb4f784e3f156900f0691f651b5124d50032f8ba160',
  );
  assert.equal(
    current.nets['katago-jungle'],
    '8cb07eff56893f1d93115cbbc7925a0f97c80343af5bd6022812f07eee6b2b20',
  );
});

test('round-trips recipe and net stamps through the snapshot insert', async () => {
  let stored: string | null = null;
  const statements: string[] = [];
  const db = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        if (sql.includes('INSERT INTO bot_rating_snapshots')) stored = values![6] as string;
        return { rows: [] };
      },
      release() {},
    }),
  } as unknown as pg.Pool;
  assert.equal(
    await insertBotRatingSnapshotDrafts(db, [
      {
        ...snapshot,
        timeClass: 'blitz',
        rating: 2334,
        ratingDeviation: 80,
        games: 36,
        published: false,
      },
    ]),
    1,
  );
  assert.equal(stored, snapshot.sourceRef);
  assert.deepEqual(readBotRatingStamp(stored, engineId), {
    recipe: pins.recipe,
    netSha256: pins.nets[engineId],
  });
  assert.deepEqual([statements[0], statements.at(-1)], ['BEGIN', 'COMMIT']);
});

test('the whole first-party registry detects planted stale snapshots and accepts matching pins', () => {
  const engines = FIRST_PARTY_BOT_PROFILES.flatMap((bot) => Object.values(bot.engines));
  const current = loadBotRatingPins(engines);
  const sourceRef = stampBotRatingSourceRef('registry-fixture', current);
  const matching = FIRST_PARTY_BOT_PROFILES.flatMap((bot) =>
    Object.entries(bot.engines).map(([gameSpecId, id]) => ({
      botId: bot.id,
      gameSpecId,
      engineId: id,
      timeClass: 'blitz',
      sourceRef,
    })),
  );
  for (const id of engines) assert.ok(Object.hasOwn(current.nets, id), `missing net policy: ${id}`);
  assert.deepEqual(findStaleBotRatings(matching, current), []);
  const mismatched = matching.map((row) => ({
    ...row,
    sourceRef: row.sourceRef.replace(current.recipe, 'engines-000000000000'),
  }));
  assert.equal(findStaleBotRatings(mismatched, current).length, matching.length);
  assert.equal(
    findStaleBotRatings(
      matching.map((row) => ({ ...row, sourceRef: null })),
      current,
    ).length,
    matching.length,
  );
});

test('a net-only change, missing stamp, malformed stamp and unknown engine are stale', () => {
  assert.deepEqual(findStaleBotRatings([snapshot], pins), []);
  const changedNet = { ...pins, nets: { [engineId]: 'f'.repeat(64) } };
  const stale = findStaleBotRatings([snapshot], changedNet);
  assert.equal(stale.length, 1);
  assert.equal(stale[0]!.measured?.netSha256, pins.nets[engineId]);
  assert.equal(stale[0]!.current?.netSha256, 'f'.repeat(64));
  for (const sourceRef of [
    null,
    'engine-elo;variant=xiangqi',
    `${snapshot.sourceRef};recipe=${pins.recipe}`,
    snapshot.sourceRef.replace(pins.nets[engineId]!, 'bad'),
  ]) {
    assert.equal(findStaleBotRatings([{ ...snapshot, sourceRef }], pins).length, 1);
  }
  assert.equal(findStaleBotRatings([{ ...snapshot, engineId: 'unknown-engine' }], pins).length, 1);
  assert.throws(() => stampBotRatingSourceRef(`custom;recipe=${pins.recipe}`, pins), /reserved/);
});

test('classical engines stamp no external net and custom references still group a whole import', () => {
  const current = loadBotRatingPins(['fairy-stockfish-xiangqi-level-1', engineId]);
  const ref = stampBotRatingSourceRef('tournament:test-cup', current);
  assert.ok(ref.startsWith('tournament:test-cup;recipe='));
  assert.deepEqual(readBotRatingStamp(ref, 'fairy-stockfish-xiangqi-level-1'), {
    recipe: current.recipe,
    netSha256: null,
  });
  assert.deepEqual(readBotRatingStamp(ref, engineId), {
    recipe: current.recipe,
    netSha256: pins.nets[engineId],
  });
  assert.equal(readBotRatingStamp(ref, 'engine-not-in-this-report'), null);
});

test('the readout selects latest published public snapshots per variant and time class', async () => {
  const jieqiEngine = 'pikafish-jieqi-strongest';
  const current = loadBotRatingPins([engineId, jieqiEngine]);
  let calls = 0;
  const db = {
    query: async (sql: string) => {
      calls++;
      assert.match(sql, /DISTINCT ON \(s.bot_id, s.game_spec_id, s.time_class\)/);
      assert.match(sql, /s.published = true/);
      assert.match(sql, /b.visibility = 'public'/);
      assert.match(sql, /s.published_at DESC NULLS LAST, s.created_at DESC, s.id DESC/);
      return {
        rows: [
          {
            bot_id: 'pikafish',
            active_engine_id: engineId,
            game_spec_id: 'xiangqi',
            time_class: 'blitz',
            source_ref: null,
          },
          {
            bot_id: 'pikafish',
            active_engine_id: engineId,
            game_spec_id: 'jieqi',
            time_class: 'rapid',
            source_ref: stampBotRatingSourceRef('matching', current),
          },
        ],
      };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  const stale = await collectStaleBotRatings(db);
  assert.equal(calls, 1);
  assert.deepEqual(
    stale.map((entry) => [entry.botId, entry.gameSpecId, entry.timeClass]),
    [['pikafish', 'xiangqi', 'blitz']],
  );
  assert.equal(stale[0]!.measured, null);
});

test('the engine facts collector carries a stale published rating into the readout', async () => {
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('FROM bot_rating_snapshots s')
        ? [
            {
              bot_id: 'pikafish',
              active_engine_id: engineId,
              game_spec_id: 'xiangqi',
              time_class: 'blitz',
              source_ref: null,
            },
          ]
        : [],
    }),
  } as unknown as Pick<pg.Pool, 'query'>;
  const facts = await collectMistboardReadoutFacts(db, new Date('2026-11-13T18:00:00Z'));
  assert.equal(facts.engines?.staleRatings?.length, 1);
  assert.equal(facts.engines?.staleRatings?.[0]?.botId, 'pikafish');
  assert.ok(!facts.collectorErrors?.some((error) => error.section === 'engines'));
});

test('Rapfi measurement stamps distinguish build, native network and every serving policy', () => {
  const ids = ['rapfi-level-1', 'rapfi-level-8', 'rapfi-strongest', 'random-legal-gomoku'];
  const current = loadBotRatingPins(ids);
  const sourceRef = stampBotRatingSourceRef('rapfi-calibration', current);
  // Level 8 is the strongest policy (#1204), so those two share one stamp;
  // every other id has its own.
  assert.equal(current.policies!['rapfi-level-8'], current.policies!['rapfi-strongest']);
  assert.equal(new Set(Object.values(current.policies!)).size, ids.length - 1);
  for (const id of ids) {
    const netSha256 =
      id === 'random-legal-gomoku'
        ? null
        : '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62';
    assert.equal(current.nets[id], netSha256);
    const policy = current.policies![id];
    assert.ok(policy);
    assert.deepEqual(readBotRatingStamp(sourceRef, id), {
      recipe: current.recipe,
      netSha256,
      policy,
    });
    const row = { ...snapshot, engineId: id, sourceRef };
    assert.deepEqual(findStaleBotRatings([row], current), []);
    assert.equal(
      findStaleBotRatings([row], {
        ...current,
        policies: { ...current.policies, [id]: 'different-policy' },
      }).length,
      1,
    );
    const noPolicy = sourceRef
      .split(';')
      .filter((field) => !field.startsWith('policy.'))
      .join(';');
    assert.equal(findStaleBotRatings([{ ...row, sourceRef: noPolicy }], current).length, 1);
    assert.equal(readBotRatingStamp(`${sourceRef};policy.${id}=${policy}`, id), null);
    assert.equal(
      readBotRatingStamp(sourceRef.replace(`policy.${id}=${policy}`, `policy.${id}=`), id),
      null,
    );
    assert.equal(findStaleBotRatings([row], { ...current, policies: undefined }).length, 1);
    assert.throws(() => stampBotRatingSourceRef(`custom;policy.${id}=spoof`, current), /reserved/);
  }
  assert.equal(
    Object.hasOwn(
      loadBotRatingPins(['rapfi-level-09', 'rapfi-strongest-other']).nets,
      'rapfi-level-09',
    ),
    false,
  );
});
