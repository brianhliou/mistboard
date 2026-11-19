import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountWithSeeks(seeks: Array<Record<string, unknown>>): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/correspondence/seeks') return Response.json({ seeks });
      if (url.startsWith('/api/games/current')) return Response.json({ games: [] });
      return new Response('{}', { status: 503 });
    }),
  );
  const { mountCurrentGames } = await import('./current-games.js');
  const root = document.createElement('main');
  document.body.append(root);
  await mountCurrentGames(root);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

const openSeek = { id: 'seek_1', gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Erin' };

it('says the correspondence move deadline once under the open seeks, not per card', async () => {
  const root = await mountWithSeeks([
    { ...openSeek, isMine: false },
    { ...openSeek, id: 'seek_2', daysPerMove: 1, isMine: false },
  ]);
  const playing = root.querySelector<HTMLElement>('[data-section="playing"]');
  expect(playing?.hidden).toBe(false);
  expect(playing?.querySelector('.current-games-grid .correspondence-deadline-notice')).toBeNull();
  const lines = playing?.querySelectorAll<HTMLElement>('.correspondence-deadline-list');
  expect(lines).toHaveLength(1);
  expect(lines?.[0]?.hidden).toBe(false);
  expect(lines?.[0]?.textContent).toBe(
    'Every move has a deadline. Miss one and you lose the game.',
  );
  root.remove();
  await Promise.resolve();
});

it('keeps the deadline line hidden when the only open seek is your own', async () => {
  const root = await mountWithSeeks([{ ...openSeek, isMine: true }]);
  const line = root.querySelector<HTMLElement>(
    '[data-section="playing"] .correspondence-deadline-list',
  );
  expect(line?.hidden).toBe(true);
  root.remove();
  await Promise.resolve();
});

it('links Play now directly to the lobby', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  const { mountCurrentGames } = await import('./current-games.js');
  const root = document.createElement('main');
  document.body.append(root);
  await mountCurrentGames(root);

  expect(root.querySelector('.current-games-actions a')?.getAttribute('href')).toBe('/');
  // Disconnecting the page invokes its normal timer/observer cleanup.
  root.remove();
  await Promise.resolve();
});
