import { promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vitest/config';
import { INCLUDE_DEV_PUBLIC_ARTIFACTS_ENV, shouldCopyPublicAsset } from './src/public-assets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_API_URL = process.env.MISTBOARD_DEV_API_URL ?? 'http://localhost:3001';
const FEEDBACK_FILE = resolve(
  __dirname,
  '..',
  '..',
  'research',
  'python-fow-lab',
  'feedback',
  'annotations.jsonl',
);

function devWebSocketUrlForApiUrl(apiUrl: string): string | null {
  try {
    const url = new URL(apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function annotationsApiPlugin(): Plugin {
  return {
    name: 'mistboard-annotations-api',
    configureServer(server) {
      server.middlewares.use('/api/annotations', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const text = await fs.readFile(FEEDBACK_FILE, 'utf-8').catch(() => '');
            const items = text
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line) => JSON.parse(line));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ annotations: items, file: FEEDBACK_FILE }));
            return;
          }
          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks).toString('utf-8');
            const data = JSON.parse(body);
            await fs.mkdir(dirname(FEEDBACK_FILE), { recursive: true });
            await fs.appendFile(FEEDBACK_FILE, `${JSON.stringify(data)}\n`, 'utf-8');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.method === 'PUT') {
            // Update an existing annotation by `id`. Re-write the file with
            // the matching row replaced; if no match, append.
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks).toString('utf-8');
            const updated = JSON.parse(body);
            if (typeof updated.id !== 'string') {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'missing_id' }));
              return;
            }
            const existing = await fs.readFile(FEEDBACK_FILE, 'utf-8').catch(() => '');
            const lines = existing.split('\n').filter((l) => l.trim().length > 0);
            let replaced = false;
            const nextLines = lines.map((line) => {
              const row = JSON.parse(line);
              if (row.id === updated.id) {
                replaced = true;
                return JSON.stringify(updated);
              }
              return line;
            });
            if (!replaced) nextLines.push(JSON.stringify(updated));
            await fs.mkdir(dirname(FEEDBACK_FILE), { recursive: true });
            await fs.writeFile(FEEDBACK_FILE, `${nextLines.join('\n')}\n`, 'utf-8');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, updated: replaced, appended: !replaced }));
            return;
          }
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}

function devApiProxyPlugin(): Plugin {
  return {
    name: 'mistboard-dev-api-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next();
          return;
        }
        if (req.url.startsWith('/api/annotations')) {
          next();
          return;
        }
        const target = new URL(req.url, DEV_API_URL);
        const transport = target.protocol === 'https:' ? https : http;
        const proxyReq = transport.request(
          target,
          {
            method: req.method,
            headers: {
              ...req.headers,
              host: target.host,
            },
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on('error', () => {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'dev_api_proxy_failed' }));
        });
        req.pipe(proxyReq);
      });
    },
  };
}

function copyFilteredPublicDirPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'mistboard-filtered-public-dir',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async writeBundle() {
      const publicDir = resolvedConfig.publicDir;
      if (!publicDir) return;

      const outDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const includeDevPublicArtifacts = process.env[INCLUDE_DEV_PUBLIC_ARTIFACTS_ENV] === '1';
      await fs.cp(publicDir, outDir, {
        recursive: true,
        dereference: false,
        filter: (src) => {
          const publicRelativePath = relative(publicDir, src);
          return shouldCopyPublicAsset(publicRelativePath, includeDevPublicArtifacts);
        },
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const derivedDevWebSocketUrl =
    command === 'serve' && !process.env.VITE_MISTBOARD_WS_URL && process.env.MISTBOARD_DEV_API_URL
      ? devWebSocketUrlForApiUrl(DEV_API_URL)
      : null;

  return {
    plugins: [annotationsApiPlugin(), devApiProxyPlugin(), copyFilteredPublicDirPlugin()],
    // Cross-origin isolate the dev server so the review board's local engine
    // (Fairy-Stockfish WASM) can allocate a SharedArrayBuffer. `credentialless`
    // keeps cross-origin subresources loading without needing CORP. In prod the
    // server scopes the same headers to the analysis routes (see server-http.ts).
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    build: {
      copyPublicDir: false,
      // Emitted to dist/.vite/manifest.json; the prerender step reads it to bake
      // route-chunk CSS + modulepreload links into the prerendered pages, so
      // their first paint is fully styled (no FOUC before the JS chunks land).
      manifest: true,
    },
    ...(derivedDevWebSocketUrl
      ? {
          define: {
            'import.meta.env.VITE_MISTBOARD_WS_URL': JSON.stringify(derivedDevWebSocketUrl),
          },
        }
      : {}),
    test: {
      environment: 'happy-dom',
      // Above vitest's 5s default. A test that opens with `await import()` is
      // charged the whole cold module graph, and the heavy ones cost ~850ms on
      // an idle machine; across 260+ files on parallel workers that blew the
      // 5s budget and failed a release, while the same file passed alone and
      // on a warm rerun. The files that use vi.doMock + vi.resetModules cannot
      // avoid importing per test, so the budget is the only lever for them.
      // Kept at 15s, not higher, so a genuinely hung test still fails fast.
      testTimeout: 15_000,
      include: ['src/**/*.test.ts'],
    },
  };
});
