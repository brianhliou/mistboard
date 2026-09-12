# Architecture

## One-line shape

Full-stack board-game platform for xiangqi, chess, and related variant families: a Vite-bundled TypeScript browser client + a Node.js WebSocket server + Postgres. The Node server serves the built static client and the WebSocket on the same port; everything runs on one hosting provider. Variants range from open-information games (standard xiangqi, Jungle) to hidden-information games (Fog of War chess and xiangqi, Jieqi, Banqi, Kriegspiel), and the architecture is built so hidden information can never reach the wrong client.

## Package layout

```text
packages/game          Pure game logic: types, per-variant rules kernels, visibility, clocks, event replay, puzzle corpora
packages/board-render  Shared SVG/interactive board rendering primitives
apps/server            WebSocket rooms, variant-tenant runtime, sessions, clocks, HTTP API, persistence, ratings, engine serving
apps/web               Browser client (Vite + vanilla TypeScript, no framework): live rooms, review/analysis, watch, learn, articles, accounts
```

`INDEX.md` at the repo root is the file-level map for all four workspaces.

## Key abstraction

Every variant projects canonical server-side state into a per-player view before anything leaves the server. For the chess stack that function is `getPlayerView(state, color)` in `packages/game`; each variant tenant supplies its own equivalent as `viewForClient`. Under Fog of War rules the projection returns only what that player can see: their pieces, visible opponent pieces, legal moves, and clock. Nothing downstream of this call touches hidden truth.

## State model

- **`GameState`** (and per-variant equivalents): canonical server-side truth. Never serialized to clients.
- **`PlayerView`**: the per-player projection sent over WebSocket. Contains only what that seat may know.
- **`GameEvent`**: an append-only log entry in Postgres `events(room_id, seq, payload JSONB)`. Full game state is deterministically reconstructable by replaying the event log.
- **`games`**: a one-row-per-game aggregate table, written at terminal projection (engine-vs-engine games also record a running row). Feeds review lists, watch, profiles, leaderboards, and analytics.

## The variant-tenant runtime

New variants run on a shared, generic live-room runtime rather than bespoke server loops:

- **Server** (`apps/server/src/variant-tenant/`): the `VariantTenant` contract plus generic plumbing (event-sourced room runtime, WebSocket runtime, room factory, `POST /api/rooms` route factory, lobby matching, rematch, hydration from the persisted event log, and a registry that routes by game-spec id and room-id prefix). A variant contributes a tenant definition (rules kernel binding, per-seat view policy, wire event redaction) plus a registration file; the registration import in `variant-tenant/register-tenants.ts` is the single extension point.
- **Web** (`apps/web/src/variant-tenant/`): the client-side registry mirror (page routing, review URL bases, watch replay mounts, play-picker configuration) plus a generic live-room client core, a shared socket client (reconnects, seat-token hand-off, resync), and shared room chrome (clocks, actions, move list).

Per-seat redaction is tenant policy: fog tenants strip hidden positions per seat, hidden-identity tenants (Jieqi, Banqi) strip the server-secret deal and unrevealed piece identities, and open-information tenants pass state through untouched.

## Fail-closed variant dispatch

Dispatch on a game-spec id never falls back: an unknown id throws or rejects rather than mapping onto another variant's behavior. The server request gate is an exhaustive allowlist, so adding a variant id fails the build until the gate explicitly admits it. Registry-driven conformance tests pin the dispatch surfaces: `apps/web/src/variant-registry-sync.test.ts` (client routes and web/server tenant parity), `apps/web/src/variant-conformance.test.ts` (the create flow), and `apps/server/src/game-spec-request-gate.test.ts` (the gate itself).

## Data flow

1. Browser creates a room via HTTP POST (`/api/rooms`). Server returns a room id (tenant rooms carry a variant prefix, e.g. `xq_`) and a seat token.
2. Browser opens a WebSocket connection. Server sends an initial per-seat snapshot.
3. On move: browser sends a `move` message. Server validates against the canonical full state, appends a `GameEvent` (persistence-first), projects the new state, and broadcasts per-player view updates.
4. On game end: server appends a terminal event and writes the `games` aggregate row.
5. Postgame: the browser switches to review. Chess-stack games use `GET /api/games/:roomId/events`, which is public only after terminal state; other variants use per-variant postgame APIs with the same reveal gate. Pre-terminal requests are rejected or seat-scoped.

## Review and analysis

Finished games review through one shared shell: `apps/web/src/review/review-shell.ts` (the centered three-column layout), `review-layout.ts` (board stage, underboard, controls, scrubber), and `tree-review.ts` (the variant-neutral tree-review controller: interactive board, branching move tree, eval gauge, engine panel, whole-game analysis). Each variant plugs in a `VariantTreeAdapter` over the move-tree spine (`review/game-tree.ts`) plus a small presentation bundle. Hidden-information variants project per-POV views through their rules kernel, so a review page can show a truth board next to per-seat masked views without leaking anything the postgame API did not reveal.

