// scripts/fetch-abjchess-net.sh soft-fails on the upstream: a download that
// fails, or a zip or net whose sha256 does not match, warns and exits 0 with no
// net installed, so the image still builds and every web deploy is not hostage
// to the authors' release. These run the real script with `curl` stubbed on
// PATH, so no network is touched.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(repoRoot, 'scripts/fetch-abjchess-net.sh');
const scriptText = readFileSync(scriptPath, 'utf8');
const NET = scriptText.match(/^net=(\S+)$/m)?.[1];

// A curl that writes $FAKE_CURL_SRC to its -o target, or fails like a 404 (exit
// 22) when no source is set.
const FAKE_CURL = `#!/bin/sh
out=
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out=$2; shift; fi
  shift
done
[ -n "\${FAKE_CURL_SRC:-}" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "$FAKE_CURL_SRC" "$out"
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'abjchess-net-test-'));
  const stubs = join(dir, 'stubs');
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', stubs, bin]);
  writeFileSync(join(stubs, 'curl'), FAKE_CURL);
  chmodSync(join(stubs, 'curl'), 0o755);
  return { dir, stubs, bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runScript(script, { stubs, bin }, env = {}) {
  return spawnSync('sh', [script, bin], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, ...env },
  });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertSkipped(result, bin, cause) {
  assert.equal(result.status, 0, `exit 0 so the build continues; stderr: ${result.stderr}`);
  assert.match(result.stderr, /abjchess-net: WARNING: /);
  assert.match(result.stderr, cause);
  assert.match(result.stderr, /building WITHOUT .*slot stays hidden/);
  assert.equal(existsSync(join(bin, NET)), false, 'no net is installed');
}

test('the script names its net', () => {
  assert.ok(NET?.endsWith('.nnue'), 'net=<file>.nnue is declared on one line');
});

test('a failed download warns and exits 0 without a net', (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  assertSkipped(runScript(scriptPath, box), box.bin, /download failed: https:\/\//);
});

test('a zip whose sha256 does not match warns and exits 0 without a net', (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const junk = join(box.dir, 'junk.zip');
  writeFileSync(junk, 'not the authors zip');
  assertSkipped(
    runScript(scriptPath, box, { FAKE_CURL_SRC: junk }),
    box.bin,
    /zip sha256 mismatch/,
  );
});

// The zip checksum is pinned, so to reach the net checksum this runs a copy of
// the script pinned to a zip we built, holding a net with the wrong bytes.
test('a net whose sha256 does not match is never installed', (t) => {
  const box = sandbox();
  t.after(box.cleanup);
  const zip = join(box.dir, 'forged.zip');
  execFileSync('python3', [
    '-c',
    'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w") as z: z.writestr("0.2b/" + sys.argv[2], b"forged")',
    zip,
    NET,
  ]);
  const pinned = join(box.dir, 'fetch.sh');
  writeFileSync(pinned, scriptText.replace(/^zip_sha=[0-9a-f]{64}$/m, `zip_sha=${sha256(zip)}`));
  assertSkipped(
    runScript(pinned, box, { FAKE_CURL_SRC: zip }),
    box.bin,
    new RegExp(`${NET.replace(/\./g, '\\.')} sha256 mismatch`),
  );
});
