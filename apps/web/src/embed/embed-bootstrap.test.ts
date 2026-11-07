import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// An embed runs inside someone else's document, which makes the site bootstrap
// a question of conduct rather than performance. Measured on production before
// this guard existed, /embed/study/... fetched /api/auth/me WITH CREDENTIALS,
// loaded the analytics module, and polled /api/server-status, all from a third
// party's page, while /developers was about to promise the opposite.
//
// This reads main.ts as text because the module is a script whose whole body is
// a side effect: importing it in a test runs the bootstrap rather than letting
// us inspect it. The end-to-end check is a browser against a deploy, which
// cannot run here; this is what keeps the guard from being deleted between
// those.
const mainPath = ['src/main.ts', 'apps/web/src/main.ts']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const main = readFileSync(mainPath as string, 'utf8');
// Analytics boots from analytics.ts (#899); main.ts hands it the embed decision.
const analytics = readFileSync(resolve(mainPath as string, '../analytics.ts'), 'utf8');

describe('the embed document skips the site bootstrap', () => {
  it('decides before running anything', () => {
    const decided = main.indexOf('const isEmbedDocument');
    expect(decided, 'isEmbedDocument is gone').toBeGreaterThan(-1);
    // It has to be settled before the first thing it guards, or the guard is
    // decorative. Analytics is the earliest of them.
    const analyticsCall = main.indexOf('initializeAnalytics(isEmbedDocument)');
    expect(analyticsCall, 'analytics no longer receives the embed decision').toBeGreaterThan(-1);
    expect(decided).toBeLessThan(analyticsCall);
  });

  it('guards analytics: the SDK init returns early in an embed', () => {
    const start = analytics.indexOf('export async function initializeAnalytics(isEmbedDocument');
    expect(start, 'initializeAnalytics is gone').toBeGreaterThan(-1);
    // The first statement after the env reads is the gate; nothing may load
    // or record before it.
    const gate = analytics.indexOf('|| isEmbedDocument) return;', start);
    expect(gate, 'the embed early return is gone').toBeGreaterThan(-1);
    expect(analytics.slice(start, gate)).not.toMatch(/import\(|capture\(|initializeHumanInput/);
  });

  for (const [what, needle] of [
    ['the account nav', 'localeReady.then(() => initializeAccountNav())'],
    ['the server-status poll', "fetch('/api/server-status')"],
  ] as const) {
    it(`guards ${what}`, () => {
      const at = main.indexOf(needle);
      expect(at, `${needle} not found`).toBeGreaterThan(-1);
      // Either the condition is on the line itself, or the nearest preceding
      // guard is the embed one.
      const before = main.slice(Math.max(0, at - 320), at + needle.length);
      expect(before, `${what} is not behind the embed guard`).toContain('isEmbedDocument');
    });
  }

  it('mounts no friends widget of its own; the header Friends menu rides on the account nav', () => {
    // The old bottom-corner widget asked /api/auth/me from main.ts. The Friends
    // menu is built by account-nav, which is behind the embed guard above.
    expect(main).not.toContain('friends-online');
    expect(main).not.toContain('friends-nav');
  });

  it('never lets the embed ask who the viewer is', () => {
    // The credentialed call is the one that actually matters: it is a session
    // lookup issued from a page we do not control.
    const at = main.indexOf('initializeAccountNav()');
    const before = main.slice(Math.max(0, at - 320), at);
    expect(before).toContain('!isEmbedDocument');
  });
});
