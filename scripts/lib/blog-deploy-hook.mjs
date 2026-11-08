import { spawnSync } from 'node:child_process';

// brianhliou.com lists Mistboard's newest articles on its home page, read from
// our /feed.xml when it builds. A Vercel deploy hook rebuilds it, so a release
// pings the hook after its smokes and the home page catches up without anyone
// remembering to.
//
// The hook URL is a secret: anyone holding it can trigger builds. It comes from
// BRIANHLIOU_VERCEL_DEPLOY_HOOK or the macOS Keychain, goes straight into the
// request, and is never printed, logged, or put on a command line. Store it once
// (the -w flag prompts, so the value never lands in history):
//   security add-generic-password -s BRIANHLIOU_VERCEL_DEPLOY_HOOK -a mistboard -U -w
export const BLOG_DEPLOY_HOOK_KEYCHAIN_SERVICE = 'BRIANHLIOU_VERCEL_DEPLOY_HOOK';
const KEYCHAIN_ACCOUNT = 'mistboard';
const HOOK_HOST = 'api.vercel.com';

/** The hook URL, or null when no source has one. NEVER log the return value. */
export function resolveBlogDeployHook({ env = process.env, readKeychain = readKeychainItem } = {}) {
  const fromEnv = env.BRIANHLIOU_VERCEL_DEPLOY_HOOK?.trim();
  if (fromEnv) return fromEnv;
  return readKeychain(BLOG_DEPLOY_HOOK_KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
}

function readKeychainItem(service, account) {
  const result = spawnSync(
    'security',
    ['find-generic-password', '-s', service, '-a', account, '-w'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === '' ? null : value;
}

/**
 * POST the hook. Returns one line safe to print: it names the outcome and never
 * the URL. Never throws; the release is already live when this runs.
 *
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function triggerBlogDeployHook({
  hookUrl,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  if (!hookUrl) {
    return {
      ok: false,
      message: `skip: brianhliou.com rebuild (no hook in BRIANHLIOU_VERCEL_DEPLOY_HOOK or the Keychain item ${BLOG_DEPLOY_HOOK_KEYCHAIN_SERVICE})`,
    };
  }
  let url;
  try {
    url = new URL(hookUrl);
  } catch {
    return {
      ok: false,
      message: 'warning: brianhliou.com rebuild skipped; the stored hook is not a URL',
    };
  }
  if (url.protocol !== 'https:' || url.hostname !== HOOK_HOST) {
    return {
      ok: false,
      message: `warning: brianhliou.com rebuild skipped; the stored hook is not an https://${HOOK_HOST} URL`,
    };
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `warning: brianhliou.com rebuild hook returned ${response.status}; trigger it from Vercel by hand`,
      };
    }
    return { ok: true, message: 'brianhliou.com rebuild requested' };
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timed out' : 'failed to connect';
    return {
      ok: false,
      message: `warning: brianhliou.com rebuild hook ${reason}; trigger it from Vercel by hand`,
    };
  }
}
