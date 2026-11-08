import { createInitialJieqiState, jieqiTruthView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

const watch = vi.hoisted(() => ({
  ply: 0,
  options: null as { onPlyChange: (ply: number, max: number) => void } | null,
  overlay: null as ((ply: number) => unknown) | null,
}));
vi.mock('../variant-tenant/registry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../variant-tenant/registry.js')>()),
  webVariantTenantForSpecId: () => ({
    watch: {
      mountReplay: async (host: HTMLElement, _id: string, options: typeof watch.options) => {
        watch.options = options;
        watch.ply = 0;
        host.innerHTML = '<svg><g/></svg>';
        options?.onPlyChange(0, 2);
        return {
          destroy() {},
          plyCount: () => 2,
          moveEntries: () => [
            { ply: 1, label: 'a4-a5' },
            { ply: 2, label: 'a7-a6' },
          ],
          playedMoves: () => [
            { ply: 1, from: 'a4', to: 'a5' },
            { ply: 2, from: 'a7', to: 'a6' },
          ],
          jumpToPly(ply: number) {
            watch.ply = ply;
            options?.onPlyChange(ply, 2);
            watch.overlay?.(ply);
          },
          setBoardOverlay(overlay: typeof watch.overlay) {
            watch.overlay = overlay;
            overlay?.(watch.ply);
          },
        };
      },
    },
  }),
}));

import { mountEmbedGame } from './embed-game-page.js';

function fixture(noAnalysis = false, incomplete = false) {
  const state = createInitialJieqiState('embed-analysis');
  const postgame = {
    history: { truth: [{ ply: 0, view: jieqiTruthView(state) }] },
    timeline: [
      { type: 'move-played', move: { from: 'a4', to: 'a5' } },
      { type: 'move-played', move: { from: 'a7', to: 'a6' } },
    ],
  };
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: options?.method ?? 'GET' });
      if (url === '/api/games/jq_fixture')
        return new Response(
          JSON.stringify({
            game: { roomId: 'jq_fixture', variant: 'jieqi', result: 'black-wins' },
          }),
        );
      if (url.endsWith('/analysis'))
        return noAnalysis
          ? new Response(null, { status: 204 })
          : new Response(
              JSON.stringify({
                engineId: 'pikafish-jieqi',
                depth: 12,
                plies: [
                  { ply: 0, cp: 0, mate: null, best: null },
                  { ply: 1, cp: 100, mate: null, best: null },
                  ...(incomplete ? [] : [{ ply: 2, cp: -100, mate: null, best: null }]),
                ],
              }),
            );
      if (url.endsWith('/decisions'))
        return new Response(
          JSON.stringify({
            engineId: 'pikafish-jieqi',
            depth: 12,
            decisions: [{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 60 }],
          }),
        );
      if (url === '/api/jieqi/games/jq_fixture') return new Response(JSON.stringify(postgame));
      return new Response(null, { status: 404 });
    }),
  );
  return calls;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  watch.overlay = null;
  watch.options = null;
});
describe('stored analysis in finished Jieqi game embeds', () => {
  it('stacks from the padded frame width, including just above the viewport breakpoint', async () => {
    fixture();
    vi.stubGlobal('innerWidth', 480);
    let width = 446;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, 0, this.classList.contains('embed-frame') ? width : 0, 900);
    });
    for (const stacked of [true, false]) {
      const root = document.createElement('div');
      document.body.append(root);
      await mountEmbedGame(root, { roomId: 'jq_fixture' });
      expect(root.querySelector('.embed-card')?.classList.contains('embed-card--stacked')).toBe(
        stacked,
      );
      width = 500;
    }
  });
  it('adds a scrubber and reveal luck without computing or fetching the public deal twice', async () => {
    const calls = fixture();
    const root = document.createElement('div');
    document.body.append(root);
    await mountEmbedGame(root, { roomId: 'jq_fixture' }, { startPly: 0 });
    const graph = root.querySelector<HTMLElement>('.embed-score-chart')!;
    expect(graph).not.toBeNull();
    expect(graph.dataset.ply).toBe('0');
    expect(root.querySelector('[data-ply="1"]')?.textContent).toContain('🎲 +10%');
    expect(JSON.stringify(watch.overlay?.(1))).toContain('"kind":"luck"');
    expect(JSON.stringify(watch.overlay?.(1))).toContain('"luck":10');
    watch.options?.onPlyChange(2, 2);
    expect(graph.dataset.ply).toBe('2');
    expect(calls.filter((call) => call.url === '/api/jieqi/games/jq_fixture')).toHaveLength(1);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it('keeps the plain replay for uncached analysis and refuses an incomplete graph', async () => {
    for (const [missing, incomplete] of [
      [true, false],
      [false, true],
    ]) {
      fixture(missing, incomplete);
      const root = document.createElement('div');
      await mountEmbedGame(root, { roomId: 'jq_fixture' });
      expect(root.querySelector('.embed-card')).not.toBeNull();
      expect(root.querySelector('.embed-score-chart')).toBeNull();
    }
  });
});
