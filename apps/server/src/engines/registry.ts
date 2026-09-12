import type pg from 'pg';
import { JIEQI_ENGINE_VERSION } from '../jieqi-engine.js';
import {
  XIANGQI_FSF_ENGINE_REF,
  XIANGQI_FSF_ENGINE_VERSION,
  XIANGQI_FSF_NNUE_NET,
  XIANGQI_FSF_PLAYABLE_ENGINES,
  type XiangqiFsfEngineTier,
} from '../xiangqi-fsf-engine.js';
import { XIANGQI_ALL_ENGINE_TIERS, XIANGQI_ENGINE_VERSION } from '../xiangqi-pikafish-engine.js';
import {
  XIANGQI_RANDOM_ENGINE_ID,
  XIANGQI_RANDOM_ENGINE_VERSION,
} from '../xiangqi-random-engine.js';
import { BUILTIN_ENGINES } from './builtin/index.js';
import type { EngineClientId, EngineDefinition, EngineId } from './types.js';

type Queryable = Pick<pg.Client | pg.Pool | pg.PoolClient, 'query'>;

export type {
  EngineClientId,
  EngineConfig,
  EngineDefinition,
  EngineId,
  EngineMoveContext,
  EngineMoveDecision,
  EngineMoveScore,
} from './types.js';

export function defaultEngineId(): EngineId {
  return 'builtin-random-legal';
}

export function builtinEngineIds(): string[] {
  return Object.keys(BUILTIN_ENGINES);
}

export function playableBuiltinEngines(): EngineDefinition[] {
  return builtinEngineIds()
    .map((engineId) => loadEngine(engineId))
    .filter((engine) => engine.kind === 'builtin' && engine.chooseMove);
}

// Streamlined release (2026-06-02): only Misty (versioned v2) is player-facing.
// Legacy (v0.9.5) and Random stay in the registry for EvE/testing/historical
// records, but are NOT offered in the live PvE picker. No random fallback in the
// PvE serving path — if Misty can't serve it fails loudly (503), by design.
const PROD_PLAYABLE_ENGINE_IDS = new Set<EngineId>([
  // GO-LIVE (2026-06-21): flip the player-facing PvE engine python-v2-v1.4 -> v1.5.
  // Misty 1.5 = v1.4 profile + a curated opening book (drop the now-redundant 2.Nc3
  // forces — v1.2's king guard covers the a5-e1 diagonal on its own; force ...dxe4
  // after 1.Nf3 d5 2.e4 to kill the ~6% move-2 commit-slip to c6). The engine-worker
  // already deploys engine 8b4935b (Phase 1, engine-ref-deployed=8b4935b verified) and
  // can load python-v2-v1.5, so this flip has no offer-without-serve window. v1.4 stays
  // KNOWN (for replay/provenance); roll back by restoring 'python-v2-v1.4' + reverting
  // engine.ref to 3ae331c.
  // GO-LIVE (2026-08-23): flip the player-facing PvE engine v1.5 -> v1.6 (the
  // catastrophe prune's net-hang floor; fixes the Qxe8/Qxf2 queen-hang class,
  // second prod instance 12c8ff99). The engine-worker deploys engine 350dc20
  // (engine-ref-deployed verified) and can load python-v2-v1.6, so this flip has
  // no offer-without-serve window. v1.5 stays KNOWN (replay/provenance); roll
  // back by restoring 'python-v2-v1.5' + reverting engine.ref to e97009e.
  'python-v2-v1.6', // Misty 1.6 (net-hang prune floor; supersedes 1.5)
]);

