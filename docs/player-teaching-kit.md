# Local player teaching kits

`npm run kit -- <slug>` prepares teaching material from a player's broadcast games. Default and `--dry-run` do the same work. Neither writes to the database. There are no API requests or remote engine fallbacks.

Use a seeded local database, built server/game packages (the existing annotator reads their `dist` files), and the local Pikafish checkout and binary matching `pikafish.ref`. The binary and adjacent NNUE net are read from `~/projects/tools/pikafish-<first eight pin characters>/src/`. The kit checks the checkout revision and binary identity and records both file hashes. It does not download or build an engine.

```sh
# DATABASE_URL defaults to the shared local development database on port 5435.
npm run kit -- fixture-player --dry-run
npm run kit -- fixture-player --max-games 1 --board <broadcast-board-id>
```

Only finished A-level games with complete move records qualify. Rankings put wins before draws before losses, with board ids breaking ties. The manifest states those reasons; they are a shortlist for editorial review. `--max-games` (default 3, up to 12) sets how many ranked games are prepared, and `--board` names specific eligible games instead. Preparation uses 400 plies per game, one engine at a time, the puzzle miner's own node budgets and a ten-minute timeout per annotation/mining subprocess. A budget preview is not a final selection or publication recommendation.

The command writes only under the ignored local directory `docs-private/players/kits/<slug>/`:

- `manifest.json`: player-page resolution, linked board count, translated-name coverage, missing data, rankings, preview flags, engine provenance, budgets, critical `moments` and artifact hash. Each moment records its `id`, `boardId`, `ply`, mover `side`, winning-chance points `lost`, verified `best` move, `played` move and best-versus-second `gap`.
- `study-draft.json`, `annotations.json`: the existing annotator's results and the existing player-study builder's unlisted study plan, with critical-moment gamebook chapters after the game chapters.
- `candidate-puzzles.json`: the existing xiangqi miner's validated candidates, each tagged `player:<slug>`. No candidate is a valid outcome when the game has no suitable position. Raw mining sidecars and metrics stay under `work/`.
- `selection.json`: initially empty `boardIds`, `puzzleIds` and `momentIds` arrays, for the editor to fill after review. A new dry run preserves this file. Moment ids are `<boardId>:<ply>` and appear in the manifest.

Missing players, name coverage, incomplete records, unavailable engines and failed preparation are reported instead of fabricated. A missing engine still produces a manifest and empty drafts. The kit never requests production analysis or uses a paid worker.

## Critical moments

Positions from either side qualify from ply 10 onward when the played move lost at least 10 winning-chance points, differed from the annotated engine best, and the mover's pre-move win chance was between 15% and 85% inclusive. The pinned local Pikafish verifies each candidate with MultiPV 2 at the kit's `verifyNodes` budget (600,000 nodes). Its best move must differ from the played move and beat the second-best by at least 8 winning-chance points, using the annotator's `winPercent` conversion in the mover's perspective. A missing second line does not pass. These thresholds and limits live in the exported `MOMENT_RULES` constant in `scripts/lib/player-kit-moments.mjs`.

Moments rank by lost winning chances descending, then board id and ply, with at most 2 per game and 10 overall. The manifest reports when fewer than 3 pass. Verification runs serially and stops once the caps are filled.

Each gamebook starts from the FEN before the mistake, facing the mover. The learner finds one move: the mainline contains the verified best move and its engine reply, or the available shorter line. The best move's comment names the engine continuation in WXF notation. The actual game move is a root sideline with the mover's English name (or Red/Black), round and approximate cost. The chapter keeps the game tags and adds the source ply. This material can be useful even when no position passes the puzzle miner's forced-winning-line requirements.

## Apply selected material locally

Fill `selection.json` with prepared board ids, candidate puzzle ids and/or moment ids, then run:

```sh
npm run kit -- fixture-player --apply
```

Apply requires a PostgreSQL URL whose host is exactly `localhost`, `127.0.0.1` or `::1`, with no query-string connection overrides. Discovery uses the same restriction. Remote targets are rejected before connecting. Do not point the command at a tunnel to a remote database.

Only selected chapters and puzzles are published. Selecting a game does not select its moments; a moment can be selected without its game. Apply uses the reviewed moment chapters without repeating engine analysis. Older selection files without `momentIds` select no moments. Study creation reuses the study editor's plan validation and persistence functions and requires the local `@mistboard` owner account. Puzzles are validated again, inserted as mined records in a transaction, and retain their player tags. Existing puzzle ids are rejected rather than overwritten. A failed apply removes its newly created study. An `applied.json` receipt makes a repeated successful apply with the same artifacts, selections and target return the original result.

The artifacts, including moment metadata and chapter trees, are bound by a hash: edit selections, not generated payloads. Kits generated before critical moments were supported need a fresh dry run before apply. For a new kit after a successful apply, archive the existing kit directory first. An interrupted apply before its receipt may leave local material; inspect the local study/puzzle stores before retrying. Nothing is published to production by this tool.

## Targeted verification

```sh
node --test scripts/player-kit.test.mjs
TEST_DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/mistboard_test \
  node --import tsx --test scripts/player-kit-local.test.ts
# Also exercise the real annotator/miner with the pinned local binary:
TEST_DATABASE_URL=postgres://mistboard:mistboard@localhost:5435/mistboard_test \
  MISTBOARD_KIT_ENGINE_SMOKE=1 node --import tsx --test scripts/player-kit-local.test.ts
```

The database check seeds fictional broadcast participants, verifies that dry run leaves both content stores unchanged, checks selected study/puzzle publication and tag persistence, then removes its fixture rows and temporary artifacts. It does not truncate shared tables.
