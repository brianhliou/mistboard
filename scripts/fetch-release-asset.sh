#!/bin/sh
# Our own engines (and the flip-jungle tablebase), fetched from their repos'
# GitHub releases at image build time and checked against a sha256 pinned here.
#
# The pin lives in this repo, not beside the asset: a .sha256 file in the same
# release catches a truncated download but not a replaced asset. Bumping a
# version means changing the tag and the sha below in the same commit (the
# digest is on the release page, or `gh release view <tag> -R <repo> --json assets`).
#
# Usage: scripts/fetch-release-asset.sh <bindir> <name>
set -eu

bin=${1:?bindir}
name=${2:?asset name}

# name -> repo, tag, sha256, mode (exec: an executable; data: a non-empty file)
case "$name" in
  banqi-engine)
    repo=brianhliou/misty-banqi tag=v0.2.5 mode=exec
    sha=ef93e42111d9616c88ea6d48eff81ff61d419bd208f2047b9fcc3da1d80809b0 ;;
  jungle-flip-engine)
    repo=brianhliou/misty-flip-jungle tag=v0.5.1 mode=exec
    sha=56952ea87ee9465a55b70f2159ed83048a6235dd469a757bd1931ddd69d82a44 ;;
  jungle_flip_tb_4.bin)
    repo=brianhliou/misty-flip-jungle tag=v0.5.1 mode=data
    sha=65b275f494048ec41be1db48836f167e315859e9c3c317ee66d7751a27cc9eba ;;
  jungle-engine)
    repo=brianhliou/misty-jungle tag=v0.0.6 mode=exec
    sha=0e7a4e18418be3a813a2eac5fe04b055af74e1da922d3fa666d99253fbac4423 ;;
  *)
    echo "release-asset: unknown asset $name" >&2
    exit 1 ;;
esac

die() { echo "release-asset: $name: $*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

url=https://github.com/$repo/releases/download/$tag/$name
mkdir -p "$bin"
tmp="$bin/.$name.part"
trap 'rm -f "$tmp"' EXIT

curl -fsSL --proto =https --tlsv1.2 --retry 3 -o "$tmp" "$url" || die "download failed: $url"
got=$(sha256 "$tmp")
[ "$got" = "$sha" ] || die "sha256 mismatch for $url (want $sha, got $got)"
mv "$tmp" "$bin/$name"
if [ "$mode" = exec ]; then
  chmod +x "$bin/$name"
  test -x "$bin/$name" || die "$bin/$name is not executable"
else
  test -s "$bin/$name" || die "$bin/$name is empty"
fi
echo "$name-fetched-$tag-sha256-ok"
