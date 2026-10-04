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
