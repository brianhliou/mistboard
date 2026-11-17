# Local PvP acknowledged move latency

This benchmark measures monotonic elapsed milliseconds from submission of a
move to receipt of the corresponding authoritative `move-played` delta **by the
mover**. Both seats contribute samples. Receipt time is captured at the start
of the WebSocket message handler, before parsing, buffering or resolving a
waiter. A sample must match color, from, to and promotion, and have an integer
`seq` newer than every delta already observed by that client at submission.
Frames already in the buffer, stale sequences, unrelated events, filtered
opponent events and duplicate frames cannot acknowledge a new submission.

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

From the repository root, launch a separate, memory-only server in one terminal
(no engines, no persistent database, no credentials):

```sh
env -u DATABASE_URL -u TEST_DATABASE_URL NODE_ENV=test \
  MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE=true \
  node --import tsx --input-type=module -e '
    const {startServer, installShutdownHandlers} = await import("./apps/server/src/index.ts");
    installShutdownHandlers();
    await startServer({host: "127.0.0.1", port: 31851});
  '
```

In another terminal, run all six repetitions (about seven minutes plus setup
and bounded teardown). Keep this complete record, including failed attempts:

```sh
node --import tsx apps/server/loadtest/cli.ts --benchmark \
  --server ws://127.0.0.1:31851 --mode pvp-blitz \
  --concurrency 1,50 --seed 42 --warmup 10s --duration 60s --repetitions 3 \
  --persistence memory --placement same-host-separate-process \
  --out /tmp/mistboard-local-pvp.json > /tmp/mistboard-local-pvp.stdout.json
```

Stop only the server you started with Ctrl-C. For a persistence benchmark,
provision a dedicated disposable Postgres database, migrate it and launch the
isolated server against it in your own terminal; label the client run
`--persistence disposable-postgres`. Never use the shared development database
or production data. Memory mode is useful for driver verification but does not
measure transaction or database costs.

`pvp-blitz` uses the existing Fog chess scenario, two sockets per game and
seeded random legal moves. Workers replace capped or finished games for the
entire warmup plus measurement interval. Worker seeds and actual game order
are recorded; scheduling and game durations can change the later trajectories.
There is no promise of identical samples or game order across executions.

Warmup and measurement share the same workload. Only moves submitted after
warmup **and** acknowledged before the measurement deadline contribute to
percentiles. An in-flight move at the deadline is retained as `window-ended`,
with no invented timeout or latency. An earlier timeout or rejected move is a
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

A record named `<UTC-date>-local-pvp.json` belongs beside this guide. The initial
record documents the sandbox attempt: the server cannot bind loopback
(`listen EPERM`), all six repetitions retain room-creation failures and zero
samples, and no percentile claim is emitted. A successful local replay is still
required before treating these changes as measured evidence.

## Limits and checks

This is a closed-loop, same-host driver. It measures server handling plus local
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
