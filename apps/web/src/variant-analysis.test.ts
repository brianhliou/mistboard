import { normalizeStartFen } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VARIANTS, type AnalysisVariantId } from './analysis-catalog.js';
import { mountVariantAnalysisPage } from './variant-analysis.js';

// The /analysis/<variant> ingress for the seven non-xiangqi boards (jsdom; the
// wasm engines never load here). The contract under test is the URL:
//   - a hidden-deal variant always ends up with a six-field DEALT fen in ?fen=
//     (a bare route mints one, a public paste is sampled once and pinned, a
//     dealt fen is honoured verbatim), while the FEN box shows the PUBLIC fen;
//   - ?moves= seeds the tree; an invalid ?fen= degrades to a fresh board;
//   - every board carries the editable FEN + moves import block.

type VariantId = Exclude<AnalysisVariantId, 'xiangqi'>;

const DEALT = ['banqi', 'jieqi', 'jungle-flip'] as const satisfies readonly VariantId[];
type DealtId = (typeof DEALT)[number];

// Public five-field starts (no hidden field) and a matching hidden field whose
// first-in-board-order tile (or, for jieqi, the a1 home square) is pinned.
const PUBLIC_START: Record<DealtId, string> = {
  banqi: 'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
  jieqi:
    'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1',
  'jungle-flip': 'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0',
};
const PINNED_HIDDEN: Record<DealtId, string> = {
  // a4 (first square in board order) is the red general.
  banqi: 'GAAEERRHHCCSSSSSgaaeerrhhccsssss',
  // Black home squares first (rank 10, 8, 7), then red (rank 4, 3, 1): a1 is a horse.
  jieqi: 'rnbaabnrccpppppPPPPPCCNRABABRN',
  // a4 (first square in board order) is the red rat.
  'jungle-flip': 'RCDWPTLErcdwptle',
};
// A mid-game PUBLIC fen with revealed pieces, to prove the placement is honoured.
const PUBLIC_MIDGAME: Record<DealtId, string> = {
  banqi: 'G2X4/8/8/3XX2S r R1s2 3 12',
  jieqi: '4k4/9/9/9/9/9/9/9/9/X3K3R w R1 0 1',
  'jungle-flip': 'RXXX/XXXX/XXXX/XXXc r C1D1W1P1T1L1E1r1d1w1p1t1l1e1 0 3',
};

function picker(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'analysis-variant-picker';
  return el;
}

async function mountAt(id: VariantId, query = ''): Promise<HTMLElement> {
  window.history.replaceState(null, '', `/analysis/${id}${query}`);
  const root = document.createElement('div');
  document.body.append(root);
  await mountVariantAnalysisPage(root, id, picker());
  return root;
}

const urlFen = (): string | null => new URLSearchParams(window.location.search).get('fen');
const fenBox = (root: HTMLElement): HTMLInputElement =>
  root.querySelector<HTMLInputElement>('.review-import input')!;
const clickSquare = (root: HTMLElement, square: string): void => {
  const hit = root.querySelector(`[data-square="${square}"]`);
  if (!hit) throw new Error(`square ${square} not found`);
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const menuItem = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('.review-menu__item')].find(
    (b) => b.textContent?.trim() === label,
  );

/** The first action on each dealt variant's bare-route root (all face-down): a
 *  flip for the two symmetric variants, a dark piece's first step for jieqi. */
