#!/bin/sh
# Private nets fetched from GitHub releases at image build time, never re-hosted
# publicly. Pins live here, separately from the release assets.
# Prod sets MISTBOARD_THREE_KINGDOMS_BANQI_NET=/app/bin/three-kingdoms-banqi.tknn;
# MISTBOARD_BANQI_NET=/app/bin/banqi.bqnn; and
# MISTBOARD_JUNGLE_FLIP_NET=/app/bin/jungle-flip.jfnn. The server has no
# default paths: each L8 stays hidden without its net.
#
# Missing credentials, upstream failures and checksum mismatches warn and exit 0
# so a net outage never blocks the web deploy. Only verified, non-empty bytes
# move into <bindir>. MISTBOARD_PRIVATE_ASSETS_TOKEN needs read access to
# brianhliou/mistboard-nets. Pikafish uses a separate public CC0 download.
# The token goes through a mode-600 header file, never curl argv or child env;
# the temporary directory and header are removed on exit. Never enable tracing.
#
# Keep this a script: railpack cuts inline commands at their first single quote.
# Usage: scripts/fetch-private-net.sh <bindir> <name>
set -eu

bin=${1:?bindir}
name=${2:?asset name}
nets_token=${MISTBOARD_PRIVATE_ASSETS_TOKEN:-}
unset MISTBOARD_PRIVATE_ASSETS_TOKEN

# name -> repo, tag, release asset, sha256, installed filename
case "$name" in
  jungle-flip-net)
    repo=brianhliou/mistboard-nets tag=jungle-flip-r6
    asset=jungle-flip-r6.jfnn
    sha=b9a51b57f19f34cea8c88694282ee161ec32b9ffa22ed13bc20c64abf50f9b80
    net=jungle-flip.jfnn ;;
  banqi-net)
    repo=brianhliou/mistboard-nets tag=banqi-iter14
    asset=banqi-iter14.bqnn
    sha=03e7052b0c5178bd1a683bc38ec9a9f0c41177367b6891f8e697dd95876e413e
    net=banqi.bqnn ;;
  three-kingdoms-banqi-net)
    repo=brianhliou/mistboard-nets tag=tk-v17q
    asset=three-kingdoms-banqi-v17q.tknn
    sha=a8b5b75a89320691ef0635af1640858d41d2d93e6c5e6ec8a93cf24e37b68446
    net=three-kingdoms-banqi.tknn ;;
  *)
    echo "private-net: unknown asset $name" >&2
    exit 1 ;;
esac

skip() {
  echo "private-net: WARNING: $asset: $*" >&2
  echo "private-net: WARNING: building WITHOUT $net; L8 stays hidden until a build fetches it" >&2
  exit 0
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

[ -n "$nets_token" ] || skip "missing MISTBOARD_PRIVATE_ASSETS_TOKEN"
umask 077
mkdir -p "$bin" || skip "cannot create bindir"
tmp=$(mktemp -d "$bin/.private-net.XXXXXX") || skip "cannot create temporary directory"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
printf 'Authorization: Bearer %s\n' "$nets_token" > "$tmp/auth.header"
unset nets_token

# Disable curl's user config, keep diagnostics bounded to our own warnings, and
# follow GitHub's asset redirect without forwarding authorization to other hosts.
fetch() {
  curl -q -fsSL --proto =https --proto-redir =https --tlsv1.2 --retry 3 \
    --connect-timeout 15 --max-time 120 -H "@$tmp/auth.header" \
    -H "Accept: $1" -o "$2" "$3" >/dev/null 2>&1
}

api=https://api.github.com/repos/$repo/releases
fetch application/vnd.github+json "$tmp/release.json" "$api/tags/$tag" || skip "release lookup failed"
# Railpack installs Python 3.11; no jq dependency. Validate the id before using
# it in the download URL, and fail closed on absent assets or malformed JSON.
asset_id=$(python3 -c '
import json, sys
with open(sys.argv[1]) as source:
    release = json.load(source)
asset_id = next(a["id"] for a in release["assets"] if a["name"] == sys.argv[2])
assert type(asset_id) is int and asset_id > 0
print(asset_id)
' "$tmp/release.json" "$asset" 2>/dev/null) || skip "release asset lookup failed"
fetch application/octet-stream "$tmp/net" "$api/assets/$asset_id" || skip "download failed"
test -s "$tmp/net" || skip "download is empty"
[ "$(sha256 "$tmp/net")" = "$sha" ] || skip "sha256 mismatch"
chmod 644 "$tmp/net"
mv "$tmp/net" "$bin/$net"
echo "$name-fetched-$tag-sha256-ok"
