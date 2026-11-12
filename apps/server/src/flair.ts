// Profile flair: the canonical allowlist of cosmetic icon keys an account may
// set (122_user_flair.sql). The server owns this list because it gates the
// write; apps/web/src/flair.ts mirrors it with the rendering metadata, and
// apps/web/src/flair-sync.test.ts fails the build if the two drift.
//
// Every family is drawn from art the site already ships, so adding flair
// added no assets:
//   variant-*                   the final variant markers (public/variant-markers/final/*.png)
//   piece-<ink>-<role>          xiangqi pieces in the Traditional set (the first piece
//                               flair; existing accounts store these keys, so they keep
//                               their unprefixed names)
//   piece-<set>-<ink>-<role>    xiangqi pieces in every other board piece set
//   jungle-<ink>-<role>         the Jungle animal tokens
//   chess-<ink>-<role>          the chess pieces (the one chess set the site ships)
//
// Deliberately a closed list rather than free text or an upload. A fixed
// allowlist cannot carry a slur, a URL, or an image that needs moderating, so
// flair ships with no moderation surface at all; that is the whole reason it
// is shaped this way.
//
// Every key must also pass the column's shape CHECK in 122_user_flair.sql
// (lowercase, digits and hyphens, at most 40 characters); flair.test.ts holds
// the list to it.

const VARIANT_FLAIR_KEYS = [
  'variant-xiangqi',
  'variant-fortress-xiangqi',
  'variant-duck-xiangqi',
  'variant-atomic-xiangqi',
  'variant-crazyhouse-xiangqi',
  'variant-jieqi',
  'variant-banqi',
  'variant-jungle',
  'variant-jungle-flip',
  'variant-dark-xiangqi',
  'variant-dark-chess',
  'variant-gomoku',
] as const;

const XIANGQI_INKS = ['red', 'black'] as const;
const XIANGQI_ROLES = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
] as const;

// The board settings' piece-set order (XIANGQI_PIECE_SETS in
// apps/web/src/xiangqi-piece-sets.ts), which is also the picker's order.
// 'traditional' is the set whose keys carry no set segment.
const XIANGQI_FLAIR_SETS = [
  'international',
  'traditional',
  'simplified',
  'lacquer',
  'wood',
  'book',
  'brush',
  'clerical',
  'animal-dobutsu',
] as const;

const JUNGLE_INKS = ['red', 'black'] as const;
const JUNGLE_ROLES = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'] as const;

const CHESS_INKS = ['white', 'black'] as const;
const CHESS_ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

type XiangqiInk = (typeof XIANGQI_INKS)[number];
type XiangqiRole = (typeof XIANGQI_ROLES)[number];
type PrefixedXiangqiSet = Exclude<(typeof XIANGQI_FLAIR_SETS)[number], 'traditional'>;

export type FlairKey =
  | (typeof VARIANT_FLAIR_KEYS)[number]
  | `piece-${XiangqiInk}-${XiangqiRole}`
  | `piece-${PrefixedXiangqiSet}-${XiangqiInk}-${XiangqiRole}`
  | `jungle-${(typeof JUNGLE_INKS)[number]}-${(typeof JUNGLE_ROLES)[number]}`
  | `chess-${(typeof CHESS_INKS)[number]}-${(typeof CHESS_ROLES)[number]}`;

function pieceKeys(prefix: string, inks: readonly string[], roles: readonly string[]): FlairKey[] {
  return inks.flatMap((ink) => roles.map((role) => `${prefix}-${ink}-${role}` as FlairKey));
}

// Picker order: variants, then each xiangqi set (red then black), then Jungle,
// then chess.
export const FLAIR_KEYS: readonly FlairKey[] = [
  ...VARIANT_FLAIR_KEYS,
  ...XIANGQI_FLAIR_SETS.flatMap((set) =>
    pieceKeys(set === 'traditional' ? 'piece' : `piece-${set}`, XIANGQI_INKS, XIANGQI_ROLES),
  ),
  ...pieceKeys('jungle', JUNGLE_INKS, JUNGLE_ROLES),
  ...pieceKeys('chess', CHESS_INKS, CHESS_ROLES),
];

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
