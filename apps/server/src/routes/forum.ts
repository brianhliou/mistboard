import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import { clientIpForRateLimit, createAuthRateLimiter } from './../auth-rate-limit.js';
import { forumTranslationEnabled } from './../feature-flags.js';
import { forumExcerpt } from './../forum-excerpt.js';
import {
  createAnthropicTranslationClient,
  createForumTranslationService,
  DEFAULT_BREAKER,
  DEFAULT_DAILY_MISS_CAP,
  type ForumTranslationService,
  forumContentHash,
  isTranslationLocale,
  TRANSLATION_LOCALES,
  type TranslationLocale,
  translationNeeded,
} from './../forum-translation.js';
import { logger } from './../obs.js';
import * as persistence from './../persistence.js';
import { onlinePresence } from './../presence.js';
import {
  hashIp,
  readJsonBody,
  requireAdminSession,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

const titleMinLength = 3;
const titleMaxLength = 120;
const bodyMaxLength = 5000;
const moderationReasonMaxLength = 240;
const postPageSize = 25;
const topicWindowMs = 10 * 60 * 1000;
const topicLimitPerWindow = 3;
const postWindowMs = 10 * 60 * 1000;
const postLimitPerWindow = 12;
// Watch toggles and topic read receipts: one click or one page view each. Per
// account, in memory; generous for a human, tight enough to stop a toggle loop.
const forumWatchLimiter = createAuthRateLimiter(120, 60 * 60 * 1000);
// Translation cache MISSES only (a hit is a DB read and is free to serve).
// Per account for signed-in readers, per client IP for anonymous ones; the
// anonymous budget is the smaller because it is the one a script would use.
const translationMissLimiterByAccount = createAuthRateLimiter(40, 60 * 60 * 1000);
const translationMissLimiterByIp = createAuthRateLimiter(10, 60 * 60 * 1000);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

let forumTranslationService: ForumTranslationService | null = null;
function translationService(): ForumTranslationService {
  forumTranslationService ??= createForumTranslationService({
    client: createAnthropicTranslationClient({
      model: process.env.MISTBOARD_FORUM_TRANSLATION_MODEL || undefined,
    }),
    loadSource: persistence.getForumTranslationSource,
    getCached: persistence.getForumTranslation,
    store: persistence.putForumTranslation,
    dailyMissCap: envInt('MISTBOARD_FORUM_TRANSLATION_DAILY_CAP', DEFAULT_DAILY_MISS_CAP),
    breaker: {
      threshold: envInt('MISTBOARD_FORUM_TRANSLATION_BREAKER_THRESHOLD', DEFAULT_BREAKER.threshold),
      cooldownMs: envInt(
        'MISTBOARD_FORUM_TRANSLATION_BREAKER_COOLDOWN_MS',
        DEFAULT_BREAKER.cooldownMs,
      ),
    },
    // One line per model call: the spend ledger. Cache hits are silent.
    onMiss: ({ kind: source, ...event }) => {
      const log = event.outcome === 'ok' ? logger.info.bind(logger) : logger.warn.bind(logger);
      log({ kind: 'forum_translation_miss', source, ...event }, 'forum translation model call');
    },
  });
  return forumTranslationService;
}

// ── Cached translations on read surfaces ────────────────────────────────────
//
// A list or topic read carries whatever the translation cache ALREADY holds
// for the reader's locale (`?locale=`), keyed here by source text. Nothing on
// this path asks the model: a read never spends, never meters, and shows the
// source language for anything not yet cached. The cache is filled by the
// Translate button and by the warm below.

type TranslationOverlay = ReadonlyMap<string, string>;
const NO_OVERLAY: TranslationOverlay = new Map();

function requestedLocale(parsedUrl: URL): TranslationLocale | null {
  const raw = parsedUrl.searchParams.get('locale');
  return isTranslationLocale(raw) ? raw : null;
}

async function translationOverlay(
  locale: TranslationLocale | null,
  texts: Iterable<string>,
): Promise<TranslationOverlay> {
  if (!locale || !forumTranslationEnabled()) return NO_OVERLAY;
  const textByHash = new Map<string, string>();
  for (const text of texts) {
    if (!text || !translationNeeded(text, locale)) continue;
    textByHash.set(forumContentHash(text), text);
  }
  if (textByHash.size === 0) return NO_OVERLAY;
  const found = await persistence.listForumTranslations({
    contentHashes: [...textByHash.keys()],
    targetLocale: locale,
  });
  const overlay = new Map<string, string>();
  for (const [hash, translated] of found) {
    const text = textByHash.get(hash);
    if (text) overlay.set(text, translated);
  }
  return overlay;
}

// Fill the cache for a new or edited text so the lists can show it translated
// before any reader has asked. Fire-and-forget after the response. Bypasses
// the author's per-caller meter (writing is already rate limited) but not the
// daily cap or the breaker, and the feature flag turns it off with the rest.
function warmForumTranslation(kind: 'topic' | 'post', id: string, text: string): void {
  if (!forumTranslationEnabled()) return;
  for (const target of TRANSLATION_LOCALES) {
    if (!translationNeeded(text, target)) continue;
    translationService()
      .translate({ kind, id, target, meter: () => true })
      .catch((error: unknown) => {
        logger.warn({ kind: 'forum_translation_warm_failed', source: kind, id, target, error });
      });
  }
}

type ForumTopicJson = {
  id: string;
  slug: string;
  title: string;
  category: persistence.ForumTopicSummary['category'];
  author: persistence.ForumAuthor;
  latestPost: {
    post: {
      id: string;
    };
    author: persistence.ForumAuthor;
    createdAt: string;
    excerpt: string;
  } | null;
  postCount: number;
  pinned: boolean;
  locked: boolean;
  pinnedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastPostAt: string;
  /** Cached machine translations into the requested `?locale=`, when the
   *  cache has them (absent otherwise, and absent without a locale). */
  translated?: { title?: string; excerpt?: string };
};

type ForumCategoryJson = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Per-locale name/description (migration 135). The client resolves it; the
   *  server does not, because the reader's locale is a stored client preference
   *  and /forum takes no locale path prefix for the server to read it from. */
  i18n: Record<string, unknown>;
  sortOrder: number;
  topicWritePolicy: persistence.ForumTopicWritePolicy;
  topicCount: number;
  postCount: number;
  latestPost: {
    post: {
      id: string;
    };
    topic: {
      id: string;
      slug: string;
      title: string;
      postCount: number;
      translatedTitle?: string;
    };
    author: persistence.ForumAuthor;
    createdAt: string;
  } | null;
};

