#!/bin/sh
# Build the browser Fairy-Stockfish (apps/web/public/engine/fairy-stockfish/)
# from the fairy-stockfish.wasm repo plus fairy-stockfish-atomic-xiangqi.patch,
# the way upstream's publish job builds the npm package (emscripten/emsdk:2.0.26
# through the repo's docker-compose, embedded_nnue=no), then gate it.
#
#   sh scripts/engine-wasm/build-fairy-stockfish-wasm.sh [<wasm-repo-commit>]
#
# Needs Docker. Writes to a scratch clone under $TMPDIR and prints the sha256
# of the three artifacts; copy them into public/engine/fairy-stockfish/, update
# the README's provenance block and bump ENGINE_ASSET_VERSION in
# apps/web/src/review/engine/ceval.ts. The patch is the same file railpack
# applies to the native bot binary; a change to it is a change to BOTH builds.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WASM_REPO=https://github.com/fairy-stockfish/fairy-stockfish.wasm.git
COMMIT=${1:-db432abaf83a1e7c265ff9c8554f83977d3441f5}
WORK=${TMPDIR:-/tmp}/fairy-stockfish-wasm-build

rm -rf "$WORK"
git clone -q "$WASM_REPO" "$WORK"
git -C "$WORK" checkout -q "$COMMIT"
git -C "$WORK" remote add upstream https://github.com/fairy-stockfish/Fairy-Stockfish.git
git -C "$WORK" fetch -q upstream master
git -C "$WORK" apply "$ROOT/fairy-stockfish-atomic-xiangqi.patch"
echo "patched fairy-stockfish.wasm@$(git -C "$WORK" rev-parse --short HEAD)"

cd "$WORK/src/emscripten"
DOCKER_USER=$(id -u):$(id -g) docker compose run --rm emscripten \
  make -C .. emscripten_build ARCH=wasm embedded_nnue=no

cat "$ROOT/apps/web/public/engine/fairy-stockfish/fortress-xiangqi.ini" \
    "$ROOT/apps/server/src/atomic-xiangqi.ini" > public/variants.ini
cp "$ROOT/scripts/engine-wasm/fairy-stockfish-wasm-gate.cjs" public/gate.cjs
docker compose run --rm -T node node public/gate.cjs

shasum -a 256 public/stockfish.js public/stockfish.wasm public/stockfish.worker.js
echo "artifacts in $WORK/src/emscripten/public"