Analysis comes in layers: server-side whole-game engine eval cached in the `game_analysis` table, a decision-vs-luck decomposition for chance-reveal variants, and study/gamebook tooling built on serialized move trees.

## In-browser engines (ceval)

Review and analysis surfaces can run an engine in the browser behind a single `CevalHandle` contract (`apps/web/src/review/engine/`): a Fairy-Stockfish WASM backend and Misty WASM backends (first-party Rust engines compiled to WebAssembly). Backends are dispatched per variant, evaluate one redacted FEN per position, and stream MultiPV lines to the engine panel and eval bar. Hidden-information variants feed the browser engine the same redacted encoding the server-side engines get.

## Watch (Mistboard TV)

`/watch` channels are derived from the variant registry: each watchable tenant contributes a human-play channel, and engine-vs-engine games are segregated into a cross-variant Engines channel. Replays mount through per-variant watch adapters over the postgame APIs. Live fog games are never observable with board truth; watch surfaces show finished games.

## Engine protocol boundary

First-party engine internals live outside this repository. The server speaks to hidden-information engines only through the redacted `EngineTurnRequest`/`EngineTurnResponse` protocol (`packages/game/src/engine-protocol.ts`; human-readable contract in [`docs/engine-protocol.md`](engine-protocol.md)), and `apps/server/src/engine-paths.ts` is the single point that resolves the private engine repo location. Perfect-information variants are served by UCI subprocess engines (Fairy-Stockfish, Pikafish, first-party Misty binaries) through a shared UCI harness; the protocol path is reserved for games where redaction matters.

## Other product surfaces

- **Studies**: user-created analysis documents; chapters store serialized move trees and replay through the shared review stack.
- **Tournament broadcasts**: xiangqi broadcast ingest (polling external sources, legality-replaying moves) with SSE-updated public viewer pages.
- **Puzzles**: per-variant mined puzzle corpora live in `packages/game` with a rated attempt loop on the server.
- **Learn**: interactive rules tutorials built on the same kernels and board renderers as live play.

## Packages/game internals

`packages/game` holds the pure kernels, one module per variant family (`variants.ts` for the chess/fog kernel, `variants-xiangqi*.ts`, `variants-jieqi.ts`, `variants-banqi.ts`, `variants-jungle*.ts`, and siblings), plus the shared spine: `types.ts` (state and view types), `game-specs.ts` (the cross-family game-spec taxonomy and stable ids), `events.ts` (event replay), `clocks.ts` and `time-controls.ts`, `notation.ts`, engine FEN encoders, and `engine-protocol.ts`. Tests live next to the code; visibility and move-generation rules changes belong here with regression tests.

## Server internals

Key files:
- `main.ts`: production entry point; installs shutdown handlers and starts the server
- `index.ts`: server orchestration and dependency wiring
- `server-http.ts`: HTTP entry routing, static serving, health, API dispatch, and page fallbacks
- `http-api.ts` and `routes/*`: REST endpoints split by domain
- `server-ws-connection.ts`: chess-stack WebSocket connection and message handling; tenant variants ride `variant-tenant/ws.ts`
- `room-manager.ts`: chess-stack game loop; tenant variants ride `variant-tenant/runtime.ts` and `variant-tenant/events.ts`
- `payloads.ts`: recipient-scoped snapshot construction and fog redaction for the chess stack; tenants redact through their own view policy
- `persistence.ts`: the persistence facade over the domain-split `persistence-*.ts` modules

Server unit tests live in `apps/server/src/*.test.ts`; Postgres-backed tests skip unless a test database is configured. WebSocket integration tests live under `apps/server/integration/`. Run `npm run test:persistent` for the local Postgres-backed suite.

## Persistence

Events and games write to Postgres. In dev, `npm run dev` starts a local Docker Postgres, applies migrations, and runs the persistent pair; `npm run dev:memory` falls back to in-memory rooms for quick UI work.

See [`docs/persistence.md`](persistence.md) for the storage model and dev workflow.

## External dependencies

- One hosting provider runs the Node server + static client + Postgres
- Domain: mistboard.com

Provider choice is not load-bearing; the server is plain Node and the client is a static Vite build. Postgres is the only stateful dependency.

## Notable choices

- **Server-authoritative is non-negotiable.** Hidden-information correctness depends on it. The client never holds canonical state. A correct hidden-information implementation must never send hidden truth to the wrong consumer.
- **Event log as source of truth.** Game state is always reconstructable by replaying the event log. Replay, reconnect, and postgame review all share the same projection path.
- **The per-player view is the security boundary.** All outbound WebSocket messages and non-admin API responses go through a view projection before leaving the server. Sending raw canonical state to a client is a security bug.
- **Variants are pluggable, and dispatch fails closed.** The tenant runtime makes adding a variant a matter of writing a kernel, a tenant policy, and a registration; the conformance tests and the exhaustive request gate make it impossible to add one silently or route an unknown id to the wrong rules.
