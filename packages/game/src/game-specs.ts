import type { VariantId } from './types.js';

export type GameFamilyId = 'chess' | 'xiangqi' | 'jungle' | 'military-chess' | 'mahjong';
export type BoardGeometryId =
  | 'chess-8x8'
  | 'xiangqi-9x10'
  | 'banqi-8x4'
  | 'jungle-7x9'
  | 'jungle-flip-4x4'
  | 'xiangqi-7x8'
  | 'luzhanqi-65-graph'
  // Mahjong has no board. This dimension names the material instead: the 144
  // tiles, being the 136 core plus eight flowers. Forcing a geometry here would
  // be a fiction, and the honest alternative is to say what is actually shared.
  | 'mahjong-144';
export type MovementRulesId =
  // Draw, discard, and claim out of turn. Nothing moves on a board.
  | 'mahjong-hk'
  | 'orthodox-chess'
  | 'xiangqi'
  | 'banqi'
  | 'jungle'
  | 'jungle-flip'
  | 'fortress-xiangqi'
  | 'luzhanqi'
  // Duck Xiangqi: standard xiangqi geometry plus a shared, uncapturable duck
  // that moves every turn. Its own movement id because the duck is an ordinary
  // blocking piece for every xiangqi geometry at once - it screens for cannons,
  // blocks the horse's leg and the elephant's eye, and breaks a general file.
  | 'duck-xiangqi';
// 'last-mover': win by leaving the opponent with no legal move (banqi). The
// general is NOT royal — capturing it does not end the game (the opponent flips
// or plays on) — so this subsumes "all pieces captured" and stalemate alike.
export type ObjectiveRulesId =
  | 'king-capture'
  | 'general-capture'
  | 'checkmate'
  | 'last-mover'
  | 'flag-capture'
  // 'den-or-race': win by moving a piece into the opponent's den OR capturing all
  // their pieces (Jungle / Dou Shou Qi). No royal piece; perfect information.
  | 'den-or-race'
  // Mahjong: assemble four sets and a pair from a concealed hand. No royal
  // piece, no capture, and no position to win on.
  | 'four-sets-and-a-pair';
// 'open' = perfect-information; 'dark' is
// fog of war (positions hidden); 'hidden-identity' is jieqi/banqi (positions
// public, piece identities hidden until revealed).
// 'concealed-hands' is mahjong: there are no positions to hide, so the
// distinction is per-seat rather than per-square. Every seat's tiles are
// private to that seat, the wall is private to everyone, and discards and
// claimed sets are public the moment they are made.
export type VisibilityRulesId = 'dark' | 'open' | 'hidden-identity' | 'concealed-hands';
export type SetupRulesId =
  | 'standard'
  | 'draft960'
  | 'double-fischer-random'
  | 'jieqi-deal'
  | 'banqi-deal'
  | 'jungle-standard'
  | 'jungle-flip-deal'
  | 'fortress-standard'
  | 'luzhanqi-formation'
  | 'mahjong-deal';
export type ReserveRulesId = 'none' | 'crazyhouse';
export type DropPolicyId =
  | 'none'
  | 'any-legal-square'
  | 'not-enemy-palace'
  // Fortress Xiangqi flagship: attackers (chariot/horse/cannon/soldier/treasure)
  // parachute anywhere incl. the enemy half; defenders (advisor/elephant) drop
  // only where they may legally stand (palace / own half).
  | 'attacker-anywhere-defender-home'
  | 'seen-squares-only';
export type GameSpecSurface = 'hidden' | 'beta' | 'casual' | 'rated';
/**
 * `live`: built and served (offered or hidden, per publicSurface). `future`: an
 * id reserved ahead of any code. `retired`: was built, is not coming back; the
 * gate refuses it, no tenant registers for it, `npm run variants` omits it, and
 * its code is being removed under docs-private/variant-retirement-plan.md (#396).
 */
export type GameSpecRuntimeStatus = 'live' | 'future' | 'retired';

