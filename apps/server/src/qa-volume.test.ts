import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  fsfUciToXiangqiSquares,
  GAME_SPECS,
  isStandardXiangqiLegalMove,
} from '@mistboard/game';
import { resolveBanqiAnalysis } from './banqi-analysis.js';
import { resolveJieqiAnalysis } from './jieqi-analysis.js';
import {
  assertLocalQaDatabase,
  buildQaGame,
  QA_PLAYERS,
  QA_TOPIC_TITLES,
  QA_VOLUME,
  qaGameAnalysis,
  qaStudyRoot,
  qaVolumeSpecIds,
} from './qa-volume.js';
import { resolveXiangqiAnalysis } from './routes/xiangqi-games.js';
import { resolveThreeKingdomsBanqiAnalysis } from './three-kingdoms-banqi-analysis.js';

const profile = JSON.parse(
  readFileSync(new URL('../../../config/product-profile.json', import.meta.url), 'utf8'),
) as { gameSpecIds: string[] };
const specs = qaVolumeSpecIds(profile.gameSpecIds);
const now = Date.UTC(2026, 10, 3, 20);

test('QA seeding includes the generated volume needed by local layout reviews (#713)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['db:seed:qa'], /npm run db:seed:volume(?: &&|$)/);
});

test('the product seed covers every public live variant, with no retired or hidden games', () => {
  assert.deepEqual(
    [...specs].sort(),
    GAME_SPECS.filter((s) => s.publicSurface !== 'hidden' && s.runtimeStatus === 'live')
      .map((s) => s.id)
      .sort(),
  );
  assert.throws(() => qaVolumeSpecIds(['misspelled-variant']), /Unknown QA product spec/);
  assert.throws(() => buildQaGame('misspelled-variant', 0, now), /No QA legal-play generator/);
});

test('volume seeding cannot target a remote database, even with the legacy override', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.doesNotThrow(() => assertLocalQaDatabase(`postgres://qa:qa@${host}:5435/mistboard`));
  }
  for (const host of ['example.com', 'localhost.example.com', '192.168.1.2']) {
    assert.throws(() => assertLocalQaDatabase(`postgres://qa:qa@${host}/mistboard`), /loopback/);
  }
});

for (const spec of specs) {
  test(`${spec}: ten distinct, finished legal-play games with recent dates and fictional participants`, () => {
    const ids = new Set<string>();
    const tapes = new Set<string>();
    for (let i = 0; i < QA_VOLUME.gamesPerVariant; i++) {
      // buildQaGame validates the full generated tape through the real reducer.
      const game = buildQaGame(spec, i, now);
      ids.add(game.roomId);
      tapes.add(JSON.stringify(game.events.filter((e) => e.type === 'move-played')));
      assert.equal(game.summary.variant, spec);
      assert.ok(game.summary.plyCount >= 2);
      assert.equal(
        game.summary.plyCount,
        game.events.filter((e) => e.type === 'move-played').length,
      );
      assert.equal(game.summary.mode, 'pvp');
      assert.equal(game.summary.rated, false);
      assert.equal(game.summary.participants?.length, 2);
      for (const p of game.summary.participants!)
        assert.ok(QA_PLAYERS.some((user) => user.id === p.subjectId));
      assert.ok(game.events.every((e) => e.roomId === game.roomId));
      assert.ok(game.summary.endedAt.getTime() > now - 24 * 3600000);
      assert.ok(game.summary.endedAt.getTime() < now);
      if (i === 0)
        assert.deepEqual(
          game,
          buildQaGame(spec, i, now),
          're-runs must have stable ids and legal tapes',
        );
    }
    assert.equal(ids.size, 10);
    assert.equal(tapes.size, 10);
  });
}

test('synthetic stored chart series cover every ply, have varying scores and no hidden identities or best moves', () => {
  const chartVariants = [
    'xiangqi',
    'jieqi',
    'banqi',
    'three-kingdoms-banqi',
    'jungle',
    'jungle-flip',
    'crazyhouse-xiangqi',
    'dark-chess',
  ];
  for (const spec of specs) {
    const game = buildQaGame(spec, 0, now);
    const analysis = qaGameAnalysis(game);
    assert.equal(Boolean(analysis), chartVariants.includes(spec));
    if (!analysis) continue;
    const plies = Array.isArray(analysis.payload) ? analysis.payload : analysis.payload.plies;
    assert.equal(plies.length, game.summary.plyCount + 1);
    assert.ok(new Set(plies.map((p) => p.cp)).size > 2);
    for (const [ply, point] of plies.entries()) {
      assert.deepEqual(Object.keys(point).sort(), ['best', 'cp', 'mate', 'ply']);
      assert.equal(point.ply, ply);
      assert.equal(point.best, null);
      assert.equal(point.mate, null);
    }
    if (!Array.isArray(analysis.payload)) assert.deepEqual(analysis.payload.seats, {});
  }
});

test('jieqi, xiangqi, banqi and TK chart fixtures are returned by the real cache resolvers without computing', async () => {
  for (const spec of ['jieqi', 'xiangqi', 'banqi', 'three-kingdoms-banqi']) {
    const game = buildQaGame(spec, 0, now);
    const analysis = qaGameAnalysis(game)!;
    assert.ok(Array.isArray(analysis.payload));
    const plies = analysis.payload;
    const cache = {
      get: async (roomId: string, engineId: string, depth: number) =>
        roomId === game.roomId && engineId === analysis.engineId && depth === analysis.depth
          ? plies
          : null,
      save: async () => {
        assert.fail('GET must use the seeded cache');
      },
    };
    const result =
      spec === 'xiangqi'
        ? await resolveXiangqiAnalysis(
            game.roomId,
            { timeline: [] } as never,
            cache,
            undefined,
            false,
          )
        : spec === 'jieqi'
          ? await resolveJieqiAnalysis(game.roomId, [], undefined as never, cache, undefined, false)
          : spec === 'three-kingdoms-banqi'
            ? await resolveThreeKingdomsBanqiAnalysis(game.roomId, [], cache, undefined, false)
            : await resolveBanqiAnalysis(
                game.roomId,
                [],
                undefined as never,
                cache,
                undefined,
                false,
              );
    assert.deepEqual(result?.plies, plies);
  }
});

test('studies contain legal opening lines; thread volume fills the actual homepage fetch windows', () => {
  const forum = readFileSync(
    new URL('../../web/src/landing-forum-preview.ts', import.meta.url),
    'utf8',
  );
  const studies = readFileSync(
    new URL('../../web/src/landing-community-widgets.ts', import.meta.url),
    'utf8',
  );
  assert.equal(QA_VOLUME.topics, Number(/landingForumFetchLimit = (\d+)/.exec(forum)![1]));
  assert.equal(QA_VOLUME.studies, Number(/landingStudiesFetchCount = (\d+)/.exec(studies)![1]));
  assert.equal(QA_TOPIC_TITLES.length, QA_VOLUME.topics);
  for (let i = 0; i < QA_VOLUME.studies; i++) {
    const tree = qaStudyRoot(i) as { version: number; root: { children: Node[] } };
    type Node = { uci: string; children: Node[] };
    let state = createInitialXiangqiState('qa-study');
    let node = tree.root.children[0];
    let plies = 0;
    while (node) {
      const move = fsfUciToXiangqiSquares(node.uci);
      assert.ok(move);
      assert.ok(isStandardXiangqiLegalMove(state, move));
      state = applyStandardXiangqiMove(state, move);
      node = node.children[0];
      plies++;
    }
    assert.equal(plies, 4);
  }
});
