"""MistyBanqi (and the other Misty engines) self-play on Modal.

The driver is scripts/misty-hero-selfplay.ts: it plays the shipped engine
against itself through the real @mistboard/game kernel, one game per seed.
Locally that is one core per game and a 10M-node game is five minutes on an
idle machine; on Modal it is one container per seed, all at once.

  modal run scripts/modal/misty_selfplay.py::smoke                        # one game, 1M nodes
  modal run scripts/modal/misty_selfplay.py::batch --variant banqi \
      --nodes 10000000 --seed 300 --games 20 --out tmp/banqi-study     # one JSON per seed

The image clones the public misty-* engine repo at a pinned commit and builds
it, clones mistboard and builds its packages, and overlays the LOCAL copy of
the driver so a driver change (say, a new flag) runs without a push. Outputs
land in --out as game-<seed>.json, the shape scripts/banqi-study.ts --compile
reads.
"""

import json
import os
import subprocess
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DRIVER_LOCAL = REPO / "scripts" / "misty-hero-selfplay.ts"

ENGINES = {
    "banqi": {"repo": "misty-banqi", "commit": "96fbab3", "bin": "banqi-engine"},
    "jungle": {"repo": "misty-jungle", "commit": "main", "bin": "jungle-engine"},
    "jungle-flip": {"repo": "misty-flip-jungle", "commit": "main", "bin": "jungle-flip-engine"},
}

MISTBOARD_REF = "main"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "build-essential", "ca-certificates", "curl", "pkg-config")
    .run_commands(
        # Node 22 (the repo's engines field) and Rust, both pinned by their installers' channels.
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
        "curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
        # The engines, built at the commit the site ships.
        *[
            f"git clone https://github.com/brianhliou/{spec['repo']}.git /root/projects/{spec['repo']} "
            f"&& cd /root/projects/{spec['repo']} && git checkout {spec['commit']} "
            f"&& . /root/.cargo/env && cargo build --release"
            for spec in ENGINES.values()
        ],
        # The monorepo, for the kernel the driver plays through.
        f"git clone --depth 1 --branch {MISTBOARD_REF} https://github.com/brianhliou/mistboard.git /root/mistboard",
        # Only the kernel package: the driver imports @mistboard/game and nothing else of the repo.
        "cd /root/mistboard && npm ci --ignore-scripts && npm run build --workspace packages/game",
    )
    .add_local_file(str(DRIVER_LOCAL), "/root/mistboard/scripts/misty-hero-selfplay.ts")
)

app = modal.App("misty-selfplay", image=image)


@app.function(timeout=3600, cpu=1.0, max_containers=24)
def play_one(variant: str, nodes: int, seed: int, max_plies: int = 300) -> dict:
    """One game, one seed, at `nodes` per move. Returns the driver's JSON."""
    out = f"/tmp/game-{seed}.json"
    cmd = [
        "npx", "tsx", "scripts/misty-hero-selfplay.ts",
        "--variant", variant, "--nodes", str(nodes), "--seed", str(seed),
        "--games", "1", "--max-plies", str(max_plies), "--out", out,
    ]
    env = {**os.environ, "HOME": "/root"}
    proc = subprocess.run(cmd, cwd="/root/mistboard", env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"seed {seed}: driver exited {proc.returncode}\n{proc.stderr[-2000:]}")
    return json.loads(Path(out).read_text())


@app.local_entrypoint()
def smoke():
    result = play_one.remote("banqi", 1_000_000, 1, 200)
    game = result["games"][0]
    print(f"smoke: seed {game['seed']}, {game['plies']} plies, {json.dumps(game['status'])}")


@app.local_entrypoint()
def batch(variant: str = "banqi", nodes: int = 10_000_000, seed: int = 300, games: int = 20, out: str = "tmp/banqi-study"):
    out_dir = REPO / out
    out_dir.mkdir(parents=True, exist_ok=True)
    seeds = list(range(seed, seed + games))
    done = 0
    for result in play_one.map([variant] * len(seeds), [nodes] * len(seeds), seeds, order_outputs=False):
        game = result["games"][0]
        path = out_dir / f"game-{game['seed']}.json"
        path.write_text(json.dumps(result, indent=2) + "\n")
        done += 1
        print(f"[{done}/{len(seeds)}] seed {game['seed']}: {game['plies']} plies, {json.dumps(game['status'])} -> {path.name}")