// Post authors carry a soft "online now" presence flag (in-memory, TTL-based).
// Other author surfaces (topic rows, latest-post, search) stay presence-free.
type ForumAuthorJson = (NonNullable<persistence.ForumAuthor> & { online: boolean }) | null;

type ForumPostJson = {
  id: string;
  author: ForumAuthorJson;
  bodyText: string;
  createdAt: string;
  updatedAt: string;
  hidden: boolean;
  hiddenAt: string | null;
  /** Cached machine translation of the body into the requested locale. */
  translated?: string;
};

type ForumPostSearchJson = {
  post: {
    id: string;
    page: number;
    snippet: string;
  };
  topic: persistence.ForumPostSearchResult['topic'];
  author: persistence.ForumAuthor;
  createdAt: string;
};

type ForumReportJson = {
  id: string;
  status: persistence.ForumReportStatus;
  targetType: persistence.ForumReport['targetType'];
  reason: string;
  resolutionNote: string | null;
  reporter: persistence.ForumAuthor;
  resolver: persistence.ForumAuthor;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  topic: {
    id: string;
    slug: string;
    title: string;
    category: {
      slug: string;
      name: string;
      i18n: Record<string, unknown>;
    };
    hidden: boolean;
  };
  post: {
    id: string;
    page: number;
    snippet: string;
    author: persistence.ForumAuthor;
    createdAt: string;
    hidden: boolean;
  } | null;
};

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/forum/categories') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const categories = await persistence.listForumCategories();
    const overlay = await translationOverlay(
      requestedLocale(parsedUrl),
      categories.map((category) => category.latestPost?.topic.title ?? ''),
    );
    writeJson(response, 200, {
      categories: categories.map((category) => serializeCategory(category, overlay)),
    });
    return true;
  }

  if (pathname === '/api/forum/search') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const query = normalizeSearchQuery(parsedUrl.searchParams.get('q'));
    const results = query
      ? await persistence.searchForumPosts({
          query,
          limit: clampInt(parsedUrl.searchParams.get('limit'), 20, 1, 50),
          offset: clampInt(parsedUrl.searchParams.get('offset'), 0, 0, 10_000),
        })
      : { posts: [], total: 0 };
    writeJson(response, 200, {
      posts: results.posts.map(serializePostSearchResult),
      total: results.total,
    });
    return true;
  }

  if (pathname === '/api/forum/latest-posts') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const posts = await persistence.listLatestForumPosts({
      limit: clampInt(parsedUrl.searchParams.get('limit'), 8, 1, 20),
    });
    writeJson(response, 200, { posts: posts.map(serializePostSearchResult) });
    return true;
  }

  if (pathname === '/api/forum/reports') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const status = normalizeReportStatusFilter(parsedUrl.searchParams.get('status'));
    if (!status) {
      writeJson(response, 400, { error: 'invalid_status' });
      return true;
    }
    const reports = await persistence.listForumReports({
      status,
      limit: clampInt(parsedUrl.searchParams.get('limit'), 50, 1, 100),
      offset: clampInt(parsedUrl.searchParams.get('offset'), 0, 0, 10_000),
    });
    writeJson(response, 200, { reports: reports.map(serializeReport) });
    return true;
  }

  const reportMatch = pathname.match(/^\/api\/forum\/reports\/([^/]+)$/);
  if (reportMatch) {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    return resolveReport(request, response, decodeURIComponent(reportMatch[1]!));
  }

  if (pathname === '/api/forum/topics') {
    if (!requirePersistence(response)) return true;
    const method = request.method ?? 'GET';
    if (method === 'GET') {
      const topics = await persistence.listForumTopics({
        categorySlug: parsedUrl.searchParams.get('category'),
        limit: clampInt(parsedUrl.searchParams.get('limit'), 20, 1, 50),
        offset: clampInt(parsedUrl.searchParams.get('offset'), 0, 0, 10_000),
      });
      const overlay = await translationOverlay(
        requestedLocale(parsedUrl),
        topics.flatMap((topic) => [topic.title, topic.latestPost?.bodyText ?? '']),
      );
      writeJson(response, 200, {
        topics: topics.map((topic) => serializeTopicSummary(topic, overlay)),
      });
      return true;
    }
    if (method === 'POST') return createTopic(request, response);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  const topicReportMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/report$/);
  if (topicReportMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return createTopicReport(request, response, decodeURIComponent(topicReportMatch[1]!));
  }

  const topicWatchMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/watch$/);
  if (topicWatchMatch) {
    if (!requirePersistence(response)) return true;
    return setTopicWatch(request, response, decodeURIComponent(topicWatchMatch[1]!));
  }

  const topicSeenMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/seen$/);
  if (topicSeenMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return markTopicSeen(request, response, decodeURIComponent(topicSeenMatch[1]!));
  }

  const postsMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/posts$/);
  if (postsMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return createPost(request, response, decodeURIComponent(postsMatch[1]!));
  }

  const topicModerationMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/moderation$/);
  if (topicModerationMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return moderateTopic(request, response, decodeURIComponent(topicModerationMatch[1]!));
  }

  const topicCategoryMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)\/category$/);
  if (topicCategoryMatch) {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    return moveTopic(request, response, decodeURIComponent(topicCategoryMatch[1]!));
  }

  const postMatch = pathname.match(/^\/api\/forum\/posts\/([^/]+)$/);
  if (postMatch) {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    return updatePost(request, response, decodeURIComponent(postMatch[1]!));
  }

  if (pathname === '/api/forum/translate') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return translateForumText(request, response);
  }

  const postRedirectMatch = pathname.match(/^\/api\/forum\/posts\/([^/]+)\/redirect$/);
  if (postRedirectMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const location = await persistence.getForumPostLocation(
      decodeURIComponent(postRedirectMatch[1]!),
      {
        pageSize: postPageSize,
      },
    );
    if (!location) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { href: forumPostHref(location) });
    return true;
  }

  const postReportMatch = pathname.match(/^\/api\/forum\/posts\/([^/]+)\/report$/);
  if (postReportMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return createPostReport(request, response, decodeURIComponent(postReportMatch[1]!));
  }

  const postModerationMatch = pathname.match(/^\/api\/forum\/posts\/([^/]+)\/moderation$/);
  if (postModerationMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    return moderatePost(request, response, decodeURIComponent(postModerationMatch[1]!));
  }

  const topicMatch = pathname.match(/^\/api\/forum\/topics\/([^/]+)$/);
  if (topicMatch) {
    if (!requirePersistence(response)) return true;
    const method = request.method ?? 'GET';
    const topicId = decodeURIComponent(topicMatch[1]!);
    if (method === 'GET') {
      const postLimitParam = parsedUrl.searchParams.get('limit');
      // Public read, but a signed-in viewer also gets their own watch state so
      // the topic page can render the Watch button without a second request.
      const viewer = await currentAccountUser(request);
      const topic = await persistence.getForumTopic(topicId, {
        postLimit: postLimitParam === null ? undefined : clampInt(postLimitParam, 100, 1, 100),
        postOffset: clampInt(parsedUrl.searchParams.get('offset'), 0, 0, 10_000),
        viewerAccountId: viewer?.id ?? null,
      });
      if (!topic) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      const overlay = await translationOverlay(requestedLocale(parsedUrl), [
        topic.title,
        ...topic.posts.map((post) => post.bodyText),
      ]);
      writeJson(response, 200, { topic: serializeTopicDetail(topic, overlay) });
      return true;
    }
    if (method === 'PATCH') return updateTopic(request, response, topicId);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  return false;
}

