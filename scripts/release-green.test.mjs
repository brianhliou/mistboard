import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./release-prod.mjs', import.meta.url), 'utf8');
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function declaration(name, text = source) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(text);
  assert.ok(match, `missing ${name}`);
  return text.slice(match.index, text.indexOf('\n}', match.index) + 2);
}

// Execute the real release orchestration, replacing only its external effects.
// Nothing invokes git, gh, production, the keychain, or a real drain here.
async function releaseScenario({
  ciError,
  liveGames = 1,
  movedMain = false,
  failStage,
  ciRequired = true,
} = {}) {
  const events = [];
  const pushes = [];
  const release = { adopted: [], drainOwner: 'test-owner', stages: [], shipWindow: {} };
  const options = {
    push: true,
    head: 'HEAD',
    remote: 'origin',
    targetBranch: 'main',
    changelog: [],
    localCi: false,
    ciWait: true,
  };
  const noop = () => {};
  const context = {
    options,
    release,
    startedAt: 0,
    performance: { now: () => 0 },
    console: { log: noop, error: noop },
    process: {
      exit: (code) => {
        throw new Error(`exit ${code}`);
      },
    },
    ensureCleanWorktree: noop,
    enforceShipWindow: noop,
    takeReleaseLock: noop,
    catchUpBeforeGate: noop,
    git: () => HEAD,
    readRemoteTargetRevision: () => (movedMain && events.includes('ci') ? 'c'.repeat(40) : BASE),
    runPlan: () => ({ deployRequired: true, reason: 'test' }),
    planHostedCi: () => ({ ciRequired, reason: 'test', changedFiles: ['apps/web/src/main.ts'] }),
    printHostedCiPlan: noop,
    fetchActiveGameCount: async () => (Array.isArray(liveGames) ? liveGames.shift() : liveGames),
    requireUsableDrainToken: () => events.push('token'),
    catchUpWithMain: noop,
    safeDeployBaseArgs: () => ['--owner', 'test-owner'],
    runTimed: (label, command) => {
      events.push(label);
      if (label === failStage) throw new Error(`failed ${label}`);
      if (command.includes('push')) pushes.push(command.at(-1));
    },
    timedStage: async (_label, work) => work(),
    waitForGithubCi: async (args) => {
      events.push('ci');
      events.push(args);
      if (ciError)
        throw Object.assign(new Error(ciError), { ciRed: { revision: HEAD, adopted: [] } });
      return { revision: HEAD, tip: HEAD, adopted: [] };
    },
    enterPostPushWorkdir: () => events.push('control worktree'),
    prodWaitCommand: () => ['revision-wait'],
    runSmoke: async () => events.push('smoke'),
    announceNews: () => events.push('announce'),
    submitIndexNow: noop,
    rebuildBlog: noop,
    formatDuration: () => '0ms',
    adoptionSummary: () => '',
    reportDrainHold: noop,
    writeReleaseRecord: noop,
    cancelDrainAfterFailure: async () => {
      if (release.drainStarted || release.drainCommitted) events.push('cancel drain');
    },
    revisionMatches: (a, b) => a === b,
    shortRevision: (sha) => sha.slice(0, 12),
  };
  const body = source.slice(source.indexOf('\ntry {\n'), source.indexOf('// A bad flag'));
  const run = new AsyncFunction(...Object.keys(context), `${body}\n${declaration('pushCommand')}`);
  let error;
  try {
    await run(...Object.values(context));
  } catch (caught) {
    error = caught;
  }
  return { events, pushes, release, error };
}

test('release publishes an exact candidate, overlaps the pending drain with CI, then promotes main', async () => {
  const { events, pushes, release, error } = await releaseScenario();
  assert.equal(error, undefined);
  assert.deepEqual(pushes, [`${HEAD}:refs/heads/release/${HEAD}`, `${HEAD}:refs/heads/main`]);
  const ci = events.indexOf('ci');
  assert.ok(events.indexOf('git push release candidate') < ci);
  assert.ok(events.indexOf('production drain start') < ci);
  assert.ok(events.indexOf('production drain') > ci, 'restart-now must wait for green CI');
  assert.ok(events.indexOf('git push release head') > events.indexOf('production drain'));
  assert.ok(events.indexOf('smoke') > events.indexOf('git push release head'));
  assert.equal(events[ci + 1].branch, `release/${HEAD}`);
  assert.equal(events[ci + 1].exact, true);
  assert.equal(release.pushCompleted, true);
});

