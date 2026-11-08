// Run the real fetcher offline with curl on PATH. Only synthetic credentials
// enter the sandbox; the planted curl logs its argv and entire child env.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts/fetch-private-net.sh');
const scriptText = readFileSync(scriptPath, 'utf8');
const NETS = [
  {
    NAME: 'three-kingdoms-banqi-net',
    TAG: 'tk-v17q',
    ASSET: 'three-kingdoms-banqi-v17q.tknn',
    NET: 'three-kingdoms-banqi.tknn',
    SHA: 'a8b5b75a89320691ef0635af1640858d41d2d93e6c5e6ec8a93cf24e37b68446',
  },
  {
    NAME: 'banqi-net',
    TAG: 'banqi-iter14',
    ASSET: 'banqi-iter14.bqnn',
    NET: 'banqi.bqnn',
    SHA: '03e7052b0c5178bd1a683bc38ec9a9f0c41177367b6891f8e697dd95876e413e',
  },
];
for (const { NAME, TAG, ASSET, NET, SHA } of NETS) {
  const TOKEN = 'synthetic-private-net-token-for-leak-test';
  const FIXTURE = Buffer.from('test-only private net bytes\n');
  const API = 'https://api.github.com/repos/brianhliou/mistboard-nets/releases';

  const FAKE_CURL = `#!/usr/bin/env python3
import json, os, pathlib, stat, sys
args = sys.argv[1:]
headers = [args[i + 1] for i, arg in enumerate(args) if arg == "-H"]
auth_path = next(h[1:] for h in headers if h.startswith("@"))
auth = pathlib.Path(auth_path)
request = {
    "argv": args, "env": dict(os.environ), "url": args[-1],
    "headers": headers, "authPath": auth_path,
    "authMode": stat.S_IMODE(auth.stat().st_mode),
    "authValid": auth.read_text() == "Authorization: Bearer ${TOKEN}\\n",
}
with open(os.environ["FAKE_CURL_LOG"], "a") as log:
    log.write(json.dumps(request) + "\\n")
# Plant noisy diagnostics too: none may expose credentials through the fetcher.
print(json.dumps({"argv": args, "env": dict(os.environ)}))
print(json.dumps({"argv": args, "env": dict(os.environ)}), file=sys.stderr)
lookup = "/tags/" in args[-1]
if os.environ.get("FAKE_CURL_FAIL") == ("lookup" if lookup else "download"):
    sys.exit(22)
out = pathlib.Path(args[args.index("-o") + 1])
source = "FAKE_RELEASE" if lookup else "FAKE_NET"
out.write_bytes(pathlib.Path(os.environ[source]).read_bytes())
`;

  function sandbox(t) {
    const dir = mkdtempSync(join(tmpdir(), 'private-net-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const stubs = join(dir, 'stubs');
    const bin = join(dir, 'bin');
    mkdirSync(stubs);
    mkdirSync(bin);
    writeFileSync(join(stubs, 'curl'), FAKE_CURL, { mode: 0o755 });
    const release = join(dir, 'release.json');
    writeFileSync(
      release,
      JSON.stringify({
        assets: [
          { name: 'decoy', id: 1 },
          { name: ASSET, id: 4242 },
        ],
      }),
    );
    const net = join(dir, 'fixture.tknn');
    writeFileSync(net, FIXTURE);
    const log = join(dir, 'curl.jsonl');
    const pinned = join(dir, 'fetch.sh');
    assert.equal(scriptText.split(`sha=${SHA}`).length, 2, 'exactly one production digest');
    writeFileSync(
      pinned,
      scriptText.replace(`sha=${SHA}`, `sha=${createHash('sha256').update(FIXTURE).digest('hex')}`),
    );
    return { dir, stubs, bin, release, net, log, pinned };
  }

  function runScript(box, { script = scriptPath, name = NAME, ...env } = {}) {
    // Do not inherit the operator's environment: the curl stub records all of it.
    return spawnSync('sh', [script, box.bin, name], {
      encoding: 'utf8',
      env: {
        PATH: `${box.stubs}:${process.env.PATH}`,
        MISTBOARD_PRIVATE_ASSETS_TOKEN: TOKEN,
        FAKE_CURL_LOG: box.log,
        FAKE_RELEASE: box.release,
        FAKE_NET: box.net,
        ...env,
      },
    });
  }

  function requests(box) {
    return existsSync(box.log)
      ? readFileSync(box.log, 'utf8').trim().split('\n').map(JSON.parse)
      : [];
  }

  function assertTokenAbsent(result, box) {
    for (const output of [result.stdout, result.stderr, JSON.stringify(requests(box))]) {
      assert.equal(output.includes(TOKEN), false, 'token absent from output, argv and child env');
    }
  }

  function assertSkipped(result, box, cause) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /private-net: WARNING:/);
    assert.ok(result.stderr.includes(ASSET), 'warning names the release asset');
    assert.match(result.stderr, cause);
    assert.match(result.stderr, /building WITHOUT .*L8 stays hidden/);
    assert.deepEqual(readdirSync(box.bin), [], 'no net or temporary auth files remain');
    assertTokenAbsent(result, box);
  }

  test('verified bytes install under the server filename with the success marker', (t) => {
    const box = sandbox(t);
    const result = runScript(box, { script: box.pinned });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${NAME}-fetched-${TAG}-sha256-ok`);
    assert.equal(result.stderr, '');
    assert.deepEqual(readFileSync(join(box.bin, NET)), FIXTURE);
    assert.deepEqual(readdirSync(box.bin), [NET], 'temporary header directory removed');
    const calls = requests(box);
    assert.deepEqual(
      calls.map((call) => call.url),
      [`${API}/tags/${TAG}`, `${API}/assets/4242`],
    );
    assert.ok(calls[0].headers.includes('Accept: application/vnd.github+json'));
    assert.ok(calls[1].headers.includes('Accept: application/octet-stream'));
    for (const call of calls) {
      assert.equal(call.authMode, 0o600, 'auth header is owner-only');
      assert.equal(call.authValid, true, 'curl receives the bearer header through a file');
      assert.equal(existsSync(call.authPath), false, 'header removed on exit');
      assert.equal(call.argv[0], '-q', 'ignore user curl config');
      assert.ok(!call.argv.includes('--location-trusted'), 'no auth forwarding across hosts');
    }
    assertTokenAbsent(result, box);
  });

  test('a missing token soft-fails before calling curl', (t) => {
    const box = sandbox(t);
    assertSkipped(
      runScript(box, { MISTBOARD_PRIVATE_ASSETS_TOKEN: '' }),
      box,
      /missing MISTBOARD_PRIVATE_ASSETS_TOKEN/,
    );
    assert.deepEqual(requests(box), []);
  });

  for (const stage of ['lookup', 'download']) {
    test(`a failed ${stage} soft-fails and removes partial downloads and auth`, (t) => {
      const box = sandbox(t);
      assertSkipped(
        runScript(box, { FAKE_CURL_FAIL: stage }),
        box,
        /lookup failed|download failed/,
      );
      assert.equal(requests(box).length, stage === 'lookup' ? 1 : 2);
    });
  }

  test('a sha256 mismatch never installs the downloaded bytes', (t) => {
    const box = sandbox(t);
    // Use the unchanged production pin against intentionally wrong bytes.
    assertSkipped(runScript(box), box, /sha256 mismatch/);
    assert.equal(requests(box).length, 2);
  });

  test('an empty asset soft-fails even when its digest is pinned', (t) => {
    const box = sandbox(t);
    writeFileSync(box.net, '');
    writeFileSync(
      box.pinned,
      scriptText.replace(`sha=${SHA}`, `sha=${createHash('sha256').update('').digest('hex')}`),
    );
    assertSkipped(runScript(box, { script: box.pinned }), box, /download is empty/);
  });

  for (const release of [
    'invalid JSON',
    '{"assets":[]}',
    `{"assets":[{"name":"${ASSET}","id":"bad/id"}]} `,
  ]) {
    test(`invalid release metadata soft-fails: ${release}`, (t) => {
      const box = sandbox(t);
      writeFileSync(box.release, release);
      assertSkipped(runScript(box), box, /release asset lookup failed/);
      assert.equal(requests(box).length, 1, 'no download with an unvalidated asset id');
    });
  }

  test('the planted logger detects a token inherited by curl', (t) => {
    const box = sandbox(t);
    // Negative control: the leak assertion must reject a fetcher missing the unset.
    writeFileSync(box.pinned, scriptText.replace('unset MISTBOARD_PRIVATE_ASSETS_TOKEN', ':'));
    const result = runScript(box, { script: box.pinned });
    assert.equal(result.status, 0);
    assert.ok(requests(box).length > 0);
    assert.throws(() => assertTokenAbsent(result, box), /token absent/);
  });

  test(`Railpack fetches pinned ${NAME} next to the TK engine/net`, () => {
    const railpack = JSON.parse(readFileSync(join(repoRoot, 'railpack.json'), 'utf8'));
    assert.equal(railpack.packages.python, '3.11', 'asset lookup has python3 in the build image');
    const commands = railpack.steps.build.commands;
    const engine = commands.indexOf(
      'sh /app/scripts/fetch-release-asset.sh /app/bin three-kingdoms-engine',
    );
    assert.ok(engine >= 0);
    assert.equal(
      commands[engine + (NAME === 'banqi-net' ? 2 : 1)],
      `sh /app/scripts/fetch-private-net.sh /app/bin ${NAME}`,
    );
    const pin = scriptText.match(new RegExp(`^  ${NAME}\\)\\n([\\s\\S]*?);;`, 'm'))?.[1];
    assert.ok(pin, 'Railpack names a known pin');
    assert.ok(pin.includes(`repo=brianhliou/mistboard-nets tag=${TAG}`));
    assert.ok(pin.includes(`asset=${ASSET}`));
    assert.ok(pin.includes(`sha=${SHA}`));
    assert.ok(pin.includes(`net=${NET}`));
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['test:tooling'].includes('node --test scripts/*.test.mjs'));
  });
}
