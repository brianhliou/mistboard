# Pikafish jieqi NNUE WebAssembly

Pikafish's official `jieqi` NNUE branch with chance-node reveal search
(`ChanceMix`, on by default) for the jieqi bots and browser analysis.

- Source: https://github.com/brianhliou/pikafish-jieqi-wasm/tree/jieqi-mistboard
- Commit: `fd1a6f825ebfd57dc2994ea9ee0d9f5408e49d83`
- Toolchain: `emscripten/emsdk:3.1.74`
- Engine license: GPL-3.0-or-later (`COPYING.txt`)
- Embedded 256-wide net: trained from random initialization on
  [jqe](https://github.com/devinokeefe/jieqi) labels, with no Pikafish weights;
  MIT licensed (`jieqi-net-LICENSE`)

The complete corresponding source is `pikajieqi-source-fd1a6f82.tar.gz`,
including the embedded net, its license and the offline Python 3 embedding tools.
Earlier source archives are retained for earlier distributed builds.

Extract the current archive, then run from its root:

```sh
docker run --rm --platform linux/amd64 -v "$PWD:/work" -w /work \
  emscripten/emsdk:3.1.74 bash ./wasm/build.sh
```

The output is in `dist/wasm/`. No net download is needed. Serve `pikajieqi.js`,
`pikajieqi.wasm`, `COPYING.txt`, and `jieqi-net-LICENSE` together.

`worker.js` creates one persistent UCI module in a dedicated worker. The generated
`pikajieqi.js` is also its pthread entry point: `mainScriptUrlOrBlob` must point
to that generated JS URL, including the asset version. Keep the default one
search thread when calling from the worker event loop. The document requires
cross-origin isolation (COOP `same-origin`, COEP `require-corp`).