for (const ciError of ['red CI', 'cancelled CI', 'timed out waiting for CI']) {
  test(`${ciError} cancels the pending drain and leaves main untouched`, async () => {
    const { pushes, events, release, error } = await releaseScenario({ ciError });
    assert.ok(error);
    assert.deepEqual(pushes, [`${HEAD}:refs/heads/release/${HEAD}`]);
    assert.ok(events.includes('cancel drain'));
    assert.ok(!events.includes('production drain'));
    assert.ok(!events.includes('smoke'));
    assert.ok(!events.includes('announce'));
    assert.ok(!release.pushCompleted);
    assert.equal(release.pushedAt, undefined);
  });
}

test('a main that moves during candidate CI requires a fresh candidate', async () => {
  const { pushes, events, error } = await releaseScenario({ movedMain: true });
  assert.ok(error);
  assert.deepEqual(pushes, [`${HEAD}:refs/heads/release/${HEAD}`]);
  assert.ok(events.includes('cancel drain'));
});

test('an empty game pool still gates promotion on exact CI without requiring a token', async () => {
  const { pushes, events, error } = await releaseScenario({ liveGames: 0 });
  assert.equal(error, undefined);
  assert.equal(pushes.length, 2);
  assert.ok(!events.includes('token'));
  assert.ok(!events.includes('production drain start'));
  assert.ok(events.indexOf('git push release head') > events.indexOf('ci'));
});

test('games that start during CI are drained before main advances', async () => {
  const { events, error } = await releaseScenario({ liveGames: [0, 0, 2] });
  assert.equal(error, undefined);
  assert.ok(events.indexOf('token') > events.indexOf('ci'));
  assert.ok(events.indexOf('production drain') > events.indexOf('ci'));
  assert.ok(events.indexOf('git push release head') > events.indexOf('production drain'));
});

test('games that start during the local gate drain while candidate CI runs', async () => {
  const { events, error } = await releaseScenario({ liveGames: [0, 2] });
  assert.equal(error, undefined);
  assert.ok(events.indexOf('production drain start') < events.indexOf('ci'));
});

test('docs-only candidates still require hosted CI', async () => {
  const { events, error } = await releaseScenario({ ciRequired: false });
  assert.equal(error, undefined);
  assert.ok(events.includes('ci'));
});

for (const failStage of [
  'git push release candidate',
  'production drain start',
  'production drain',
  'git push release head',
]) {
  test(`${failStage} failure never reports a production push or runs smoke`, async () => {
    const { pushes, events, release, error } = await releaseScenario({ failStage });
    assert.ok(error);
    assert.ok(!pushes.includes(`${HEAD}:refs/heads/main`));
    assert.ok(!events.includes('smoke'));
    assert.ok(!release.pushCompleted);
    if (failStage !== 'git push release candidate') assert.ok(events.includes('cancel drain'));
  });
}

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', null]) {
  test(`exact candidate CI refuses a completed ${conclusion} run`, async () => {
    await assert.rejects(candidateWait({ status: 'completed', conclusion }), /hosted CI failed/);
  });
}

test('exact candidate CI requires the completed success badge', async () => {
  assert.equal(
    (await candidateWait({ status: 'completed', conclusion: 'success' })).revision,
    HEAD,
  );
  await assert.rejects(candidateWait({ status: 'in_progress', conclusion: null }), /timed out/);
  await assert.rejects(candidateWait(null), /timed out/);
});

function candidateWait(run) {
  const wait = new AsyncFunction(
    'options',
    'release',
    'findGithubRun',
    'GITHUB_POLL_MS',
    'console',
    `${declaration('waitForGithubCi')}\nreturn waitForGithubCi({ headRevision: '${HEAD}', branch: 'release/${HEAD}', exact: true });`,
  );
  return wait(
    { timeoutMs: 1000, ciWorkflow: 'ci.yml' },
    {},
    (_sha, branch) => {
      assert.equal(branch, `release/${HEAD}`);
      return run;
    },
    10000,
    { log: () => {} },
  );
}

test('CI lookup filters the candidate branch and exact SHA', () => {
  let command;
  const find = new Function(
    'options',
    'runCapture',
    `
    ${declaration('findGithubRun')}
    ${declaration('listGithubRuns')}
    return findGithubRun;
  `,
  )({ ciWorkflow: 'ci.yml', targetBranch: 'main' }, (_label, args) => {
    command = args;
    return JSON.stringify([{ headSha: BASE }, { headSha: HEAD, status: 'completed' }]);
  });
  assert.equal(find(HEAD, `release/${HEAD}`).headSha, HEAD);
  assert.equal(command[command.indexOf('--branch') + 1], `release/${HEAD}`);
  assert.equal(command[command.indexOf('--commit') + 1], HEAD);
  assert.equal(command[command.indexOf('--event') + 1], 'push');
});

