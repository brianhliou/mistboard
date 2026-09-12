# Persistence

How Mistboard stores game state across server restarts.

## Storage model: the event log is the source of truth

Two ideas anchor the schema and have not changed since the first migration:

1. **`events` is append-only truth.** One row per `GameEvent`:
   `events(room_id, seq, type, payload JSONB, created_at)`, primary key
   `(room_id, seq)`. `payload` stores the full event object (`type` is
   denormalized into a column for indexed filtering); `seq` is per-room,
   starting at 0 with `room-created`. Any game's state is deterministically
   reconstructable by replaying its event log, so replay URLs, mid-game
   reconnect across a restart, and postgame review all ride the same
   projection path.
2. **`games` is a derived aggregate.** One row per game, written when a
   terminal event fires (engine-vs-engine games also create a running row at
   start and update it on completion). It carries variant, result,
   termination, ply count, and timestamps, and feeds review lists, watch,
   profiles, leaderboards, and analytics. There is no FK from `events`:
   events stand alone, `games` is a projection convenience.

Pregame-only rooms (one player joined, never made a move) produce no `games`
row; they remain orphan events eligible for cleanup. Mid-game disconnect needs
no special handling: the server clock keeps running, the absent player times
out, `clock-expired` fires, and the standard game-over path writes a normal
row.

This doc deliberately carries no inline schema dump. The raw SQL migrations in
`apps/server/migrations/` are the authority for table shapes, indexes, and the
result/termination enums (which have grown far past the original design);
`migrate.ts` applies them in order, and new schema changes are always new
numbered migrations.

## Beyond the game core

The same database holds the product's other domains, each in its own
migration-owned table family:

- **Accounts, sessions, auth**: `users`, `account_sessions`, email login and
  account-change challenges, handle reservations, auth rate-limit buckets.
- **Ratings**: per-bucket Glicko-2 `user_ratings`, bot profiles and published
  bot rating snapshots.
- **Game metadata + analysis**: cached whole-game engine evals
  (`game_analysis`), debug artifacts, participants, favorites, room deadlines
  for correspondence.
- **Puzzles**: attempts, puzzle and user rating pools, daily selections.
- **Studies**: studies, chapters (serialized move trees), likes.
- **Broadcasts + historical corpus**: xiangqi broadcast tours/rounds/boards
  and sync logs; historical xiangqi sources, import batches, players, games.
- **Forum / DM / social**: forum categories, topics, posts, reports, topic watches, post quotes; DM
  threads and messages; chat lines; follow/block relations; titles; coaches.
- **Patron**: Stripe subscription projections and webhook events.

## API surface (apps/server)

`apps/server/src/persistence.ts` is a facade barrel over roughly twenty
domain-split `persistence-*.ts` modules (`persistence-games.ts`,
`persistence-accounts.ts`, `persistence-studies.ts`, and siblings). Import
existing persistence APIs from the facade; add new queries to the focused
module that owns the domain. `persistence-db.ts` owns the pool lifecycle.

Wire-up for the game core:

- Room hydration loads the persisted event log and rehydrates via
  `replayGameEvents`.
- Event append is persistence-first: the Postgres insert completes before the
  in-memory apply and the broadcast (see "Write ordering" below).
- Terminal projection writes the `games` row.

Replay visibility:

- Persisted events are canonical truth and are private while a game is live.
- `GET /api/games/:roomId/events` must only return full events after replaying them produces a terminal game state.
- Live and pregame observers receive only WebSocket snapshots that are scoped to their seat. Spectators of live Fog of War games do not receive board truth or move events.
- Administrative debug views are a separate capability. They are not authorized by room id, query params, or client-side UI state.

## Runtime Shape

Production-like deployments run one Node service for HTTP and WebSocket traffic,
backed by Postgres. The exact provider, account setup, network topology, and
deployment runbook are operational details and do not belong in this public
architecture note.

