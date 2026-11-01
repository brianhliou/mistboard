import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  type GomokuOpening,
  normalizeStartFen,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VARIANTS, type AnalysisVariantId } from './analysis-catalog.js';
import {
  createGomokuImportPanel,
  gomokuAnalysisHref,
  parseGomokuExport,
  readGomokuAnalysisGame,
} from './gomoku-analysis-import.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import { setResolvedAdmin } from './signed-in-state.js';
import { mountVariantAnalysisPage } from './variant-analysis.js';

// The /analysis/<variant> ingress for the seven non-xiangqi boards (jsdom; the
// wasm engines never load here). The contract under test is the URL:
//   - a hidden-deal variant always ends up with a six-field DEALT fen in ?fen=
//     (a bare route mints one, a public paste is sampled once and pinned, a
//     dealt fen is honoured verbatim), while the FEN box shows the PUBLIC fen;
//   - ?moves= seeds the tree; an invalid ?fen= degrades to a fresh board;
//   - FEN-capable boards carry the editable FEN + moves import block; the gated
//     Gomoku tree board deliberately has neither a FEN importer nor an editor.

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
  [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find(
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
  window.dispatchEvent(new Event('pagehide'));
  setResolvedAdmin(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Gomoku direct analysis mount', () => {
  it('refuses the lower-level mount when the admin gate is closed', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    setResolvedAdmin(false);
    const root = await mountAt('gomoku');
    expect(root.textContent).toContain('Gomoku unavailable');
    expect(root.querySelector('.review-shell')).toBeNull();
  });

  it('admits a flagged viewer without adding editor, study or FEN-import capabilities', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
    setResolvedAdmin(false);
    const root = await mountAt('gomoku');
    expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
    expect(root.querySelector('.review-import textarea')).not.toBeNull();
    expect(root.querySelector('.review-import input')).toBeNull();
    expect(menuItem(root, 'Board editor')).toBeUndefined();
    expect(menuItem(root, 'Study')).toBeUndefined();
    expect(menuItem(root, 'Flip board')).toBeUndefined();
  });

  it('seeds canonical placements into the empty-root tree and truncates an illegal placement', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    setResolvedAdmin(true);
    const root = await mountAt('gomoku', '?moves=a1 b1 a1 c1');
    expect(
      [...root.querySelectorAll('[data-piece-square]')].map((stone) =>
        stone.getAttribute('data-piece-square'),
      ),
    ).toEqual(['a1', 'b1']);
    expect(root.querySelector('.review-move-list')?.textContent).toContain('b1');
    root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
  });

  it('imports a JSON export without losing its opening or mainline on navigation and side lines', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    setResolvedAdmin(true);
    const opening = GOMOKU_OPENINGS.find((entry) => entry.stones.length === 3)!;
    const exported = {
      schema_version: '1.1',
      variant: 'gomoku',
      opening,
      ply_count: 3,
      plies: ['a1', 'b1', 'a2'].map((uci, i) => ({
        ply: i + 1,
        mover: i % 2 ? 'black' : 'white',
        uci,
      })),
    };
    const root = await mountAt('gomoku');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const textarea = root.querySelector<HTMLTextAreaElement>('.review-import textarea')!;
    expect(textarea).not.toBeNull();
    textarea.value = JSON.stringify(exported);
    root.querySelector<HTMLButtonElement>('.review-import button')!.click();
    expect(assign).toHaveBeenCalledOnce();
    const url = new URL(String(assign.mock.calls[0]![0]), window.location.origin);
    const encodedGame = url.searchParams.get('game');
    url.searchParams.set('ply', '1');
    const arrived = await mountAt('gomoku', url.search);
    expect(arrived.querySelectorAll('[data-piece-square]')).toHaveLength(4);
    clickSquare(arrived, 'c1');
    expect(arrived.querySelector('[data-piece-square="c1"]')).not.toBeNull();
    expect(arrived.querySelector('.review-move-list')?.textContent).toContain('b1');
    arrived.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    arrived.querySelector<HTMLButtonElement>('[data-replay="latest"]')!.click();
    expect(arrived.querySelector('[data-piece-square="a2"]')).not.toBeNull();
    expect(arrived.querySelector('[data-piece-square="c1"]')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('game')).toBe(encodedGame);
    // A reload after navigation still has all three recorded placements.
    const reloaded = await mountAt('gomoku', window.location.search);
    expect(reloaded.querySelector('.review-move-list')?.textContent).toContain('a2');
    expect(reloaded.querySelectorAll('[data-piece-square]')).toHaveLength(6);
  });

  it.each(['{broken', JSON.stringify({ variant: 'xiangqi', plies: [] })])(
    'rejects invalid JSON without navigating: %s',
    async (json) => {
      vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
      setResolvedAdmin(true);
      const root = await mountAt('gomoku');
      const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
      const textarea = root.querySelector<HTMLTextAreaElement>('.review-import textarea')!;
      expect(textarea).not.toBeNull();
      textarea.value = json;
      root.querySelector<HTMLButtonElement>('.review-import button')!.click();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Invalid Gomoku JSON');
      expect(assign).not.toHaveBeenCalled();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    },
  );

  it('refuses a corrupt game handoff instead of replacing it with an empty board', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    setResolvedAdmin(true);
    const root = await mountAt('gomoku', '?game=%7Bbroken');
    expect(root.querySelector('.gomoku-live-board')).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Invalid Gomoku JSON');
    expect(root.querySelector('.review-import textarea')).not.toBeNull();
  });
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
    (id): id is Exclude<VariantId, 'gomoku'> => id !== 'xiangqi' && id !== 'gomoku',
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

