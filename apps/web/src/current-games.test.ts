import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