export type RatingPoolBaseId =
  | 'fog'
  | 'fog_draft960'
  | 'dark_xiangqi'
  | 'jieqi'
  | 'banqi'
  | 'jungle'
  | 'jungle_flip'
  | 'fortress_xiangqi'
  | 'luzhanqi'
  | 'mahjong_hk'
  | 'xiangqi'
  // Owes a user_ratings CHECK migration adding 'duck_xiangqi' before it is rated.
  | 'duck_xiangqi';

export type GameSpecId =
  | 'dark-chess'
  | 'dark-draft960'
  | 'dark-xiangqi'
  | 'jieqi'
  | 'banqi'
  | 'jungle'
  | 'jungle-flip'
  | 'fortress-xiangqi'
  | 'luzhanqi'
  // Duck Xiangqi: Duck Chess's shared blocker on the xiangqi board. Rules engine:
  // packages/game/src/variants-duck-xiangqi.ts. Design notes and the balance
  // measurement: docs-private/duck-xiangqi/.
  | 'duck-xiangqi'
  // Standard (open-information) Xiangqi — ordinary 9x10 Chinese chess. The
  // open-info sibling of Dark Xiangqi; check-aware legality + checkmate via the
  // elephantops CHECKED path (packages/game/src/variants-xiangqi-standard.ts).
  | 'xiangqi'
  // Hong Kong mahjong. Playable behind a server flag AND a per-account grant;
  // runtimeStatus is 'future' because nothing is built behind it yet.
  | 'mahjong';
export type GameSpecAliasId = 'fog-draft960';
export type GameSpecLookupId = GameSpecId | GameSpecAliasId;

export type GameSpec = {
  id: GameSpecId;
  publicName: string;
  family: GameFamilyId;
  board: BoardGeometryId;
  movement: MovementRulesId;
  objective: ObjectiveRulesId;
  visibility: VisibilityRulesId;
  setup: SetupRulesId;
  reserves: ReserveRulesId;
  dropPolicy: DropPolicyId;
  ratingPoolBase: RatingPoolBaseId;
  publicSurface: GameSpecSurface;
  runtimeStatus: GameSpecRuntimeStatus;
  // Active rating pool flag: true ⇒ this spec's ratingPoolBase is one of the
  // currently-rated pools (RATED_POOL_BASES derives from this). Casual-only
  // specs omit it. Gated globally by MISTBOARD_RATED_ENABLED regardless.
  rated?: boolean;
  legacyLiveRoom?: {
    variant: VariantId;
    hiddenDraft960: boolean;
  };
};

export const DARK_CHESS_SPEC_ID = 'dark-chess' satisfies GameSpecId;
export const DARK_DRAFT960_SPEC_ID = 'dark-draft960' satisfies GameSpecId;
// Compatibility alias for pre-taxonomy code and URLs. New code should use
// DARK_DRAFT960_SPEC_ID; "fog" remains only in legacy rating/API vocabulary.
export const FOG_DRAFT960_SPEC_ID = DARK_DRAFT960_SPEC_ID;
export const DARK_XIANGQI_SPEC_ID = 'dark-xiangqi' satisfies GameSpecId;
export const JIEQI_SPEC_ID = 'jieqi' satisfies GameSpecId;
export const BANQI_SPEC_ID = 'banqi' satisfies GameSpecId;
export const MAHJONG_SPEC_ID = 'mahjong' satisfies GameSpecId;
export const JUNGLE_SPEC_ID = 'jungle' satisfies GameSpecId;
export const JUNGLE_FLIP_SPEC_ID = 'jungle-flip' satisfies GameSpecId;
export const FORTRESS_XIANGQI_SPEC_ID = 'fortress-xiangqi' satisfies GameSpecId;
export const LUZHANQI_SPEC_ID = 'luzhanqi' satisfies GameSpecId;
export const XIANGQI_SPEC_ID = 'xiangqi' satisfies GameSpecId;
export const DUCK_XIANGQI_SPEC_ID = 'duck-xiangqi' satisfies GameSpecId;

