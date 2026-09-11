// Standalone analysis boards for every non-xiangqi catalog variant: an
// interactive board branching into a tree, with the variant's in-browser engine
// where one exists. The heavy board/review stacks stay code-split: each case
// dynamic-imports its own review module. Xiangqi keeps its dedicated module
// (xiangqi-analysis.ts) for its multi-format move import.
//
// URL contract (the same anatomy as /analysis/xiangqi):
//   ?fen=    the start position. Perfect-info variants take the same FEN their
//            study chapters take (parsed with the same parser, invalid degrades
//            to the standard start). Hidden-deal variants take a DEALT fen
//            (dealt-fen.ts): the public engine fen plus a sixth field pinning
//            the identities under the face-down tiles. A public five-field paste
//            is accepted and its deal sampled once; a bare URL mints a random
//            deal. In every case the URL is then rewritten (replaceState) to the
//            canonical dealt fen, so a reload or a shared link reproduces the
//            exact deal, not a fresh one.
//   ?moves=  coordinate moves from that position, `from-to` tokens separated by
//            whitespace or commas (a flip is `a1-a1`). Unparsable tokens are
//            dropped; the tree truncates at the first illegal move itself.
//
// Two spellings of one position, deliberately: the FEN box under the board
// shows the PUBLIC engine fen (spoiler-free, what a player would type from a
// real game, what the engine is fed), while the URL carries the dealt fen (the
// exact-reproduction artifact). The box never leaks a hidden identity; the URL
// never forgets one.
//
// CSS here is the union the variants' postgame surfaces import; the JS chunks
// are what matter for weight, and those stay per-variant.

import './game-shell.css';
import './live-xiangqi.css';
import './landing.css';
import './game-route.css';
import './dark-xiangqi-postgame.css';
import './drop-mini-xiangqi.css';
import { normalizeStartFen } from '@mistboard/game';
import { type AnalysisVariantId, analysisVariantLabel } from './analysis-catalog.js';
import { t } from './i18n/catalog.js';
import { editorHref } from './review/position-links.js';
import type { AnalysisSource, TreeReviewConfig } from './review/tree-review.js';
import { buildNav } from './site-shell.js';

type VariantAnalysisId = Exclude<AnalysisVariantId, 'xiangqi'>;

/** Synthetic game id for the analysis truth state (state identity only, no room). */
const ANALYSIS_GAME_ID = 'analysis';

/** The slice of a tree adapter the URL ingress needs: parse a token against the
 *  position it is played from, then advance so the next token parses in context. */
type MoveCodec<Move, Truth> = {
  fromUci(uci: string, parentTruth: Truth): Move | null;
  isLegal(truth: Truth, move: Move): boolean;
  applyMove(truth: Truth, move: Move): Truth;
  toEngineUci(move: Move): string;
};

type ParseResult<Truth> = { ok: true; state: Truth } | { ok: false; error: string };

/** Resolve the root position from `?fen=`: a parsed position, or `fallback()`
 *  (the standard start, or a fresh random deal) when the parameter is absent or
 *  invalid. `custom` is true only when a fen actually seeded the root. */
function seedRoot<Truth>(
  fenParam: string | null,
  parse: (fen: string) => ParseResult<Truth>,
  fallback: () => Truth,
): { truth: Truth; custom: boolean } {
  const parsed = fenParam ? parse(fenParam) : null;
  return parsed?.ok ? { truth: parsed.state, custom: true } : { truth: fallback(), custom: false };
}

/** `?moves=` tokens to moves. The dash is cosmetic (`a1-b1` is the UCI `a1b1`),
 *  so it is stripped before the adapter's own parser runs. */
function movesFromParam<Move, Truth>(
  raw: string | null,
  codec: MoveCodec<Move, Truth>,
  rootTruth: Truth,
): Move[] {
  if (!raw) return [];
  const moves: Move[] = [];
  let truth = rootTruth;
  let legalSoFar = true;
  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const move = codec.fromUci(token.replace(/-/g, ''), truth);
    if (!move) continue;
    moves.push(move);
    // Keep parsing in context while the line is legal; after the first illegal
    // move the tree truncates anyway, so the stale context only affects tokens
    // that will never be played.
    if (legalSoFar && codec.isLegal(truth, move)) truth = codec.applyMove(truth, move);
    else legalSoFar = false;
  }
  return moves;
}

