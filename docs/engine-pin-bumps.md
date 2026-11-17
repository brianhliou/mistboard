# Engine pin bumps and bot ratings

Published bot ratings describe one reviewed engine ladder, including the build
and net it measured. A pin bump makes the previous measurement stale; the daily
readout can replace it once enough calibration games have accumulated.

1. Update the engine pin and any net checksum together. For engines packaged by
   `scripts/engine-assets.sh`, wait for the **Build engines** workflow to publish
   the exact `engines-<hash>` printed by `sh scripts/engine-assets.sh tag`.
2. Deploy the new revision through the normal release process. Ensure the prod
   engine queue's workers also run that revision before measuring; deploying the
   web service alone does not update a separately deployed worker.
3. Queue a rated ladder for **each variant served by the changed pin**, using
   the prod engine queue and that variant's registered random anchor and bot
   tiers. For example, on the deployed server with its existing database setup:

   ```sh
   npm run engine:enqueue-tournament -- --variant xiangqi \
     --engines random-legal-xiangqi,pikafish-xiangqi-level-8 \
     --rating-anchor random-legal-xiangqi --providers railway \
     --rated --games-per-pair 8 --max-plies 400
   ```

   Include every affected rung, not just the example's top bot. A shared build
   can serve several variants. Record the returned job ID and deployed revision.
   Keep workers on those pins until the ladder finishes; discard a run that
   straddled a build or net change.
4. Review the completed ladder's results, game counts, truncations and confidence
   intervals with `engine:elo-report -- --job <job-id>`. Use the appropriate
   `--anchor` and, when needed, `--model mle`. **A human reviews the numbers
   before publication of a manual ladder.** The manual ladder stays the fast
   path immediately after a pin bump; automatic calibration takes weeks.
5. From the same revision that ran the ladder, import draft snapshots:

   ```sh
   npm run engine:bot-rating-import -- --job <job-id> \
     --anchor random-legal-xiangqi --time-class blitz
   npm run engine:bot-rating-snapshots -- --drafts
   ```

   The import writes the recipe tag and each measured engine's pinned net
   SHA-256 to `sourceRef`; classical engines explicitly record no external net.
   The stamp describes the importing checkout's pins. Never import an older
   ladder from a newer checkout, or combine reports from different deployments.
   Re-run historical ladders on the current pins before importing. Old unstamped
   snapshots remain stale until a matching replacement is published manually or
   automatically.
6. After review, promote selected snapshot IDs with
   `engine:bot-rating-promote -- --snapshot-id <id>` (or the exact shared
   `--source-ref` printed by the import). Check the next readout: its Operations
   section lists all stale published ratings, and its action list alerts when a
   bot first needs a re-rate, including a subsequent pin bump while still stale.

Drafts do not clear stale published ratings. PvE “Games here” and “Record here”
remain independent of these ladder snapshots.


## Automatic refresh between pin bumps

The daily readout (including Monday's weekly replacement) fits scheduled,
`rating_policy.rated` calibration games against the plan's own random-floor
anchor, using the existing anchor-relative Elo report and import path (anchor
rating 1500). Content-lane games, manual tournaments, truncated/unfinished games,
and games without a matching worker stamp never contribute. Each worker records
its local engine-assets recipe tag and hashes the net files resolved by its move
providers for both seats, including explicit no-net stamps for classical engines.
These stamps live in `game_debug_artifacts` metadata; they contain no board,
pieces, hidden deal, seed or filesystem path and do not change player payloads.
Older, unstamped games never count toward this refresh.

A fit publishes an `eve-anchor` snapshot only with a 95% Wilson interval
half-width at most 50 Elo and either a stale latest snapshot or an estimate that
moves more than its own interval half-width after at least seven days. Clockless
fits retain the existing snapshot's time class. A first rating still requires a
manual import; automatic refresh needs an existing published baseline.
`sourceRef` records `lane=calibration`, the anchor, anchor rating, recipe and net
checksums, so the existing bot page shows “Elo from N engine games · Mon YYYY”.
A move greater than 200 Elo, on the same build or after a pin bump, holds the
old snapshot and raises an edge-triggered readout action for human review. A
retry cannot publish twice: the refresh and readout commit in the same locked
transaction. A refresh failure rolls back to a savepoint and the readout still
commits. Manual readouts never refresh, and dry runs never write snapshots.
Stamping a game is best-effort: a game whose recipe or net cannot be read on the
worker plays unstamped and never counts toward a refresh.

At about two calibration games a day, reaching the interval bar takes weeks
(and longer when divided across ladder rungs). Run and review the manual ladder
right after a pin bump; the automatic refresh keeps ratings current between
bumps. Draft snapshots alone still do not clear a stale published measurement.
