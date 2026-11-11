"""Read-only snapshot audit on disposable CC0 workers, with private checkpoints."""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

import modal

REF = "6a59ee2f7b105bff64d9efc2692591107787e2b1"
PATCH_SHA = "790609318c020e3aeeb71a76ee7e987ee346d66005bb5eb26675544b2182d10b"
NET_SHA = "c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11"
NET_NAME = "xiangqi-c07e94a5c7cb.nnue"
REMOTE = Path("/opt/work")
ENGINE = Path("/opt/pikafish/src/pikafish")
NET = ENGINE.parent / NET_NAME
VOLUME_NAME = "mistboard-puzzle-evidence-20261109"
SOURCES = [
    "packages/game/src/puzzles-xiangqi-mining.ts",
    "packages/game/src/puzzles-xiangqi-endpoint.ts",
    "scripts/variant-lab/xiangqi-pikafish-uci.ts",
    "scripts/variant-lab/xiangqi-corpus-quality-audit.ts",
    "scripts/variant-lab/xiangqi-puzzle-verification.ts",
    "scripts/modal/xiangqi_corpus_quality_audit.py",
    "packages/game/src/variants-xiangqi-standard.ts",
    "packages/game/src/variants-xiangqi.ts",
    "packages/game/src/xiangqi-position.ts",
    "packages/game/src/xiangqi-uci.ts",
]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


if modal.is_local():
    ROOT = Path(__file__).resolve().parents[2]
    PATCH = Path(os.environ.get("MISTBOARD_PUZZLE_CC0_PATCH", ROOT / "pikafish-cc0-net.patch"))
    if sha(PATCH.read_bytes()) != PATCH_SHA:
        raise RuntimeError("Pinned CC0 patch required")
    image = (
        modal.Image.from_id("im-q1Blke5wtvNSvzxQA8qbZm")
        .add_local_file(ROOT / "package.json", str(REMOTE / "package.json"), copy=True)
        .add_local_dir(ROOT / "packages/game/src", str(REMOTE / "packages/game/src"), copy=True,
                       ignore=["**/*.test.ts", "**/*.slowtest.ts", "**/.git/**", "**/.env*"])
        .add_local_file(ROOT / "scripts/variant-lab/xiangqi-pikafish-uci.ts", str(REMOTE / "scripts/variant-lab/xiangqi-pikafish-uci.ts"), copy=True)
        .add_local_file(ROOT / "scripts/variant-lab/xiangqi-corpus-quality-audit.ts", str(REMOTE / "scripts/variant-lab/xiangqi-corpus-quality-audit.ts"), copy=True)
        .add_local_file(ROOT / "scripts/variant-lab/xiangqi-puzzle-verification.ts", str(REMOTE / "scripts/variant-lab/xiangqi-puzzle-verification.ts"), copy=True)
        .add_local_file(ROOT / "scripts/modal/xiangqi_corpus_quality_audit.py", str(REMOTE / "scripts/modal/xiangqi_corpus_quality_audit.py"), copy=True)
    )
else:
    image = modal.Image.debian_slim(python_version="3.12")

app = modal.App("mistboard-xiangqi-corpus-quality-audit")
volume = modal.Volume.from_name(VOLUME_NAME)


def verified_profile(expected_sources: dict[str, str]) -> dict:
    if sha(Path("/opt/cc0.patch").read_bytes()) != PATCH_SHA or sha(NET.read_bytes()) != NET_SHA:
        raise RuntimeError("CC0 artifact mismatch")
    if sha(ENGINE.read_bytes()) != "68bc5d9520797dcf5895ffc4acc9f300f8bc6a41a389b73e68da558230ff2e90":
        raise RuntimeError("Archived engine binary mismatch")
    for name, expected in expected_sources.items():
        if sha((REMOTE / name).read_bytes()) != expected:
            raise RuntimeError(f"Source mismatch: {name}")
    bench = subprocess.run([str(ENGINE), "bench", "16", "1", "13", "default", "depth"],
                           cwd=ENGINE.parent, capture_output=True, text=True, timeout=120, check=True)
    match = re.search(r"Nodes searched\s*:\s*(\d+)", bench.stdout + bench.stderr)
    if not match or int(match[1]) != 1_650_882:
        raise RuntimeError("CC0 engine benchmark mismatch")
    return {"engineRef": REF, "patchSha256": PATCH_SHA, "networkSha256": NET_SHA,
            "binarySha256": sha(ENGINE.read_bytes()), "benchNodes": int(match[1]),
            "sourceHashes": expected_sources}


@app.function(image=image, cpu=1.0, memory=1024, max_containers=8,
              timeout=7400, nonpreemptible=True, scaledown_window=2, volumes={"/evidence": volume})
