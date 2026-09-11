import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTS_PAGE_SIZE, mountAccountsAdmin } from './accounts-admin.js';

type Row = {
  id: string;
  email: string;
  emailVerified: boolean;
  handle: string;
  displayName: string;
  accountRole: 'player' | 'admin';
  title: string | null;
  patron: boolean;
  profileVisibility: 'public';
  createdAt: string;
  lastSeenAt: string | null;
  closedAt: string | null;
  gamesPlayed: number;
};

function row(index: number): Row {
  return {
    id: `user_${index}`,
    email: `p${index}@example.com`,
    emailVerified: true,
    handle: `p${index}`,
    displayName: `Player ${index}`,
    accountRole: 'player',
    title: null,
    patron: false,
    profileVisibility: 'public',
    createdAt: '2026-08-01T10:00:00.000Z',
    lastSeenAt: null,
    closedAt: null,
    gamesPlayed: index,
  };
}

// A roster of 120 accounts served in pages, so the pager and the row numbers
// have something to do. Records every request so the test can assert what the
// page asked for.
function stubRoster(total = 120): string[] {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(`${url.pathname}${url.search}`);
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const accounts = Array.from({ length: Math.min(limit, total - offset) }, (_, i) =>
        row(offset + i + 1),
      );
      return new Response(
        JSON.stringify({
          accounts,
          total,
          summary: { accounts: total, last7d: 3, last30d: 9 },
          offset,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  return requests;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('accounts admin page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
    document.body.className = '';
    window.history.replaceState(null, '', '/accounts');
  });

  it('pages the roster, numbers rows across pages, and keeps the page in the URL', async () => {
    const requests = stubRoster();
    const root = document.createElement('div');
    document.body.append(root);
    await mountAccountsAdmin(root);

    expect(root.querySelector('nav')).not.toBeNull();
    expect(requests).toEqual([
      `/api/admin/accounts?sort=newest&limit=${ACCOUNTS_PAGE_SIZE}&offset=0`,
    ]);
    const ranks = () =>
      [...root.querySelectorAll('.accounts-admin-rank')].map((n) => n.textContent);
    expect(ranks()[0]).toBe('1');
    expect(ranks().at(-1)).toBe(String(ACCOUNTS_PAGE_SIZE));
    const pager = root.querySelector<HTMLElement>('.accounts-admin-pager');
    expect(pager?.hidden).toBe(false);
    expect(pager?.querySelector('.accounts-admin-pager-label')?.textContent).toBe(
      '1–50 of 120 · page 1 of 3',
    );
    expect(pager?.querySelector<HTMLButtonElement>('.accounts-admin-pager-prev')?.disabled).toBe(
      true,
    );

    pager?.querySelector<HTMLButtonElement>('.accounts-admin-pager-next')?.click();
    await settle();
    expect(requests.at(-1)).toBe(
      `/api/admin/accounts?sort=newest&limit=${ACCOUNTS_PAGE_SIZE}&offset=${ACCOUNTS_PAGE_SIZE}`,
    );
    expect(ranks()[0]).toBe(String(ACCOUNTS_PAGE_SIZE + 1));
    expect(window.location.search).toBe('?page=2');
    expect(pager?.querySelector('.accounts-admin-pager-label')?.textContent).toBe(
      '51–100 of 120 · page 2 of 3',
    );
  });

  it('sorts by column header, toggling direction, and resets to page 1', async () => {
    window.history.replaceState(null, '', '/accounts?page=3');
    const requests = stubRoster();
    const root = document.createElement('div');
    document.body.append(root);
    await mountAccountsAdmin(root);
    expect(requests.at(-1)).toContain('offset=100');

    const header = (label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.accounts-admin-sort')].find((b) =>
        b.textContent?.startsWith(label),
      );
    expect(header('Joined')?.classList.contains('is-active')).toBe(true);
    expect(header('Joined')?.closest('th')?.getAttribute('aria-sort')).toBe('descending');

    header('Games')?.click();
    await settle();
    expect(requests.at(-1)).toBe(
      `/api/admin/accounts?sort=games&limit=${ACCOUNTS_PAGE_SIZE}&offset=0`,
    );
    expect(window.location.search).toBe('?sort=games');
    expect(header('Games')?.closest('th')?.getAttribute('aria-sort')).toBe('descending');

    header('Games')?.click();
    await settle();
    expect(requests.at(-1)).toContain('sort=games-asc');
    expect(header('Games')?.closest('th')?.getAttribute('aria-sort')).toBe('ascending');

    header('Account')?.click();
    await settle();
    expect(requests.at(-1)).toContain('sort=name&');
    expect(header('Account')?.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('searches as you type, debounced, and hides the pager on one page', async () => {
    vi.useFakeTimers();
    const requests = stubRoster(4);
    const root = document.createElement('div');
    document.body.append(root);
    await mountAccountsAdmin(root);
    expect(root.querySelector<HTMLElement>('.accounts-admin-pager')?.hidden).toBe(true);

    const input = root.querySelector<HTMLInputElement>('.accounts-admin-input');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    input.value = 'ali';
    input.dispatchEvent(new Event('input'));
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(requests).toHaveLength(2);
    expect(requests.at(-1)).toBe(
      `/api/admin/accounts?sort=newest&limit=${ACCOUNTS_PAGE_SIZE}&offset=0&q=ali`,
    );
    expect(window.location.search).toBe('?q=ali');
    expect(root.querySelector('.accounts-admin-summary')?.textContent).toContain(
      '4 matching "ali"',
    );
  });
});