- Connection pooling: `pg.Pool` with low max (5–10) is sufficient for v1; PgBouncer becomes a question only if WS instance count rises above 1 (which it shouldn't for this roadmap).

Env:

- `DATABASE_URL` — required in production-like runtimes.
- `DATABASE_URL` in dev — optional; if absent, `apps/server` falls back to in-memory rooms (current behavior, useful for quick local iteration without a DB running).
- `MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE=true` — explicit escape hatch for intentionally ephemeral production-like environments. Do not set this on the live service.
- `MISTBOARD_ADMIN_DEBUG_TOKEN` — optional bearer token for administrative truth/debug views in production-like runtimes. Prefer sending it in a WebSocket message or subprotocol, not in URLs.
- `MISTBOARD_ALLOWED_ORIGINS` — optional comma-separated WebSocket origin allowlist. If unset in production-like runtimes, the server allows only `https://$HOST`.
- `RESEND_API_KEY` — optional Resend API key for passwordless login email delivery. Required for real email login in production-like runtimes.
- `MISTBOARD_AUTH_EMAIL_FROM` — sender address for account login emails, for example `Mistboard <login@mistboard.com>`. `RESEND_FROM_EMAIL` is also accepted as a fallback.
- `MISTBOARD_ALERT_EMAIL_TO` — optional comma-separated operator inboxes for engine alert email. Falls back to `MISTBOARD_FEEDBACK_TO` when unset.
- `MISTBOARD_ALERT_EMAIL_FROM` — optional sender address for alert email. Falls back to the feedback/auth sender when unset.
- `MISTBOARD_ALERT_EMAIL_MIN_INTERVAL_MS` — optional per-severity throttle for engine alert email. Defaults to 10 minutes.
- `MISTBOARD_DEV_AUTH_CODES=true` — explicit escape hatch that lets production-like runtimes return local passwordless email login codes in API responses. Do not set this on the live service.
- `MISTBOARD_WS_MAX_PAYLOAD_BYTES`, `MISTBOARD_WS_MESSAGE_LIMIT`, `MISTBOARD_WS_MESSAGE_WINDOW_MS` — optional WebSocket abuse-control knobs.
- `MISTBOARD_SHUTDOWN_GRACE_MS` — optional graceful shutdown budget for closing sockets, pending writes, and the Postgres pool.

Local dev DB (Docker Postgres on `localhost:5435`):

```bash
npm run dev                # persistent by default: db:up + db:migrate + server/web pair
npm run db:seed:qa         # product fixtures: profiles + live variant games + watch + QA gap-fillers
npm run test:persistent
```

`npm run dev` runs `db:up`, then `db:migrate`, then the persistent pair. `db:up`
starts the shared `mistboard-postgres` container (creating it via `docker
compose` only when it does not already exist), so it works from a git worktree
without the "container name already in use" conflict, and fails loudly if Docker
is not running. `npm run dev:memory` is the no-Postgres path. The default
variant seeder follows `config/product-profile.json` and removes only retired
rows owned by its `variant-postgame-fixture` corpus. The
individual seeders still run standalone: `db:seed:profiles`, `db:seed:watch`,
`db:seed:variant-fixtures`, `db:seed:qa-fixtures`.

Multiple sessions share one Postgres: set `MISTBOARD_DEV_PORT_BASE` (default
3000) to move a second worktree's pair to other ports (web = base, server =
base + 1; the web proxy and dev WebSocket URL follow via `MISTBOARD_DEV_API_URL`).
`strictPort` keeps an occupied port a loud failure, never an auto-increment.

The local Postgres URL is `postgres://mistboard:mistboard@localhost:5435/mistboard`.
Migrations run via a tiny in-repo script — no ORM, no migration framework. Raw
SQL files in `apps/server/migrations/` are applied in order.

Without a DB (`npm run dev:memory`), DB-backed pages are dark: `/watch`,
`/game/:id` review, profiles, and the public-games surfaces all show
empty/"unavailable" states. Two ways to exercise them:

- **Replay component only** (no DB): open `/?replay=<sample-name>`, where
  `<sample-name>` is any file under `apps/web/public/replay-samples/` (without
  the `.jsonl`). Mounts the exact replay widget — boards, controls, ply line —
  the watch and review pages embed. Fastest loop for replay-UI work.
- **Full page** (DB): `db:seed:watch` + `npm run dev`, then load `/watch`.

`npm run db:seed:profiles` adds deterministic local public profile fixtures.
The seed is idempotent and only replaces `seed-*` users and games:

- `/@/seed-rich` — account-attributed public games, PvE/PvP rows, multiple time controls, and rated buckets.
- `/@/seed-empty` — public account with no games.
- `/@/seed-long-names` — long display/opponent names and a test-role badge for overflow checks.

The seed command refuses non-local database URLs unless
`MISTBOARD_ALLOW_NONLOCAL_SEED=true` is set.

`npm run db:seed:watch` imports every committed `apps/web/public/replay-samples/*.jsonl`
as a completed `eve` game (corpus `local-watch-fixture`), so `/watch` shows real,
scrubable replays locally. It is a thin wrapper over `import-corpus` with
`--mode eve` (the default `imported` mode is excluded from the watch feed, which
filters `mode IN (pvp, pve, eve)`). Idempotent on `(room_id)`; safe to re-run.
Both seed commands hardcode the local Postgres URL.

`npm run db:seed:qa-fixtures` (folded into `db:seed:qa`) fills the local-only
gaps the other seeders miss, idempotently and without touching existing rows:

- **Admin account** — promotes `MISTBOARD_QA_ADMIN_EMAIL` (default
  `brianhliou@gmail.com`) to `account_role='admin'`, creating the user if
  absent. It matches on `lower(email)`, so a later dev login-code sign-in with
  that email lands on the same account (dev sign-in returns the code as
  `devCode` in the API response — no email is sent locally).
- **Inbox / DM** — a few `dm_threads` + `dm_messages` between the admin and seed
  users, including one 30+ message thread (internal scroll) and unread threads
  (inbox badge).
- **Xiangqi ladder** — `user_ratings` rows for the `xiangqi`/`blitz` bucket so
  `/api/leaderboard?variant=xiangqi` is non-empty locally.

Correspondence "your-turn" games are deliberately not seeded: a dashboard entry
needs both a `room_deadlines` row and a hydratable dark-chess event log +
running-game row, and there is no committed non-terminal fixture to replay, so a
static seed would be a hollow `/room` link. Create one against the running dev
server instead.

Minimal account auth is passwordless email:

- `POST /api/auth/email/start` with `{ "email": "you@example.com" }`
- `POST /api/auth/email/confirm` with `{ "loginId": "...", "code": "..." }`
- `GET /api/auth/me`
- `POST /api/auth/logout`

If `RESEND_API_KEY` and `MISTBOARD_AUTH_EMAIL_FROM` are configured, `start` sends
the code through Resend. In local/dev, `start` also returns `devCode` in the
JSON response so the flow can be tested without email delivery. Confirming
creates or reuses a durable `users` row and sets an HttpOnly `mistboard_session`
cookie backed by `account_sessions`. This account session authorizes
account-owned actions only; live room moves still require room-scoped seat
authority.

## Apps/server In Production-Like Runtimes

`npm start` runs `node apps/server/dist/index.js`, which serves both:

- Static `apps/web/dist/*` over HTTP from the same `$PORT`.
- WebSocket upgrades on the same port.

The build pipeline must produce `apps/web/dist` before `apps/server` starts.

## Public Rollout Checks

For public verification, the important checks are provider-neutral:

1. Migrations apply before the server accepts traffic.
2. `/health` reports unhealthy if persistence is required but unavailable.
3. A completed game remains replayable after a restart.
4. A live room rehydrates from events after a restart.
5. Live Fog of War replay APIs still reject full event access until terminal state.

## Write ordering: persist-then-apply

```ts
async function appendEvent(room, event) {
  const seq = room.events.length;
  await persistence.appendEvent(room.id, seq, event);  // throws on failure
  room.events.push(event);
  room.projection = replayGameEvents(room.events);
  scheduleClockTimeout(room);
}
```

Postgres write goes first. If it fails, in-memory state never changes; the move (or seat assignment, or clock tick) effectively did not happen. The caller decides how to surface the failure to clients. State drift between memory and DB is impossible by construction — they either both have the event or neither does.

The cost is ~5–20ms of Postgres roundtrip per event. At chess pacing this is invisible. If write back-pressure ever shows up under bot traffic, batching is the answer (see "Future: batched writes" below).

## Crash semantics