def audit_shard(rows: list[dict], shard: int, execution: str, expected_sources: dict[str, str], snapshot_sha: str):
    if len(rows) > 25 or not re.fullmatch(r"[0-9a-f]{64}", execution):
        raise ValueError("Invalid bounded shard")
    profile = verified_profile(expected_sources)
    profile.update({"executionId": execution, "snapshotSha256": snapshot_sha, "shard": shard})
    folder = Path("/evidence") / execution
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"shard-{shard}.jsonl"
    if output.exists():
        raise RuntimeError("Checkpoint exists; recover it before launching duplicate work")
    started = time.monotonic()
    command = ["/opt/runtime/node_modules/.bin/tsx", str(REMOTE / SOURCES[3]),
               "--binary", str(ENGINE), "--net", str(NET), "--expected-net-sha256", NET_SHA]
    proc = subprocess.Popen(command, cwd=REMOTE, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(json.dumps({"rows": rows}))
    proc.stdin.close()
    completed = 0
    complete_marker = False
    try:
        with output.open("x") as stream:
            header = {"type": "verified-profile", "profile": profile}
            stream.write(json.dumps(header) + "\n")
            stream.flush()
            volume.commit()
            yield header
            for line in proc.stdout:
                result = json.loads(line)
                if result["type"] == "complete":
                    complete_marker = True
                stream.write(json.dumps(result) + "\n")
                stream.flush()
                if result["type"] == "puzzle":
                    completed += 1
                    if completed % 10 == 0:
                        volume.commit()
                    if completed % 25 == 0:
                        print(json.dumps({"shard": shard, "completed": completed, "total": len(rows)}), flush=True)
                yield result
            code = proc.wait(timeout=30)
            if code:
                error = proc.stderr.read() if proc.stderr else ""
                raise RuntimeError(f"Audit worker exit {code}: {error[-1000:]}")
            if not complete_marker or completed != len(rows):
                raise RuntimeError("Incomplete shard; recover checkpoints before retrying")
            receipt = {"type": "shard-receipt", "shard": shard, "puzzles": completed,
                       "workerWallSeconds": round(time.monotonic() - started, 2)}
            stream.write(json.dumps(receipt) + "\n")
            stream.flush()
            yield receipt
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        volume.commit()


@app.local_entrypoint()
def main(snapshot: str, out: str, canary: bool = False, canary_ids: str = ""):
    path = Path(snapshot)
    snapshot_sha = sha(path.read_bytes())
    data = json.loads(path.read_text())
    rows = [{"id": r["id"], "puzzle": r["puzzle"]} for r in data["rows"]]
    if len(rows) > 2000 or len({r["id"] for r in rows}) != len(rows):
        raise RuntimeError("Unexpected or duplicate snapshot rows")
    runtime_sources = sorted({*SOURCES, *[
        str(p.relative_to(ROOT)) for p in (ROOT / "packages/game/src").rglob("*")
        if p.is_file() and not p.name.endswith((".test.ts", ".slowtest.ts"))
    ]})
    expected_sources = {name: sha((ROOT / name).read_bytes()) for name in runtime_sources}
    folder = Path(out)
    folder.mkdir(parents=True, exist_ok=True)
    manifest = folder / "manifest.json"
    if manifest.exists():
        raise RuntimeError("Manifest exists; inspect checkpoints before any restart")
    if canary:
        known = set(canary_ids.split(",")) if canary_ids else {
            "xq-mined-hxq_1f2c71d5aaebf582a966b33f-46",
            "xq-mined-hxq_e030caa623dc9f123c9f0f7e-55",
            "xq-mined-hxq_c39c79ef6795128a69df2533-76",
            "xq-mined-hxq_7d9088fec5f542467a5dc000-63",
            "xq-mined-hxq_3f8aab33bad43b77bf8013e7-40",
            "xq-mined-hxq_c0799e50644d0b5e32df9f70-76",
            "xq-mined-hxq_88241141561cc82a355ca699-60",
            "xq-mined-hxq_5746bee05c582609255eec13-62",
        }
        if not 1 <= len(known) <= 12:
            raise RuntimeError("Choose at most twelve canary puzzles")
        rows = [r for r in rows if r["id"] in known]
        if len(rows) != len(known):
            raise RuntimeError("Canary fixtures are missing from the snapshot")
    identity = {"snapshotSha256": snapshot_sha, "sources": expected_sources,
                "canary": canary, "ids": [row["id"] for row in rows]}
    execution = sha(json.dumps(identity, sort_keys=True).encode())
    shard_count = min(4, len(rows)) if canary else max(1, (len(rows) + 24) // 25)
    shards = [rows[i::shard_count] for i in range(shard_count)]
    manifest.write_text(json.dumps({**identity, "executionId": execution, "puzzles": len(rows),
        "shards": [{"shard": i, "ids": [r["id"] for r in batch]} for i, batch in enumerate(shards)]}, indent=2))

    def consume(index: int):
        saved = 0
        with (folder / f"shard-{index}.jsonl").open("x") as stream:
            for result in audit_shard.remote_gen(shards[index], index, execution, expected_sources, snapshot_sha):
                stream.write(json.dumps(result) + "\n")
                stream.flush()
                if result["type"] == "puzzle":
                    saved += 1
                    if canary or saved % 25 == 0:
                        print(json.dumps({"shard": index, "saved": saved, "total": len(shards[index])}), flush=True)
        return saved

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, shard_count)) as pool:
        totals = list(pool.map(consume, range(shard_count)))
    if sum(totals) != len(rows):
        raise RuntimeError("Snapshot coverage incomplete")
    print(json.dumps({"complete": True, "puzzles": sum(totals), "executionId": execution,
                      "volume": VOLUME_NAME}), flush=True)