// Opt-in extras for load testing / local experimentation. Set
// MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-random-legal,foo to enable.
// Default empty → prod behavior is unchanged.
function extraPlayableEngineIds(): Set<string> {
  const raw = process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function playableLiveEngines(): EngineDefinition[] {
  const extras = extraPlayableEngineIds();
  return Object.values(KNOWN_ENGINES).filter(
    (engine) => PROD_PLAYABLE_ENGINE_IDS.has(engine.id) || extras.has(engine.id),
  );
}

export function isPlayableLiveEngineClientId(
  clientId: string | undefined,
): clientId is EngineClientId {
  if (!clientId) return false;
  const engineId = clientId === 'random-engine' ? defaultEngineId() : clientId;
  return playableLiveEngines().some((engine) => engine.id === engineId);
}

// Broad "is this seat an engine (not a human)?" check — true for ANY engine in
// the registry, playable or not. Use this to IDENTIFY an engine seat in an
// existing game (hydration, recovery, historical records), as opposed to
// isPlayableLiveEngineClientId, which gates what the live picker may OFFER. The
// two predicates diverged when the picker was streamlined to a single engine
// (2026-06-02): legacy/random games still exist and must be recognized, even
// though those engines are no longer offered.
export function isKnownEngineClientId(clientId: string | undefined): clientId is EngineClientId {
  if (!clientId) return false;
  const engineId = clientId === 'random-engine' ? defaultEngineId() : clientId;
  return engineId in KNOWN_ENGINES;
}

// True iff `clientId` is a registered engine that plays Dark Mini Xiangqi. Used
// to (a) validate a PvE create request's engineId and (b) identify the engine
// seat in a DMX room (its seat holds this id, set by a seat-assigned event).
export function isDarkMiniXiangqiEngineClientId(
  clientId: string | undefined,
): clientId is EngineId {
  if (!clientId) return false;
  return KNOWN_ENGINES[clientId]?.gameSpecId === 'dark-mini-xiangqi';
}

// True iff `clientId` is a registered engine that plays full Dark Xiangqi.
export function isDarkXiangqiEngineClientId(clientId: string | undefined): clientId is EngineId {
  if (!clientId) return false;
  return KNOWN_ENGINES[clientId]?.gameSpecId === 'dark-xiangqi';
}

// The default Dark Mini Xiangqi PvE engine (the single player-facing DMX engine,
// mirroring Misty for chess).
export const DARK_MINI_XIANGQI_DEFAULT_ENGINE_ID: EngineId = 'python-dmx-v1.0';
export const DARK_XIANGQI_DEFAULT_ENGINE_ID: EngineId = 'python-fdx-v1.2';

const PYTHON_ENGINES: Record<string, EngineDefinition> = {
  'python-tier1-v0.9.5': {
    id: 'python-tier1-v0.9.5',
    engineId: 'tier1',
    engineName: 'Misty Legacy',
    name: 'Misty Legacy',
    kind: 'container',
    configHash: 'tier1-v0.9.5-372b4bb6c064',
    playSignature: '372b4bb6c064',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: '0.9.5',
      config: 'tier1-v1',
      config_hash: '372b4bb6c064',
      engine_pin: 'v0.9.5-tactical-patches@372b4bb6c064',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes:
      'Misty Legacy: prior first-party engine kept in-registry (EvE/records) ' +
      'but hidden from the live picker.',
  },
  // Uses current src/fow_chess/. Skipped by PROD_PLAYABLE_ENGINE_IDS — only
  // available locally via the MISTBOARD_EXTRA_PLAYABLE_ENGINES env var.
  // Intended for asymmetric strength testing against a moving target codebase.
  'python-tier1-current': {
    id: 'python-tier1-current',
    engineId: 'tier1',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine dev build',
    kind: 'container',
    configHash: 'tier1-current',
    playSignature: 'current',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: 'current',
      config: 'tier1-v1',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes: 'Current first-party engine source checkout. Local-only; for strength testing.',
  },
  // Current v2 development engine. Local-only: enable via
  // MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-v2-current. Uses a generous timeout
  // because this path is for strength testing, not the production picker.
  'python-v2-current': {
    id: 'python-v2-current',
    engineId: 'v2',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine v2 dev build',
    kind: 'container',
    configHash: 'v2-current',
    playSignature: 'v2-current',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-current',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes: 'Current v2 development engine. Local-only; for strength testing.',
  },
  // Local-only A/B for the human gadget match (2026-06-14). Both use current
  // src/fow_chess/; the live worker maps the engine-id to an engine_profile
  // (strongest = shipped gadget-off; faithful = Obscuro Resolve, cvar=0). Enable:
  // MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-v2-strongest,python-v2-faithful
  'python-v2-strongest': {
    id: 'python-v2-strongest',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty (Strongest · gadget-off)',
    kind: 'container',
    configHash: 'v2-strongest-local',
    playSignature: 'v2-strongest',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-strongest',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes: 'Local-only A/B: shipped STRONGEST profile (gadget-off). Worker maps id->profile.',
  },
  'python-v2-faithful': {
    id: 'python-v2-faithful',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty (Faithful · Resolve)',
    kind: 'container',
    configHash: 'v2-faithful-local',
    playSignature: 'v2-faithful',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-faithful',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes: 'Local-only A/B: faithful Obscuro Resolve (cvar=0, gadget-on). Worker maps id->profile.',
  },
  // Local-only A/B for the king-safe human gate (2026-06-15). v1.1-rc2 = shipped
  // v1.0 + ONLY the king-only commit backstop (no gadget); the worker maps this
  // id to engine_profile 'v1.1-rc2'. Enable:
  // MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-v2-v1.0,python-v2-kingsafe
  'python-v2-kingsafe': {
    id: 'python-v2-kingsafe',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty (King-safe · v1.1-rc2)',
    kind: 'container',
    configHash: 'v2-kingsafe-local',
    playSignature: 'v2-kingsafe',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-kingsafe',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes: 'Local-only A/B: v1.0 + king-only commit backstop (v1.1-rc2). Worker maps id->profile.',
  },
  // SHIPPED v1.1 + the |P|-adaptive catastrophe prune; the worker maps this id to
  // engine_profile 'v1.1-rc3'. The human gate for the adaptive prune (2026-06-16).
  // Enable: MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-v2-adaptive
  'python-v2-adaptive': {
    id: 'python-v2-adaptive',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty (King-floor · v1.1-rc5)',
    kind: 'container',
    configHash: 'v2-adaptive-local',
    playSignature: 'v2-adaptive',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-adaptive',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes:
      'Local-only A/B: v1.1 + adaptive prune + carryover |P|-gate (v1.1-rc4). Worker maps id->profile.',
  },
  // SHIPPED-base + carryover FULLY OFF (v1.1-rc6): fixes the opening regret-reuse
  // corruption (the live-vs-replay ghost) and restores warm==cold reproducibility.
  // The worker maps this id to engine_profile 'v1.1-rc6'. Local play-test 2026-06-19.
  // Enable: MISTBOARD_EXTRA_PLAYABLE_ENGINES=python-v2-nocarry
  'python-v2-nocarry': {
    id: 'python-v2-nocarry',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty (No-carry · v1.1-rc6)',
    kind: 'container',
    configHash: 'v2-nocarry-local',
    playSignature: 'v2-nocarry',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: 'current',
      config: 'v2-nocarry',
      config_hash: 'current',
    },
    livePolicy: { timeoutMs: 120_000 },
    notes:
      'Local-only A/B: v1.1 + carryover OFF (v1.1-rc6) — opening corruption fix + ' +
      'reproducible warm==cold. Worker maps id->profile.',
  },
  // Misty 1.0 is the frozen, player-facing first-party engine. Internal pins
  // stay stable so already-recorded games resolve. Bump to python-v2-v1.1
  // (+ V2_LIVE_ENGINES) on the next engine upgrade.
  'python-v2-v1.0': {
    id: 'python-v2-v1.0',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.0',
    kind: 'container',
    configHash: 'v2-v1.0-a06f9a1',
    playSignature: 'a06f9a1',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.0',
      config: 'v2-strongest-gadget-off',
      config_hash: 'a06f9a1',
      engine_pin: 'misty-max-v1.0@a06f9a1',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.0 — frozen first-party engine release for live play. Validated ' +
      '2026-06-02 against the legacy first-party baseline. Superseded by 1.1 ' +
      '2026-06-16; kept in registry so already-recorded 1.0 games resolve.',
  },
  // Misty 1.1 — the player-facing release that SUPERSEDES 1.0 (2026-06-16). The
  // faithful/Resolve arm: the only config 0% on BOTH catastrophe rigs (king-suicide
  // + queen-in-fog hang) at no strength cost vs 1.0 (40-position move-divergence:
  // 85% identical moves, ~0.03 mean EV gap). Worker maps id -> engine_profile v1.1.
  'python-v2-v1.1': {
    id: 'python-v2-v1.1',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.1',
    kind: 'container',
    configHash: 'v2-v1.1-17f55c5',
    playSignature: '17f55c5',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.1',
      config: 'v2-faithful-resolve',
      config_hash: '17f55c5',
      engine_pin: 'misty-1.1@17f55c5',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.1 — faithful/Resolve, catastrophe-complete (king + queen). ' +
      'Shipped 2026-06-16, superseded by 1.2 2026-06-19.',
  },
  // Misty 1.2 — SUPERSEDES 1.1 (2026-06-19). = v1.1 + carryover OFF *only*: fixes the
  // opening regret-reuse corruption (the live-vs-replay ghost) + restores warm==cold
  // reproducibility, and changes nothing else vs v1.1 (the adaptive prune is NOT
  // enabled here — it ships as its own gated version). Worker maps id -> v1.2.
  // Pinned to engine freeze commit bba9fff (branch ship-misty-1.2).
  'python-v2-v1.2': {
    id: 'python-v2-v1.2',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.2',
    kind: 'container',
    configHash: 'v2-v1.2-bba9fff',
    playSignature: 'bba9fff',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.2',
      config: 'v2-carryover-fix',
      config_hash: 'bba9fff',
      engine_pin: 'misty-1.2@bba9fff',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.2 — carryover fix only (opening corruption + reproducibility); ' +
      'v1.1 minus the bug. Shipped 2026-06-19, supersedes 1.1.',
  },
  // Misty 1.3 — OPENING-HARDENING candidate (2026-06-20). = v1.2 + the two
  // opening-catastrophe layers v1.2 shipped dormant, turned ON: the adaptive prune
  // (rc6 config: hv_prune_adaptive + king-floor 0.02) + the curated opening book.
  // Carryover stays OFF. Pinned to engine commit 5259395 (branch
  // ship/v1.3-2026-06-20). Worker maps id -> v1.3. KNOWN here so the engine-worker
  // can load it; OFFERED to players only when added to PROD_PLAYABLE_ENGINE_IDS
  // (the Phase-2 flip) — kept out for now so Phase-1 has no offer-without-serve gap.
  'python-v2-v1.3': {
    id: 'python-v2-v1.3',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.3',
    kind: 'container',
    configHash: 'v2-v1.3-5259395',
    playSignature: '5259395',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.3',
      config: 'v2-prune-book',
      config_hash: '5259395',
      engine_pin: 'misty-1.3@5259395',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.3 — v1.2 + adaptive prune ON + curated opening book ON ' +
      '(opening-hardening). Gated 2026-06-20. Superseded by v1.4 (castle fix).',
  },
  // Misty 1.4 — FoW CASTLE-INTO-CHECK fix (2026-06-20). Same PROFILE as v1.3 (every
  // knob identical); the behavioral delta is base-code: the WS2 search move-gen now
  // generates fog-castles (gen_fow_pseudo_legal_moves), so the engine SEES and
  // devalues a castle that walks its king onto a fog-attacked square — v1.3 never
  // generated that move in the losing belief worlds and committed it (prod a6f2e491:
  // O-O onto an attacked g8, then Qxg8). Pinned to engine commit cdecd59 (branch
  // ship/v1.4-2026-06-20 = live 653aa33 + the castle fix). Worker maps id -> v1.4.
  // KNOWN here so the engine-worker can load it; OFFERED to players only when added
  // to PROD_PLAYABLE_ENGINE_IDS (the Phase-2 flip) — kept out for now so Phase-1 has
  // no offer-without-serve gap.
  'python-v2-v1.4': {
    id: 'python-v2-v1.4',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.4',
    kind: 'container',
    configHash: 'v2-v1.4-cdecd59',
    playSignature: 'cdecd59',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.4',
      config: 'v2-castle-fix',
      config_hash: 'cdecd59',
      engine_pin: 'misty-1.4@cdecd59',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.4 — v1.3 + FoW castle-into-check fix (search move-gen sees ' +
      'fog-castles, devalues a king-walking castle). Shipped 2026-06-20.',
  },
  // ★ v1.5 OPENING-BOOK update (2026-06-21): v1.4 profile + curated book (drop the
  // now-redundant 2.Nc3 forces, add a forced ...dxe4 for the ~6% move-2 c6 commit-slip).
  // Pinned to engine 8b4935b (branch ship/v1.5-2026-06-21 = live 3ae331c + the book).
  // Worker maps id -> v1.5. KNOWN here so the engine-worker can load it; OFFERED to
  // players only when added to PROD_PLAYABLE_ENGINE_IDS (the Phase-2 flip).
  'python-v2-v1.5': {
    id: 'python-v2-v1.5',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.5',
    kind: 'container',
    configHash: 'v2-v1.5-8b4935b',
    playSignature: '8b4935b',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.5',
      config: 'v2-opening-book',
      config_hash: '8b4935b',
      engine_pin: 'misty-1.5@8b4935b',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.5 — v1.4 profile + curated opening book (drop redundant Nc3 ' +
      'forces, force ...dxe4 for the move-2 c6 slip). Shipped 2026-06-21.',
  },
  // Misty 1.6 (2026-08-23): the v1.5 profile + the catastrophe prune's NET-hang
  // floor (net >= 300cp on a >= 500cp piece is vetoed even when the gross bar
  // misses it). Fixes the Qxe8/Qxf2 queen-hang class (42b652b6, 12c8ff99 — the
  // second prod instance triggered the ship). Pinned to engine 350dc20. Worker
  // maps id -> v1.6. KNOWN here so the engine-worker can load it; OFFERED to
  // players only when added to PROD_PLAYABLE_ENGINE_IDS (the Phase-2 flip).
  'python-v2-v1.6': {
    id: 'python-v2-v1.6',
    engineId: 'v2',
    engineName: 'Misty',
    name: 'Misty 1.6',
    kind: 'container',
    configHash: 'v2-v1.6-350dc20',
    playSignature: '350dc20',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2',
      version: '1.6',
      config: 'v2-net-hang-floor',
      config_hash: '350dc20',
      engine_pin: 'misty-1.6@350dc20',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty 1.6 — v1.5 + the catastrophe prune net-hang floor (300cp net on ' +
      'high-value pieces). Fixes the Qxe8/Qxf2 hang class. Shipped 2026-08-23.',
  },
  // Dark Mini Xiangqi engine. Not in the chess PvE picker; the Dark Mini
  // Xiangqi route selects it through the variant-aware worker protocol.
  'python-dmx-v1.0': {
    id: 'python-dmx-v1.0',
    engineId: 'v2',
    engineName: 'Misty DMX',
    name: 'Misty DMX 1.0',
    kind: 'container',
    gameSpecId: 'dark-mini-xiangqi',
    configHash: 'dmx-v1.0-3ae331c',
    playSignature: '3ae331c',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2-mini',
      version: '1.0',
      config: 'dmx-misty-dmx',
      config_hash: '3ae331c',
      engine_pin: 'dmx-v1.0@3ae331c',
    },
    livePolicy: { timeoutMs: 30_000 },
    notes:
      'Misty DMX 1.0 — Dark Mini Xiangqi engine served through the variant-aware worker adapter. ' +
      'Pinned to engine 3ae331c (guarded recommended profile + bounded mini belief cap + live-build guard fix).',
  },
  // Full Dark Xiangqi engine. Local/dev-only: not in the chess PvE picker and
  // not in PROD_PLAYABLE_ENGINE_IDS. The Dark Xiangqi route defaults to it for
  // PvE when the variant flag is enabled.
  'python-fdx-v1.0': {
    id: 'python-fdx-v1.0',
    engineId: 'v2',
    engineName: 'Misty DXQ',
    name: 'Misty DXQ 1.0',
    kind: 'container',
    gameSpecId: 'dark-xiangqi',
    configHash: 'fdx-v1.0-64x12-20m',
    playSignature: 'fdx-v1.0-64x12-20m',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2-xiangqi',
      version: '1.0',
      config: 'fdx-64x12-20m-pikafish-d1',
      config_hash: '64x12-20m',
      engine_pin: 'fdx-v1.0-local',
    },
    livePolicy: { timeoutMs: 60_000 },
    notes:
      'Misty DXQ 1.0 — Full Dark Xiangqi local/dev engine served through the ' +
      'variant-aware worker adapter (64x12, 20M cap, Pikafish depth 1).',
  },
  'python-fdx-v1.1': {
    id: 'python-fdx-v1.1',
    engineId: 'v2',
    engineName: 'Misty DXQ',
    name: 'Misty DXQ 1.1',
    kind: 'container',
    gameSpecId: 'dark-xiangqi',
    configHash: 'fdx-v1.1-guarded-64x32-20m',
    playSignature: 'fdx-v1.1-guarded-64x32-20m',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2-xiangqi',
      version: '1.1',
      config: 'fdx-guarded-64x32-20m-pikafish-d1',
      config_hash: 'guarded-64x32-20m',
      engine_pin: 'fdx-v1.1-local',
    },
    livePolicy: { timeoutMs: 60_000 },
    notes:
      'Misty DXQ 1.1 — Full Dark Xiangqi, guarded-64x32-20m profile: faithful ' +
      'coverage (|I|=32, KLUSS=2, Resolve gadget + alpha) plus the material- ' +
      'catastrophe stack (adaptive material prune tau=0.15 + general veto), all ' +
      'baked in the engine profile (no FOW_XIANGQI_* env needed). Human-validated ' +
      '(beat author 3/3 live PvE; opening cannon-hang class did not recur).',
  },
  'python-fdx-v1.2': {
    id: 'python-fdx-v1.2',
    engineId: 'v2',
    engineName: 'Misty DXQ',
    name: 'Misty DXQ 1.2',
    kind: 'container',
    gameSpecId: 'dark-xiangqi',
    configHash: 'fdx-v1.2-guarded-timed-i32-20m',
    playSignature: 'fdx-v1.2-guarded-timed-i32-20m',
    config: {
      kind: 'python-subprocess',
      strategy: 'v2-xiangqi',
      version: '1.2',
      config: 'fdx-guarded-timed-i32-20m-pikafish-d1',
      config_hash: 'guarded-timed-i32-20m',
      engine_pin: 'fdx-v1.2-local',
    },
    livePolicy: { timeoutMs: 60_000 },
    notes:
      'Misty DXQ 1.2 — v1.1 with the search made TIME-bounded. Same guards, same ' +
      'coverage, same eval; only what stops the search changed. v1.1 ran a static ' +
      '64-iteration cap, so its deadline check was unreachable and it spent ~1.8% ' +
      'of the budget the server offered (33 moves in 24.4s over a 5+5 game, ' +
      'finishing with more clock than it started). The cap is now out of reach and ' +
      'a 4s per-move ceiling is the real control. A new id rather than an edit to ' +
      'v1.1: configHash is persisted into eve_games play signatures, so mutating a ' +
      'shipped bundle would make old rows describe a config that never ran.',
  },
  'python-tier1-v0.9.1': {
    id: 'python-tier1-v0.9.1',
    engineId: 'tier1',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine preview',
    kind: 'container',
    configHash: 'tier1-v0.9.1-8918f287499f',
    playSignature: '8918f287499f',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: '0.9.1',
      config: 'tier1-v1',
      config_hash: '8918f287499f',
      engine_pin: 'v0.9.1-pawn-shield-diagonal@8918f287499f',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes: 'First-party engine preview with king-defense and belief-piece-save tuning.',
  },
  'python-tier1-v0.8.9': {
    id: 'python-tier1-v0.8.9',
    engineId: 'tier1',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine preview',
    kind: 'container',
    configHash: 'tier1-v0.8.9-b22f29dd73f5',
    playSignature: '2c010d792075',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: '0.8.9',
      config: 'tier1-v1',
      config_hash: 'b22f29dd73f5',
      engine_pin: 'v0.8.9-repair-caps@2c010d792075',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes: 'Owner-operated first-party engine preview with repair-source tuning.',
  },
  'python-tier1-v0.7.22': {
    id: 'python-tier1-v0.7.22',
    engineId: 'tier1',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine preview',
    kind: 'container',
    configHash: 'tier1-v0.7.22-b22f29dd73f5',
    playSignature: '5d3ddffa74f6',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: '0.7.22',
      config: 'tier1-v1',
      config_hash: 'b22f29dd73f5',
      engine_pin: 'v0.7.22-king-risk@5d3ddffa74f6',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes: 'Owner-operated first-party engine preview with profiled particle updates.',
  },
  'python-tier1-v0.7.0': {
    id: 'python-tier1-v0.7.0',
    engineId: 'tier1',
    engineName: 'Mistboard Engine',
    name: 'Mistboard Engine preview',
    kind: 'container',
    configHash: 'tier1-v0.7.0-b22f29dd73f5',
    playSignature: 'tier1-v0.7.0-b22f29dd73f5',
    config: {
      kind: 'python-subprocess',
      strategy: 'tier1',
      version: '0.7.0',
      config: 'tier1-v1',
      config_hash: 'b22f29dd73f5',
    },
    livePolicy: { timeoutMs: 5_000 },
    notes: 'Owner-operated first-party engine preview executed through the worker adapter.',
  },
  'python-random-legal': {
    id: 'python-random-legal',
    engineId: 'random-legal',
    engineName: 'Random Legal',
    name: 'Random Legal Python v1',
    kind: 'container',
    configHash: 'python-random-legal-v1',
    playSignature: 'python-random-legal-v1',
    config: { kind: 'python-subprocess', strategy: 'random-legal', version: 1 },
    notes: 'Owner-only Python random-legal baseline for subprocess engine smoke tests.',
  },
};

