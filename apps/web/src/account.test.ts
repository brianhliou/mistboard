import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  handle: string;
  handleChangedAt: string | null;
  displayName: string;
  displayNameChangedAt: string | null;
  bio: string;
  location: string;
  profileLinks: string[];
  displayPreferences: {
    pieceAnimation?: 'none' | 'fast' | 'normal' | 'slow';
  };
  accountPreferences: {
    clockTenths: 'never' | 'low-time' | 'always';
    lowTimeSound: boolean;
    premoves: boolean;
    confirmGameActions: boolean;
    inboxBell: boolean;
    correspondenceBell: boolean;
    correspondenceDeadlineEmail: boolean;
  };
  profileVisibility: 'private' | 'unlisted' | 'public';
  accountRole: 'player' | 'admin';
  locale: 'en' | 'zh-Hans' | 'zh-Hant' | null;
  dmPolicy: 'never' | 'friends' | 'always';
};

describe('account page auth flow', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    window.history.replaceState(null, '', '/account?tab=login');
    document.body.innerHTML = '<div id="app"></div>';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('updates the top nav after confirming a login code in-page', async () => {
    const user = testUser('misty');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        if (url === '/api/auth/email/start') {
          return jsonResponse(authStartData('login-1', '12345678'), 202);
        }
        if (url === '/api/auth/email/confirm') {
          return jsonResponse({ user, isNewUser: false });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { initializeAccountNav } = await import('./account-nav.js');
    const { mountAccount } = await import('./account.js');

    initializeAccountNav();
    await mountAccount(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('.site-nav-link-signin')?.textContent).toBe('Sign in');

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    email?.setAttribute('value', 'misty@example.com');
    if (email) email.value = 'misty@example.com';
    submitAccountForm();
    await flushDom();

    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      'Confirm',
    );

    submitAccountForm();
    await flushDom();

    expect(document.querySelector('.account-nav-trigger')?.textContent).toBe('misty');
    expect(document.querySelector('.site-nav-link-signin')).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(document.querySelector('h1')?.textContent).toBe('Sign in or create an account');
  });

  it('shows local setup guidance when the auth API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        if (url === '/api/auth/email/start') throw new TypeError('fetch failed');
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { initializeAccountNav } = await import('./account-nav.js');
    const { mountAccount } = await import('./account.js');

    initializeAccountNav();
    await mountAccount(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    if (email) email.value = 'misty@example.com';
    submitAccountForm();
    await flushDom();

    expect(document.querySelector('.account-status')?.textContent).toContain(
      'Auth server unavailable',
    );
    expect(email?.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.account-status')?.getAttribute('data-state')).toBe('error');
  });

  it('localizes the Traditional Chinese register flow', async () => {
    window.history.replaceState(null, '', '/zh-hant/account?tab=register');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        if (url === '/api/auth/email/start') {
          return jsonResponse(authStartData('login-1'), 202);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccount } = await import('./account.js');

    await mountAccount(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('.account-auth-tabs')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('登入或建立帳號');
    expect(document.querySelector('.account-copy')?.textContent).toBe(
      '一組信箱驗證碼。不需要密碼。',
    );
    expect(document.querySelector<HTMLInputElement>('input[name="email"]')?.placeholder).toBe(
      '信箱地址',
    );
    expect(document.querySelector('.account-auth-field-label')?.textContent).toBe('信箱地址');
    expect(document.querySelector('.account-auth-field-help')?.textContent).toContain('10 分鐘');
    expect(document.querySelectorAll('.account-auth-principles li')).toHaveLength(3);
    expect(document.querySelector<HTMLDetailsElement>('.account-auth-principles')?.open).toBe(true);
    expect(document.querySelector('.account-auth-principles')?.textContent).toContain(
      '帳號讓計分對局保持可信',
    );
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      '寄送驗證碼',
    );
    expect(document.querySelector('.account-legal')?.textContent).toContain(
      '建立帳號即表示你同意我們的 條款 與 隱私。',
    );

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    if (email) email.value = 'misty@example.com';
    submitAccountForm();
    await flushDom();

    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      '確認',
    );
    expect(document.querySelector('.account-auth-code-prompt')?.textContent).toBe(
      '請輸入寄送至 misty@example.com 的 8 位數驗證碼。',
    );
    expect(document.querySelector('.account-auth-code-timing')?.textContent).toMatch(
      /(?:9:|10:00)/,
    );
    expect(email?.readOnly).toBe(true);
    expect(document.querySelector<HTMLElement>('.account-auth-email-stage')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.account-auth-code-stage')?.hidden).toBe(false);

    document.querySelectorAll<HTMLButtonElement>('.account-auth-reset')[1]?.click();

    expect(email?.readOnly).toBe(false);
    expect(document.querySelector<HTMLElement>('.account-auth-email-stage')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.account-auth-code-stage')?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      '寄送驗證碼',
    );
  });

  it('replaces the active challenge when a new code is requested', async () => {
    let starts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        if (url === '/api/auth/email/start') {
          starts += 1;
          return jsonResponse(
            {
              ...authStartData(`login-${starts}`),
              resendAvailableAt: new Date(Date.now() - 1_000).toISOString(),
            },
            202,
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccount } = await import('./account.js');
    await mountAccount(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    if (email) email.value = 'misty@example.com';
    submitAccountForm();
    await flushDom();

    const resend = document.querySelector<HTMLButtonElement>('.account-auth-resend');
    expect(resend?.disabled).toBe(false);
    resend?.click();
    await flushDom();

    expect(starts).toBe(2);
    expect(document.querySelector('.account-status')?.textContent).toBe('A new code was sent.');
    document.querySelectorAll<HTMLButtonElement>('.account-auth-reset')[1]?.click();
  });

  it('shows a specific message when code requests are rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        if (url === '/api/auth/email/start') {
          return jsonResponse({ error: 'rate_limited' }, 429);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccount } = await import('./account.js');
    await mountAccount(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    if (email) email.value = 'misty@example.com';
    submitAccountForm();
    await flushDom();

    expect(document.querySelector('.account-status')?.textContent).toBe(
      'Too many attempts. Try again in a few minutes.',
    );
  });

  it('uses the centered auth flow for signed-out settings deep links', async () => {
    window.history.replaceState(null, '', '/account/settings/privacy');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: null });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');

    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const shell = document.querySelector<HTMLElement>('main.account-shell');
    expect(shell?.classList.contains('account-settings-shell')).toBe(false);
    expect(document.querySelector('.account-settings-rail')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Sign in or create an account');
  });

  it('renders display preferences separately from the appearance menu', async () => {
    window.history.replaceState(null, '', '/account/settings/display');
    const user = testUser('misty');
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/display-preferences') {
          requests.push(JSON.parse(String(init?.body)) as unknown);
          return jsonResponse({
            user: { ...user, displayPreferences: { pieceAnimation: 'fast' } },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { displayPreferenceStorageKey } = await import('./display-preferences.js');
    const { mountAccountSettings } = await import('./account.js');

    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('.account-settings-rail-link.active')?.textContent).toBe(
      'Display',
    );
    expect(document.querySelector('h1')?.textContent).toBe('Display');
    expect(document.querySelector('.account-settings-panel .appearance-menu')).toBeNull();
    expect(document.querySelector('[name="pieceAnimation"]')).not.toBeNull();
    expect(document.querySelector('[name="playerRatings"]')).toBeNull();
    expect(
      [...document.querySelectorAll('.account-settings-rail-link')].map((link) => link.textContent),
    ).toEqual([
      'Edit profile',
      'Display',
      'Chess clock',
      'Game behavior',
      'Privacy',
      'Notifications',
      'Change username',
      'Email and sign-in',
      'Security',
      'Close account',
    ]);
    expect(document.querySelectorAll('.account-settings-rail-separator')).toHaveLength(3);

    const animation = document.querySelector<HTMLInputElement>(
      'input[name="pieceAnimation"][value="fast"]',
    );
    if (!animation) throw new Error('missing fast piece animation option');
    animation.checked = true;
    animation.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    const stored = JSON.parse(window.localStorage.getItem(displayPreferenceStorageKey) ?? '{}') as {
      pieceAnimation?: string;
    };
    expect(stored.pieceAnimation).toBe('fast');
    expect(requests).toEqual([{ pieceAnimation: 'fast' }]);
    expect(document.querySelector('.account-preference-help')?.textContent).toBe(
      'Display preference saved.',
    );
  });

  it('syncs clock and game behavior preferences to the account and local cache', async () => {
    window.history.replaceState(null, '', '/account/settings/behavior');
    const user = testUser('misty');
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/preferences') {
          const body = JSON.parse(String(init?.body)) as Partial<TestUser['accountPreferences']>;
          requests.push(body);
          Object.assign(user.accountPreferences, body);
          return jsonResponse({ user });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { accountPreferencesStorageKey } = await import('./account-preferences.js');
    const { mountAccountSettings } = await import('./account.js');
    const root = document.querySelector<HTMLElement>('#app') as HTMLElement;
    await mountAccountSettings(root);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Game behavior');
    const premovesOff = document.querySelector<HTMLInputElement>(
      'input[name="premoves"][value="false"]',
    );
    if (!premovesOff) throw new Error('missing premoves preference');
    premovesOff.checked = true;
    premovesOff.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    window.history.replaceState(null, '', '/account/settings/clock');
    await mountAccountSettings(root);
    await flushDom();
    const tenthsAlways = document.querySelector<HTMLInputElement>(
      'input[name="clockTenths"][value="always"]',
    );
    if (!tenthsAlways) throw new Error('missing clock tenths preference');
    tenthsAlways.checked = true;
    tenthsAlways.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    expect(requests).toEqual([{ premoves: false }, { clockTenths: 'always' }]);
    expect(
      JSON.parse(window.localStorage.getItem(accountPreferencesStorageKey) ?? '{}'),
    ).toMatchObject({ premoves: false, clockTenths: 'always' });
  });

  it('renders notification channels as a matrix and saves each available switch', async () => {
    window.history.replaceState(null, '', '/account/settings/notifications');
    const user = testUser('misty');
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/preferences') {
          const body = JSON.parse(String(init?.body)) as Partial<TestUser['accountPreferences']>;
          requests.push(body);
          Object.assign(user.accountPreferences, body);
          return jsonResponse({ user });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Notifications');
    expect(
      [...document.querySelectorAll('.account-notification-settings thead th')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(['', 'Bell', 'Email']);
    // Eight rows, one channel each: five bell-only rows and three email-only rows.
    expect(document.querySelectorAll('.account-notification-unavailable')).toHaveLength(8);
    expect(
      [...document.querySelectorAll<HTMLInputElement>('.account-notification-settings input')].map(
        (input) => input.name,
      ),
    ).toEqual([
      'inboxBell',
      'correspondenceBell',
      'challengesBell',
      'forumBell',
      'followersBell',
      'correspondenceStartEmail',
      'correspondenceDeadlineEmail',
      'correspondenceTurnDigest',
    ]);

    const deadlineEmail = document.querySelector<HTMLInputElement>(
      'input[name="correspondenceDeadlineEmail"]',
    );
    if (!deadlineEmail) throw new Error('missing correspondence deadline email preference');
    deadlineEmail.checked = false;
    deadlineEmail.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    expect(requests).toEqual([{ correspondenceDeadlineEmail: false }]);
    expect(deadlineEmail.checked).toBe(false);

    // The game-start email is a second, independent opt-out: muting the
    // deadline warning must not have muted it too.
    const startEmail = document.querySelector<HTMLInputElement>(
      'input[name="correspondenceStartEmail"]',
    );
    if (!startEmail) throw new Error('missing correspondence start email preference');
    expect(startEmail.checked).toBe(true);
    startEmail.checked = false;
    startEmail.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    expect(requests).toEqual([
      { correspondenceDeadlineEmail: false },
      { correspondenceStartEmail: false },
    ]);
  });

  it('hydrates piece animation from the signed-in account', async () => {
    window.history.replaceState(null, '', '/account/settings/display');
    const user = testUser('misty');
    user.displayPreferences.pieceAnimation = 'slow';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { displayPreferenceStorageKey } = await import('./display-preferences.js');
    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector<HTMLInputElement>('input[value="slow"]')?.checked).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem(displayPreferenceStorageKey) ?? '{}') as {
      pieceAnimation?: string;
    };
    expect(stored.pieceAnimation).toBe('slow');
  });

  it('imports an existing local piece animation choice into a new account preference', async () => {
    window.history.replaceState(null, '', '/account/settings/display');
    const user = testUser('misty');
    user.displayPreferences = {};
    const requests: unknown[] = [];
    const { displayPreferenceStorageKey } = await import('./display-preferences.js');
    window.localStorage.setItem(
      displayPreferenceStorageKey,
      JSON.stringify({ pieceAnimation: 'fast' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/display-preferences') {
          requests.push(JSON.parse(String(init?.body)) as unknown);
          return jsonResponse({
            user: { ...user, displayPreferences: { pieceAnimation: 'fast' } },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(requests).toEqual([{ pieceAnimation: 'fast' }]);
    expect(document.querySelector<HTMLInputElement>('input[value="fast"]')?.checked).toBe(true);
  });

  it('renders privacy as the supported messaging policy without profile hiding', async () => {
    window.history.replaceState(null, '', '/account/settings/privacy');
    const user = testUser('misty');
    const requests: Array<{ body: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/preferences') {
          requests.push({ url, body: JSON.parse(String(init?.body)) as unknown });
          return jsonResponse({ user: { ...user, dmPolicy: 'friends' } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');

    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('.account-settings-rail-link.active')?.textContent).toBe(
      'Privacy',
    );
    expect(document.querySelector('h1')?.textContent).toBe('Privacy');
    expect(document.querySelector('[name="profileVisibility"]')).toBeNull();

    expect(document.querySelector<HTMLInputElement>('input[value="always"]')?.checked).toBe(true);
    const friends = document.querySelector<HTMLInputElement>('input[value="friends"]');
    if (!friends) throw new Error('missing friends messaging policy option');
    friends.checked = true;
    friends.dispatchEvent(new Event('change', { bubbles: true }));
    await flushDom();

    expect(requests).toEqual([{ url: '/api/account/preferences', body: { dmPolicy: 'friends' } }]);
    expect(document.querySelector('.account-preference-help')?.textContent).toBe(
      'Messaging preference saved.',
    );
  });

  it('separates username from email and sign-in settings', async () => {
    window.history.replaceState(null, '', '/account/settings/username');
    const user = testUser('misty');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    const root = document.querySelector<HTMLElement>('#app') as HTMLElement;
    await mountAccountSettings(root);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Change username');
    expect(document.querySelector('input[name="handle"]')).not.toBeNull();
    expect(document.querySelector('input[name="email"]')).toBeNull();

    window.history.replaceState(null, '', '/account/settings/account');
    await mountAccountSettings(root);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Email and sign-in');
    expect([...document.querySelectorAll('dd')].map((value) => value.textContent)).toEqual([
      'misty@example.com',
      'Verified',
    ]);
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(
      document.querySelector<HTMLElement>('input[name="code"]')?.closest('label')?.hidden,
    ).toBe(true);
  });

  it('changes the sign-in email only after confirming its code', async () => {
    window.history.replaceState(null, '', '/account/settings/account');
    const user = testUser('misty');
    const requests: Array<{ body: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/email/start') {
          requests.push({ url, body: JSON.parse(String(init?.body)) as unknown });
          return jsonResponse({ changeId: 'change-1', devCode: '12345678' }, 202);
        }
        if (url === '/api/account/email/confirm') {
          requests.push({ url, body: JSON.parse(String(init?.body)) as unknown });
          return jsonResponse({
            user: { ...user, email: 'new-misty@example.com', emailVerified: true },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    const form = document.querySelector<HTMLFormElement>('.account-email-change-form');
    if (!email || !form) throw new Error('missing email change form');
    email.value = 'new-misty@example.com';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushDom();

    const code = document.querySelector<HTMLInputElement>('input[name="code"]');
    expect(code?.value).toBe('12345678');
    expect(code?.closest('label')?.hidden).toBe(false);
    expect([...document.querySelectorAll('dd')][0]?.textContent).toBe('misty@example.com');

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushDom();

    expect(requests).toEqual([
      { url: '/api/account/email/start', body: { email: 'new-misty@example.com' } },
      {
        url: '/api/account/email/confirm',
        body: { changeId: 'change-1', code: '12345678' },
      },
    ]);
    expect([...document.querySelectorAll('dd')][0]?.textContent).toBe('new-misty@example.com');
    expect(document.querySelector('.account-status')?.textContent).toContain('Email changed.');
  });

  it('lists active sessions and signs out another device', async () => {
    window.history.replaceState(null, '', '/account/settings/security');
    const user = testUser('misty');
    const requests: Array<{ method: string; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/sessions' && !init?.method) {
          return jsonResponse({
            sessions: [
              {
                id: 'session-current',
                createdAt: '2026-07-11T12:00:00.000Z',
                lastSeenAt: '2026-07-11T12:05:00.000Z',
                expiresAt: '2026-08-10T12:00:00.000Z',
                userAgent:
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36',
                current: true,
              },
              {
                id: 'session-other',
                createdAt: '2026-07-10T12:00:00.000Z',
                lastSeenAt: '2026-07-10T13:00:00.000Z',
                expiresAt: '2026-08-09T12:00:00.000Z',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0',
                current: false,
              },
            ],
          });
        }
        if (url === '/api/account/sessions/session-other' && init?.method === 'DELETE') {
          requests.push({ method: init.method, url });
          return jsonResponse({ revoked: true });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Security');
    expect(
      [...document.querySelectorAll('.account-session-details strong')].map(
        (device) => device.textContent,
      ),
    ).toEqual(['Chrome · Mac', 'Firefox · Windows']);
    expect(document.querySelector('.account-session-current')?.textContent).toBe('Current session');
    expect(document.querySelector('.account-session-revoke-others')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('.account-session-revoke')?.click();
    await flushDom();

    expect(requests).toEqual([{ method: 'DELETE', url: '/api/account/sessions/session-other' }]);
    expect(document.querySelector('[data-session-id="session-other"]')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('.account-session-revoke-others')?.hidden,
    ).toBe(true);
  });

  it('closes the account only after acknowledgement and email confirmation', async () => {
    window.history.replaceState(null, '', '/account/settings/close');
    const user = testUser('misty');
    const requests: Array<{ body: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/closure/start') {
          requests.push({ url, body: JSON.parse(String(init?.body)) as unknown });
          return jsonResponse({ closureId: 'closure-1', devCode: '87654321' }, 202);
        }
        if (url === '/api/account/closure/confirm') {
          requests.push({ url, body: JSON.parse(String(init?.body)) as unknown });
          return jsonResponse({ closed: true });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Close account');
    const acknowledgement = document.querySelector<HTMLInputElement>(
      '.account-close-acknowledgement input',
    );
    const form = document.querySelector<HTMLFormElement>('.account-close-form');
    if (!acknowledgement || !form) throw new Error('missing close account form');
    acknowledgement.checked = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushDom();

    const code = document.querySelector<HTMLInputElement>('input[name="code"]');
    expect(code?.value).toBe('87654321');
    expect(code?.closest('label')?.hidden).toBe(false);

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushDom();

    expect(requests).toEqual([
      { url: '/api/account/closure/start', body: {} },
      {
        url: '/api/account/closure/confirm',
        body: { closureId: 'closure-1', code: '87654321' },
      },
    ]);
    expect(document.querySelector('.account-close-complete')?.textContent).toContain(
      'account has been closed',
    );
  });

  it('edits public profile details from the settings landing', async () => {
    window.history.replaceState(null, '', '/account/settings');
    const user = testUser('misty');
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/public-profile') {
          requests.push(JSON.parse(String(init?.body)) as unknown);
          return jsonResponse({
            user: {
              ...user,
              bio: 'Xiangqi learner',
              location: 'Taipei',
              profileLinks: ['https://example.com/xiangqi'],
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    expect(document.querySelector('h1')?.textContent).toBe('Edit profile');
    const bio = document.querySelector<HTMLTextAreaElement>('textarea[name="bio"]');
    const location = document.querySelector<HTMLInputElement>('input[name="location"]');
    const links = document.querySelector<HTMLTextAreaElement>('textarea[name="profileLinks"]');
    if (!bio || !location || !links) throw new Error('missing public profile fields');
    bio.value = 'Xiangqi learner';
    location.value = 'Taipei';
    links.value = 'https://example.com/xiangqi';
    document
      .querySelector<HTMLFormElement>('.account-public-profile-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushDom();

    expect(requests).toEqual([
      {
        bio: 'Xiangqi learner',
        location: 'Taipei',
        profileLinks: ['https://example.com/xiangqi'],
        // Untouched picker sends the account's current flair (none here), not
        // an omitted key: the server keeps the existing flair when the field is
        // absent, so an absent key would silently mean "leave it" rather than
        // "the user cleared it".
        flair: null,
      },
    ]);
    expect(document.querySelector('.account-status')?.textContent).toBe('Public profile saved.');
  });

  it('sends the flair the user picked, and clears it again on No flair', async () => {
    window.history.replaceState(null, '', '/account/settings');
    const user = testUser('misty');
    const requests: { flair?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user });
        if (url === '/api/account/public-profile') {
          const body = JSON.parse(String(init?.body)) as { flair?: unknown };
          requests.push(body);
          return jsonResponse({ user: { ...user, flair: body.flair ?? null } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { mountAccountSettings } = await import('./account.js');
    await mountAccountSettings(document.querySelector<HTMLElement>('#app') as HTMLElement);
    await flushDom();

    const submit = () =>
      document
        .querySelector<HTMLFormElement>('.account-public-profile-form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const cannon = document.querySelector<HTMLInputElement>(
      'input[name="flair"][value="piece-red-cannon"]',
    );
    if (!cannon) throw new Error('missing flair option');
    cannon.checked = true;
    submit();
    await flushDom();

    const none = document.querySelector<HTMLInputElement>('input[name="flair"][value=""]');
    if (!none) throw new Error('missing no-flair option');
    none.checked = true;
    cannon.checked = false;
    submit();
    await flushDom();

    expect(requests.map((request) => request.flair)).toEqual(['piece-red-cannon', null]);
  });
});

function submitAccountForm(): void {
  const form = document.querySelector<HTMLFormElement>('form.account-form');
  if (!form) throw new Error('missing account form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function testUser(handle: string): TestUser {
  return {
    id: `user-${handle}`,
    email: `${handle}@example.com`,
    emailVerified: true,
    handle,
    handleChangedAt: null,
    displayName: handle,
    displayNameChangedAt: null,
    bio: '',
    location: '',
    profileLinks: [],
    displayPreferences: { pieceAnimation: 'normal' },
    accountPreferences: {
      clockTenths: 'low-time',
      lowTimeSound: true,
      premoves: true,
      confirmGameActions: true,
      inboxBell: true,
      correspondenceBell: true,
      correspondenceDeadlineEmail: true,
    },
    profileVisibility: 'public',
    accountRole: 'player',
    locale: null,
    dmPolicy: 'always',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function authStartData(loginId: string, devCode?: string): Record<string, string> {
  const now = Date.now();
  return {
    loginId,
    ...(devCode ? { devCode } : {}),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    resendAvailableAt: new Date(now + 30_000).toISOString(),
  };
}

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
