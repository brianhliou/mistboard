# What holds and what does not

Expected scores below use each engine’s native conversion. “pp” means percentage points. Banqi’s Red seat is Brian, whose pieces are Black; seat and ink are kept separate.

**Incomplete, paused for shared-Mac capacity.** Only the new Jieqi game’s 1M shard and Misty’s 4-second Fog sweep are complete. Banqi’s 1M position sweep is complete, but some restricted move searches are pending. All current claim verdicts are provisional. No higher-budget survival counts are available yet.

- **changes — Banqi: e1 was the engine’s own flip; all 21 points were the draw.** Ply 15: 51.3% → expected 48.0% → realized 36.2%; choice 3.3 pp, draw loss 11.8 pp; best @e3.
- **unresolved — Banqi: Brian’s 19 flips gave away 52 points by choice.** 19 flips (11 scored): 41.7 pp signed choice loss, 41.7 pp when negative costs are clipped; 20.4 pp signed draw loss. The supplied 10-14 JSON reproduces 52.12 pp by summing signed costs (56.25 pp clipped).
- **unresolved — Jieqi: f6-f3 52% → 24%, f2 preferred.** Required sweep is incomplete.
- **unresolved — Jieqi: g1 elephant reveal helped Red by 7 points.** Required sweep is incomplete.
- **unresolved — Duck: 79% before Black move 18.** Required sweep is incomplete.
- **unresolved — Duck: 13 shuffles; Red 51% → 70%.** Required sweep is incomplete.
- **unresolved — Fog: d2-d9 58% → 9%.** Required sweep is incomplete.
- **unresolved — Fog: Black’s second move 55% → 23%.** Required sweep is incomplete.

The article and study script were not edited. The JSON retains native scores, raw exact UCI lines, budgets, preferred moves, pre-reveal costs, luck, and the site’s separate historical win-curve conversion. A curve-only difference is not evidence of a changed move assessment.

## Per-game turning points

Selection: the three largest positive costs for each side, plus every strict crossing of 50%. A tie is resolved by earlier ply. These are engine estimates; small negative costs expose independent-search noise rather than being erased. Duck uses two-ply net changes between the same side to move and therefore includes the opponent’s reply.

### fog — `dxq_cfa3ee3a-a688-4338-a626-e6c923b65bbb`

Incomplete; no full series available.

### banqi — `bq_6f89b56d-39d1-42ba-a39c-a413babc4807`

0.3.0@45f0fdea; 1,000,000 requested nodes per search. Brian: first mover, Black ink.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 5 | red | @g1 | 51.2% → 45.1% | 6.1 pp | @g3 |
| 10 | black | @d1 | 51.6% → 49.5% | 2.1 pp | @b1 |
| 11 | red | @b1 | 53.4% → 49.4% | 4.0 pp | @e3 |
| 13 | red | @c2 | 55.5% → 50.9% | 4.5 pp | @e3 |
| 14 | black | @c4 | 50.7% → 49.8% | 1.0 pp | c2e2 |
| 15 | red | @e1 | 51.3% → 48.0% | 3.3 pp | @e3 |
| 18 | black | @e4 | 66.3% → 64.6% | 1.7 pp | c2e2 |
| 22 | black | g1h1 | 71.4% → 65.1% | 6.2 pp | e4f4 |
| 23 | red | @h2 | 34.9% → 17.8% | 17.0 pp | f1f3 |

10-14 comparison (all probabilities are mover POV; “old expected” removes the reveal draw):

| Ply | Move | 10-14 before → expected | New before → expected | New best |
|---:|---|---|---|---|
| 15 | @e1 | 45.9% → 47.8% | 51.3% → 48.0% | @e3 |

### jieqi — `jq_8f4e0d9c-01be-4480-a84e-3b469fedd28f`

Incomplete; no full series available.

### duck — `dkx_b076e2a8-60ee-4443-99aa-b69a7b584ec1`

1b5bdd40+duck-patch-f563b5aa/0.3.1; 50,000,000 requested nodes per search. Brian: Black.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|

### jieqi-new — `jq_a9840ec7-12a0-4f81-8b00-42d07934038e`

AB-JChess-20261031@efc83867; 20,000,000 requested nodes per search. Brian: Red.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|

## Does more search preserve the read?

A turning point “survives” only if it is selected again after re-ranking the entire eligible higher-budget sweep. “Same choice” compares the root’s exact preferred move on the original turning points, independently of survival.

| Game / side | Base → higher | Survive | Same choice | Scored |
|---|---|---:|---:|---:|
| Pending | — | — | — | — |

## Known limits