/** `from-to` token for the URL: the adapter's UCI with a dash after the from
 *  square (keeps any promotion suffix; a drop with no from square passes through). */
function moveToken<Move, Truth>(move: Move, codec: MoveCodec<Move, Truth>): string {
  const uci = codec.toEngineUci(move);
  const from = (move as { from?: unknown }).from;
  if (typeof from === 'string' && uci.startsWith(from)) return `${from}-${uci.slice(from.length)}`;
  return uci;
}

/** Mirror the line on screen into `?moves=` (replaceState, no history entry), so
 *  the address bar is the share link for the current position. An empty line
 *  drops the param, which keeps a fresh board's URL clean. */
function syncLineToUrl<Move, Truth>(codec: MoveCodec<Move, Truth>): (moves: Move[]) => void {
  return (moves) => {
    const url = new URL(window.location.href);
    if (moves.length === 0) url.searchParams.delete('moves');
    else url.searchParams.set('moves', moves.map((move) => moveToken(move, codec)).join(' '));
    if (url.toString() !== window.location.href) {
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };
}

/** Underboard FEN + moves boxes. Both submit by navigating to the shareable URL
 *  (the page re-mounts from it), so an imported line or position always has a
 *  link. The FEN box goes through normalizeStartFen: same validation and the
 *  same canonical spelling as a study chapter's start position. */
function makeImportPanel<Move, Truth>(
  id: VariantAnalysisId,
  codec: MoveCodec<Move, Truth>,
  rootTruth: Truth,
): NonNullable<TreeReviewConfig<Move, Truth>['importPanel']> {
  return {
    onImport: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return t('analysis.pasteGameToImport');
      const moves = movesFromParam(trimmed, codec, rootTruth);
      if (moves.length === 0) return 'No moves recognized.';
      const url = new URL(window.location.href);
      url.searchParams.set('moves', moves.map((move) => moveToken(move, codec)).join(' '));
      window.location.assign(url.toString());
      return null;
    },
    onImportFen: (fen) => {
      const trimmed = fen.trim();
      if (!trimmed) return t('analysis.pasteFenToSet');
      const normalized = normalizeStartFen(id, trimmed);
      if (!normalized.ok) return normalized.error;
      const url = new URL(window.location.href);
      url.searchParams.delete('moves');
      url.searchParams.set('fen', normalized.fen);
      window.location.assign(url.toString());
      return null;
    },
  };
}

/** Pin the canonical dealt fen in the URL without a navigation, so the deal on
 *  screen is the deal a reload or a copied link reproduces. */
function pinFenInUrl(fenParam: string | null, canonical: string): void {
  if (fenParam === canonical) return;
  const url = new URL(window.location.href);
  url.searchParams.set('fen', canonical);
  window.history.replaceState(window.history.state, '', url.toString());
}

