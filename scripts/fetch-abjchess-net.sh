#!/bin/sh
# The AB-JChess net, fetched from its authors' release at image build time.
#
# The authors allowed site use on the terms that we fetch the net from their
# release and never re-host it (lxsgx23/AB-JChess#1), so it is not in our
# engines tarball (scripts/engine-assets.sh builds the binary only). This
# downloads their v0.2b zip, checks the zip's and the net's sha256, extracts the
# net, and loads it in the fetched binary before the image is kept.
#
# A script, not an inline railpack command: railpack cut inline commands at their
# first single quote (2026-09-30), so the checks after the download never ran and
# the net never reached the image while the build still passed.
#
# Usage: scripts/fetch-abjchess-net.sh <bindir>   (needs <bindir>/ab-jchess)
set -eu

bin=${1:?bindir}
url=https://github.com/lxsgx23/AB-JChess/releases/download/v0.2b/0.2b_bmi2.zip
zip_sha=6cb9cfe44946e5e4494643d32ae6352f7240c7e43d0ecbb4a437b04d7c388b03
net=abjchess-20260911.nnue
net_sha=7a229d324e50d2b0acf3e5878a8f876b96a24b75d16c8492a3c3bf8e1418d944

log() { echo "abjchess-net: $*"; }
die() { echo "abjchess-net: $*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$tmp/abj.zip" "$url" || die "download failed: $url"
[ "$(sha256 "$tmp/abj.zip")" = "$zip_sha" ] || die "zip sha256 mismatch (want $zip_sha)"
log "zip ok"

python3 - "$tmp/abj.zip" "$bin/$net" "$net" <<'PY'
import shutil, sys, zipfile
src, dest, name = sys.argv[1:]
z = zipfile.ZipFile(src)
member = next(n for n in z.namelist() if n.endswith("/" + name))
with z.open(member) as fin, open(dest, "wb") as fout:
    shutil.copyfileobj(fin, fout)
PY
[ "$(sha256 "$bin/$net")" = "$net_sha" ] || die "$net sha256 mismatch (want $net_sha)"
log "$net ok"

# Load it: the binary must report the net and answer a search.
out="$tmp/uci.out"
{
  printf 'uci\nsetoption name EvalFile value %s\nisready\n' "$bin/$net"
  printf 'position fen xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1\ngo depth 3\n'
  i=0
  until grep -q '^bestmove' "$out" 2>/dev/null || [ "$i" -ge 300 ]; do sleep 0.1; i=$((i + 1)); done
  echo quit
} | "$bin/ab-jchess" > "$out"
grep -q 'ABJNNUE model loaded' "$out" || die "ab-jchess did not load $net: $(tail -3 "$out")"
grep -q '^bestmove' "$out" || die "ab-jchess did not answer a search with $net"
log "installed $net into $bin, loaded by ab-jchess"
