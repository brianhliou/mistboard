# @mistboard/server

WebSocket game server. Handles room lifecycle, player sessions, clocks, event persistence, and the HTTP API.

## Key responsibilities

- Create and manage game rooms (in-memory or Postgres-backed)
- Enforce hidden-information: every outbound message is a seat-scoped view (`getPlayerView` on the chess stack, each tenant variant's own view policy) before it leaves the server
- Validate moves against canonical `GameState` and append `GameEvent`s
- Serve static web client (`apps/web/dist`) and WebSocket upgrades on the same port
- HTTP API for room creation, lobby, replay, OG images

## Running locally

```bash
npm run dev              # default: Docker Postgres (port 5435), migrations, server + web
npm run dev:memory       # in-memory rooms, no Docker needed
```

Dev room URLs:

```text
http://localhost:3000/?room=fog-dev&reset=1&variant=dark-chess
http://localhost:3000/?room=fog-engine-dev&reset=1&variant=dark-chess&dev=engine
```

Both are Fog Chess rooms on the chess stack; xiangqi-family variants run through
`src/variant-tenant/`.

## Tests

```bash
npm test                 # in-memory harness
npm run test:persistent  # requires local Postgres (npm run db:up first)
```

Unit tests live in `src/*.test.ts`. WebSocket integration tests live under
`integration/`. Tests that check persistence behavior should use
`test:persistent` — the in-memory harness cannot catch DB-constraint
violations or persistence bugs.

## Key files

| File | Purpose |
|------|---------|
| `main.ts` | Production entry point |
| `index.ts` | Server orchestration and dependency wiring |
| `server-http.ts` | HTTP/static/API entry routing |
| `http-api.ts` + `routes/*` | REST endpoints by domain |
| `server-ws-connection.ts` | Chess-stack WebSocket connection handling; tenant variants ride `variant-tenant/ws.ts` |
| `room-manager.ts` | Chess-stack game loop; tenant variants ride `variant-tenant/runtime.ts` |
| `payloads.ts` | Recipient-scoped snapshots and fog redaction |

## Live engine service

Live PvE sends first-party engine turns through an internal service that speaks
the public redacted `EngineTurnRequest` / `EngineTurnResponse` protocol. Before
creating a live engine room, the server reserves an engine seat. Turns carry
that reservation id, and game end releases it. If engine capacity is exhausted,
room creation returns `engine_busy` instead of starting a game that cannot
receive engine moves.

`EngineTurnRequest.legalMoves` reuses the public game `Move` shape: promotion
values are role names (`queen`, `rook`, `bishop`, `knight`). Visible pieces in
observations use protocol letters (`Q`, `R`, `B`, `N`, `P`, `K`).

If that service is missing or unhealthy, Python-engine turns fail closed and
are logged instead of being masked by a random local move under the engine's
identity.

Provider setup, private networking, release sequencing, smoke tiers, and alert
destinations are operator runbook material and stay out of this public README.

The metrics tick emits `kind: "metrics"` counters for dashboards. Actionable
engine failures also emit a separate `kind: "engine_alert"` line at `error` or
`warn` level. Notification rules should page on critical engine alerts and route
capacity warnings separately. Critical alert fields include
`engine_fallbacks_tick`, `engine_move_failures_tick`, `engine_turns_failed_tick`,
`engine_turn_timeouts_tick`, `python_pool_errors_tick`,
`python_pool_timeouts_tick`, `engine_reservation_errors_tick`, and
`engine_reservation_release_failures_tick`. The capacity warning is
`engine_reservation_busy_tick`; it means admission control protected running
games, but demand exceeded available live engine seats. Watch
`engine_turn_deadline_guards_tick` as a trend metric rather than a page, because
deadline guards are expected near the end of low-clock games.

Alert email is optional. Engine alert rendering is covered by tests, and
runtime delivery should be verified without printing provider credentials or
environment values.

## Security invariant

A `PlayerView` — not a `GameState` — is the only thing that should ever leave the server toward a client. Any outbound path that sends full board state or hidden moves is a security bug. See [`SECURITY.md`](../../SECURITY.md).