// POST /api/forum/translate { kind: 'topic' | 'post', id, locale }
// Public like the reads it translates. Takes ids, never text: the source is
// re-read from the forum tables with the same hidden-row gate as the page.
async function translateForumText(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!forumTranslationEnabled()) {
    writeJson(response, 503, { error: 'translation_unavailable' });
    return true;
  }
  const body = await readJsonBody(request);
  const kind = body.kind === 'topic' || body.kind === 'post' ? body.kind : null;
  const id =
    typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 80 ? body.id : null;
  const locale = isTranslationLocale(body.locale) ? body.locale : null;
  if (!kind || !id || !locale) {
    writeJson(response, 400, { error: 'invalid_request' });
    return true;
  }
  const user = await currentAccountUser(request);
  const meter = user
    ? () => translationMissLimiterByAccount.check(`acct:${user.id}`)
    : () => translationMissLimiterByIp.check(`ip:${hashIp(clientIpForRateLimit(request))}`);

  const result = await translationService().translate({ kind, id, target: locale, meter });
  switch (result.status) {
    case 'ok':
      writeJson(response, 200, { text: result.text, cached: result.cached, locale });
      return true;
    case 'not_found':
      writeJson(response, 404, { error: 'not_found' });
      return true;
    case 'same_language':
      writeJson(response, 409, { error: 'same_language' });
      return true;
    case 'rate_limited':
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    case 'capped':
      writeJson(response, 429, { error: 'daily_cap_reached' });
      return true;
    case 'failed':
      if (result.code === 'paused') {
        writeJson(response, 503, { error: 'translation_paused' });
        return true;
      }
      writeJson(response, 502, { error: 'translation_failed', code: result.code });
      return true;
  }
}