function exported(
  opening: GomokuOpening = { stones: [], turn: 'black' },
  tokens = ['a1', 'b1', 'a2'],
) {
  return {
    schema_version: '1.1',
    game_id: 'gmk_import',
    variant: 'gomoku',
    // Same recording fields as buildTenantGamePublicationJson; no evaluations
    // or player metadata are needed to reproduce the game in analysis.
    opening,
    ply_count: tokens.length,
    plies: tokens.map((uci, i) => ({
      ply: i + 1,
      mover: i % 2 === 0 ? opening.turn : opening.turn === 'black' ? 'white' : 'black',
      uci,
      san: null,
      black_clock_ms_after: null,
      white_clock_ms_after: null,
    })),
  };
}

describe('Gomoku JSON import and handoff model', () => {
  it.each([0, 3, 4, 5])('replays a %i-stone opening and every exported placement', (count) => {
    const opening =
      count === 0
        ? ({ stones: [], turn: 'black' } as const)
        : GOMOKU_OPENINGS.find((entry) => entry.stones.length === count)!;
    const game = parseGomokuExport(JSON.stringify(exported(opening)))!;
    expect(game).not.toBeNull();
    expect(game.opening).toEqual({ stones: opening.stones, turn: opening.turn });
    expect(game.moves).toEqual([{ to: 'a1' }, { to: 'b1' }, { to: 'a2' }]);
    let state = createGomokuRoomState('test', game.opening);
    for (const move of game.moves) state = applyGomokuRoomMove(state, move);
    expect(state.ply).toBe(count + 3);
    const url = new URL(gomokuAnalysisHref(game, 1), 'https://mistboard.test');
    expect(url.searchParams.get('ply')).toBe('1');
    expect(readGomokuAnalysisGame(url.searchParams.get('game')!)).toEqual(game);
  });

  it('accepts an empty export, and a five on the last placement', () => {
    expect(parseGomokuExport(JSON.stringify(exported(undefined, [])))?.moves).toEqual([]);
    const moves = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1'];
    expect(parseGomokuExport(JSON.stringify(exported(undefined, moves)))?.moves).toHaveLength(9);
    expect(parseGomokuExport(JSON.stringify(exported(undefined, [...moves, 'e2'])))).toBeNull();
  });

  const invalid: Array<[string, (data: ReturnType<typeof exported>) => unknown]> = [
    ['wrong variant', (data) => ({ ...data, variant: 'xiangqi' })],
    ['unsupported version', (data) => ({ ...data, schema_version: '2' })],
    ['missing opening', (data) => ({ ...data, opening: undefined })],
    ['null opening', (data) => ({ ...data, opening: null })],
    ['unsupported rule', (data) => ({ ...data, opening: { ...data.opening, rule: 'renju' } })],
    [
      'invalid opening square',
      (data) => ({
        ...data,
        opening: { stones: [{ square: 'p1', color: 'black' }], turn: 'white' },
      }),
    ],
    [
      'invalid opening color',
      (data) => ({ ...data, opening: { stones: [{ square: 'h8', color: 'red' }], turn: 'white' } }),
    ],
    [
      'duplicate opening stones',
      (data) => ({
        ...data,
        opening: {
          stones: [
            { square: 'h8', color: 'black' },
            { square: 'h8', color: 'white' },
          ],
          turn: 'black',
        },
      }),
    ],
    ['wrong opening turn', (data) => ({ ...data, opening: { stones: [], turn: 'white' } })],
    ['wrong count', (data) => ({ ...data, ply_count: 2 })],
    ['missing plies', (data) => ({ ...data, plies: null })],
    ['invalid ply', (data) => ({ ...data, plies: [{ ...data.plies[0], ply: 2 }], ply_count: 1 })],
    [
      'wrong mover',
      (data) => ({ ...data, plies: [{ ...data.plies[0], mover: 'white' }], ply_count: 1 }),
    ],
    [
      'out-of-bounds move',
      (data) => ({ ...data, plies: [{ ...data.plies[0], uci: 'a16' }], ply_count: 1 }),
    ],
    [
      'non-string move',
      (data) => ({ ...data, plies: [{ ...data.plies[0], uci: {} }], ply_count: 1 }),
    ],
    ['duplicate placement', () => exported(undefined, ['a1', 'a1'])],
    [
      'opening already has five',
      (data) => ({
        ...data,
        opening: {
          stones: ['a1', 'b1', 'c1', 'd1', 'e1'].flatMap((square, i) => [
            { square, color: 'black' },
            { square: `${String.fromCharCode(97 + i)}3`, color: 'white' },
          ]),
          turn: 'black',
        },
      }),
    ],
    [
      'placement on opening',
      () => exported({ stones: [{ square: 'a1', color: 'black' }], turn: 'white' }),
    ],
  ];
  it.each(invalid)('rejects the whole export: %s', (_name, mutate) => {
    expect(parseGomokuExport(JSON.stringify(mutate(exported())))).toBeNull();
  });
  it.each(['', '{broken', 'null', '[]', 'true', '42'])('rejects non-export input %s', (text) => {
    expect(parseGomokuExport(text)).toBeNull();
    expect(readGomokuAnalysisGame(text)).toBeNull();
  });
  it('rejects corrupt compact handoffs and clamps selection to the complete game', () => {
    const game = parseGomokuExport(JSON.stringify(exported()))!;
    expect(readGomokuAnalysisGame(JSON.stringify({ ...game, moves: ['a1', 'a1'] }))).toBeNull();
    for (const [input, expected] of [
      [-1, 0],
      [999, 3],
      [Number.NaN, 3],
    ]) {
      expect(
        new URL(gomokuAnalysisHref(game, input), 'https://mistboard.test').searchParams.get('ply'),
      ).toBe(String(expected));
    }
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'translates JSON import, hint and validation in %s',
    async (locale: Locale) => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
      });
      await ensureLocaleCatalog(locale);
      const panel = createGomokuImportPanel();
      const input = panel.querySelector('textarea')!;
      expect(input.placeholder).toBe(t('analysis.gomokuJsonPlaceholder', {}, locale));
      expect(panel.querySelector('.review-import__hint')?.textContent).toBe(
        t('analysis.gomokuJsonHint', {}, locale),
      );
      expect(panel.querySelector('button')?.textContent).toBe(t('analysis.importJson', {}, locale));
      input.value = '{broken';
      panel.querySelector('button')!.click();
      expect(panel.querySelector('[role="alert"]')?.textContent).toBe(
        t('analysis.invalidGomokuJson', {}, locale),
      );
      if (locale !== 'en') expect(panel.textContent).not.toContain('Invalid');
    },
  );
});
