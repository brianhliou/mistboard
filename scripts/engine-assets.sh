#!/bin/sh
# Server engine binaries as release assets.
#
# One recipe, two consumers:
#   .github/workflows/build-engines.yml   build + verify + package on a GitHub
#                                         runner, publish as release
#                                         `engines-<recipe hash>`
#   railpack.json                         fetch + verify at image build time
#
# Until 2026-09-23 railpack compiled all six engines from source on EVERY
# deploy: 2.5 min of a 5.6 min deploy, because the build step runs after the
# source copy and its layers never cache. The engines move a few times a year;
# the app moves thirty times a day. Now a deploy downloads one tarball (a few
# seconds) and re-runs the same output gates the compile used to run.
#
# The recipe hash covers every input that decides the binaries (the pinned
# commits, the patches, the make flags via RECIPE_VERSION). Bump a pin and the
# hash moves; the workflow publishes the new release on push; a deploy that
# runs before it has published fails loudly with the tag it wanted. Nothing is
# resolved by "latest".
#
# Usage:
#   scripts/engine-assets.sh tag                      print engines-<hash>
#   scripts/engine-assets.sh build <bindir>           compile every engine into <bindir>
#   scripts/engine-assets.sh verify <bindir> <inidir> uci/perft/net gates against <bindir>
#   scripts/engine-assets.sh package <bindir> <out>   tarball + SHA256SUMS + MANIFEST
#   scripts/engine-assets.sh fetch <bindir>           download + checksum + extract the release
set -eu

# Bump when the make flags, the packaged file set or the layout change; the
# pins and patches are hashed on their own.
RECIPE_VERSION=1
# The ISA every server engine targets. Do not swap in avx2 without confirming
# the container's CPU flags (stockfish.ref).
ARCH=x86-64-sse41-popcnt
ASSET="engines-$ARCH.tar.gz"
RELEASE_REPO=brianhliou/mistboard
# Every file whose content decides the binaries. The workflow's push paths and
# the Railway watch patterns list the same files; scripts/engine-assets.test.mjs
# fails if they drift apart.
RECIPE_INPUTS="fairy-stockfish-xiangqi.ref fairy-stockfish-duck-xiangqi.ref fairy-stockfish-duck-xiangqi.patch fairy-stockfish-atomic-xiangqi.ref fairy-stockfish-atomic-xiangqi.patch stockfish.ref pikafish-jieqi.ref pikafish.ref"
BINARIES="fairy-stockfish-xiangqi fairy-stockfish-duck-xiangqi fairy-stockfish-atomic-xiangqi stockfish pikafish-jieqi pikafish"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

log() { echo "engine-assets: $*"; }
die() { echo "engine-assets: $*" >&2; exit 1; }

# First line of a .ref file, whitespace stripped (the rest of the file is comment).
pin() { head -1 "$ROOT/$1" | tr -d '[:space:]'; }

# GNU coreutils on the runner and in the image; macOS (the tooling test) has shasum.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

recipe_hash() {
  {
    echo "recipe-version=$RECIPE_VERSION"
    echo "arch=$ARCH"
    for input in $RECIPE_INPUTS; do
      case "$input" in
        *.ref) echo "$input=$(pin "$input")" ;;
        *) echo "$input=$(sha256 "$ROOT/$input" | cut -c1-64)" ;;
      esac
    done
  } | sha256 | cut -c1-12
}

tag() { echo "engines-$(recipe_hash)"; }

# fetch_source <dir> <repo url> <commit>: a depth-1 checkout of one commit.
fetch_source() {
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" fetch -q --depth 1 "$2" "$3"
  git -C "$1" checkout -q FETCH_HEAD
}

# Static linking so the binary does not depend on the builder's glibc or
# libstdc++ matching the runtime image's.
sf_make() {
  dir=$1
  shift
  make -C "$dir" -j"$JOBS" ARCH="$ARCH" EXTRALDFLAGS=-static "$@" build >/dev/null
}