async function createTopic(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const since = new Date(Date.now() - topicWindowMs);
  if ((await persistence.countRecentForumTopicsByUser(user.id, since)) >= topicLimitPerWindow) {
    writeJson(response, 429, { error: 'rate_limited' });
    return true;
  }

  const body = await readJsonBody(request);
  const categorySlug = normalizeSlug(
    typeof body.categorySlug === 'string' ? body.categorySlug : '',
  );
  if (!categorySlug) {
    writeJson(response, 400, { error: 'invalid_category' });
    return true;
  }
  const title = normalizeTitle(typeof body.title === 'string' ? body.title : '');
  if (!title) {
    writeJson(response, 400, { error: 'invalid_title' });
    return true;
  }
  const bodyText = normalizeBodyText(typeof body.body === 'string' ? body.body : '');
  if (!bodyText) {
    writeJson(response, 400, { error: 'invalid_body' });
    return true;
  }

  const now = new Date();
  const result = await persistence.createForumTopic({
    id: `topic_${randomUUID()}`,
    postId: `post_${randomUUID()}`,
    categorySlug,
    authorAccountId: user.id,
    authorRole: user.accountRole,
    title,
    slug: slugifyTitle(title),
    bodyText,
    now,
  });
  if (!result.ok) {
    const status = result.error === 'category_not_found' ? 400 : 403;
    writeJson(response, status, { error: result.error });
    return true;
  }
  writeJson(response, 201, { topic: serializeTopicDetail(result.topic) });
  warmForumTranslation('topic', result.topic.id, title);
  const opening = result.topic.posts[0];
  if (opening) warmForumTranslation('post', opening.id, opening.bodyText);
  return true;
}