- Native expected score is a model output, not an empirically guaranteed human win rate: Banqi `0.5 + cp/2000` (NNUE utility); AB-JChess `sigmoid(cp/430)` (its chance-node conversion); Pikafish and Duck `(W + D/2)/1000` from their own UCI WDL. Mate/terminal outcomes are exact. The JSON also retains the site’s historical logistic curves (AB October K=0.00269, others K=0.00368208, cp clamped at ±1000) for comparison.
- Public Jieqi exports do not identify pieces captured while covered or still covered at the end. Replay completes those identities from the unused bag, but only `public:true` pools reach AB-JChess, so this completion conveys no extra information. Reveal actions are restricted searches from the pre-reveal position. They use the engine’s chance-node approximation, not the actual dealt piece.
- Banqi searches use the NNUE’s depth ceiling of 64 and report achieved depth and nodes, rather than pretending that a node budget is depth 12. Every flip is searched against the still-covered bag; all supplied reveals are checked by the rules kernel. Quiet repetition history is replayed. The no-progress limit is explicitly 40.
- Pikafish is an orthodox, full-information Xiangqi evaluator, while Fog permits leaving the general exposed. Its scores cannot establish what the player knew, and orthodox terminal assessments can differ from Fog’s capture-the-general rules. Misty receives only the site’s mover-view transcripts, including color-only shrouded blockers, and uses the site’s v1.2 profile and general/material guards.
- Misty’s cost is search regret: maximum raw action utility minus the played action’s utility. Its committed move also passes safety guards, which can deliberately prefer a lower raw-utility move (ply 38 does this). The JSON retains the search-best move, committed move, guard changes, and policy expected score; a positive search regret is not necessarily a disagreement with the guarded bot’s actual choice.
- Duck has no new stronger evaluator here: more nodes test the same patched classical engine. Adjacent opposite-side scores are not compared. Paired net loss includes the opponent’s intervening move, and the last move without a matching same-side endpoint is explicitly unscored. A repeated-loop aggregate does not prove that any one shuffle was the causal mistake.
- Full and restricted root searches have independent cold hashes. A forced move can score better than the unrestricted root because all search is concentrated on it; signed costs preserve this disagreement. Zero cost for the exact preferred move reuses its root score. Search stability is evidence at the tested budgets, not proof of the objective value.
- The October AB-JChess source tag fails a direct ARM compile at unguarded x86 bit-scan intrinsics. We used the existing local October ARM binary, verified its net md5 and published 43,125-node bench, and recorded its SHA-256. Duck was rebuilt locally from the production pin plus the committed patch with NNUE embedding disabled and classical evaluation selected; its opening perft is 2,554.

## Reproduce and resume

The TypeScript companion uses the site kernels and redaction builder; Python owns process control, exact-score parsing, native conversions, flushed caching, and reports. This split avoids reimplementing game rules in the analysis driver. All inputs exclude the live `xmj_` export. Only local processes are used.

```sh
node --import tsx scripts/variant-lab/rebirthfox-reanalyse.ts > /private/tmp/rebirthfox-reanalysis/positions.json
python3 scripts/variant-lab/rebirthfox-reanalyse.py --game jieqi-new --nodes 1000000
python3 scripts/variant-lab/rebirthfox-reanalyse.py --suite --resume-output --workers 4
PYTHONDONTWRITEBYTECODE=1 /Users/brianliou/projects/mistboard-engine/.venv/bin/python scripts/variant-lab/rebirthfox-reanalyse-fog.py
PYTHONDONTWRITEBYTECODE=1 /Users/brianliou/projects/mistboard-engine/.venv/bin/python scripts/variant-lab/rebirthfox-reanalyse-fog.py --seconds 20 --out /private/tmp/rebirthfox-reanalysis/fog-misty-20s.jsonl
python3 scripts/variant-lab/rebirthfox-reanalyse-report.py
python3 scripts/variant-lab/rebirthfox-reanalyse.test.py
```

Set the explicit `SPECS` paths if the binaries move. The raw local cache is `/private/tmp/rebirthfox-reanalysis/searches.jsonl`; full deliverable numbers are in the committed JSON. A fresh run checks the shared-Mac guard once and stops if saturated; it never polls or automatically starts replacement work.

## Run status and handoff

Branch `agent/rebirthfox-deep-dive`, worktree `/Users/brianliou/projects/mistboard-wt-rebirthfox`. Article and study script unchanged; supplied export files remain untracked and are not included in this commit. The result JSON embeds the five public exports so this checkpoint preserves its inputs.

Calibration: the complete new-Jieqi 1M shard took 55.08 seconds (49 positions, 31 additional restricted searches). The Duck 5M probe took 31.42 seconds. Four one-thread UCI workers were sized for about 155 active minutes overall, including the 50M Duck sweep and 20-second Misty control.

The shared-Mac guard then reported saturation (load 20.95, 14 cores). During the concurrency change an accidental duplicate runner started; both UCI runners were interrupted, and their flushed caches were preserved. The already-running Misty base sweep was allowed to finish. No further heavy work was launched and the guard was not polled. The next action needs an operator capacity signal or an explicit override of the supplied AGENTS.md rule: “If saturated or unknown, pause new heavy work … Do not retry/poll, launch replacement work”.

Pending: fog/1000000, fog/20000000, fog/misty-20s, banqi/1000000, banqi/5000000, jieqi/50000, jieqi/1000000, jieqi/20000000, jieqi-new/20000000, duck/300000, duck/5000000, duck/50000000.

Verification: all 351 positions replay through site kernels, every supplied reveal matches, seven numerical/protocol tests pass, and the replay companion passes Biome. A direct TypeScript check reports no companion diagnostics but fails on existing transitive server errors; it is not claimed as a passing repository typecheck.

Checkpoint commit: the pre-commit hook refuses the supplied untracked export inputs. They were left intact and outside the commit; the documented `SKIP_PRECOMMIT=1` escape was used after targeted checks. The hook’s full-workspace typecheck was not launched while the resource guard was saturated.
