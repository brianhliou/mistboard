/**
 * Mistboard engine protocol — the contract any engine speaks to the server.
 *
 * Public, audit-able interface. The server constructs an `EngineTurnRequest`
 * for the engine when it's the engine's turn, and the engine returns an
 * `EngineTurnResponse` containing its move. The protocol redacts hidden
 * information: an engine receives ONLY what its perspective player can know
 * under Fog of War visibility rules.
 *
 * Why this protocol exists
 *
 * Mistboard's trust story is that no player (including first-party engines)
 * can see hidden information. The old `EngineMoveContext` shape exposed the
 * canonical `GameState` and full `GameEvent[]` history to every engine —
 * fine for builtin engines that don't peek, but a "trusted exception" we'd
 * have to extend if first-party engines were ever served from a different
 * process or repo. The new protocol makes redaction the default and the
 * spec, so first-party and third-party engines speak the same language.
 *
 * What the engine receives (this file)
 *
 *   - color, ply, clock — context the engine needs to play
 *   - engineSeed — deterministic RNG for this turn
 *   - legalMoves — the engine's own pseudo-legal moves
 *   - playerView (visibility mask + visible pieces) — current redacted view
 *   - observationTranscript OR latestObservationDelta — the engine's full
 *     observation history since game start (cold-start) or just the latest
 *     observation since the last query (steady-state with stateful engines)
 *
 * What the engine MUST NOT receive (enforced by the build function + tests)
 *
 *   - canonical `GameState`
 *   - raw full `GameEvent[]`
 *   - opp piece positions on squares not in the visibility mask
 *   - opp move from-square or to-square when neither is in the visibility mask
 *   - opp clock readings (engine only sees its own clock)
 *   - the room's master seed (engine sees a derived `engineSeed`)
 *   - any private admin / debug fields
 *
 * Redaction is verified by `apps/server/src/engine-protocol/build.test.ts`
 * (Phase 2). The build function is the security boundary.
 *
 * Versioning
 *
 * Bumping `protocolVersion` is a breaking change for engines. Adding optional
 * fields is non-breaking and stays at the same version. The server SHOULD
 * accept an unknown future-version response field; the engine SHOULD ignore
 * unknown future-version request fields.
 */

import type { Color, Move } from './types.js';

export type EngineProtocolVersion = '1';

/**
 * Piece type letters across variants. Dark chess uses P/N/B/R/Q/K; Dark Mini
 * Xiangqi uses G/H/C/R/S (general/horse/cannon/chariot/soldier); full Dark
 * Xiangqi uses K/A/B/N/R/C/P (general/advisor/elephant/horse/chariot/cannon/
 * soldier). Shared letters are disambiguated by `gameSpecId`.
 */
export type PieceLetter = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'G' | 'H' | 'C' | 'S' | 'A';

/**
 * Square index 0..63. a1=0, b1=1, ..., h1=7, a2=8, ..., h8=63.
 * Matches python-chess square indexing. Engines that prefer string
 * names (`Square` from `./types`) convert at their boundary.
 *
 * The protocol uses indices (not name strings) for wire compactness
 * and uniform consumption across languages — JSON-readable as plain
 * numbers and trivially round-tripped through python-chess `SQUARES`.
 */
export type SquareIndex = number;

/**
 * One ply's worth of observation, from the engine's perspective player.
 *
 * Mirrors the Python `fow_chess.observation.Observation` dataclass on the
 * wire. An engine reconstructs its belief state (the set P of positions
 * consistent with its observation history) by applying these in sequence
 * from the start.
 */
export type EngineObservation = {
  /** 0-indexed ply count AT which this observation was made. */
  ply: number;

  /**
   * Whose move produced this observation:
   *   - `'initial'` — the starting position (ply 0, no move yet)
   *   - `'own_move'` — engine just moved; what its own move revealed/hid
   *   - `'opp_move'` — opp just moved; what engine observed
   */
  kind: 'initial' | 'own_move' | 'opp_move';

  /**
   * The move that produced this observation, when `kind === 'own_move'`.
   * Present only on own-move observations — the engine's belief-update
   * step needs the exact move to deterministically advance its P set
   * (the move's pseudo-legality is the only filter on each candidate
   * truth). For `kind === 'opp_move'` this is null (the engine doesn't
   * see opp's move directly; it only sees the post-move observation
   * and reasons over which opp move could have produced it). For
   * `kind === 'initial'` this is null (no move).
   */
  own_move: Move | null;

  /**
   * 64-bit visibility bitboard as a `0x...`-prefixed hex string.
   * Bit `i` set iff `Square` index `i` is visible to the engine's
   * perspective player at this ply.
   */
  visibility_mask: string;

  /**
   * Pieces visible on those squares. Squares outside `visibility_mask`
   * are absent (NOT included as `null`/`'empty'`). The engine reconstructs
   * the rest of its belief from this delta plus prior observations.
   */
  visible_pieces: Array<[SquareIndex, { type: PieceLetter; color: Color }]>;

  /**
   * Square index where ONE of the engine's own pieces was captured this
   * ply (because the engine sees its own pieces deterministically). `null`
   * if no own-piece capture occurred.
   */
  own_capture_square: SquareIndex | null;

  /**
   * Square index where an OPP piece arrived after capturing a visible
   * engine piece — i.e., the engine saw the opp's capture happen visibly.
   * `null` if the opp's landing square is not in the visibility mask
   * (engine knows ONE piece is gone but can't see where the capturer went).
   */
  opp_capture_landing_square: SquareIndex | null;

  /**
   * Variant reveal channel (Xiangqi-family fog variants): squares the engine can
   * infer are OCCUPIED by a given color WITHOUT seeing the piece type — e.g. a
   * cannon screen or a horse's blocking leg reveals an occupant but not its identity.
   * Square index + owner color, type hidden. Absent (omitted) for dark chess,
   * which has no color-only-occupancy channel.
   */
  shrouded?: Array<[SquareIndex, Color]>;

  /**
   * Terminal indicator if the game ended at this ply. Engines reading
   * this in a transcript know the game is over and should not be asked
   * for a move.
   */
  game_over: { winner: Color | null; reason: string } | null;
};