async function createPost(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const since = new Date(Date.now() - postWindowMs);
  if ((await persistence.countRecentForumPostsByUser(user.id, since)) >= postLimitPerWindow) {
    writeJson(response, 429, { error: 'rate_limited' });
    return true;
  }

  const body = await readJsonBody(request);
  const bodyText = normalizeBodyText(typeof body.body === 'string' ? body.body : '');
  if (!bodyText) {
    writeJson(response, 400, { error: 'invalid_body' });
    return true;
  }
  const result = await persistence.addForumPost({
    id: `post_${randomUUID()}`,
    topicId,
    authorAccountId: user.id,
    bodyText,
    now: new Date(),
    quotedPostIds: parseQuotedPostIds(body.quotedPostIds),
  });
  if (!result.ok) {
    writeJson(response, result.error === 'topic_not_found' ? 404 : 423, { error: result.error });
    return true;
  }
  writeJson(response, 201, { post: serializePost(result.post) });
  warmForumTranslation('post', result.post.id, bodyText);
  return true;
}

// PUT = watch, DELETE = unwatch, both idempotent. Returns the viewer's fresh
// state so the button can render without refetching the topic.
async function setTopicWatch(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  const method = request.method ?? 'GET';
  if (method !== 'PUT' && method !== 'DELETE') {
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  if (!forumWatchLimiter.check(user.id)) {
    writeJson(response, 429, { error: 'rate_limited' });
    return true;
  }
  const result =
    method === 'PUT'
      ? await persistence.watchForumTopic({ accountId: user.id, topicId, now: new Date() })
      : await persistence.unwatchForumTopic({ accountId: user.id, topicId });
  if (!result.ok) {
    writeJson(response, 404, { error: result.error });
    return true;
  }
  writeJson(response, 200, { watching: result.watching });
  return true;
}

// The topic page's read receipt: advances the viewer's per-topic watermark so
// the bell stops counting the replies they have now scrolled past. A no-op for
// non-watchers, so the client may call it unconditionally.
async function markTopicSeen(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  if (!forumWatchLimiter.check(user.id)) {
    writeJson(response, 429, { error: 'rate_limited' });
    return true;
  }
  await persistence.markForumTopicSeen({ accountId: user.id, topicId, now: new Date() });
  writeJson(response, 200, { ok: true });
  return true;
}

async function createTopicReport(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  const reason = normalizeRequiredReason(typeof body.reason === 'string' ? body.reason : '');
  if (!reason) {
    writeJson(response, 400, { error: 'invalid_reason' });
    return true;
  }
  const result = await persistence.createForumTopicReport({
    id: `forum_report_${randomUUID()}`,
    topicId,
    reporterAccountId: user.id,
    reason,
    now: new Date(),
  });
  if (!result.ok) {
    const status =
      result.error === 'topic_not_found' ? 404 : result.error === 'already_reported' ? 409 : 403;
    writeJson(response, status, { error: result.error });
    return true;
  }
  writeJson(response, 201, { report: serializeReport(result.report) });
  return true;
}

async function createPostReport(
  request: IncomingMessage,
  response: ServerResponse,
  postId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  const reason = normalizeRequiredReason(typeof body.reason === 'string' ? body.reason : '');
  if (!reason) {
    writeJson(response, 400, { error: 'invalid_reason' });
    return true;
  }
  const result = await persistence.createForumPostReport({
    id: `forum_report_${randomUUID()}`,
    postId,
    reporterAccountId: user.id,
    reason,
    now: new Date(),
  });
  if (!result.ok) {
    const status =
      result.error === 'post_not_found' ? 404 : result.error === 'already_reported' ? 409 : 403;
    writeJson(response, status, { error: result.error });
    return true;
  }
  writeJson(response, 201, { report: serializeReport(result.report) });
  return true;
}

async function updateTopic(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  const title = normalizeTitle(typeof body.title === 'string' ? body.title : '');
  if (!title) {
    writeJson(response, 400, { error: 'invalid_title' });
    return true;
  }
  const result = await persistence.updateForumTopic({
    topicId,
    editorAccountId: user.id,
    editorRole: user.accountRole,
    title,
    slug: slugifyTitle(title),
    now: new Date(),
  });
  if (!result.ok) {
    writeJson(response, result.error === 'topic_not_found' ? 404 : 403, { error: result.error });
    return true;
  }
  writeJson(response, 200, { topic: serializeTopicDetail(result.topic) });
  warmForumTranslation('topic', result.topic.id, title);
  return true;
}

async function moveTopic(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  if (!(await requireAdminSession(request, response))) return true;
  const body = await readJsonBody(request);
  const categorySlug = normalizeSlug(
    typeof body.categorySlug === 'string' ? body.categorySlug : '',
  );
  if (!categorySlug) {
    writeJson(response, 400, { error: 'invalid_category' });
    return true;
  }
  const result = await persistence.moveForumTopic({
    topicId,
    categorySlug,
    now: new Date(),
  });
  if (!result.ok) {
    writeJson(response, result.error === 'topic_not_found' ? 404 : 400, { error: result.error });
    return true;
  }
  writeJson(response, 200, { topic: serializeTopicDetail(result.topic) });
  return true;
}

async function updatePost(
  request: IncomingMessage,
  response: ServerResponse,
  postId: string,
): Promise<boolean> {
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  const bodyText = normalizeBodyText(typeof body.body === 'string' ? body.body : '');
  if (!bodyText) {
    writeJson(response, 400, { error: 'invalid_body' });
    return true;
  }
  const result = await persistence.updateForumPost({
    postId,
    editorAccountId: user.id,
    editorRole: user.accountRole,
    bodyText,
    now: new Date(),
  });
  if (!result.ok) {
    const status =
      result.error === 'post_not_found' ? 404 : result.error === 'topic_locked' ? 423 : 403;
    writeJson(response, status, { error: result.error });
    return true;
  }
  writeJson(response, 200, { post: serializePost(result.post) });
  warmForumTranslation('post', result.post.id, bodyText);
  return true;
}

async function moderateTopic(
  request: IncomingMessage,
  response: ServerResponse,
  topicId: string,
): Promise<boolean> {
  if (!(await requireAdminSession(request, response))) return true;
  const user = await currentAccountUser(request);
  const body = await readJsonBody(request);
  const action = normalizeTopicModerationAction(body.action);
  if (!action) {
    writeJson(response, 400, { error: 'invalid_action' });
    return true;
  }
  const reason = normalizeModerationReason(typeof body.reason === 'string' ? body.reason : null);
  if (reason === false) {
    writeJson(response, 400, { error: 'invalid_reason' });
    return true;
  }
  const result = await persistence.moderateForumTopic({
    topicId,
    moderatorAccountId: user?.id ?? null,
    action,
    reason,
    now: new Date(),
  });
  if (!result.ok) {
    writeJson(response, 404, { error: result.error });
    return true;
  }
  writeJson(response, 200, {
    ok: true,
    ...(result.topic ? { topic: serializeTopicDetail(result.topic) } : {}),
  });
  return true;
}

async function moderatePost(
  request: IncomingMessage,
  response: ServerResponse,
  postId: string,
): Promise<boolean> {
  if (!(await requireAdminSession(request, response))) return true;
  const user = await currentAccountUser(request);
  const body = await readJsonBody(request);
  if (body.action !== 'hide') {
    writeJson(response, 400, { error: 'invalid_action' });
    return true;
  }
  const reason = normalizeModerationReason(typeof body.reason === 'string' ? body.reason : null);
  if (reason === false) {
    writeJson(response, 400, { error: 'invalid_reason' });
    return true;
  }
  const result = await persistence.hideForumPost({
    postId,
    moderatorAccountId: user?.id ?? null,
    reason,
    now: new Date(),
  });
  if (!result.ok) {
    writeJson(response, 404, { error: result.error });
    return true;
  }
  writeJson(response, 200, { ok: true, topicHidden: result.topicHidden });
  return true;
}

async function resolveReport(
  request: IncomingMessage,
  response: ServerResponse,
  reportId: string,
): Promise<boolean> {
  if (!(await requireAdminSession(request, response))) return true;
  const user = await currentAccountUser(request);
  const body = await readJsonBody(request);
  const status = normalizeReportResolutionStatus(body.status);
  if (!status) {
    writeJson(response, 400, { error: 'invalid_status' });
    return true;
  }
  const resolutionNote = normalizeModerationReason(
    typeof body.resolutionNote === 'string' ? body.resolutionNote : null,
  );
  if (resolutionNote === false) {
    writeJson(response, 400, { error: 'invalid_resolution_note' });
    return true;
  }
  const result = await persistence.resolveForumReport({
    reportId,
    moderatorAccountId: user?.id ?? null,
    status,
    resolutionNote,
    now: new Date(),
  });
  if (!result.ok) {
    writeJson(response, 404, { error: result.error });
    return true;
  }
  writeJson(response, 200, { report: serializeReport(result.report) });
  return true;
}

function serializeCategory(
  category: persistence.ForumCategory,
  overlay: TranslationOverlay = NO_OVERLAY,
): ForumCategoryJson {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    i18n: category.i18n,
    sortOrder: category.sortOrder,
    topicWritePolicy: category.topicWritePolicy,
    topicCount: category.topicCount,
    postCount: category.postCount,
    latestPost: category.latestPost
      ? {
          post: category.latestPost.post,
          topic: {
            ...category.latestPost.topic,
            translatedTitle: overlay.get(category.latestPost.topic.title),
          },
          author: category.latestPost.author,
          createdAt: category.latestPost.createdAt.toISOString(),
        }
      : null,
  };
}

