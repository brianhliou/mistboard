# Xiangqi Broadcast Track

Tracking issue: https://github.com/brianhliou/mistboard/issues/100

Mistboard should support Lichess-style xiangqi tournament broadcasts: an
organizer creates an event, rounds contain boards, board feeds update over time,
and viewers get a clean live/replay experience for top games without joining a
live room.

The broadcast system is publishing and study infrastructure. It is not
matchmaking, ratings, chat, or a general tournament server.

## Current Checkpoint

As of July 7, 2026, the core xiangqi broadcast loop is on `main` and locally
testable with one command:

```bash
npm run smoke:xiangqi-broadcast
```

Landed:

- canonical coordinate fixtures and legal replay validation;
- Postgres persistence for tours, rounds, boards, board updates, and sync logs;
- offline fixture import, canonical export, and public read APIs;
- deterministic event tapes, local fake source server, and local source poller;
- public broadcast index, tour, round, and board replay pages;
- persistence-backed SSE updates for round and board viewers;
- admin-only ops console with manual poll, correction mode, dry-run preview,
  recent sync logs, source health buckets, and bounded poll backoff;
- WXF/DhtmlXQ pages poll directly through the production poller (the adapter
  runs in the poll path, not only in the local fake source);
- tour-manifest workflow: one manifest URL fans out to many round/page sources,
  each gated by the same fail-closed source URL policy;
- dry-run/import preview at every level (poller `--dry-run`, ops API `dryRun`,
  ops console Preview button) running the real write path inside an
  always-rollback transaction;
- ops console can create a broadcast from a pasted source URL (preview first,
  then import), so an operator never needs shell access;
- in-server scheduled polling: a per-tour poll mode (Auto, the default, polls
  from 12 hours before the event to 7 days after its last day; On always;
  Off never) and interval in the ops console, a tick scheduler that reuses the poller's policy/backoff/sync
  logs, and quiet logging (only polls that changed something are recorded);
- a poll always re-anchors `tour.sourceUrl` to the URL the operator polls, so
  manifest tours keep re-polling the manifest rather than the last page;
- source URL safety policy that keeps production source polling fail-closed.

Still intentionally open:

- visual polish for top-tier event watching, including theater-mode treatment,
  multi-board scanning, live-move affordances, and mobile QA;
- running the first real approved event through the scheduled-polling stack.

Study/game-analysis UI is not a blocker for this broadcast track. Broadcasts
can publish and replay top games first; analysis can attach later to completed
broadcast games.

## Product Bar

The first public version should make elite xiangqi enjoyable to watch:

- event, round, board, player, federation, and result context are visible without
  making the board feel cramped;
- a round grid makes many boards scannable at once;
- a featured-board view gives one game the full theater treatment;
- replay controls are fast and deterministic;
- source/sync errors are visible to organizers, not spectators;
- completed broadcasts remain useful as permanent public game records.

Engine eval is intentionally outside the first broadcast slice. It can be added
after the core broadcast loop is trusted.

## Architecture Decision

Broadcasts should be separate from live rooms.

Live rooms own clocks, seats, hidden-info redaction, resign/abort/rematch, and
match lifecycle. Broadcasts need source ingestion, correction, replay, export,
and many spectators. Reusing live rooms would mix two different contracts.

The broadcast stack should instead create a small domain above the existing
xiangqi rules and watch/replay surfaces:

- `BroadcastTour`: public event shell.
- `BroadcastRound`: section, day, or round inside a tour.
- `BroadcastBoard`: one game stream with players, board number, result, and
  source identity.
- `BroadcastBoardState`: normalized moves, current status, tags, validation
  state, and last source checksum.
- `BroadcastSyncLog`: source snapshots, validation failures, corrections, and
  operator-visible health messages.

The board renderer and replay controls should reuse the standard xiangqi watch
stack where possible (`watch-xiangqi-replay.ts`, `xiangqi-postgame.ts`,
`renderXiangqiBoardSvg`) rather than building a second xiangqi board UI.

## Canonical Data

