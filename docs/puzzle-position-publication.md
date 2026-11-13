# Position-only puzzle publication

This path appends reviewed xiangqi positions without importing their recorded
source games. The stored puzzle contains a fresh board state, solution,
explicit objective, themes, and event/player/archive credit. The source game
and preceding moves are rejected at the publication and serving boundaries.

1. Export position-only review records to a JSON file with a `packets` array.
2. Build a packet using the pinned native engine and network. Both verification
   and audit run against the final sanitized puzzle. Supply a review note only
   for examples whose puzzle value has actually been reviewed.

   ```sh
   npm run puzzles:build-position-packet -- --input /private/path/review.json \
     --out /private/path/packet.json --binary /path/to/pikafish \
     --net /path/to/xiangqi.nnue --review-note 'Reviewed examples'
   ```

3. With the target app's puzzle seed already synchronized, inspect the dry run.
   The command requires a configured database connection and makes no writes.

   ```sh
   npm run puzzles:publish-positions -- --packet /private/path/packet.json --expect-total 2
   ```

4. An authorized publication uses the exact packet hash from that dry run:

   ```sh
   npm run puzzles:publish-positions -- --packet /private/path/packet.json \
     --expect-total 2 --expect-sha256 EXPECTED_SHA256 --apply \
     --operator-note 'Approved publication'
   ```

The publisher rechecks every puzzle and receipt, checks the full stored corpus
(including hidden puzzles) for repeated positions, and serializes against seed
sync and legacy publication. Puzzle and immutable receipt insertions commit
together. Reapplying the identical packet is a no-op; changed published content
or evidence fails closed. Database constraints and an immutable position-only
marker prevent legacy importers from replacing a verified exercise or adding
recorded history later. No source-game row is created.

Version 1 uses three-to-seven-ply solutions and the pinned CC0 scoring and
verification profiles. Mate objectives require complete within-N uniqueness
receipts, with the existing immediate-board-mate completion rule. Advantage
objectives recheck ranked legal PVs, search budgets, depth, stability and the
shared winning-chance separation rule. Unresolved evidence cannot publish.

Keep raw source records, private collector code and engine clearance discussions
outside this repository. The production receipt retains only derived evidence
bound to the published puzzle; it is not a source-game archive.
