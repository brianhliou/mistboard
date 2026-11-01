import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VARIANTS, analysisVariantFromPath } from './analysis-catalog.js';
import { buildVariantPicker, mountAnalysisPage } from './analysis-page.js';
import { setResolvedAdmin, writeAdminHint } from './signed-in-state.js';
import { variantPublicSurfaceEnabled } from './variant-public-surfaces.js';

beforeEach(() => {
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
  setResolvedAdmin(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
});

afterEach(() => {
  setResolvedAdmin(undefined);
  writeAdminHint(false);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('Gomoku analysis admission and offerings', () => {
  it('recognizes the route independently of viewer admission', () => {
    expect(analysisVariantFromPath('/analysis/gomoku')).toBe('gomoku');
    expect(analysisVariantFromPath('/analysis/gomoku/extra')).toBeNull();
  });

  it.each([undefined, false])(
    'refuses a direct mount for admin=%s with the flag off',
    async (admin) => {
      setResolvedAdmin(admin);
      writeAdminHint(false);
      const worker = vi.fn();
      vi.stubGlobal('Worker', worker);
      const root = document.createElement('div');
      document.body.append(root);
      await mountAnalysisPage(root, 'gomoku');
      expect(root.querySelector('h1')?.textContent).toBe('Gomoku unavailable');
      expect(root.textContent).toContain('This route is not enabled in this build.');
      expect(root.querySelector('.review-shell')).toBeNull();
      expect(root.querySelector('.analysis-variant-picker')).toBeNull();
      expect(worker).not.toHaveBeenCalled();
    },
  );

  it('admits an admin to the empty tree board with local analysis off', async () => {
    setResolvedAdmin(true);
    const root = document.createElement('div');
    document.body.append(root);
    await mountAnalysisPage(root, 'gomoku');
    expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    expect(root.querySelector('.analysis-variant-picker select')?.getAttribute('aria-label')).toBe(
      'Analysis variant',
    );
    expect(root.querySelector<HTMLSelectElement>('.analysis-variant-picker select')?.value).toBe(
      'gomoku',
    );
    expect(root.querySelector('.engine-panel__switch')?.getAttribute('aria-checked')).toBe('false');
    expect(root.querySelector('.review-eval-bar')).not.toBeNull();
    expect(root.querySelector('.review-move-list')).not.toBeNull();
    const menu = root.querySelector('.move-nav-menu');
    expect(menu?.textContent ?? '').not.toMatch(/Board editor|Study|Flip board/);
    expect(root.querySelector('a[href^="/editor/gomoku"]')).toBeNull();
    expect(root.querySelector('[data-analysis-bar="flip"]')).toBeNull();
    root
      .querySelector('[data-square="a1"] .gomoku-hit')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('[data-piece-square="a1"]')).not.toBeNull();
  });

  it.each([
    { flag: 'false', admin: false, offered: false },
    { flag: 'false', admin: true, offered: true },
    { flag: 'true', admin: false, offered: true },
  ])('offers Gomoku in the analysis picker only under its gate: %j', ({ flag, admin, offered }) => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', flag);
    setResolvedAdmin(admin);
    const picker = buildVariantPicker('xiangqi');
    expect(!!picker.querySelector('option[value="gomoku"]')).toBe(offered);
    // The current-variant exception must never advertise a denied Gomoku board.
    expect(!!buildVariantPicker('gomoku').querySelector('option[value="gomoku"]')).toBe(offered);
    expect(
      buildVariantPicker('xiangqi', '/editor').querySelector('option[value="gomoku"]'),
    ).toBeNull();
  });

  it('does not let a stale admin hint offer Gomoku after player auth resolves', () => {
    writeAdminHint(true);
    setResolvedAdmin(false);
    expect(buildVariantPicker('xiangqi').querySelector('option[value="gomoku"]')).toBeNull();
  });
});

// End-to-end wiring (jsdom): every catalog variant mounts a working analysis
// board — the variant dropdown (with the current variant selected), the meta
// card, and the tree review's move list. This is the registry-driven
// conformance test for the /analysis surface: a catalog entry whose loader or
// review mount breaks fails here, not in prod.

describe('analysis page', () => {
  for (const variant of ANALYSIS_VARIANTS) {
    it(`mounts the ${variant.id} analysis board with the variant picker`, async () => {
      // Capability coverage includes the hidden board, under its real gate.
      setResolvedAdmin(variant.id === 'gomoku');
      const root = document.createElement('div');
      document.body.append(root);
      try {
        await mountAnalysisPage(root, variant.id);

        const select = root.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
        expect(select, 'variant dropdown').not.toBeNull();
        expect(select!.value).toBe(variant.id);
        // Every LAUNCHED variant, plus this board's own even when it is not
        // launched yet. The dropdown stopped being "one option per catalog
        // entry" when unlaunched boards became reachable but unadvertised.
        const expected = ANALYSIS_VARIANTS.filter((entry) =>
          entry.id === 'gomoku'
            ? variant.id === 'gomoku'
            : entry.id === variant.id || variantPublicSurfaceEnabled(entry.id),
        );
        expect(select!.options.length).toBe(expected.length);

        // The selected option carries the site label.
        expect(select!.selectedOptions[0]?.textContent).toBe(variant.label);

        // The tree review mounted: a move list ready for branching.
        expect(root.querySelector('.review-move-list'), 'move list').not.toBeNull();
        // All analysis variants share one board-perimeter contract, including
        // fog variants that do not yet mount an eval gauge.
        expect(root.classList.contains('analysis-route')).toBe(true);
        expect(root.querySelector('.review-shell--analysis')).not.toBeNull();
        expect(root.querySelector('.review-shell--game')).toBeNull();
        // Lichess minimalism: the dropdown IS the left rail — no meta card.
        expect(root.querySelector('.game-meta-card')).toBeNull();
        // Gomoku is a gated tree board only; it has no FEN importer/editor.
        if (variant.id === 'gomoku') {
          expect(root.querySelector('.review-import')).toBeNull();
        } else {
          expect(root.querySelector('.review-import'), 'import block').not.toBeNull();
          expect(root.querySelector<HTMLInputElement>('.review-import input')?.readOnly).toBe(
            false,
          );
        }
      } finally {
        root.remove();
      }
    });
  }
});

// The dropdown is a public surface. An unlaunched variant keeps a working board
// at its own URL but is not OFFERED, so nothing advertises it before it
// launches.
//
// The retired variants pin the hidden half by name: Fortress and Atomic
// Xiangqi (retired 2026-10-11) are absent from the picker on any other board
// and present on their own, so a finished game's analysis link still opens.
describe('analysis variant picker', () => {
  it('offers public variants without the retired or gated ones', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    try {
      await mountAnalysisPage(root, 'xiangqi');
      const select = root.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
      const offered = [...(select?.options ?? [])].map((option) => option.value);
      const hidden = ['fortress-xiangqi', 'atomic-xiangqi', 'gomoku'];
      for (const id of hidden) expect(offered).not.toContain(id);
      expect(offered).toEqual(
        ANALYSIS_VARIANTS.map((variant) => variant.id).filter((id) => !hidden.includes(id)),
      );
    } finally {
      root.remove();
    }
  });

  it('keeps a retired variant selected on its own board', async () => {
    for (const id of ['fortress-xiangqi', 'atomic-xiangqi'] as const) {
      const root = document.createElement('div');
      document.body.append(root);
      try {
        await mountAnalysisPage(root, id);
        const select = root.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
        expect(select?.value).toBe(id);
      } finally {
        root.remove();
      }
    }
  });

  it('lists and selects the variant being viewed', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    try {
      await mountAnalysisPage(root, 'duck-xiangqi');
      const select = root.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
      expect([...(select?.options ?? [])].map((option) => option.value)).toContain('duck-xiangqi');
      expect(select?.value).toBe('duck-xiangqi');
    } finally {
      root.remove();
    }
  });
});