// Uniformly-random legal-move xiangqi bot: the calibration floor / 0-Elo anchor.
// EvE-only (the xiangqi runner's move provider plays it in-process), so it is NOT
// in any *_PLAYABLE list and never appears in the live PvE picker.
const XIANGQI_RANDOM_ENGINES: Record<string, EngineDefinition> = {
  [XIANGQI_RANDOM_ENGINE_ID]: {
    id: XIANGQI_RANDOM_ENGINE_ID,
    engineId: 'random-legal-xiangqi',
    engineName: 'Random Mover',
    name: 'Random Mover',
    kind: 'builtin',
    gameSpecId: 'xiangqi',
    configHash: `random-legal-xiangqi-${XIANGQI_RANDOM_ENGINE_VERSION}`,
    playSignature: `random-legal-xiangqi-${XIANGQI_RANDOM_ENGINE_VERSION}`,
    config: { kind: 'builtin', strategy: 'random-legal', version: 1 },
    notes:
      'Uniformly-random legal-move standard-Xiangqi bot. Calibration floor / 0-Elo anchor; EvE-only, not player-facing.',
  } satisfies EngineDefinition,
};

const XIANGQI_FSF_ENGINES: Record<string, EngineDefinition> = Object.fromEntries(
  XIANGQI_FSF_PLAYABLE_ENGINES.map((tier) => [
    tier.id,
    {
      id: tier.id,
      engineId: 'fairy-stockfish-xiangqi',
      engineName: 'Fairy-Stockfish',
      name: tier.name,
      kind: 'container',
      gameSpecId: 'xiangqi',
      configHash: xiangqiFsfConfigHash(tier),
      playSignature: xiangqiFsfConfigHash(tier),
      config: {
        kind: 'fairy-stockfish',
        skill: tier.skill,
        movetime_ms: tier.movetimeMs,
        ...(tier.depth === undefined ? {} : { depth: tier.depth }),
        ...(tier.nodes === undefined ? {} : { nodes: tier.nodes }),
        ...(tier.hashMb === undefined ? {} : { hash_mb: tier.hashMb }),
        ...(tier.nnue ? { nnue: XIANGQI_FSF_NNUE_NET } : {}),
      },
      notes: tier.nnue
        ? 'Fairy-Stockfish standard-Xiangqi top rung: official xiangqi NNUE net, node-anchored search, full Skill Level.'
        : 'Fairy-Stockfish standard-Xiangqi human-strength profile using the Lichess/PlayStrategy stochastic weakening policy.',
    } satisfies EngineDefinition,
  ]),
);

