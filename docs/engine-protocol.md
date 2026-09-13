# Engine protocol

Mistboard speaks to engines through a single redacted protocol. This document
specifies what the server sends, what an engine returns, and the redaction
guarantees that make the protocol auditable.

The canonical machine-readable types live in
[`packages/game/src/engine-protocol.ts`](../packages/game/src/engine-protocol.ts).
This document is the human-readable contract.

## Why this protocol exists

Mistboard's trust story is that no player (including first-party engines)
can see hidden information under Fog of War rules. The same protocol applies
to:

- Built-in engines that ship in the public Mistboard repo
- First-party engines that ship as separate binaries
- Third-party engines that anyone is free to write

There is no "trusted exception." If an engine claims to have made a legal
move from this protocol's inputs alone, the server believes it. If the move
turns out to use information the engine shouldn't have had, that's a bug in
the engine, not a privileged data channel from the server.

## Lifecycle

1. **Game start.** The server creates a per-engine session keyed by
   `(gameId, engineId, color)`. The engine MAY pre-allocate state.

2. **Engine's turn.** The server constructs an `EngineTurnRequest` and
   sends it to the engine. The first request in a session carries a full
   `observationTranscript`. Subsequent requests in the same session may
   instead carry a `latestObservationDelta`, letting stateful engines
   apply incremental updates.

3. **Engine response.** The engine returns an `EngineTurnResponse` with a
   `move` chosen from the request's `legalMoves`. The server validates and
   applies. An illegal/missing/timeout response follows the selected engine's
   live policy. First-party Python engines fail closed: no random move is
   attributed to them when the engine service or engine code fails.

4. **Post-move observation (optional).** Immediately after applying the
   engine's move and BEFORE the opponent replies, the server MAY push the
   engine its own-move observation via `POST /internal/engine/observe`
   (`EngineObservationPush`, `observation.kind === 'own_move'`). This mirrors
   fog-of-war UIs where you see your new vantage the instant you move, and lets
   a stateful engine advance its belief and think on the opponent's clock
   (pondering). It is **opt-in and additive**: an engine that does not implement
   the observe endpoint still plays correctly, because the same `own_move`
   observation also arrives in its next `EngineTurnRequest`. An engine that
   handles both MUST dedupe by `ply` so it does not apply the observation twice.
   The push expects only an `EngineObservationAck` (`{ received: true }`); no
   move is requested, and no reservation is required. A failed push never
   affects the game.

5. **Game end.** When the server observes a terminal state, the final
   observation has a non-null `game_over` field. No further `EngineTurnRequest`
   is sent. The engine MAY tear down session state.

## What the engine receives

```ts
type EngineTurnRequest = {
  protocolVersion: '1';
  gameId: string;
  engineId: string;
  gameSpecId?: string;
  sessionId: string;
  color: 'white' | 'black';
  ply: number;
  engineSeed: number;
  clock: { remaining_ms: number | null; increment_ms: number };
  legalMoves: Move[];
  observationTranscript?: EngineObservation[];   // cold-start
  latestObservationDelta?: EngineObservation;     // steady-state
};
```

| Field | What | Why the engine needs it |
|---|---|---|
| `protocolVersion` | Schema version | Reject unknown major versions |
| `gameId` | Opaque game identifier | Correlate logs/diagnostics |
| `engineId` | Which engine is being asked | Engines that serve multiple identities |
| `gameSpecId` | Game variant, e.g. `'dark-xiangqi'` | Board geometry (8x8 vs 9x10) and piece-letter interpretation |
| `sessionId` | Stable across all turns of one game | Key for stateful per-game state |
| `color` | The engine's side | Move generation, eval sign |
| `ply` | 0-indexed ply count | Bookkeeping, clock decisions |
| `engineSeed` | Deterministic RNG for this turn | Reproducibility |
| `clock` | Engine's own clock state | Time budget for search |
| `legalMoves` | Engine's pseudo-legal moves | Server-validated; response must pick from this list |
| `observationTranscript` | Full history from ply 0 | Cold-start: engine recomputes belief from scratch |
| `latestObservationDelta` | Latest observation since prior turn | Steady-state: stateful engine applies one delta |

