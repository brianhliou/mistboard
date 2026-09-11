// The embed contract, shared by the provider that serves it and the page that
// documents it.
//
// These numbers appear in three places that must agree: the oEmbed response the
// server returns, the iframe snippet a developer copies off /developers, and the
// prose on that page telling them what the limits are. Documentation drifting
// from behaviour is the ordinary outcome when the doc restates a constant, so
// the doc imports the constant instead.
//
// packages/game is the home because apps/server cannot import apps/web and vice
// versa, and this sits beside engine-protocol.ts, which is here for the same
// reason: it is a contract between two things that cannot import each other.

/**
 * Width the provider returns when a consumer asks for no particular size.
 *
 * It must stay ABOVE the widget's stacking breakpoint. The replay drops its move
 * list under the board at `max-width: 720px` (articles.css), and the default was
 * literally 720: every consumer taking the default got the narrow layout, in a
 * box proportioned for the wide one. embed-contract.test.ts reads the breakpoint
 * out of the stylesheet and fails if this number falls back onto it.
 */
export const EMBED_DEFAULT_WIDTH = 760;

/**
 * Height at the default width. The widget's natural height runs about 0.88x its
 * width in the side-by-side layout, measured across 721-1000px, plus the credit
 * line. 560 was never that number for any width, which is why the default frame
 * scrolled.
 */
export const EMBED_DEFAULT_HEIGHT = 700;

/**
 * Below this the move list and the board stop coexisting. Note that anything at
 * or under the stacking breakpoint gets the narrow layout, which is correct on a
 * phone and wants a TALLER box than the ratio above.
 */
export const EMBED_MIN_WIDTH = 320;

/** Above this the board stops being the reason the page is on screen. */
export const EMBED_MAX_WIDTH = 1200;

/** The oEmbed provider endpoint, relative to the site origin. */
export const OEMBED_ENDPOINT = '/api/oembed';

/**
 * A consumer's `maxwidth` is a request, not an instruction: it is clamped into
 * the range the widget actually works in, and a junk value falls back to the
 * default rather than erroring, which is what oEmbed consumers expect.
 */
export function clampEmbedWidth(raw: string | number | null | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return EMBED_DEFAULT_WIDTH;
  return Math.min(EMBED_MAX_WIDTH, Math.max(EMBED_MIN_WIDTH, Math.round(value)));
}

/** Height that preserves the default aspect ratio at `width`. */
export function embedHeightForWidth(width: number): number {
  return Math.round(width * (EMBED_DEFAULT_HEIGHT / EMBED_DEFAULT_WIDTH));
}

/** `/embed/study/:studyId/:chapterId`, the frameable page itself. */
export function embedStudyPath(studyId: string, chapterId: string): string {
  return `/embed/study/${studyId}/${chapterId}`;
}

/** `/embed/game/:roomId`, a finished game rendered alone for framing. */
export function embedGamePath(roomId: string): string {
  return `/embed/game/${roomId}`;
}

/** `/embed/tv`, the live board; `channel` narrows it to one watch channel. */
export function embedTvPath(channel?: string): string {
  return channel && channel !== 'top'
    ? `/embed/tv?channel=${encodeURIComponent(channel)}`
    : '/embed/tv';
}

/** `/embed/puzzle`, today's puzzle, or one puzzle by id. */
export function embedPuzzlePath(puzzleId?: string): string {
  return puzzleId ? `/embed/puzzle/${puzzleId}` : '/embed/puzzle';
}

/** `/embed/analysis/xiangqi`, the free analysis board. */
export function embedAnalysisPath(): string {
  return '/embed/analysis/xiangqi';
}

/**
 * What a pasted Mistboard URL embeds as, or null when it embeds as nothing.
 *
 * One parser for the two consumers that must agree on the answer: the oEmbed
 * provider (which answers "is this URL embeddable" for WordPress, Discourse and
 * the forum's own link expansion) and the forum client (which decides whether a
 * line that is only a URL becomes a board). The forum expanding a link the
 * provider then 404s, or the reverse, is the drift this exists to prevent.
 *
 * Games, studies and puzzles match on the permalink a person actually copies
 * (`/game/:id`, `/xiangqi/game/:id`, `/study/:s/:c`, `/puzzles/:id`) as well as
 * their embed path. TV and the analysis board match ONLY on their embed path:
 * `/watch` and `/analysis` are pages, and a link to a page should stay a link.
 *
 * A game link can name a position and a side: `?ply=30` or, as lichess writes
 * it, `#30`, opens on that ply; `?pov=black` (or a `/black` suffix) shows the
 * game from Black's side, which for a fog variant is Black's own fogged view.
 *
 * The variant segment of a tenant game route is not trusted; the game's own
 * record says what it is, so it is not carried here.
 */
