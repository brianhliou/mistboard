#!/usr/bin/env bash
# Compile AB-JChess to WebAssembly: the pthreads build the browser analysis
# board runs (apps/web/public/engine/ab-jchess/). Runs inside
# emscripten/emsdk:3.1.74 from the root of an AB-JChess efc83867 tree with
# ab-jchess-wasm-entry.patch applied. The source archive served beside the
# engine ships this file as wasm/build.sh; from the archive's root:
#
#   docker run --rm --platform linux/amd64 -v "$PWD:/work" -w /work \
#     emscripten/emsdk:3.1.74 bash ./wasm/build.sh
#
# Output: dist/wasm/abjchess.js and dist/wasm/abjchess.wasm. The net is not
# embedded; the page writes abjchess-20261030.nnue into the module filesystem
# before the first abj_command call.
set -euo pipefail
src=abjchess/src
# isa/tiers.sh ENGINE_FILES, without main.cpp (the patch adds abj_command).
files=(tables position eval nnue_small hnnue search uci selfplay bitboard position_ref)
srcs=()
for f in "${files[@]}"; do srcs+=("$src/$f.cpp"); done

# -msse2: the engine's SSE2 kernel through emscripten's SIMD128 headers.
# -pthread: search runs on its own thread, as natively, so `go infinite`
# streams and `stop` interrupts it. Needs a cross-origin isolated page.
mkdir -p dist/wasm
em++ "${srcs[@]}" \
  -std=c++20 -O3 -DNDEBUG -I"$src" -ffp-contract=off -include nobmi.h -flto \
  -msimd128 -msse2 -pthread -DABJ_TIER_NAME='"wasm"' \
  -sMODULARIZE=1 -sEXPORT_NAME=ABJChess -sENVIRONMENT=web,worker,node --no-entry \
  -sEXPORTED_FUNCTIONS=_abj_command -sEXPORTED_RUNTIME_METHODS=cwrap,FS \
  -sINITIAL_MEMORY=128MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB \
  -sSTACK_SIZE=8MB -sFILESYSTEM=1 \
  -pthread -sPTHREAD_POOL_SIZE=2 -sDEFAULT_PTHREAD_STACK_SIZE=8MB \
  -o dist/wasm/abjchess.js
em++ --version | head -1
ls -l dist/wasm
