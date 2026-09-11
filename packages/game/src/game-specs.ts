import type { VariantId } from './types.js';

export type GameFamilyId =
  | 'chess'
  | 'xiangqi'
  | 'shogi'
  | 'omega-chess'
  | 'crossroads-chess'
  | 'jungle'
  | 'military-chess'
  | 'mahjong';
export type BoardGeometryId =
  | 'chess-8x8'
  | 'xiangqi-7x7'
  | 'xiangqi-9x10'
  | 'shogi-9x9'
  | 'omega-10x10-plus-corners'
  | 'crossroads-6x8'
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
  | 'mini-xiangqi'
  | 'xiangqi'
  | 'shogi'
  | 'omega'
  | 'seirawan'
  | 'crossroads-chess'
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
// 'royal-capture-or-race': capture/checkmate the royal OR race it to the enemy
// home rank (the Crossroads Chess "Try"). Open mode keeps checkmate, dark switches to
// king-capture; the visibility axis + rules module resolve which.
// 'last-mover': win by leaving the opponent with no legal move (banqi). The
// general is NOT royal — capturing it does not end the game (the opponent flips
// or plays on) — so this subsumes "all pieces captured" and stalemate alike.
export type ObjectiveRulesId =
  | 'king-capture'
  | 'general-capture'
  | 'checkmate'
  | 'antichess'
  | 'royal-capture-or-race'
  | 'last-mover'
  | 'flag-capture'
  // 'den-or-race': win by moving a piece into the opponent's den OR capturing all
  // their pieces (Jungle / Dou Shou Qi). No royal piece; perfect information.
  | 'den-or-race'
  // Mahjong: assemble four sets and a pair from a concealed hand. No royal
  // piece, no capture, and no position to win on.
  | 'four-sets-and-a-pair';
// 'open' = perfect-information (the Crossroads Chess onboarding mode); 'dark' is
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
  | 'mini-standard'
  | 'double-fischer-random'
  | 'crossroads-standard'
  | 'jieqi-deal'
  | 'banqi-deal'
  | 'reveal-chess-deal'
  | 'jungle-standard'
  | 'jungle-flip-deal'
  | 'fortress-standard'
  | 'luzhanqi-formation'
  | 'mahjong-deal';
export type ReserveRulesId = 'none' | 'crazyhouse' | 'shogi-hands' | 'seirawan-gating';
export type DropPolicyId =
  | 'none'
  | 'any-legal-square'
  | 'not-enemy-palace'
  // Fortress Xiangqi flagship: attackers (chariot/horse/cannon/soldier/treasure)
  // parachute anywhere incl. the enemy half; defenders (advisor/elephant) drop
  // only where they may legally stand (palace / own half).
  | 'attacker-anywhere-defender-home'
  | 'seen-squares-only'
  | 'seirawan-gating';
export type GameSpecSurface = 'hidden' | 'beta' | 'casual' | 'rated';
export type GameSpecRuntimeStatus = 'live' | 'dev-spike' | 'future';

export type RatingPoolBaseId =
  | 'fog'
  | 'fog_draft960'
  | 'dark_crazyhouse'
  | 'kriegspiel'
  | 'dark_antichess'
  | 'sun_tzu'
  | 'lao_tzu'
  | 'dark_seirawan'
  | 'mini_xiangqi'
  | 'dark_mini_xiangqi'
  | 'drop_mini_xiangqi'
  | 'dark_xiangqi'
  | 'dark_shogi'
  | 'dark_omega'
  | 'jieqi'
  | 'banqi'
  | 'crossroads_chess'
  | 'crossroads_chess_open'
  | 'reveal_chess'
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
  | 'dark-crazyhouse'
  | 'kriegspiel'
  | 'dark-antichess'
  | 'sun-tzu'
  | 'lao-tzu'
  | 'dark-seirawan'
  | 'mini-xiangqi'
  | 'dark-mini-xiangqi'
  | 'drop-mini-xiangqi'
  | 'dark-xiangqi'
  | 'dark-shogi'
  | 'dark-omega'
  | 'jieqi'
  | 'banqi'
  | 'crossroads-chess'
  | 'dark-crossroads-chess'
  | 'reveal-chess'
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
  // Hong Kong mahjong. Registered so the fail-closed dispatch can see it;
  // runtimeStatus is 'future' because nothing is built behind it yet.
  | 'mahjong';
