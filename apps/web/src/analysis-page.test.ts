import { describe, expect, it } from 'vitest';
import { ANALYSIS_VARIANTS } from './analysis-catalog.js';
import { mountAnalysisPage } from './analysis-page.js';
import { variantPublicSurfaceEnabled } from './variant-public-surfaces.js';

// End-to-end wiring (jsdom): every catalog variant mounts a working analysis
// board — the variant dropdown (with the current variant selected), the meta
// card, and the tree review's move list. This is the registry-driven
// conformance test for the /analysis surface: a catalog entry whose loader or
// review mount breaks fails here, not in prod.

describe('analysis page', () => {
  for (const variant of ANALYSIS_VARIANTS) {
    it(`mounts the ${variant.id} analysis board with the variant picker`, async () => {
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
        const expected = ANALYSIS_VARIANTS.filter(
          (entry) => entry.id === variant.id || variantPublicSurfaceEnabled(entry.id),
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
        // Every analysis board carries the FEN + moves import block, and the
        // FEN box is editable (position input is a catalog-wide contract).
        expect(root.querySelector('.review-import'), 'import block').not.toBeNull();
        expect(root.querySelector<HTMLInputElement>('.review-import input')?.readOnly).toBe(false);
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
// That branch is real and still in analysis-catalog.ts, but it is currently
// UNREACHABLE from a test: duck xiangqi was the last unlaunched analysis
// variant, and it launched. Asserting "some variant is absent" would now pass
// by naming any string at all. What is left is the half that does hold, across
// every variant in the catalog. When the next unlaunched variant lands, restore
// a case that pins it by name.
describe('analysis variant picker', () => {
  it('offers every launched variant, from any board', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    try {
      await mountAnalysisPage(root, 'xiangqi');
      const select = root.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
      const offered = [...(select?.options ?? [])].map((option) => option.value);
      expect(offered).toEqual(ANALYSIS_VARIANTS.map((variant) => variant.id));
    } finally {
      root.remove();
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