/**
 * Engine's own clock state. Engines do NOT see opp's clock.
 */
export type EngineClock = {
  /** Engine's remaining time in ms. `null` if untimed. */
  remaining_ms: number | null;

  /** Per-move increment added after the engine moves. 0 if disabled. */
  increment_ms: number;
};

/**
 * One turn request from server → engine.
 *
 * Sent when it's the engine's turn to move. The engine MUST respond with
 * an `EngineTurnResponse` within the engine's clock budget (server enforces
 * timeouts).
 */
export type EngineTurnRequest = {
  protocolVersion: EngineProtocolVersion;

  /** Opaque game identifier. Engines may correlate logs/diagnostics by it. */
  gameId: string;

  /**
   * Identifies the engine (which engine is being asked, e.g., to route to
   * the right backing process). Engines may ignore.
   */
  engineId: string;

  /**
   * Game variant this request is for (e.g. 'dark-chess', 'dark-xiangqi').
   * Tells the engine how to interpret square geometry (board size: 8 vs 7) and
   * piece letters. OMITTED for dark chess (engines default to it) so the chess
   * wire payload is byte-unchanged; present for every other variant.
   */
  gameSpecId?: string;

  /**
   * Per-game-per-engine session identifier. Stable across all turns of
   * the same game for the same engine seat — engines use this to maintain
   * per-game state (e.g., a PEnumerator belief set across turns).
   */
  sessionId: string;

  /** Which color the engine plays. */
  color: Color;

  /** Current ply count (0-indexed; this is the ply the engine is about to play). */
  ply: number;

  /**
   * Deterministic RNG seed for the engine's decisions THIS TURN. Derived
   * from a per-engine secret + game + ply. Engines may use it for any
   * randomized sampling. Different from the room's master seed (which the
   * engine never sees).
   */
  engineSeed: number;

  clock: EngineClock;

  /**
   * Pseudo-legal moves available to the engine at the current state, from
   * the engine's perspective. The engine's response MUST pick one of these
   * (server validates). Including this lets the engine skip its own
   * move-generation in simple cases and ensures move equality semantics.
   */
  legalMoves: Move[];

  /**
   * COLD-START path: full observation history since game start. Present
   * on the first turn request of a session, or if the engine indicated
   * it has no prior state. Mutually exclusive with `latestObservationDelta`.
   */
  observationTranscript?: EngineObservation[];

  /**
   * STEADY-STATE path: just the latest observation since the engine's
   * previous turn request in this session. Engines maintain their belief
   * state across requests and apply this delta. Mutually exclusive with
   * `observationTranscript`.
   */
  latestObservationDelta?: EngineObservation;
};

/**
 * Free-form per-engine diagnostics returned with a move. Server treats as
 * opaque; may log or store for analysis. MUST NOT contain hidden truth
 * (engines should self-redact — though server logs in dev mode may filter).
 */
export type EngineDiagnostics = Record<string, unknown>;

/**
 * Engine's response to one `EngineTurnRequest`.
 */
export type EngineTurnResponse = {
  protocolVersion: EngineProtocolVersion;

  /** Echo of the request's gameId for correlation. */
  gameId: string;

  /** Echo of the request's sessionId. */
  sessionId: string;

  /**
   * The move the engine chose to play. MUST be present in the request's
   * `legalMoves`. Server validates; an illegal/missing move triggers a
   * fallback per the engine's live policy.
   */
  move: Move;

  diagnostics?: EngineDiagnostics;
};

/**
 * Post-move observation PUSH: server → engine, immediately after the engine's
 * own move is applied and BEFORE the opponent replies.
 *
 * This is the "observe right after you move" step (faithful to chess.com-style
 * fog, where you see your new vantage the instant you move). It lets an engine
 * advance its belief on its own move and think on the opponent's clock
 * (pondering) instead of waiting for its next turn request.
 *
 * OPT-IN and additive: an engine that does not implement the observe endpoint
 * still plays correctly — the same `own_move` observation also arrives in its
 * next `EngineTurnRequest` (transcript). Engines that handle BOTH must dedupe by
 * `ply` so the observation isn't applied twice. The push expects only an ack;
 * no move is requested.
 */
export type EngineObservationPush = {
  protocolVersion: EngineProtocolVersion;
  gameId: string;
  engineId: string;
  gameSpecId?: string;
  sessionId: string;
  /** The color that just moved (this engine's seat). */
  color: Color;
  /** Ply count AFTER the engine's move (matches `observation.ply`). */
  ply: number;
  /** The engine's own-move observation (`kind === 'own_move'`). */
  observation: EngineObservation;
};

/** Engine's acknowledgment of an {@link EngineObservationPush}. */
export type EngineObservationAck = {
  protocolVersion: EngineProtocolVersion;
  gameId: string;
  sessionId: string;
  received: true;
};

/**
 * The server's session identifier scheme. Engines treat sessionId as
 * opaque; this type documents how the server constructs it. Exposed so
 * other parts of the codebase (logging, persistence) can format the
 * same way.
 */
export type EngineSessionIdInputs = {
  gameId: string;
  engineId: string;
  color: Color;
};
