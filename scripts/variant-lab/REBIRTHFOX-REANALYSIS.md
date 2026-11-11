# What holds and what does not

Expected scores below use each engine’s native conversion. “pp” means percentage points. Banqi’s Red seat is Brian, whose pieces are Black; seat and ink are kept separate.

**Incomplete, paused for shared-Mac capacity.** Only the new Jieqi game’s 1M shard and Misty’s 4-second Fog sweep are complete. Banqi’s 1M position sweep is complete, but some restricted move searches are pending. All current claim verdicts are provisional. No higher-budget survival counts are available yet.

- **changes — Banqi: e1 was the engine’s own flip; all 21 points were the draw.** Ply 15: 51.3% → expected 48.0% → realized 36.2%; choice 3.3 pp, draw loss 11.8 pp; best @e3.
- **changes — Banqi: Brian’s 19 flips gave away 52 points by choice.** 19 flips (19 scored): 46.4 pp signed choice loss, 46.4 pp when negative costs are clipped; 24.5 pp signed draw loss. The supplied 10-14 JSON reproduces 52.12 pp by summing signed costs (56.25 pp clipped).
- **changes — Jieqi: f6-f3 took Black from 52% to 24%; the engine wanted f2.** Ply 44: 54.1% → 13.7%; best f6f2. Site-calibrated curve: 54.8% → 10.6%.
- **holds — Jieqi: the g1 elephant reveal helped Red by about 7 points.** Ply 47: expected 87.0%, realized 91.9%; reveal effect 4.9 pp.
- **changes — Duck: Black was 79% before move 18.** Before ply 36, Black 90.5%; site curve 65.7%. Budget 50,000,000.
- **changes — Duck: 13 general shuffles from moves 39–51; Red 51% → 70%.** Red 48.3% → 90.5% at Black-to-move indices 77 and 103; includes Red replies. Site curve 48.2% → 64.4%. The move count is unchanged.
- **changes — Fog: d2-d9 took Red 58% → 9%.** Ply 11: 70.3% → 0.0%; best b1a3. Site curve 58.1% → 8.3%.
- **changes — Fog: Black’s second move was ??, 55% → 23%.** Ply 4: 59.8% → 0.0%; best h6h1. Site curve 55.6% → 24.2%.

The article and study script were not edited. The JSON retains native scores, raw exact UCI lines, budgets, preferred moves, pre-reveal costs, luck, and the site’s separate historical win-curve conversion. A curve-only difference is not evidence of a changed move assessment.

## Per-game turning points

Selection: the three largest positive costs for each side, plus every strict crossing of 50%. A tie is resolved by earlier ply. These are engine estimates; small negative costs expose independent-search noise rather than being erased. Duck uses two-ply net changes between the same side to move and therefore includes the opponent’s reply.

### fog — `dxq_cfa3ee3a-a688-4338-a626-e6c923b65bbb`

6a59ee2f; 20,000,000 requested nodes per search. Brian: Black.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 1 | red | i1i2 | 52.2% → 31.9% | 20.3 pp | g4g5 |
| 2 | black | h8h6 | 68.0% → 43.6% | 24.4 pp | h8h1 |
| 3 | red | i2d2 | 56.4% → 40.2% | 16.2 pp | h1g3 |
| 4 | black | h6i6 | 59.8% → 0.0% | 59.8 pp | h6h1 |
| 5 | red | b3e3 | 100.0% → 58.6% | 41.3 pp | h3h6 |
| 6 | black | c10e8 | 41.4% → 0.0% | 41.4 pp | h10g8 |
| 11 | red | d2d9 | 70.3% → 0.0% | 70.3 pp | b1a3 |

### banqi — `bq_6f89b56d-39d1-42ba-a39c-a413babc4807`

0.3.0@45f0fdea; 5,000,000 requested nodes per search. Brian: first mover, Black ink.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 5 | red | @g1 | 51.2% → 46.0% | 5.2 pp | @g3 |
| 6 | black | @e2 | 51.0% → 48.6% | 2.4 pp | @a3 |
| 8 | black | @d3 | 53.0% → 50.3% | 2.7 pp | @b3 |
| 10 | black | @d1 | 51.6% → 48.2% | 3.4 pp | @b1 |
| 11 | red | @b1 | 53.4% → 49.3% | 4.1 pp | @e3 |
| 14 | black | @c4 | 50.7% → 49.1% | 1.6 pp | c2e2 |
| 15 | red | @e1 | 51.3% → 48.0% | 3.3 pp | @e3 |
| 22 | black | g1h1 | 71.4% → 65.1% | 6.2 pp | e4f4 |
| 23 | red | @h2 | 34.9% → 17.8% | 17.0 pp | f1f3 |
| 27 | red | f1f3 | 15.7% → 10.0% | 5.6 pp | d3d2 |

10-14 comparison (all probabilities are mover POV; “old expected” removes the reveal draw):

| Ply | Move | 10-14 before → expected | New before → expected | New best |
|---:|---|---|---|---|
| 15 | @e1 | 45.9% → 47.8% | 51.3% → 48.0% | @e3 |

### jieqi — `jq_8f4e0d9c-01be-4480-a84e-3b469fedd28f`

AB-JChess-20261031@efc83867; 20,000,000 requested nodes per search. Brian: Black.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 7 | red | b6c6 | 69.7% → 66.1% | 3.6 pp | i4i5 |
| 21 | red | f3d4 | 61.6% → 52.9% | 8.7 pp | d1e2 |
| 32 | black | d5e5 | 52.0% → 44.8% | 7.2 pp | d5d6 |
| 38 | black | f6f2 | 50.1% → 41.8% | 8.4 pp | f6h6 |
| 40 | black | f2f6 | 49.9% → 41.2% | 8.7 pp | f2f7 |
| 41 | red | h6i7 | 58.0% → 50.9% | 7.1 pp | a4a5 |
| 44 | black | f6f3 | 54.1% → 13.7% | 40.4 pp | f6f2 |

