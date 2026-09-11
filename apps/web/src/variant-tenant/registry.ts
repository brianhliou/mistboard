/**
 * Web-side VariantTenant registry — the routing/config mirror of
 * apps/server/src/variant-tenant/registry.ts. Each tenant registers its page
 * routing (postgame route, optional self-contained live client), review-URL
 * base, watch-replay mount, and landing configuration, so main.ts /
 * live-room-bootstrap / landing / game-meta / watch-route dispatch without
 * per-variant branches. Chess is deliberately NOT registered: a registry miss
 * is the chess fallback until the P2 chess migration.
 *
 * Bundle discipline: this module is imported by the entry chunk, so it may
 * hold only config and dynamic-import closures. Static hooks for tenants that
 * ride the chess live shell live in ./live-shell.ts (imported only by the
 * live-room chunk).
 */

import {
  BANQI_SPEC_ID,
  CROSSROADS_CHESS_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_CRAZYHOUSE_SPEC_ID,
  DARK_CROSSROADS_CHESS_SPEC_ID,
  DARK_MINI_XIANGQI_SPEC_ID,
  DARK_SHOGI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DROP_MINI_XIANGQI_SPEC_ID,
  DUAL_CHESS_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  type GameSpecId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  KRIEGSPIEL_SPEC_ID,
  LUZHANQI_SPEC_ID,
  MINI_XIANGQI_SPEC_ID,
  REVEAL_CHESS_SPEC_ID,
  type TimeControlId,
  variantDefaultTimeControl,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import {
  correspondenceEnabled,
  crossroadsChessEnabled,
  darkCrazyhouseEnabled,
  darkCrossroadsChessEnabled,
  darkMiniXiangqiEnabled,
  darkShogiEnabled,
  darkXiangqiEnabled,
  dropMiniXiangqiEnabled,
  duckXiangqiEnabled,
  fortressXiangqiEnabled,
  jieqiEnabled,
  jungleEnabled,
  jungleFlipEnabled,
  kriegspielEnabled,
  luzhanqiEnabled,
  revealChessEnabled,
  xiangqiEnabled,
} from '../feature-flags.js';
import type { GameMeta, ReplayHandle } from '../replay.js';

export type WebTenantEngineOption = {
  id: string;
  name: string;
  familyName: string;
  kind: string;
};

// Landing play-menu configuration. Mirrors the per-variant rows of the old
// LANDING_GAME_SPEC_CAPABILITIES table plus the picker/menu gates around it.
export type WebTenantLandingConfig = {
  capabilities: {
    firstColor: 'white' | 'red' | 'black';
    firstGlyph: string;
    firstLabel: string;
    glyphClass?: string;
    neutralGlyphColor?: boolean;
    pickerLabel?: string;
    secondColor: 'white' | 'red' | 'black';
    secondGlyph: string;
    secondLabel: string;
    supportsRated: boolean;
    supportsStartFormat: boolean;
    supportsTimeControl: boolean;
  };
  // Casual time-control presets the picker offers (rated is globally 3+2).
  //
  // OFFERING a pace is not DEFAULTING to it. Every variant offers 10+5 so a
  // player who wants a long game can ask for one; which pace is preselected is
  // VARIANT_DEFAULT_TIME_CONTROLS in @mistboard/game, and only the two variants
  // with measured evidence (xiangqi, jieqi) opt out of the house 3+2 there.
  // Widening this list costs a chip of UI and removes nothing; the usual
  // objection, matchmaking-pool fragmentation, does not apply at this repo's
  // PvP volume (9 human-vs-human games in the 2.5 months to 2026-09-01).
  timePresetIds: readonly TimeControlId[];
  // Whether the variant appears in normal play-menu entry points.
  offerInMenu(): boolean;
  // Whether a ?play deep link may select the variant (soft-launch links can be
  // live while the menu entry is still hidden).
  acceptsDeepLink(): boolean;
  // PvE engine picker entries; omit when the variant has no PvE surface wired
  // into the landing engine section.
  engineOptions?: readonly WebTenantEngineOption[];
  defaultEngineId?: string;
  // Suppress the create-game color/side picker for variants where the server
  // should always assign a side.
  hideColorPicker?: boolean;
};

export type WebVariantTenant = {
  gameSpecId: GameSpecId;
  // Pre-rename aliases still seen in persisted game records and deep links.
  legacyGameSpecIds?: readonly string[];
  roomIdPrefix: string;
  enabled(): boolean;
  pageTitle: string;
  // Post-game review route base ('/dark-xiangqi/game'); also the route main.ts
  // matches for the postgame mount. Tenants without their own postgame surface
  // (dark-chess correspondence reviews at the legacy /game/:id) omit both.
  gameRouteBase?: string;
  mountPostgame?(root: HTMLElement, roomId: string): Promise<unknown>;
  // Review-link base for finished-game cards (game-meta). Only tenants whose
  // games are linked from shared surfaces set it; others keep the legacy
  // /game/:id link those surfaces always produced.
  reviewRouteBase?: string;
  // Self-contained live-room client (Crossroads). Resolves to the bootstrap
  // function so callers can preload the chunk before swapping the URL/DOM.
  // Tenants without one ride the chess live shell (live.ts) and register
  // hooks in ./live-shell.ts instead.
  loadLiveRoomClient?(): Promise<() => unknown>;
  watch?: {
    family: string;
    mountReplay(
      root: HTMLElement,
      roomId: string,
      options: {
        autoplay: boolean;
        metadataByRoomId: Record<string, GameMeta>;
        // Homepage showcase mode: a single compact board that hands off at
        // game-end so the outer cycler can advance to the next pooled game.
        // Watch omits both (full TV chrome, loops the single game).
        compact?: boolean;
        // Compact only: the side to show the game from (the game embed's
        // ?pov=). Absent, the showcase picks a side itself.
        pov?: 'white' | 'truth' | 'black';
        onGameEnd?: () => void;
        // Player names for the compact seats (first = red/first-mover, second =
        // black), keyed by room id — the tenant postgames carry no names.
        namesByRoomId?: Record<string, { first: string; second: string }>;
        // Fires on every ply change (autoplay tick / manual jump / loop reset).
        // The /watch right rail uses it to sync its move list + scrubber.
        onPlyChange?: (ply: number, maxPly: number) => void;
        // LIVE-follow mode (homepage TV): suppress end-of-game marks at the
        // final known ply and keep the side to move active. Paired with
        // loadPostgameOverride, which serves the /api/watch/live payload in
        // place of the finished-game endpoint ({ ok: false } falls back to it).
        live?: boolean;
        loadPostgameOverride?: (
          roomId: string,
        ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
      },
    ): Promise<ReplayHandle>;
  };
  landing?: WebTenantLandingConfig;
};

const XIANGQI_CAPABILITIES_BASE = {
  firstColor: 'red',
  firstGlyph: '帥',
  firstLabel: 'Red',
  glyphClass: 'xiangqi',
  secondColor: 'black',
  secondGlyph: '將',
  secondLabel: 'Black',
} as const;

const alwaysEnabled = () => true;
// Retired/hidden from the play-menu picker (2026-07-03 xiangqi pivot,
// project_xiangqi_pivot_track). Discoverability only: acceptsDeepLink stays live
// so existing games + physical/kids deep links keep working, and the live client
// + postgame gates (their own feature-flag helpers) are untouched.
const hiddenFromMenu = () => false;
// A variant that is no longer reachable from anywhere in the UI: not in the
// picker, and no longer nameable in a play deep link. Distinct from
// hiddenFromMenu (still linkable) and from a flag (still reachable in the lab).
const retiredDeepLink = () => false;

const WEB_VARIANT_TENANTS: readonly WebVariantTenant[] = [
  {
    // Dark-chess correspondence rooms (server registration: correspondence
    // create flow). Deliberately capability-free: no loadLiveRoomClient (rooms
    // ride the chess live shell, which speaks the tenant wire since P2), no
    // postgame route (finished games review at the legacy /game/:id like every
    // dark-chess game), no landing config (the correspondence picker is its own
    // flag-gated surface, not a variant-picker row). enabled() only matters to
    // routing branches that never fire without those capabilities, so a stale
    // flag cannot strand a live room.
    gameSpecId: DARK_CHESS_SPEC_ID,
    roomIdPrefix: 'dchx_',
    enabled: correspondenceEnabled,
    pageTitle: 'Fog Chess',
  },
  {
    // Standard Xiangqi (9x10, open information). Self-contained live client on
    // the socket-client + chrome stack, no fog. Ships flag-off: xiangqiEnabled
    // gates the live client routing, the picker, and deep links together, and
    // the server gates room creation independently (MISTBOARD_XIANGQI_ENABLED).
    gameSpecId: XIANGQI_SPEC_ID,
    roomIdPrefix: 'xq_',
    enabled: xiangqiEnabled,
    pageTitle: 'Xiangqi',
    gameRouteBase: '/xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../xiangqi-postgame.js').then(({ mountXiangqiPostgame }) =>
        mountXiangqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/xiangqi/game',
    loadLiveRoomClient: () =>
      import('../live-xiangqi.js').then(
        ({ bootstrapXiangqiLiveRoom }) =>
          () =>
            bootstrapXiangqiLiveRoom(),
      ),
    // Mistboard TV channel; renders in the 'xiangqi' family (intersection
    // board). Watch-route dispatch keys on the channel spec id, not the family.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-xiangqi-replay.js').then(({ mountXiangqiWatchReplay }) =>
          mountXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        // Rated live-but-quiet (#151): the toggle stays disabled until the
        // server's MISTBOARD_RATED_ENABLED mirror flips it on for signed-in
        // players; games are account-gated again at game end.
        supportsRated: true,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      // Deliberate ladder: guests flagged 36% of xiangqi games at 3+2 (n=22,
      // measured 2026-09-01) while signed-in players flagged none, so the
      // preselected pace moves up two rungs. 3+2 stays on offer.
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: xiangqiEnabled,
      acceptsDeepLink: xiangqiEnabled,
      // Standard-Xiangqi public profiles, ordered strongest-first. FSF supplies
      // the human difficulty ladder; Pikafish is a separate elite challenge.
      // Hand-maintained mirror of XIANGQI_PUBLIC_ENGINES (apps/server/src/
      // xiangqi-engine-catalog.ts); parity is asserted by
      // variant-registry-sync.test.ts. The retired amateur/strong/strongest ids
      // and hidden Pikafish rungs stay server-resolvable for history and EvE.
      engineOptions: [
        {
          id: 'pikafish-xiangqi-level-8',
          name: 'Pikafish',
          familyName: 'Pikafish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-8',
          name: 'Fairy-Stockfish Level 8',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-7',
          name: 'Fairy-Stockfish Level 7',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-6',
          name: 'Fairy-Stockfish Level 6',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-5',
          name: 'Fairy-Stockfish Level 5',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-4',
          name: 'Fairy-Stockfish Level 4',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-3',
          name: 'Fairy-Stockfish Level 3',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-2',
          name: 'Fairy-Stockfish Level 2',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-xiangqi-level-1',
          name: 'Fairy-Stockfish Level 1',
          familyName: 'Fairy-Stockfish',
          kind: 'container',
        },
      ],
      defaultEngineId: 'fairy-stockfish-xiangqi-level-4',
    },
  },
  {
    gameSpecId: DARK_XIANGQI_SPEC_ID,
    roomIdPrefix: 'dxq_',
    enabled: alwaysEnabled,
    pageTitle: 'Fog Xiangqi',
    gameRouteBase: '/dark-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../dark-xiangqi-postgame.js').then(({ mountDarkXiangqiPostgame }) =>
        mountDarkXiangqiPostgame(root, roomId),
      ),
    // Self-contained live client on the socket-client + chrome stack.
    loadLiveRoomClient: () =>
      import('../live-dark-xiangqi.js').then(
        ({ bootstrapDarkXiangqiLiveRoom }) =>
          () =>
            bootstrapDarkXiangqiLiveRoom(),
      ),
    // Mistboard TV channel. Renders in the 'xiangqi' family (intersection board)
    // like the other xiangqi tenants; watch-route dispatch keys on the channel's
    // spec id, not the family, so they never collide on the same renderer.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-dark-xiangqi-replay.js').then(({ mountDarkXiangqiWatchReplay }) =>
          mountDarkXiangqiWatchReplay(root, roomId, options),
        ),
    },
    // Live client runs on the socket-client + chrome stack, so a menu-created
    // dxq_ room is playable. PvE uses the private belief bot via the
    // server-defaulted engine id; do not send a public engine id in the create
    // payload.
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      engineOptions: [
        {
          id: 'python-fdx-v1.1',
          name: 'Misty',
          familyName: 'Misty',
          kind: 'fog-xiangqi',
        },
      ],
      defaultEngineId: 'python-fdx-v1.1',
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: alwaysEnabled,
      acceptsDeepLink: darkXiangqiEnabled,
    },
  },
  {
    // Identity-hidden jieqi (9x10). A self-contained live client on the
    // socket-client + chrome stack (no fog: positions are public, only piece
    // identities are hidden).
    gameSpecId: JIEQI_SPEC_ID,
    roomIdPrefix: 'jq_',
    enabled: alwaysEnabled,
    pageTitle: 'Jieqi',
    gameRouteBase: '/jieqi/game',
    mountPostgame: (root, roomId) =>
      import('../live-jieqi-postgame.js').then(({ mountJieqiPostgame }) =>
        mountJieqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/jieqi/game',
    loadLiveRoomClient: () =>
      import('../live-jieqi.js').then(
        ({ bootstrapJieqiLiveRoom }) =>
          () =>
            bootstrapJieqiLiveRoom(),
      ),
    // Renders in the 'xiangqi' family (intersection board) like Dark Mini
    // Xiangqi, but watch-route dispatch keys on the channel's spec id, not the
    // family, so the two never collide on the same renderer.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-jieqi-replay.js').then(({ mountJieqiWatchReplay }) =>
          mountJieqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        // Rated opened 2026-08-28. Everything it needs was already in place: the
        // `jieqi` rating pool exists, the leaderboard serves that bucket, and the
        // server's rated switch is on in prod. This flag was the only thing shut.
        // PvE and private challenges stay unrated regardless of it, since the
        // setup dialog excludes mode === 'pve' and friend links set ratedDisabled,
        // so this opens rated MATCHMAKING for signed-in players and nothing else.
        supportsRated: true,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      // Deliberate ladder: the worst surface measured. Guests flagged 32% of
      // jieqi games at 3+2 and abandoned another 24% (n=37, 2026-09-01), for a
      // 44% rate of reaching any real result; signed-in players flagged none.
      // Hidden piece identities make every move a re-read of the board.
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: alwaysEnabled,
      acceptsDeepLink: jieqiEnabled,
      // One public identity (bot-consolidation 2026-07-21): Pikafish fronts the
      // depth-10 jieqi profile. The amateur/strongest engine ids stay
      // server-resolvable for history and EvE; no ladder until the jieqi engine
      // grows a real strength knob.
      engineOptions: [
        {
          id: 'pikafish-jieqi-strongest',
          name: 'Pikafish',
          familyName: 'Pikafish',
          kind: 'container',
        },
      ],
      defaultEngineId: 'pikafish-jieqi-strongest',
    },
  },
  {
    // Banqi (8x4 Chinese Dark Chess). Symmetric-information: a face-down tile
    // carries no colour or identity to anyone (the deal is the only hidden
    // state, hidden from both seats equally). A self-contained live client on
    // the socket-client + chrome stack, with no fog.
    gameSpecId: BANQI_SPEC_ID,
    roomIdPrefix: 'bq_',
    enabled: alwaysEnabled,
    pageTitle: 'Banqi',
    gameRouteBase: '/banqi/game',
    mountPostgame: (root, roomId) =>
      import('../live-banqi-postgame.js').then(({ mountBanqiPostgame }) =>
        mountBanqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/banqi/game',
    loadLiveRoomClient: () =>
      import('../live-banqi.js').then(
        ({ bootstrapBanqiLiveRoom }) =>
          () =>
            bootstrapBanqiLiveRoom(),
      ),
    // Banqi renders its own 8×4 SVG board; the watch-route dispatch keys on the
    // channel's spec id (not family), so this never collides with the other
    // 'xiangqi'-family SVG tenants on the same renderer.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-banqi-replay.js').then(({ mountBanqiWatchReplay }) =>
          mountBanqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'red',
        firstGlyph: '1',
        firstLabel: 'First',
        glyphClass: 'banqi-seat',
        neutralGlyphColor: true,
        pickerLabel: 'Move order',
        secondColor: 'black',
        secondGlyph: '2',
        secondLabel: 'Second',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: alwaysEnabled,
      acceptsDeepLink: alwaysEnabled,
      // One versioned bot (was 3 difficulty tiers; consolidated 2026-06-18 with the v0.2.0
      // cheap-strength eval), fronted by the merged Misty identity since 2026-07-21.
      engineOptions: [
        {
          id: 'misty-banqi',
          name: 'Misty',
          familyName: 'Misty',
          kind: 'container',
        },
      ],
      defaultEngineId: 'misty-banqi',
    },
  },
  {
    // Luzhanqi / Junqi. Hidden from normal play menus while rules/UI are still
    // being researched, but direct lzq_ rooms use the self-contained tenant
    // client and the preview page can create local research rooms.
    gameSpecId: LUZHANQI_SPEC_ID,
    roomIdPrefix: 'lzq_',
    enabled: luzhanqiEnabled,
    pageTitle: 'Luzhanqi',
    loadLiveRoomClient: () =>
      import('../live-luzhanqi.js').then(
        ({ bootstrapLuzhanqiLiveRoom }) =>
          () =>
            bootstrapLuzhanqiLiveRoom(),
      ),
  },
  {
    // Jungle / Dou Shou Qi (斗兽棋). Perfect-information 7×9 animal-rank game; a
    // self-contained live client on the socket-client + chrome stack (no fog, no
    // hidden identity). PvP-only at first (no bot wired).
    gameSpecId: JUNGLE_SPEC_ID,
    roomIdPrefix: 'jgl_',
    enabled: jungleEnabled,
    pageTitle: 'Jungle Chess',
    gameRouteBase: '/jungle/game',
    mountPostgame: (root, roomId) =>
      import('../live-jungle-postgame.js').then(({ mountJunglePostgame }) =>
        mountJunglePostgame(root, roomId),
      ),
    reviewRouteBase: '/jungle/game',
    loadLiveRoomClient: () =>
      import('../live-jungle.js').then(
        ({ bootstrapJungleLiveRoom }) =>
          () =>
            bootstrapJungleLiveRoom(),
      ),
    // Mistboard TV dispatch keys on the channel's spec id, so the 'jungle' family
    // never collides with the other SVG tenants on the shared grid renderer.
    watch: {
      family: 'jungle',
      mountReplay: (root, roomId, options) =>
        import('../watch-jungle-replay.js').then(({ mountJungleWatchReplay }) =>
          mountJungleWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'red',
        firstGlyph: '象',
        firstLabel: 'Red',
        glyphClass: 'jungle',
        // Internal id stays 'black'; the Jungle family brands its navy side
        // "Blue" (see variant-seat-label.ts), so the picker/seat label reads Blue.
        secondColor: 'black',
        secondGlyph: '象',
        secondLabel: 'Blue',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: jungleEnabled,
      acceptsDeepLink: jungleEnabled,
      // Misty Jungle: one bot, full strength. The three-rung ladder behind this
      // picker was collapsed for real on 2026-07-27 — the server now REJECTS a
      // create request naming level 1 or 3 (they stay resolvable only so finished
      // games that recorded them still replay as PvE). This single entry is no
      // longer just a UI choice hiding selectable rungs behind it.
      engineOptions: [
        {
          id: 'misty-jungle-level-2',
          name: 'Misty',
          familyName: 'Misty',
          kind: 'builtin',
        },
      ],
      defaultEngineId: 'misty-jungle-level-2',
    },
  },
  {
    // Flip Jungle (兽棋 / 翻翻棋). Symmetric hidden-identity 4×4 flip animal chess; a
    // self-contained live client on the socket-client + chrome stack (no fog; the deal
    // is hidden from both seats equally). PvP-only at launch (no bot).
    gameSpecId: JUNGLE_FLIP_SPEC_ID,
    roomIdPrefix: 'jgf_',
    enabled: jungleFlipEnabled,
    pageTitle: 'Flip Jungle',
    gameRouteBase: '/jungle-flip/game',
    mountPostgame: (root, roomId) =>
      import('../live-jungle-flip-postgame.js').then(({ mountJungleFlipPostgame }) =>
        mountJungleFlipPostgame(root, roomId),
      ),
    reviewRouteBase: '/jungle-flip/game',
    loadLiveRoomClient: () =>
      import('../live-jungle-flip.js').then(
        ({ bootstrapJungleFlipLiveRoom }) =>
          () =>
            bootstrapJungleFlipLiveRoom(),
      ),
    watch: {
      family: 'jungle',
      mountReplay: (root, roomId, options) =>
        import('../watch-jungle-flip-replay.js').then(({ mountJungleFlipWatchReplay }) =>
          mountJungleFlipWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      // Ink binds on the opening flip, so the picker offers move-order (First/Second),
      // not a colour choice — same as banqi.
      capabilities: {
        firstColor: 'red',
        firstGlyph: '1',
        firstLabel: 'First',
        glyphClass: 'banqi-seat',
        neutralGlyphColor: true,
        pickerLabel: 'Move order',
        secondColor: 'black',
        secondGlyph: '2',
        secondLabel: 'Second',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: jungleFlipEnabled,
      acceptsDeepLink: jungleFlipEnabled,
      // Tier-B MistyJungleFlip UCI engine (jungle-flip-engine in mistboard-engine),
      // served via server-jungle-flip-engine.ts. One versioned full-strength bot, like
      // banqi — fronted by the merged Misty identity since 2026-07-21.
      engineOptions: [
        {
          id: 'misty-jungle-flip',
          name: 'Misty',
          familyName: 'Misty',
          kind: 'container',
        },
      ],
      defaultEngineId: 'misty-jungle-flip',
    },
  },
  {
    // Open-information 7x7 Mini Xiangqi. It deliberately rides the shared
    // mini-xiangqi live shell with no fog mask, no reserve strips, no bot, and
    // no ratings at launch.
    gameSpecId: MINI_XIANGQI_SPEC_ID,
    roomIdPrefix: 'mxq_',
    enabled: alwaysEnabled,
    pageTitle: 'Mini Xiangqi',
    gameRouteBase: '/mini-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../mini-xiangqi-postgame.js').then(({ mountMiniXiangqiPostgame }) =>
        mountMiniXiangqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/mini-xiangqi/game',
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-mini-open-xiangqi-replay.js').then(({ mountMiniOpenXiangqiWatchReplay }) =>
          mountMiniOpenXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: hiddenFromMenu,
      // RETIRED 2026-09-04 (Brian). Mini Xiangqi was hidden from the picker in
      // the 2026-07-03 xiangqi pivot but kept an unconditional deep link, so a
      // link was its only door. Closing that door is the decision; the variant
      // itself stays enabled so existing rooms, postgames and replays survive.
      acceptsDeepLink: retiredDeepLink,
      engineOptions: [
        {
          id: 'fairy-stockfish-mini-xiangqi-very-strong',
          name: 'Fairy Stockfish - Strongest',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-mini-xiangqi-strong',
          name: 'Fairy Stockfish - Strong',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-mini-xiangqi-amateur',
          name: 'Fairy Stockfish - Amateur',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
      ],
      defaultEngineId: 'fairy-stockfish-mini-xiangqi-strong',
    },
  },
  {
    gameSpecId: DARK_MINI_XIANGQI_SPEC_ID,
    roomIdPrefix: 'dmxq_',
    enabled: alwaysEnabled,
    pageTitle: 'Dark Mini Xiangqi',
    gameRouteBase: '/dark-mini-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../dark-mini-xiangqi-postgame.js').then(({ mountDarkMiniXiangqiPostgame }) =>
        mountDarkMiniXiangqiPostgame(root, roomId),
      ),
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-mini-xiangqi-replay.js').then(({ mountMiniXiangqiWatchReplay }) =>
          mountMiniXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: true,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2'],
      offerInMenu: hiddenFromMenu,
      acceptsDeepLink: darkMiniXiangqiEnabled,
      engineOptions: [
        {
          id: 'python-dmx-v1.0',
          name: 'Misty DMX 1.0',
          familyName: 'Misty DMX',
          kind: 'container',
        },
      ],
      defaultEngineId: 'python-dmx-v1.0',
    },
  },
  {
    // Drop Mini Xiangqi (open 7x7 mini xiangqi with crazyhouse-style reserves).
    // Self-contained live client on the socket-client + chrome stack, using the
    // mini-xiangqi SVG board and reserve strips. PvE uses in-process heuristic
    // launch tiers; FSF remains a lab viewer until the variant adapter is real.
    gameSpecId: DROP_MINI_XIANGQI_SPEC_ID,
    roomIdPrefix: 'dmxqd_',
    enabled: alwaysEnabled,
    pageTitle: 'Drop Mini Xiangqi',
    gameRouteBase: '/drop-mini-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../drop-mini-xiangqi-postgame.js').then(({ mountDropMiniXiangqiPostgame }) =>
        mountDropMiniXiangqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/drop-mini-xiangqi/game',
    loadLiveRoomClient: () =>
      import('../live-drop-mini-xiangqi.js').then(
        ({ bootstrapDropMiniXiangqiLiveRoom }) =>
          () =>
            bootstrapDropMiniXiangqiLiveRoom(),
      ),
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-drop-mini-xiangqi-replay.js').then(({ mountDropMiniXiangqiWatchReplay }) =>
          mountDropMiniXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: true,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: hiddenFromMenu,
      acceptsDeepLink: dropMiniXiangqiEnabled,
      engineOptions: [
        {
          id: 'fairy-stockfish-drop-mini-xiangqi-very-strong',
          name: 'Fairy Stockfish - Strongest',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-drop-mini-xiangqi-strong',
          name: 'Fairy Stockfish - Strong',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-drop-mini-xiangqi-amateur',
          name: 'Fairy Stockfish - Amateur',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
      ],
      defaultEngineId: 'fairy-stockfish-drop-mini-xiangqi-strong',
    },
  },
  {
    // Fortress Xiangqi (open 7x8 xiangqi-with-a-pocket): faithful movement + the
    // Treasure + crazyhouse drops + the chasing rule. Self-contained live client
    // on the socket-client + chrome stack with the 7x8 corner-palace SVG board.
    // Postgame/watch surfaces are deferred; hidden until launch.
    gameSpecId: FORTRESS_XIANGQI_SPEC_ID,
    roomIdPrefix: 'fxq_',
    enabled: fortressXiangqiEnabled,
    pageTitle: 'Fortress Xiangqi',
    gameRouteBase: '/fortress-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../fortress-xiangqi-postgame.js').then(({ mountFortressXiangqiPostgame }) =>
        mountFortressXiangqiPostgame(root, roomId),
      ),
    reviewRouteBase: '/fortress-xiangqi/game',
    loadLiveRoomClient: () =>
      import('../live-fortress-xiangqi.js').then(
        ({ bootstrapFortressXiangqiLiveRoom }) =>
          () =>
            bootstrapFortressXiangqiLiveRoom(),
      ),
    // Mistboard TV channel. Renders in the 'xiangqi' family; watch-route dispatch
    // keys on the channel's spec id, not the family, so it never collides with
    // the other xiangqi tenants on the same renderer.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-fortress-xiangqi-replay.js').then(({ mountFortressXiangqiWatchReplay }) =>
          mountFortressXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: fortressXiangqiEnabled,
      acceptsDeepLink: fortressXiangqiEnabled,
      // Eight-level ladder (bot-consolidation 2026-07-21) mirroring the
      // standard-xiangqi FSF bots, ordered strongest-first like the xiangqi
      // picker. The retired amateur/strong/very-strong ids stay
      // server-resolvable for history.
      engineOptions: [8, 7, 6, 5, 4, 3, 2, 1].map((level) => ({
        id: `fairy-stockfish-fortress-xiangqi-level-${level}`,
        name: `Fairy-Stockfish Level ${level}`,
        familyName: 'Fairy-Stockfish',
        kind: 'container',
      })),
      defaultEngineId: 'fairy-stockfish-fortress-xiangqi-level-4',
    },
  },
  {
    // Duck Xiangqi: standard 9x10 xiangqi plus Duck Chess's shared, uncapturable
    // duck, which both players move — one placement at the end of every turn.
    // Hidden until launch: no menu entry and no deep link. PvE against the
    // Fairy-Stockfish ladder is wired, so a hand-built create request gets a
    // bot; the variant is simply not offered anywhere yet.
    // Rules engine: packages/game/src/variants-duck-xiangqi.ts.
    gameSpecId: DUCK_XIANGQI_SPEC_ID,
    roomIdPrefix: 'dkx_',
    enabled: duckXiangqiEnabled,
    pageTitle: 'Duck Xiangqi',
    loadLiveRoomClient: () =>
      import('../live-duck-xiangqi.js').then(
        ({ bootstrapDuckXiangqiLiveRoom }) =>
          () =>
            bootstrapDuckXiangqiLiveRoom(),
      ),
    gameRouteBase: '/duck-xiangqi/game',
    reviewRouteBase: '/duck-xiangqi/game',
    mountPostgame: (root, roomId) =>
      import('../duck-xiangqi-postgame.js').then(({ mountDuckXiangqiPostgame }) =>
        mountDuckXiangqiPostgame(root, roomId),
      ),
    // Mistboard TV channel; renders in the 'xiangqi' family (intersection
    // board). Watch-route dispatch keys on the channel spec id, not the family.
    watch: {
      family: 'xiangqi',
      mountReplay: (root, roomId, options) =>
        import('../watch-duck-xiangqi-replay.js').then(({ mountDuckXiangqiWatchReplay }) =>
          mountDuckXiangqiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        ...XIANGQI_CAPABILITIES_BASE,
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      // Games run ~177 plies at engine strength, far longer than the fog
      // tenants, so the short presets are omitted: a 1+1 game here would be
      // decided by the clock rather than the board.
      timePresetIds: ['5m5', '10m5'],
      // Both gated on the SAME predicate. The conformance test checks exactly
      // this, because gating the menu and the deep link on neighbouring flags
      // has shipped twice.
      offerInMenu: duckXiangqiEnabled,
      acceptsDeepLink: duckXiangqiEnabled,
      // Eight-level Fairy-Stockfish ladder on the patched duck binary, ordered
      // strongest-first like the other xiangqi pickers. Node-anchored and
      // classical: the node budgets are lower than the fortress ladder's at the
      // same level because the branching factor here is ~2,554 at the root, so a
      // given budget buys far less depth.
      engineOptions: [8, 7, 6, 5, 4, 3, 2, 1].map((level) => ({
        id: `fairy-stockfish-duck-xiangqi-level-${level}`,
        name: `Fairy-Stockfish Level ${level}`,
        familyName: 'Fairy-Stockfish',
        kind: 'container',
      })),
      defaultEngineId: 'fairy-stockfish-duck-xiangqi-level-4',
    },
  },
  {
    // Reveal Chess (chess-jieqi): standard 8x8 chess with hidden piece
    // IDENTITIES. Identity-hidden like jieqi (positions are public; only a
    // face-down piece's role is hidden), but on a chess board with chess colors,
    // so it renders in the 'chess' family with the cburnett pieces + a face-down
    // disc token. A self-contained live client on the socket-client + chrome
    // stack, with no fog. PvP-only at launch (no PvE engine).
    gameSpecId: REVEAL_CHESS_SPEC_ID,
    roomIdPrefix: 'rc_',
    enabled: alwaysEnabled,
    pageTitle: 'Reveal Chess',
    gameRouteBase: '/reveal-chess/game',
    mountPostgame: (root, roomId) =>
      import('../reveal-chess-postgame.js').then(({ mountRevealChessPostgame }) =>
        mountRevealChessPostgame(root, roomId),
      ),
    reviewRouteBase: '/reveal-chess/game',
    loadLiveRoomClient: () =>
      import('../live-reveal-chess.js').then(
        ({ bootstrapRevealChessLiveRoom }) =>
          () =>
            bootstrapRevealChessLiveRoom(),
      ),
    watch: {
      family: 'chess',
      mountReplay: (root, roomId, options) =>
        import('../watch-reveal-chess-replay.js').then(({ mountRevealChessWatchReplay }) =>
          mountRevealChessWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'white',
        firstGlyph: '♚',
        firstLabel: 'White',
        secondColor: 'black',
        secondGlyph: '♚',
        secondLabel: 'Black',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: revealChessEnabled,
      acceptsDeepLink: revealChessEnabled,
    },
  },
  // Perfect-information Crossroads is intentionally ranked last in the lobby
  // play-menu: it is the platform's one perfect-info surface (everything else
  // is hidden-info), kept playable but de-emphasized.
  {
    gameSpecId: CROSSROADS_CHESS_SPEC_ID,
    legacyGameSpecIds: [DUAL_CHESS_SPEC_ID],
    roomIdPrefix: 'dchess_',
    enabled: alwaysEnabled,
    pageTitle: 'Crossroads Chess',
    gameRouteBase: '/crossroads-chess/game',
    mountPostgame: (root, roomId) =>
      import('../crossroads-chess-postgame.js').then(({ mountCrossroadsChessPostgame }) =>
        mountCrossroadsChessPostgame(root, roomId),
      ),
    reviewRouteBase: '/crossroads-chess/game',
    // Routed to its own isolated client before the shared live-room shell so
    // it never touches the fog-critical live.ts monolith.
    loadLiveRoomClient: () =>
      import('../live-crossroads-chess.js').then(
        ({ bootstrapCrossroadsChessLiveRoom }) =>
          () =>
            bootstrapCrossroadsChessLiveRoom(),
      ),
    watch: {
      family: 'crossroads-chess',
      mountReplay: (root, roomId, options) =>
        import('../watch-crossroads-chess-replay.js').then(({ mountCrossroadsChessWatchReplay }) =>
          mountCrossroadsChessWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'white',
        firstGlyph: '♚',
        firstLabel: 'White',
        secondColor: 'black',
        secondGlyph: '♚',
        secondLabel: 'Black',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: crossroadsChessEnabled,
      acceptsDeepLink: crossroadsChessEnabled,
      // Ordered strongest-first so the toughest opponent sits at the top of the picker.
      engineOptions: [
        {
          id: 'fairy-stockfish-crossroads-very-strong',
          name: 'Fairy Stockfish - Strongest',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-crossroads-strong',
          name: 'Fairy Stockfish - Strong',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
        {
          id: 'fairy-stockfish-crossroads-amateur',
          name: 'Fairy Stockfish - Amateur',
          familyName: 'Fairy Stockfish',
          kind: 'container',
        },
      ],
      defaultEngineId: 'fairy-stockfish-crossroads-strong',
    },
  },
  {
    // Dark Crossroads Chess (fog 6x8): the FOG sibling of perfect-info
    // Crossroads. A self-contained live client on the socket-client + chrome
    // stack with the fog-safe replay-CAPTURE model (live-dark-crossroads-chess.ts,
    // NOT the open client's reconstruct-from-state path, which would leak under
    // fog); the board renderer is shared with the open variant (already
    // fog-aware). PvP-only — Fairy-Stockfish is perfect-info and can't play fog
    // crossroads, so there is no PvE. Postgame review and Mistboard TV share the
    // white/truth/red fog triptych.
    gameSpecId: DARK_CROSSROADS_CHESS_SPEC_ID,
    roomIdPrefix: 'ddchess_',
    enabled: alwaysEnabled,
    pageTitle: 'Dark Crossroads Chess',
    gameRouteBase: '/dark-crossroads-chess/game',
    mountPostgame: (root, roomId) =>
      import('../dark-crossroads-chess-postgame.js').then(({ mountDarkCrossroadsChessPostgame }) =>
        mountDarkCrossroadsChessPostgame(root, roomId),
      ),
    reviewRouteBase: '/dark-crossroads-chess/game',
    loadLiveRoomClient: () =>
      import('../live-dark-crossroads-chess.js').then(
        ({ bootstrapDarkCrossroadsChessLiveRoom }) =>
          () =>
            bootstrapDarkCrossroadsChessLiveRoom(),
      ),
    watch: {
      family: 'crossroads-chess',
      mountReplay: (root, roomId, options) =>
        import('../watch-dark-crossroads-chess-replay.js').then(
          ({ mountDarkCrossroadsChessWatchReplay }) =>
            mountDarkCrossroadsChessWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      // White vs Red (the variant's actual colors), so the picker's
      // preferredColor maps straight onto the room route's parser.
      capabilities: {
        firstColor: 'white',
        firstGlyph: '♚',
        firstLabel: 'White',
        secondColor: 'red',
        secondGlyph: '♚',
        secondLabel: 'Red',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: darkCrossroadsChessEnabled,
      acceptsDeepLink: darkCrossroadsChessEnabled,
    },
  },
  {
    // Dark Shogi (fog 9x9): a fog tenant on the socket-client + chrome stack with
    // the fog-safe replay-CAPTURE model (live-dark-shogi.ts). Net-new surface vs
    // the other fog tenants — a koma board (shogi-render.ts), reserve (hand)
    // strips, drop + promotion interaction — and PRIVATE hands (the view carries
    // only your own reserve). PvP-only (no bot yet). Postgame review is the
    // black/truth/white fog triptych. Shogi declares black (sente) as the first
    // side and white (gote) as the second, so future shogi-family tenants can
    // reuse the same picker model.
    gameSpecId: DARK_SHOGI_SPEC_ID,
    roomIdPrefix: 'dsg_',
    enabled: darkShogiEnabled,
    pageTitle: 'Fog Shogi',
    gameRouteBase: '/dark-shogi/game',
    mountPostgame: (root, roomId) =>
      import('../dark-shogi-postgame.js').then(({ mountDarkShogiPostgame }) =>
        mountDarkShogiPostgame(root, roomId),
      ),
    reviewRouteBase: '/dark-shogi/game',
    loadLiveRoomClient: () =>
      import('../live-dark-shogi.js').then(
        ({ bootstrapDarkShogiLiveRoom }) =>
          () =>
            bootstrapDarkShogiLiveRoom(),
      ),
    watch: {
      family: 'shogi',
      mountReplay: (root, roomId, options) =>
        import('../watch-dark-shogi-replay.js').then(({ mountDarkShogiWatchReplay }) =>
          mountDarkShogiWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'black',
        firstGlyph: '☗',
        firstLabel: 'Sente',
        glyphClass: 'shogi',
        secondColor: 'white',
        secondGlyph: '☖',
        secondLabel: 'Gote',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: hiddenFromMenu,
      acceptsDeepLink: darkShogiEnabled,
    },
  },
  {
    // Dark Crazyhouse (fog 8x8 chess + drops): a fog tenant on the socket-client +
    // chrome stack with the fog-safe replay-CAPTURE model (live-dark-crazyhouse.ts).
    // Reuses the existing 8x8 chess board + chess fog; new surface is the reserve
    // (hand) strips + drop UI + 4-way promotion + the PARACHUTE BOUNCE (a fog drop
    // onto a hidden piece comes back as 'drop-rejected'). PRIVATE hands. PvP-only,
    // no bot. Standard white-first, so it gets a real White/Black color picker.
    gameSpecId: DARK_CRAZYHOUSE_SPEC_ID,
    roomIdPrefix: 'dczh_',
    enabled: alwaysEnabled,
    pageTitle: 'Dark Crazyhouse',
    gameRouteBase: '/dark-crazyhouse/game',
    mountPostgame: (root, roomId) =>
      import('../dark-crazyhouse-postgame.js').then(({ mountDarkCrazyhousePostgame }) =>
        mountDarkCrazyhousePostgame(root, roomId),
      ),
    reviewRouteBase: '/dark-crazyhouse/game',
    loadLiveRoomClient: () =>
      import('../live-dark-crazyhouse.js').then(
        ({ bootstrapDarkCrazyhouseLiveRoom }) =>
          () =>
            bootstrapDarkCrazyhouseLiveRoom(),
      ),
    watch: {
      family: 'chess',
      mountReplay: (root, roomId, options) =>
        import('../watch-dark-crazyhouse-replay.js').then(({ mountDarkCrazyhouseWatchReplay }) =>
          mountDarkCrazyhouseWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'white',
        firstGlyph: '♚',
        firstLabel: 'White',
        secondColor: 'black',
        secondGlyph: '♚',
        secondLabel: 'Black',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: hiddenFromMenu,
      acceptsDeepLink: darkCrazyhouseEnabled,
    },
  },
  {
    // Kriegspiel (standard chess played blind): a hidden-info tenant on the
    // socket-client + chrome stack with the fog-safe replay-CAPTURE model
    // (live-kriegspiel.ts). The board shows only the viewer's own army; the
    // opponent's move never arrives — only the UMPIRE ANNOUNCEMENT does (capture
    // square + pawn/piece, check category), with the move coordinates redacted.
    // The try-loop bounce surfaces as 'kriegspiel-illegal'. Real checkmate.
    // PvP-only, no bot. Standard white-first, so it gets a White/Black picker.
    gameSpecId: KRIEGSPIEL_SPEC_ID,
    roomIdPrefix: 'kr_',
    enabled: alwaysEnabled,
    pageTitle: 'Kriegspiel',
    gameRouteBase: '/kriegspiel/game',
    mountPostgame: (root, roomId) =>
      import('../kriegspiel-postgame.js').then(({ mountKriegspielPostgame }) =>
        mountKriegspielPostgame(root, roomId),
      ),
    reviewRouteBase: '/kriegspiel/game',
    loadLiveRoomClient: () =>
      import('../live-kriegspiel.js').then(
        ({ bootstrapKriegspielLiveRoom }) =>
          () =>
            bootstrapKriegspielLiveRoom(),
      ),
    watch: {
      family: 'chess',
      mountReplay: (root, roomId, options) =>
        import('../watch-kriegspiel-replay.js').then(({ mountKriegspielWatchReplay }) =>
          mountKriegspielWatchReplay(root, roomId, options),
        ),
    },
    landing: {
      capabilities: {
        firstColor: 'white',
        firstGlyph: '♚',
        firstLabel: 'White',
        secondColor: 'black',
        secondGlyph: '♚',
        secondLabel: 'Black',
        supportsRated: false,
        supportsStartFormat: false,
        supportsTimeControl: true,
      },
      timePresetIds: ['1m1', '3m2', '5m5', '10m5'],
      offerInMenu: kriegspielEnabled,
      acceptsDeepLink: kriegspielEnabled,
    },
  },
];

export function webVariantTenants(): readonly WebVariantTenant[] {
  return WEB_VARIANT_TENANTS;
}

export function webVariantTenantForRoomId(roomId: string): WebVariantTenant | null {
  return WEB_VARIANT_TENANTS.find((tenant) => roomId.startsWith(tenant.roomIdPrefix)) ?? null;
}

// Spec-id lookup, accepting legacy aliases (persisted records and deep links
// can still carry 'dual-chess').
export function webVariantTenantForSpecId(value: string | null): WebVariantTenant | null {
  if (!value) return null;
  return (
    WEB_VARIANT_TENANTS.find(
      (tenant) => tenant.gameSpecId === value || tenant.legacyGameSpecIds?.includes(value),
    ) ?? null
  );
}

/**
 * The pace a variant's picker preselects. A thin re-export of the shared policy
 * in @mistboard/game, which the SERVER also applies when a bot-id create omits
 * a time control — one table, so the chip and the create route cannot drift.
 *
 * Preselection only: the rest of the variant's ladder stays on offer, and a
 * player's stored preference outranks it.
 */
export function defaultTimePresetForSpec(gameSpecId: string | null): TimeControlId {
  return variantDefaultTimeControl(gameSpecId ?? '').id;
}
