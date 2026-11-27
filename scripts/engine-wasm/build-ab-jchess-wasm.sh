#!/bin/sh
# Build the browser AB-JChess (apps/web/public/engine/ab-jchess/) from
# lxsgx23/AB-JChess at a pinned commit plus ab-jchess-wasm-entry.patch, under
# emscripten/emsdk:3.1.74, then gate it and write the corresponding source
# archive served beside it (GPL-3.0).
#
#   sh scripts/engine-wasm/build-ab-jchess-wasm.sh [<local AB-JChess checkout>]
#
# With no argument the source is cloned from GitHub; a local checkout must
# hold the pinned commit. The net is not in the source: set ABJ_NET to
# abjchess-20261030.nnue from the AB-JChess-20261031 release (default: the
# copy already in public/engine/ab-jchess/); its sha256 must match NET_SHA256.
# Needs Docker. Writes to a scratch tree under $TMPDIR and prints the sha256 of
# each artifact; copy them into public/engine/ab-jchess/, update its README and
# the hashes in apps/web/src/review/engine/abjchess-worker.test.ts, and bump
# ABJCHESS_ENGINE_ASSET_VERSION in apps/web/src/review/engine/abjchess-ceval.ts.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REPO=https://github.com/lxsgx23/AB-JChess.git
COMMIT=efc83867230a26bbcd4a6c4cf644b69e154b452e
SHORT=efc83867
IMAGE=emscripten/emsdk:3.1.74
NET_SHA256=fdb6245b868bb204cf2b64fc4f8440d7a1e22b73abdd2a13dce180b65b01619e
NET=${ABJ_NET:-$ROOT/apps/web/public/engine/ab-jchess/abjchess-20261030.nnue}
WORK=${TMPDIR:-/tmp}/ab-jchess-wasm-build
TREE=ab-jchess-$SHORT

got=$(shasum -a 256 "$NET" | cut -d' ' -f1)
if [ "$got" != "$NET_SHA256" ]; then
  echo "net $NET has sha256 $got, expected $NET_SHA256" >&2
  exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/$TREE"
SRC=${1:-}
if [ -z "$SRC" ]; then
  git clone -q "$REPO" "$WORK/clone"
  SRC=$WORK/clone
fi
# The archive's timestamps are the commit's, so the same inputs give the same bytes.
EPOCH=$(git -C "$SRC" log -1 --format=%ct "$COMMIT")
git -C "$SRC" archive "$COMMIT" | tar -x -C "$WORK/$TREE"
(cd "$WORK/$TREE" && git apply "$ROOT/scripts/engine-wasm/ab-jchess-wasm-entry.patch")
mkdir -p "$WORK/$TREE/wasm"
cp "$ROOT/scripts/engine-wasm/ab-jchess-wasm-build.sh" "$WORK/$TREE/wasm/build.sh"
cp "$ROOT/scripts/engine-wasm/ab-jchess-wasm-entry.patch" "$WORK/$TREE/wasm/"
cp "$ROOT/scripts/engine-wasm/ab-jchess-wasm-gate.cjs" "$WORK/$TREE/wasm/gate.cjs"
cp "$NET" "$WORK/net.nnue"
echo "patched AB-JChess@$SHORT"

docker run --rm --platform linux/amd64 -v "$WORK:/work" -w "/work/$TREE" "$IMAGE" sh -c "
  set -e
  tar --sort=name --mtime=@$EPOCH --owner=0 --group=0 --numeric-owner \
    -C /work -cf - $TREE | gzip -9n > /work/abjchess-source-$SHORT.tar.gz
  bash ./wasm/build.sh
  node wasm/gate.cjs dist/wasm /work/net.nnue
"

shasum -a 256 "$WORK/$TREE/dist/wasm/abjchess.js" "$WORK/$TREE/dist/wasm/abjchess.wasm" \
  "$WORK/abjchess-source-$SHORT.tar.gz"
echo "artifacts in $WORK/$TREE/dist/wasm, source archive $WORK/abjchess-source-$SHORT.tar.gz"
