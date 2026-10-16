// Dev only: a study the local server does not have is read from the public
// site instead, so an article's study embeds preview on a local pair.
//
// Articles frame chapters of studies that live in production (an author builds
// the study on mistboard.com, then writes about it), and a local server, in
// memory or on a fresh database, has none of them: every `/embed/study/...`
// frame read "This study is not available." The Vite dev proxy
// (vite.config.ts, `apply: 'serve'`, so never part of a build) asks this module
// whether a failed study read may be retried against the public site.
//
// What crosses: one anonymous GET of `/api/studies/<id>`, with no cookie, no
// authorization header and nothing else of the local request. Production
// answers it the way it answers any logged-out reader, so a private study is a
// 404 there too and only what is already public comes back. Writes, chapter
// sub-routes and every other API path stay local.
//
// Off with MISTBOARD_DEV_PUBLIC_STUDIES=0; the origin is
// MISTBOARD_DEV_PUBLIC_STUDIES_ORIGIN (default https://mistboard.com).

export const DEV_PUBLIC_STUDIES_ORIGIN = 'https://mistboard.com';

const STUDY_READ = /^\/api\/studies\/([A-Za-z0-9_-]{1,64})\/?(?:\?.*)?$/;

/** The public URL to retry a local study read against, or null when this
 *  request is not one a fallback may touch. */
export function publicStudyFallbackUrl(
  method: string | undefined,
  url: string | undefined,
  origin: string = DEV_PUBLIC_STUDIES_ORIGIN,
): string | null {
  if ((method ?? 'GET').toUpperCase() !== 'GET' || !url) return null;
  const match = STUDY_READ.exec(url);
  if (!match) return null;
  return `${origin.replace(/\/$/, '')}/api/studies/${match[1]}`;
}

/** The local answers that mean "this server has no such study": not found,
 *  and the in-memory pair's 503 (persistence_disabled), which has no studies
 *  at all. A local study that exists is always served from the local server. */
export function localStudyMissing(status: number): boolean {
  return status === 404 || status === 503;
}

/** Whether the fallback is on for this dev server's environment. */
export function publicStudiesEnabled(env: Record<string, string | undefined>): boolean {
  return env.MISTBOARD_DEV_PUBLIC_STUDIES !== '0';
}

/** The only headers sent to the public site: nothing that identifies the
 *  local session. */
export const PUBLIC_STUDY_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  accept: 'application/json',
  'user-agent': 'mistboard-dev-preview',
};
