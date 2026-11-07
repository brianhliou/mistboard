import { readFileSync } from 'node:fs';
import { resolveBanqiAnalysis } from './banqi-analysis.js';
import { resolveJieqiAnalysis } from './jieqi-analysis.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { buildQaGame, QA_VOLUME, QA_VOLUME_CORPUS, qaVolumeSpecIds } from './qa-volume.js';
import { seedQaVolume } from './qa-volume-store.js';
import { resolveXiangqiAnalysis } from './routes/xiangqi-games.js';

const profile = JSON.parse(
  readFileSync(new URL('../../../config/product-profile.json', import.meta.url), 'utf8'),
) as { gameSpecIds: string[] };
const specs = qaVolumeSpecIds(profile.gameSpecIds);
const now = Date.UTC(2026, 10, 3, 20);

definePersistenceTests('qa-volume', () => {
  test('volume seed re-runs without duplicates, preserves other data, and serves cached review charts', async () => {
    const client = await getPool().connect();
    try {
      await client.query(
        "INSERT INTO users (id,email,handle,display_name) VALUES ('volume-sentinel','sentinel@example.invalid','volume-sentinel','Keep me')",
      );
      await seedQaVolume(client, specs, now);
      const countRows = async () =>
        (
          await client.query(
            `SELECT (SELECT count(*)::integer FROM games WHERE corpus_id=$1) AS games,
          (SELECT count(*)::integer FROM events WHERE room_id IN (SELECT room_id FROM games WHERE corpus_id=$1)) AS events,
          (SELECT count(*)::integer FROM game_analysis WHERE room_id IN (SELECT room_id FROM games WHERE corpus_id=$1)) AS analyses,
          (SELECT count(*)::integer FROM forum_topics WHERE id LIKE 'qa-volume-topic-%') AS topics,
          (SELECT count(*)::integer FROM forum_posts WHERE id LIKE 'qa-volume-topic-%') AS posts,
          (SELECT count(*)::integer FROM studies WHERE id LIKE 'qa-volume-study-%') AS studies,
          (SELECT count(*)::integer FROM study_chapters WHERE id LIKE 'qa-volume-study-%') AS chapters,
          (SELECT count(*)::integer FROM chat_lines WHERE id LIKE 'qa-volume-chat-%') AS chat`,
            [QA_VOLUME_CORPUS],
          )
        ).rows[0];
      const first = await countRows();
      await seedQaVolume(client, specs, now + 60000);
      assert.deepEqual(await countRows(), first);
      assert.equal(first.games, specs.length * QA_VOLUME.gamesPerVariant);
      assert.equal(first.topics, QA_VOLUME.topics);
      assert.equal(first.posts, QA_VOLUME.topics * 3);
      assert.equal(first.studies, QA_VOLUME.studies);
      assert.equal(first.chapters, QA_VOLUME.studies);
      assert.equal(first.chat, QA_VOLUME.chatLines);
      assert.equal(first.analyses, 14);
      assert.equal(
        (await client.query("SELECT display_name FROM users WHERE id='volume-sentinel'")).rows[0]
          .display_name,
        'Keep me',
      );
      const xq = buildQaGame('xiangqi', 0, now);
      const jq = buildQaGame('jieqi', 0, now);
      const bq = buildQaGame('banqi', 0, now);
      const charts = [
        await resolveXiangqiAnalysis(xq.roomId, { timeline: [] }, undefined, undefined, false),
        await resolveJieqiAnalysis(jq.roomId, [], undefined as never, undefined, undefined, false),
        await resolveBanqiAnalysis(bq.roomId, [], undefined as never, undefined, undefined, false),
      ];
      for (const chart of charts) {
        assert.ok(chart);
        assert.ok(chart.plies.length > 20);
      }
      // A colliding reserved room id must fail rather than replace non-seed data.
      await client.query("UPDATE games SET corpus_id='other-owner' WHERE room_id=$1", [xq.roomId]);
      await assert.rejects(seedQaVolume(client, specs, now), /Refusing to overwrite non-seed game/);
      assert.equal(
        (await client.query('SELECT corpus_id FROM games WHERE room_id=$1', [xq.roomId])).rows[0]
          .corpus_id,
        'other-owner',
      );
    } finally {
      client.release();
    }
  });
});