function serializeTopicDetail(
  topic: persistence.ForumTopicDetail,
  overlay: TranslationOverlay = NO_OVERLAY,
): ForumTopicJson & {
  posts: ForumPostJson[];
  viewer: { watching: boolean } | null;
  // Whether the page should offer Translate buttons (130); the route itself
  // 503s when this is false, so the client never has to guess.
  translation: { available: boolean };
} {
  const online = onlineHandleSet();
  return {
    ...serializeTopicSummary(topic, overlay),
    posts: topic.posts.map((post) => serializePost(post, online, overlay)),
    viewer: topic.viewer,
    translation: { available: forumTranslationEnabled() },
  };
}

// Lowercased handles of accounts seen recently, excluding private profiles
// (same visibility gate as /api/players/online). Soft signal; a miss just
// renders the author as offline.
function onlineHandleSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of onlinePresence()) {
    if (entry.profileVisibility === 'private') continue;
    set.add(entry.handle.toLowerCase());
  }
  return set;
}

function authorWithPresence(
  author: persistence.ForumAuthor,
  online: Set<string> | undefined,
): ForumAuthorJson {
  if (!author) return null;
  return { ...author, online: online?.has(author.handle.toLowerCase()) ?? false };
}

function serializeTopicSummary(
  topic: persistence.ForumTopicSummary,
  overlay: TranslationOverlay = NO_OVERLAY,
): ForumTopicJson {
  const translatedTitle = overlay.get(topic.title);
  const translatedBody = topic.latestPost ? overlay.get(topic.latestPost.bodyText) : undefined;
  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    category: topic.category,
    author: topic.author,
    latestPost: topic.latestPost
      ? {
          post: topic.latestPost.post,
          author: topic.latestPost.author,
          createdAt: topic.latestPost.createdAt.toISOString(),
          excerpt: topic.latestPost.excerpt,
        }
      : null,
    postCount: topic.postCount,
    pinned: topic.pinnedAt !== null,
    locked: topic.lockedAt !== null,
    pinnedAt: topic.pinnedAt?.toISOString() ?? null,
    lockedAt: topic.lockedAt?.toISOString() ?? null,
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString(),
    lastPostAt: topic.lastPostAt.toISOString(),
    translated:
      translatedTitle || translatedBody
        ? {
            title: translatedTitle,
            // The cached translation is of the whole post; the excerpt is cut
            // from it the same way the source excerpt is.
            excerpt: translatedBody ? forumExcerpt(translatedBody) : undefined,
          }
        : undefined,
  };
}

