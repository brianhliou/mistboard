"""SPRT self-play of the live bot time rules on Modal (MISTBOARD_BOT_TIME_RULE).

The same bot (Pikafish xiangqi L8, prod's release binary and net) with rule A
against itself with rule B on a real 1+1 clock, one pair of games per container
(seeded random two-ply opening, colours swapped). Pair scores feed a pentanomial
GSPRT (elo0=0, elo1=15, alpha=beta=0.05 by default); the run stops when the LLR
crosses a bound or `pairs_max` pairs are in.

The match itself is apps/server/src/time-rule-match.ts, bundled first:

  W=<worktree>; $W/node_modules/.bin/esbuild $W/apps/server/src/time-rule-match.ts \\
    --bundle --platform=node --format=esm --target=node20 --outfile=<bundle.mjs> \\
    --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
  TIME_MATCH_BUNDLE=<bundle.mjs> modal run scripts/bot-time-match-modal.py \\
    --a phase --b flat --pairs-max 3000 --out <rows.jsonl>

Rows append to `--out` as they land (resumable: seeds already there are
skipped); progress and the verdict print to stdout.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path

import modal

ENGINES_TAG = os.environ.get("ENGINES_TAG", "engines-c2f203e4af17")
ENGINES_ASSET = "engines-x86-64-sse41-popcnt.tar.gz"
BUNDLE = os.environ.get("TIME_MATCH_BUNDLE", "")
BASE = f"https://github.com/brianhliou/mistboard/releases/download/{ENGINES_TAG}"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs",
        f"mkdir -p /opt/engines /tmp/dl && cd /tmp/dl"
        f" && curl -fsSL --retry 3 -o {ENGINES_ASSET} {BASE}/{ENGINES_ASSET}"
        f" && curl -fsSL --retry 3 -o SHA256SUMS {BASE}/SHA256SUMS"
        f" && sha256sum -c --ignore-missing SHA256SUMS"
        f" && tar -xzf {ENGINES_ASSET} -C /opt/engines pikafish pikafish.nnue"
        " && chmod +x /opt/engines/pikafish && rm -rf /tmp/dl",
    )
)
if BUNDLE:
    image = image.add_local_file(BUNDLE, "/opt/time-rule-match.mjs", copy=True)

app = modal.App("bot-time-rule-match", image=image)


@app.function(cpu=1.0, memory=1024, max_containers=60, timeout=40 * 60, retries=1)
def play(spec: dict) -> dict:
    cmd = [
        "node", "/opt/time-rule-match.mjs",
        "--a", spec["a"], "--b", spec["b"], "--seed", str(spec["seed"]), "--pairs", "1",
        "--tc", spec["tc"], "--overhead-ms", str(spec["overhead_ms"]),
        "--bin", "/opt/engines/pikafish", "--net", "/opt/engines/pikafish.nnue",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=40 * 60 - 60)
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    if proc.returncode != 0 or not lines:
        return {"pairSeed": str(spec["seed"]), "error": (proc.stderr or proc.stdout)[-2000:]}
    return json.loads(lines[-1])


def expected(elo: float) -> float:
    return 1 / (1 + 10 ** (-elo / 400))


def llr(scores: list[float], elo0: float, elo1: float) -> float:
    """Pentanomial GSPRT, the same formula as pentanomialLlr in time-rule-match.ts."""
    n = len(scores)
    if n < 2:
        return 0.0
    mean = sum(scores) / n
    var = sum((s - mean) ** 2 for s in scores) / n
    if var <= 0:
        return 0.0
    s0, s1 = expected(elo0), expected(elo1)
    return (s1 - s0) * (2 * mean - s0 - s1) * n / (2 * var)


def elo(scores: list[float]) -> tuple[float, float, float]:
    n = len(scores)
    mean = sum(scores) / n
    sd = math.sqrt(sum((s - mean) ** 2 for s in scores) / n / n) if n > 1 else 0.0

    def to_elo(s: float) -> float:
        s = min(0.999, max(0.001, s))
        return -400 * math.log10(1 / s - 1)

    return to_elo(mean), to_elo(mean - 1.96 * sd), to_elo(mean + 1.96 * sd)


@app.local_entrypoint()
def main(
    a: str = "phase",
    b: str = "flat",
    pairs_max: int = 3000,
    seed_base: int = 1,
    tc: str = "60000+1000",
    overhead_ms: int = 150,
    elo0: float = 0.0,
    elo1: float = 15.0,
    alpha: float = 0.05,
    beta: float = 0.05,
    out: str = "bot-time-match.jsonl",
):
    if not BUNDLE:
        raise SystemExit("set TIME_MATCH_BUNDLE to the esbuild bundle of time-rule-match.ts")
    path = Path(out)
    rows: list[dict] = []
    if path.exists():
        rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    done = {r["pairSeed"] for r in rows}
    scores = [r["score"] for r in rows if "error" not in r]
    lower, upper = math.log(beta / (1 - alpha)), math.log((1 - beta) / alpha)
    todo = [
        {"a": a, "b": b, "seed": s, "tc": tc, "overhead_ms": overhead_ms}
        for s in range(seed_base, seed_base + pairs_max)
        if str(s) not in done
    ]
    print(f"{a} (A) vs {b} (B) at {tc}, overhead {overhead_ms} ms: {len(todo)} pairs to play, {len(scores)} in {path}")
    print(f"SPRT elo0={elo0} elo1={elo1} alpha={alpha} beta={beta}: bounds [{lower:.2f}, {upper:.2f}]")
    flags = sum(1 for r in rows if "games" in r for g in r["games"] if g["termination"] == "flag")
    verdict = "running"
    with path.open("a") as f:
        for row in play.map(todo, order_outputs=False):
            f.write(json.dumps(row) + "\n")
            f.flush()
            if "error" in row:
                print(f"pair {row['pairSeed']} ERROR {row['error'][:300]}")
                continue
            scores.append(row["score"])
            flags += sum(1 for g in row["games"] if g["termination"] == "flag")
            ratio = llr(scores, elo0, elo1)
            e, lo, hi = elo(scores)
            wall = max(g["wallMs"] for g in row["games"]) / 1000
            print(
                f"pair {row['pairSeed']} score {row['score']} | pairs {len(scores)} "
                f"elo {e:+.1f} [{lo:+.1f}, {hi:+.1f}] LLR {ratio:+.2f} flags {flags} | game wall {wall:.0f}s",
                flush=True,
            )
            if ratio >= upper:
                verdict = "H1 accepted: A is better"
                break
            if ratio <= lower:
                verdict = "H0 accepted: A is not 15 elo better"
                break
        else:
            verdict = "pairs_max reached without a verdict"
    e, lo, hi = elo(scores) if scores else (0.0, 0.0, 0.0)
    summary = {
        "a": a, "b": b, "tc": tc, "pairs": len(scores), "games": 2 * len(scores), "flags": flags,
        "elo": round(e, 1), "elo95": [round(lo, 1), round(hi, 1)],
        "llr": round(llr(scores, elo0, elo1), 3), "bounds": [round(lower, 3), round(upper, 3)],
        "verdict": verdict,
    }
    print("SUMMARY " + json.dumps(summary))
    path.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")
