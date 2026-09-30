// Engine-vs-engine jieqi games played OFF-site (a lab match run on Modal) as
// ordinary finished jieqi games: a public /jieqi/game/:id page that replays
// every reveal, filed under the match's corpus id so the whole match can be
// found again. Pure: builds and validates the event log + games row; the CLI
// (import-engine-match.ts) writes them.
//
// Input is the ENRICHED match jsonl (mistboard-engine
// lab/jieqi-abjchess-2026-09-29/enrich_match.py). The lab referee deals lazily
// (a face-down piece's identity is drawn when it moves or is captured), so the
// raw rows carry moves only; the enrichment replays each game with its seed and
// records every identity the game determined, plus a completion for the pieces
// still face-down at the end (drawn afterwards from the same seed). The site's
// kernel is dealt up front, so the deal written here is that whole 15+15, with
// `deal.undetermined` naming the squares the lab never dealt: the kernel marks
// those pieces unknown, and no truth view, export or analysis hand-off states an
// identity for them. The room-created `origin` carries the event name and the
// source's credit (manifest.credit) for the review page.
//
// Every game is replayed through the site's own jieqi kernel before it is
// accepted: each move must be legal, each reveal and capture must match the lab
// record, the final position must equal the lab's final FEN, and the ending must
// be the kernel's own (checkmate/stalemate for `no-move-X`). A lab threefold
// repetition, which the kernel does not adjudicate, becomes a trailing
// game-adjudicated event.
//
// Imported games are mode 'imported' with a corpus id: never counted as human
// games (persistence-counted-games.ts counts pvp/pve only), never rated, never
// watch content (WATCH_DEFAULT_MODES), and outside the engine/bot records, which
// count pve/eve.