function serializePost(
  post: persistence.ForumPost,
  online?: Set<string>,
  overlay: TranslationOverlay = NO_OVERLAY,
): ForumPostJson {
  return {
    id: post.id,
    author: authorWithPresence(post.author, online),
    bodyText: post.bodyText,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    hidden: post.hiddenAt !== null,
    hiddenAt: post.hiddenAt?.toISOString() ?? null,
    translated: overlay.get(post.bodyText),
  };
}

function serializePostSearchResult(result: persistence.ForumPostSearchResult): ForumPostSearchJson {
  return {
    post: result.post,
    topic: result.topic,
    author: result.author,
    createdAt: result.createdAt.toISOString(),
  };
}

function serializeReport(report: persistence.ForumReport): ForumReportJson {
  return {
    id: report.id,
    status: report.status,
    targetType: report.targetType,
    reason: report.reason,
    resolutionNote: report.resolutionNote,
    reporter: report.reporter,
    resolver: report.resolver,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    topic: {
      id: report.topic.id,
      slug: report.topic.slug,
      title: report.topic.title,
      category: report.topic.category,
      hidden: report.topic.hiddenAt !== null,
    },
    post: report.post
      ? {
          id: report.post.id,
          page: report.post.page,
          snippet: report.post.snippet,
          author: report.post.author,
          createdAt: report.post.createdAt.toISOString(),
          hidden: report.post.hiddenAt !== null,
        }
      : null,
  };
}

