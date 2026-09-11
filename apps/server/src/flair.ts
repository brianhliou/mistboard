// Profile flair: the canonical allowlist of cosmetic icon keys an account may
// set (122_user_flair.sql). The server owns this list because it gates the
// write; apps/web/src/flair.ts mirrors it with the rendering metadata, and
// apps/web/src/flair-sync.test.ts fails the build if the two drift.
//
// Two families, both drawn from art the site already ships, so adding flair
// added no assets:
//   variant-*  the final variant markers (public/variant-markers/final/*.png)
//   piece-*    xiangqi piece characters, rendered as text in a styled disc
//
// Deliberately a closed list rather than free text or an upload. A fixed
// allowlist cannot carry a slur, a URL, or an image that needs moderating, so
// flair ships with no moderation surface at all — that is the whole reason it
// is shaped this way.

export const FLAIR_KEYS = [
  'variant-xiangqi',
  'variant-fortress-xiangqi',
  'variant-duck-xiangqi',
  'variant-jieqi',
  'variant-banqi',
  'variant-jungle',
  'variant-jungle-flip',
  'variant-dark-xiangqi',
  'variant-dark-chess',
  'variant-dark-shogi',
  'piece-red-general',
  'piece-red-advisor',
  'piece-red-elephant',
  'piece-red-horse',
  'piece-red-chariot',
  'piece-red-cannon',
  'piece-red-soldier',
  'piece-black-general',
  'piece-black-advisor',
  'piece-black-elephant',
  'piece-black-horse',
  'piece-black-chariot',
  'piece-black-cannon',
  'piece-black-soldier',
] as const;

export type FlairKey = (typeof FLAIR_KEYS)[number];

const FLAIR_KEY_SET: ReadonlySet<string> = new Set<string>(FLAIR_KEYS);

export function isFlairKey(value: unknown): value is FlairKey {
  return typeof value === 'string' && FLAIR_KEY_SET.has(value);
}

// Parses a client-supplied flair field. Returns the key, or null for "clear my
// flair" (explicit null, or the empty string a cleared <select> sends).
// Returns undefined for anything else, which callers must treat as a 400
// rather than as a clear — silently clearing on a typo'd key would let a stale
// client wipe the field it meant to set.
export function parseFlair(value: unknown): FlairKey | null | undefined {
  if (value === null || value === '') return null;
  if (isFlairKey(value)) return value;
  return undefined;
}
