# Misty analysis score scales (#933)

Move grades and accuracy convert stored scores with `winPercent(cp, mate,
engineId)` in `packages/game/src/analysis.ts`. Pass the engine id returned with
the analysis; a UCI `score cp` field alone does not establish its units. Numeric
curve constants remain supported for callers that explicitly need a logistic
curve, including Jieqi's consistency check.

| Engine family | Model | Evidence and scope |
| --- | --- | --- |
| `misty-three-kingdoms-banqi` and `misty-three-kingdoms-banqi-*` | **Switched** to `50 + 50 * clamp(cp / 1000, -1, 1)` | Confirmed in issue #933: the engine emits `round(value * 1000)` and its net emits `2 * sigmoid(logit) - 1`. Applies to analysis, decision and level ids. Mate values and the finished-game ±30000 sentinel are decisive. |
| `misty-banqi-*` | Kept on its existing curve | `apps/server/src/banqi-analysis.ts` reads the Rust binary's UCI scores. The vendored `apps/web/public/engine/misty-banqi/banqi_wasm.d.ts` describes native centipawn scores, not a probability encoding. Engine implementation is outside this checkout; no expected-score-times-1000 contract was confirmed. |
| `misty-jungle-*` | Kept on its existing curve | `apps/server/src/jungle-analysis.ts` reads native Rust scores. `apps/web/public/engine/misty-jungle/README.md` documents native scores with `WIN = 1_000_000`; this is not evidence for an expected-score-times-1000 encoding. |
| `misty-jungle-flip-*` | Kept on its existing curve | `apps/server/src/jungle-flip-analysis.ts` reads the Rust binary's UCI scores. `apps/web/public/engine/misty-jungle-flip/jungle_flip_wasm.d.ts` describes native centipawn scores; no expected-score-times-1000 contract was confirmed in this checkout. |
| Fog/dark `misty-analysis@…+sf18` eval track | Kept on its existing chess curve | `apps/server/src/dark-chess-analysis.ts` documents the eval track as Stockfish-on-truth scores. Its engine id labels the whole document, including a separate Misty belief solve, rather than changing the eval track's units. |
| Fog/dark decision layer | Already linear; unchanged | `apps/server/src/dark-chess-decisions.ts` documents GT-CFR values in [-1, 1] and converts them directly to win% with `valueToWin`. These are raw expected values, not scores transported through `cp`. |

The audit used the supplied issue and files in this checkout. It did not inspect
engine repositories or fetch remote sources. The generic `formatMistyEval`
display comment is not sufficient evidence to switch every Misty engine.

Both score-to-win% conversions in `review/game-analysis.ts` use the engine id,
including the accuracy recomputation when decision overlays are merged. Banqi,
Flip Jungle and Jieqi decision computations also pass the producing engine's id
to the same conversion before averaging pool outcomes. Their current models
remain unchanged because none is confirmed to use Three Kingdoms' score scale.
The overlay clients consume win% directly, so they require no second conversion.

Pikafish, Fairy-Stockfish, both AB-JChess curves and Rapfi retain their existing
logistic conversions. No analysis cache keys, eval-bar display curves, engine
assets or game payloads change. Stored basic analysis scores are converted on
read; existing decision blobs remain valid for the unchanged engine families.

Regression coverage lives in `packages/game/src/analysis.test.ts` (conversion
table, decisive scores, curve compatibility and judgment thresholds) and
`apps/web/src/review/game-analysis.test.ts` (normal moves, Black-first POV,
best-played regrading, decision overlay merging and aggregate accuracy).


## Fanfanqi calibration, 2026-11-13 (#1092)

Decided 2026-11-13: FFQ reviews use a fitted logistic curve, with
`K = 0.00518009` (unrounded fit: `0.005180085216522089`). The analysis and
decisions ids carry `winfit20261113`; the analysis cache id advances from
`masked1` to `masked2-winfit20261113`. Historical ids retain their old curve.

The fit uses **300 completed level-7 self-play games, 2,004 public evaluations**
from MistyFFQ 0.1.0 at 25,000 nodes and a 3,000 ms move cap. The existing FFQ
`VariantEveAdapter` drives the games. Deals use seeds 1092000 through 1092299.
Only public side-to-move scores enter the sample, normalized to Red's POV.
Samples are taken at plies 8, 16, ... 120, excluding mate scores and scores
outside [-1000, 1000], the range consumed by `winPercent`.

The fit minimizes zero-intercept logistic cross-entropy with wins = 1,
draws = 0.5 and losses = 0. Each sampled game has equal total weight, so a
long game contributes no more than a short one. Bisection finds the zero of
the derivative over K in [0, 0.1]. This estimates expected score against the
same level-7 engine, including half credit for draws; it is not a trained net
or a claim about play against humans. At +360 evaluation units the fitted
curve reads about 86.6%, compared with about 79% on the previous curve.

[The committed sample and fit](ffq-win-calibration-2026-11-13.json) contain
per-game seeds, outcomes, lengths and public score samples. Reproduce with:

```sh
MISTBOARD_FFQ_BANQI_ENGINE_PATH=/path/to/ffq-banqi-engine \
  node --import tsx scripts/ffq-win-calibration.mjs 300
```

The script resumes an existing sample file; remove or move that file to run
fresh games. No stored deal or covered-square identity enters the data file.
