import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fitComposerInput', () => {
  function textarea(scrollHeight: number): HTMLTextAreaElement {
    const input = document.createElement('textarea');
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(input, 'offsetHeight', { configurable: true, value: 56 });
    Object.defineProperty(input, 'clientHeight', { configurable: true, value: 54 });
    return input;
  }

  it('keeps one line as a pill with no scrollbar', async () => {
    const { fitComposerInput } = await import('./inbox.js');
    const input = textarea(54);
    fitComposerInput(input);
    expect(input.style.height).toBe('56px');
    expect(input.classList.contains('is-multiline')).toBe(false);
    expect(input.style.overflowY).toBe('hidden');
  });

  it('grows with a multi-line message and drops the pill shape', async () => {
    const { fitComposerInput } = await import('./inbox.js');
    const input = textarea(140);
    fitComposerInput(input);
    expect(input.style.height).toBe('142px');
    expect(input.classList.contains('is-multiline')).toBe(true);
    expect(input.style.overflowY).toBe('hidden');
  });

  it('caps the height and scrolls past it', async () => {
    const { fitComposerInput } = await import('./inbox.js');
    const input = textarea(600);
    fitComposerInput(input);
    expect(input.style.height).toBe('220px');
    expect(input.style.overflowY).toBe('auto');
  });
});

describe('inbox page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T21:00:00Z'));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState(null, '', '/inbox');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders a unified searchable thread rail with online status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/me') return jsonResponse({ user: testUser('dev-testing') });
        if (url === '/api/players/online') {
          return jsonResponse({ players: [{ handle: 'ana', displayName: 'Ana' }] });
        }
        if (url === '/api/inbox') {
          return jsonResponse({
            threads: [
              thread('ana', 'Ana', 'all good, just bad luck', false),
              thread('dana', 'Dana', 'gg', true),
            ],
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    const { mountInbox } = await import('./inbox.js');
    const root = document.querySelector<HTMLElement>('#app');
    if (!root) throw new Error('missing root');

    await mountInbox(root, null);

    const search = root.querySelector<HTMLInputElement>('.inbox-search-input');
    expect(search?.placeholder).toBe('Search or start new conversation');
    expect(root.querySelectorAll('.inbox-thread')).toHaveLength(2);
    expect(root.querySelector('.inbox-thread .inbox-presence-online')).not.toBeNull();

    search!.value = 'new_player';
    search!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelectorAll('.inbox-thread')).toHaveLength(1);
    expect(root.querySelector<HTMLAnchorElement>('.inbox-thread-new')?.href).toContain(
      '/inbox/new_player',
    );
    expect(root.textContent).toContain('Start a new conversation');
  });
});

function thread(handle: string, displayName: string, lastText: string, unread: boolean) {
  return {
    other: { handle, displayName },
    lastText,
    lastFromMe: false,
    lastAt: '2026-07-05T20:00:00Z',
    unread,
  };
}

function testUser(handle: string) {
  return {
    id: `user-${handle}`,
    email: `${handle}@example.com`,
    emailVerified: true,
    handle,
    handleChangedAt: null,
    displayName: handle,
    displayNameChangedAt: null,
    profileVisibility: 'public',
    accountRole: 'player',
    locale: null,
    dmPolicy: 'always',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
