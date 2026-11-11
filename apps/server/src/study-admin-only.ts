// Admin-only study variants (#628): the server half of
// ADMIN_ONLY_STUDY_SPEC_IDS (packages/game/src/game-specs.ts). A study with a
// chapter in one of them is created, opened and listed by admins only until
// the variant's public launch; to everyone else it does not exist (404 on a
// read, absent from every list). Crawler surfaces (the SSR page meta, the share
// card, oEmbed, the sitemap) never serve one, admin or not, because a crawler
// is never an admin and a cached card outlives the session that made it.

import { isAdminOnlyStudySpecId } from '@mistboard/game';

/** Whether any chapter of the study is in an admin-only variant. A study is
 *  single-variant, but every chapter is checked so a stray row fails closed. */
export function studyHasAdminOnlyChapter(
  study: { chapters: readonly { variant: string }[] } | null | undefined,
): boolean {
  return !!study && study.chapters.some((chapter) => isAdminOnlyStudySpecId(chapter.variant));
}