// Quote links (124) as sent by the Quote button: ids only, deduped, capped.
// Existence and same-topic checks happen in persistence.
const QUOTED_POST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
function parseQuotedPostIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !QUOTED_POST_ID_PATTERN.test(item) || ids.includes(item)) {
      continue;
    }
    ids.push(item);
    if (ids.length >= persistence.MAX_QUOTED_POSTS) break;
  }
  return ids;
}

function normalizeSlug(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(trimmed) ? trimmed : null;
}

function normalizeTitle(value: string): string | null {
  const title = value.trim().replace(/\s+/g, ' ');
  if (title.length < titleMinLength || title.length > titleMaxLength) return null;
  return title;
}

function normalizeBodyText(value: string): string | null {
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length === 0 || text.length > bodyMaxLength) return null;
  return text;
}

function normalizeModerationReason(value: string | null): string | null | false {
  if (value === null) return null;
  const reason = value.trim();
  if (reason.length === 0) return null;
  return reason.length <= moderationReasonMaxLength ? reason : false;
}

function normalizeRequiredReason(value: string): string | null {
  const reason = value.trim().replace(/\s+/g, ' ');
  if (reason.length === 0 || reason.length > moderationReasonMaxLength) return null;
  return reason;
}

function normalizeSearchQuery(value: string | null): string | null {
  const query = (value ?? '').trim().replace(/\s+/g, ' ');
  return query.length >= 2 && query.length <= 120 ? query : null;
}

function normalizeReportStatusFilter(
  value: string | null,
): persistence.ForumReportStatus | 'all' | null {
  if (value === null || value === '' || value === 'open') return 'open';
  if (value === 'resolved' || value === 'dismissed' || value === 'all') return value;
  return null;
}

function normalizeReportResolutionStatus(
  value: unknown,
): persistence.ForumReportResolutionStatus | null {
  return value === 'resolved' || value === 'dismissed' ? value : null;
}

function normalizeTopicModerationAction(
  value: unknown,
): persistence.ForumTopicModerationAction | null {
  if (
    value === 'pin' ||
    value === 'unpin' ||
    value === 'lock' ||
    value === 'unlock' ||
    value === 'hide'
  ) {
    return value;
  }
  return null;
}

function slugifyTitle(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : 'topic';
}

function forumPostHref(location: persistence.ForumPostLocation): string {
  const topicHref = `/forum/t/${encodeURIComponent(location.topic.id)}/${encodeURIComponent(
    location.topic.slug,
  )}`;
  const page = location.page > 1 ? `?page=${location.page}` : '';
  return `${topicHref}${page}#post_${encodeURIComponent(location.postId)}`;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}