build() {
  bin=$1
  mkdir -p "$bin"
  work=$(mktemp -d)
  fsf=https://github.com/fairy-stockfish/Fairy-Stockfish.git

  ref=$(pin fairy-stockfish-xiangqi.ref)
  log "fairy-stockfish-xiangqi @ $ref"
  fetch_source "$work/fsf-xiangqi" "$fsf" "$ref"
  sf_make "$work/fsf-xiangqi/src" largeboards=yes nnue=yes
  cp "$work/fsf-xiangqi/src/stockfish" "$bin/fairy-stockfish-xiangqi"

  ref=$(pin fairy-stockfish-duck-xiangqi.ref)
  log "fairy-stockfish-duck-xiangqi @ $ref + fairy-stockfish-duck-xiangqi.patch"
  fetch_source "$work/fsf-duck" "$fsf" "$ref"
  git -C "$work/fsf-duck" apply "$ROOT/fairy-stockfish-duck-xiangqi.patch"
  sf_make "$work/fsf-duck/src" largeboards=yes nnue=yes
  cp "$work/fsf-duck/src/stockfish" "$bin/fairy-stockfish-duck-xiangqi"

  ref=$(pin fairy-stockfish-atomic-xiangqi.ref)
  log "fairy-stockfish-atomic-xiangqi @ $ref + fairy-stockfish-atomic-xiangqi.patch"
  fetch_source "$work/fsf-atomic" "$fsf" "$ref"
  git -C "$work/fsf-atomic" apply "$ROOT/fairy-stockfish-atomic-xiangqi.patch"
  sf_make "$work/fsf-atomic/src" largeboards=yes nnue=yes
  cp "$work/fsf-atomic/src/stockfish" "$bin/fairy-stockfish-atomic-xiangqi"

  ref=$(pin stockfish.ref)
  log "stockfish @ $ref"
  fetch_source "$work/stockfish" https://github.com/official-stockfish/Stockfish.git "$ref"
  sf_make "$work/stockfish/src"
  cp "$work/stockfish/src/stockfish" "$bin/stockfish"

  ref=$(pin pikafish-jieqi.ref)
  log "pikafish-jieqi @ $ref (brianhliou/pikafish-jieqi-wasm)"
  fetch_source "$work/pikafish-jieqi" https://github.com/brianhliou/pikafish-jieqi-wasm.git "$ref"
  sf_make "$work/pikafish-jieqi/src"
  cp "$work/pikafish-jieqi/src/PikaJieQi" "$bin/pikafish-jieqi"

  ref=$(pin pikafish.ref)
  log "pikafish @ $ref"
  fetch_source "$work/pikafish" https://github.com/official-pikafish/Pikafish.git "$ref"
  sf_make "$work/pikafish/src"
  cp "$work/pikafish/src/pikafish" "$bin/pikafish"
  cp "$work/pikafish/src/pikafish.nnue" "$bin/pikafish.nnue"

  chmod +x "$bin"/*
  rm -rf "$work"
  for name in $BINARIES; do
    log "$name: $(ldd "$bin/$name" 2>&1 | head -1 | tr -s ' ')"
  done
}

# uci_ok <binary> <label> <pattern>: the binary answers `uci` with <pattern>.
uci_ok() {
  echo uci | "$1" | grep -q "$3" && log "$2 ok" || die "$2: no '$3' in the uci reply"
}

# perft_ok <binary> <ini> <variant> <position> <nodes> <label>: FSF agrees with
# the kernel's own legal-move count. A binary that plays a different game does
# not crash, it just plays a different game (see the .ref files for why each
# count discriminates).
perft_ok() {
  printf 'uci\nsetoption name VariantPath value %s\nsetoption name UCI_Variant value %s\nucinewgame\nposition %s\nisready\ngo perft 1\n' \
    "$2" "$3" "$4" | "$1" | grep -q "Nodes searched: $5" && log "$6 ok (perft 1 = $5)" ||
    die "$6: perft(1) is not $5 for '$4'"
}

verify() {
  bin=$1
  ini=$2
  for name in $BINARIES; do
    test -x "$bin/$name" || die "$bin/$name is missing or not executable"
  done
  uci_ok "$bin/fairy-stockfish-xiangqi" fairy-stockfish-xiangqi 'var xiangqi'
  perft_ok "$bin/fairy-stockfish-duck-xiangqi" "$ini/duck-xiangqi.ini" duckxiangqi startpos 2554 duck-xiangqi-opening
  perft_ok "$bin/fairy-stockfish-duck-xiangqi" "$ini/duck-xiangqi.ini" duckxiangqi 'fen 9/4k4/9/9/9/4*4/P8/9/4K4/9 w - - 0 1' 430 duck-xiangqi-facing
  perft_ok "$bin/fairy-stockfish-duck-xiangqi" "$ini/duck-xiangqi.ini" duckxiangqi 'fen 9/4k4/9/9/9/9/P8/9/4K4/*8 w - - 0 1' 431 duck-xiangqi-flight
  perft_ok "$bin/fairy-stockfish-atomic-xiangqi" "$ini/atomic-xiangqi.ini" atomicxiangqi startpos 44 atomic-xiangqi-opening
  perft_ok "$bin/fairy-stockfish-atomic-xiangqi" "$ini/atomic-xiangqi.ini" atomicxiangqi 'fen 3ak4/3r5/9/9/9/9/9/3C5/9/4K4 w - - 0 1' 3 atomic-xiangqi-shot
  perft_ok "$bin/fairy-stockfish-atomic-xiangqi" "$ini/atomic-xiangqi.ini" atomicxiangqi 'fen 3ak4/9/9/9/9/9/9/3R5/9/4K4 w - - 0 1' 4 atomic-xiangqi-blast
  uci_ok "$bin/stockfish" stockfish 'id name Stockfish'
  uci_ok "$bin/pikafish-jieqi" pikafish-jieqi uciok
  test -s "$bin/pikafish.nnue" || die "pikafish.nnue is missing or empty"
  uci_ok "$bin/pikafish" pikafish uciok
  log "verified $(tag) in $bin"
}

package() {
  bin=$1
  out=$2
  mkdir -p "$out"
  {
    echo "tag=$(tag)"
    echo "arch=$ARCH"
    echo "recipe-version=$RECIPE_VERSION"
    for input in $RECIPE_INPUTS; do
      case "$input" in
        *.ref) echo "$input=$(pin "$input")" ;;
        *) echo "$input=sha256:$(sha256 "$ROOT/$input" | cut -c1-64)" ;;
      esac
    done
  } > "$out/MANIFEST"
  # shellcheck disable=SC2086
  tar -C "$bin" -czf "$out/$ASSET" $BINARIES pikafish.nnue
  (cd "$out" && sha256 "$ASSET" > SHA256SUMS)
  log "packaged $out/$ASSET ($(du -h "$out/$ASSET" | cut -f1))"
}

fetch() {
  bin=$1
  release=$(tag)
  base="https://github.com/$RELEASE_REPO/releases/download/$release"
  tmp=$(mktemp -d)
  if ! curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$tmp/$ASSET" "$base/$ASSET"; then
    die "no published release '$release' for this engine recipe. A .ref, .patch or this script changed: the 'Build engines' workflow (.github/workflows/build-engines.yml) publishes it on push to main, or dispatch it by hand, then redeploy."
  fi
  curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
  (cd "$tmp" && sha256 -c SHA256SUMS >/dev/null) || die "$ASSET does not match $release/SHA256SUMS"
  mkdir -p "$bin"
  tar -xzf "$tmp/$ASSET" -C "$bin"
  for name in $BINARIES; do chmod +x "$bin/$name"; done
  rm -rf "$tmp"
  log "installed $release into $bin"
}

case "${1:-}" in
  tag) tag ;;
  hash) recipe_hash ;;
  build) build "${2:?bindir}" ;;
  verify) verify "${2:?bindir}" "${3:?inidir}" ;;
  package) package "${2:?bindir}" "${3:?outdir}" ;;
  fetch) fetch "${2:?bindir}" ;;
  *) sed -n '/^# Usage:/,/^set -eu/p' "$0" | sed '$d;s/^# \{0,1\}//'; exit 2 ;;
esac