// The hash names everything that decides the rung's play: build version, the
// pinned FSF commit, skill, the search limit (depth cap or node anchor) and the
// eval (classical unless a net is named). A binary or net move therefore reads
// as a new engine identity in the EvE ladder instead of a silent strength change.
function xiangqiFsfConfigHash(tier: XiangqiFsfEngineTier): string {
  const search = tier.nodes === undefined ? `depth-${tier.depth}` : `nodes-${tier.nodes}`;
  const evalTag = tier.nnue ? `-${XIANGQI_FSF_NNUE_NET.replace(/\.nnue$/, '')}` : '';
  return `fsf-xiangqi-${XIANGQI_FSF_ENGINE_VERSION}-${XIANGQI_FSF_ENGINE_REF}-skill-${tier.skill}-${search}${evalTag}`;
}

// Jieqi (揭棋) PvE engines — the Pikafish jieqi branch driven as a UCI subprocess
// (Tier-B, server-jieqi-engine.ts). LAUNCH uses the no-net `jieqi_old` classical
// build (clean GPL-3, no net-licensing problem). Unlike the FSF ladder, jieqi_old
// has NO Skill Level / UCI_Elo knob (verified absent from its UCI options), so the
// tiers vary by search DEPTH/time (like banqi-uci), not skill. The OPERATIVE search
// params live in jieqi-engine.ts (JIEQI_ENGINE_TIERS); the `config` values here are
// catalog metadata kept in sync. Not added to PROD_PLAYABLE_ENGINE_IDS yet — gated
// until the vertical ships.
const JIEQI_ENGINES: Record<string, EngineDefinition> = {
  'pikafish-jieqi-amateur': {
    id: 'pikafish-jieqi-amateur',
    engineId: 'pikafish-jieqi',
    engineName: 'PikaJieQi',
    name: 'PikaJieQi - Amateur',
    kind: 'container',
    gameSpecId: 'jieqi',
    configHash: 'pikafish-jieqi-amateur',
    playSignature: 'pikafish-jieqi-amateur',
    config: { kind: 'pikafish', depth: 4, movetime_ms: 800 },
    notes:
      'Jieqi PikaJieQi (jieqi_old, no-net classical eval) — depth-capped (4) to a beatable amateur level.',
  },
  'pikafish-jieqi-strong': {
    id: 'pikafish-jieqi-strong',
    engineId: 'pikafish-jieqi',
    engineName: 'PikaJieQi',
    name: 'PikaJieQi - Strong',
    kind: 'container',
    gameSpecId: 'jieqi',
    configHash: 'pikafish-jieqi-strong',
    playSignature: 'pikafish-jieqi-strong',
    config: { kind: 'pikafish', depth: 10, movetime_ms: 1200 },
    notes: 'Default Jieqi PikaJieQi tier — depth-capped (10), solid strength.',
  },
  'pikafish-jieqi-strongest': {
    id: 'pikafish-jieqi-strongest',
    engineId: 'pikafish-jieqi',
    engineName: 'PikaJieQi',
    name: 'PikaJieQi - Strongest',
    kind: 'container',
    gameSpecId: 'jieqi',
    // Versioned so the 0.2.0 serving config (4000ms + Hash 256 / Threads 2) is not
    // conflated with the 2500ms single-threaded 16MB-hash definition it replaced.
    configHash: `pikafish-jieqi-${JIEQI_ENGINE_VERSION}-movetime-4000`,
    playSignature: `pikafish-jieqi-${JIEQI_ENGINE_VERSION}-movetime-4000`,
    config: { kind: 'pikafish', movetime_ms: 4000 },
    notes:
      'Top Jieqi PikaJieQi tier and the one every jieqi PvE game is served by — no depth cap, 4000ms, Hash 256 / Threads 2 (see jieqiLiveResourceOptions).',
  },
};

