// Study CRUD API (schema in migration 092; persistence in persistence-studies.ts).
// S2/S3 of the study track: single-author studies, owner-only writes, visibility-
// gated reads. No real-time collaboration — a chapter save carries the chapter
// `version` and loses to a concurrent writer with a 409 rather than clobbering.
//
//   POST   /api/studies                       create (auth) — study + first chapter
//   GET    /api/studies/mine                  list the signed-in owner's studies
//   GET    /api/studies/staff                 list staff-curated public studies
//   GET    /api/studies/:id                   read (public/unlisted: anyone; private: owner)
//   PATCH  /api/studies/:id                   update name/description/visibility (owner)
//   DELETE /api/studies/:id                   delete (owner)
//   POST   /api/studies/:id/chapters          add a chapter (owner)
//   PATCH  /api/studies/:id/chapters          reorder all chapters (owner)
//   PATCH  /api/studies/:id/chapters/:cid     save tree (version-guarded), rename, retag (owner)
//   DELETE /api/studies/:id/chapters/:cid     delete a chapter (owner; refuses the last)
//   PUT    /api/admin/studies/:id/featured    feature/unfeature a public study (admin)

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  initialStartFen,
  isStudyEligibleSpecId,
  parsePracticeGoal,
  startIsDealt,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import * as persistence from './../persistence.js';
import {
  readJsonBody,
  requireAdminSession,
  requireMethod,
  requirePersistence,
  TREE_JSON_BODY_LIMIT,
  writeJson,
} from './lib.js';

const ID = '[A-Za-z0-9]+';
const STUDY_PATH = new RegExp(`^/api/studies/(${ID})$`);
const CHAPTERS_PATH = new RegExp(`^/api/studies/(${ID})/chapters$`);
const CHAPTER_PATH = new RegExp(`^/api/studies/(${ID})/chapters/(${ID})$`);
const LIKE_PATH = new RegExp(`^/api/studies/(${ID})/like$`);
const FEATURED_PATH = new RegExp(`^/api/admin/studies/(${ID})/featured$`);
const SLUG_PATH = new RegExp(`^/api/admin/studies/(${ID})/slug$`);

function isSerializedTree(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const tree = value as { version?: unknown; root?: unknown };
  if (tree.version !== 1) return false;
  const root = tree.root as { children?: unknown } | null;
  return !!root && typeof root === 'object' && Array.isArray(root.children);
}

/** Read an `i18n` overlay off a request body. Anything that is not a plain
 *  object is treated as absent rather than rejected, so a client that omits or
 *  fumbles the field just gets no translations. */
