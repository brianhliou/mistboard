#!/bin/sh
# Clones the private mistboard-engine repo into the image and checks out the ref
# pinned in engine.ref (line 1), else $MISTBOARD_ENGINE_REF, else main. Runs only
# when MISTBOARD_BUILD_ENGINE=1 (engine-worker); railpack has already installed
# the deploy key.
#
# A script, not an inline railpack command: railpack cut inline commands at their
# first single quote (2026-09-30, see fetch-abjchess-net.sh), and this step's
# whitespace strip needed one.
#
# Usage: scripts/checkout-private-engine.sh <repo-root> <dest>
set -eu

root=${1:?repo root}
dest=${2:?dest}

git clone git@github.com:brianhliou/mistboard-engine.git "$dest"
ref=$(head -1 "$root/engine.ref" 2>/dev/null | tr -d '[:space:]' || true)
ref=${ref:-${MISTBOARD_ENGINE_REF:-main}}
git -C "$dest" checkout "$ref"
echo "engine-ref-deployed=$ref"
git -C "$dest" rev-parse HEAD
