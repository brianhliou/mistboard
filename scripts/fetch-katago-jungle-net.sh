#!/bin/sh
# The KataGo-AnimalChess net, fetched from Kouza's Dandelion 4 release at image
# build time.
#
# The b10c384 net (2026-02-28) has no release of its own: it ships inside the
# Dandelion GUI zip (lxsgx23/Dandelion-Chess v4.0, 198 MB). hzyhhzy agreed to the
# site running his engine with it (hzyhhzy/KataGomo#12), and we never put the net
# in a release or repo of ours, so this downloads the zip, checks its sha256,
# extracts the one net (byte-identical to the one the #434 matches ran,
# checked 2026-10-02), checks that sha256, deletes the zip, and plays a move with
# the fetched binary before the image is kept.
#
# A script, not an inline railpack command: railpack cuts inline commands at
# their first single quote (2026-09-30, fetch-abjchess-net.sh).
#
# Usage: scripts/fetch-katago-jungle-net.sh <bindir> <gtp config>
#        (needs <bindir>/katago-jungle; the config is apps/server/src/katago-jungle-gtp.cfg)
set -eu

bin=${1:?bindir}
cfg=${2:?gtp config}
url=https://github.com/lxsgx23/Dandelion-Chess/releases/download/v4.0/Dandelion.4.zip
zip_sha=1ca0a0c0916819ebad47ae14c5e17807d59fc60665710110a970ddb7c55e23ab
# The zip holds two nets named b10c384nbt.bin.gz; the one under resource/engine/
# is the current one (resource/others/weights_old/ is the 2025 net).
member=/resource/engine/b10c384nbt.bin.gz
net=katago-jungle-net.bin.gz
net_sha=8cb07eff56893f1d93115cbbc7925a0f97c80343af5bd6022812f07eee6b2b20

log() { echo "katago-jungle-net: $*"; }
die() { echo "katago-jungle-net: $*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

test -x "$bin/katago-jungle" || die "$bin/katago-jungle is missing; fetch the engines first"
test -s "$cfg" || die "$cfg is missing"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$tmp/dandelion.zip" "$url" || die "download failed: $url"
[ "$(sha256 "$tmp/dandelion.zip")" = "$zip_sha" ] || die "zip sha256 mismatch (want $zip_sha)"
log "zip ok"

python3 - "$tmp/dandelion.zip" "$bin/$net" "$member" <<'PY'
import shutil, sys, zipfile
src, dest, suffix = sys.argv[1:]
z = zipfile.ZipFile(src)
members = [n for n in z.namelist() if n.endswith(suffix)]
if len(members) != 1:
    sys.exit(f"expected one {suffix} in the zip, found {len(members)}")
with z.open(members[0]) as fin, open(dest, "wb") as fout:
    shutil.copyfileobj(fin, fout)
PY
[ "$(sha256 "$bin/$net")" = "$net_sha" ] || die "$net sha256 mismatch (want $net_sha)"
rm -f "$tmp/dandelion.zip"
log "$net ok"

# Load it and play the opening move at a toy budget: two vertex replies (the
# move is two-stage), and the binary must report the net it loaded.
printf 'kata-set-param maxVisits 64\nsetfen l5t/1d3c1/r1j1w1e/7/7/7/E1W1J1R/1C3D1/T5L w\ngenmove b\ngenmove b\nquit\n' |
  "$bin/katago-jungle" gtp -model "$bin/$net" -config "$cfg" > "$tmp/gtp.out" 2> "$tmp/gtp.err" ||
  die "katago-jungle exited non-zero: $(tail -3 "$tmp/gtp.err")"
grep -q 'Loaded model' "$tmp/gtp.err" || die "katago-jungle did not load $net: $(tail -3 "$tmp/gtp.err")"
[ "$(grep -c '^= [A-G][1-9]$' "$tmp/gtp.out")" -eq 2 ] ||
  die "katago-jungle did not answer a two-stage move: $(cat "$tmp/gtp.out")"
log "installed $net into $bin, loaded by katago-jungle"
