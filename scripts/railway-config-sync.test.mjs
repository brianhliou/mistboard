// Railway deploy config lives in two places until the #980 cutover: the Config
// as Code files Railway reads today (railway.web.json,
// railway.engine-worker.json) and the Infrastructure as Code data files that
// `.railway/railway.ts` and our scripts read (.railway/<service>.json). A
// change made to only one of them would deploy one value and test another, so
// they must agree field for field. Once the legacy files are deleted after
// cutover, the comparison has nothing to compare and the IaC checks remain.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_RAILWAY_CONFIGS,
  RAILWAY_SERVICE_CONFIGS,
  readRailwayServiceConfig,
} from './lib/railway-config.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iacSource = readFileSync(resolve(repoRoot, '.railway/railway.ts'), 'utf8');

for (const [service, legacyFile] of Object.entries(LEGACY_RAILWAY_CONFIGS)) {
  const legacyPath = resolve(repoRoot, legacyFile);
  test(`${RAILWAY_SERVICE_CONFIGS[service]} carries the same settings as ${legacyFile}`, {
    skip: existsSync(legacyPath) ? false : `${legacyFile} is gone (post-cutover)`,
  }, () => {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
    const data = readRailwayServiceConfig(repoRoot, service);
    // The builder is explicit in IaC; Config as Code left it to the service
    // setting, which is RAILPACK on both services.
    const { builder, ...build } = data.build ?? {};
    assert.equal(builder, 'RAILPACK', `${service} builds with Railpack`);
    assert.deepEqual(build, legacy.build, `${service} build settings drifted from ${legacyFile}`);
    assert.deepEqual(
      data.deploy,
      legacy.deploy,
      `${service} deploy settings drifted from ${legacyFile}`,
    );
    assert.deepEqual(Object.keys(data).sort(), ['build', 'deploy'], `${service} data file keys`);
  });
}

test('every service data file sets the fields Config as Code migration would drop', () => {
  // `railway config migrate` leaves watchPatterns as a comment and drops
  // drainingSeconds; losing either redeploys on every push or cuts live games.
  for (const service of Object.keys(RAILWAY_SERVICE_CONFIGS)) {
    const { build, deploy } = readRailwayServiceConfig(repoRoot, service);
    assert.ok(build.watchPatterns.length > 0, `${service} watchPatterns`);
    assert.ok(
      build.watchPatterns.some((pattern) => pattern.startsWith('!')),
      `${service} keeps its test-file negations`,
    );
    assert.ok(deploy.drainingSeconds > 0, `${service} drainingSeconds`);
    assert.equal(deploy.healthcheckPath, '/health', `${service} healthcheckPath`);
    assert.ok(deploy.healthcheckTimeout > 0, `${service} healthcheckTimeout`);
  }
});

test('railway.ts is a named partial that reads the data files and leaves variables alone', () => {
  // A whole-project file deletes every resource it omits on apply (Postgres,
  // banqi-provider-canary); a managed variable block would rewrite secrets.
  assert.match(iacSource, /^export const partial = 'mistboard';$/m);
  assert.match(iacSource, /variables: \{ managed: false \}/);
  for (const [service, file] of Object.entries(RAILWAY_SERVICE_CONFIGS)) {
    assert.match(iacSource, new RegExp(`service\\('${service}'`), `declares ${service}`);
    const local = `./${file.slice('.railway/'.length)}`;
    assert.ok(iacSource.includes(`from '${local}'`), `railway.ts imports ${local}`);
  }
});
