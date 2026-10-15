// /practice/<set slug>/<position id>: open one shelf exercise in whatever
// database this page is served from.
//
// The five endgame sets are seeded into every environment under their curated
// slugs, but their study and chapter ids are minted per database, so a link
// written as /study/<prod id>/<prod chapter> 404s on a local pair (#521). This
// route looks the set up by slug in /api/practice, finds the chapter whose root
// is the position, and replaces the URL with that chapter. The seeder keeps a
// chapter's id across reseeds and rewrites its root to the definition, so on
// prod this lands on the same chapter a hard-coded link did.
//
// Degrades one step at a time: no chapter at that position yet (the seed has not
// run) opens the set; no set (a fresh database) opens the shelf.

import { xiangqiEndgamePracticeRouteFromPath } from '@mistboard/game';

type FetchJson = (url: string) => Promise<unknown>;

type Catalogue = { sections?: { cards?: { slug?: string; studyId?: string }[] }[] };
type StudyDetail = { chapters?: { id?: string; root?: { rootFen?: string } }[] };

export const PRACTICE_SHELF_HREF = '/practice';

/** Where `/practice/<slug>/<id>` should land, read from this environment's API. */
export async function resolvePracticeChapterHref(
  path: string,
  fetchJson: FetchJson,
): Promise<string> {
  const route = xiangqiEndgamePracticeRouteFromPath(path);
  if (!route) return PRACTICE_SHELF_HREF;

  let studyId: string | undefined;
  try {
    const catalogue = (await fetchJson('/api/practice')) as Catalogue;
    studyId = (catalogue.sections ?? [])
      .flatMap((section) => section.cards ?? [])
      .find((card) => card.slug === route.slug)?.studyId;
  } catch {
    return PRACTICE_SHELF_HREF;
  }
  if (!studyId) return PRACTICE_SHELF_HREF;

  const id = encodeURIComponent(studyId);
  const studyHref = `/study/${id}`;
  try {
    const detail = (await fetchJson(`/api/studies/${id}`)) as StudyDetail;
    // First match: the seeder puts the chapters it knows first, in set order,
    // and leaves any it no longer knows at the end.
    const chapter = (detail.chapters ?? []).find(
      (candidate) => candidate.id && candidate.root?.rootFen === route.chapter.fen,
    );
    return chapter?.id ? `${studyHref}/${encodeURIComponent(chapter.id)}` : studyHref;
  } catch {
    return studyHref;
  }
}

async function fetchJsonOrThrow(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

export async function mountPracticeChapterRedirect(path: string): Promise<void> {
  const href = await resolvePracticeChapterHref(path, fetchJsonOrThrow);
  // replace, not assign: Back from the chapter returns to the article, not to
  // this bounce page.
  window.location.replace(href);
}