// Standard Xiangqi profiles share the exact tier source used by live PvE. This
// prevents the EvE catalog from drifting from the executable node budgets.
const XIANGQI_ENGINES: Record<string, EngineDefinition> = Object.fromEntries(
  XIANGQI_ALL_ENGINE_TIERS.map((tier) => [
    tier.id,
    {
      id: tier.id,
      engineId: 'pikafish-xiangqi',
      engineName: 'Pikafish',
      name: tier.name,
      kind: 'container',
      gameSpecId: 'xiangqi',
      configHash: `pikafish-xiangqi-${XIANGQI_ENGINE_VERSION}-nodes-${tier.nodes}`,
      playSignature: `pikafish-xiangqi-${XIANGQI_ENGINE_VERSION}-nodes-${tier.nodes}`,
      config: {
        kind: 'pikafish-xiangqi',
        nodes: tier.nodes,
        movetime_ms: tier.movetimeMs,
        version: XIANGQI_ENGINE_VERSION,
      },
      notes:
        `Mainline Pikafish ${XIANGQI_ENGINE_VERSION} standard-Xiangqi profile; ` +
        `${tier.nodes.toLocaleString('en-US')} node budget.`,
    } satisfies EngineDefinition,
  ]),
);

// MistyBanqi (our own Rust αβ+TT engine, Tier-B UCI subprocess — banqi-engine.ts).
// ONE versioned bot since 2026-06-18 (was 3 difficulty tiers). configHash carries the
// engine version, so each game record tells which build played. The route/scheduler key off
// banqi-engine.ts ids, not this registry. The legacy *-amateur/strong/strongest entries are
// KEPT (not served, not in the picker) so old game records still resolve via isKnownEngineClientId.
const BANQI_ENGINES: Record<string, EngineDefinition> = {
  'misty-banqi': {
    id: 'misty-banqi',
    engineId: 'misty-banqi',
    engineName: 'MistyBanqi',
    name: 'MistyBanqi',
    kind: 'container',
    gameSpecId: 'banqi',
    // Hash bumped 2026-09-06 from 'misty-banqi-0.2.1' because the entry had drifted
    // from the live tier on every axis: BANQI_ENGINE_VERSION is 0.2.4, the node budget
    // is 3.5M (the 1.5M-era `movetime_ms: 1500` here never described a real setting —
    // the tier's latency cap has been 5000 and then 8000, never 1500), and `nodes` was
    // not recorded at all. NOT an in-place edit under the old hash: eve_games rows carry
    // white_config_hash / white_play_signature snapshots, so mutating a shipped
    // (configHash, config) pair would make every past row retroactively claim settings
    // that never ran. A config change is a new hash, always.
    //
    // Shape follows the pikafish-xiangqi convention (`<engine>-<version>-nodes-<N>`):
    // the hash names what DECIDES play — the build and the strength dial. The movetime
    // cap is a latency backstop that must not bind (see banqi-engine.ts), so it stays
    // out of the identity while remaining recorded in `config`.
    configHash: 'misty-banqi-0.2.5-nodes-3500000',
    playSignature: 'misty-banqi-0.2.5-nodes-3500000',
    config: { kind: 'banqi-uci', nodes: 3_500_000, movetime_ms: 8_000 },
    notes:
      'MistyBanqi 0.2.4 — v0.2.1 gen_danger general-safety eval term (proximity+escape-aware, ' +
      'FEATURES 506 + w_king 28) on top of v0.2.0 cheap-strength. Modal ~385/arm vs hw3: ' +
      'no-regression + own-general-loss 35.5%->26% (~2.7sigma). Single full-strength bot at ' +
      '3.5M nodes under an 8s latency cap (budget resized from 1.5M on 2026-09-06 to fit the ' +
      'ceiling; not a claimed strength gain).',
  },
  'misty-banqi-amateur': {
    id: 'misty-banqi-amateur',
    engineId: 'misty-banqi',
    engineName: 'MistyBanqi',
    name: 'MistyBanqi - Amateur',
    kind: 'container',
    gameSpecId: 'banqi',
    configHash: 'misty-banqi-amateur',
    playSignature: 'misty-banqi-amateur',
    config: { kind: 'banqi-uci', movetime_ms: 200 },
    notes: 'Banqi MistyBanqi 0.1.0 (standalone Rust αβ+TT UCI engine) amateur tier.',
  },
  'misty-banqi-strong': {
    id: 'misty-banqi-strong',
    engineId: 'misty-banqi',
    engineName: 'MistyBanqi',
    name: 'MistyBanqi - Strong',
    kind: 'container',
    gameSpecId: 'banqi',
    configHash: 'misty-banqi-strong',
    playSignature: 'misty-banqi-strong',
    config: { kind: 'banqi-uci', movetime_ms: 600 },
    notes: 'Default Banqi MistyBanqi tier.',
  },
  'misty-banqi-strongest': {
    id: 'misty-banqi-strongest',
    engineId: 'misty-banqi',
    engineName: 'MistyBanqi',
    name: 'MistyBanqi - Strongest',
    kind: 'container',
    gameSpecId: 'banqi',
    configHash: 'misty-banqi-strongest',
    playSignature: 'misty-banqi-strongest',
    config: { kind: 'banqi-uci', movetime_ms: 1500 },
    notes: 'Top Banqi MistyBanqi tier (longer movetime).',
  },
};

