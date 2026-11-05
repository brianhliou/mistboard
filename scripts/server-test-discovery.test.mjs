import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkServerTestDiscovery, serverTestGlobs } from './server-test-discovery.mjs';

function fixture(t, scripts, files) {
  const dir = mkdtempSync(join(tmpdir(), 'server-test-discovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  for (const file of files) {
    // Deliberately invalid test bodies: discovery must inspect paths without
    // loading tests, building packages, opening sockets, or connecting to a DB.
    for (const name of [file, file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js')]) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), 'THIS FIXTURE MUST NEVER EXECUTE');
    }
  }
  return dir;
}

// Verbatim scripts from a962178^: the route regression existed on disk but
// was invisible to all three gates. Updating only one gate is insufficient.
const beforeA962178 = {
  test: 'tsc -p tsconfig.json && node --test --test-concurrency=8 dist/*.test.js dist/variant-tenant/*.test.js',
  'test:persistent':
    'tsc -p tsconfig.json && node --test --test-concurrency=1 dist/*.test.js dist/variant-tenant/*.test.js',
  'test:unit':
    "tsx --test --test-concurrency=4 src/*.test.ts src/variant-tenant/*.test.ts --test-name-pattern='^(?!persistence)'",
};

test('a962178 fixture: missing routes fail, adding the directory to every runner passes', (t) => {
  const scripts = { ...beforeA962178 };
  const dir = fixture(t, scripts, ['src/root.test.ts', 'src/routes/jieqi-games.test.ts']);
  assert.deepEqual(
    checkServerTestDiscovery(dir).issues.sort(),
    [
      'test: src/routes/jieqi-games.test.ts is outside every configured test glob',
      'test:persistent: src/routes/jieqi-games.test.ts is outside every configured test glob',
      'test:unit: src/routes/jieqi-games.test.ts is outside every configured test glob',
    ].sort(),
  );

  scripts['test:unit'] += ' src/routes/*.test.ts';
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  assert.equal(checkServerTestDiscovery(dir).issues.length, 2, 'compiled gates still omit routes');
  scripts.test += ' dist/routes/*.test.js';
  scripts['test:persistent'] += ' dist/routes/*.test.js';
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  assert.deepEqual(checkServerTestDiscovery(dir).issues, []);
});

test('4d853ef fixture: the missing engine-protocol unit glob fails the same check', (t) => {
  const scripts = {
    // test:unit from 4d853ef^; compiled scripts never included this directory.
    'test:unit':
      // biome-ignore lint/suspicious/noTemplateCurlyInString: verbatim POSIX shell parameter expansion from the historical runner
      "tsx --test ${MISTBOARD_TEST_SHARD:+--test-shard=$MISTBOARD_TEST_SHARD} --test-concurrency=4 src/*.test.ts src/variant-tenant/*.test.ts src/routes/*.test.ts src/bot-match/*.test.ts src/study-curator/*.test.ts --test-name-pattern='^(?!persistence)'",
    test: 'tsc -p tsconfig.json && node --test --test-concurrency=8 dist/*.test.js dist/variant-tenant/*.test.js dist/routes/*.test.js dist/bot-match/*.test.js',
    'test:persistent':
      'tsc -p tsconfig.json && node --test --test-concurrency=1 dist/*.test.js dist/variant-tenant/*.test.js dist/routes/*.test.js dist/bot-match/*.test.js',
  };
  const dir = fixture(t, scripts, ['src/engine-protocol/build-xiangqi.test.ts']);
  const result = checkServerTestDiscovery(dir);
  assert.equal(result.issues.length, 3);
  assert.ok(
    result.issues.includes(
      'test:unit: src/engine-protocol/build-xiangqi.test.ts is outside every configured test glob',
    ),
  );
});

test('a new deeper directory fails even when its parent directory is covered', (t) => {
  const scripts = {
    ...beforeA962178,
    'test:unit': `${beforeA962178['test:unit']} src/routes/*.test.ts`,
  };
  const dir = fixture(t, scripts, ['src/routes/new-directory/hidden.test.ts']);
  assert.equal(checkServerTestDiscovery(dir).issues.length, 3);
});

test('reported files equal the POSIX shell expansion passed to each real runner', (t) => {
  const files = ['src/root.test.ts', 'src/variant-tenant/tenant.test.ts'];
  const dir = fixture(t, beforeA962178, files);
  const result = checkServerTestDiscovery(dir);
  for (const [suite, selected] of Object.entries(result.filesBySuite)) {
    const patterns = serverTestGlobs(beforeA962178[suite], suite);
    const expanded = execFileSync('sh', ['-c', `printf '%s\\n' ${patterns.join(' ')}`], {
      cwd: dir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .sort();
    assert.deepEqual(selected, expanded, suite);
  }
});

test('missing or unsupported runner configuration fails closed', () => {
  assert.throws(() => serverTestGlobs(undefined, 'test:unit'), /expected an explicit/);
  assert.throws(
    () => serverTestGlobs('node some-wrapper.mjs', 'test:unit'),
    /expected an explicit/,
  );
  for (const script of [
    'tsx --test',
    'tsx --test "src/*.test.ts"',
    'tsx --test src/**/*.test.ts',
    'tsx --test dist/*.test.js',
  ]) {
    assert.throws(() => serverTestGlobs(script, 'test:unit'), /expected unquoted/);
  }
});

test('every current server test is selected by all three suite commands', () => {
  const result = checkServerTestDiscovery();
  assert.deepEqual(result.issues, [], result.issues.join('\n'));
  for (const files of Object.values(result.filesBySuite))
    assert.equal(files.length, result.sourceCount);
});
