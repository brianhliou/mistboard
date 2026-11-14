# Read-only corpus audit on Modal

`xiangqi_corpus_quality_audit.py` audits an exported served-corpus snapshot.
It has no database connection or secret attached. Four one-core workers are
bounded to 1 GiB each and a 7,400-second lifetime. They use Modal's
non-preemptible CPU setting (3x list CPU/memory pricing), after an actual
interruption exposed the operational cost of recovering a long shard. Results and ten-puzzle
checkpoints persist in the private `mistboard-puzzle-evidence-20261109` Volume.
Create that Volume once before the first run.

Use the pinned `pikafish-cc0-net.patch` in the repository root, or set the
non-secret `MISTBOARD_PUZZLE_CC0_PATCH` file-path override. The image builds the
pinned engine and checks the patch/network/source hashes and benchmark signature.
The launcher never attaches the older mining database secret.

```sh
npm run build --workspace @mistboard/game
npm run prod:db -- --read-only node scripts/puzzle-winning-audit.mjs --export /tmp/served-puzzles.json
modal run scripts/modal/xiangqi_corpus_quality_audit.py --snapshot /tmp/served-puzzles.json --out tmp/corpus-canary --canary
modal run scripts/modal/xiangqi_corpus_quality_audit.py --snapshot /tmp/served-puzzles.json --out tmp/corpus-full
node scripts/puzzle-corpus-quality-report.mjs --snapshot /tmp/served-puzzles.json --audit tmp/corpus-full
```

Review the eight known canaries before the full run. `--canary-ids` optionally
selects at most twelve explicit ids. Each solver turn gets cold 5M and 25M node
searches with 30/90-second ceilings. Borderline scores, incomplete comparisons,
stored-answer mismatches or changing decisions escalate to 100M/180 seconds;
100M never erases an earlier disagreement. The final comparison must reach depth 22.
A later board-verified mate/stalemate completes a mate task without weakening
initial admission. A prefix cannot replace a tactic before its later concrete payoff.
Missing evidence, under-depth searches and unstable decisions stay unresolved.
Immediate wins expand MultiPV beyond every kernel-proven immediate answer.
The audit stops at the first failing or unresolved stored solver move.

The worker reuses the exact archived CC0 engine image and checks its executable,
network, patch and every runtime source hash. Full runs use at most eight one-core
workers and shards of at most 25 puzzles, with private checkpoint files. Raw UCI
transcripts, target budgets and escalation reasons are retained per solver turn.
No engine search runs on the launching computer.

Keep the launching client alive: a detached local entrypoint does not make its
parallel result consumers independently durable. If interrupted, inspect both
local files and the Volume checkpoints before recovery. The launcher refuses
to overwrite an existing manifest or checkpoint; it does not implement automatic
resume. The report applies the separate root-choice source guard to recorded kernel
legal-move counts, retaining each original engine decision alongside any override.
It requires every manifest member and completion receipt and
rejects mixed engines, source versions or stale puzzle content.

`review.html` and `report.json` contain proposed decisions only. No command in
this workflow changes serving state, ratings, attempts or puzzle content.
Keep snapshots and raw evidence out of the public repository. Estimate mining
yield separately; early-exit audit timing does not predict full-game mining cost.

# Durable ElephantChess mining on Modal

This older launcher is held. Its legacy verification-node/depth settings do
not satisfy the shared 5M/25M/selective-100M verification contract, even when
its engine artifacts use the correct network. The miner rejects those custom
settings, and publication rejects old admission profiles and approvals. Do
not run the write-capable sequence below until the initializer, workers and
frozen run metadata have been migrated to the shared verification profile
and reviewed. Artifact verification alone does not clear that hold.

Modal supplies scale-to-zero CPU workers. Railway Postgres remains the source
of truth for the frozen manifest, shard leases, checkpoints, candidates, and
judgments. No Modal Volume is required.

## One-time setup

1. Install and authenticate the Modal CLI.
2. Create a Modal Secret named `mistboard-mining-production-db` with one key,
   `DATABASE_URL`. Use a least-privilege, TLS-enabled Railway public Postgres
   connection. Do not use Railway's private hostname from Modal.
3. Nothing to download for the engine. The image builds the server's Pikafish
   the way `scripts/engine-assets.sh` does: upstream at the `pikafish.ref` pin
   plus `pikafish-cc0-net.patch`, for Linux sse41, and fetches the
   Fairy-Stockfish CC0 net (`xiangqi-c07e94a5c7cb.nnue`).
4. Set `MISTBOARD_MODAL_MANIFEST_PATH` to the private frozen manifest. The
   manifest is sent as a function input and is not committed into the image.

Before Modal builds an image, the launcher checks that `pikafish.ref` matches its
UCI id and that its net name, URL and sha256 match `engine-assets.sh`. The image
build verifies the net's sha256, fails unless `bench 16 1 13 default depth`
searches 1,650,882 nodes, and records the binary's sha256. The remote
initializer pins the run to that binary and the net, and repeats the UCI
identity check. A rebuilt image is a new binary hash, so rerun `verify` after
any change to the pin or the patch.

## Safe launch sequence

Run an artifact-only smoke first. It does not attach the database secret or
write production state:

```sh
modal run scripts/modal/elephantchess_pilot.py::verify
```

After migration 110 is deployed, explicitly initialize the Linux execution:

```sh
modal run scripts/modal/elephantchess_pilot.py::initialize
```

Copy the returned `runId`, inspect it, and run one 25-game canary:

```sh
modal run scripts/modal/elephantchess_pilot.py::status --run-id RUN_ID
modal run scripts/modal/elephantchess_pilot.py::scan --run-id RUN_ID --tasks 1
modal run scripts/modal/elephantchess_pilot.py::status --run-id RUN_ID
```

If the canary is healthy, submit the remaining shard inputs. The function caps
execution at four one-core containers, regardless of the number of inputs:

```sh
modal run scripts/modal/elephantchess_pilot.py::scan --run-id RUN_ID --tasks 40
```

Extra inputs safely return without work. After scanning reaches `verifying`, use
the status output's verified-candidate count to size the independent audit map:

```sh
modal run scripts/modal/elephantchess_pilot.py::audit --run-id RUN_ID --tasks CANDIDATE_COUNT
```

To stop, cancel the running Modal App. Database leases expire after 30 minutes;
rerunning the same command then reclaims interrupted shards or candidates from
their last durable checkpoint. Never delete the run to recover work.