// Mini Xiangqi (perfect-info 7x7) plays via Fairy-Stockfish's native
// `minixiangqi` variant. Tiers were calibrated by engine-vs-engine self-play
// (amateur ≪ strong ≪ strongest, each step ~90-97%). Weakening is Skill Level
// (CPU-independent); the budget is a node count (reproducible across the slow
// prod vCPU) capped by movetime as a wall-clock guard.
const MINI_XIANGQI_ENGINES: Record<string, EngineDefinition> = {
  'fairy-stockfish-mini-xiangqi-amateur': {
    id: 'fairy-stockfish-mini-xiangqi-amateur',
    engineId: 'fairy-stockfish-mini-xiangqi',
    engineName: 'Fairy Stockfish',
    name: 'Fairy Stockfish - Amateur',
    kind: 'container',
    gameSpecId: 'mini-xiangqi',
    configHash: 'fsf-mini-xiangqi-amateur',
    playSignature: 'fsf-mini-xiangqi-amateur',
    config: { kind: 'fairy-stockfish', skill: 1, nodes: 6_000, movetime_ms: 300 },
    notes: 'Mini Xiangqi Fairy-Stockfish tier capped for production-safe amateur play.',
  },
  'fairy-stockfish-mini-xiangqi-strong': {
    id: 'fairy-stockfish-mini-xiangqi-strong',
    engineId: 'fairy-stockfish-mini-xiangqi',
    engineName: 'Fairy Stockfish',
    name: 'Fairy Stockfish - Strong',
    kind: 'container',
    gameSpecId: 'mini-xiangqi',
    configHash: 'fsf-mini-xiangqi-strong',
    playSignature: 'fsf-mini-xiangqi-strong',
    config: { kind: 'fairy-stockfish', skill: 8, nodes: 60_000, movetime_ms: 800 },
    notes:
      'Default Mini Xiangqi Fairy-Stockfish tier with mid-skill move selection plus the live immediate-loss guard.',
  },
  'fairy-stockfish-mini-xiangqi-very-strong': {
    id: 'fairy-stockfish-mini-xiangqi-very-strong',
    engineId: 'fairy-stockfish-mini-xiangqi',
    engineName: 'Fairy Stockfish',
    name: 'Fairy Stockfish - Strongest',
    kind: 'container',
    gameSpecId: 'mini-xiangqi',
    configHash: 'fsf-mini-xiangqi-very-strong',
    playSignature: 'fsf-mini-xiangqi-very-strong',
    config: { kind: 'fairy-stockfish', skill: 20, nodes: 800_000, movetime_ms: 2_000 },
    notes:
      'Top Mini Xiangqi Fairy-Stockfish tier at full skill with a larger node budget plus the live immediate-loss guard.',
  },
};

