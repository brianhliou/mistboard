// The path matcher on its own, importing nothing from the pages. main.ts needs
// to know whether a URL is an embed before it decides what to load; importing
// the page module for that would pull the replay widget and its CSS into the
// initial bundle for every visitor, which is the opposite of what a
// lazily-mounted route is for. (@mistboard/game is already in that bundle.)

import { type EmbedPov, embedPly, embedPov } from '@mistboard/game';

export type EmbedStudyRoute = { studyId: string; chapterId: string };

/** `/embed/study/:studyId/:chapterId`, or null when the path is not one. */
export function embedStudyRouteFromPath(pathname: string): EmbedStudyRoute | null {
  const m = /^\/embed\/study\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  if (!m) return null;
  return { studyId: m[1] as string, chapterId: m[2] as string };
}

/**
 * `?theme=light` / `?theme=dark` on an embed URL, pinning the board to one
 * theme instead of following the reader's OS.
 *
 * An embed runs inside someone else's page, and that page may have only one
 * theme. Mistboard's own default is `system`, so a light-only site framing an
 * embed shows a dark board to every reader whose OS is dark, and there is no
 * fix on the embedder's side: `prefers-color-scheme` inside the frame is the
 * browser's, and `color-scheme` on the <iframe> element does not reach the
 * framed document. The embedder has to be able to say it in the URL.
 *
 * Anything else, including no param at all, returns null and the embed keeps
 * following the reader.
 */
export function embedThemeFromSearch(search: string): 'light' | 'dark' | null {
  const value = new URLSearchParams(search).get('theme');
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * `?notation=wxf` (or `chinese`, `iccs`, `coordinate`) on an embed URL, pinning
 * the move labels instead of following the reader's own setting.
 *
 * Same shape of problem as `theme`, for the same reason: the reader of an embed
 * is on the EMBEDDER's page, and almost never has a stored Mistboard preference,
 * so they get the site default of coordinates. That default is right for a
 * general visitor and wrong for an article about endgame technique, where the
 * source material is written in WXF or Chinese and `a5-a9` is the one form no
 * manual uses. The embedder knows which their readers need; Mistboard does not.
 *
 * Anything else, including no param, returns null and the embed follows the
 * reader. Deliberately does NOT write the preference: the embed is on
 * mistboard.com's origin, so a write would change the reader's setting for the
 * whole site from inside someone else's page.
 */
export function embedNotationFromSearch(
  search: string,
): 'coordinate' | 'chinese' | 'wxf' | 'iccs' | null {
  const value = new URLSearchParams(search).get('notation');
  return value === 'coordinate' || value === 'chinese' || value === 'wxf' || value === 'iccs'
    ? value
    : null;
}

export type EmbedGameRoute = { roomId: string };

/** `/embed/game/:roomId`, or null when the path is not one. */
export function embedGameRouteFromPath(pathname: string): EmbedGameRoute | null {
  const m = /^\/embed\/game\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  if (!m) return null;
  return { roomId: m[1] as string };
}

/**
 * Every frameable route, as one discriminated union, so main.ts can ask "is this
 * document an embed" once and never drift from the list of pages that render
 * without the site chrome. Adding an embed means adding a member here AND to
 * the server's isEmbedRoute (server-policy.ts), which decides what may be
 * framed; the two are pinned against each other by embed-route.test.ts.
 */
export type EmbedRoute =
  | { kind: 'study'; route: EmbedStudyRoute }
  | { kind: 'game'; route: EmbedGameRoute }
  | { kind: 'tv' }
  | { kind: 'puzzle'; route: EmbedPuzzleRoute }
  | { kind: 'analysis'; route: EmbedAnalysisRoute };

/** `/embed/tv`: the live board, following the featured game of a channel. */
export function isEmbedTvPath(pathname: string): boolean {
  return /^\/embed\/tv\/?$/.test(pathname);
}

export type EmbedPuzzleRoute = { puzzleId: string | null };

/** `/embed/puzzle` (today's puzzle) or `/embed/puzzle/:id`, or null. */
export function embedPuzzleRouteFromPath(pathname: string): EmbedPuzzleRoute | null {
  const m = /^\/embed\/puzzle(?:\/([A-Za-z0-9_-]{1,64}))?\/?$/.exec(pathname);
  if (!m) return null;
  return { puzzleId: m[1] ?? null };
}

export type EmbedAnalysisRoute = { variant: 'xiangqi' };

/** `/embed/analysis` or `/embed/analysis/xiangqi`, or null. Xiangqi is the only
 *  variant with a roomless analysis board that runs without the site's
 *  cross-origin isolation, so it is the only one an embed can offer. */
export function embedAnalysisRouteFromPath(pathname: string): EmbedAnalysisRoute | null {
  return /^\/embed\/analysis(?:\/xiangqi)?\/?$/.test(pathname) ? { variant: 'xiangqi' } : null;
}

export function embedRouteFromPath(pathname: string): EmbedRoute | null {
  const study = embedStudyRouteFromPath(pathname);
  if (study) return { kind: 'study', route: study };
  const game = embedGameRouteFromPath(pathname);
  if (game) return { kind: 'game', route: game };
  if (isEmbedTvPath(pathname)) return { kind: 'tv' };
  const puzzle = embedPuzzleRouteFromPath(pathname);
  if (puzzle) return { kind: 'puzzle', route: puzzle };
  const analysis = embedAnalysisRouteFromPath(pathname);
  if (analysis) return { kind: 'analysis', route: analysis };
  return null;
}

/**
 * `?channel=xiangqi` on the TV embed: which /api/watch channel to follow.
 * Anything not channel-id-shaped falls back to 'top', the cross-channel
 * election the homepage follows; the server answers 400 for an unknown id and
 * the page then shows the frozen fallback, never someone else's game.
 */
export function embedChannelFromSearch(search: string): string {
  const value = new URLSearchParams(search).get('channel');
  return value && /^[a-z0-9-]{1,40}$/.test(value) ? value : 'top';
}

/**
 * `?color=black` on the analysis embed: which side sits at the bottom. Mirrors
 * lichess's parameter name; `red` is xiangqi's first mover and the default.
 */
export function embedColorFromSearch(search: string): 'red' | 'black' {
  const value = new URLSearchParams(search).get('color');
  return value === 'black' ? 'black' : 'red';
}

/**
 * `?ply=N` on a game embed: the position to open on, instead of the final one.
 * Clamped by the page once the game is loaded; here only a non-negative integer
 * survives, and anything else means "the end".
 */
export function embedPlyFromSearch(search: string): number | null {
  return embedPly(new URLSearchParams(search).get('ply'));
}

/**
 * `?pov=white|black|truth` on a game embed: which side's view to show. For a
 * fog game that is that side's own (now public) fogged view, oriented to them;
 * for a perfect-information game it is just the board turned to that side.
 * `truth` is the fog-off board. Absent or junk means the page's own default.
 */
export function embedPovFromSearch(search: string): EmbedPov | null {
  return embedPov(new URLSearchParams(search).get('pov'));
}