export type EmbedPov = 'white' | 'truth' | 'black';

export type EmbedTarget =
  | { kind: 'game'; roomId: string; ply: number | null; pov: EmbedPov | null }
  | { kind: 'study'; studyId: string; chapterId: string }
  | { kind: 'puzzle'; puzzleId: string | null }
  | { kind: 'tv'; channel: string | null }
  | { kind: 'analysis' };

const ID = '([A-Za-z0-9_-]{1,64})';
// `/black` after the id is lichess's spelling for "seen from Black's side", kept
// so a habit formed there works here; `?pov=` is ours and wins when both appear.
const GAME_TARGET = new RegExp(
  `^/(?:embed/game|game|[a-z0-9-]{1,40}/game)/${ID}(?:/(white|black))?/?$`,
);
const STUDY_TARGET = new RegExp(`^/(?:embed/)?study/${ID}/${ID}/?$`);
const PUZZLE_PERMALINK = new RegExp(`^/puzzles/${ID}/?$`);
const PUZZLE_EMBED = new RegExp(`^/embed/puzzle(?:/${ID})?/?$`);
const TV_EMBED = /^\/embed\/tv\/?$/;
const ANALYSIS_EMBED = /^\/embed\/analysis(?:\/xiangqi)?\/?$/;

/** Accepts an absolute URL or a bare path; a string that is neither is null. */
export function embedTargetFromUrl(url: string): EmbedTarget | null {
  let pathname: string;
  let search: string;
  let hash: string;
  try {
    const parsed = new URL(url, 'https://mistboard.com');
    pathname = parsed.pathname;
    search = parsed.search;
    hash = parsed.hash;
  } catch {
    return null;
  }
  const game = GAME_TARGET.exec(pathname);
  if (game) {
    const params = new URLSearchParams(search);
    return {
      kind: 'game',
      roomId: game[1] as string,
      ply: embedPly(params.get('ply') ?? hash.slice(1)),
      pov: embedPov(params.get('pov') ?? game[2] ?? null),
    };
  }
  const study = STUDY_TARGET.exec(pathname);
  if (study) return { kind: 'study', studyId: study[1] as string, chapterId: study[2] as string };
  const puzzle = PUZZLE_PERMALINK.exec(pathname) ?? PUZZLE_EMBED.exec(pathname);
  if (puzzle) return { kind: 'puzzle', puzzleId: puzzle[1] ?? null };
  if (TV_EMBED.test(pathname)) {
    const channel = new URLSearchParams(search).get('channel');
    return { kind: 'tv', channel: channel && /^[a-z0-9-]{1,40}$/.test(channel) ? channel : null };
  }
  if (ANALYSIS_EMBED.test(pathname)) return { kind: 'analysis' };
  return null;
}

/** The frameable path for a target, the same one the oEmbed provider serves. */
export function embedPathForTarget(target: EmbedTarget): string {
  switch (target.kind) {
    case 'game': {
      const params = new URLSearchParams();
      if (target.ply !== null) params.set('ply', String(target.ply));
      if (target.pov !== null) params.set('pov', target.pov);
      const query = params.toString();
      return embedGamePath(encodeURIComponent(target.roomId)) + (query ? `?${query}` : '');
    }
    case 'study':
      return embedStudyPath(
        encodeURIComponent(target.studyId),
        encodeURIComponent(target.chapterId),
      );
    case 'puzzle':
      return embedPuzzlePath(target.puzzleId ? encodeURIComponent(target.puzzleId) : undefined);
    case 'tv':
      return embedTvPath(target.channel ?? undefined);
    case 'analysis':
      return embedAnalysisPath();
  }
}

/** A non-negative integer ply, or null for "the end". Anything else is null. */
export function embedPly(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  return Number(raw);
}

/** `white`, `black`, or `truth`; anything else is null (the embed's default). */
export function embedPov(raw: string | null | undefined): EmbedPov | null {
  return raw === 'white' || raw === 'black' || raw === 'truth' ? raw : null;
}
