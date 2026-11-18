# Local PvP acknowledged move latency

This benchmark measures monotonic elapsed milliseconds from submission of a
move to receipt of the corresponding authoritative `move-played` delta **by the
mover**. Both seats contribute samples. Receipt time is captured at the start
of the WebSocket message handler, before parsing, buffering or resolving a
waiter. A sample must match color, from, to and promotion, and have an integer
`seq` newer than every delta already observed by that client at submission.
Frames already in the buffer, stale sequences, unrelated events, filtered
opponent events and duplicate frames cannot acknowledge a new submission.

One case has no delta. When a move ends the game (a king capture in Fog chess)
the server sends every client a full `snapshot` with a finished status instead.
That snapshot acknowledges the move only when its event list holds the mover's
own `move-played` at an index newer than the submission; the index is recorded
as the sample's `seq`.

The old `moveLatencies` field is retained separately: white's submission to
its next own-turn state receipt, which includes the opponent's reply. It is
not the acknowledgment metric. The geographic HTTP probe is unchanged.

## Protocol and reproduction

Use an isolated non-production server and disposable data. The CLI accepts
only numeric loopback WebSocket origins (`127.0.0.0/8` or `::1`), disallows URL
credentials, paths and query strings, and refuses HTTP redirects. `localhost`
is deliberately rejected to avoid DNS ambiguity. Do not point a tunnel or
proxy on loopback at a production service. The persistence and placement
arguments are operator declarations; the client cannot verify them remotely.

Provision a disposable Postgres database in the local dev container, migrate
it, and start one server against it on a loopback port of your own (the port
must be free; do not let it move). `<db>` is a database name used for nothing
else:

```sh
TEST_DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/<db> \
  node scripts/ensure-test-database.mjs
env DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/<db> \
  npm run migrate --workspace @mistboard/server
cd apps/server && env DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/<db> \
  PORT=3140 MISTBOARD_BIND_HOST=127.0.0.1 npx tsx src/main.ts
```

In another terminal, from the repository root, run the two bundles (about two
and a half minutes each). Keep every record, including failed attempts:

```sh
node --import tsx apps/server/loadtest/cli.ts --benchmark \
  --server ws://127.0.0.1:3140 --mode pvp-blitz --seed 42 \
  --warmup 10s --duration 30s --think 1s --repetitions 3 \
  --persistence disposable-postgres --placement same-host-separate-process \
  --concurrency 10,50 --out /tmp/mistboard-local-pvp-n10-n50.json
# and again with: --concurrency 200 --out /tmp/mistboard-local-pvp-n200.json
```

Stop only the server you started, then drop the database. Never use the shared
development database or production data. A memory-only server
(`MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE=true`, no `DATABASE_URL`, labelled
`--persistence memory`) is enough to check the driver but leaves out
transaction and database costs.

`--think` is the mean pause before each submission, drawn uniformly from half
to one and a half times the value so games do not move in lockstep. It comes
before the submit timestamp and is never part of a sample. It is required in
practice: the server allows each socket 40 messages per 10 seconds
(`MISTBOARD_WS_MESSAGE_LIMIT`), so a loop with no pause measures the rate
limiter. One second gives about one move per second per game, roughly four
times the pace of a real blitz game.

Workers open their first rooms spread over 10 ms per game, capped at half the
warmup (`protocol.rampMsPerGame`). Opening 200 rooms in one tick overflows the
128-connection listen backlog on macOS and the refused connections read as
setup failures.

`pvp-blitz` uses the existing Fog chess scenario, two sockets per game and
seeded random legal moves. Workers replace capped or finished games for the
entire warmup plus measurement interval. Worker seeds and actual game order
are recorded; scheduling and game durations can change the later trajectories.
There is no promise of identical samples or game order across executions.

Warmup and measurement share the same workload. Only moves submitted after
warmup **and** acknowledged before the measurement deadline contribute to
percentiles. An in-flight move at the deadline is retained as `window-ended`,
with no invented timeout or latency, and so is a wait for the opponent's move
that the deadline cut short. An earlier timeout or rejected move is a
failure. A failing worker stops rather than generating a retry storm; other
workers and all subsequent repetitions still run. Connection failures close
any sockets already opened, and previous successful samples remain in the raw
record when a later operation fails.

## Reading and reconstructing the record

JSON contains the source revision, dirty state, harness source fingerprint,
Node version, OS/CPU/memory, persistence declaration, placement and exact run
settings. Each repetition contains all game attempts, both seats' raw move
attempts, outcomes, failures, sample count and achieved acknowledged moves per
second. Per-game indexes replace server room IDs; no seat tokens, cookies,
account identifiers, HTTP response bodies or environment values are recorded.
Monotonic offsets are relative to each repetition, not shared wall-clock time.

`activity` records every active-game count transition and the start/end counts.
A game counts as active after both PvP sockets are seated and authoritative
playing state is observed, until its play loops stop; setup and teardown are
excluded. The summary integrates this step function over the measurement
window, including time at zero after a worker fails. Read actual min/max/mean
concurrency alongside the requested number, not as interchangeable figures.

Sort that repetition's `games[].moveAttempts[]` entries with
`phase === "measurement"`, `outcome === "acknowledged"` and
`receivedMs <= warmupMs + measurementMs` by `latencyMs` ascending. For N samples,
nearest-rank p50 is sample `ceil(0.50*N)-1` and p95 is `ceil(0.95*N)-1` (zero-based).
The same rule applies to p99. Values retain their original precision.

A repetition requires at least 100 samples, a complete measurement window and
no failures for a latency claim. The 100-sample floor is an explicit reporting
rule, not statistical confidence or a tail-latency guarantee. If any repetition
fails, is incomplete, or lacks enough samples, **every latency summary in the
bundle is null**. Undeclared persistence/placement also prevents claims. Raw
samples, failure counts and achieved rates are retained for diagnosis. Do not
pool repetitions, drop slow/failed attempts or select the fastest run. Exit 0
means eligible; exit 1 means failed/ineligible; exit 2 means invalid invocation
or a fatal harness error. `--out` (compact) and stdout (indented) contain the same
structured JSON.

A record named `<UTC-date>-local-pvp.json` belongs beside this guide, and a
test rebuilds its percentiles from the raw samples. `2026-11-17-local-pvp.json`
is the 10 and 50 game bundle from the commands above. The 200 game bundle is
about 5 MB and is not committed.

## Limits and checks

This is a same-host driver with a fixed think time. It measures server handling plus local
transport, client event-loop scheduling and JSON parsing/serialization effects;
it omits browser rendering, real users' think time, internet paths and geographic
latency. Client and server contend for the same hardware. It does not correct
coordinated omission and is not a production-capacity or p99 SLO claim. A busy
shared machine, persistence changes, throttling and warm caches affect results.

Run the offline regression suite and typecheck/lint from this worktree:

```sh
node --import tsx --test apps/server/loadtest/runner.test.ts
npm run typecheck --workspace @mistboard/server
npm run lint -- apps/server/integration/harness.ts apps/server/loadtest/runner.ts \
  apps/server/loadtest/cli.ts apps/server/loadtest/stats.ts \
  apps/server/loadtest/benchmark.ts apps/server/loadtest/runner.test.ts \
  apps/server/src/loadtest.test.ts
```

The normal server test globs run a small `src/loadtest.test.ts` bridge, so the
load-tooling suite is also exercised by source and compiled package runners.
Existing shell sweeps are legacy PvE/round-trip tools; use the command above for
the acknowledgment protocol.
