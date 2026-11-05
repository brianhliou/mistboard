import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailDomainCheck } from './email-domain.js';

function resolver(
  overrides: Partial<NonNullable<Parameters<typeof createEmailDomainCheck>[0]>['resolver']> = {},
) {
  return {
    resolveMx: async () => [] as { exchange: string; priority: number }[],
    resolve4: async () => [] as string[],
    resolve6: async () => [] as string[],
    ...overrides,
  };
}

const absent = (code: string) => async (): Promise<never> => {
  throw Object.assign(new Error(code), { code });
};

test('no records, NXDOMAIN and NODATA reject', async () => {
  assert.equal(await createEmailDomainCheck({ resolver: resolver() })('empty.test'), false);
  for (const code of ['ENOTFOUND', 'ENODATA']) {
    const lookup = absent(code);
    const check = createEmailDomainCheck({
      resolver: resolver({ resolveMx: lookup, resolve4: lookup, resolve6: lookup }),
    });
    assert.equal(await check('missing.test'), false);
  }
});

test('MX, implicit IPv4 MX and implicit IPv6 MX accept mail', async () => {
  for (const overrides of [
    { resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }] },
    { resolve4: async () => ['192.0.2.1'] },
    { resolveMx: absent('ENODATA'), resolve6: async () => ['2001:db8::1'] },
  ]) {
    assert.equal(
      await createEmailDomainCheck({ resolver: resolver(overrides) })('valid.test'),
      true,
    );
  }
});

test('null MX rejects even when the domain has address records', async () => {
  for (const exchange of ['', '.']) {
    const check = createEmailDomainCheck({
      resolver: resolver({
        resolveMx: async () => [{ exchange, priority: 0 }],
        resolve4: async () => ['192.0.2.1'],
      }),
    });
    assert.equal(await check('no-mail.test'), false);
  }
});

test('temporary errors on MX or either address lookup fail open', async () => {
  for (const kind of ['resolveMx', 'resolve4', 'resolve6'] as const) {
    assert.equal(
      await createEmailDomainCheck({ resolver: resolver({ [kind]: absent('ESERVFAIL') }) })(
        'error.test',
      ),
      true,
    );
  }
});

test('one valid address family suffices when the other fails', async () => {
  const check = createEmailDomainCheck({
    resolver: resolver({
      resolve4: absent('ESERVFAIL'),
      resolve6: async () => ['2001:db8::1'],
    }),
  });
  assert.equal(await check('ipv6.test'), true);
});

test('the deadline covers MX and address fallback, and does not cache uncertainty', async () => {
  for (const kind of ['resolveMx', 'resolve6'] as const) {
    let calls = 0;
    const check = createEmailDomainCheck({
      timeoutMs: 10,
      resolver: resolver({
        [kind]: () => {
          calls++;
          return new Promise(() => {});
        },
      }),
    });
    assert.equal(await check('timeout.test'), true);
    assert.equal(await check('timeout.test'), true);
    assert.equal(calls, 2);
  }
});

test('positive and negative cache entries share in-flight work and expire', async () => {
  for (const accepted of [true, false]) {
    let now = 0;
    let calls = 0;
    const check = createEmailDomainCheck({
      now: () => now,
      ttlMs: 100,
      resolver: resolver({
        resolveMx: async () => {
          calls++;
          return accepted ? [{ exchange: 'mx.test', priority: 10 }] : [];
        },
      }),
    });
    assert.deepEqual(await Promise.all([check('CACHE.test'), check('cache.test')]), [
      accepted,
      accepted,
    ]);
    assert.equal(calls, 1);
    now = 99;
    assert.equal(await check('cache.test'), accepted);
    assert.equal(calls, 1);
    now = 100;
    assert.equal(await check('cache.test'), accepted);
    assert.equal(calls, 2);
  }
});

test('temporary errors are retried and the cache stays bounded', async () => {
  let calls = 0;
  const check = createEmailDomainCheck({
    maxEntries: 2,
    resolver: resolver({
      resolveMx: async (domain: string) => {
        calls++;
        if (domain === 'error.test') throw new Error('offline');
        return [];
      },
    }),
  });
  await check('error.test');
  await check('error.test');
  assert.equal(calls, 2);
  await check('a.test');
  await check('b.test');
  await check('c.test');
  await check('a.test');
  assert.equal(calls, 6);
});
