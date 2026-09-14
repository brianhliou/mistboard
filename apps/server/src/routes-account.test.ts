import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  accountSessionCookie,
  currentAccountUser,
  ensureUserForEmail,
  hashSecret,
} from './account-session.js';
import {
  createAccountSession,
  createUser,
  findUserByEmail,
  getUserProfileByHandle,
} from './persistence.js';
import { definePersistenceTests } from './persistence-test-support.js';
import { tryHandle } from './routes/account.js';

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

definePersistenceTests('account routes', () => {
  test('account preferences route updates a signed-in locale', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const sessionToken = 'locale-route-token';
    await createUser({
      id: 'user_locale_route',
      email: 'locale-route@example.com',
      emailVerifiedAt: now,
      handle: 'locale-route',
      displayName: 'Locale Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'locale-route-session',
      userId: 'user_locale_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    const handled = await tryHandle(
      {},
      jsonRequest(
        { locale: 'zh-Hant' },
        accountSessionCookie('locale-route-session', sessionToken, expiresAt).split(';')[0],
      ),
      response,
      '/api/account/preferences',
    );

    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.equal(
      (JSON.parse(response.body) as { user: { locale: string } }).user.locale,
      'zh-Hant',
    );
    assert.equal((await findUserByEmail('locale-route@example.com'))?.locale, 'zh-Hant');
  });

  test('account preferences route rejects the retired Japanese locale', async () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    const sessionToken = 'invalid-locale-route-token';
    await createUser({
      id: 'user_invalid_locale_route',
      email: 'invalid-locale@example.com',
      emailVerifiedAt: now,
      handle: 'invalid-locale',
      displayName: 'Invalid Locale',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'invalid-locale-route-session',
      userId: 'user_invalid_locale_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    const handled = await tryHandle(
      {},
      jsonRequest(
        { locale: 'ja' },
        accountSessionCookie('invalid-locale-route-session', sessionToken, expiresAt).split(';')[0],
      ),
      response,
      '/api/account/preferences',
    );

    assert.equal(handled, true);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_locale' });
  });

  test('account preferences route stores clock, behavior, and notification settings', async () => {
    const now = new Date('2026-07-13T12:00:00.000Z');
    const sessionToken = 'account-preference-route-token';
    await createUser({
      id: 'user_account_preference_route',
      email: 'account-preference-route@example.com',
      emailVerifiedAt: now,
      handle: 'account-preference-route',
      displayName: 'Account Preference Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'account-preference-route-session',
      userId: 'user_account_preference_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });
    const cookie = accountSessionCookie(
      'account-preference-route-session',
      sessionToken,
      expiresAt,
    ).split(';')[0];

    for (const body of [
      { clockTenths: 'always' },
      { premoves: false },
      { correspondenceDeadlineEmail: false },
      { correspondenceStartEmail: false },
    ]) {
      const response = captureResponse();
      const handled = await tryHandle(
        {},
        jsonRequest(body, cookie),
        response,
        '/api/account/preferences',
      );
      assert.equal(handled, true);
      assert.equal(response.status, 200);
    }

    const stored = await findUserByEmail('account-preference-route@example.com');
    assert.deepEqual(stored?.accountPreferences, {
      clockTenths: 'always',
      lowTimeSound: true,
      premoves: false,
      confirmGameActions: true,
      inboxBell: true,
      correspondenceBell: true,
      challengesBell: true,
      forumBell: true,
      followersBell: true,
      correspondenceStartEmail: false,
      correspondenceDeadlineEmail: false,
      forumAutoTranslate: true,
    });
  });

  test('account preferences route rejects invalid values and multi-key writes', async () => {
    const now = new Date('2026-07-13T13:00:00.000Z');
    const sessionToken = 'invalid-account-preference-route-token';
    await createUser({
      id: 'user_invalid_account_preference_route',
      email: 'invalid-account-preference-route@example.com',
      emailVerifiedAt: now,
      handle: 'invalid-account-preference-route',
      displayName: 'Invalid Account Preference Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'invalid-account-preference-route-session',
      userId: 'user_invalid_account_preference_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });
    const cookie = accountSessionCookie(
      'invalid-account-preference-route-session',
      sessionToken,
      expiresAt,
    ).split(';')[0];

    for (const body of [
      { clockTenths: 'sometimes' },
      { premoves: 'no' },
      { premoves: false, inboxBell: false },
    ]) {
      const response = captureResponse();
      const handled = await tryHandle(
        {},
        jsonRequest(body, cookie),
        response,
        '/api/account/preferences',
      );
      assert.equal(handled, true);
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(response.body), { error: 'invalid_account_preferences' });
    }
  });

  test('account preferences route does not allow profiles to be hidden', async () => {
    const now = new Date('2026-07-05T12:00:00.000Z');
    const sessionToken = 'visibility-route-token';
    await createUser({
      id: 'user_visibility_route',
      email: 'visibility-route@example.com',
      emailVerifiedAt: now,
      handle: 'visibility-route',
      displayName: 'Visibility Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'visibility-route-session',
      userId: 'user_visibility_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    const handled = await tryHandle(
      {},
      jsonRequest(
        { profileVisibility: 'private' },
        accountSessionCookie('visibility-route-session', sessionToken, expiresAt).split(';')[0],
      ),
      response,
      '/api/account/preferences',
    );

    assert.equal(handled, true);
    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'profile_visibility_not_configurable',
    });
    assert.equal(
      (await findUserByEmail('visibility-route@example.com'))?.profileVisibility,
      'public',
    );
  });

  test('account display-preferences route stores piece animation', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'display-preference-route-token';
    await createUser({
      id: 'user_display_preference_route',
      email: 'display-preference-route@example.com',
      emailVerifiedAt: now,
      handle: 'display-preference-route',
      displayName: 'Display Preference Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'display-preference-route-session',
      userId: 'user_display_preference_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    const handled = await tryHandle(
      {},
      jsonRequest(
        { pieceAnimation: 'fast' },
        accountSessionCookie('display-preference-route-session', sessionToken, expiresAt).split(
          ';',
        )[0],
      ),
      response,
      '/api/account/display-preferences',
    );

    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.deepEqual(
      (JSON.parse(response.body) as { user: { displayPreferences: unknown } }).user
        .displayPreferences,
      { pieceAnimation: 'fast' },
    );
    assert.deepEqual(
      (await findUserByEmail('display-preference-route@example.com'))?.displayPreferences,
      { pieceAnimation: 'fast' },
    );
  });

  test('account display-preferences route rejects unknown values and keys', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'invalid-display-preference-route-token';
    await createUser({
      id: 'user_invalid_display_preference_route',
      email: 'invalid-display-preference-route@example.com',
      emailVerifiedAt: now,
      handle: 'invalid-display-preference-route',
      displayName: 'Invalid Display Preference Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'invalid-display-preference-route-session',
      userId: 'user_invalid_display_preference_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });
    const cookie = accountSessionCookie(
      'invalid-display-preference-route-session',
      sessionToken,
      expiresAt,
    ).split(';')[0];

    for (const body of [
      { pieceAnimation: 'instant' },
      { pieceAnimation: 'fast', boardCoordinates: 'inside' },
    ]) {
      const response = captureResponse();
      const handled = await tryHandle(
        {},
        jsonRequest(body, cookie),
        response,
        '/api/account/display-preferences',
      );
      assert.equal(handled, true);
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(response.body), { error: 'invalid_display_preferences' });
    }
    assert.deepEqual(
      (await findUserByEmail('invalid-display-preference-route@example.com'))?.displayPreferences,
      {},
    );
  });

  test('account email change verifies the new address before updating sign-in', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'email-change-route-token';
    await createUser({
      id: 'user_email_change_route',
      email: 'email-change-old@example.com',
      emailVerifiedAt: now,
      handle: 'email-change-route',
      displayName: 'Email Change Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'email-change-route-session',
      userId: 'user_email_change_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });
    const cookie = accountSessionCookie(
      'email-change-route-session',
      sessionToken,
      expiresAt,
    ).split(';')[0];

    const startResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'EMAIL-CHANGE-NEW@example.com' }, cookie, 'POST'),
      startResponse,
      '/api/account/email/start',
    );
    assert.equal(startResponse.status, 202);
    const started = JSON.parse(startResponse.body) as { changeId: string; devCode: string };
    assert.ok(started.changeId);
    assert.match(started.devCode, /^\d{8}$/);
    assert.equal(
      (await findUserByEmail('email-change-old@example.com'))?.id,
      'user_email_change_route',
    );

    const confirmResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ changeId: started.changeId, code: started.devCode }, cookie, 'POST'),
      confirmResponse,
      '/api/account/email/confirm',
    );
    assert.equal(confirmResponse.status, 200);
    const confirmed = JSON.parse(confirmResponse.body) as {
      user: { email: string; emailVerified: boolean };
    };
    assert.equal(confirmed.user.email, 'email-change-new@example.com');
    assert.equal(confirmed.user.emailVerified, true);
    assert.equal(await findUserByEmail('email-change-old@example.com'), null);
    assert.equal(
      (await findUserByEmail('email-change-new@example.com'))?.id,
      'user_email_change_route',
    );
  });

  test('account email change challenge is bound to the requesting account', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const expiresAt = new Date(Date.now() + 86_400_000);
    for (const suffix of ['owner', 'other']) {
      await createUser({
        id: `user_email_change_${suffix}`,
        email: `email-change-${suffix}@example.com`,
        emailVerifiedAt: now,
        handle: `email-change-${suffix}`,
        displayName: `Email Change ${suffix}`,
        now,
      });
      await createAccountSession({
        id: `email-change-${suffix}-session`,
        userId: `user_email_change_${suffix}`,
        tokenHash: hashSecret(`${suffix}-token`),
        expiresAt,
      });
    }
    const ownerCookie = accountSessionCookie(
      'email-change-owner-session',
      'owner-token',
      expiresAt,
    ).split(';')[0];
    const otherCookie = accountSessionCookie(
      'email-change-other-session',
      'other-token',
      expiresAt,
    ).split(';')[0];

    const startResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ email: 'email-change-target@example.com' }, ownerCookie, 'POST'),
      startResponse,
      '/api/account/email/start',
    );
    const started = JSON.parse(startResponse.body) as { changeId: string; devCode: string };

    const crossAccountResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ changeId: started.changeId, code: started.devCode }, otherCookie, 'POST'),
      crossAccountResponse,
      '/api/account/email/confirm',
    );
    assert.equal(crossAccountResponse.status, 400);
    assert.deepEqual(JSON.parse(crossAccountResponse.body), {
      error: 'invalid_email_change_code',
    });
    assert.equal(
      (await findUserByEmail('email-change-owner@example.com'))?.id,
      'user_email_change_owner',
    );
    assert.equal(
      (await findUserByEmail('email-change-other@example.com'))?.id,
      'user_email_change_other',
    );
  });

  test('account sessions identify the current session and revoke only other sessions', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createUser({
      id: 'user_session_management_route',
      email: 'session-management-route@example.com',
      emailVerifiedAt: now,
      handle: 'session-management-route',
      displayName: 'Session Management Route',
      now,
    });
    for (const session of [
      { id: 'session-current', token: 'current-token', userAgent: null },
      { id: 'session-other', token: 'other-token', userAgent: 'Other Browser' },
      { id: 'session-third', token: 'third-token', userAgent: null },
    ]) {
      await createAccountSession({
        id: session.id,
        userId: 'user_session_management_route',
        tokenHash: hashSecret(session.token),
        expiresAt,
        userAgent: session.userAgent,
      });
    }
    const cookie = accountSessionCookie('session-current', 'current-token', expiresAt).split(
      ';',
    )[0];

    const listResponse = captureResponse();
    const listRequest = jsonRequest({}, cookie, 'GET');
    listRequest.headers['user-agent'] = 'Current Browser';
    await tryHandle({}, listRequest, listResponse, '/api/account/sessions');
    assert.equal(listResponse.status, 200);
    const listed = (
      JSON.parse(listResponse.body) as {
        sessions: Array<{ current: boolean; id: string; userAgent: string | null }>;
      }
    ).sessions;
    assert.deepEqual(
      listed
        .map((session) => ({
          id: session.id,
          current: session.current,
          userAgent: session.userAgent,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'session-current', current: true, userAgent: 'Current Browser' },
        { id: 'session-other', current: false, userAgent: 'Other Browser' },
        { id: 'session-third', current: false, userAgent: null },
      ],
    );

    const currentResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({}, cookie, 'DELETE'),
      currentResponse,
      '/api/account/sessions/session-current',
    );
    assert.equal(currentResponse.status, 400);
    assert.deepEqual(JSON.parse(currentResponse.body), { error: 'current_session' });

    const otherResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({}, cookie, 'DELETE'),
      otherResponse,
      '/api/account/sessions/session-other',
    );
    assert.equal(otherResponse.status, 200);

    const bulkResponse = captureResponse();
    await tryHandle({}, jsonRequest({}, cookie, 'DELETE'), bulkResponse, '/api/account/sessions');
    assert.equal(bulkResponse.status, 200);
    assert.deepEqual(JSON.parse(bulkResponse.body), { revoked: 1 });

    const finalListResponse = captureResponse();
    await tryHandle({}, jsonRequest({}, cookie, 'GET'), finalListResponse, '/api/account/sessions');
    assert.deepEqual(
      (JSON.parse(finalListResponse.body) as { sessions: Array<{ id: string }> }).sessions.map(
        (session) => session.id,
      ),
      ['session-current'],
    );
  });

  test('account closure anonymizes identity, revokes sessions, and blocks re-registration', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'account-closure-route-token';
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createUser({
      id: 'user_account_closure_route',
      email: 'account-closure-route@example.com',
      emailVerifiedAt: now,
      handle: 'account-closure-route',
      displayName: 'Account Closure Route',
      now,
    });
    await createAccountSession({
      id: 'account-closure-route-session',
      userId: 'user_account_closure_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
      userAgent: 'Closure Browser',
    });
    const cookie = accountSessionCookie(
      'account-closure-route-session',
      sessionToken,
      expiresAt,
    ).split(';')[0];

    const startResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({}, cookie, 'POST'),
      startResponse,
      '/api/account/closure/start',
    );
    assert.equal(startResponse.status, 202);
    const started = JSON.parse(startResponse.body) as { closureId: string; devCode: string };
    assert.match(started.devCode, /^\d{8}$/);

    const confirmResponse = captureResponse();
    await tryHandle(
      {},
      jsonRequest({ closureId: started.closureId, code: started.devCode }, cookie, 'POST'),
      confirmResponse,
      '/api/account/closure/confirm',
    );
    assert.equal(confirmResponse.status, 200);
    assert.deepEqual(JSON.parse(confirmResponse.body), { closed: true });
    assert.equal(await findUserByEmail('account-closure-route@example.com'), null);
    assert.equal(await getUserProfileByHandle('account-closure-route', null), null);
    assert.equal(await currentAccountUser(jsonRequest({}, cookie, 'GET')), null);
    assert.deepEqual(
      await ensureUserForEmail('account-closure-route@example.com', new Date(now.getTime() + 1)),
      { closed: true },
    );
    const similarlyNamed = await ensureUserForEmail(
      'account-closure-route@other.example.com',
      new Date(now.getTime() + 2),
    );
    assert.ok('user' in similarlyNamed);
    assert.notEqual(similarlyNamed.user.handle, 'account-closure-route');
  });

  test('account public-profile route stores validated public details', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'public-profile-route-token';
    await createUser({
      id: 'user_public_profile_route',
      email: 'public-profile-route@example.com',
      emailVerifiedAt: now,
      handle: 'public-profile-route',
      displayName: 'Public Profile Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'public-profile-route-session',
      userId: 'user_public_profile_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    const handled = await tryHandle(
      {},
      jsonRequest(
        {
          bio: '  Xiangqi learner  ',
          location: '  Taipei  ',
          profileLinks: ['https://example.com/xiangqi', 'https://example.com/xiangqi'],
        },
        accountSessionCookie('public-profile-route-session', sessionToken, expiresAt).split(';')[0],
      ),
      response,
      '/api/account/public-profile',
    );

    assert.equal(handled, true);
    assert.equal(response.status, 200);
    const saved = await findUserByEmail('public-profile-route@example.com');
    assert.equal(saved?.bio, 'Xiangqi learner');
    assert.equal(saved?.location, 'Taipei');
    assert.deepEqual(saved?.profileLinks, ['https://example.com/xiangqi']);
  });

  test('account public-profile route rejects unsafe links', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const sessionToken = 'unsafe-profile-route-token';
    await createUser({
      id: 'user_unsafe_profile_route',
      email: 'unsafe-profile-route@example.com',
      emailVerifiedAt: now,
      handle: 'unsafe-profile-route',
      displayName: 'Unsafe Profile Route',
      now,
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await createAccountSession({
      id: 'unsafe-profile-route-session',
      userId: 'user_unsafe_profile_route',
      tokenHash: hashSecret(sessionToken),
      expiresAt,
    });

    const response = captureResponse();
    await tryHandle(
      {},
      jsonRequest(
        { bio: '', location: '', profileLinks: ['javascript:alert(1)'] },
        accountSessionCookie('unsafe-profile-route-session', sessionToken, expiresAt).split(';')[0],
      ),
      response,
      '/api/account/public-profile',
    );

    assert.equal(response.status, 400);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid_public_profile' });
    assert.deepEqual((await findUserByEmail('unsafe-profile-route@example.com'))?.profileLinks, []);
  });
});

function jsonRequest(body: unknown, cookie?: string, method = 'PATCH'): IncomingMessage {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  request.method = method;
  request.headers = cookie ? { cookie } : {};
  Object.defineProperty(request, 'socket', {
    value: { remoteAddress: '127.0.0.1' },
  });
  return request;
}

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
