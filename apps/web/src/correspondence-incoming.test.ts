import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIncomingChallenges } from './correspondence.js';

// #528: the bell said "N challenges waiting for you" and linked to
// /correspondence, which never listed them. The page now leads with a
// "Challenges for you" section read from /seeks/incoming, the same live rows
// the bell counts, with Accept and Decline in place.
function incomingResponse(challenges: unknown[]): Response {
  return new Response(JSON.stringify({ challenges }), { status: 200 });
}

const xiangqiChallenge = {
  id: 'seek-in-1',
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  // The challenger plays Red, so the viewer plays Black.
  preferredColor: 'first',
  rated: true,
  challengerName: 'Poster',
  challengerHandle: 'poster',
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe('correspondence: challenges for you', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists each challenge as a seek card with the challenger, terms, your side, Accept and Decline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => incomingResponse([xiangqiChallenge])),
    );
    const host = document.createElement('section');
    host.hidden = true;
    const counts: number[] = [];
    await renderIncomingChallenges(host, (n) => counts.push(n));

    expect(host.hidden).toBe(false);
    expect(counts).toEqual([1]);
    expect(host.querySelector('h2')?.textContent).toBe('Challenges for you');
    expect(host.querySelector('.correspondence-count')?.textContent).toBe('1');
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-in-1"]');
    expect(card?.classList.contains('current-game-card')).toBe(true);
    expect(card?.querySelector('.current-game-seat-name')?.textContent).toBe('Poster');
    expect(card?.querySelector('.current-game-seat.is-empty-seat')?.textContent).toBe(
      'Waiting for you',
    );
    const meta = card?.querySelector('.current-game-meta')?.textContent ?? '';
    expect(meta).toContain('3 days per move');
    expect(meta).toContain('Rated');
    expect(meta).toContain('you play Black');
    expect(meta).toContain('expires in');
    // A directed challenge is not on the open board, so no "Open seek" tag.
    expect(card?.querySelector('.current-game-kind')).toBeNull();
    expect(card?.querySelector('a.current-game-open')?.getAttribute('href')).toBe(
      '/challenge/seek-in-1',
    );
    const labels = [...(card?.querySelectorAll('.current-game-seek-action button') ?? [])].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(['Accept', 'Decline']);
  });

  it('gives the buttons their own bottom row, so the seat row holds only the name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => incomingResponse([xiangqiChallenge])),
    );
    const host = document.createElement('section');
    await renderIncomingChallenges(host);
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-in-1"]');
    const name = card?.querySelector('.current-game-seat-name');
    const seatRow = name?.closest('.current-game-seat');
    // The name used to share its row with Accept and Decline and truncated.
    expect(seatRow?.querySelector('button')).toBeNull();
    expect(seatRow?.querySelector('.current-game-seek-action')).toBeNull();
    const row = card?.querySelector('.current-game-seek-actions');
    expect(row?.parentElement).toBe(card);
    // Under the meta line, the last row before the (hidden) error line.
    expect(row?.previousElementSibling?.classList.contains('current-game-meta')).toBe(true);
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Accept',
      'Decline',
    ]);
  });

  it('draws the board from your side with your seat at the bottom and the challenger on top', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => incomingResponse([xiangqiChallenge])),
    );
    const host = document.createElement('section');
    await renderIncomingChallenges(host);
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-in-1"]');
    // The challenger plays Red, so you play Black: the second side.
    expect(card?.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
      'second',
    );
    const order = [...(card?.children ?? [])]
      .filter((el) => el.matches('.current-game-seat, .current-game-board'))
      .map((el) =>
        el.classList.contains('current-game-board')
          ? 'board'
          : el.classList.contains('is-empty-seat')
            ? 'you'
            : 'challenger',
      );
    expect(order).toEqual(['challenger', 'board', 'you']);
  });

  it('keeps the first side for random colours but still puts your seat at the bottom', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => incomingResponse([{ ...xiangqiChallenge, preferredColor: 'random' }])),
    );
    const host = document.createElement('section');
    await renderIncomingChallenges(host);
    const card = host.querySelector<HTMLElement>('[data-seek-id="seek-in-1"]');
    expect(card?.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
      undefined,
    );
    const seats = [...(card?.querySelectorAll(':scope > .current-game-seat') ?? [])];
    expect(seats.map((el) => el.classList.contains('is-empty-seat'))).toEqual([false, true]);
  });

  it('is hidden entirely when nothing is waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => incomingResponse([])),
    );
    const host = document.createElement('section');
    host.hidden = false;
    const counts: number[] = [];
    await renderIncomingChallenges(host, (n) => counts.push(n));
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
    expect(counts).toEqual([0]);
  });

  it('stays hidden when the list cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    );
    const host = document.createElement('section');
    await renderIncomingChallenges(host);
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  it('Accept posts the accept and goes to the room', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ url: '/room/abc' }), { status: 200 });
      }
      return incomingResponse([xiangqiChallenge]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    const host = document.createElement('section');
    await renderIncomingChallenges(host, undefined, { navigate });
    const accept = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Accept',
    );
    accept?.click();
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/seek-in-1/accept', {
        method: 'POST',
      }),
    );
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/room/abc'));
  });

  it('Decline posts the decline and removes the card, and the last one takes the section', async () => {
    const second = { ...xiangqiChallenge, id: 'seek-in-2', challengerName: 'Other' };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url === '/api/notifications') return new Response('{}', { status: 401 });
      return incomingResponse([xiangqiChallenge, second]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('section');
    document.body.append(host);
    const counts: number[] = [];
    await renderIncomingChallenges(host, (n) => counts.push(n));

    const declineIn = (id: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(`[data-seek-id="${id}"] button`)].find(
        (button) => button.textContent === 'Decline',
      );

    declineIn('seek-in-1')?.click();
    await vi.waitFor(() => expect(host.querySelector('[data-seek-id="seek-in-1"]')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/seek-in-1/decline', {
      method: 'POST',
    });
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.correspondence-count')?.textContent).toBe('1');
    expect(host.querySelector('[data-seek-id="seek-in-2"]')).not.toBeNull();

    declineIn('seek-in-2')?.click();
    await vi.waitFor(() => expect(host.hidden).toBe(true));
    expect(host.childElementCount).toBe(0);
    expect(counts).toEqual([2, 1, 0]);
    host.remove();
  });

  it('a failed Decline keeps the card and says so', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
        : incomingResponse([xiangqiChallenge]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('section');
    document.body.append(host);
    await renderIncomingChallenges(host);
    const decline = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Decline',
    );
    decline?.click();
    await vi.waitFor(() => expect(decline?.disabled).toBe(false));
    expect(host.querySelector('[data-seek-id="seek-in-1"]')).not.toBeNull();
    const error = host.querySelector<HTMLElement>('.correspondence-seek-error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe('Could not decline. Try again.');
    host.remove();
  });
});