import {
  assertValidJieqiDeal,
  isJieqiLegalMove,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiHomeSquares,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from '@mistboard/game';
import type { JieqiEvent } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { GameParticipant, GameSummary } from './persistence.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';
import { isTenantGameOrigin, type TenantGameOrigin } from './variant-tenant/tenant.js';

// ── Inputs ────────────────────────────────────────────────────────────────────

/** One side of the match: the lab's engine A or B. */
export type EngineMatchEngine = {
  /** Seat name on the game page. */
  name: string;
  /** The site engine id this build is, when the site serves it (for queries). */
  engineId?: string | null;
  /** The exact build that played (net, commit), recorded on the seat. */
  engineVersion?: string | null;
};

export type EngineMatchManifest = {
  /** Stable match slug: the corpus id and the room-id stem. */
  slug: string;
  /** Human event name, e.g. "AB-JChess vs PikaJieQi · 4 s · 2026-09". */
  eventName: string;
  variant: typeof JIEQI_SPEC_ID;
  /** Wall-clock window the run took (ISO). Games are placed inside it by
   *  completion order; the lab records each game's length but not its clock. */
  runStartedAt: string;
  runEndedAt: string;
  engines: { A: EngineMatchEngine; B: EngineMatchEngine };
  /** Shown on every game page of the match under the event name. */
  credit?: NonNullable<TenantGameOrigin['credit']>;
  /** Free-form provenance, stored beside the evals (not shown). */
  source?: Record<string, unknown>;
};

type LabColor = 'red' | 'black';

/** One enriched lab game (enrich_match.py). Squares are Pikafish (a0..i9). */
export type EnrichedMatchGame = {
  game: number;
  seed: number;
  a_color: LabColor;
  winner: LabColor | 'draw';
  reason: string;
  plies: number;
  secs?: number | null;
  final_fen: string;
  completion_order: number;
  deal: Record<LabColor, { roles: Record<string, string>; completed: string[] }>;
  moves: Array<{
    ply: number;
    by: 'A' | 'B';
    color: LabColor;
    move: string;
    reveal: string | null;
    capture: { color: LabColor; role: string; wasFaceDown: boolean } | null;
    cp: number | null;
    mate: number | null;
  }>;
};

// ── Output ────────────────────────────────────────────────────────────────────

export type ImportedEngineMatchGame = {
  roomId: string;
  game: number;
  events: JieqiEvent[];
  summary: GameSummary;
  /** Per-move scores as the engines reported them, for game_debug_artifacts. */
  evals: Record<string, unknown>;
  /** Home squares whose identity the game never determined (completion). */
  completedSquares: number;
};

export type EngineMatchBuildResult =
  | { ok: true; value: ImportedEngineMatchGame }
  | { ok: false; roomId: string; game: number; error: string };

export const ENGINE_MATCH_EVALS_ARTIFACT = 'engine-match-evals';

const SLUG = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/;
const ROLES: ReadonlySet<string> = new Set([
  'chariot',
  'advisor',
  'cannon',
  'soldier',
  'horse',
  'elephant',
]);

export function assertEngineMatchManifest(manifest: EngineMatchManifest): void {
  if (!SLUG.test(manifest.slug)) throw new Error(`bad match slug ${JSON.stringify(manifest.slug)}`);
  if (manifest.variant !== JIEQI_SPEC_ID) {
    throw new Error(`unsupported match variant ${JSON.stringify(manifest.variant)}`);
  }
  if (!manifest.eventName?.trim()) throw new Error('manifest.eventName is required');
  for (const side of ['A', 'B'] as const) {
    if (!manifest.engines?.[side]?.name?.trim()) {
      throw new Error(`manifest.engines.${side}.name is required`);
    }
  }
  if (!isTenantGameOrigin(engineMatchOrigin(manifest))) {
    throw new Error('manifest.credit needs work, authors[] and an https url');
  }
  const start = Date.parse(manifest.runStartedAt);
  const end = Date.parse(manifest.runEndedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('manifest.runStartedAt/runEndedAt must be ISO times, start before end');
  }
}

export function engineMatchOrigin(manifest: EngineMatchManifest): TenantGameOrigin {
  return {
    kind: 'imported',
    event: manifest.eventName,
    ...(manifest.credit ? { credit: manifest.credit } : {}),
  };
}

/** Stable, predictable id: re-running an import addresses the same rows. */
export function engineMatchRoomId(slug: string, game: number): string {
  return `${jieqiTenant.roomIdPrefix}${slug}-${String(game).padStart(3, '0')}`;
}

function labSquare(pikafishSquare: string): JieqiSquare {
  const move = pikafishUciToJieqiMove(`${pikafishSquare}${pikafishSquare}`);
  if (!move) throw new Error(`bad square ${JSON.stringify(pikafishSquare)}`);
  return move.from;
}

/** The lab's realized deal in the kernel's home-square order. */
export function engineMatchDeal(game: EnrichedMatchGame): JieqiDeal {
  const deal: JieqiDeal = { red: [], black: [] };
  for (const color of ['red', 'black'] as const) {
    const bySquare = new Map<JieqiSquare, string>();
    for (const [square, role] of Object.entries(game.deal[color].roles)) {
      bySquare.set(labSquare(square), role);
    }
    for (const home of jieqiHomeSquares(color)) {
      const role = bySquare.get(home);
      if (!role || !ROLES.has(role)) {
        throw new Error(`${color} deal has no identity for home square ${home}`);
      }
      deal[color].push(role as JieqiPieceRole);
    }
    if (bySquare.size !== 15) throw new Error(`${color} deal names ${bySquare.size} squares`);
  }
  // The squares the lab never dealt: their roles above are the enrichment's
  // completion, a placeholder. The kernel marks those pieces unknown.
  deal.undetermined = {
    red: game.deal.red.completed.map(labSquare).sort(),
    black: game.deal.black.completed.map(labSquare).sort(),
  };
  assertValidJieqiDeal(deal);
  return deal;
}

/**
 * Where a game sits in the run window. The lab records each game's length
 * (`secs`, ~ plies x movetime) and the order games finished in, not a clock:
 * the end is the game's completion slot spread over the window, the start is
 * that minus its real length, pushed later when that would start before the
 * run did (games ran in parallel, so the early finishers were short games).
 */
export function engineMatchTiming(
  manifest: EngineMatchManifest,
  game: EnrichedMatchGame,
  total: number,
): { startedAt: number; endedAt: number } {
  const runStart = Date.parse(manifest.runStartedAt);
  const runEnd = Date.parse(manifest.runEndedAt);
  const slot = Math.min(Math.max(game.completion_order, 0), total - 1);
  const lengthMs = Math.min(
    runEnd - runStart,
    Math.max(1_000, Math.round((game.secs ?? 0) * 1000)),
  );
  const slotEnd = Math.round(runStart + ((slot + 1) / total) * (runEnd - runStart));
  const endedAt = Math.max(slotEnd, runStart + lengthMs);
  return { startedAt: endedAt - lengthMs, endedAt };
}

// The public half of a Pikafish jieqi FEN (board, pool, no-capture clock, move
// number) with zero pool counts dropped: the lab omits them, the kernel's
// encoder writes `R0`. Side to move is compared separately (a finished kernel
// state has no turn).
function comparableFen(fen: string): string {
  const [board, , pool = '', clock, fullmove] = fen.split(' ');
  const counts = (pool.match(/[A-Za-z]\d+/g) ?? []).filter((entry) => !/^[A-Za-z]0$/.test(entry));
  return [board, counts.join(''), clock, fullmove].join(' ');
}

function participantsFor(
  manifest: EngineMatchManifest,
  aColor: JieqiColor,
): { participants: GameParticipant[]; names: Record<JieqiColor, string> } {
  const names = {} as Record<JieqiColor, string>;
  const participants = (['red', 'black'] as const).map((color): GameParticipant => {
    const engine = color === aColor ? manifest.engines.A : manifest.engines.B;
    names[color] = engine.name;
    return {
      color,
      displayName: engine.name,
      // An engine seat from an OFF-site game. Not 'bot' or 'engine-version': those
      // subjects feed the bot pages and engine records, which describe play on
      // this site. 'imported' is the corpus seat type (named, no account).
      subjectType: 'imported',
      subjectId: null,
      visibility: 'public',
      ...(engine.engineVersion ? { engineVersion: engine.engineVersion } : {}),
      ...(engine.engineId ? { engineId: engine.engineId } : {}),
    };
  });
  return { participants, names };
}

export function buildImportedJieqiGame(
  manifest: EngineMatchManifest,
  game: EnrichedMatchGame,
  total: number,
): EngineMatchBuildResult {
  const roomId = engineMatchRoomId(manifest.slug, game.game);
  const fail = (error: string): EngineMatchBuildResult => ({
    ok: false,
    roomId,
    game: game.game,
    error,
  });
  let deal: JieqiDeal;
  try {
    deal = engineMatchDeal(game);
  } catch (err) {
    return fail(`deal: ${(err as Error).message}`);
  }
  if (game.moves.length !== game.plies) {
    return fail(`row says ${game.plies} plies, has ${game.moves.length} moves`);
  }

  const { startedAt, endedAt } = engineMatchTiming(manifest, game, total);
  const step = game.plies > 0 ? (endedAt - startedAt) / game.plies : 0;
  const created: JieqiEvent = {
    type: 'room-created',
    at: startedAt,
    roomId,
    gameSpecId: JIEQI_SPEC_ID,
    rated: false,
    setup: deal,
    origin: engineMatchOrigin(manifest),
  };
  const events: JieqiEvent[] = [created];
  let projection = replayTenantEvents(jieqiTenant, events);

  for (const record of game.moves) {
    const where = `ply ${record.ply} (${record.move})`;
    const state = projection.state;
    if (state.status.type !== 'playing') {
      return fail(`${where}: the kernel ended the game before this move (${state.status.type})`);
    }
    if (state.status.turn !== record.color) {
      return fail(`${where}: kernel has ${state.status.turn} to move, lab has ${record.color}`);
    }
    const move: JieqiMove | null = pikafishUciToJieqiMove(record.move);
    if (!move) return fail(`${where}: unparseable move`);
    if (!isJieqiLegalMove(state, move)) return fail(`${where}: illegal in the site kernel`);
    const moverBefore = state.board[move.from];
    const victimBefore = state.board[move.to];
    if (moverBefore?.unknown || victimBefore?.unknown) {
      return fail(`${where}: touches a piece the lab never dealt`);
    }
    const event: JieqiEvent = {
      type: 'move-played',
      at: Math.round(startedAt + step * record.ply),
      roomId,
      color: record.color,
      move,
    };
    projection = applyTenantEvent(jieqiTenant, projection, event);
    events.push(event);

    const moved = projection.state.board[move.to];
    const revealed = moverBefore?.faceDown ? (moved?.role ?? null) : null;
    if (revealed !== record.reveal) {
      return fail(`${where}: reveal ${revealed} != lab ${record.reveal}`);
    }
    if (Boolean(victimBefore) !== Boolean(record.capture)) {
      return fail(`${where}: capture mismatch (kernel ${Boolean(victimBefore)})`);
    }
    if (victimBefore && record.capture) {
      if (
        victimBefore.color !== record.capture.color ||
        victimBefore.role !== record.capture.role ||
        victimBefore.faceDown !== record.capture.wasFaceDown
      ) {
        return fail(`${where}: captured ${victimBefore.role} != lab ${record.capture.role}`);
      }
    }
  }

  // The ending, as the kernel sees it.
  const aColor = game.a_color;
  const bColor: JieqiColor = aColor === 'red' ? 'black' : 'red';
  let status = projection.state.status;
  if (game.reason === 'no-move-A' || game.reason === 'no-move-B') {
    const stuck = game.reason === 'no-move-A' ? aColor : bColor;
    const winner: JieqiColor = stuck === 'red' ? 'black' : 'red';
    if (status.type !== 'finished' || status.winner !== winner || game.winner !== winner) {
      return fail(
        `${game.reason}: kernel status ${JSON.stringify(status)}, lab winner ${game.winner}`,
      );
    }
  } else if (game.reason === 'repetition') {
    if (status.type !== 'playing' || game.winner !== 'draw') {
      return fail(`repetition: kernel status ${JSON.stringify(status)}`);
    }
    const adjudicated: JieqiEvent = {
      type: 'game-adjudicated',
      at: endedAt,
      roomId,
      winner: null,
      reason: 'repetition',
    };
    projection = applyTenantEvent(jieqiTenant, projection, adjudicated);
    events.push(adjudicated);
    status = projection.state.status;
  } else {
    return fail(`unsupported lab ending ${JSON.stringify(game.reason)}`);
  }
  if (status.type !== 'finished') return fail('game did not finish');

  const kernelFen = comparableFen(jieqiStateToPikafishFen(projection.state));
  const labFen = comparableFen(game.final_fen);
  if (kernelFen !== labFen) return fail(`final position ${kernelFen} != lab ${labFen}`);

  const { participants, names } = participantsFor(manifest, aColor);
  const summary: GameSummary = {
    variant: JIEQI_SPEC_ID,
    mode: 'imported',
    result: jieqiTenant.persistence.resultForWinner(status.winner),
    termination: jieqiTenant.persistence.termination(status.reason),
    plyCount: game.plies,
    startedAt: new Date(startedAt),
    endedAt: new Date(endedAt),
    whiteClient: null,
    blackClient: null,
    whiteName: names.red,
    blackName: names.black,
    corpusId: manifest.slug,
    rated: false,
    region: 'global',
    reviewStatus: 'unreviewed',
    visibility: 'public',
    participants,
    initialMs: null,
    incrementMs: null,
  };
  const evals = {
    match: manifest.slug,
    event: manifest.eventName,
    game: game.game,
    seed: game.seed,
    engines: { red: names.red, black: names.black },
    // Each engine's own search score for the position it moved from, from the
    // MOVER's point of view, at the match time control. Not the site's analysis.
    pov: 'mover',
    plies: game.moves.map((record) => ({
      ply: record.ply,
      color: record.color,
      engine: record.by === 'A' ? manifest.engines.A.name : manifest.engines.B.name,
      move: record.move,
      cp: record.cp,
      mate: record.mate,
    })),
    ...(manifest.source ? { source: manifest.source } : {}),
  };
  const completedSquares = game.deal.red.completed.length + game.deal.black.completed.length;
  return { ok: true, value: { roomId, game: game.game, events, summary, evals, completedSquares } };
}

export function parseEnrichedMatchJsonl(text: string): EnrichedMatchGame[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const row = JSON.parse(line) as EnrichedMatchGame;
      if (typeof row.game !== 'number' || !Array.isArray(row.moves) || !row.deal) {
        throw new Error(`line ${index + 1}: not an enriched match game`);
      }
      return row;
    });
}