function parseI18nField(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function studyView(study: persistence.StudyRecord, isOwner: boolean) {
  return {
    id: study.id,
    // Curated identity, when the study has one. The practice player uses it to
    // pick the piece its rail header illustrates.
    slug: study.slug,
    name: study.name,
    description: study.description,
    // Per-locale overrides; the client resolves against its current locale and
    // falls back to name/description (study-i18n.ts).
    i18n: study.i18n,
    visibility: study.visibility,
    featuredAt: study.featuredAt?.toISOString() ?? null,
    isOwner,
    createdAt: study.createdAt.toISOString(),
    updatedAt: study.updatedAt.toISOString(),
    // Public identity, already shown on every study card. The detail view needs
    // it so an exported PGN can name the author of the commentary it carries.
    ...(study.ownerHandle
      ? {
          owner: {
            handle: study.ownerHandle,
            displayName: study.ownerDisplayName ?? study.ownerHandle,
          },
        }
      : {}),
  };
}

// Public listing card view (All studies / Favorites): owner + likes on top of the
// base study view, so cards can show "♥ N · author · date".
function publicStudyView(study: persistence.PublicStudySummary) {
  return {
    ...studyView(study, false),
    chapterCount: study.chapterCount,
    // `chapterPreview` carries each chapter's i18n overlay so a card can localize
    // its chapter names the way the detail page does; `chapterNames` is the same
    // slice as bare strings, kept for clients cached before the overlay shipped.
    chapterPreview: study.chapterPreview,
    chapterNames: study.chapterNames,
    // Chapter 1's board for the card thumbnail; null when there is none to draw.
    previewBoard: study.previewBoard,
    owner: { handle: study.ownerHandle, displayName: study.ownerDisplayName },
    likeCount: study.likeCount,
  };
}

function parseLimit(params: URLSearchParams, fallback: number): number {
  const value = Number(params.get('limit'));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Banqi, jieqi and flip jungle have no standard opening: a chapter that stores
// only moves replays into a different deal every time it is opened, so it does
// not open at all. Every chapter of those variants therefore needs a root, and
// this is the one place that guarantees it rather than trusting each client
// path to remember. The create-study flow already mints one; the add-chapter
// flow did not, which shipped a study whose second chapter would not load.
export function ensureDealtRoot(variant: string, root: unknown): unknown {
  if (!startIsDealt(variant)) return root;
  if (
    root &&
    typeof root === 'object' &&
    typeof (root as { rootFen?: unknown }).rootFen === 'string'
  ) {
    return root;
  }
  const rootFen = initialStartFen(variant);
  return rootFen ? { ...(root as object), rootFen } : root;
}

function chapterView(chapter: persistence.StudyChapterRecord) {
  return {
    id: chapter.id,
    name: chapter.name,
    i18n: chapter.i18n,
    variant: chapter.variant,
    orientation: chapter.orientation,
    root: chapter.root,
    denorm: chapter.denorm,
    tags: chapter.tags,
    version: chapter.version,
    gamebook: chapter.gamebook,
    practice: chapter.practice,
    practiceGoal: chapter.practiceGoal,
  };
}

/**
 * PGN-style chapter tags off a request body. Whitelisted and length-capped: a
 * chapter tag renders straight into a player bar, so it is untrusted display
 * text like any other user field, and an open-ended object would let a client
 * store whatever it liked on our row.
 */
const CHAPTER_TAG_KEYS = ['red', 'black', 'result', 'event', 'date', 'round', 'site'] as const;
const CHAPTER_TAG_MAX = 120;

export function parseChapterTags(value: unknown): persistence.StudyChapterTags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const tags: Record<string, string> = {};
  for (const key of CHAPTER_TAG_KEYS) {
    const raw = source[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, CHAPTER_TAG_MAX);
    if (trimmed) tags[key] = trimmed;
  }
  return tags;
}

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const featuredMatch = FEATURED_PATH.exec(pathname);
  const slugMatch = SLUG_PATH.exec(pathname);
  if (
    pathname !== '/api/studies' &&
    !pathname.startsWith('/api/studies/') &&
    !featuredMatch &&
    !slugMatch
  ) {
    return false;
  }

  // ── Curated slug write (admin) ──
  // Admin-only because the slug is what the /practice catalogue points at:
  // a user able to set their own could claim a curated card's slot.
  if (slugMatch) {
    if (!requireMethod(request, response, 'PUT')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const body = await readJsonBody(request);
    const raw = typeof body.slug === 'string' ? body.slug.trim() : null;
    if (raw !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
      writeJson(response, 400, { error: 'invalid_slug' });
      return true;
    }
    const result = await persistence.setStudySlug(slugMatch[1]!, raw);
    if (!result.ok) {
      writeJson(response, result.error === 'slug_taken' ? 409 : 404, { error: result.error });
      return true;
    }
    writeJson(response, 200, { slug: result.study.slug });
    return true;
  }

  // ── Staff curation write ──
  if (featuredMatch) {
    if (!requireMethod(request, response, 'PUT')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    if (!requirePersistence(response)) return true;
    const body = await readJsonBody(request);
    if (typeof body.featured !== 'boolean') {
      writeJson(response, 400, { error: 'invalid_featured' });
      return true;
    }
    const result = await persistence.setStudyFeatured(featuredMatch[1]!, body.featured);
    if (!result.ok) {
      writeJson(response, result.error === 'not_public' ? 409 : 404, { error: result.error });
      return true;
    }
    writeJson(response, 200, {
      featuredAt: result.featuredAt?.toISOString() ?? null,
    });
    return true;
  }

  // ── Public collection ──
  if (pathname === '/api/studies/public') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    // ?limit lets the /study "All studies" browse ask for more than the homepage
    // widget's default 5. ?q filters by study name. listTopPublicStudies clamps.
    const params = new URL(request.url ?? '', 'http://localhost').searchParams;
    const studies = await persistence.listTopPublicStudies(
      parseLimit(params, 5),
      params.get('q') ?? undefined,
    );
    writeJson(response, 200, { studies: studies.map(publicStudyView) });
    return true;
  }

  // ── Staff picks: curated public studies ──
  if (pathname === '/api/studies/staff') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const params = new URL(request.url ?? '', 'http://localhost').searchParams;
    const studies = await persistence.listFeaturedStudies(
      parseLimit(params, 30),
      params.get('q') ?? undefined,
    );
    writeJson(response, 200, { studies: studies.map(publicStudyView) });
    return true;
  }

  // ── Favorites: public studies the signed-in user has liked ──
  if (pathname === '/api/studies/favorites') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const params = new URL(request.url ?? '', 'http://localhost').searchParams;
    const studies = await persistence.listFavoriteStudies(
      user.id,
      parseLimit(params, 30),
      params.get('q') ?? undefined,
    );
    writeJson(response, 200, { studies: studies.map(publicStudyView) });
    return true;
  }

  // ── Collection: create + list-mine ──
  if (pathname === '/api/studies' || pathname === '/api/studies/mine') {
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (pathname === '/api/studies/mine') {
      if (!requireMethod(request, response, 'GET')) return true;
      const q = new URL(request.url ?? '', 'http://localhost').searchParams.get('q') ?? undefined;
      const studies = await persistence.listStudiesForOwner(user.id, q);
      writeJson(response, 200, {
        studies: studies.map((s) => ({
          ...studyView(s, true),
          chapterCount: s.chapterCount,
          chapterPreview: s.chapterPreview,
          chapterNames: s.chapterNames,
          previewBoard: s.previewBoard,
        })),
      });
      return true;
    }
    if (!requireMethod(request, response, 'POST')) return true;
    return createStudy(request, response, user.id);
  }

  // ── Like a public study ──
  const likeMatch = LIKE_PATH.exec(pathname);
  if (likeMatch) {
    if (!requireMethod(request, response, 'PUT')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    if (typeof body.liked !== 'boolean') {
      writeJson(response, 400, { error: 'invalid_liked' });
      return true;
    }
    const state = await persistence.setStudyLike(likeMatch[1]!, user.id, body.liked);
    writeJson(response, state ? 200 : 404, state ?? { error: 'not_found' });
    return true;
  }

  // ── Add a chapter ──
  const chaptersMatch = CHAPTERS_PATH.exec(pathname);
  if (chaptersMatch) {
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (request.method === 'POST') return addChapter(request, response, chaptersMatch[1]!, user.id);
    if (request.method === 'PATCH') {
      const body = await readJsonBody(request);
      if (
        !Array.isArray(body.chapterIds) ||
        !body.chapterIds.every((id) => typeof id === 'string')
      ) {
        writeJson(response, 400, { error: 'invalid_chapter_order' });
        return true;
      }
      const result = await persistence.reorderStudyChapters(
        chaptersMatch[1]!,
        user.id,
        body.chapterIds,
      );
      if (!result.ok) {
        const status =
          result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : 409;
        writeJson(response, status, { error: result.error });
        return true;
      }
      writeJson(response, 200, { ok: true });
      return true;
    }
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  // ── Chapter: tree save / rename / delete ──
  const chapterMatch = CHAPTER_PATH.exec(pathname);
  if (chapterMatch) {
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const chapterId = chapterMatch[2]!;
    if (request.method === 'PATCH') return patchChapter(request, response, chapterId, user.id);
    if (request.method === 'DELETE') return removeChapter(response, chapterId, user.id);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  // ── Single study: read / meta update / delete ──
  const studyMatch = STUDY_PATH.exec(pathname);
  if (studyMatch) {
    const id = studyMatch[1]!;
    if (request.method === 'GET') return readStudy(request, response, id);
    if (request.method === 'PATCH') return updateMeta(request, response, id);
    if (request.method === 'DELETE') return deleteStudy(request, response, id);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  writeJson(response, 404, { error: 'not_found' });
  return true;
}

async function createStudy(
  request: IncomingMessage,
  response: ServerResponse,
  ownerId: string,
): Promise<boolean> {
  // Carries the first chapter's whole annotated tree.
  const body = await readJsonBody(request, TREE_JSON_BODY_LIMIT);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    writeJson(response, 400, { error: 'invalid_name' });
    return true;
  }
  const chapter = body.chapter as Record<string, unknown> | undefined;
  if (!chapter) {
    writeJson(response, 400, { error: 'missing_chapter' });
    return true;
  }
  const variant = typeof chapter.variant === 'string' ? chapter.variant : '';
  if (!isStudyEligibleSpecId(variant)) {
    writeJson(response, 400, { error: 'unsupported_variant' });
    return true;
  }
  if (!isSerializedTree(chapter.root)) {
    writeJson(response, 400, { error: 'invalid_tree' });
    return true;
  }
  const visibility = body.visibility;
  if (visibility !== undefined && !persistence.isStudyVisibility(visibility)) {
    writeJson(response, 400, { error: 'invalid_visibility' });
    return true;
  }
  const chapterName =
    typeof chapter.name === 'string' && chapter.name.trim() ? chapter.name.trim() : 'Chapter 1';
  const orientation = chapter.orientation === 'black' ? 'black' : 'red';
  const created = await persistence.createStudy({
    ownerId,
    name,
    description: typeof body.description === 'string' ? body.description : '',
    i18n: parseI18nField(body.i18n),
    visibility: persistence.isStudyVisibility(visibility) ? visibility : 'private',
    chapter: {
      name: chapterName,
      i18n: parseI18nField(chapter.i18n),
      variant,
      orientation,
      root: ensureDealtRoot(variant, chapter.root),
      denorm: chapter.denorm ?? {},
      tags: parseChapterTags(chapter.tags),
    },
  });
  if (!created) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return true;
  }
  writeJson(response, 201, {
    study: studyView(created, true),
    chapters: created.chapters.map(chapterView),
  });
  return true;
}

async function readStudy(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
): Promise<boolean> {
  if (!requirePersistence(response)) return true;
  const study = await persistence.getStudyById(id);
  const user = await currentAccountUser(request);
  const isOwner = !!user && !!study && study.ownerId === user.id;
  // Private studies are invisible to everyone but the owner (same 404-on-miss shape
  // so existence isn't leaked). Unlisted + public are readable by anyone with the id.
  if (!study || (study.visibility === 'private' && !isOwner)) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  const likeState = await persistence.getStudyLikeState(id, user?.id);
  // Which practice chapters this reader has solved, so the rail can tick them.
  // Asked only when the study actually has practice chapters and someone is
  // signed in -- a plain study should not pay for a progress query.
  const practiceChapterIds = study.chapters
    .filter((chapter) => chapter.practice)
    .map((chapter) => chapter.id);
  const solved =
    user && practiceChapterIds.length > 0
      ? await persistence.solvedChapterIds(user.id, practiceChapterIds)
      : new Set<string>();
  writeJson(response, 200, {
    study: {
      ...studyView(study, isOwner),
      ...likeState,
      canFeature: user?.accountRole === 'admin',
    },
    chapters: study.chapters.map((chapter) => ({
      ...chapterView(chapter),
      ...(solved.has(chapter.id) ? { solved: true } : {}),
    })),
  });
  return true;
}

async function addChapter(
  request: IncomingMessage,
  response: ServerResponse,
  studyId: string,
  ownerId: string,
): Promise<boolean> {
  const body = await readJsonBody(request, TREE_JSON_BODY_LIMIT);
  // A study is single-variant: the variant is fixed at create time and every
  // later chapter inherits it. The column stays per-chapter (it is what the board
  // dispatch reads), but the API is the enforcement point — a request may omit
  // `variant` entirely, and one that names a different variant is refused rather
  // than silently coerced.
  const study = await persistence.getStudyById(studyId);
  if (!study) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  const variant = study.chapters[0]?.variant ?? '';
  if (!isStudyEligibleSpecId(variant)) {
    writeJson(response, 400, { error: 'unsupported_variant' });
    return true;
  }
  if (typeof body.variant === 'string' && body.variant !== variant) {
    writeJson(response, 400, { error: 'variant_mismatch' });
    return true;
  }
  if (!isSerializedTree(body.root)) {
    writeJson(response, 400, { error: 'invalid_tree' });
    return true;
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'New chapter';
  const orientation = body.orientation === 'black' ? 'black' : 'red';
  const result = await persistence.addChapter(studyId, ownerId, {
    name,
    i18n: parseI18nField(body.i18n),
    variant,
    orientation,
    root: ensureDealtRoot(variant, body.root),
    denorm: body.denorm ?? {},
    tags: parseChapterTags(body.tags),
  });
  if (!result.ok) {
    writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
    return true;
  }
  writeJson(response, 201, { chapter: chapterView(result.chapter) });
  return true;
}

// PATCH a chapter: a `root` body saves the tree (version-guarded); `name` and/or
// `i18n` rename or retranslate it. A body may carry BOTH: the tree save used to
// return first and silently drop the metadata alongside it, which looked like a
// successful write that lost half the payload. Metadata is applied first so the
// tree save still owns the version guard and the response.
async function patchChapter(
  request: IncomingMessage,
  response: ServerResponse,
  chapterId: string,
  ownerId: string,
): Promise<boolean> {
  const body = await readJsonBody(request, TREE_JSON_BODY_LIMIT);
  // Orientation is applied first and does NOT return, so a body carrying both a
  // rename and a flip lands both. Returning here would reproduce the combined
  // name+root bug described above with different fields.
  let reorientedChapter: persistence.StudyChapterRecord | null = null;
  if (body.orientation === 'red' || body.orientation === 'black') {
    const result = await persistence.setChapterOrientation(chapterId, ownerId, body.orientation);
    if (!result.ok) {
      writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
      return true;
    }
    reorientedChapter = result.chapter;
  }
  // Tags follow orientation's shape: applied first, no early return, so a body
  // carrying tags alongside a tree save lands both. An explicit `{}` clears
  // them, which is the only way to remove a tag that should not be there.
  let retaggedChapter: persistence.StudyChapterRecord | null = null;
  if (body.tags !== undefined) {
    if (!body.tags || typeof body.tags !== 'object' || Array.isArray(body.tags)) {
      writeJson(response, 400, { error: 'invalid_tags' });
      return true;
    }
    const result = await persistence.setChapterTags(
      chapterId,
      ownerId,
      parseChapterTags(body.tags),
    );
    if (!result.ok) {
      writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
      return true;
    }
    retaggedChapter = result.chapter;
  }
  if ('root' in body && (typeof body.name === 'string' || parseI18nField(body.i18n))) {
    const combinedI18n = parseI18nField(body.i18n);
    const combinedName = typeof body.name === 'string' ? body.name.trim() : null;
    if (combinedName === '') {
      writeJson(response, 400, { error: 'invalid_name' });
      return true;
    }
    const meta = await persistence.renameChapter(chapterId, ownerId, combinedName, combinedI18n);
    if (!meta.ok) {
      writeJson(response, meta.error === 'forbidden' ? 403 : 404, { error: meta.error });
      return true;
    }
  }
  if ('root' in body) {
    if (!isSerializedTree(body.root)) {
      writeJson(response, 400, { error: 'invalid_tree' });
      return true;
    }
    const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined;
    const result = await persistence.updateChapterTree(chapterId, ownerId, {
      root: body.root,
      denorm: body.denorm,
      baseVersion,
    });
    if (!result.ok) {
      const status = result.error === 'forbidden' ? 403 : result.error === 'conflict' ? 409 : 404;
      writeJson(response, status, { error: result.error });
      return true;
    }
    writeJson(response, 200, { chapter: chapterView(result.chapter) });
    return true;
  }
  if (typeof body.gamebook === 'boolean') {
    const result = await persistence.setChapterGamebook(chapterId, ownerId, body.gamebook);
    if (!result.ok) {
      writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
      return true;
    }
    writeJson(response, 200, { chapter: chapterView(result.chapter) });
    return true;
  }
  if (typeof body.practice === 'boolean') {
    // The goal is validated HERE rather than trusted as free text, because it is
    // what decides whether a learner has won or lost. An unparseable goal that
    // reaches storage becomes a silent fallback later; lila's regex-with-default
    // is precisely how 27 of its practice chapters lost their authored goal.
    const rawGoal = typeof body.practiceGoal === 'string' ? body.practiceGoal.trim() : '';
    if (body.practice && !parsePracticeGoal(rawGoal)) {
      writeJson(response, 400, { error: 'invalid_goal' });
      return true;
    }
    const result = await persistence.setChapterPractice(
      chapterId,
      ownerId,
      body.practice,
      body.practice ? rawGoal : null,
    );
    if (!result.ok) {
      const status =
        result.error === 'forbidden' ? 403 : result.error === 'invalid_goal' ? 400 : 404;
      writeJson(response, status, { error: result.error });
      return true;
    }
    writeJson(response, 200, { chapter: chapterView(result.chapter) });
    return true;
  }
  // Rename and/or replace the chapter's locale overrides. An i18n-only body is
  // valid: translating a chapter should not require restating its base name.
  const chapterI18n = parseI18nField(body.i18n);
  if (typeof body.name === 'string' || chapterI18n !== undefined) {
    let name: string | null = null;
    if (typeof body.name === 'string') {
      name = body.name.trim();
      if (!name) {
        writeJson(response, 400, { error: 'invalid_name' });
        return true;
      }
    }
    const result = await persistence.renameChapter(chapterId, ownerId, name, chapterI18n);
    if (!result.ok) {
      writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
      return true;
    }
    writeJson(response, 200, { chapter: chapterView(result.chapter) });
    return true;
  }
  const applied = retaggedChapter ?? reorientedChapter;
  if (applied) {
    writeJson(response, 200, { chapter: chapterView(applied) });
    return true;
  }
  writeJson(response, 400, { error: 'nothing_to_update' });
  return true;
}

async function removeChapter(
  response: ServerResponse,
  chapterId: string,
  ownerId: string,
): Promise<boolean> {
  const result = await persistence.deleteChapter(chapterId, ownerId);
  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : result.error === 'last_chapter' ? 409 : 404;
    writeJson(response, status, { error: result.error });
    return true;
  }
  writeJson(response, 200, { ok: true });
  return true;
}

async function updateMeta(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
): Promise<boolean> {
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  if (body.visibility !== undefined && !persistence.isStudyVisibility(body.visibility)) {
    writeJson(response, 400, { error: 'invalid_visibility' });
    return true;
  }
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (name !== undefined && !name) {
    writeJson(response, 400, { error: 'invalid_name' });
    return true;
  }
  const result = await persistence.updateStudyMeta(id, user.id, {
    name,
    description: typeof body.description === 'string' ? body.description : undefined,
    i18n: parseI18nField(body.i18n),
    visibility: persistence.isStudyVisibility(body.visibility) ? body.visibility : undefined,
  });
  if (!result.ok) {
    writeJson(response, result.error === 'forbidden' ? 403 : 404, { error: result.error });
    return true;
  }
  writeJson(response, 200, { study: studyView(result.study, true) });
  return true;
}

async function deleteStudy(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
): Promise<boolean> {
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const deleted = await persistence.deleteStudy(id, user.id);
  writeJson(response, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'not_found' });
  return true;
}