// Flip Jungle (兽棋 / 翻翻棋, 4x4 hidden-identity flip animal chess) plays via our own
// `jungle-flip-engine` standalone Rust αβ+Star1+TT UCI engine (banqi pattern; NOT the
// fog engine-worker). One versioned full-strength bot; strength is a node budget capped
// by movetime.
const JUNGLE_FLIP_ENGINES: Record<string, EngineDefinition> = {
  'misty-jungle-flip': {
    id: 'misty-jungle-flip',
    engineId: 'misty-jungle-flip',
    engineName: 'MistyJungleFlip',
    name: 'MistyJungleFlip',
    kind: 'container',
    gameSpecId: 'jungle-flip',
    // Hash bumped 2026-09-06 from 'misty-jungle-flip-0.1.0', which had never once been
    // touched: the binary went 0.1.0 -> 0.2.0 -> 0.4.0 -> 0.5.1, the node budget went
    // 512K -> 2.5M, and `movetime_ms: 2_500` never matched the tier's 5000ms cap even on
    // the first day. Bumped rather than edited in place for the same reason as banqi
    // above — eve_games snapshots the hash per game, so a mutated pair rewrites history.
    configHash: 'misty-jungle-flip-0.5.1-nodes-2500000',
    playSignature: 'misty-jungle-flip-0.5.1-nodes-2500000',
    config: { kind: 'jungle-flip-uci', nodes: 2_500_000, movetime_ms: 5_000 },
    notes:
      'MistyJungleFlip 0.5.1 — standalone Rust αβ+Star1+TT UCI engine over the redacted ' +
      'jungle-flip FEN, with the <=4-piece exact tablebase (WLD + distance-to-mate) loaded ' +
      'since v0.4.0. Single full-strength bot at 2.5M nodes under a 5s latency cap ' +
      '(budget resized from 512K on 2026-09-06 to fit the ceiling; not a claimed strength ' +
      'gain). Chance-node (flip) search, not fog/belief.',
  },
};

