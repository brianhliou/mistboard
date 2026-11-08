import type pg from 'pg';
import {
  buildQaGame,
  QA_PLAYERS,
  QA_TOPIC_TITLES,
  QA_VOLUME,
  QA_VOLUME_CORPUS,
  qaGameAnalysis,
  qaStudyRoot,
} from './qa-volume.js';

type SeedClient = Pick<pg.PoolClient, 'query'>;

// One transaction and one shared advisory lock: parallel worktrees can re-run
// this without interleaving partial tapes. Only our reserved ids are changed.
export async function seedQaVolume(
  client: SeedClient,
  specIds: readonly string[],
  now = Date.now(),
): Promise<string[]> {
  const reviews: string[] = [];
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mistboard:qa-volume-v1'))");
    for (const player of QA_PLAYERS) {
      await client.query(
        `INSERT INTO users (id, email, handle, display_name, profile_visibility, email_verified_at)
         VALUES ($1, $2, $3, $4, 'public', now()) ON CONFLICT (id) DO NOTHING`,
        [player.id, `${player.handle}@example.invalid`, player.handle, player.name],
      );
    }
    for (const specId of specIds) {
      for (let index = 0; index < QA_VOLUME.gamesPerVariant; index++) {
        const game = buildQaGame(specId, index, now);
        const s = game.summary;
        const existing = await client.query<{ corpus_id: string | null }>(
          'SELECT corpus_id FROM games WHERE room_id = $1',
          [game.roomId],
        );
        if (existing.rows[0] && existing.rows[0].corpus_id !== QA_VOLUME_CORPUS) {
          throw new Error(`Refusing to overwrite non-seed game ${game.roomId}`);
        }
        await client.query(
          `INSERT INTO games (room_id, variant, mode, status, result, termination, ply_count,
             started_at, ended_at, white_name, black_name, corpus_id, rated, visibility, initial_ms, increment_ms)
           VALUES ($1,$2,'pvp','completed',$3,$4,$5,$6,$7,$8,$9,$10,false,'public',300000,5000)
           ON CONFLICT (room_id) DO UPDATE SET result=EXCLUDED.result, termination=EXCLUDED.termination,
             ply_count=EXCLUDED.ply_count, started_at=EXCLUDED.started_at, ended_at=EXCLUDED.ended_at`,
          [
            game.roomId,
            s.variant,
            s.result,
            s.termination,
            s.plyCount,
            s.startedAt,
            s.endedAt,
            s.whiteName,
            s.blackName,
            QA_VOLUME_CORPUS,
          ],
        );
        // Regenerate only seed-owned tapes (a kernel update may shorten one).
        await client.query(
          `DELETE FROM events WHERE room_id = $1 AND EXISTS
           (SELECT 1 FROM games WHERE room_id=$1 AND corpus_id=$2)`,
          [game.roomId, QA_VOLUME_CORPUS],
        );
        await client.query(
          `INSERT INTO events (room_id, seq, type, payload, created_at)
           SELECT $1, (e.ordinality-1)::integer, e.value->>'type', e.value,
             to_timestamp((e.value->>'at')::double precision / 1000)
           FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS e(value, ordinality)`,
          [game.roomId, JSON.stringify(game.events)],
        );
        for (const p of s.participants ?? []) {
          await client.query(
            `INSERT INTO game_participants (game_id,color,subject_type,subject_id,display_name,visibility)
             VALUES ($1,$2,'user',$3,$4,'public') ON CONFLICT (game_id,color) DO NOTHING`,
            [game.roomId, p.color, p.subjectId, p.displayName],
          );
        }
        // Two analysed games per variant also exercise mixed analysed/unanalysed lists.
        const analysis = index < 2 ? qaGameAnalysis(game) : null;
        if (analysis) {
          await client.query(
            `INSERT INTO game_analysis (room_id,engine_id,depth,plies) VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT (room_id,engine_id,depth) DO UPDATE SET plies=EXCLUDED.plies`,
            [game.roomId, analysis.engineId, analysis.depth, JSON.stringify(analysis.payload)],
          );
          if (index === 0)
            reviews.push(
              specId === 'dark-chess' ? `/review/${game.roomId}` : `/${specId}/game/${game.roomId}`,
            );
        }
      }
    }
    for (let index = 0; index < QA_VOLUME.topics; index++) {
      const topicId = `qa-volume-topic-${index}`;
      const author = QA_PLAYERS[index % QA_PLAYERS.length]!;
      const at = new Date(now - index * 3600000);
      await client.query(
        `INSERT INTO forum_topics (id,category_id,author_account_id,slug,title,post_count,last_post_at,created_at)
         VALUES ($1,'strategy',$2,$1,$3,3,$4,$4)
         ON CONFLICT (id) DO UPDATE SET last_post_at=EXCLUDED.last_post_at`,
        [topicId, author.id, QA_TOPIC_TITLES[index], at],
      );
      const messages = [
        'I made a short practice line for our friendly games. Which continuation would you try?',
        'I would develop the horse first and keep the cannon behind a screen. Thanks for sharing the position.',
        'Tried that in a rematch and found a better defence. I added the alternative to my study notes.',
      ];
      for (let reply = 0; reply < messages.length; reply++) {
        await client.query(
          `INSERT INTO forum_posts (id,topic_id,author_account_id,body_text,created_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
          [
            `${topicId}-post-${reply}`,
            topicId,
            QA_PLAYERS[(index + reply) % QA_PLAYERS.length]!.id,
            messages[reply],
            new Date(at.getTime() - (2 - reply) * 60000),
          ],
        );
      }
    }
    for (let index = 0; index < QA_VOLUME.studies; index++) {
      const id = `qa-volume-study-${index}`;
      const name = [
        'Cannon screens and the first rook lift',
        'Horse development in a quiet opening',
        'Keeping both rooks active after the opening',
        'A friendly rematch: two opening plans',
        'Central files and patient palace defence',
        'Four short lines for the evening study group',
      ][index]!;
      await client.query(
        `INSERT INTO studies (id,owner_id,name,description,visibility,updated_at)
         VALUES ($1,$2,$3,'Fictional local QA study. Generated legal opening moves.','public',$4)
         ON CONFLICT (id) DO UPDATE SET updated_at=EXCLUDED.updated_at`,
        [id, QA_PLAYERS[index % QA_PLAYERS.length]!.id, name, new Date(now - index * 60000)],
      );
      await client.query(
        `INSERT INTO study_chapters (id,study_id,ordinal,name,variant,orientation,root,denorm)
         VALUES ($1,$2,0,'Opening practice','xiangqi','red',$3::jsonb,$4::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [`${id}-chapter`, id, JSON.stringify(qaStudyRoot(index)), JSON.stringify({ plyCount: 4 })],
      );
    }
    const chat = [
      'Good evening! Anyone practising cannon openings?',
      'I have time for a friendly 5+5.',
      'That was a close finish. Good game!',
      'Going through the replay before a rematch.',
      'The study notes helped me spot the rook lift.',
      'Thanks for the games. See you tomorrow.',
    ];
    for (let index = 0; index < QA_VOLUME.chatLines; index++) {
      await client.query(
        `INSERT INTO chat_lines (id,room,author_account_id,body_text,created_at)
         VALUES ($1,'lobby',$2,$3,$4) ON CONFLICT (id) DO UPDATE SET created_at=EXCLUDED.created_at`,
        [
          `qa-volume-chat-${index}`,
          QA_PLAYERS[index % QA_PLAYERS.length]!.id,
          chat[index],
          new Date(now - (chat.length - index) * 60000),
        ],
      );
    }
    await client.query('COMMIT');
    return reviews;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
