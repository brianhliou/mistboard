#!/bin/sh
# The stock Fairy-Stockfish largeboard release binary (/app/bin/fairy-stockfish),
# the general variant engine (uci-engine-harness.ts), checked to know xiangqi.
#
# A script, not an inline railpack command: railpack cut inline commands at their
# first single quote (2026-09-30, see fetch-abjchess-net.sh), so the inline
# version's variant check grepped for a shorter string than written and its
# success line never printed.
#
# Usage: scripts/fetch-fairy-stockfish-largeboard.sh <bindir>
set -eu

bin=${1:?bindir}
url=https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/fairy_sf_14/fairy-stockfish-largeboard_x86-64
# Pinned here, so a replaced release asset fails the build (hashed 2026-10-02).
sha=41b8b4d539adfd9924929ee4a948d1a37dd1e9beaa535a811cb5e7fee9e4cb99

die() { echo "fairy-stockfish: $*" >&2; exit 1; }

mkdir -p "$bin"
curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$bin/fairy-stockfish" "$url" || die "download failed: $url"
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$bin/fairy-stockfish" | cut -c1-64); else got=$(shasum -a 256 "$bin/fairy-stockfish" | cut -c1-64); fi
[ "$got" = "$sha" ] || die "sha256 mismatch for $url (want $sha, got $got)"
chmod +x "$bin/fairy-stockfish"
echo uci | "$bin/fairy-stockfish" | grep -q 'var xiangqi' || die "$bin/fairy-stockfish does not list the xiangqi variant"
echo fsf-largeboard-xiangqi-ok