Xiangqi notation is fragmented, so Mistboard should not make WXF text notation,
DhtmlXQ, PGN-like text, or elephantops PGN the canonical format.

Canonical board updates use Mistboard coordinate moves:

```json
{
  "schema": "mistboard.xiangqi.broadcast.v1",
  "variant": "xiangqi",
  "tour": {
    "slug": "2025-wxc-sample",
    "name": "2025 World Xiangqi Championship"
  },
  "round": {
    "id": "men-r1",
    "name": "Men Round 1"
  },
  "boards": [
    {
      "sourceBoardId": "men-r1-b01",
      "boardNumber": 1,
      "red": { "name": "Red Player", "federation": "CHN" },
      "black": { "name": "Black Player", "federation": "SGP" },
      "moves": [
        { "from": "h3", "to": "e3" },
        { "from": "h8", "to": "e8" }
      ],
      "result": "*"
    }
  ]
}
```

Adapters may ingest WXF pages, DhtmlXQ files, UCCI strings, elephantops PGN-like
records, CSV pairings, or manual input, but all of them must normalize to the
same coordinate move list before persistence.

The poller accepts three source body shapes and detects them per fetch:

1. canonical JSON snapshot (`tour` + `rounds` + `boards`);
2. a WXF-style HTML page carrying `[DhtmlXQiFrame]` payloads, converted through
   the DhtmlXQ adapter in the poll path;
3. a source manifest (`mistboard.xiangqi.broadcast.manifest.v1`) that lists up
   to 32 page sources with optional per-entry `tourSlug`/`tourName`/`roundId`/
   `roundName` overrides. Every entry URL is validated by the same fail-closed
   source policy; nested manifests are rejected.

```json
{
  "schema": "mistboard.xiangqi.broadcast.manifest.v1",
  "sources": [
    { "url": "https://example.org/men-r1a.html", "tourSlug": "2025-wxc", "roundId": "2025-wxc-r1a", "roundName": "Men Round 1 Page A" },
    { "url": "https://example.org/men-r1b.html", "tourSlug": "2025-wxc", "roundId": "2025-wxc-r1b", "roundName": "Men Round 1 Page B" }
  ]
}
```

Every imported or pushed move must validate through the standard xiangqi rules
engine before it becomes public board state.

## Source Matching

Board updates should be idempotent and correction-friendly. Match incoming games
in this order:

1. `sourceBoardId`
2. round id plus board number
3. exact player names plus starting position
4. fuzzy player names only as an operator-reviewed fallback

Incoming updates are accepted when they are an identical replay, a legal prefix
extension, a tag/result-only update, or an explicit correction from an authorized
source. Illegal moves, incompatible prefixes, and ambiguous board matches go to
the sync log.

## Local Testing Requirement

Broadcast development must not depend on a real live event. The first milestone
must include deterministic local sources.

One-command local smoke:

```bash
npm run smoke:xiangqi-broadcast
```

The smoke prepares local Postgres, runs migrations, imports the canonical
completed fixture, applies the deterministic tape simulation, polls a fake live
source, polls the checked-in WXF/DhtmlXQ HTML fixture through the real-source
adapter, dry-run previews then polls a multi-page WXF manifest fixture
(`--manifest-dir`), and prints browser URLs for `npm run dev:persistent`.
The dry-run step proves no writes happen: the real manifest poll immediately
after still reports every board as `created`.

### Fixtures

Store small public-safe fixture packs:

```text
packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample/
  tour.json
  rounds.json
  boards.json
  games/
    men-r1-b01.json
    men-r1-b02-live.json
    men-r1-b03-invalid.json
```

Fixtures cover completed imports, invalid records, corrections, and multi-board
rounds.

### Event Tapes

Timed tapes simulate a live broadcast from static games:

```json
[
  { "atMs": 0, "board": "men-r1-b01", "moves": [] },
  { "atMs": 3000, "board": "men-r1-b01", "append": [{ "from": "h3", "to": "e3" }] },
  { "atMs": 9000, "board": "men-r1-b01", "result": "1-0" }
]
```