- **Per-event durable.** `appendEvent` awaits the Postgres insert before the broadcast. A crash mid-write either commits the row or doesn't — no partial state.
- **Hydration is deterministic.** `replayGameEvents(events)` is pure; rehydrating produces the same `GameProjection` regardless of when the crash happened.
- **Clock state.** `clock-expired` is itself an event — if the server crashes mid-tick, on rehydration the next `scheduleClockTimeout` will detect already-expired clocks and emit the event then. No clock drift across restarts beyond the redeploy window itself, which is acceptable for v1 (testers reconnect, see expected state).

## Failure handling

The dangerous failure mode is silent: Postgres degrades, writes start failing, and games keep playing in memory while users believe their moves are persisted. Every defense is built around making that scenario impossible.

**Persist-then-apply ordering** is the structural defense (above). The rest is observability and surfacing.

- **Loud structured logs.** On every persistence failure, emit a single-line JSON log to stdout:
  ```
  console.error(JSON.stringify({
    level: 'error',
    kind: 'persistence_failure',
    roomId, seq, eventType: event.type,
    error: err.message,
    at: Date.now(),
  }));
  ```
  Deployment logs should capture stdout. Alerting can hook on `kind: persistence_failure`.

- **Don't swallow.** Errors propagate up to the WS message handler, which:
  1. Skips the broadcast (in-memory state was never updated, so there's nothing consistent to broadcast).
  2. Sends `{ type: 'error', reason: 'persistence_failure' }` to the originating client.
  3. The client surfaces a toast or "reconnecting" indicator and may retry the move.

- **Health endpoint surfaces recent failures.**
  ```
  GET /health
  → 200 { ok: true, databaseRequired: true, persistence: "enabled", persistenceErrors: { count1m: 0, lastAt: null } }
  → 503 { ok: false, databaseRequired: true, persistence: "disabled", persistenceErrors: { count1m: 0, lastAt: null } }
  → 503 { ok: false, databaseRequired: true, persistence: "enabled", persistenceErrors: { count1m: 4, lastAt: 1714... } }
  ```
  Production monitoring can alert on 503s; this gives operational visibility without requiring a metrics stack.

- **No silent retries in v1.** Retry logic adds complexity ahead of evidence. We'd rather see real failure modes first and design retries around what actually breaks.

The combination — persist-then-apply + loud logs + non-200 health on recent failures — means a degrading Postgres can't go unnoticed. Either every move starts visibly failing for clients, or operators see the 503 / log spike, or both.

## Future: batched writes

Synchronous per-event inserts are fine through PL2. The pressure point will likely be PL3 ladder traffic with multiple bots playing concurrently — Postgres write throughput per connection becomes the ceiling, not Postgres itself.

When that arrives, the change is to a per-room write queue with a debounce (e.g., 50ms) that flushes a batch insert. Crash semantics shift slightly: a crash within the debounce window can lose up to N events. The mitigation is to flush synchronously at game-end (`king-capture`, `clock-expired`) and at any event the WS handler doesn't explicitly mark as batchable. Mid-game move events are batchable; terminal events aren't.

Not building this yet, but the persist-then-apply API surface is forward-compatible: `persistence.appendEvent` becomes "enqueue and resolve when flushed" rather than "insert and resolve."

## Migration & data model evolution

- New `GameEvent` variants: payload-only changes, no DDL.
- Renaming or restructuring an existing event: keep the old shape readable. The `replayGameEvents` reducer is the single chokepoint that needs to handle both.
- Backfill: if a payload format changes, write a one-shot script that reads + rewrites JSONB rows. Don't add migration framework ceremony for this.

## Cold archival (PL2+, not now)

Once the corpus pipeline matures, finished games dump to R2/S3 as NDJSON nightly:

```
SELECT payload FROM events
WHERE room_id IN (SELECT room_id FROM games WHERE ended_at::date = $1)
ORDER BY room_id, seq
```

Lab corpus consumers continue to read NDJSON. Live server doesn't depend on the archive.

## Open questions

- **Pregame-abandoned rooms.** A room created but never moved past `room-created` clutters `events`. Lean: GC rows older than 7 days where `seq` never exceeded a threshold. Cron, not v1.
- **Spectator semantics across restart.** Spectator state is connection-only, not persisted. After restart, spectators reconnect and see live state via fresh `PlayerView` snapshots. No data persistence concern.
- **Schema versioning.** Skipped intentionally for event payloads: JSONB rows are versioned at the application layer when reading payloads.
