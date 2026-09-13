// Persistence for user-created studies (schema in migration 092). A study owns an
// ordered set of chapters; each chapter carries a serialized move tree (JSONB) plus
// a `version` optimistic-concurrency token. Single-author for now: every write is
// gated on ownership at the route; the version guard here is what lets a future
// multi-contributor step stay safe without live sync (study-track.md, Decision A).
// All reads/writes no-op (null / no-op) when persistence is disabled.

import { randomBytes } from 'node:crypto';
import { getPool, isInitialized } from './persistence-db.js';
import {
  STUDY_PREVIEW_PLIES,
  type StudyPreviewBoard,
  studyPreviewBoard,
} from './study-preview-board.js';

export type StudyVisibility = 'private' | 'unlisted' | 'public';

export function isStudyVisibility(value: unknown): value is StudyVisibility {
  return value === 'private' || value === 'unlisted' || value === 'public';
}

export type StudyChapterRecord = {
  id: string;
  studyId: string;
  ordinal: number;
  name: string;
  /** Per-locale overrides for `name` (see migration 115). Base column is the
   *  fallback, so a partial translation degrades one string at a time. */
  i18n: Record<string, unknown>;
  variant: string;
  orientation: string;
  /** SerializedTree (tree-serialize.ts); node-pg parses JSONB, so already an object. */
  root: unknown;
  denorm: unknown;
  /** PGN-style tag pairs (who had Red, the result, the event). See StudyChapterTags. */
  tags: StudyChapterTags;
  version: number;
  /** Gamebook (interactive-lesson) chapter: the guess-the-move player is the
   *  default presentation. Same tree data; per-node hint/deviation live in it. */
  gamebook: boolean;
  /** Practice (engine-adjudicated) chapter: played from the root position against
   *  the engine, which also grades. The tree is IGNORED — unlike a gamebook, the
   *  exercise is the position plus `practiceGoal`, not an authored line. */
  practice: boolean;
  /** Authored goal text ("mate in 3", "win", "draw in 20"); parsed by
   *  parsePracticeGoal. Non-null whenever `practice` is true (DB CHECK). */
  practiceGoal: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StudyRecord = {
  id: string;
  ownerId: string;
  /** Stable curated identity (migration 132). Null for user-created studies;
   *  set by a seeder so the /practice catalogue can name a study without
   *  depending on its generated id or its editable name. */
  slug: string | null;
  /** Present only where the query joined `users`. The detail read does (so an
   *  export can credit the author); the owner's own listing does not need it. */
  ownerHandle?: string;
  ownerDisplayName?: string;
  name: string;
  description: string;
  /** Per-locale overrides for `name`/`description` (see migration 115). */
  i18n: Record<string, unknown>;
  visibility: StudyVisibility;
  featuredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StudyWithChapters = StudyRecord & { chapters: StudyChapterRecord[] };

/** One row of a study card's chapter preview. Carries the chapter's `i18n`
 *  overlay alongside the base name: a card renders chapter names, so it needs the
 *  same per-locale data the detail page already gets from `chapterView`. */
export type StudyChapterPreview = { name: string; i18n: Record<string, unknown> };

/** `chapterPreview` is a preview slice (first few by ordinal), not the full set —
 *  enough to render lichess-style chapter previews on a study card. `chapterNames`
 *  is the base-name projection of that same slice, kept for callers (and cached
 *  clients) that predate the overlay. */
export type StudySummary = StudyRecord & {
  chapterCount: number;
  chapterPreview: StudyChapterPreview[];
  chapterNames: string[];
  /** Chapter 1's board for the card thumbnail (study-preview-board.ts); null
   *  when the variant has no derivation yet or the chapter is unreadable. */
  previewBoard: StudyPreviewBoard | null;
};

export type PublicStudySummary = StudySummary & {
  ownerHandle: string;
  ownerDisplayName: string;
  likeCount: number;
};

/**
 * PGN-style tag pairs for a chapter. Authored or imported, never derived, which
 * is what separates this from `denorm`. A study of a real game needs these to
 * say who had Red; without them the only place identity can live is the chapter
 * title, and a title cannot follow a board flip.
 */
export type StudyChapterTags = {
  red?: string;
  black?: string;
  /** PGN result token: '1-0' | '0-1' | '1/2-1/2' | '*'. */
  result?: string;
  event?: string;
  /** ISO-8601 or PGN's own YYYY.MM.DD; stored as given. */
  date?: string;
  round?: string;
  site?: string;
};

export type NewChapterInput = {
  name: string;
  /** Optional per-locale overrides for `name`. */
  i18n?: Record<string, unknown>;
  variant: string;
  orientation: string;
  root: unknown;
  denorm?: unknown;
  tags?: StudyChapterTags;
};

export type CreateStudyInput = {
  ownerId: string;
  /** Curated identity (migration 132). Seeders set it; the UI never does. */
  slug?: string;
  name: string;
  description: string;
  /** Optional per-locale overrides for `name`/`description`. */
  i18n?: Record<string, unknown>;
  visibility: StudyVisibility;
  chapter: NewChapterInput;
};

export type UpdateChapterResult =
  | { ok: true; chapter: StudyChapterRecord }
  | { ok: false; error: 'not_found' | 'forbidden' | 'conflict' | 'invalid_goal' };

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Short lila-style base62 id (8 chars ≈ 62^8 space). Not cryptographic identity,
 *  just a compact unguessable-enough handle for unlisted sharing. */
function shortId(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return out;
}

type StudyRow = {
  id: string;
  owner_id: string;
  slug: string | null;
  owner_handle?: string;
  owner_display_name?: string;
  name: string;
  description: string;
  i18n: Record<string, unknown>;
  visibility: StudyVisibility;
  featured_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ChapterRow = {
  id: string;
  study_id: string;
  ordinal: number;
  name: string;
  i18n: Record<string, unknown>;
  variant: string;
  orientation: string;
  root: unknown;
  denorm: unknown;
  tags: StudyChapterTags;
  version: number;
  gamebook: boolean;
  practice: boolean;
  practice_goal: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapStudy(row: StudyRow): StudyRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug ?? null,
    ...(row.owner_handle ? { ownerHandle: row.owner_handle } : {}),
    ...(row.owner_display_name ? { ownerDisplayName: row.owner_display_name } : {}),
    name: row.name,
    description: row.description,
    i18n: row.i18n ?? {},
    visibility: row.visibility,
    featuredAt: row.featured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapter(row: ChapterRow): StudyChapterRecord {
  return {
    id: row.id,
    studyId: row.study_id,
    ordinal: row.ordinal,
    name: row.name,
    i18n: row.i18n ?? {},
    variant: row.variant,
    orientation: row.orientation,
    root: row.root,
    denorm: row.denorm,
    tags: row.tags ?? {},
    version: row.version,
    gamebook: row.gamebook,
    practice: row.practice,
    practiceGoal: row.practice_goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STUDY_COLS =
  'id, owner_id, slug, name, description, i18n, visibility, featured_at, created_at, updated_at';
const CHAPTER_COLS =
  'id, study_id, ordinal, name, i18n, variant, orientation, root, denorm, tags, version, gamebook, practice, practice_goal, created_at, updated_at';

/** Correlated scalar subquery yielding the first few chapters (by ordinal) as a
 *  jsonb array of `{name, i18n}`, for a study aliased `s`. This is the preview
 *  slice a study card shows, not the full chapter set. The `i18n` overlay rides
 *  along because cards render chapter names and must localize them the same way
 *  the detail page does. */
const CHAPTER_PREVIEW = `(SELECT jsonb_agg(jsonb_build_object('name', name, 'i18n', i18n)
                   ORDER BY ordinal, created_at)
         FROM (SELECT name, i18n, ordinal, created_at FROM study_chapters
                WHERE study_id = s.id ORDER BY ordinal, created_at LIMIT 4) preview) AS chapter_preview`;

/** Chapter 1's thumbnail source, for a study aliased `s`: its variant, its
 *  hand-set `rootFen` (null for a game from the standard start) and the first
 *  STUDY_PREVIEW_PLIES mainline plies, walked down the first-child chain of the
 *  serialized tree. Derivation into a board happens in study-preview-board.ts;
 *  the query only lifts the few fields it needs so the list never ships or
 *  even reads a whole annotated game blob per row. */
const PREVIEW_BOARD = `(SELECT jsonb_build_object(
            'variant', c.variant,
            'rootFen', c.root->>'rootFen',
            'mainline', (WITH RECURSIVE walk(node, depth) AS (
                           SELECT c.root->'root'->'children'->0, 1
                            UNION ALL
                           SELECT node->'children'->0, depth + 1 FROM walk
                            WHERE node IS NOT NULL AND depth < ${STUDY_PREVIEW_PLIES})
                         SELECT coalesce(jsonb_agg(node->>'uci' ORDER BY depth), '[]'::jsonb)
                           FROM walk WHERE node IS NOT NULL))
           FROM study_chapters c WHERE c.study_id = s.id
          ORDER BY c.ordinal, c.created_at LIMIT 1) AS preview_board`;

/** Normalize the `chapter_preview` jsonb into the summary's two projections.
 *  Defensive about row shape: a malformed element degrades to "no preview row"
 *  rather than putting `undefined` through a card renderer. */
function mapChapterPreview(raw: unknown): {
  chapterPreview: StudyChapterPreview[];
  chapterNames: string[];
} {
  const rows = Array.isArray(raw) ? raw : [];
  const chapterPreview: StudyChapterPreview[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, i18n } = entry as { name?: unknown; i18n?: unknown };
    if (typeof name !== 'string') continue;
    chapterPreview.push({
      name,
      i18n:
        i18n && typeof i18n === 'object' && !Array.isArray(i18n)
          ? (i18n as Record<string, unknown>)
          : {},
    });
  }
  return { chapterPreview, chapterNames: chapterPreview.map((c) => c.name) };
}

/** Optional `AND s.name ILIKE $n` fragment for a search query, with `%`/`_`/`\`
 *  escaped so a literal search term can't act as a wildcard. Returns an empty
 *  clause (and no bound value) when the query is blank. */
function nameFilter(q: string | undefined, paramIndex: number): { clause: string; value?: string } {
  const trimmed = q?.trim();
  if (!trimmed) return { clause: '' };
  const escaped = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return { clause: ` AND s.name ILIKE $${paramIndex}`, value: `%${escaped}%` };
}

type PublicStudyRow = StudyRow & {
  chapter_count: string;
  chapter_preview: unknown;
  preview_board: unknown;
  owner_handle: string;
  owner_display_name: string;
  like_count: string;
};

function mapPublicStudy(row: PublicStudyRow): PublicStudySummary {
  return {
    ...mapStudy(row),
    chapterCount: Number(row.chapter_count),
    ...mapChapterPreview(row.chapter_preview),
    previewBoard: studyPreviewBoard(row.preview_board),
    ownerHandle: row.owner_handle,
    ownerDisplayName: row.owner_display_name,
    likeCount: Number(row.like_count),
  };
}

/** Create a study and its first chapter atomically. Returns the full record. */
export async function createStudy(input: CreateStudyInput): Promise<StudyWithChapters | null> {
  if (!isInitialized()) return null;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const studyId = shortId();
    await client.query(
      `INSERT INTO studies (id, owner_id, slug, name, description, i18n, visibility)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        studyId,
        input.ownerId,
        input.slug ?? null,
        input.name,
        input.description,
        JSON.stringify(input.i18n ?? {}),
        input.visibility,
      ],
    );
    await client.query(
      `INSERT INTO study_chapters
         (id, study_id, ordinal, name, i18n, variant, orientation, root, denorm, tags)
         VALUES ($1, $2, 0, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
      [
        shortId(),
        studyId,
        input.chapter.name,
        JSON.stringify(input.chapter.i18n ?? {}),
        input.chapter.variant,
        input.chapter.orientation,
        JSON.stringify(input.chapter.root),
        JSON.stringify(input.chapter.denorm ?? {}),
        JSON.stringify(input.chapter.tags ?? {}),
      ],
    );
    await client.query('COMMIT');
    return getStudyById(studyId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getStudyById(id: string): Promise<StudyWithChapters | null> {
  if (!isInitialized()) return null;
  // Joined to `users` so the detail view can name the author: an exported PGN
  // credits whoever wrote the commentary, and a URL alone cannot do that offline.
  const study = await getPool().query<StudyRow>(
    `SELECT ${STUDY_COLS.split(', ')
      .map((column) => `s.${column}`)
      .join(', ')},
            u.handle AS owner_handle,
            u.display_name AS owner_display_name
       FROM studies s
       JOIN users u ON u.id = s.owner_id
      WHERE s.id = $1`,
    [id],
  );
  const row = study.rows[0];
  if (!row) return null;
  const chapters = await getPool().query<ChapterRow>(
    `SELECT ${CHAPTER_COLS} FROM study_chapters WHERE study_id = $1 ORDER BY ordinal, created_at`,
    [id],
  );
  return { ...mapStudy(row), chapters: chapters.rows.map(mapChapter) };
}

/** One curated practice study, as the /practice index needs it. */
export type PracticeStudySummary = {
  slug: string;
  id: string;
  name: string;
  description: string;
  i18n: Record<string, unknown>;
  /** Chapters in practice mode. This is the card's "N exercises", and it counts
   *  practice chapters rather than all chapters so a stray note chapter in a
   *  curated study cannot inflate it. */
  exerciseCount: number;
};

/**
 * Resolve curated slugs to studies, in ONE query rather than per card.
 *
 * Private studies are skipped: the index is a public page, and a curated slug
 * pointing at something unpublished should render as a missing card rather than
 * leak a title. The caller decides what to do about a slug that resolves to
 * nothing -- the honest options are to omit the card or to show it disabled,
 * never to silently renumber the section.
 */
export async function getPracticeStudiesBySlug(
  slugs: readonly string[],
): Promise<PracticeStudySummary[]> {
  if (!isInitialized() || slugs.length === 0) return [];
  const { rows } = await getPool().query<{
    slug: string;
    id: string;
    name: string;
    description: string;
    i18n: Record<string, unknown> | null;
    exercise_count: string;
  }>(
    `SELECT s.slug, s.id, s.name, s.description, s.i18n,
            (SELECT count(*) FROM study_chapters c
               WHERE c.study_id = s.id AND c.practice) AS exercise_count
       FROM studies s
      WHERE s.slug = ANY($1::text[])
        AND s.visibility <> 'private'`,
    [[...slugs]],
  );
  return rows.map((row) => ({
    slug: row.slug,
    id: row.id,
    name: row.name,
    description: row.description,
    i18n: row.i18n ?? {},
    exerciseCount: Number.parseInt(row.exercise_count, 10) || 0,
  }));
}

export async function listStudiesForOwner(ownerId: string, q?: string): Promise<StudySummary[]> {
  if (!isInitialized()) return [];
  const filter = nameFilter(q, 2);
  const params: unknown[] = [ownerId];
  if (filter.value !== undefined) params.push(filter.value);
  const { rows } = await getPool().query<
    StudyRow & { chapter_count: string; chapter_preview: unknown; preview_board: unknown }
  >(
    `SELECT ${STUDY_COLS.split(', ')
      .map((c) => `s.${c}`)
      .join(', ')},
       (SELECT count(*) FROM study_chapters c WHERE c.study_id = s.id) AS chapter_count,
       ${CHAPTER_PREVIEW},
       ${PREVIEW_BOARD}
       FROM studies s WHERE s.owner_id = $1${filter.clause} ORDER BY s.updated_at DESC`,
    params,
  );
  return rows.map((row) => ({
    ...mapStudy(row),
    chapterCount: Number(row.chapter_count),
    ...mapChapterPreview(row.chapter_preview),
    previewBoard: studyPreviewBoard(row.preview_board),
  }));
}

/** Most-liked public studies, with recency as the deterministic tie-breaker.
 *  `q` filters by study name (case-insensitive substring). */
export async function listTopPublicStudies(limit = 5, q?: string): Promise<PublicStudySummary[]> {
  if (!isInitialized()) return [];
  const bounded = Math.max(1, Math.min(limit, 50));
  const filter = nameFilter(q, 2);
  const params: unknown[] = [bounded];
  if (filter.value !== undefined) params.push(filter.value);
  const { rows } = await getPool().query<PublicStudyRow>(
    `SELECT ${STUDY_COLS.split(', ')
      .map((column) => `s.${column}`)
      .join(', ')},
            u.handle AS owner_handle,
            u.display_name AS owner_display_name,
            count(DISTINCT c.id) AS chapter_count,
            count(DISTINCT l.user_id) AS like_count,
            ${CHAPTER_PREVIEW},
            ${PREVIEW_BOARD}
       FROM studies s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN study_chapters c ON c.study_id = s.id
       LEFT JOIN study_likes l ON l.study_id = s.id
      WHERE s.visibility = 'public'
        AND u.profile_visibility IN ('public', 'unlisted')${filter.clause}
      GROUP BY s.id, u.handle, u.display_name
      ORDER BY count(DISTINCT l.user_id) DESC, s.updated_at DESC, s.id
      LIMIT $1`,
    params,
  );
  return rows.map(mapPublicStudy);
}

/** Staff-curated public studies, newest selection first. A pick remains invisible
 * if its study or owner is no longer publicly listable. */
export async function listFeaturedStudies(limit = 30, q?: string): Promise<PublicStudySummary[]> {
  if (!isInitialized()) return [];
  const bounded = Math.max(1, Math.min(limit, 50));
  const filter = nameFilter(q, 2);
  const params: unknown[] = [bounded];
  if (filter.value !== undefined) params.push(filter.value);
  const { rows } = await getPool().query<PublicStudyRow>(
    `SELECT ${STUDY_COLS.split(', ')
      .map((column) => `s.${column}`)
      .join(', ')},
            u.handle AS owner_handle,
            u.display_name AS owner_display_name,
            count(DISTINCT c.id) AS chapter_count,
            count(DISTINCT l.user_id) AS like_count,
            ${CHAPTER_PREVIEW},
            ${PREVIEW_BOARD}
       FROM studies s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN study_chapters c ON c.study_id = s.id
       LEFT JOIN study_likes l ON l.study_id = s.id
      WHERE s.visibility = 'public'
        AND s.featured_at IS NOT NULL
        AND u.profile_visibility IN ('public', 'unlisted')${filter.clause}
      GROUP BY s.id, u.handle, u.display_name
      ORDER BY s.featured_at DESC, s.updated_at DESC, s.id
      LIMIT $1`,
    params,
  );
  return rows.map(mapPublicStudy);
}

export type SetStudyFeaturedResult =
  | { ok: true; featuredAt: Date | null }
  | { ok: false; error: 'not_found' | 'not_public' };

/** Admin-facing curation write. Re-selecting a current pick is idempotent and
 * preserves its ordering timestamp; private/unlisted studies fail closed. */
/**
 * Set (or clear) a study's curated slug. ADMIN-ONLY at the route layer.
 *
 * Privileged on purpose: the slug is what the /practice catalogue points at, so
 * a user able to set their own would be able to take over a curated card by
 * claiming its slug. Uniqueness is enforced by the index from migration 132; a
 * collision surfaces here as a rejected write rather than a silent swap.
 */
export async function setStudySlug(
  studyId: string,
  slug: string | null,
): Promise<{ ok: true; study: StudyRecord } | { ok: false; error: 'not_found' | 'slug_taken' }> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  if (slug) {
    const clash = await getPool().query<{ id: string }>(
      'SELECT id FROM studies WHERE slug = $1 AND id <> $2',
      [slug, studyId],
    );
    if (clash.rows[0]) return { ok: false, error: 'slug_taken' };
  }
  const { rows } = await getPool().query<StudyRow>(
    `UPDATE studies SET slug = $1, updated_at = now() WHERE id = $2 RETURNING ${STUDY_COLS}`,
    [slug, studyId],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  return { ok: true, study: mapStudy(row) };
}

export async function setStudyFeatured(
  studyId: string,
  featured: boolean,
): Promise<SetStudyFeaturedResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const existing = await getPool().query<{ visibility: StudyVisibility }>(
    `SELECT visibility FROM studies WHERE id = $1`,
    [studyId],
  );
  const study = existing.rows[0];
  if (!study) return { ok: false, error: 'not_found' };
  if (featured && study.visibility !== 'public') return { ok: false, error: 'not_public' };
  const { rows } = await getPool().query<{ featured_at: Date | null }>(
    `UPDATE studies
        SET featured_at = CASE
          WHEN $2::boolean THEN COALESCE(featured_at, now())
          ELSE NULL
        END
      WHERE id = $1
      RETURNING featured_at`,
    [studyId, featured],
  );
  return { ok: true, featuredAt: rows[0]!.featured_at };
}

/** Public studies the signed-in user has liked (their favorites). Same shape as the
 *  public index, filtered to studies still public + from listable profiles, so a
 *  later visibility flip can't leak a now-private study through a stale like. */
export async function listFavoriteStudies(
  userId: string,
  limit = 30,
  q?: string,
): Promise<PublicStudySummary[]> {
  if (!isInitialized()) return [];
  const bounded = Math.max(1, Math.min(limit, 50));
  const filter = nameFilter(q, 3);
  const params: unknown[] = [userId, bounded];
  if (filter.value !== undefined) params.push(filter.value);
  const { rows } = await getPool().query<PublicStudyRow>(
    `SELECT ${STUDY_COLS.split(', ')
      .map((column) => `s.${column}`)
      .join(', ')},
            u.handle AS owner_handle,
            u.display_name AS owner_display_name,
            count(DISTINCT c.id) AS chapter_count,
            count(DISTINCT l.user_id) AS like_count,
            ${CHAPTER_PREVIEW},
            ${PREVIEW_BOARD}
       FROM study_likes fav
       JOIN studies s ON s.id = fav.study_id
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN study_chapters c ON c.study_id = s.id
       LEFT JOIN study_likes l ON l.study_id = s.id
      WHERE fav.user_id = $1
        AND s.visibility = 'public'
        AND u.profile_visibility IN ('public', 'unlisted')${filter.clause}
      GROUP BY s.id, u.handle, u.display_name
      ORDER BY s.updated_at DESC, s.id
      LIMIT $2`,
    params,
  );
  return rows.map(mapPublicStudy);
}

export async function getStudyLikeState(
  studyId: string,
  userId?: string,
): Promise<{ likeCount: number; likedByViewer: boolean }> {
  if (!isInitialized()) return { likeCount: 0, likedByViewer: false };
  const { rows } = await getPool().query<{ like_count: string; liked_by_viewer: boolean }>(
    `SELECT count(*) AS like_count,
            COALESCE(bool_or(user_id = $2), false) AS liked_by_viewer
       FROM study_likes
      WHERE study_id = $1`,
    [studyId, userId ?? ''],
  );
  return {
    likeCount: Number(rows[0]?.like_count ?? 0),
    likedByViewer: rows[0]?.liked_by_viewer ?? false,
  };
}

/** Set, rather than toggle, so retries are idempotent. Only public studies can
 * receive likes. Returns null when the study is absent or not public. */
export async function setStudyLike(
  studyId: string,
  userId: string,
  liked: boolean,
): Promise<{ likeCount: number; likedByViewer: boolean } | null> {
  if (!isInitialized()) return null;
  const visible = await getPool().query(
    `SELECT 1 FROM studies WHERE id = $1 AND visibility = 'public'`,
    [studyId],
  );
  if ((visible.rowCount ?? 0) === 0) return null;
  if (liked) {
    await getPool().query(
      `INSERT INTO study_likes (study_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [studyId, userId],
    );
  } else {
    await getPool().query(`DELETE FROM study_likes WHERE study_id = $1 AND user_id = $2`, [
      studyId,
      userId,
    ]);
  }
  return getStudyLikeState(studyId, userId);
}

/** Owner-checked, version-guarded save of a chapter's tree. A stale `baseVersion`
 *  loses to whoever wrote last → 'conflict' (the caller tells the user to reload). */
export async function updateChapterTree(
  chapterId: string,
  ownerId: string,
  patch: { root: unknown; denorm?: unknown; baseVersion?: number },
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string; version: number; study_id: string }>(
    `SELECT s.owner_id, c.version, c.study_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  if (patch.baseVersion !== undefined && patch.baseVersion !== found.version) {
    return { ok: false, error: 'conflict' };
  }
  const now = new Date();
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters
       SET root = $1::jsonb,
           denorm = COALESCE($2::jsonb, denorm),
           version = version + 1,
           updated_at = $3
       WHERE id = $4
     RETURNING ${CHAPTER_COLS}`,
    [
      JSON.stringify(patch.root),
      patch.denorm === undefined ? null : JSON.stringify(patch.denorm),
      now,
      chapterId,
    ],
  );
  await getPool().query(`UPDATE studies SET updated_at = $1 WHERE id = $2`, [now, found.study_id]);
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}

export type UpdateStudyMetaResult =
  | { ok: true; study: StudyRecord }
  | { ok: false; error: 'not_found' | 'forbidden' };

export async function updateStudyMeta(
  id: string,
  ownerId: string,
  patch: {
    name?: string;
    description?: string;
    i18n?: Record<string, unknown>;
    visibility?: StudyVisibility;
  },
): Promise<UpdateStudyMetaResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const existing = await getPool().query<StudyRow>(
    `SELECT ${STUDY_COLS} FROM studies WHERE id = $1`,
    [id],
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<StudyRow>(
    `UPDATE studies
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           i18n = COALESCE($3::jsonb, i18n),
           visibility = COALESCE($4, visibility),
           featured_at = CASE
             WHEN COALESCE($4, visibility) = 'public' THEN featured_at
             ELSE NULL
           END,
           updated_at = now()
       WHERE id = $5
     RETURNING ${STUDY_COLS}`,
    [
      patch.name ?? null,
      patch.description ?? null,
      patch.i18n === undefined ? null : JSON.stringify(patch.i18n),
      patch.visibility ?? null,
      id,
    ],
  );
  return { ok: true, study: mapStudy(updated.rows[0]!) };
}

/** Owner-checked hard delete (chapters cascade). Returns false if absent/not owner. */
export async function deleteStudy(id: string, ownerId: string): Promise<boolean> {
  if (!isInitialized()) return false;
  const { rowCount } = await getPool().query(
    `DELETE FROM studies WHERE id = $1 AND owner_id = $2`,
    [id, ownerId],
  );
  return (rowCount ?? 0) > 0;
}

export type AddChapterResult =
  | { ok: true; chapter: StudyChapterRecord }
  | { ok: false; error: 'not_found' | 'forbidden' };

/** Append a chapter to a study (owner only). Ordinal = current max + 1. */
export async function addChapter(
  studyId: string,
  ownerId: string,
  input: NewChapterInput,
): Promise<AddChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const owner = await getPool().query<{ owner_id: string }>(
    `SELECT owner_id FROM studies WHERE id = $1`,
    [studyId],
  );
  const row = owner.rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const now = new Date();
  const inserted = await getPool().query<ChapterRow>(
    `INSERT INTO study_chapters
       (id, study_id, ordinal, name, i18n, variant, orientation, root, denorm, tags)
       VALUES ($1, $2,
               (SELECT COALESCE(MAX(ordinal), -1) + 1 FROM study_chapters WHERE study_id = $2),
               $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
     RETURNING ${CHAPTER_COLS}`,
    [
      shortId(),
      studyId,
      input.name,
      JSON.stringify(input.i18n ?? {}),
      input.variant,
      input.orientation,
      JSON.stringify(input.root),
      JSON.stringify(input.denorm ?? {}),
      JSON.stringify(input.tags ?? {}),
    ],
  );
  await getPool().query(`UPDATE studies SET updated_at = $1 WHERE id = $2`, [now, studyId]);
  return { ok: true, chapter: mapChapter(inserted.rows[0]!) };
}

export type DeleteChapterResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'forbidden' | 'last_chapter' };

export type ReorderStudyChaptersResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'forbidden' | 'invalid_order' };

/** Replace a study's complete chapter order. Requiring the exact current ID set
 * prevents a stale browser from silently dropping a newly-added chapter. */
export async function reorderStudyChapters(
  studyId: string,
  ownerId: string,
  chapterIds: string[],
): Promise<ReorderStudyChaptersResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const study = await getPool().query<{ owner_id: string }>(
    `SELECT owner_id FROM studies WHERE id = $1`,
    [studyId],
  );
  const found = study.rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const existing = await getPool().query<{ id: string }>(
    `SELECT id FROM study_chapters WHERE study_id = $1 ORDER BY ordinal, created_at`,
    [studyId],
  );
  const existingIds = existing.rows.map((row) => row.id);
  if (
    chapterIds.length !== existingIds.length ||
    new Set(chapterIds).size !== chapterIds.length ||
    chapterIds.some((id) => !existingIds.includes(id))
  ) {
    return { ok: false, error: 'invalid_order' };
  }
  await getPool().query(
    `UPDATE study_chapters AS chapter
       SET ordinal = ordering.ordinal - 1,
           updated_at = now()
      FROM unnest($1::text[]) WITH ORDINALITY AS ordering(id, ordinal)
      WHERE chapter.study_id = $2 AND chapter.id = ordering.id`,
    [chapterIds, studyId],
  );
  await getPool().query(`UPDATE studies SET updated_at = now() WHERE id = $1`, [studyId]);
  return { ok: true };
}

/** Delete a chapter (owner only). Refuses to remove the last chapter — a study
 *  always has at least one. */
export async function deleteChapter(
  chapterId: string,
  ownerId: string,
): Promise<DeleteChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string; study_id: string }>(
    `SELECT s.owner_id, c.study_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const count = await getPool().query<{ n: string }>(
    `SELECT count(*) AS n FROM study_chapters WHERE study_id = $1`,
    [found.study_id],
  );
  if (Number(count.rows[0]?.n ?? 0) <= 1) return { ok: false, error: 'last_chapter' };
  await getPool().query(`DELETE FROM study_chapters WHERE id = $1`, [chapterId]);
  await getPool().query(`UPDATE studies SET updated_at = now() WHERE id = $1`, [found.study_id]);
  return { ok: true };
}

/** Rename a chapter (owner only), optionally replacing its locale overrides.
 *  Does not touch the tree `version`. */
export async function renameChapter(
  chapterId: string,
  ownerId: string,
  name: string | null,
  i18n?: Record<string, unknown>,
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string }>(
    `SELECT s.owner_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters
       SET name = COALESCE($1, name),
           i18n = COALESCE($2::jsonb, i18n),
           updated_at = now()
     WHERE id = $3
     RETURNING ${CHAPTER_COLS}`,
    [name, i18n === undefined ? null : JSON.stringify(i18n), chapterId],
  );
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}

/**
 * Replace a chapter's PGN-style tags (owner).
 *
 * Tags were write-once at chapter creation: no PATCH accepted them and the study
 * UI has no editor for them, so a chapter imported with a missing or wrong
 * player name was wrong permanently and the only repair was deleting the
 * chapter and losing its id. A whole nine-chapter study was created with its
 * tags silently dropped, which is what surfaced this.
 *
 * Whole-object replacement rather than a merge, because the caller holds the
 * complete tag set and a merge gives no way to CLEAR a tag that should not have
 * been there. Sanitizing to the allowlist stays in the route, alongside the same
 * sanitizing the create path does.
 */
export async function setChapterTags(
  chapterId: string,
  ownerId: string,
  tags: StudyChapterTags,
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string }>(
    `SELECT s.owner_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters SET tags = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING ${CHAPTER_COLS}`,
    [JSON.stringify(tags), chapterId],
  );
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}

/** Flip a chapter between vanilla and gamebook (interactive-lesson) mode (owner). */
/** Set which side the chapter's board faces on open. Stored per chapter rather
 *  than per reader: a black repertoire is authored to be read from black's side,
 *  so the orientation belongs to the document, not to whoever opened it. */
export async function setChapterOrientation(
  chapterId: string,
  ownerId: string,
  orientation: 'red' | 'black',
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string }>(
    `SELECT s.owner_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters SET orientation = $1, updated_at = now() WHERE id = $2 RETURNING ${CHAPTER_COLS}`,
    [orientation, chapterId],
  );
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}

export async function setChapterGamebook(
  chapterId: string,
  ownerId: string,
  gamebook: boolean,
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  const { rows } = await getPool().query<{ owner_id: string }>(
    `SELECT s.owner_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters SET gamebook = $1, updated_at = now() WHERE id = $2 RETURNING ${CHAPTER_COLS}`,
    [gamebook, chapterId],
  );
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}

/**
 * Flip a chapter between vanilla and practice (engine-adjudicated) mode (owner).
 *
 * The goal moves with the flag on purpose. A practice chapter without a goal is
 * not a half-configured exercise, it is an exercise with no way to be won or
 * lost, and lila's separate-fields arrangement is exactly how 27 of its chapters
 * ended up silently defaulting. Turning practice OFF clears the goal rather than
 * leaving it behind as dead data the next author would have to notice.
 */
export async function setChapterPractice(
  chapterId: string,
  ownerId: string,
  practice: boolean,
  goal: string | null,
): Promise<UpdateChapterResult> {
  if (!isInitialized()) return { ok: false, error: 'not_found' };
  if (practice && !goal) return { ok: false, error: 'invalid_goal' };
  const { rows } = await getPool().query<{ owner_id: string }>(
    `SELECT s.owner_id
       FROM study_chapters c JOIN studies s ON s.id = c.study_id
       WHERE c.id = $1`,
    [chapterId],
  );
  const found = rows[0];
  if (!found) return { ok: false, error: 'not_found' };
  if (found.owner_id !== ownerId) return { ok: false, error: 'forbidden' };
  const updated = await getPool().query<ChapterRow>(
    `UPDATE study_chapters SET practice = $1, practice_goal = $2, updated_at = now()
       WHERE id = $3 RETURNING ${CHAPTER_COLS}`,
    [practice, practice ? goal : null, chapterId],
  );
  return { ok: true, chapter: mapChapter(updated.rows[0]!) };
}
