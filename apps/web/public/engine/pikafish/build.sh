#!/usr/bin/env bash
# Browser build of Pikafish with source.patch + pikafish-cc0-net.patch.
# Flags follow src/Makefile's wasm32 arch (emcc's x86 compatibility layer
# + SIMD128, pthreads, sloppy atomics); the
# link flags add the Emscripten module shape our worker.js expects.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
src_dir="$repo_root/src"
out_dir="${1:-$repo_root/dist/wasm}"

# Refuse to build an upstream checkout that lacks the CC0 evaluation patch.
grep -q '^#define EvalFileDefaultName "xiangqi-c07e94a5c7cb.nnue"' "$src_dir/evaluate.h" || {
  echo 'Apply source.patch and pikafish-cc0-net.patch before building' >&2
  exit 1
}

grep -q 'void pikafish_initialize()' "$src_dir/main.cpp" || {
  echo 'Apply source.patch before building' >&2
  exit 1
}

mkdir -p "$out_dir"

# Match the patched Makefile's SRCS: the previous feature implementations
# remain in the checkout but are incompatible with the CC0 evaluation code.
source_paths=()
while IFS= read -r source_path; do
  source_paths+=("$source_path")
done < <(find "$src_dir" -name '*.cpp' \
  -not -path '*/universal/*' -not -path '*/temp_builds/*' \
  -not -path '*/nnue/features/full_threats.cpp' \
  -not -path '*/nnue/features/half_ka_v2_hm.cpp' | sort)

em++ \
  "${source_paths[@]}" \
  -I"$src_dir" \
  -std=c++17 \
  -O3 -funroll-loops \
  -DNDEBUG \
  -DIS_64BIT \
  -DNO_PREFETCH \
  -DUSE_POPCNT \
  -DUSE_SSE2 -msse2 \
  -DUSE_SSSE3 -mssse3 \
  -DUSE_SSE41 -msse4.1 \
  -DUSE_SLOPPY_ATOMICS \
  -msimd128 \
  -pthread \
  -fno-exceptions \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=Pikafish \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS=_pikafish_initialize,_pikafish_command,_main,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,FS \
  -sINITIAL_MEMORY=256MB \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=1GB \
  -sSTACK_SIZE=3MB \
  -sPTHREAD_POOL_SIZE=8 \
  -sPTHREAD_POOL_SIZE_STRICT=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sINVOKE_RUN=0 \
  -o "$out_dir/pikafish.js"

cp "$repo_root/Copying.txt" "$out_dir/COPYING.txt"
# Keep the complete source changes beside the GPL engine assets.
cp "$(dirname "${BASH_SOURCE[0]}")/source.patch" "$out_dir/source.patch"
cp "$(dirname "${BASH_SOURCE[0]}")/pikafish-cc0-net.patch" "$out_dir/pikafish-cc0-net.patch"