test('pending drain starts without polling games or announcing restart-now', async () => {
  const safeSource = readFileSync(new URL('./safe-deploy.mjs', import.meta.url), 'utf8');
  const requests = [];
  const context = {
    console: { log: () => {} },
    baseUrl: new URL('https://example.test'),
    windowMs: 1000,
    pollMs: 5,
    options: { startOnly: true, yes: true },
    URL,
    humanMs: String,
    fetchJson: async (url) => {
      requests.push(url.pathname);
      return { status: 200, body: { activeGames: 2 } };
    },
    startDrain: async () => requests.push('start'),
    sleep: () => {
      throw new Error('must not wait for games');
    },
    commitRestart: () => {
      throw new Error('must not announce restart');
    },
  };
  const run = new AsyncFunction(
    ...Object.keys(context),
    `let drainActive = false;
    ${declaration('safeDeployFlow', safeSource)}
    await safeDeployFlow();
    return drainActive;
  `,
  );
  assert.equal(await run(...Object.values(context)), true);
  assert.deepEqual(requests, ['/health', '/api/server-status', 'start']);
});

test("an owned drain cannot silently reuse another release's pending window", async () => {
  const safeSource = readFileSync(new URL('./safe-deploy.mjs', import.meta.url), 'utf8');
  const start = new AsyncFunction(
    'options',
    'baseUrl',
    'windowMs',
    'token',
    'fetchJson',
    'withExit',
    `
    ${declaration('startDrain', safeSource)}
    return startDrain();
  `,
  );
  await assert.rejects(
    start(
      { owner: 'ours' },
      new URL('https://example.test'),
      1000,
      'test-token',
      async () => ({ status: 200, body: { owner: 'theirs' } }),
      (_code, message) => new Error(message),
    ),
    /not owned by this release/,
  );
});

for (const expired of [false, true]) {
  test(`final owned drain ${expired ? 're-establishes an expired window' : 'reuses its pending window'} before committing`, async () => {
    const safeSource = readFileSync(new URL('./safe-deploy.mjs', import.meta.url), 'utf8');
    const requests = [];
    const context = {
      options: { owner: 'ours', yes: true, commit: true },
      baseUrl: new URL('https://example.test'),
      token: 'test-token',
      windowMs: 1000,
      pollMs: 5,
      URL,
      console: { log: () => {} },
      humanMs: String,
      fetchJson: async (url, init) => {
        if (url.pathname === '/api/server-status') {
          return {
            status: 200,
            body: { activeGames: 0, restartAt: Date.now() + (expired ? -1 : 1000) },
          };
        }
        if (url.pathname === '/admin/drain') {
          const body = JSON.parse(init.body);
          requests.push(body);
          return { status: 200, body: { owner: 'ours', phase: body.phase ?? 'pending' } };
        }
        return { status: 200, body: {} };
      },
    };
    const run = new AsyncFunction(
      ...Object.keys(context),
      `let drainActive = false;
      ${declaration('safeDeployFlow', safeSource)}
      ${declaration('startDrain', safeSource)}
      ${declaration('commitRestart', safeSource)}
      await safeDeployFlow();
    `,
    );
    await run(...Object.values(context));
    assert.deepEqual(requests, [{ windowMs: 1000, owner: 'ours' }, { phase: 'restarting' }]);
  });
}

test('release candidates always trigger CI, including docs-only candidates', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const push = workflow.slice(workflow.indexOf('  push:'), workflow.indexOf('  pull_request:'));
  assert.match(push, /release\/\*\*/);
  assert.doesNotMatch(push, /\bpaths:/);
});

test('--push cannot bypass hosted CI', () => {
  const parse = new Function(
    'DEFAULT_BASE_URL',
    'DEFAULT_CI_WORKFLOW',
    'DEFAULT_REMOTE',
    'DEFAULT_SMOKE',
    'DEFAULT_TARGET_BRANCH',
    'DEFAULT_TIMEOUT_MS',
    'DEFAULT_LOCK_TIMEOUT_MS',
    'DEFAULT_SHIP_WINDOW_HOURS',
    `${declaration('parseArgs')}\nreturn parseArgs;`,
  )('', 'ci.yml', 'origin', 'full', 'main', 1000, 1000, 4);
  assert.throws(
    () => parse(['--push', '--skip-ci-wait']),
    /cannot.*--skip-ci-wait|--skip-ci-wait.*cannot/,
  );
});

test('the main pre-push hook recognizes the exact hosted-CI-verified SHA', () => {
  const result = spawnSync('sh', ['.githooks/pre-push'], {
    cwd: new URL('..', import.meta.url),
    input: `HEAD ${HEAD} refs/heads/main ${BASE}\n`,
    env: { ...process.env, MISTBOARD_RELEASE_PUSH: '1', MISTBOARD_RELEASE_CI_VERIFIED: HEAD },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release candidate passed hosted CI/);
});