export type GameSpecAliasId = 'fog-draft960' | 'dual-chess' | 'dark-dual-chess';
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
export const MINI_XIANGQI_SPEC_ID = 'mini-xiangqi' satisfies GameSpecId;
export const DARK_MINI_XIANGQI_SPEC_ID = 'dark-mini-xiangqi' satisfies GameSpecId;
export const DROP_MINI_XIANGQI_SPEC_ID = 'drop-mini-xiangqi' satisfies GameSpecId;
export const DARK_XIANGQI_SPEC_ID = 'dark-xiangqi' satisfies GameSpecId;
export const JIEQI_SPEC_ID = 'jieqi' satisfies GameSpecId;
export const BANQI_SPEC_ID = 'banqi' satisfies GameSpecId;
export const MAHJONG_SPEC_ID = 'mahjong' satisfies GameSpecId;
export const DARK_SHOGI_SPEC_ID = 'dark-shogi' satisfies GameSpecId;
export const DARK_CRAZYHOUSE_SPEC_ID = 'dark-crazyhouse' satisfies GameSpecId;
export const KRIEGSPIEL_SPEC_ID = 'kriegspiel' satisfies GameSpecId;
export const CROSSROADS_CHESS_SPEC_ID = 'crossroads-chess' satisfies GameSpecId;
export const REVEAL_CHESS_SPEC_ID = 'reveal-chess' satisfies GameSpecId;
export const DARK_CROSSROADS_CHESS_SPEC_ID = 'dark-crossroads-chess' satisfies GameSpecId;
export const JUNGLE_SPEC_ID = 'jungle' satisfies GameSpecId;
export const JUNGLE_FLIP_SPEC_ID = 'jungle-flip' satisfies GameSpecId;
export const FORTRESS_XIANGQI_SPEC_ID = 'fortress-xiangqi' satisfies GameSpecId;
export const LUZHANQI_SPEC_ID = 'luzhanqi' satisfies GameSpecId;
export const XIANGQI_SPEC_ID = 'xiangqi' satisfies GameSpecId;
export const DUCK_XIANGQI_SPEC_ID = 'duck-xiangqi' satisfies GameSpecId;
// Compatibility aliases for records and links created before the Crossroads
// rename. New code should use CROSSROADS_CHESS_SPEC_ID.
export const DUAL_CHESS_SPEC_ID = 'dual-chess' satisfies GameSpecAliasId;
export const DARK_DUAL_CHESS_SPEC_ID = 'dark-dual-chess' satisfies GameSpecAliasId;

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
  DARK_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  // Duck Xiangqi qualifies on the same two counts as the rest: it has a
  // tree-review stack (review/duck-xiangqi-tree-adapter.ts + -review.ts) and a
  // deterministic start position spellable as a FEN (duck-xiangqi-fen.ts, whose
  // seventh field carries the duck). Last in the list because it is last in
  // canonicalVariantOrderIndex — unlisted specs sort to the end, and the picker
  // order test reads that index rather than this array.
  DUCK_XIANGQI_SPEC_ID,
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
    publicSurface: 'casual',
    runtimeStatus: 'live',
    legacyLiveRoom: { variant: 'dark-chess', hiddenDraft960: true },
  },
  {
    id: 'dark-crazyhouse',
    publicName: 'Dark Crazyhouse',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'crazyhouse',
    dropPolicy: 'any-legal-square',
    ratingPoolBase: 'dark_crazyhouse',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: 'kriegspiel',
    publicName: 'Kriegspiel',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'checkmate',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'kriegspiel',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: 'dark-antichess',
    publicName: 'Dark Antichess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'antichess',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'dark_antichess',
    publicSurface: 'hidden',
    runtimeStatus: 'future',
  },
  {
    id: 'sun-tzu',
    publicName: 'Sun Tzu chess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'double-fischer-random',
    reserves: 'crazyhouse',
    dropPolicy: 'any-legal-square',
    ratingPoolBase: 'sun_tzu',
    publicSurface: 'hidden',
    runtimeStatus: 'future',
  },
  {
    id: 'lao-tzu',
    publicName: 'Lao Tzu chess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'double-fischer-random',
    reserves: 'crazyhouse',
    dropPolicy: 'seen-squares-only',
    ratingPoolBase: 'lao_tzu',
    publicSurface: 'hidden',
    runtimeStatus: 'future',
  },
  {
    id: 'dark-seirawan',
    publicName: 'Dark Seirawan chess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'seirawan',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'seirawan-gating',
    dropPolicy: 'seirawan-gating',
    ratingPoolBase: 'dark_seirawan',
    publicSurface: 'hidden',
    runtimeStatus: 'future',
  },
  // ── Mini Xiangqi cluster: PARKED as of 2026-07-24 ──────────────────────────
  // The mini-xiangqi sub-family was retired from the product shelf in the
  // 2026-07-03 xiangqi pivot (memory: project_xiangqi_pivot_track) and is
  // flag-gated OFF in prod: Mini has no launch flag (the request gate answers
  // `mini_xiangqi_not_integrated`); Dark/Drop Mini gate on
  // MISTBOARD_{DARK,DROP}_MINI_XIANGQI_ENABLED (off outside the lab). The code,
  // tenants, and rules stay fully wired for revival, so `runtimeStatus` remains
  // 'live'; `publicSurface: 'hidden'` keeps them off every discoverability rail
  // (same shape as luzhanqi above). Their test suites are parked in
  // *.parkedtest.ts (run: npm run test:parked) rather than the default suite.
  // To revive: flip the flag, restore publicSurface, and rename the tests back.
  {
    // Mini Xiangqi: the open-information 7x7 base game for the mini-xiangqi
    // cluster. It is the clean rules/puzzle/training substrate for Drop Mini
    // Xiangqi and Dark Mini Xiangqi.
    id: MINI_XIANGQI_SPEC_ID,
    publicName: 'Mini Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-7x7',
    movement: 'mini-xiangqi',
    objective: 'checkmate',
    visibility: 'open',
    setup: 'mini-standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'mini_xiangqi',
    publicSurface: 'hidden',
    runtimeStatus: 'live',
  },
  {
    id: DARK_MINI_XIANGQI_SPEC_ID,
    publicName: 'Dark Mini Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-7x7',
    movement: 'mini-xiangqi',
    objective: 'general-capture',
    visibility: 'dark',
    setup: 'mini-standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'dark_mini_xiangqi',
    rated: true,
    publicSurface: 'hidden',
    runtimeStatus: 'live',
  },
  {
    // Drop Mini Xiangqi: mini xiangqi plus crazyhouse-style reserves. Perfect
    // information; red/black seats match the 7x7 Dark Mini Xiangqi board.
    // Rules engine: packages/game/src/variants-drop-mini-xiangqi.ts.
    id: DROP_MINI_XIANGQI_SPEC_ID,
    publicName: 'Drop Mini Xiangqi',
    family: 'xiangqi',
    board: 'xiangqi-7x7',
    movement: 'mini-xiangqi',
    objective: 'checkmate',
    visibility: 'open',
    setup: 'mini-standard',
    reserves: 'crazyhouse',
    dropPolicy: 'not-enemy-palace',
    ratingPoolBase: 'drop_mini_xiangqi',
    rated: true,
    publicSurface: 'hidden',
    runtimeStatus: 'live',
  },
  {
    // Fortress Xiangqi: "xiangqi with a pocket." 7x8 board, opposite-corner
    // palaces, faithful xiangqi movement plus the one new Treasure piece, and
    // crazyhouse drops (both-side attacker drops + the chasing rule). Ships
    // alongside the 7x7 Drop Mini Xiangqi as a distinct variant + rating pool.
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
    runtimeStatus: 'future',
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
    runtimeStatus: 'live',
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
    // Not rated until the pool migration lands and the bot ladder is calibrated.
    publicSurface: 'hidden',
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
  {
    id: DARK_SHOGI_SPEC_ID,
    publicName: 'Fog Shogi',
    family: 'shogi',
    board: 'shogi-9x9',
    movement: 'shogi',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'shogi-hands',
    dropPolicy: 'any-legal-square',
    ratingPoolBase: 'dark_shogi',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: 'dark-omega',
    publicName: 'Dark Omega chess',
    family: 'omega-chess',
    board: 'omega-10x10-plus-corners',
    movement: 'omega',
    objective: 'king-capture',
    visibility: 'dark',
    setup: 'standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'dark_omega',
    publicSurface: 'hidden',
    runtimeStatus: 'future',
  },
  {
    // Crossroads Chess (中西象棋): a 6x8 chess x xiangqi fusion. Two modes share one
    // family/board/movement and split on the visibility axis. Perfect-info is the
    // onboarding ladder (keeps checkmate); dark is the real mode (king-capture).
    // Rules engine: packages/game/src/variants-crossroads-chess.ts.
    id: CROSSROADS_CHESS_SPEC_ID,
    publicName: 'Crossroads Chess',
    family: 'crossroads-chess',
    board: 'crossroads-6x8',
    movement: 'crossroads-chess',
    objective: 'royal-capture-or-race',
    visibility: 'open',
    setup: 'crossroads-standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'crossroads_chess_open',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    id: DARK_CROSSROADS_CHESS_SPEC_ID,
    publicName: 'Dark Crossroads Chess',
    family: 'crossroads-chess',
    board: 'crossroads-6x8',
    movement: 'crossroads-chess',
    objective: 'royal-capture-or-race',
    visibility: 'dark',
    setup: 'crossroads-standard',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'crossroads_chess',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
  {
    // Reveal Chess (chess-jieqi): standard chess with hidden piece identities.
    // Both kings start face-up; each side's other 15 pieces are dealt face-down
    // and reveal their true identity on first move (origin-role proxy until
    // then). Real check/checkmate. Rules engine: variants-reveal-chess.ts.
    id: REVEAL_CHESS_SPEC_ID,
    publicName: 'Reveal Chess',
    family: 'chess',
    board: 'chess-8x8',
    movement: 'orthodox-chess',
    objective: 'checkmate',
    visibility: 'hidden-identity',
    setup: 'reveal-chess-deal',
    reserves: 'none',
    dropPolicy: 'none',
    ratingPoolBase: 'reveal_chess',
    rated: true,
    publicSurface: 'casual',
    runtimeStatus: 'live',
  },
] as const;

const gameSpecsById = new Map<GameSpecId, GameSpec>(GAME_SPECS.map((spec) => [spec.id, spec]));
const gameSpecIds = new Set<string>(GAME_SPECS.map((spec) => spec.id));
const gameSpecAliases = new Map<GameSpecAliasId, GameSpecId>([
  ['fog-draft960', DARK_DRAFT960_SPEC_ID],
  ['dual-chess', CROSSROADS_CHESS_SPEC_ID],
  ['dark-dual-chess', DARK_CROSSROADS_CHESS_SPEC_ID],
]);

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
  | 'dark_mini_xiangqi'
  | 'drop_mini_xiangqi'
  | 'dark_xiangqi'
  | 'dark_crazyhouse'
  | 'dark_shogi'
  | 'crossroads_chess'
  | 'crossroads_chess_open'
  | 'jieqi'
  | 'banqi'
  | 'kriegspiel'
  | 'reveal_chess'
  | 'jungle'
  | 'jungle_flip'
  | 'fortress_xiangqi'
  // Standard Xiangqi pool. Owes a user_ratings CHECK migration adding 'xiangqi'
  // before the global rated flag + MISTBOARD_XIANGQI_ENABLED are both on.
  | 'xiangqi'
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