const FIRST_MOVE: Record<(typeof DEALT)[number], { clicks: string[]; token: string }> = {
  banqi: { clicks: ['a1'], token: 'a1-a1' },
  'jungle-flip': { clicks: ['a1'], token: 'a1-a1' },
  jieqi: { clicks: ['a1', 'a2'], token: 'a1-a2' },
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('hidden-deal analysis boards', () => {
  for (const id of DEALT) {
    describe(id, () => {
      it('mints a deal on the bare route and pins it as a six-field fen', async () => {
        const root = await mountAt(id);
        expect(root.querySelector('.review-move-list')).not.toBeNull();
        const pinned = urlFen();
        expect(pinned, 'dealt fen in URL').not.toBeNull();
        const fields = pinned!.split(' ');
        expect(fields).toHaveLength(6);
        // The FEN box shows the PUBLIC form: the same position minus the deal.
        expect(fenBox(root).value).toBe(fields.slice(0, 5).join(' '));
        // Pinned means canonical: normalizing it changes nothing.
        expect(normalizeStartFen(id, pinned!)).toEqual({ ok: true, fen: pinned });
      });

      it('renders a public fen and gains the sixth field', async () => {
        const publicFen = PUBLIC_MIDGAME[id];
        const root = await mountAt(id, `?fen=${encodeURIComponent(publicFen)}`);
        const pinned = urlFen()!;
        expect(pinned.split(' ')).toHaveLength(6);
        // The public prefix is the writer's canonical spelling of the paste
        // (jieqi's writer lists every pool entry, zeros included).
        const canonical = normalizeStartFen(id, publicFen);
        const publicCanonical = canonical.ok ? canonical.fen.split(' ').slice(0, 5).join(' ') : '';
        expect(pinned.split(' ').slice(0, 5).join(' ')).toBe(publicCanonical);
        expect(fenBox(root).value).toBe(publicCanonical);
        const board = root.querySelector('.review-board-host')!;
        if (id === 'banqi') {
          expect(board.querySelector('[aria-label="red general"]')).not.toBeNull();
          expect(board.querySelector('[aria-label="red soldier"]')).not.toBeNull();
          expect(board.innerHTML).toContain('banqi-back');
        } else if (id === 'jieqi') {
          expect(board.querySelector('[aria-label="red chariot"]')).not.toBeNull();
          expect(board.querySelector('[aria-label="red hidden piece"]')).not.toBeNull();
        }
      });

      it('a dealt fen reveals exactly the pinned identity', async () => {
        const dealt = `${PUBLIC_START[id]} ${PINNED_HIDDEN[id]}`;
        const root = await mountAt(id, `?fen=${encodeURIComponent(dealt)}`);
        // Honoured verbatim: no re-sampling.
        expect(urlFen()).toBe(dealt);
        const board = root.querySelector('.review-board-host')!;
        if (id === 'jieqi') {
          // No flip in jieqi: the dark piece on a1 reveals when it moves.
          clickSquare(root, 'a1');
          clickSquare(root, 'a2');
          expect(root.querySelector('.move-tree')?.textContent).toContain('a1-a2');
          expect(board.querySelector('[aria-label="red horse"]')).not.toBeNull();
          expect(fenBox(root).value).toContain('/N8/');
        } else {
          clickSquare(root, 'a4');
          expect(root.querySelector('.move-tree')?.textContent).toContain('a4');
          if (id === 'banqi') {
            expect(board.querySelector('[aria-label="red general"]')).not.toBeNull();
            expect(fenBox(root).value.startsWith('GXXXXXXX/')).toBe(true);
          } else {
            expect(fenBox(root).value.startsWith('RXXX/')).toBe(true);
          }
        }
      });

      it('seeds the move list from ?moves=', async () => {
        const dealt = `${PUBLIC_START[id]} ${PINNED_HIDDEN[id]}`;
        const moves = id === 'jieqi' ? 'a1-a2' : 'a4-a4';
        const root = await mountAt(
          id,
          `?fen=${encodeURIComponent(dealt)}&moves=${encodeURIComponent(moves)}`,
        );
        const label = id === 'jieqi' ? 'a1-a2' : 'a4';
        expect(root.querySelector('.move-tree')?.textContent).toContain(label);
        expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain(
          label,
        );
        expect(root.textContent).not.toMatch(/Truncated import/i);
        // The seed survives the URL pin (fen stays, moves stays).
        expect(urlFen()).toBe(dealt);
        expect(new URLSearchParams(window.location.search).get('moves')).toBe(moves);
      });

      it('mirrors the line on screen into ?moves= as it is played', async () => {
        const root = await mountAt(id);
        const moves = (): string | null => new URLSearchParams(window.location.search).get('moves');
        expect(moves()).toBeNull();
        for (const square of FIRST_MOVE[id].clicks) clickSquare(root, square);
        expect(moves()).toBe(FIRST_MOVE[id].token);
        // Stepping back to the root clears it again; the fen pin stays.
        root
          .querySelector<HTMLButtonElement>('.review-controls [aria-label="First move"]')
          ?.click();
        expect(moves()).toBeNull();
        expect(urlFen()!.split(' ')).toHaveLength(6);
      });

      it('degrades an invalid ?fen= to a fresh deal', async () => {
        const root = await mountAt(id, '?fen=not-a-fen');
        expect(root.querySelector('.review-move-list')).not.toBeNull();
        expect(urlFen()!.split(' ')).toHaveLength(6);
      });

      it('offers New deal and Board editor, not Analyse from here', async () => {
        const root = await mountAt(id);
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
        expect(menuItem(root, 'Analyse from here')).toBeUndefined();
        menuItem(root, 'New deal')!.click();
        expect(assign).toHaveBeenLastCalledWith(`/analysis/${id}`);
        menuItem(root, 'Board editor')!.click();
        const href = String(assign.mock.calls.at(-1)?.[0]);
        expect(href.startsWith(`/editor/${id}?fen=`)).toBe(true);
        // The editor link carries the PUBLIC fen only: no hidden identities.
        const fen = new URL(href, 'http://x').searchParams.get('fen')!;
        expect(fen.split(' ')).toHaveLength(5);
        expect(fen).toBe(urlFen()!.split(' ').slice(0, 5).join(' '));
      });
    });
  }

  it('Set position pins a public paste as a dealt fen; Import moves keeps the fen', async () => {
    const root = await mountAt('banqi');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const box = fenBox(root);
    box.value = PUBLIC_MIDGAME.banqi;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const setUrl = new URL(String(assign.mock.calls.at(-1)?.[0]), 'http://x');
    expect(setUrl.pathname).toBe('/analysis/banqi');
    expect(setUrl.searchParams.get('fen')!.split(' ')).toHaveLength(6);
    expect(setUrl.searchParams.get('fen')!.startsWith(`${PUBLIC_MIDGAME.banqi} `)).toBe(true);
    expect(setUrl.searchParams.has('moves')).toBe(false);
    // A bad paste is reported inline, not navigated.
    box.value = 'nonsense';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(root.querySelector('.review-import__error')?.textContent).toMatch(/ranks|FEN/i);

    const movesBox = root.querySelector<HTMLTextAreaElement>('.review-share__field--moves')!;
    movesBox.value = 'a4-a4, zz-zz';
    const importButton = [...root.querySelectorAll<HTMLButtonElement>('.review-share__copy')].find(
      (b) => b.textContent === 'Import moves',
    )!;
    importButton.click();
    const importUrl = new URL(String(assign.mock.calls.at(-1)?.[0]), 'http://x');
    expect(importUrl.searchParams.get('moves')).toBe('a4-a4');
    expect(importUrl.searchParams.get('fen')).toBe(urlFen());
  });
});

describe('perfect-info analysis boards', () => {
  it('jungle roots the tree at a ?fen= position without rewriting the URL', async () => {
    // Red elephant on a1, black rat on g9: nothing like the start position.
    const fen = '6r/7/7/7/7/7/7/7/E6 r 0 1';
    const root = await mountAt('jungle', `?fen=${encodeURIComponent(fen)}`);
    const canonical = normalizeStartFen('jungle', fen);
    expect(canonical.ok).toBe(true);
    expect(fenBox(root).value).toBe(canonical.ok ? canonical.fen : '');
    expect(urlFen()).toBe(fen);
    expect(root.querySelectorAll('[data-piece-square]').length).toBe(2);
    expect(menuItem(root, 'Board editor')).toBeDefined();
    expect(menuItem(root, 'New deal')).toBeUndefined();
  });

  it('jungle seeds ?moves= from the ?fen= root', async () => {
    const fen = '6r/7/7/7/7/7/7/7/E6 r 0 1';
    const root = await mountAt('jungle', `?fen=${encodeURIComponent(fen)}&moves=a1-a2 g9-g8`);
    expect(root.querySelector('.move-tree')?.textContent).toContain('a1-a2');
    expect(root.querySelector('.move-tree')?.textContent).toContain('g9-g8');
    expect(root.textContent).not.toMatch(/Truncated import/i);
  });

  it('jungle degrades an invalid ?fen= to the standard start', async () => {
    const root = await mountAt('jungle', '?fen=garbage');
    expect(root.querySelector('.review-move-list')).not.toBeNull();
    expect(root.querySelectorAll('[data-piece-square]').length).toBe(16);
  });
});

// /analysis/duck-xiangqi had no position editor behind it until 2026-09-10 (the
// duck is not a piece, so the editor's model could not hold it). It has one now,
// and the hand-off must carry the SEVENTH FEN field: an editor link that dropped
// the duck would open a different position.
describe('duck xiangqi analysis board', () => {
  const DUCK_ON_E6 = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 e6';

  it('mounts the duck presentation and hands off to the board editor', async () => {
    const root = await mountAt('duck-xiangqi');
    // The duck presentation, not another xiangqi-family board: its own board
    // host class and its own duck layer.
    expect(root.querySelector('.duck-xiangqi-live-board'), 'duck board host').not.toBeNull();
    expect(root.querySelector('.dkx-live-duck'), 'duck layer').not.toBeNull();
    expect(root.querySelectorAll('[data-piece-square]').length).toBe(32);
    expect(root.querySelector('.review-move-list')).not.toBeNull();
    expect(menuItem(root, 'Board editor'), 'editor hand-off').toBeDefined();
    expect(menuItem(root, 'New deal')).toBeUndefined();
  });

  it('keeps the duck from the seventh fen field', async () => {
    const root = await mountAt('duck-xiangqi', `?fen=${encodeURIComponent(DUCK_ON_E6)}`);
    // The seventh field is part of the position, so it survives the round trip
    // onto the board (a six-field paste would put the duck nowhere).
    expect(root.querySelector('[data-duck-square="e6"]'), 'duck on e6').not.toBeNull();
    expect(normalizeStartFen('duck-xiangqi', DUCK_ON_E6)).toEqual({ ok: true, fen: DUCK_ON_E6 });
    // A perfect-info board leaves ?fen= as shared: no deal to pin.
    expect(urlFen()).toBe(DUCK_ON_E6);
    // The FEN box stays empty on an engine-less board (tree-review fills it from
    // the engine presentation); the box is still editable for Set position.
    expect(fenBox(root).readOnly).toBe(false);
  });

  it('a two-phase turn reaches the tree as one move and one ?moves= token', async () => {
    const root = await mountAt('duck-xiangqi');
    // Phase one: the piece move alone changes nothing the tree can see.
    clickSquare(root, 'c4');
    clickSquare(root, 'c5');
    expect(urlFen()).toBeNull();
    expect(new URLSearchParams(window.location.search).get('moves')).toBeNull();
    // Phase two completes the turn.
    clickSquare(root, 'e6');
    expect(new URLSearchParams(window.location.search).get('moves')).toBe('c4-c5@e6');
    expect(root.querySelector('.move-tree')?.textContent).toContain('c4-c5@e6');
  });

  it('seeds ?moves= from a duck-carrying line', async () => {
    const root = await mountAt('duck-xiangqi', '?moves=c4-c5@e6 c7-c6@e5');
    const tree = root.querySelector('.move-tree')?.textContent ?? '';
    expect(tree).toContain('c4-c5@e6');
    expect(tree).toContain('c7-c6@e5');
    expect(root.textContent).not.toMatch(/Truncated import/i);
  });
});

describe('import block', () => {
  const ids = ANALYSIS_VARIANTS.map((variant) => variant.id).filter(
    (id): id is VariantId => id !== 'xiangqi',
  );
  for (const id of ids) {
    it(`${id} carries an editable FEN box and a moves import`, async () => {
      const root = await mountAt(id);
      expect(root.querySelector('.review-import')).not.toBeNull();
      expect(fenBox(root).readOnly).toBe(false);
      expect(root.textContent).toContain('Set position');
      expect(root.textContent).toContain('Import moves');
    });
  }
});