export async function mountVariantAnalysisPage(
  root: HTMLElement,
  id: VariantAnalysisId,
  picker: HTMLElement,
): Promise<void> {
  const label = analysisVariantLabel(id);

  root.classList.add('landing-page');
  root.replaceChildren(buildNav());

  const params = new URLSearchParams(window.location.search);
  const fenParam = params.get('fen');
  const movesParam = params.get('moves');

  const base = {
    reviewSurface: 'analysis' as const,
    pageClassName: `${id}-review`,
    ariaLabel: `${label} analysis`,
    title: `${label} analysis`,
    boardAriaLabel: `${label} board`,
    // The variant dropdown is the ENTIRE left rail (lichess analysis): it rides
    // the metaCard slot, replacing the title/summary info card.
    metaCard: picker,
    // No roomless whole-game sweep yet outside xiangqi (the only client
    // analysis-source builder); the live engine panel still runs where the
    // variant has an in-browser engine.
    analysis: null as AnalysisSource | null,
  };
  const summaryFor = (custom: boolean): string => (custom ? 'Custom position' : 'Play a move');
  // A fresh random deal for the three hidden-deal variants (the same bag the
  // server draws from). Reached by the bare route and by the "New deal" item.
  const newDeal = (): void => window.location.assign(`/analysis/${id}`);

  switch (id) {
    case 'banqi': {
      // The board SVG's fills live in a page-level installed <style>, not the
      // imported CSS files — without the installer the board renders black.
      // Same contract as the postgame pages (banqi/jieqi/fortress below).
      const [
        { mountBanqiReview },
        { makeBanqiTreeAdapter },
        {
          banqiStateToDealtFen,
          banqiStateToEngineFen,
          createBanqiDeal,
          createInitialBanqiState,
          parseBanqiFen,
        },
        { installBanqiBoardStyles },
      ] = await Promise.all([
        import('./review/banqi-review.js'),
        import('./review/banqi-tree-adapter.js'),
        import('@mistboard/game'),
        import('./live-banqi-render.js'),
      ]);
      installBanqiBoardStyles();
      const { truth, custom } = seedRoot(
        fenParam,
        (fen) => parseBanqiFen(fen, { gameId: ANALYSIS_GAME_ID, rng: Math.random }),
        () => createInitialBanqiState(ANALYSIS_GAME_ID, createBanqiDeal(Math.random)),
      );
      const fen = banqiStateToDealtFen(truth);
      pinFenInUrl(fenParam, fen);
      const codec = makeBanqiTreeAdapter(ANALYSIS_GAME_ID, null);
      mountBanqiReview(root, ANALYSIS_GAME_ID, null, {
        ...base,
        summary: summaryFor(custom),
        root: { truth, fen },
        moves: movesFromParam(movesParam, codec, truth),
        importPanel: { ...makeImportPanel(id, codec, truth), hint: t('analysis.dealtFenHint') },
        onLineChange: syncLineToUrl(codec),
        boardEditorHref: (node) => editorHref(id, banqiStateToEngineFen(node)),
        newDeal,
      });
      return;
    }
    case 'jungle': {
      const [
        { mountJungleReview },
        { jungleTreeAdapter },
        { jungleStateToEngineFen, parseJungleFen },
      ] = await Promise.all([
        import('./review/jungle-review.js'),
        import('./review/jungle-tree-adapter.js'),
        import('@mistboard/game'),
      ]);
      const parsed = fenParam ? parseJungleFen(fenParam, ANALYSIS_GAME_ID) : null;
      const rootTruth = parsed?.ok ? parsed.state : jungleTreeAdapter.initialTruth();
      mountJungleReview(root, {
        ...base,
        summary: summaryFor(parsed?.ok === true),
        root: parsed?.ok
          ? { truth: parsed.state, fen: jungleStateToEngineFen(parsed.state) }
          : undefined,
        moves: movesFromParam(movesParam, jungleTreeAdapter, rootTruth),
        importPanel: makeImportPanel(id, jungleTreeAdapter, rootTruth),
        onLineChange: syncLineToUrl(jungleTreeAdapter),
        boardEditorHref: (node) => editorHref(id, jungleStateToEngineFen(node)),
      });
      return;
    }
    case 'jungle-flip': {
      const [
        { mountJungleFlipReview },
        { makeJungleFlipTreeAdapter },
        {
          createInitialJungleFlipState,
          createJungleFlipDeal,
          jungleFlipStateToDealtFen,
          jungleFlipStateToEngineFen,
          parseJungleFlipFen,
        },
      ] = await Promise.all([
        import('./review/jungle-flip-review.js'),
        import('./review/jungle-flip-tree-adapter.js'),
        import('@mistboard/game'),
      ]);
      const { truth, custom } = seedRoot(
        fenParam,
        (fen) => parseJungleFlipFen(fen, { gameId: ANALYSIS_GAME_ID, rng: Math.random }),
        () => createInitialJungleFlipState(ANALYSIS_GAME_ID, createJungleFlipDeal(Math.random)),
      );
      const fen = jungleFlipStateToDealtFen(truth);
      pinFenInUrl(fenParam, fen);
      const codec = makeJungleFlipTreeAdapter(ANALYSIS_GAME_ID, null);
      mountJungleFlipReview(root, ANALYSIS_GAME_ID, null, {
        ...base,
        summary: summaryFor(custom),
        root: { truth, fen },
        moves: movesFromParam(movesParam, codec, truth),
        importPanel: { ...makeImportPanel(id, codec, truth), hint: t('analysis.dealtFenHint') },
        onLineChange: syncLineToUrl(codec),
        boardEditorHref: (node) => editorHref(id, jungleFlipStateToEngineFen(node)),
        newDeal,
      });
      return;
    }
    case 'fortress-xiangqi': {
      const [
        { mountFortressXiangqiReview },
        { fortressXiangqiTreeAdapter },
        { fortressXiangqiEngineFen, parseFortressXiangqiFen },
        { installFortressXiangqiBoardStyles },
      ] = await Promise.all([
        import('./review/fortress-xiangqi-review.js'),
        import('./review/fortress-xiangqi-tree-adapter.js'),
        import('@mistboard/game'),
        import('./fortress-xiangqi-render.js'),
      ]);
      installFortressXiangqiBoardStyles();
      const parsed = fenParam ? parseFortressXiangqiFen(fenParam) : null;
      const rootTruth = parsed?.ok ? parsed.state : fortressXiangqiTreeAdapter.initialTruth();
      mountFortressXiangqiReview(root, {
        ...base,
        summary: summaryFor(parsed?.ok === true),
        root: parsed?.ok
          ? { truth: parsed.state, fen: fortressXiangqiEngineFen(parsed.state) }
          : undefined,
        moves: movesFromParam(movesParam, fortressXiangqiTreeAdapter, rootTruth),
        importPanel: makeImportPanel(id, fortressXiangqiTreeAdapter, rootTruth),
        onLineChange: syncLineToUrl(fortressXiangqiTreeAdapter),
        boardEditorHref: (node) => editorHref(id, fortressXiangqiEngineFen(node)),
      });
      return;
    }
    case 'jieqi': {
      const [
        { mountJieqiReview },
        { makeJieqiTreeAdapter },
        {
          createInitialJieqiState,
          createJieqiDeal,
          jieqiStateToDealtFen,
          jieqiStateToPikafishFen,
          parseJieqiFen,
        },
        { installJieqiBoardStyles },
      ] = await Promise.all([
        import('./review/jieqi-review.js'),
        import('./review/jieqi-tree-adapter.js'),
        import('@mistboard/game'),
        import('./live-jieqi-render.js'),
      ]);
      installJieqiBoardStyles();
      const { truth, custom } = seedRoot(
        fenParam,
        (fen) => parseJieqiFen(fen, { gameId: ANALYSIS_GAME_ID, rng: Math.random }),
        () => createInitialJieqiState(ANALYSIS_GAME_ID, createJieqiDeal(Math.random)),
      );
      const fen = jieqiStateToDealtFen(truth);
      pinFenInUrl(fenParam, fen);
      const codec = makeJieqiTreeAdapter(ANALYSIS_GAME_ID, null);
      mountJieqiReview(root, ANALYSIS_GAME_ID, null, {
        ...base,
        summary: summaryFor(custom),
        root: { truth, fen },
        moves: movesFromParam(movesParam, codec, truth),
        importPanel: { ...makeImportPanel(id, codec, truth), hint: t('analysis.dealtFenHint') },
        onLineChange: syncLineToUrl(codec),
        boardEditorHref: (node) => editorHref(id, jieqiStateToPikafishFen(node)),
        newDeal,
      });
      return;
    }
    case 'dark-xiangqi': {
      const [
        { mountDarkXiangqiReview },
        { darkXiangqiTreeAdapter },
        { parseStandardXiangqiFen, standardXiangqiFen },
      ] = await Promise.all([
        import('./review/dark-xiangqi-review.js'),
        import('./review/dark-xiangqi-tree-adapter.js'),
        import('@mistboard/game'),
      ]);
      // Fog relaxes the legality bar: a general may stand en prise, because the
      // side that left it there could not see the threat (same as the study
      // dispatch in review/study-review.ts).
      const parsed = fenParam
        ? parseStandardXiangqiFen(fenParam, ANALYSIS_GAME_ID, { allowExposedGeneral: true })
        : null;
      const rootTruth = parsed?.ok ? parsed.state : darkXiangqiTreeAdapter.initialTruth();
      mountDarkXiangqiReview(root, {
        ...base,
        summary: summaryFor(parsed?.ok === true),
        root: parsed?.ok
          ? { truth: parsed.state, fen: standardXiangqiFen(parsed.state) }
          : undefined,
        moves: movesFromParam(movesParam, darkXiangqiTreeAdapter, rootTruth),
        importPanel: makeImportPanel(id, darkXiangqiTreeAdapter, rootTruth),
        onLineChange: syncLineToUrl(darkXiangqiTreeAdapter),
        boardEditorHref: (node) => editorHref(id, standardXiangqiFen(node)),
      });
      return;
    }
    case 'dark-chess': {
      const [
        { mountDarkChessReview },
        { darkChessTreeAdapter },
        { darkChessFen, parseDarkChessFen },
      ] = await Promise.all([
        import('./review/dark-chess-review.js'),
        import('./review/dark-chess-tree-adapter.js'),
        import('@mistboard/game'),
      ]);
      const parsed = fenParam ? parseDarkChessFen(fenParam, ANALYSIS_GAME_ID) : null;
      const rootTruth = parsed?.ok ? parsed.state : darkChessTreeAdapter.initialTruth();
      mountDarkChessReview(root, {
        ...base,
        summary: summaryFor(parsed?.ok === true),
        root: parsed?.ok ? { truth: parsed.state, fen: darkChessFen(parsed.state) } : undefined,
        moves: movesFromParam(movesParam, darkChessTreeAdapter, rootTruth),
        importPanel: makeImportPanel(id, darkChessTreeAdapter, rootTruth),
        onLineChange: syncLineToUrl(darkChessTreeAdapter),
        boardEditorHref: (node) => editorHref(id, darkChessFen(node)),
      });
      return;
    }
    case 'duck-xiangqi': {
      // This board had NO "Board editor" hand-off until 2026-09-10: the duck is
      // not a piece, so the editor's model had nowhere to keep it and there was
      // no /editor/duck-xiangqi route. The model now carries the duck in its own
      // field (editor/editor-model.ts), so the hand-off is the ordinary one, and
      // it carries the SEVEN-field FEN: the seventh field is the duck, and an
      // editor link that dropped it would open a different position.
      const [
        { mountDuckXiangqiReview },
        { duckXiangqiTreeAdapter },
        { duckXiangqiFen, parseDuckXiangqiFen },
      ] = await Promise.all([
        import('./review/duck-xiangqi-review.js'),
        import('./review/duck-xiangqi-tree-adapter.js'),
        import('@mistboard/game'),
      ]);
      // The seventh FEN field carries the duck, so a pasted position keeps it;
      // a six-field paste reads as "the duck is not on the board yet".
      const parsed = fenParam ? parseDuckXiangqiFen(fenParam, ANALYSIS_GAME_ID) : null;
      const rootTruth = parsed?.ok ? parsed.state : duckXiangqiTreeAdapter.initialTruth();
      mountDuckXiangqiReview(root, {
        ...base,
        summary: summaryFor(parsed?.ok === true),
        root: parsed?.ok ? { truth: parsed.state, fen: duckXiangqiFen(parsed.state) } : undefined,
        moves: movesFromParam(movesParam, duckXiangqiTreeAdapter, rootTruth),
        importPanel: makeImportPanel(id, duckXiangqiTreeAdapter, rootTruth),
        onLineChange: syncLineToUrl(duckXiangqiTreeAdapter),
        boardEditorHref: (node) => editorHref(id, duckXiangqiFen(node)),
      });
      return;
    }
    default: {
      // Fail-closed: a new catalog member must get its own case, never another
      // variant's board.
      const exhaustive: never = id;
      throw new Error(`unsupported analysis variant: ${String(exhaustive)}`);
    }
  }
}
