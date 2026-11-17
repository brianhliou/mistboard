# Reviewed puzzle quality holds

`scripts/puzzle-quality-hold.mjs` previews a small, separately reviewed batch of
mined xiangqi puzzles. It defaults to a read-only transaction. A plan contains
1–150 exact puzzle IDs and content hashes, the audit/snapshot identities, and
only reviewed forced starts or competing-mate solver turns. Numerical-only
filter failures are deliberately not supported by this first workflow.

Keep the selected plan and evidence outside Git. Calculate SHA-256 over the
plan's exact file bytes. Review that exact hash and the proposed selection
before approving any mutation. A tool flag is not authorization.

```sh
npm run prod:db -- --read-only node scripts/puzzle-quality-hold.mjs \
  --plan /absolute/path/plan.json --plan-sha256 PLAN_SHA256 \
  --out /absolute/path/new-preview.jsonl
```

After explicit approval of the concrete plan, use the same file/hash without
`--read-only` and add `--apply`. Choose a new receipt path on every invocation.
The tool reserves and fsyncs a receipt before connecting. Mutation locks the
selected rows, checks every payload hash/identity/variant/source, and changes
only `hidden_reason` on currently active records. Any missing or changed
content aborts the entire transaction. Other editorial holds are preserved.
The tool never changes puzzle content, IDs, attempts or ratings. Repeating
the same approved batch is idempotent.

For a conditional rollback, preview with the same plan/hash and
`--action restore`. It releases only the marker belonging to that exact plan;
a later unrelated editorial hold stays intact. Applying the rollback still
requires explicit authorization and `--apply`. Changed content aborts a
restore just as it aborts a hold.

A failed connection or receipt write after commit can leave the outcome
unconfirmed. Inspect a new read-only preview for that plan's exact marker;
do not assume the transaction failed or automatically retry a mutation.
Receipts and the immutable plan identify the batch even after interrupted
acknowledgment.

The existing puzzle-store cache refreshes within five minutes; no deployment
or restart is needed for a database-only hold. After an approved application,
verify the database receipt and then the refreshed serving pool. Keep the
original evidence, plan and receipts privately.

The local integration test uses temporary tables on the isolated worktree
test database; it never truncates the development or production database:

```sh
MISTBOARD_TEST_PUZZLE_HOLD_LOCAL=1 node --test scripts/puzzle-quality-hold.test.mjs
```
