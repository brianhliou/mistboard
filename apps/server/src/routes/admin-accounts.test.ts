import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  ADMIN_ACCOUNT_SORTS,
  type AdminAccountRow,
  type AdminAccountsQuery,
} from '../persistence-admin-accounts.js';
import {
  ADMIN_ACCOUNTS_DEFAULT_LIMIT,
  type AdminAccountsApiPersistence,
  adminAccountsForApi,
  parseAdminAccountsQuery,
  tryHandle,
} from './admin-accounts.js';

const alice: AdminAccountRow = {
  id: 'user_alice',
  email: 'alice@example.com',
  emailVerifiedAt: new Date('2026-08-01T10:00:00.000Z'),
  handle: 'alice',
  displayName: 'Alice',
  accountRole: 'player',
  title: null,
  patronSince: new Date('2026-08-05T00:00:00.000Z'),
  profileVisibility: 'public',
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  lastSeenAt: new Date('2026-08-27T09:30:00.000Z'),
  closedAt: null,
  statsExcludedAt: null,
  gamesPlayed: 12,
};

const bob: AdminAccountRow = {
  ...alice,
  id: 'user_bob',
  email: 'bob@example.com',
  emailVerifiedAt: null,
  handle: 'bob',
  displayName: 'Bob',
  patronSince: null,
  lastSeenAt: null,
  closedAt: new Date('2026-08-20T00:00:00.000Z'),
  statsExcludedAt: null,
  gamesPlayed: 0,
};

function makeFake(): { deps: AdminAccountsApiPersistence; queries: AdminAccountsQuery[] } {
  const queries: AdminAccountsQuery[] = [];
  const deps: AdminAccountsApiPersistence = {
    listAdminAccounts: async (query) => {
      queries.push(query);
      return {
        accounts: [alice, bob],
        total: 2,
        summary: { accounts: 2, last7d: 0, last30d: 2 },
      };
    },
  };
  return { deps, queries };
}

test('query defaults to newest, the default page size, and no search', () => {
  const parsed = parseAdminAccountsQuery(new URLSearchParams());
  assert.deepEqual(parsed, {
    ok: true,
    query: { sort: 'newest', search: null, limit: ADMIN_ACCOUNTS_DEFAULT_LIMIT, offset: 0 },
  });
});

test('query accepts every sort, trims the search, and clamps an over-ask to the cap', () => {
  for (const sort of ADMIN_ACCOUNT_SORTS) {
    const parsed = parseAdminAccountsQuery(new URLSearchParams({ sort }));
    assert.equal(parsed.ok && parsed.query.sort, sort);
  }
  const parsed = parseAdminAccountsQuery(
    new URLSearchParams({ q: '  Ali ', limit: '9999', offset: '40' }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    query: { sort: 'newest', search: 'Ali', limit: 500, offset: 40 },
  });
  // A blank search is no search, not a search for the empty string.
  const blank = parseAdminAccountsQuery(new URLSearchParams({ q: '   ' }));
  assert.equal(blank.ok && blank.query.search, null);
});

test('query rejects unknown sorts and malformed paging fail-closed', () => {
  assert.deepEqual(parseAdminAccountsQuery(new URLSearchParams({ sort: 'random' })), {
    ok: false,
    error: 'invalid_sort',
  });
  for (const limit of ['0', '-1', '1.5', 'ten', '']) {
    assert.deepEqual(
      parseAdminAccountsQuery(new URLSearchParams({ limit })),
      { ok: false, error: 'invalid_limit' },
      `limit=${limit}`,
    );
  }
  for (const offset of ['-1', '2.5', 'x']) {
    assert.deepEqual(
      parseAdminAccountsQuery(new URLSearchParams({ offset })),
      { ok: false, error: 'invalid_offset' },
      `offset=${offset}`,
    );
  }
  assert.deepEqual(parseAdminAccountsQuery(new URLSearchParams({ q: 'a'.repeat(121) })), {
    ok: false,
    error: 'search_too_long',
  });
});

test('the API passes the parsed query through and serializes rows for the browser', async () => {
  const { deps, queries } = makeFake();
  const result = await adminAccountsForApi(
    new URLSearchParams({ sort: 'games', q: 'ali', limit: '50', offset: '10' }),
    deps,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(queries, [{ sort: 'games', search: 'ali', limit: 50, offset: 10 }]);
  assert.deepEqual(result.payload, {
    accounts: [
      {
        id: 'user_alice',
        email: 'alice@example.com',
        emailVerified: true,
        handle: 'alice',
        displayName: 'Alice',
        accountRole: 'player',
        title: null,
        patron: true,
        profileVisibility: 'public',
        createdAt: '2026-08-01T10:00:00.000Z',
        lastSeenAt: '2026-08-27T09:30:00.000Z',
        closedAt: null,
        statsExcluded: false,
        gamesPlayed: 12,
      },
      {
        id: 'user_bob',
        email: 'bob@example.com',
        emailVerified: false,
        handle: 'bob',
        displayName: 'Bob',
        accountRole: 'player',
        title: null,
        patron: false,
        profileVisibility: 'public',
        createdAt: '2026-08-01T10:00:00.000Z',
        lastSeenAt: null,
        closedAt: '2026-08-20T00:00:00.000Z',
        statsExcluded: false,
        gamesPlayed: 0,
      },
    ],
    total: 2,
    summary: { accounts: 2, last7d: 0, last30d: 2 },
    sort: 'games',
    search: 'ali',
    limit: 50,
    offset: 10,
  });
});

test('a bad query is a 400 and never reaches persistence', async () => {
  const { deps, queries } = makeFake();
  const result = await adminAccountsForApi(new URLSearchParams({ sort: 'nope' }), deps);
  assert.deepEqual(result, { status: 400, payload: { error: 'invalid_sort' } });
  assert.deepEqual(queries, []);
});

test('the roster route requires an admin session in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = captureResponse();
    const handled = await tryHandle(
      {},
      { method: 'GET', headers: {} } as IncomingMessage,
      response,
      '/api/admin/accounts',
      new URL('http://test.local/api/admin/accounts'),
    );
    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { error: 'admin_required' });
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('other paths fall through to the next route module', async () => {
  const response = captureResponse();
  const handled = await tryHandle(
    {},
    { method: 'GET', headers: {} } as IncomingMessage,
    response,
    '/api/admin/accounts/alice',
    new URL('http://test.local/api/admin/accounts/alice'),
  );
  assert.equal(handled, false);
});

type ResponseCapture = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
};

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: '',
    writeHead(statusCode: number, headers: Record<string, string | string[]> = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
      return this;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