// Specs that may be played by correspondence (days-per-move), in display order. The
// SINGLE source of truth shared by the server's fail-closed allowlist
// (CORRESPONDENCE_ELIGIBLE_SPECS builds its Set from this) and the web variant pickers, so
// the two can never drift. This is a product decision, not a capability: the list was
// hidden-info-only under fork-6, then opened to perfect-info xiangqi on 2026-07-04 (casual
// -only) — see the comment on CORRESPONDENCE_ELIGIBLE_SPECS. A new member also needs a
// tenant that supplies both a seek factory and a deadline sweeper
// (correspondence-eligibility.test.ts).
export const CORRESPONDENCE_ELIGIBLE_SPEC_IDS: readonly GameSpecId[] = [
  XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
];

// Specs a study chapter may hold, in display order. The SINGLE source of truth
// shared by the server's fail-closed route allowlist (routes/studies.ts) and the
// web study catalog, so a chapter the API accepts always has a board to render it.
// Membership is a CAPABILITY, not a product call: a variant qualifies once it has
// a tree-review stack (adapter + presentation in apps/web/src/review/) AND a
// deterministic start position. Hidden-deal variants (banqi, jieqi, jungle-flip)
// are excluded until a chapter can persist its deal — replaying a saved tree
// against a freshly minted deal would truncate the line to its legal prefix.
export const STUDY_ELIGIBLE_SPEC_IDS: readonly GameSpecId[] = [
  XIANGQI_SPEC_ID,
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  // Duck Xiangqi qualifies on the same two counts as the rest: it has a
  // tree-review stack (review/duck-xiangqi-tree-adapter.ts + -review.ts) and a
  // deterministic start position spellable as a FEN (duck-xiangqi-fen.ts, whose
  // seventh field carries the duck). Slotted at its canonical position, not
  // appended: study-catalog.test.ts asserts the picker built from this list is
  // sorted by canonicalVariantOrderIndex.
  DUCK_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
];

/** Fail-closed membership test for {@link STUDY_ELIGIBLE_SPEC_IDS} — narrows an
 *  untrusted request string (or a persisted chapter's variant column). */
export function isStudyEligibleSpecId(value: string): value is GameSpecId {
  return (STUDY_ELIGIBLE_SPEC_IDS as readonly string[]).includes(value);
}

// Single source of truth for variant DISPLAY order across every surface: the
// play-menu picker, the leaderboard/profile grids, the Mistboard TV watch rail,
// and the /rules rail. Only the current public product shelf is ranked here.
// Internal, retired, and deep-link-only specs remain valid GAME_SPECS but sort
// after the live shelf. The xiangqi family leads in popularity/product order,
// Fog Xiangqi bridges directly into Fog Chess, and the two Jungle games close
// the shelf together.
export const CANONICAL_VARIANT_ORDER: readonly GameSpecId[] = [
  XIANGQI_SPEC_ID,
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
];

/** Sort index for {@link CANONICAL_VARIANT_ORDER}; unlisted specs sort to the end. */
export function canonicalVariantOrderIndex(id: GameSpecId): number {
  const index = CANONICAL_VARIANT_ORDER.indexOf(id);
  return index === -1 ? CANONICAL_VARIANT_ORDER.length : index;
}

