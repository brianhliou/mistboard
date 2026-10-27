# Weekly Misty loss report

`npm run engine:loss-report -- --out /private/path/misty-losses.md` reads the last
seven days of completed Fog Chess PvE losses to people, grades Misty's moves with
Stockfish, and writes one worst move per game, worst drop first. It makes no LLM
calls, files no issues, changes no database rows and exposes no HTTP endpoint.
The output contains full truth FENs and belongs in a private operator file.

The existing dependencies and a Stockfish binary must be installed. Database
access comes from the runtime's `DATABASE_URL`; the command never loads env
files. Production reads use the existing `prod:db` wrapper from a current
checkout. This branch does not install a schedule or enable a job.

```sh
npm run engine:loss-report -- --out /private/path/misty-2026-10-26.md \
  --until 2026-10-26T00:00:00Z

npm run engine:loss-report -- --out /private/path/misty-2026-10-26.json \
  --until 2026-10-26T00:00:00Z --format json
```

The interval is `[since, until)`. `since` defaults to seven days before `until`;
`until` defaults to the current instant. A weekly local scheduler can call the
same command each Monday with an explicit UTC end time and a new output path.
Existing files are never overwritten. A failure exits nonzero without writing
a partial ranking. No losses produces a valid empty report without starting
Stockfish. Progress output contains counts only.

To verify the reference incident, use `--game ef172100` and explicit `--since`
and `--until` dates around that game's finish. The prefix only narrows the
counted-loss selection; it cannot bypass account exclusions or the time window.
The expected finding from issue #600 is ply 26 (13...Rd8), Bxc2 as the better
move, about 5.5 pawns lost, with the capture visible to Misty. This incident
requires the actual event log and decision artifacts; the synthetic test does
not claim to reproduce that production game.

## Scoring and coverage

Events replay through the canonical Fog kernel, rejecting foreign, corrupt,
unfinished and won-game logs. Database selection imports `countedHumanGame`
and `seatWonGame`; it includes human account and guest opponents, current and
legacy Misty bot identities, and historical `python-v2` engine seats.

Default depth is 18 (`--depth 1..30` overrides it). One Stockfish process runs
sequentially with one thread, 64 MiB hash and MultiPV 1. Every search starts with
`ucinewgame` to clear its transposition table. Both scores come from the **same
pre-move root**: the unrestricted best move and a search restricted to the
played move, each at the requested depth. This avoids mixing White/Black POVs
or comparing positions searched to different horizons. Reproduce results with
the same Stockfish build, options and explicit time window. `--stockfish PATH`
overrides the usual Stockfish path resolver.

The drop is `(bestCp - playedCp) / 100` in Misty's POV, floored at zero. A played
best move has zero loss. Mate scores use +/-30000cp for sorting; the original
signed mate distances are also output, so these sentinel drops should not be
read as measured pawn values. Only positive drops enter the ranking. Ties use
game id then earliest ply. `gamesAnalyzed` and `skipped` show coverage even when
no scored drop qualifies.

Fog permits ignoring check and capturing a king; ordinary Stockfish does not.
Invalid standard-chess roots and played moves that are illegal under standard
chess are listed as `stockfish-incompatible`, rather than receiving a misleading
score or being sent to Stockfish. Engine failures, timeouts (120 seconds per
search), bounded-only scores, and incomplete non-mate searches fail the report.
This means a game's
ranked move is its worst **Stockfish-gradable** drop; inspect skipped moves too.

## Decision context

Ply in the report is one-based move ply. Live decision artifacts store the
number of plies **before** the move, so report ply 26 matches artifact ply 25.
Color and the stored played move must match; absent, duplicate and mismatched
records leave belief size, rank and guard attribution unknown.

`beliefSize` and `moveRanking` come from `engine_diagnostics`. Rank is the
one-based index of Stockfish's best move in Misty's stored candidate ordering;
an omitted move has unknown rank. Visibility is destination membership in the
reconstructed pre-move Misty view; legality separately uses that view's complete
legal move list. No fog solve is re-run.

`commitGuardChangedMove` is used only when explicitly present as a boolean in
the stored diagnostics. Older records may not carry it. A different top-ranked
move is reported separately as `rankingTopDiffersFromPlayed`: it cannot by
itself establish that a commit guard changed the move. Missing telemetry stays
unknown, never an invented zero or a false attribution.

## Verification

```sh
node --import tsx --test apps/server/src/misty-loss-report.test.ts
```

The planted fixture replays a complete Fog loss, catches g2-g4, verifies a
5.5-pawn supplied drop, and checks context-ply matching. An additional test runs
real Stockfish at depth 4 when a binary is available, catches that same blunder,
checks reproducibility and records the later Fog-only move as ungradable.
Query tests pin counted-loss selection without requiring Postgres. The
production `ef172100` acceptance check still requires database access.
