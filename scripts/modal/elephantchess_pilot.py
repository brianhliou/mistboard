"""Scale-to-zero Modal runner for the frozen ElephantChess mining pilot.

The durable queue, fencing, checkpoints, and results stay in Railway Postgres.
Each Modal input runs exactly one scan shard or one audit candidate.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Iterable

import modal

APP_NAME = "mistboard-elephantchess-pilot"
DATABASE_SECRET = "mistboard-mining-production-db"
# The server's engine (#989): upstream Pikafish at the pikafish.ref pin plus
# pikafish-cc0-net.patch, reading the Fairy-Stockfish CC0 net. The image builds it
# from source for Linux the way scripts/engine-assets.sh does, so there is no
# local release directory to keep in step.
ENGINE_ID = "Pikafish dev-20260919-6a59ee2f"
PROFILE_VERSION = "elephantchess-pilot-2026-07-v1-modal-linux-sse41-cc0"
MANIFEST_FILE_SHA256 = "ea3701043c4167e92539165d01be3fa603c9d6c15bc97b915f8a420c145559ef"
MANIFEST_CONTENT_SHA256 = "e7f520ef1b0d7e8374ffafc4b88d8d3e4862cf06cf27852beef9f32f030f66aa"
# scripts/engine-assets.sh PIKAFISH_NET / _URL / _SHA256; checked against it below.
ENGINE_NETWORK_NAME = "xiangqi-c07e94a5c7cb.nnue"
ENGINE_NETWORK_URL = (
    "https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish-NNUE/"
    "0f4dce21530775b1dc862b7c84aa707548183097/xiangqi-c07e94a5c7cb.nnue"
)
ENGINE_NETWORK_SHA256 = "c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11"
# engine-assets.sh's behavioural pin for the patched build.
ENGINE_BENCH_NODES = 1650882
ENGINE_ARCH = "x86-64-sse41-popcnt"

REMOTE_ROOT = Path("/opt/mistboard")
REMOTE_ENGINE_DIR = Path("/opt/pikafish")
REMOTE_BINARY = REMOTE_ENGINE_DIR / "pikafish"
REMOTE_NETWORK = REMOTE_ENGINE_DIR / ENGINE_NETWORK_NAME
# A from-source build's hash is not known before the image exists, so the image
# records it; the run pins whatever this image built, and the bench count above
# is what pins the engine's behaviour.
REMOTE_BINARY_SHA256_FILE = REMOTE_ENGINE_DIR / "pikafish.sha256"

if modal.is_local():
    REPO_ROOT = Path(__file__).resolve().parents[2]
else:
    REPO_ROOT = REMOTE_ROOT


def _engine_pin() -> str:
    pin = (REPO_ROOT / "pikafish.ref").read_text(encoding="utf-8").split("\n")[0].strip()
    if len(pin) != 40 or not ENGINE_ID.endswith(f"-{pin[:8]}"):
        raise RuntimeError(f"pikafish.ref {pin!r} does not match ENGINE_ID {ENGINE_ID!r}")
    return pin


def _require_recipe_net() -> None:
    recipe = (REPO_ROOT / "scripts" / "engine-assets.sh").read_text(encoding="utf-8")
    pinned = {
        key: value
        for key, value in (
            line.split("=", 1) for line in recipe.splitlines() if line.startswith("PIKAFISH_NET")
        )
    }
    url = pinned.get("PIKAFISH_NET_URL", "").replace("$PIKAFISH_NET", ENGINE_NETWORK_NAME)
    if (
        pinned.get("PIKAFISH_NET") != ENGINE_NETWORK_NAME
        or pinned.get("PIKAFISH_NET_SHA256") != ENGINE_NETWORK_SHA256
        or url != ENGINE_NETWORK_URL
    ):
        raise RuntimeError("ENGINE_NETWORK_* differ from engine-assets.sh; update them together")


def _engine_binary_sha256() -> str:
    recorded = REMOTE_BINARY_SHA256_FILE.read_text(encoding="utf-8").split()[0]
    with REMOTE_BINARY.open("rb") as artifact:
        actual = hashlib.file_digest(artifact, "sha256").hexdigest()
    if actual != recorded:
        raise RuntimeError(f"Pikafish binary changed after the image build: {actual}")
    return actual


if modal.is_local():
    ENGINE_PIN = _engine_pin()
    _require_recipe_net()
    for required in ("pikafish-cc0-net.patch",):
        if not (REPO_ROOT / required).is_file():
            raise RuntimeError(f"required build input not found: {REPO_ROOT / required}")

SOURCE_IGNORES = [
    "**/.git/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/.env",
    "**/.env.*",
    "**/*credentials*.json",
    "**/*service-account*.json",
    "web/public/**",
]

if modal.is_local():
    image = (
        modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
        .apt_install("libatomic1", "git", "make", "g++", "curl", "ca-certificates")
        # Same steps as engine-assets.sh: fetch the pin, apply the patch, build
        # static for sse41, fetch and verify the CC0 net, gate on the bench count.
        .add_local_file(
            REPO_ROOT / "pikafish-cc0-net.patch", "/tmp/pikafish-cc0-net.patch", copy=True
        )
        .run_commands(
            "mkdir -p /tmp/pikafish && git -C /tmp/pikafish init -q",
            f"git -C /tmp/pikafish fetch -q --depth 1 https://github.com/official-pikafish/Pikafish.git {ENGINE_PIN}",
            "git -C /tmp/pikafish checkout -q FETCH_HEAD",
            "git -C /tmp/pikafish apply /tmp/pikafish-cc0-net.patch",
            f"make -C /tmp/pikafish/src -j\"$(nproc)\" ARCH={ENGINE_ARCH} EXTRALDFLAGS=-static build >/dev/null",
            f"mkdir -p {REMOTE_ENGINE_DIR} && cp /tmp/pikafish/src/pikafish {REMOTE_BINARY}",
            f"curl -fsSL --proto =https --tlsv1.2 --retry 3 -o {REMOTE_NETWORK} {ENGINE_NETWORK_URL}",
            f"echo '{ENGINE_NETWORK_SHA256}  {REMOTE_NETWORK}' | sha256sum -c -",
            f"cd {REMOTE_ENGINE_DIR} && ./pikafish bench 16 1 13 default depth > /tmp/bench.txt 2>&1"
            f" && grep -Eq '^Nodes searched[[:space:]]*:[[:space:]]*{ENGINE_BENCH_NODES}[[:space:]]*$'"
            " /tmp/bench.txt",
            f"chmod 0555 {REMOTE_BINARY} && sha256sum {REMOTE_BINARY} > {REMOTE_BINARY_SHA256_FILE}",
            "rm -rf /tmp/pikafish /tmp/pikafish-cc0-net.patch /tmp/bench.txt",
        )
        .add_local_file(
            REPO_ROOT / "package.json", str(REMOTE_ROOT / "package.json"), copy=True
        )
        .add_local_file(
            REPO_ROOT / "package-lock.json",
            str(REMOTE_ROOT / "package-lock.json"),
            copy=True,
        )
        .add_local_file(
            REPO_ROOT / "tsconfig.base.json",
            str(REMOTE_ROOT / "tsconfig.base.json"),
            copy=True,
        )
        .add_local_dir(
            REPO_ROOT / "apps", str(REMOTE_ROOT / "apps"), copy=True, ignore=SOURCE_IGNORES
        )
        .add_local_dir(
            REPO_ROOT / "packages",
            str(REMOTE_ROOT / "packages"),
            copy=True,
            ignore=SOURCE_IGNORES,
        )
        .add_local_dir(
            REPO_ROOT / "scripts" / "variant-lab",
            str(REMOTE_ROOT / "scripts" / "variant-lab"),
            copy=True,
            ignore=SOURCE_IGNORES,
        )
        .run_commands(f"cd {REMOTE_ROOT} && npm ci --ignore-scripts")
        .run_commands(
            f"cd {REMOTE_ROOT} && npm run build --workspace @mistboard/game",
            f"cd {REMOTE_ROOT} && npm run build --workspace @mistboard/board-render",
        )
    )
else:
    # Function metadata is hydrated by Modal before the module is imported in a
    # running container. Remote imports only need a placeholder Image object.
    image = modal.Image.debian_slim()

app = modal.App(APP_NAME)
verify_app = modal.App(f"{APP_NAME}-verify")
database_secret = modal.Secret.from_name(DATABASE_SECRET, required_keys=["DATABASE_URL"])
retry_policy = modal.Retries(
    max_retries=2,
    backoff_coefficient=2.0,
    initial_delay=30.0,
    max_delay=60.0,
)


def _run_command(command: list[str]) -> dict[str, Any]:
    process = subprocess.Popen(
        command,
        cwd=REMOTE_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    last_json: dict[str, Any] | None = None
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            last_json = parsed
    exit_code = process.wait()
    if exit_code != 0:
        raise subprocess.CalledProcessError(exit_code, command)
    if last_json is None:
        raise RuntimeError("worker completed without a JSON result")
    return last_json


def _require_built_workspaces() -> None:
    required = [
        REMOTE_ROOT / "packages" / "game" / "dist" / "index.js",
        REMOTE_ROOT / "packages" / "board-render" / "dist" / "index.js",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"Modal image is missing built workspaces: {', '.join(missing)}")


def _write_manifest(manifest_text: str) -> str:
    descriptor, path = tempfile.mkstemp(prefix="elephantchess-pilot-", suffix=".json")
    with os.fdopen(descriptor, "w", encoding="utf-8") as manifest_file:
        manifest_file.write(manifest_text)
    return path


def _initialization_command(manifest_path: str, *, verify_only: bool) -> list[str]:
    command = [
        "npm",
        "run",
        "pilot:elephantchess-run:init",
        "--workspace",
        "@mistboard/server",
        "--",
        "--manifest",
        manifest_path,
        "--manifest-file-sha256",
        MANIFEST_FILE_SHA256,
        "--manifest-content-sha256",
        MANIFEST_CONTENT_SHA256,
        "--binary",
        str(REMOTE_BINARY),
        "--binary-sha256",
        _engine_binary_sha256(),
        "--net",
        str(REMOTE_NETWORK),
        "--net-sha256",
        ENGINE_NETWORK_SHA256,
        "--engine-id",
        ENGINE_ID,
        "--profile-version",
        PROFILE_VERSION,
    ]
    if verify_only:
        command.append("--verify-only")
    return command


@verify_app.function(image=image, cpu=1.0, memory=1024, timeout=600)
def verify_image(manifest_text: str) -> dict[str, Any]:
    _require_built_workspaces()
    manifest_path = _write_manifest(manifest_text)
    try:
        return _run_command(_initialization_command(manifest_path, verify_only=True))
    finally:
        Path(manifest_path).unlink(missing_ok=True)


@app.function(image=image, secrets=[database_secret], cpu=1.0, memory=1024, timeout=600)
def initialize_run(manifest_text: str) -> dict[str, Any]:
    _require_built_workspaces()
    manifest_path = _write_manifest(manifest_text)
    try:
        return _run_command(_initialization_command(manifest_path, verify_only=False))
    finally:
        Path(manifest_path).unlink(missing_ok=True)


@app.function(
    image=image,
    secrets=[database_secret],
    cpu=1.0,
    memory=1024,
    timeout=6 * 60 * 60,
    retries=retry_policy,
    max_containers=4,
    scaledown_window=60,
)
def scan_shard(run_id: str, task_index: int, lease_ms: int) -> dict[str, Any]:
    _require_built_workspaces()
    task_id = os.environ.get("MODAL_TASK_ID", "unknown")
    return _run_command(
        [
            "npm",
            "run",
            "pilot:elephantchess-worker",
            "--",
            "--run-id",
            run_id,
            "--worker-id",
            f"modal-scan-{task_index}-{task_id}",
            "--binary",
            str(REMOTE_BINARY),
            "--net",
            str(REMOTE_NETWORK),
            "--lease-ms",
            str(lease_ms),
            "--max-shards",
            "1",
        ]
    )


@app.function(
    image=image,
    secrets=[database_secret],
    cpu=1.0,
    memory=1024,
    timeout=6 * 60 * 60,
    retries=retry_policy,
    max_containers=4,
    scaledown_window=60,
)
def audit_candidate(run_id: str, task_index: int, lease_ms: int) -> dict[str, Any]:
    _require_built_workspaces()
    task_id = os.environ.get("MODAL_TASK_ID", "unknown")
    return _run_command(
        [
            "npm",
            "run",
            "pilot:elephantchess-audit",
            "--",
            "--run-id",
            run_id,
            "--worker-id",
            f"modal-audit-{task_index}-{task_id}",
            "--binary",
            str(REMOTE_BINARY),
            "--net",
            str(REMOTE_NETWORK),
            "--lease-ms",
            str(lease_ms),
            "--max-candidates",
            "1",
        ]
    )


@app.function(image=image, secrets=[database_secret], cpu=0.125, memory=256, timeout=300)
def mining_status(run_id: str) -> dict[str, Any]:
    return _run_command(
        ["npm", "run", "pilot:elephantchess-status", "--", "--run-id", run_id]
    )


def _read_manifest(path: str) -> str:
    selected = path or os.environ.get("MISTBOARD_MODAL_MANIFEST_PATH", "")
    if not selected:
        raise ValueError("pass --manifest or set MISTBOARD_MODAL_MANIFEST_PATH")
    manifest_path = Path(selected).expanduser().resolve()
    if not manifest_path.is_file():
        raise ValueError(f"manifest not found: {manifest_path}")
    return manifest_path.read_text(encoding="utf-8")


def _validate_task_count(tasks: int) -> None:
    if tasks < 1 or tasks > 1_000:
        raise ValueError("tasks must be between 1 and 1000")


def _print_map_summary(kind: str, results: Iterable[object]) -> None:
    completed = 0
    failures: list[str] = []
    for result in results:
        if isinstance(result, BaseException):
            failures.append(repr(result))
        else:
            completed += 1
    print(json.dumps({"kind": kind, "completedInputs": completed, "failures": failures}))
    if failures:
        raise RuntimeError(f"{len(failures)} Modal inputs failed; rerun after leases expire")


@verify_app.local_entrypoint()
def verify(manifest: str = "") -> None:
    print(json.dumps(verify_image.remote(_read_manifest(manifest))))


@app.local_entrypoint()
def initialize(manifest: str = "") -> None:
    print(json.dumps(initialize_run.remote(_read_manifest(manifest))))


@app.local_entrypoint()
def scan(run_id: str, tasks: int = 1, lease_ms: int = 1_800_000) -> None:
    _validate_task_count(tasks)
    results = scan_shard.map(
        itertools.repeat(run_id, tasks),
        range(tasks),
        itertools.repeat(lease_ms, tasks),
        return_exceptions=True,
    )
    _print_map_summary("elephantchess-modal-scan", results)


@app.local_entrypoint()
def audit(run_id: str, tasks: int = 1, lease_ms: int = 1_800_000) -> None:
    _validate_task_count(tasks)
    results = audit_candidate.map(
        itertools.repeat(run_id, tasks),
        range(tasks),
        itertools.repeat(lease_ms, tasks),
        return_exceptions=True,
    )
    _print_map_summary("elephantchess-modal-audit", results)


@app.local_entrypoint()
def status(run_id: str) -> None:
    print(json.dumps(mining_status.remote(run_id)))
