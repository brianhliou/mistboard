import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderChallenges } from './correspondence.js';

// Your own open seeks lead the /correspondence main column (2026-10-03): the
// homepage jieqi button posts one, and under the side-column form it read as a
// footnote. The section shows only while something of yours is out.
function mineResponse(seeks: unknown[]): Response {
  return new Response(JSON.stringify({ limit: 6, seeks }), { status: 200 });
}

const jieqiSeek = {
  id: 'seek-1',
  gameSpecId: 'jieqi',
  daysPerMove: 1,
  preferredColor: 'any',
  rated: false,
  visibility: 'public',
  targetName: null,
  challengeUrl: null,
  expiresAt: new Date(Date.now() + 13 * 86_400_000).toISOString(),
};

describe('correspondence: your open seeks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Waiting for an opponent section with the seek and Cancel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mineResponse([jieqiSeek])),
    );
    const host = document.createElement('section');
    host.hidden = true;
    const counts: number[] = [];
    await renderChallenges(host, (n) => counts.push(n));
    expect(host.hidden).toBe(false);
    expect(host.querySelector('h2')?.textContent).toBe('Waiting for an opponent');
    expect(host.querySelector('.correspondence-count')?.textContent).toBe('1');
    expect(host.querySelector('[data-seek-id="seek-1"]')?.textContent).toContain('Jieqi');
    expect(host.querySelector('[data-seek-id="seek-1"] button')?.textContent).toBe('Cancel');
    expect(counts).toEqual([1]);
  });

  it('draws each seek as the site seek card, Cancel above the card link', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : mineResponse([jieqiSeek]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('section');
    await renderChallenges(host);
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-1"]');
    expect(card?.classList.contains('current-game-card')).toBe(true);
    expect(card?.closest('.current-games-grid')).not.toBeNull();
    expect(card?.querySelector('.current-game-board')).not.toBeNull();
    expect(card?.querySelector('.current-game-seat.is-empty-seat')?.textContent).toBe(
      'Waiting for an opponent',
    );
    expect(card?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
    // A public seek has no page of its own, so no card-wide link to cover Cancel.
    expect(card?.querySelector('a.current-game-open')).toBeNull();
    const cancel = card?.querySelector<HTMLButtonElement>('.current-game-seek-action button');
    expect(cancel?.textContent).toBe('Cancel');
    cancel?.click();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/seek-1', {
        method: 'DELETE',
      }),
    );
  });

  it('gives a link challenge Copy link and Cancel, and opens its challenge page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mineResponse([{ ...jieqiSeek, visibility: 'private', challengeUrl: '/challenge/seek-1' }]),
      ),
    );
    const host = document.createElement('section');
    await renderChallenges(host);
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-1"]');
    expect(card?.querySelector('.current-game-seat.is-empty-seat')?.textContent).toBe(
      'Link challenge',
    );
    expect(card?.querySelector('a.current-game-open')?.getAttribute('href')).toBe(
      '/challenge/seek-1',
    );
    const labels = [...(card?.querySelectorAll('.current-game-seek-action button') ?? [])].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(['Copy link', 'Cancel']);
    expect(card?.querySelectorAll('a a')).toHaveLength(0);
  });

  it('hides itself when nothing is out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mineResponse([])),
    );
    const host = document.createElement('section');
    host.hidden = false;
    const counts: number[] = [];
    await renderChallenges(host, (n) => counts.push(n));
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
    expect(counts).toEqual([0]);
  });
});
