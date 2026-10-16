#!/bin/sh
# The official Fairy-Stockfish xiangqi NNUE net, fetched at image build time and
# loaded in the fetched fairy-stockfish-xiangqi binary before the image is kept.
# Xiangqi L8 plays on this net (xiangqi-fsf-engine.ts).
#
# A script, not an inline railpack command: railpack cut inline commands at their
# first single quote (2026-09-30, see fetch-abjchess-net.sh), so the inline
# version of this step ran only the download; the sha256 check and the load check
# after it never ran and the build still passed.
#
# Usage: scripts/fetch-fsf-xiangqi-net.sh <bindir>   (needs <bindir>/fairy-stockfish-xiangqi)
set -eu

bin=${1:?bindir}
net=xiangqi-c07e94a5c7cb.nnue
url=https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish-NNUE/0f4dce21530775b1dc862b7c84aa707548183097/$net
net_sha=c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11

log() { echo "fsf-xiangqi-net: $*"; }
die() { echo "fsf-xiangqi-net: $*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

[ -x "$bin/fairy-stockfish-xiangqi" ] || die "$bin/fairy-stockfish-xiangqi is missing (run engine-assets.sh fetch first)"

curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$bin/$net" "$url" || die "download failed: $url"
[ "$(sha256 "$bin/$net")" = "$net_sha" ] || die "$net sha256 mismatch (want $net_sha)"
log "$net ok"

# Load it: the binary must report NNUE evaluation with this file.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
out="$tmp/uci.out"
{
  printf 'uci\nsetoption name Use NNUE value true\nsetoption name EvalFile value %s\n' "$bin/$net"
  printf 'setoption name UCI_Variant value xiangqi\nucinewgame\nisready\ngo depth 1\n'
  i=0
  until grep -q '^bestmove' "$out" 2>/dev/null || [ "$i" -ge 300 ]; do sleep 0.1; i=$((i + 1)); done
  echo quit
} | "$bin/fairy-stockfish-xiangqi" > "$out"
grep -q 'NNUE evaluation using' "$out" || die "fairy-stockfish-xiangqi did not load $net: $(tail -3 "$out")"
grep -q '^bestmove' "$out" || die "fairy-stockfish-xiangqi did not answer a search with $net"
log "installed $net into $bin, loaded by fairy-stockfish-xiangqi"
echo fairy-stockfish-xiangqi-nnue-ok
