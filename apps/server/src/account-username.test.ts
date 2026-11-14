import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import * as session from './account-session.js';
import { type UserRow, userFromRow } from './persistence-accounts.js';
import { close, getPool, init } from './persistence-db.js';
import { tryHandle } from './routes/account.js';
import { tryHandle as authRoute } from './routes/auth.js';

function userRow(handle = 'private-stem'): UserRow {
  return {
    id: 'username-user',
    email: 'private.stem+tag@example.com',
    email_verified_at: new Date(),
    handle,
    handle_changed_at: null,
    display_name: handle,
    display_name_changed_at: null,
    bio: '',
    location: '',
    profile_links: [],
    display_preferences: {},
    account_preferences: {},
    profile_visibility: 'public',
    account_role: 'player',
    play_disabled_at: null,
    stats_excluded_at: null,
    title: null,
    flair: null,
    locale: null,
    dm_policy: 'always',
    elo_rating: 1500,
    patron_since: null,
    stripe_customer_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    closed_at: null,
  };
}

async function callRoute(
  route: typeof tryHandle,
  pathname: string,
  body: unknown,
  method = 'POST',
) {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  request.method = method;
  request.headers = { cookie: 'mistboard_session=session.token' };
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '198.51.100.211' } });
  let status = 0;
  let responseBody = '';
  const response = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk: string) {
      responseBody += chunk;
    },
  } as unknown as ServerResponse;
  assert.equal(await route({}, request, response, pathname), true);
  return { status, body: JSON.parse(responseBody) };
}

test('sign-in returns a boolean suggestion once and remembers dismissal for only that account', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  let row = userRow();
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE email_login_challenges')) return { rows: [{ email: row.email }] };
    if (sql.includes('UPDATE users') && sql.includes('SET handle')) {
      assert.equal(values[6], true);
      row = { ...row, username_prompt_dismissed_at: values[5] as Date };
    }
    if (
      sql.includes('FROM users') ||
      sql.includes('UPDATE users') ||
      sql.includes('UPDATE account_sessions')
    )
      return { rows: [row] };
    return { rows: [], rowCount: 1 };
  };
  t.mock.method(getPool(), 'query', query);
  t.mock.method(getPool(), 'connect', async () => ({ query, release() {} }));
  async function confirm(expected: boolean) {
    const result = await callRoute(authRoute, '/api/auth/email/confirm', {
      loginId: 'username-login',
      code: '12345678',
    });
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), ['isNewUser', 'suggestUsername', 'user']);
    assert.equal(result.body.suggestUsername, expected);
    assert.equal(result.body.isNewUser, false);
  }
  await confirm(true);
  const dismissed = await callRoute(
    tryHandle,
    '/api/account/profile',
    { usernamePromptHandled: true },
    'PATCH',
  );
  assert.equal(dismissed.status, 200);
  await confirm(false);
  row = { ...userRow(), id: 'another-account' };
  await confirm(true);
});

for (const collision of [false, true])
  test(`signup never derives a free valid public handle from the email (collision=${collision})`, async (t) => {
    init('postgres://mistboard@127.0.0.1:9/never-connect');
    t.after(() => close());
    const attempts: string[] = [];
    t.mock.method(getPool(), 'query', async (sql: string, values: unknown[]) => {
      if (sql.includes('INSERT INTO users')) {
        const handle = String(values[3]);
        attempts.push(handle);
        // Also exercise a random-handle collision, with no email-derived retry.
        if (collision && attempts.length === 1)
          throw Object.assign(new Error('collision'), { code: '23505' });
        return { rows: [{ ...userRow(handle), email: values[1] }] };
      }
      return { rows: [] };
    });
    const result = await session.ensureUserForEmail('private-stem@example.com', new Date());
    assert.ok(!('closed' in result));
    assert.equal(result.isNew, true);
    assert.notEqual(result.user.handle, 'private-stem');
    assert.equal(attempts.length, collision ? 2 : 1);
    for (const handle of attempts) assert.match(handle, /^player-[a-z0-9]{5}$/);
  });

test('legacy suggestion compares the historical email stem only on the server', () => {
  const user = userFromRow(userRow());
  assert.equal(session.shouldSuggestUsername(user), true);
  assert.equal(session.shouldSuggestUsername({ ...user, handle: 'chosen-name' }), false);
  assert.equal(session.shouldSuggestUsername({ ...user, email: 'ab@example.com' }), false);
  assert.equal(
    session.shouldSuggestUsername({ ...user, usernamePromptDismissedAt: new Date() }),
    false,
  );
});

test('legacy suggestion dismissal is persisted per account without renaming or starting cooldown', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  let row = userRow();
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE account_sessions') || sql.includes('FROM users'))
      return { rows: [row] };
    if (sql.includes('UPDATE users')) {
      assert.match(sql, /username_prompt_dismissed_at/);
      assert.equal(values[1], row.handle);
      assert.equal(values[3], false, 'dismissal must not consume the handle-change cooldown');
      assert.equal(values[6], true);
      row = { ...row, username_prompt_dismissed_at: values[5] as Date };
      return { rows: [row] };
    }
    assert.match(sql, /^(BEGIN|COMMIT|ROLLBACK)$/);
    return { rows: [] };
  };
  t.mock.method(getPool(), 'query', query);
  t.mock.method(getPool(), 'connect', async () => ({ query, release() {} }));
  const request = Readable.from([
    JSON.stringify({ usernamePromptHandled: true }),
  ]) as unknown as IncomingMessage;
  request.method = 'PATCH';
  request.headers = { cookie: 'mistboard_session=session.token' };
  let status = 0;
  let body = '';
  const response = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk: string) {
      body += chunk;
    },
  } as unknown as ServerResponse;
  assert.equal(await tryHandle({}, request, response, '/api/account/profile'), true);
  assert.equal(status, 200, body);
  const loaded = await session.currentAccountUser(request);
  assert.ok(loaded);
  assert.equal(loaded.handle, 'private-stem');
  assert.equal(loaded.handleChangedAt, null);
  assert.equal(session.shouldSuggestUsername(loaded), false);
});
