import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { build } from 'vite';
import { posthogSourcemaps, removeSourceMaps } from '../apps/web/scripts/posthog-sourcemaps.mjs';
import { runSourceMapCli } from './posthog-sourcemap-cli.mjs';

const SHA = '0123456789012345678901234567890123456789';

async function fixture(t, { fail = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mistboard-sourcemaps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, 'fixture.ts');
  const outDir = join(root, 'dist');
  const captured = join(root, 'private-upload');
  const cli = join(root, 'upload.mjs');
  await mkdir(captured);
  await writeFile(
    entry,
    'export function mappingProbe() {\n  throw new Error("Mistboard source-map check");\n}\nmappingProbe();\n',
  );
  await writeFile(
    cli,
    `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const files = input.trim().split('\\n').filter(Boolean);
await writeFile(${JSON.stringify(join(captured, 'request.json'))}, JSON.stringify({
  args: process.argv.slice(2), project: process.env.POSTHOG_CLI_PROJECT_ID,
  host: process.env.POSTHOG_CLI_HOST
}));
for (const file of files) {
  await writeFile(${JSON.stringify(join(captured, 'fixture.js'))}, await readFile(file));
  await writeFile(${JSON.stringify(join(captured, 'fixture.js.map'))}, await readFile(file + '.map'));
}
process.exit(${fail ? 1 : 0});
`,
    { mode: 0o755 },
  );
  const run = () =>
    build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: posthogSourcemaps({
        command: 'build',
        env: {
          RAILWAY_ENVIRONMENT_NAME: 'production',
          RAILWAY_GIT_COMMIT_SHA: SHA,
          POSTHOG_CLI_API_KEY: 'test-only-upload-key',
        },
        cwd: root,
        cliBinaryPath: cli,
      }),
      build: {
        outDir,
        emptyOutDir: true,
        sourcemap: 'hidden',
        minify: true,
        lib: { entry, name: 'MappingProbe', formats: ['iife'], fileName: () => 'fixture.js' },
      },
    });
  return { root, outDir, captured, run };
}

test('the actual Vite/PostHog build maps a compressed error to its original TS line', async (t) => {
  const f = await fixture(t);
  await f.run();
  const code = await readFile(join(f.outDir, 'fixture.js'), 'utf8');
  const capturedCode = await readFile(join(f.captured, 'fixture.js'), 'utf8');
  const sourceMap = JSON.parse(await readFile(join(f.captured, 'fixture.js.map'), 'utf8'));
  assert.equal(code, capturedCode, 'nothing rewrites the final JS after upload');
  assert.match(code, /chunkId=/);
  assert.match(code, /_posthogChunkIds/);
  assert.doesNotMatch(code, /sourceMappingURL|test-only-upload-key/);
  assert.ok(sourceMap.mappings.length > 0);
  assert.ok(sourceMap.sourcesContent.some((s) => s.includes('mappingProbe')));
  let thrown;
  try {
    vm.runInNewContext(code, {}, { filename: 'fixture.js' });
  } catch (error) {
    thrown = error;
  }
  assert.match(thrown.message, /Mistboard source-map check/);
  const location = /fixture\.js:(\d+):(\d+)/.exec(thrown.stack);
  assert.ok(location, 'the generated stack names its compressed file position');
  const original = originalPositionFor(new TraceMap(sourceMap), {
    line: Number(location[1]),
    column: Number(location[2]) - 1,
  });
  assert.match(original.source, /fixture\.ts$/);
  assert.equal(original.line, 2, 'the mapping identifies the actual throw statement');
  assert.deepEqual(await readdir(f.outDir), ['fixture.js']);
  const request = JSON.parse(await readFile(join(f.captured, 'request.json'), 'utf8'));
  assert.equal(request.project, '413256');
  assert.equal(request.host, 'https://us.posthog.com');
  assert.deepEqual(request.args, [
    'sourcemap',
    'upload',
    '--stdin',
    '--release-name',
    'mistboard-web',
    '--release-version',
    SHA,
  ]);
});

test('a refused upload fails the build and still removes deployable source maps', async (t) => {
  const f = await fixture(t, { fail: true });
  await assert.rejects(f.run());
  assert.deepEqual(await readdir(f.outDir), ['fixture.js']);
});

test('production requires an upload key; dev serving never requires one', () => {
  assert.throws(
    () => posthogSourcemaps({ command: 'build', env: { RAILWAY_ENVIRONMENT_NAME: 'production' } }),
    /requires POSTHOG_CLI_API_KEY/,
  );
  assert.deepEqual(
    posthogSourcemaps({ command: 'serve', env: { RAILWAY_ENVIRONMENT_NAME: 'production' } }),
    [],
  );
});

test('invalid release metadata cannot be attributed to the wrong revision', () => {
  assert.throws(
    () => posthogSourcemaps({ command: 'build', env: { RAILWAY_GIT_COMMIT_SHA: 'main' } }),
    /exact 40-character Git revision/,
  );
});

test('CLI failures cannot echo credentials, and a real upload cannot inherit dry-run mode', () => {
  const messages = [];
  const secret = 'not-a-real-key-for-output-safety-test';
  const status = runSourceMapCli(['sourcemap', 'upload', '--stdin'], {
    env: {
      POSTHOG_CLI_API_KEY: secret,
      POSTHOG_CLI_DRY_RUN: 'true',
      POSTHOG_CLI_DOTENV_FILE: '/do-not-read',
    },
    spawn(_bin, args, options) {
      assert.ok(!args.some((a) => a.includes(secret)));
      assert.equal(options.env.POSTHOG_CLI_DRY_RUN, 'false');
      assert.equal(options.env.POSTHOG_CLI_DOTENV_FILE, undefined);
      return { status: 1, stderr: `HTTP 401 rejected ${secret}`, stdout: secret };
    },
    log: (m) => messages.push(m),
    error: (m) => messages.push(m),
  });
  assert.equal(status, 1);
  assert.deepEqual(messages, ['PostHog source-map upload failed (HTTP 401).']);
});

test('privacy cleanup includes nested CSS maps and leaves regular assets intact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mistboard-map-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested', 'theme.css.map'), '{}');
  await writeFile(join(root, 'nested', 'theme.css'), 'body{}');
  await removeSourceMaps(root);
  assert.deepEqual(await readdir(join(root, 'nested')), ['theme.css']);
});