The same tape should run instant, realtime, or accelerated (`10x`, `60x`) so a
full round can be tested locally in minutes.

### Fake Source Server

Serve a local fake source before live polling:

```bash
npm run source:xiangqi-broadcast -- \
  --dir packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample \
  --mode clean \
  --port 3127
```

Poll it into local Postgres:

```bash
npm run db:poll:xiangqi-broadcast -- \
  --source http://localhost:3127/source.json \
  --once \
  --timeout-ms 1000
```

Simulator modes cover:

- clean incremental updates;
- stale responses;
- repeated payloads;
- malformed records;
- source 500s and timeouts.

## Milestones

Current status:

| Milestone | Status |
|-----------|--------|
| M0 fixture schema and validation | Landed |
| M1 offline import and read APIs | Landed |
| M2 local live simulation | Landed |
| M3 public viewer | Landed |
| M4 live updates | Landed |
| M5 organizer console | Landed |
| M6 real-source adapter proof | Landed for WXF/DhtmlXQ |
| Source production hardening (#118) | Landed: source policy, backoff, health buckets, manifest workflow, dry-run preview |
| Operator source import (ops console) | Landed |
| Scheduled polling (in-server) | Landed; awaiting first real approved event |
| Viewer polish for top-tier events | Not started |

### M0: Broadcast Brief And Fixture Schema

- Define TypeScript types for canonical broadcast payloads.
- Add runtime validation for fixture packs.
- Convert a tiny public xiangqi sample into canonical coordinates.
- Add validation tests that replay fixture moves through the standard xiangqi
  rules engine.

Done means a contributor can run a local command and prove fixture records are
legal xiangqi.

### M1: Offline Import

- Add persistence for tour, round, board, board state, and sync logs.
- Import canonical coordinate JSON fixtures.
- Persist validated board states.
- Expose read APIs for tournament, round, and board replay.
- Export canonical JSON.

Done means Mistboard can publish completed tournament records.

Local import command:

```bash
npm run db:import:xiangqi-broadcast -- \
  --dir packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample
```

Add `--include-game-files` to also ingest `games/*.json`, including the
intentionally illegal fixture used to exercise sync-log failures.

Read APIs:

- `GET /api/xiangqi/broadcasts/:tourSlug`
- `GET /api/xiangqi/broadcasts/:tourSlug/rounds/:roundId`
- `GET /api/xiangqi/broadcasts/boards/:boardId`
- `GET /api/xiangqi/broadcasts/boards/:boardId/export`

### M2: Local Live Simulation

- Add event tape runner.
- Add fake source HTTP server.
- Add local source poller that writes source snapshots into persisted broadcast
  state.
- Add tests for duplicate payloads, legal extensions, corrections, and illegal
  move rejection, malformed sources, HTTP failures, and timeouts.

Done means live broadcast behavior is reproducible without a real tournament.

Local tape runner:

```bash
npm run db:simulate:xiangqi-broadcast -- \
  --dir packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample \
  --speed instant
```

Fake source server:

```bash
npm run source:xiangqi-broadcast -- \
  --dir packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample \
  --mode clean \
  --port 3127
```

Source modes:

- `clean`: current board snapshots at wall-clock or `?atMs=...`.
- `stale`: snapshots lag the requested time by five simulated seconds.
- `malformed`: HTTP 200 with an invalid body shape.
- `error`: HTTP 500 fixture-source failure.
- `timeout`: delays non-health responses long enough to exercise poller
  timeouts.

The committed `tape.json` is deterministic and can be run instant, realtime,
or accelerated by numeric `--speed`.

Source poller:

```bash
npm run db:poll:xiangqi-broadcast -- \
  --source http://localhost:3127/source.json \
  --once \
  --timeout-ms 1000
```

Drop `--once` to keep polling. Add `--dry-run` (with `--once`) to preview what
a poll would change: the poller runs the exact import/update path inside an
always-rollback transaction and reports per-board statuses without writing
board rows or sync logs. The poller imports tour/round metadata from the
source snapshot, applies each board through the same persisted board-update
boundary as the tape runner, and records HTTP, malformed, fetch, timeout, and
source-policy failures in sync logs. Continuous polling uses bounded failure
backoff: `--interval-ms` sets the healthy cadence, `--max-interval-ms` caps
failure delay growth, and `--backoff-multiplier` controls how quickly
consecutive failures slow the loop.

Multi-page manifest fixture (serves `/manifest.json` plus `/pages/...`):

```bash
npm run source:xiangqi-broadcast -- \
  --manifest-dir apps/server/fixtures/wxf-dhtmlxq/2019-wxc-men-manifest \
  --port 3128
npm run db:poll:xiangqi-broadcast -- \
  --source http://localhost:3128/manifest.json \
  --once --dry-run
```

### M3: Public Viewer

- Tournament page: event identity, schedule, active rounds, featured games.
- Round page: multi-board grid optimized for scanning.
- Board page: large board, player headers, move list, result/status, replay
  controls.
- Theater mode for a single featured board.
- Mobile layout with a usable board and non-overlapping controls.

Done means a simulated round is enjoyable to watch.

### M4: Live Updates

- Add broadcast websocket or SSE channel.
- Push board-state diffs to round and board viewers.
- Handle corrections without page reload.
- Keep reconnect deterministic by loading persisted board state first.

Done means local event tapes animate the public viewer in real time.

### M5: Organizer Console

- Create/edit tour, rounds, and boards.
- Attach source URLs or push credentials.
- Show sync health and per-board errors.
- Allow authorized correction/replacement of a board source.

Done means a non-developer can run a small event.

### M6: Source Adapters

- Add DhtmlXQ adapter using the existing conversion knowledge from
  `import-famous-xiangqi.ts`.
- Add WXF/public-page importer only after selecting one real event page shape.
- Keep adapter failures isolated to sync logs.

Done means Mistboard can import at least one real public tournament source
end-to-end.

## Test Matrix

Unit tests:

- canonical payload validation;
- DhtmlXQ coordinate conversion;
- legal move replay;
- illegal move diagnostics;
- result and player tag normalization;
- board matching and ambiguity detection;
- idempotent duplicate payload handling;
- explicit correction handling.

Integration tests:

- create tour, round, boards;
- import completed fixture;
- push incremental update;
- reject illegal ply while preserving prior public state;
- write sync log;
- export canonical JSON;
- reconnect/read current board state from persistence.

Browser tests:

- tournament page loads;
- round grid displays 16 and 32 boards without layout breakage;
- board page appends moves live;
- correction updates move list and board position cleanly;
- theater mode works on desktop and mobile;
- no UI overlap at narrow widths.

Load smoke:

- 32 boards;
- one update every 1-5 seconds per active board;
- 100 lightweight spectator connections;
- no unbounded event backlog, runaway memory, or visible UI churn.

## Issue-Ready Slices

1. Define xiangqi broadcast canonical payload types and fixtures.
2. Add fixture validation and legal-move replay tests.
3. Add broadcast persistence schema.
4. Add offline coordinate JSON importer.
5. Add public broadcast read APIs.
6. Add canonical JSON export.
7. Add event tape runner.
8. Add fake broadcast source server.
9. Add local source poller.
10. Add authenticated local push endpoint.
11. Build tournament and round viewer pages.
12. Build board/theater viewer page on the standard xiangqi renderer.
13. Add live update channel for broadcast boards.
14. Add organizer sync log view.
15. Add DhtmlXQ adapter.
16. Add first WXF event adapter/proof import.

## Recommended Defaults

- Gate broadcasts separately from standard xiangqi live rooms. Broadcasts can
  launch as public study/viewer content without opening player-created xiangqi
  rooms.
- Keep broadcast persistence separate from finished-game persistence, but expose
  a replay-compatible API shape so the xiangqi watch renderer can be reused.
- Start fixtures with a tiny hand-curated coordinate pack, then add DhtmlXQ
  because existing local conversion code already knows that source shape, then
  prove WXF on one selected event page.
- Defer comments and annotations until the import, live simulation, sync log,
  and viewer loops are stable.
