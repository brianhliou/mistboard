// /practice/<set slug>/<position id>: where a shelf deep link lands, resolved
// on the server so the response is a 301 instead of a shell.
//
// Article links name the shelf exercise by slug and position
// (/practice/endgames-horse/horse-vs-advisor) because study and chapter ids are
// minted per database (#521). The client resolves them the same way
// (apps/web/src/practice-chapter-redirect.ts), but it did so after loading a
// shell with the homepage title and description, so the 35 linked deep links
// read to Bing as copies of '/' (2026-10-24). Two reads the /api/practice and
// /api/studies/:id handlers already make answer it here.
//
// Only a resolved chapter redirects. Anything short of that (no persistence,
// the seed has not run, the chapter is missing) keeps the shell, and the
// client degrades to the set or the shelf as before.

import { xiangqiEndgamePracticeRouteFromPath } from '@mistboard/game';
import * as persistence from './persistence.js';

export type PracticeChapterLookups = {
  studyIdForSlug: (slug: string) => Promise<string | null>;
  chapters: (studyId: string) => Promise<{ id: string; root: unknown }[] | null>;
};

const liveLookups: PracticeChapterLookups = {
  // The reader-facing lookup: a private study is not a redirect target.
  studyIdForSlug: async (slug) =>
    (await persistence.getPracticeStudiesBySlug([slug]))[0]?.id ?? null,
  chapters: async (studyId) => (await persistence.getStudyById(studyId))?.chapters ?? null,
};

function rootFen(root: unknown): string | null {
  if (!root || typeof root !== 'object') return null;
  const fen = (root as { rootFen?: unknown }).rootFen;
  return typeof fen === 'string' ? fen : null;
}

/** `/study/<id>/<chapter>` for a shelf deep link, or null to serve the shell. */
export async function practiceChapterPath(
  pathname: string,
  lookups: PracticeChapterLookups = liveLookups,
): Promise<string | null> {
  const route = xiangqiEndgamePracticeRouteFromPath(pathname);
  if (!route) return null;
  const studyId = await lookups.studyIdForSlug(route.slug);
  if (!studyId) return null;
  // First match, as the client takes it: the seeder lists the chapters it
  // knows first, in set order.
  const chapter = (await lookups.chapters(studyId))?.find(
    (candidate) => rootFen(candidate.root) === route.chapter.fen,
  );
  if (!chapter) return null;
  return `/study/${encodeURIComponent(studyId)}/${encodeURIComponent(chapter.id)}`;
}
