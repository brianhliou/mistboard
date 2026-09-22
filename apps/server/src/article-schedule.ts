// Scheduled posts, server side. The web prerender writes
// dist/article-schedule.json: every `status: 'published'` article whose
// publish moment was still ahead when the bundle was built, with that moment.
// Those pages have no prerendered file, are absent from blog.html and the
// feed, and the client hides them until the moment passes. This module gives
// the server the same clock so it can 404 the URL before the moment (the SPA
// shell would 404 it on takeover anyway; a crawler should see the same) and,
// once a scheduled post has gone live without a rebuild, stop serving the
// stale prerendered blog index so the client can render a current one.
//
// Announcements (web/src/announcements.ts) are scheduled on the same clock and
// listed in the same file; once one goes live the prerendered home page and
// /feed predate it in the same way, so they fall back to the shell too.
//
// The file is read on demand and cached for a minute, so a fresh deploy's
// schedule is picked up without a restart and a busy /blog does not stat the
// disk per request.

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export type ArticleSchedule = {
  builtAt: number;
  scheduled: Map<string, number>;
  /** Live moments of announcements still ahead at build time. */
  announcements: number[];
};

const EMPTY: ArticleSchedule = { builtAt: 0, scheduled: new Map(), announcements: [] };
const CACHE_MS = 60_000;
const cache = new Map<string, { readAt: number; schedule: ArticleSchedule }>();

export function parseArticleSchedule(json: string): ArticleSchedule {
  const raw = JSON.parse(json) as {
    builtAt?: string;
    scheduled?: Array<{ slug: string; liveAt: string }>;
    announcements?: Array<{ slug: string; liveAt: string }>;
  };
  const builtAt = Date.parse(raw.builtAt ?? '');
  const scheduled = new Map<string, number>();
  for (const entry of raw.scheduled ?? []) {
    const liveAt = Date.parse(entry.liveAt);
    if (entry.slug && !Number.isNaN(liveAt)) scheduled.set(entry.slug, liveAt);
  }
  const announcements = (raw.announcements ?? [])
    .map((entry) => Date.parse(entry.liveAt))
    .filter((liveAt) => !Number.isNaN(liveAt));
  return { builtAt: Number.isNaN(builtAt) ? 0 : builtAt, scheduled, announcements };
}

export async function readArticleSchedule(
  staticDir: string,
  now: number = Date.now(),
): Promise<ArticleSchedule> {
  const hit = cache.get(staticDir);
  if (hit && now - hit.readAt < CACHE_MS) return hit.schedule;
  const schedule = await fs
    .readFile(resolve(staticDir, 'article-schedule.json'), 'utf-8')
    .then(parseArticleSchedule)
    .catch(() => EMPTY);
  cache.set(staticDir, { readAt: now, schedule });
  return schedule;
}

/** True while a scheduled slug is still ahead of its moment. */
export function articleIsScheduledAhead(
  schedule: ArticleSchedule,
  slug: string,
  now: number = Date.now(),
): boolean {
  const liveAt = schedule.scheduled.get(slug);
  return liveAt !== undefined && now < liveAt;
}

/**
 * True once any scheduled post or announcement has gone live since the bundle
 * was built. One answer for blog.html, home.html and feed.html alike: the home
 * page lists both, and serving the shell for the other two a little early
 * costs a client render, not a wrong page.
 */
export function prerenderedIndexIsStale(
  schedule: ArticleSchedule,
  now: number = Date.now(),
): boolean {
  for (const liveAt of [...schedule.scheduled.values(), ...schedule.announcements]) {
    if (liveAt > schedule.builtAt && liveAt <= now) return true;
  }
  return false;
}

export function resetArticleScheduleCache(): void {
  cache.clear();
}