Exactly one of `observationTranscript` / `latestObservationDelta` is present.

## What an `EngineObservation` is

```ts
type EngineObservation = {
  ply: number;
  kind: 'initial' | 'own_move' | 'opp_move';
  own_move: Move | null;     // the engine's own move on 'own_move' observations
  visibility_mask: string;   // "0x..." 64-bit hex
  visible_pieces: Array<[Square, { type: PieceLetter; color: Color }]>;
  own_capture_square: Square | null;
  opp_capture_landing_square: Square | null;
  shrouded?: Array<[Square, Color]>;   // xiangqi-family color-only occupancy
  game_over: { winner: Color | null; reason: string } | null;
};
```

The observation captures everything the engine's perspective player learns
at one ply. Reconstructed cumulatively, the transcript is the engine's
complete information about the game.

- `own_move`: the move that produced this observation, present only when
  `kind === 'own_move'`. The engine's belief-update step needs the exact
  move to advance its belief set deterministically. Null for `'initial'`
  (no move) and `'opp_move'` (the engine never sees the opp's move
  directly; it reasons over which opp move could have produced the
  observation).
- `visibility_mask`: which squares the engine can see, as a 64-bit board
  bitmask in hex. Bit `i` set iff square index `i` is visible.
- `visible_pieces`: pieces on visible squares. Squares outside the mask
  are absent (NOT included as null). Squares in the mask but with no
  piece are absent (the engine infers empty from "visible but no piece
  reported").
- `own_capture_square`: set when one of the engine's own pieces was
  captured this ply. The engine sees its own pieces deterministically, so
  this is always knowable when a capture of own happens.
- `opp_capture_landing_square`: set when the engine SAW an opp piece
  arrive at a square it could see. Null when the opp's landing is invisible.
- `shrouded`: the xiangqi-family reveal channel: squares the engine can
  infer are OCCUPIED by a given color WITHOUT seeing the piece type. A
  cannon screen or a horse's blocking leg reveals an occupant but not its
  identity, so the entry carries square + owner color and nothing else.
  Absent (omitted) for dark chess, which has no color-only-occupancy
  channel.
- `game_over`: terminal indicator if the game ended at this ply.

Piece letters in `visible_pieces` are variant-scoped. Dark chess uses
`P N B R Q K`; Dark Mini Xiangqi uses `G H C R S`
(general/horse/cannon/chariot/soldier); full Dark Xiangqi uses
`K A B N R C P` (general/advisor/elephant/horse/chariot/cannon/soldier).
Shared letters are disambiguated by the request's `gameSpecId`, which is
omitted for dark chess (engines default to it, keeping the chess wire
payload byte-unchanged) and present for every other variant. The same
`gameSpecId` field also rides `EngineObservationPush`.

## Redaction guarantees (what the engine MUST NOT receive)

The server's `EngineTurnRequest` builder is the security boundary. Tests
enforce:

1. **No canonical game state.** No field references the truth board, the
   full `GameState`, or any internal server data structure.
2. **No hidden pieces.** Every square index appearing in any field
   (visible_pieces, capture squares) lies within the engine's visibility
   mask at the corresponding ply.
3. **No hidden opp moves.** When the opp moves entirely off-visibility, the
   resulting observation contains no reference to opp's from-square or
   to-square. The engine learns only that a turn elapsed (`ply` increments)
   and any captures/visibility changes that happen to be visible.
4. **No opp clock.** Only the engine's own clock is sent.
5. **No master seed.** The room's master seed is never sent; `engineSeed`
   is derived per-engine-per-turn from secrets the engine doesn't share.
6. **No raw events.** The legacy `GameEvent[]` history is not sent. Engines
   reconstruct from observations.

These invariants are tested in
`apps/server/src/engine-protocol/build.test.ts` (Phase 2). The build
function is the only code path that produces an `EngineTurnRequest` from
internal state; all other paths route through it.

## What the engine returns

```ts
type EngineTurnResponse = {
  protocolVersion: '1';
  gameId: string;
  sessionId: string;
  move: Move;
  diagnostics?: Record<string, unknown>;
};
```

- `move` MUST be in the request's `legalMoves`. The server validates by
  set membership; equality is structural on `(from, to, promotion)`.
- `diagnostics` is free-form and treated as opaque. Engines SHOULD avoid
  including hidden truth here (server logs may filter in dev mode).

## Versioning

- `protocolVersion: '1'` is current.
- Adding optional fields stays at version 1. The server MAY add new
  optional fields the engine doesn't recognize; engines MUST ignore
  unknown fields rather than reject.
- Removing or changing the semantics of a field is a major bump.
- The server MAY return its supported versions during session
  initialization (not yet specified).

## Implementing an engine

Minimal flow:

```
on session start:
    initialize belief state B = {standard starting position}

on each EngineTurnRequest:
    if observationTranscript is present:
        B = replay full observationTranscript from ply 0
    else if latestObservationDelta is present:
        B = apply latestObservationDelta to B

    move = decide_move(
        belief = B,
        legal = request.legalMoves,
        color = request.color,
        clock = request.clock,
        rng = seeded(request.engineSeed),
    )

    return EngineTurnResponse(
        protocolVersion = '1',
        gameId = request.gameId,
        sessionId = request.sessionId,
        move = move,
    )
```

`decide_move` is your engine. Everything else is plumbing the protocol
handles for you.

## Stateful vs stateless engines

- **Stateful:** keep belief + per-game search state across requests, apply
  `latestObservationDelta` per turn. Necessary for any non-trivial engine
  (recomputing belief from a full transcript every turn is wasteful).
- **Stateless:** ignore session-scoped optimizations, recompute from
  `observationTranscript` every turn. Simpler but slower.

The protocol supports both. The server doesn't care which the engine is.

## Where the spec evolves

The canonical type definitions live in TypeScript; a Python mirror tracks
the TS file 1:1 inside the private `mistboard-engine` sibling repo
(`src/fow_chess/engine_protocol.py`). The first-party implementation lives
there. The protocol stays in the public repo so any engine, first-party
private or third-party, can implement it.

## Internal HTTP transport

Mistboard's hosted live path uses HTTP as a transport adapter for this same
protocol. The web/server process sends an authenticated POST to the
engine-worker service with an `EngineTurnRequest` JSON body; the engine-worker
returns an `EngineTurnResponse` JSON body. Authentication uses a shared
`MISTBOARD_INTERNAL_ENGINE_TOKEN` bearer token in addition to private
networking. The request body stays protocol-only; server timing is carried in
the `x-mistboard-engine-timeout-ms` header.

An engine endpoint implements one required route and one optional route:

- `POST /internal/engine/turn` (required): takes an `EngineTurnRequest`,
  returns an `EngineTurnResponse` with a legal move.
- `POST /internal/engine/observe` (optional): takes an `EngineObservationPush`
  (the mover's own-move observation), returns an `EngineObservationAck`. Bearer
  auth, no reservation. Implement it to observe your own move immediately and
  ponder on the opponent's clock; skip it and you still get the same
  observation in your next turn request.

Live admission is bounded by reservations. Web creates a reservation through
`POST /internal/engine/reservations` before creating a first-party Python PvE
room. Each subsequent turn must include
`x-mistboard-engine-reservation-id`; engine-worker rejects missing, expired, or
engine/color-mismatched reservations. `MISTBOARD_LIVE_ENGINE_SEATS` caps active
reservations, while `MISTBOARD_PYTHON_POOL_SIZE` caps concurrent moves. This
allows the service to admit M active games over N warm workers without
weakening engine quality when demand exceeds capacity.