export const GAME_SPECS: readonly GameSpec[] = [
  {
    id: DARK_CHESS_SPEC_ID,
    publicName: 'Fog Chess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'fog',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
    legacyLiveRoom: { variant: 'dark-chess', hiddenDraft960: false },
  },
  {
    id: DARK_DRAFT960_SPEC_ID,
    publicName: 'Dark Draft960',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'draft960',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'fog_draft960',
    rated: true,
    publicSurface: 'hidden',
    runtimeStatus: 'retired',
    legacyLiveRoom: { variant: 'dark-chess', hiddenDraft960: true },
  },
  {
    // Fortress Xiangqi: "xiangqi with a pocket." 7x8 board, opposite-corner
    // palaces, faithful xiangqi movement plus the one new Treasure piece, and
    // crazyhouse drops (both-side attacker drops + the chasing rule).
    // Rules engine: packages/game/src/variants-fortress-xiangqi.ts.
    // Flagship of the 2026-07-03 xiangqi pivot (project_xiangqi_pivot_track):
    // promoted to a live public variant. Runtime kill-switch is the server flag
    // MISTBOARD_FORTRESS_XIANGQI_ENABLED (flip on to open room creation).
    id: FORTRESS_XIANGQI_SPEC_ID,
    publicName: 'Fortress',
    family: 'xiangqi',
    board: 'xiangqi-7x8',
    movement: 'fortress-xiangqi',
    objective: 'checkmate',
    visibility: 'open',
    setup: 'fortress-standard',
    reserves: 'crazyhouse',
    dropPolicy: 'attacker-anywhere-defender-home',
    ratingPoolBase: 'fortress_xiangqi',
    // Rating-ready like Dark Xiangqi / Banqi / Jieqi: the pool lights up the
    // moment the global rated flag flips.
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Standard (open-information) Xiangqi — ordinary 9x10 Chinese chess. The
    // open-info sibling of Dark Xiangqi: identical board/movement/setup, but
    // perfect information and check-aware (checkmate/stalemate terminal, not a
    // literal general capture). Rules engine:
    // packages/game/src/variants-xiangqi-standard.ts.
    id: XIANGQI_SPEC_ID,
    publicName: 'Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-9x10',
    movement: 'xiangqi',
    objective: 'checkmate',
    visibility: 'open',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'xiangqi',
    // Rating-ready (like Dark Xiangqi / Jieqi / Banqi): pool lights up when the
    // global rated flag flips. Ships flag-off, PvP-first, casual until then.
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: DARK_XIANGQI_SPEC_ID,
    publicName: 'Fog Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-9x10',
    movement: 'xiangqi',
    objective: 'general-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'dark_xiangqi',
    // Rating-ready (like Banqi/Jieqi): the pool exists so it lights up the moment
    // the global rated flag flips. Launches PvP-first, casual until then.
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: JIEQI_SPEC_ID,
    publicName: 'Jieqi',
    family: 'xiangqi',
    board: 'xiangqi-9x10',
    movement: 'xiangqi',
    objective: 'checkmate',
    visibility: 'hidden-identity',
    setup: 'jieqi-deal',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'jieqi',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Banqi (半棋 / Chinese Dark Chess): an 8x4 half-xiangqi board with the
    // xiangqi piece set, all face-down at start. Symmetric hidden-identity (both
    // seats see the same masked board; only the deal is hidden). Win by leaving
    // the opponent with no legal move — the general is not royal. Rules engine:
    // packages/game/src/variants-banqi.ts.
    id: BANQI_SPEC_ID,
    publicName: 'Banqi',
    family: 'xiangqi',
    board: 'banqi-8x4',
    movement: 'banqi',
    objective: 'last-mover',
    visibility: 'hidden-identity',
    setup: 'banqi-deal',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'banqi',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Hong Kong Old Style (清章). Four seats, one human against three bots to
    // begin with. Registered so the fail-closed dispatch can see it; NOT built:
    // there is no tenant, no route and no client yet, which is what
    // runtimeStatus 'future' means. The scoring is also unverified - see
    // docs-private/mahjong/hk-old-style.md section 8 - so this must not become
    // discoverable before a player has checked the faan table.
    id: MAHJONG_SPEC_ID,
    publicName: 'Mahjong',
    family: 'mahjong',
    board: 'mahjong-144',
    movement: 'mahjong-hk',
    objective: 'four-sets-and-a-pair',
    visibility: 'concealed-hands',
    setup: 'mahjong-deal',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'mahjong_hk',
    publicSurface: 'hidden',
    // Built and playable, and deliberately not public: the same pairing Duck
    // Xiangqi uses. 'future' was right while this was only a registered id, and
    // it is what greys the variant out in the play menu as "coming soon", which
    // is now the wrong statement about it.
    runtimeStatus: 'live',
  },
  {
    // Luzhanqi / Junqi: computer-refereed two-player dark military chess on the
    // 65-point road/rail graph. Players submit private formations; the server
    // adjudicates battles without revealing enemy ranks until the postgame truth
    // view. Live but hidden/flag-gated until the formation editor and review
    // surfaces land.
    // Rules engine: packages/game/src/variants-luzhanqi.ts.
    id: LUZHANQI_SPEC_ID,
    publicName: 'Luzhanqi',
    family: 'military-chess',
    board: 'luzhanqi-65-graph',
    movement: 'luzhanqi',
    objective: 'flag-capture',
    visibility: 'hidden-identity',
    setup: 'luzhanqi-formation',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'luzhanqi',
    publicSurface: 'hidden',
    runtimeStatus: 'retired',
  },
  {
    // Duck Xiangqi: W. D. Troyka's... no - Dr Tim Paulden's Duck Chess (2016),
    // applied to the 9x10 xiangqi board. A turn is a legal xiangqi move, then the
    // shared duck moves to any other empty point. The duck can never be captured
    // and is an ordinary blocking piece for every xiangqi geometry: it screens
    // for cannons, blocks the horse's leg and the elephant's eye, and breaks a
    // flying-general file.
    //
    // No check (you win by CAPTURING the general), the generals may still never
    // be left facing, stalemate is a LOSS (xiangqi's answer, the opposite of Duck
    // Chess's "fowling" rule), and 60 moves without a capture is a draw.
    //
    // Rules engine: packages/game/src/variants-duck-xiangqi.ts.
    // Design decisions D1-D9 and the balance measurement: docs-private/duck-xiangqi/.
    id: DUCK_XIANGQI_SPEC_ID,
    publicName: 'Duck Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-9x10',
    movement: 'duck-xiangqi',
    objective: 'general-capture',
    visibility: 'open',
    setup: 'standard',
    reserves: 'none',
    // The duck is not a drop: it has no reserve and is neither player's piece.
    dropPolicy: 'none',
    ratingPoolBase: 'duck_xiangqi',
    // Rating-ready like fortress: the pool lights up the moment the global
    // rated flag flips. Migration 142 added 'duck_xiangqi' to the user_ratings
    // CHECK, which is what makes this honest -- before it, a rated game failed
    // at the point of WRITING the result rather than of creating the game.
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Jungle / Dou Shou Qi (斗兽棋): perfect-information 7×9 animal-rank game. Eight
    // ranked animals; win by entering the opponent's den or capturing all pieces.
    // Rated human PvP (own pool); PvE bot games stay unrated. Rules engine:
    // packages/game/src/variants-jungle.ts.
    id: JUNGLE_SPEC_ID,
    publicName: 'Jungle Chess',
    family: 'jungle',
    board: 'jungle-7x9',
    movement: 'jungle',
    objective: 'den-or-race',
    visibility: 'open',
    setup: 'jungle-standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'jungle',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Flip Jungle (兽棋 / 翻翻棋): the 4x4 flip derivative of Dou Shou Qi. Symmetric
    // hidden-identity (both seats see the same masked board; only the deal is hidden),
    // like banqi. Equal-rank = 同归于尽 mutual destruction. Win by leaving the opponent
    // with no legal move. Rated human PvP (own pool); PvE bot games stay unrated.
    // Rules engine: packages/game/src/variants-jungle-flip.ts.
    id: JUNGLE_FLIP_SPEC_ID,
    publicName: 'Flip Jungle',
    family: 'jungle',
    board: 'jungle-flip-4x4',
    movement: 'jungle-flip',
    objective: 'last-mover',
    visibility: 'hidden-identity',
    setup: 'jungle-flip-deal',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'jungle_flip',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
] as const;

const gameSpecsById = new Map<GameSpecId, GameSpec>(GAME_SPECS.map((spec) => [spec.id, spec]));
const gameSpecIds = new Set<string>(GAME_SPECS.map((spec) => spec.id));
const gameSpecAliases = new Map<GameSpecAliasId, GameSpecId>([
  ['fog-draft960', DARK_DRAFT960_SPEC_ID],
]);

/** Specs that were built and are not coming back. Derived from GAME_SPECS so
 *  there is one place that says it: the entry's runtimeStatus. */
export const RETIRED_GAME_SPEC_IDS: readonly GameSpecId[] = GAME_SPECS.filter(
  (spec) => spec.runtimeStatus === 'retired',
).map((spec) => spec.id);

const RETIRED_GAME_SPEC_ID_SET: ReadonlySet<string> = new Set(RETIRED_GAME_SPEC_IDS);

/** True for a retired spec id (and for a legacy alias that resolves to one). */
export function isRetiredGameSpec(value: string | null | undefined): boolean {
  if (!value) return false;
  if (RETIRED_GAME_SPEC_ID_SET.has(value)) return true;
  const spec = maybeGameSpecForId(value);
  return spec !== null && spec.runtimeStatus === 'retired';
}

export function isGameSpecId(value: string | null | undefined): value is GameSpecId {
  return typeof value === 'string' && gameSpecIds.has(value);
}

export function gameSpecForId(id: GameSpecLookupId): GameSpec {
  const canonicalId = canonicalGameSpecId(id);
  if (!canonicalId) throw new Error(`unknown game spec id: ${JSON.stringify(id)}`);
  const spec = gameSpecsById.get(canonicalId);
  if (!spec) throw new Error(`unknown game spec id: ${JSON.stringify(id)}`);
  return spec;
}

export function maybeGameSpecForId(value: string | null | undefined): GameSpec | null {
  const canonicalId = canonicalGameSpecId(value);
  return canonicalId ? gameSpecForId(canonicalId) : null;
}

function canonicalGameSpecId(value: string | null | undefined): GameSpecId | null {
  if (isGameSpecId(value)) return value;
  if (value === undefined || value === null) return null;
  return gameSpecAliases.get(value as GameSpecAliasId) ?? null;
}

export type LegacyLiveRoomSpecInput = {
  variant?: VariantId | string | null;
  hiddenDraft960?: boolean | string | null;
};

export function gameSpecForLegacyLiveRoom(input: LegacyLiveRoomSpecInput): GameSpec {
  if (
    input.variant === 'draft960' ||
    input.variant === DARK_DRAFT960_SPEC_ID ||
    input.variant === 'fog-draft960' ||
    isTruthyLegacyFlag(input.hiddenDraft960)
  ) {
    return gameSpecForId(DARK_DRAFT960_SPEC_ID);
  }
  return gameSpecForId(DARK_CHESS_SPEC_ID);
}

export function legacyLiveRoomForGameSpec(id: GameSpecId): GameSpec['legacyLiveRoom'] | null {
  return gameSpecForId(id).legacyLiveRoom ?? null;
}

function isTruthyLegacyFlag(value: boolean | string | null | undefined): boolean {
  return value === true || value === '1' || value === 'true' || value === 'yes';
}

// --- Rating pools (single source of truth: the `rated` flag on each spec) ---

// The compile-time shadow of the active rated-pool set. Keep this union in sync
// with the `rated: true` specs; the game-specs test guards that they agree, and
// the union must match the user_ratings CHECK constraint (latest migration).
export type RatingVariant = Extract<
  RatingPoolBaseId,
  | 'fog'
  | 'fog_draft960'
  | 'dark_xiangqi'
  | 'jieqi'
  | 'banqi'
  | 'jungle'
  | 'jungle_flip'
  | 'fortress_xiangqi'
  // Standard Xiangqi pool. Owes a user_ratings CHECK migration adding 'xiangqi'
  // before the global rated flag + MISTBOARD_XIANGQI_ENABLED are both on.
  | 'xiangqi'
  | 'duck_xiangqi'
>;

// The active rated-pool set, derived from the `rated` flag. This is the ONE
// runtime list; server bucketing + web leaderboard/profile all derive from it,
// so a new rated variant is just a `rated: true` spec flag + a CHECK migration.
export const RATED_POOL_BASES: readonly RatingVariant[] = GAME_SPECS.flatMap((spec) =>
  spec.rated ? [spec.ratingPoolBase as RatingVariant] : [],
);

const RATED_POOL_BASE_SET = new Set<string>(RATED_POOL_BASES);

export function isRatedPoolBase(value: string | null | undefined): value is RatingVariant {
  return value != null && RATED_POOL_BASE_SET.has(value);
}

// The active rating pool for a spec, or null when the spec is casual-only.
// Callers fail closed on null (the game is simply not rated).
export function ratingPoolForSpec(id: GameSpecId): RatingVariant | null {
  const pool = gameSpecForId(id).ratingPoolBase;
  return isRatedPoolBase(pool) ? pool : null;
}
