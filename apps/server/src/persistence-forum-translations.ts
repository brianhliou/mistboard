import { getPool } from './persistence-db.js';

// Cached machine translations of forum text (130). Keyed by content, not by
// row: see the migration header for why.

export type ForumTranslationLocale = 'en' | 'zh-Hans' | 'zh-Hant';
export type ForumTranslationSourceKind = 'topic' | 'post';

export type ForumTranslationSource = {
  kind: ForumTranslationSourceKind;
  id: string;
  text: string;
};

export type StoredForumTranslation = {
  translatedText: string;
  createdAt: Date;
};

// The visible source text for a topic title or post body. Hidden topics and
// hidden posts return null exactly as the public reads do, so the translate
// endpoint cannot be used to read moderated text back out.
export async function getForumTranslationSource(
  kind: ForumTranslationSourceKind,
  id: string,
): Promise<ForumTranslationSource | null> {
  const { rows } =
    kind === 'topic'
      ? await getPool().query<{ text: string }>(
          `SELECT title AS text FROM forum_topics WHERE id = $1 AND hidden_at IS NULL`,
          [id],
        )
      : await getPool().query<{ text: string }>(
          `SELECT p.body_text AS text
           FROM forum_posts p
           JOIN forum_topics t ON t.id = p.topic_id
           WHERE p.id = $1 AND p.hidden_at IS NULL AND t.hidden_at IS NULL`,
          [id],
        );
  const row = rows[0];
  if (!row) return null;
  return { kind, id, text: row.text };
}

export async function getForumTranslation(key: {
  contentHash: string;
  targetLocale: ForumTranslationLocale;
  model: string;
}): Promise<StoredForumTranslation | null> {
  const { rows } = await getPool().query<{ translated_text: string; created_at: Date }>(
    `SELECT translated_text, created_at
     FROM forum_translations
     WHERE content_hash = $1 AND target_locale = $2 AND model = $3`,
    [key.contentHash, key.targetLocale, key.model],
  );
  const row = rows[0];
  if (!row) return null;
  return { translatedText: row.translated_text, createdAt: row.created_at };
}

// Batch read for list surfaces: every stored translation of any of `contentHashes`
// into `targetLocale`, newest row per hash, whatever model wrote it. Reads
// deliberately ignore the model: a model bump changes what the NEXT miss
// writes, it should not make every list fall back to the source language until
// each post is asked for again. Rows the table has none for are simply absent.
export async function listForumTranslations(input: {
  contentHashes: readonly string[];
  targetLocale: ForumTranslationLocale;
}): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (input.contentHashes.length === 0) return found;
  const { rows } = await getPool().query<{ content_hash: string; translated_text: string }>(
    `SELECT DISTINCT ON (content_hash) content_hash, translated_text
     FROM forum_translations
     WHERE content_hash = ANY($1::text[]) AND target_locale = $2
     ORDER BY content_hash, created_at DESC`,
    [Array.from(new Set(input.contentHashes)), input.targetLocale],
  );
  for (const row of rows) found.set(row.content_hash, row.translated_text);
  return found;
}

// Two concurrent misses for the same key may both reach here; the first write
// wins and the second is a no-op, which is fine because both translated the
// same text with the same model.
export async function putForumTranslation(input: {
  contentHash: string;
  targetLocale: ForumTranslationLocale;
  model: string;
  translatedText: string;
  source: { kind: ForumTranslationSourceKind; id: string };
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO forum_translations
       (content_hash, target_locale, model, translated_text, source_kind, source_id,
        input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (content_hash, target_locale, model) DO NOTHING`,
    [
      input.contentHash,
      input.targetLocale,
      input.model,
      input.translatedText,
      input.source.kind,
      input.source.id,
      input.inputTokens,
      input.outputTokens,
    ],
  );
}