10-14 comparison (all probabilities are mover POV; “old expected” removes the reveal draw):

| Ply | Move | 10-14 before → expected | New before → expected | New best |
|---:|---|---|---|---|
| 44 | f6f3 | 51.7% → 24.4% | 54.1% → 13.7% | f6f2 |
| 47 | g1e3 | 82.7% → 84.5% | 87.0% → 87.0% | g1e3 |

### duck — `dkx_b076e2a8-60ee-4443-99aa-b69a7b584ec1`

1b5bdd40+duck-patch-f563b5aa/0.3.1; 50,000,000 requested nodes per search. Brian: Black.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 8 | black | b8b9@h5 | 55.5% → 45.5% | 9.9 pp | d10e9@g3 |
| 16 | black | b9e9@e5 | 48.7% → 64.6% | -15.9 pp | e6e3@d2 |
| 40 | black | c8d6@e5 | 98.0% → 64.5% | 33.4 pp | c8e9@d4 |
| 44 | black | c6c5@d4 | 58.8% → 43.0% | 15.8 pp | b2d2@e2 |
| 52 | black | c5d5@g7 | 49.4% → 51.8% | -2.4 pp | c5d5@e2 |
| 70 | black | c2c1@f8 | 51.2% → 48.0% | 3.2 pp | d2e2@f8 |
| 78 | black | d10e10@f8 | 51.7% → 47.3% | 4.4 pp | d2e2@e8 |
| 86 | black | d10e10@f8 | 46.4% → 54.8% | -8.4 pp | c1a1@f8 |
| 88 | black | e10d10@f8 | 54.8% → 44.5% | 10.3 pp | d2e2@e7 |
| 92 | black | e10d10@f8 | 49.4% → 32.0% | 17.3 pp | d2e2@f8 |
| 96 | black | e10d10@f8 | 45.6% → 11.9% | 33.8 pp | d2e2@f8 |

### jieqi-new — `jq_a9840ec7-12a0-4f81-8b00-42d07934038e`

AB-JChess-20261031@efc83867; 20,000,000 requested nodes per search. Brian: Red.

| Ply | Side | Played | Before → after | Cost | Engine’s choice |
|---:|---|---|---|---:|---|
| 7 | red | c5e6 | 41.2% → 27.8% | 13.4 pp | c5d3 |
| 10 | black | h8h4 | 74.5% → 69.3% | 5.2 pp | i7i6 |
| 20 | black | e8f6 | 73.7% → 66.4% | 7.3 pp | f10e9 |
| 21 | red | e2f3 | 33.4% → 24.8% | 8.6 pp | i4i5 |
| 27 | red | c6e6 | 37.8% → 28.2% | 9.6 pp | a4a5 |
| 36 | black | c5d3 | 87.3% → 80.1% | 7.2 pp | b10c8 |

## Does more search preserve the read?

A turning point “survives” only if it is selected again after re-ranking the entire eligible higher-budget sweep. “Same choice” compares the root’s exact preferred move on the original turning points, independently of survival.

| Game / side | Base → higher | Survive | Same choice | Scored |
|---|---|---:|---:|---:|
| jieqi / both | 50000 → 1000000 | 7 of 10 | 2 of 10 | 10 of 10 |
| jieqi / both | 50000 → 20000000 | 6 of 10 | 1 of 10 | 10 of 10 |
| jieqi / both | 1000000 → 20000000 | 4 of 7 | 5 of 7 | 7 of 7 |
| duck / black | 300000 → 5000000 | 1 of 9 | 1 of 9 | 9 of 9 |
| duck / black | 300000 → 50000000 | 4 of 9 | 1 of 9 | 9 of 9 |
| duck / black | 5000000 → 50000000 | 5 of 9 | 2 of 9 | 9 of 9 |

Fog information boundary: Pikafish and mover-view Misty share **4 of 9** Pikafish turning points. Misty selected 7; common plies: [1, 2, 3, 6]. Misty has 48/48 decisions.

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

Pending: fog/1000000, fog/20000000, fog/misty-20s.

Verification: all 351 positions replay through site kernels, every supplied reveal matches, seven numerical/protocol tests pass, and the replay companion passes Biome. A direct TypeScript check reports no companion diagnostics but fails on existing transitive server errors; it is not claimed as a passing repository typecheck.

Checkpoint commit: the pre-commit hook refuses the supplied untracked export inputs. They were left intact and outside the commit; the documented `SKIP_PRECOMMIT=1` escape was used after targeted checks. The hook’s full-workspace typecheck was not launched while the resource guard was saturated.

Recorded failures: {"fog": "RuntimeError: engine exited 1: ['info string CRITICAL ERROR: Command `position fen 3akab2/2Cn5/4b1n2/p3p1p1p/1P7/4C1P2/P3c3P/4KA3/3r5/1c7 w - - 0 20 moves e4c4 e3h3 c8a8 d9e8 c4a4 h3h2 f2e1 b0e0 a8a9` failed. Reason: Illegal move: a8a9', '']", "jieqi": "InterruptedError: audit stopped", "duck": "InterruptedError: audit stopped", "fog_not_legal_xiangqi": [{"fen": "3akab2/2Cn5/4b1n2/p3p1p1p/1P7/4C1P2/P3c3P/4KA3/3r5/1c7 w - - 0 20", "moves": ["e4c4", "e3h3", "c8a8", "d9e8", "c4a4", "h3h2", "f2e1", "b0e0", "a8a9"]}]}.