const KNOWN_ENGINES: Record<string, EngineDefinition> = {
  ...BUILTIN_ENGINES,
  ...PYTHON_ENGINES,
  ...XIANGQI_FSF_ENGINES,
  ...XIANGQI_RANDOM_ENGINES,
  ...JIEQI_ENGINES,
  ...XIANGQI_ENGINES,
  ...BANQI_ENGINES,
  ...MINI_XIANGQI_ENGINES,
  ...JUNGLE_FLIP_ENGINES,
};

/**
 * Every engine id in the registry, playable or not. Exists so a conformance
 * test can walk the whole catalog and assert coverage — a new entry that is
 * neither checked against its live tier nor explicitly exempted fails CI
 * instead of silently joining the set of entries nobody validates. Not for
 * serving decisions: use `playableLiveEngines` / the per-variant guards there.
 */
export function knownEngineIds(): EngineId[] {
  return Object.keys(KNOWN_ENGINES) as EngineId[];
}

export function latestBuiltinEngineIds(): { white: string; black: string } {
  return {
    white: 'builtin-capture-seeker',
    black: 'builtin-random-legal',
  };
}

export function loadEngine(engineId: string | null | undefined): EngineDefinition {
  const resolvedId = engineId ?? defaultEngineId();
  const engine = KNOWN_ENGINES[resolvedId];
  if (!engine) throw new Error(`engine ${resolvedId} is not loadable by this worker`);
  return engine;
}

export function engineVersionDisplayName(engineId: string): string {
  return KNOWN_ENGINES[engineId]?.name ?? engineId;
}

export async function upsertBuiltinEngineVersions(
  db: Queryable,
  engineIds: string[],
): Promise<void> {
  for (const engineId of new Set(engineIds)) {
    const engine = loadEngine(engineId);
    await db.query(
      `INSERT INTO engines
         (id, name, visibility, status, notes)
       VALUES ($1, $2, 'builtin', 'active', $3)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         visibility = EXCLUDED.visibility,
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [
        engine.engineId,
        engine.engineName,
        'Built-in TypeScript engine family for owner-operated EvE runs.',
      ],
    );
    await db.query(
      `INSERT INTO engine_versions
         (id, engine_id, name, kind, status, config_hash, play_signature,
          engine_version_pin, config, metadata, notes)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         engine_id = EXCLUDED.engine_id,
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         status = EXCLUDED.status,
         config_hash = EXCLUDED.config_hash,
         play_signature = EXCLUDED.play_signature,
         engine_version_pin = EXCLUDED.engine_version_pin,
         config = EXCLUDED.config,
         metadata = EXCLUDED.metadata,
         notes = EXCLUDED.notes`,
      [
        engine.id,
        engine.engineId,
        engine.name,
        engine.kind,
        engine.configHash,
        engine.playSignature,
        engine.id,
        engine.config,
        {
          owner: 'admin',
          runtime:
            engine.config.kind === 'python-subprocess'
              ? 'python-subprocess'
              : engine.config.kind === 'builtin'
                ? 'in-process-typescript'
                : 'uci-subprocess',
        },
        engine.notes ?? 'Built-in TypeScript worker engine for EvE data collection MVP.',
      ],
    );
  }
}
