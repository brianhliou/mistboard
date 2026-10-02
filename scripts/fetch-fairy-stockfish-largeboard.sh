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

die() { echo "fairy-stockfish: $*" >&2; exit 1; }

mkdir -p "$bin"
curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$bin/fairy-stockfish" "$url" || die "download failed: $url"
chmod +x "$bin/fairy-stockfish"
echo uci | "$bin/fairy-stockfish" | grep -q 'var xiangqi' || die "$bin/fairy-stockfish does not list the xiangqi variant"
echo fsf-largeboard-xiangqi-ok
