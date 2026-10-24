import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBlogDeployHook, triggerBlogDeployHook } from './lib/blog-deploy-hook.mjs';

const SECRET = 'https://api.vercel.com/v1/integrations/deploy/prj_planted/s3cr3t-planted';

function recordingFetch(status = 201) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return { ok: status >= 200 && status < 300, status };
  };
  return { calls, fetchImpl };
}

test('the environment beats the Keychain, and an empty value falls through', () => {
  const keychain = () => 'from-keychain';
  assert.equal(
    resolveBlogDeployHook({
      env: { BRIANHLIOU_VERCEL_DEPLOY_HOOK: SECRET },
      readKeychain: keychain,
    }),
    SECRET,
  );
  assert.equal(
    resolveBlogDeployHook({ env: { BRIANHLIOU_VERCEL_DEPLOY_HOOK: '  ' }, readKeychain: keychain }),
    'from-keychain',
  );
  assert.equal(resolveBlogDeployHook({ env: {}, readKeychain: () => null }), null);
});

test('a stored hook is POSTed once', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const result = await triggerBlogDeployHook({ hookUrl: SECRET, fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ url: SECRET, method: 'POST' }]);
});

test('no hook skips without a request', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const result = await triggerBlogDeployHook({ hookUrl: null, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.message, /^skip:/);
  assert.equal(calls.length, 0);
});

test('a hook that is not https on api.vercel.com is never requested', async () => {
  for (const hookUrl of [
    'http://api.vercel.com/v1/integrations/deploy/x/y',
    'https://evil.example/v1/integrations/deploy/x/y',
    'not a url',
  ]) {
    const { calls, fetchImpl } = recordingFetch();
    const result = await triggerBlogDeployHook({ hookUrl, fetchImpl });
    assert.equal(result.ok, false, hookUrl);
    assert.equal(calls.length, 0, hookUrl);
  }
});

test('no outcome message carries the hook URL or any part of its path', async () => {
  const outcomes = [
    await triggerBlogDeployHook({ hookUrl: SECRET, fetchImpl: recordingFetch(201).fetchImpl }),
    await triggerBlogDeployHook({ hookUrl: SECRET, fetchImpl: recordingFetch(500).fetchImpl }),
    await triggerBlogDeployHook({
      hookUrl: SECRET,
      fetchImpl: async () => {
        throw new TypeError(`fetch failed for ${SECRET}`);
      },
    }),
    await triggerBlogDeployHook({
      hookUrl: SECRET.replace('https', 'http'),
      fetchImpl: recordingFetch().fetchImpl,
    }),
  ];
  for (const { message } of outcomes) {
    assert.ok(!message.includes('planted'), message);
    assert.ok(!message.includes('integrations'), message);
  }
});

test('a failed or refused hook is a warning, never a throw', async () => {
  const refused = await triggerBlogDeployHook({
    hookUrl: SECRET,
    fetchImpl: recordingFetch(404).fetchImpl,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /^warning: .*404/);
  const down = await triggerBlogDeployHook({
    hookUrl: SECRET,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.match(down.message, /^warning: .*failed to connect/);
});
