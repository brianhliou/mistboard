// /editor/<variant>: the lichess-style board editor. Set up any position by
// hand, watch the FEN and the variant parser's verdict update live, and hand
// the result to the analysis board.
//
// Anatomy (lichess.org/editor): left rail = the variant picker; centre = the
// board with a piece palette for the side at the top above it and the side at
// the bottom below it, plus the pointer / delete brushes; right rail = side to
// move, the variant's extras card if it has one (fog chess: castling rights +
// en passant), start / clear / flip, the FEN field, and the analysis-board
// button. The address bar follows the position (?fen=, replaced, never pushed)
// so a reload keeps it and the URL is the share link; the start position keeps
// the URL clean.
//
// The board SVG is the variant's render-only renderer, untouched: hit targets
// are a transparent layer of [data-square] buttons laid over it from the
// spec's geometry, so click-to-place and installBoardDrag work the same way on
// every variant. The model is variant-neutral; everything variant-specific
// (grammar, palette, start, render, rules the editor enforces itself) lives in
// the EditorSpec (editor-specs.ts).

import { normalizeStartFen } from '@mistboard/game';
import { buildVariantPicker } from '../analysis-page.js';
import { attachBoardResizeGrip, restoreBoardScale } from '../board-resize.js';
import { variantDisplayLabel } from '../game-display.js';
import { type I18nKey, t } from '../i18n/catalog.js';
import { currentLocale } from '../i18n/locale.js';
import { buildNav } from '../site-shell.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
// The intersection boards (xiangqi, dark-xiangqi, jungle, jungle-flip) take
// their board and piece fills from this page-level stylesheet; without it the
// render-only SVG paints black (same contract as the analysis + postgame pages).
import '../live-xiangqi.css';
import './editor.css';
import type { EditorVariantId } from './editor-catalog.js';
import {
  capturedKey,
  cloneModel,
  DUCK_SUBJECT,
  type EditorColor,
  type EditorPiece,
  type EditorPlacementSubject,
  type EditorTurn,
  samePiece,
} from './editor-model.js';
import {
  COLOR_LABEL_KEY,
  type EditorPaletteEntry,
  type EditorSpec,
  type EditorTokenEntry,
  editorSpec,
  faceDownCounts,
  poolRows,
} from './editor-specs.js';

// 'duck' is its own brush kind rather than a piece brush carrying a pretend
// piece: it writes model.duck, not model.board, and the duck has no colour and
// no role to pretend with (editor-model.ts).
type Brush =
  | { kind: 'pointer' }
  | { kind: 'delete' }
  | { kind: 'piece'; piece: EditorPiece }
  | { kind: 'duck' };

export interface EditorPageOptions {
  /** Seed position; an unreadable one falls back to the start position. */
  fen?: string | null;
}

export function mountEditorPage(
  root: HTMLElement,
  variant: EditorVariantId,
  options: EditorPageOptions = {},
): void {
  const spec = editorSpec(variant);
  spec.installStyles();
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'editor-route');
  root.append(buildNav(locale));

  const seed = options.fen ?? new URLSearchParams(window.location.search).get('fen');
  const seeded = seed ? spec.fromFen(seed) : null;
  let model = seeded ?? spec.start();
  const startFen = spec.toFen(spec.start());
  let brush: Brush = { kind: 'pointer' };
  let selected: string | null = null;
  let draggingFrom: string | null = null;
  let notice: string | null = null;
  let lastPointer: { x: number; y: number } | null = null;

  // ── Layout ──────────────────────────────────────────────────────────────
  const page = document.createElement('div');
  page.className = 'editor-page';

  const leftRail = document.createElement('aside');
  leftRail.className = 'editor-rail editor-rail--left';
  leftRail.append(buildVariantPicker(variant, '/editor'));

  const centre = document.createElement('section');
  centre.className = 'editor-centre';
  const paletteTop = document.createElement('div');
  paletteTop.className = 'editor-palette editor-palette--top';
  const boardWrap = document.createElement('div');
  boardWrap.className = 'editor-board';
  const boardSvg = document.createElement('div');
  boardSvg.className = 'editor-board__svg';
  const hits = document.createElement('div');
  hits.className = 'editor-board__hits';
  boardWrap.append(boardSvg, hits);
  // Same corner grip and the same persisted --uni-board-scale as the analysis
  // and game boards: the board opens at its viewport fit (no vertical scroll)
  // and the user's chosen size carries across every board surface.
  restoreBoardScale();
  attachBoardResizeGrip(boardWrap, boardWrap);
  const paletteBottom = document.createElement('div');
  paletteBottom.className = 'editor-palette editor-palette--bottom';
  const brushes = document.createElement('div');
  brushes.className = 'editor-brushes';
  brushes.setAttribute('aria-label', t('editor.brushes'));
  const noticeEl = document.createElement('p');
  noticeEl.className = 'editor-notice';
  noticeEl.setAttribute('role', 'status');
  centre.append(paletteTop, boardWrap, paletteBottom, brushes, noticeEl);

  const rightRail = document.createElement('aside');
  rightRail.className = 'editor-rail editor-rail--right';

  // Side to move.
  const turnCard = card('editor-turn');
  const turnTitle = cardTitle(t('editor.sideToMove'));
  const turnGroup = document.createElement('div');
  turnGroup.className = 'editor-segmented';
  turnGroup.setAttribute('role', 'radiogroup');
  turnGroup.setAttribute('aria-label', t('editor.sideToMove'));
  const turnOptions: EditorTurn[] = [...spec.colors, ...(spec.openingTurn ? (['-'] as const) : [])];
  const turnInputs = new Map<EditorTurn, HTMLInputElement>();
  for (const turn of turnOptions) {
    const label = document.createElement('label');
    label.className = 'editor-segmented__option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'editor-turn';
    input.value = turn;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      model.turn = turn;
      update();
    });
    label.append(input, document.createTextNode(turnLabel(turn)));
    turnGroup.append(label);
    turnInputs.set(turn, input);
  }
  turnCard.append(turnTitle, turnGroup);

  // The variant's extras card (fog chess: castling + en passant), if any.
  const extrasHolder = document.createElement('div');
  extrasHolder.className = 'editor-extras';
  extrasHolder.hidden = !spec.extras;

  // Board actions.
  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  const startButton = button(t('editor.startPosition'), () => {
    const flipped = model.flipped;
    model = spec.start();
    model.flipped = flipped;
    selected = null;
    notice = null;
    update();
  });
  const clearButton = button(t('editor.clearBoard'), () => {
    model.board.clear();
    model.captured.clear();
    // An empty board has no duck on it either. `null` is off the board, which is
    // a real state (the opening), not the absence of the field.
    if (model.duck) model.duck.square = null;
    selected = null;
    notice = null;
    update();
  });
  const flipButton = button(t('editor.flipBoard'), () => {
    model.flipped = !model.flipped;
    update();
  });
  flipButton.disabled = !spec.flippable;
  actions.append(startButton, clearButton, flipButton);

  // FEN field.
  const fenCard = card('editor-fen');
  const fenLabel = document.createElement('label');
  fenLabel.className = 'editor-fen__label';
  fenLabel.textContent = t('editor.fenLabel');
  const fenRow = document.createElement('div');
  fenRow.className = 'editor-fen__row';
  const fenInput = document.createElement('input');
  fenInput.type = 'text';
  fenInput.className = 'editor-fen__field';
  fenInput.spellcheck = false;
  fenInput.autocomplete = 'off';
  fenInput.setAttribute('aria-label', t('editor.fenLabel'));
  fenLabel.htmlFor = 'editor-fen-field';
  fenInput.id = 'editor-fen-field';
  const setButton = button(t('editor.setFen'), () => loadFen(fenInput.value));
  setButton.classList.add('editor-fen__set');
  fenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadFen(fenInput.value);
    }
  });
  const copyButton = button(t('editor.copyFen'), () => {
    void copyText(fenInput.value).then((ok) => {
      if (!ok) {
        fenInput.focus();
        fenInput.select();
        return;
      }
      copyButton.textContent = t('editor.copied');
      window.setTimeout(() => {
        copyButton.textContent = t('editor.copyFen');
      }, 1500);
    });
  });
  copyButton.classList.add('editor-fen__copy');
  fenRow.append(fenInput, setButton);
  const fenError = document.createElement('p');
  fenError.className = 'editor-error editor-fen__error';
  fenError.hidden = true;
  fenCard.append(fenLabel, fenRow, copyButton, fenError);

  // Hidden-deal bookkeeping (dealt variants only).
  const poolCard = spec.dealt ? card('editor-pool') : null;
  const poolBody = document.createElement('div');
  poolBody.className = 'editor-pool__rows';
  const poolStatus = document.createElement('p');
  poolStatus.className = 'editor-pool__status';
  poolStatus.setAttribute('role', 'status');
  if (poolCard) poolCard.append(cardTitle(t('editor.notOnBoard')), poolBody, poolStatus);

  // Validation + the analysis-board link.
  const ctaCard = card('editor-cta');
  const analysisLink = document.createElement('a');
  analysisLink.className = 'editor-btn editor-btn--primary editor-analysis-link';
  analysisLink.textContent = t('editor.analysisBoard');
  analysisLink.addEventListener('click', (event) => {
    if (analysisLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  const validation = document.createElement('p');
  validation.className = 'editor-error editor-validation';
  validation.hidden = true;
  ctaCard.append(analysisLink, validation);

  rightRail.append(
    turnCard,
    extrasHolder,
    actions,
    fenCard,
    ...(poolCard ? [poolCard] : []),
    ctaCard,
  );
  page.append(leftRail, centre, rightRail);
  root.append(page);

  // ── Interaction ─────────────────────────────────────────────────────────
  document.addEventListener('pointermove', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
  });

  installBoardDrag({
    board: hits,
    ghostSizePx: () => renderedCellPx(),
    onSquareClick: (square) => clickSquare(square),
    canDragFrom: (square) => brush.kind === 'pointer' && model.board.has(square),
    ghostHtml: (square) => {
      const piece = model.board.get(square);
      return piece ? spec.ghostSvg(piece) : null;
    },
    onDragStart: (from) => {
      draggingFrom = from;
      selected = null;
      renderBoard();
    },
    onDrop: (from, to) => {
      draggingFrom = null;
      if (to) {
        movePiece(from, to);
      } else if (!pointerOverBoard()) {
        // Dropped off the board: the piece comes off. Dropping it back where it
        // was (or anywhere over the board with no square under it) is a cancel.
        model.board.delete(from);
      }
      update();
    },
  });

  function clickSquare(square: string): void {
    if (brush.kind === 'piece') {
      placePiece(square, brush.piece);
      update();
      return;
    }
    if (brush.kind === 'duck') {
      placeDuck(square);
      update();
      return;
    }
    if (brush.kind === 'delete') {
      deleteAt(square);
      selected = null;
      update();
      return;
    }
    if (selected) {
      if (selected !== square) movePiece(selected, square);
      selected = null;
      update();
      return;
    }
    if (model.board.has(square)) selected = square;
    update();
  }

  function placePiece(square: string, piece: EditorPiece): boolean {
    if (!allowed(square, piece)) return false;
    model.board.set(square, piece);
    return true;
  }

  /** There is exactly ONE duck, so painting it is a move, not an addition: the
   *  model holds a single square and setting it is what takes the duck off the
   *  point it was on. Nothing here can produce a second one. */
  function placeDuck(square: string): void {
    if (!model.duck || !allowed(square, DUCK_SUBJECT)) return;
    model.duck.square = square;
  }

  function allowed(square: string, subject: EditorPlacementSubject): boolean {
    const problem = spec.placementProblem(square, subject, model);
    if (!problem) return true;
    notice = t(problem.key, translateParams(problem.params));
    return false;
  }

  /** The delete brush clears the point, whatever is standing on it. The duck is
   *  not in the piece map, so a board-only delete would leave it unremovable. */
  function deleteAt(square: string): void {
    model.board.delete(square);
    if (model.duck?.square === square) model.duck.square = null;
  }

  function movePiece(from: string, to: string): void {
    const piece = model.board.get(from);
    if (!piece) return;
    if (!placePiece(to, piece)) return;
    model.board.delete(from);
  }

  function loadFen(text: string): void {
    const parsed = spec.fromFen(text);
    if (!parsed) {
      fenError.textContent = t('editor.fenUnreadable', { variant: variantDisplayLabel(variant) });
      fenError.hidden = false;
      return;
    }
    fenError.hidden = true;
    parsed.flipped = model.flipped;
    model = parsed;
    selected = null;
    notice = null;
    update();
  }

  function pointerOverBoard(): boolean {
    if (!lastPointer) return false;
    const rect = boardWrap.getBoundingClientRect();
    return (
      lastPointer.x >= rect.left &&
      lastPointer.x <= rect.right &&
      lastPointer.y >= rect.top &&
      lastPointer.y <= rect.bottom
    );
  }

  function renderedCellPx(): number {
    const box = spec.geometry.viewBox(model.flipped);
    const width = boardWrap.getBoundingClientRect().width || box.width;
    return (spec.geometry.hit / box.width) * width;
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function perspective(): EditorColor {
    return model.flipped ? spec.colors[1] : spec.colors[0];
  }

  function renderBoard(): void {
    const shown = draggingFrom ? cloneModel(model) : model;
    if (draggingFrom) shown.board.delete(draggingFrom);
    // The wrapper's width formula (editor.css) fits the board to the viewport
    // height, which needs the board's aspect ratio in CSS.
    const box = spec.geometry.viewBox(model.flipped);
    boardWrap.style.setProperty('--editor-board-aspect', (box.width / box.height).toFixed(4));
    boardSvg.innerHTML = spec.renderSvg(shown, perspective());
    renderHits();
  }

  function renderHits(): void {
    const box = spec.geometry.viewBox(model.flipped);
    const parts: HTMLElement[] = [];
    const hit = spec.geometry.hit;
    for (const square of squaresOf(spec)) {
      const { x, y } = spec.geometry.center(square, model.flipped);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'editor-square';
      el.dataset.square = square;
      el.setAttribute('aria-label', square);
      el.style.left = `${((x - hit / 2 - box.minX) / box.width) * 100}%`;
      el.style.top = `${((y - hit / 2 - box.minY) / box.height) * 100}%`;
      el.style.width = `${(hit / box.width) * 100}%`;
      el.style.height = `${(hit / box.height) * 100}%`;
      if (square === selected) el.classList.add('is-selected');
      if (model.board.has(square)) el.classList.add('has-piece');
      // Its own class, not `has-piece`: that one also means "draggable under the
      // pointer brush", and the duck is not in the piece map to drag.
      if (model.duck?.square === square) el.classList.add('has-duck');
      parts.push(el);
    }
    hits.replaceChildren(...parts);
    hits.dataset.brush = brush.kind;
  }

  function renderPalettes(): void {
    const top = model.flipped ? spec.colors[0] : spec.colors[1];
    const bottom = model.flipped ? spec.colors[1] : spec.colors[0];
    fillPalette(paletteTop, top);
    fillPalette(paletteBottom, bottom);
    renderBrushes();
  }

  function fillPalette(container: HTMLElement, color: EditorColor): void {
    container.replaceChildren();
    container.setAttribute('aria-label', t('editor.palette', { color: t(COLOR_LABEL_KEY[color]) }));
    container.dataset.color = color;
    for (const entry of spec.palette(color)) container.append(paletteButton(entry));
  }

  function paletteButton(entry: EditorPaletteEntry): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'editor-palette__piece';
    const colorName = entry.piece.color ? t(COLOR_LABEL_KEY[entry.piece.color]) : '';
    const label = `${colorName} ${t(entry.labelKey)}`.trim();
    el.setAttribute('aria-label', label);
    el.title = label;
    el.dataset.role = entry.piece.faceDown ? 'face-down' : entry.piece.role;
    el.dataset.color = entry.piece.color ?? 'none';
    el.innerHTML = spec.ghostSvg(entry.piece);
    const active = brush.kind === 'piece' && samePiece(brush.piece, entry.piece);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) el.classList.add('is-active');
    el.addEventListener('click', () => {
      // Clicking the active piece again drops back to the pointer.
      brush = active ? { kind: 'pointer' } : { kind: 'piece', piece: entry.piece };
      selected = null;
      renderPalettes();
      renderHits();
    });
    return el;
  }

  function renderBrushes(): void {
    brushes.replaceChildren();
    brushes.append(
      brushButton('pointer', 'editor.brushPointer', pointerIcon()),
      // Both colourless brushes sit on this row rather than in either palette,
      // for the same reason: a palette is one seat's pieces, and neither the
      // face-down tile nor the duck belongs to a seat.
      ...(spec.tileEntry ? [paletteButton(spec.tileEntry)] : []),
      ...(spec.duckEntry ? [duckButton(spec.duckEntry)] : []),
      brushButton('delete', 'editor.brushDelete', deleteIcon()),
    );
  }

  /** The duck brush. Shaped like a palette button (it is a token you paint with,
   *  at token size) but it is not a palette entry: it has no colour and no
   *  piece, so `paletteButton` has nothing to build it from. */
  function duckButton(entry: EditorTokenEntry): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'editor-palette__piece';
    const label = t(entry.labelKey);
    el.setAttribute('aria-label', label);
    el.title = label;
    el.dataset.role = entry.role;
    el.dataset.color = 'none';
    el.innerHTML = entry.svg();
    const active = brush.kind === 'duck';
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) el.classList.add('is-active');
    el.addEventListener('click', () => {
      brush = active ? { kind: 'pointer' } : { kind: 'duck' };
      selected = null;
      renderPalettes();
      renderHits();
    });
    return el;
  }

  function brushButton(kind: 'pointer' | 'delete', labelKey: I18nKey, icon: string): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `editor-brush editor-brush--${kind}`;
    el.dataset.brush = kind;
    el.setAttribute('aria-label', t(labelKey));
    el.title = t(labelKey);
    el.innerHTML = icon;
    const active = brush.kind === kind;
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) el.classList.add('is-active');
    el.addEventListener('click', () => {
      brush = { kind };
      selected = null;
      renderPalettes();
      renderHits();
    });
    return el;
  }

  function renderTurn(): void {
    // The untouched opening exists only while every tile is still face-down.
    const openingInput = turnInputs.get('-');
    if (openingInput) {
      const anyRevealed = [...model.board.values()].some((piece) => !piece.faceDown);
      openingInput.disabled = anyRevealed;
      if (anyRevealed && model.turn === '-') model.turn = spec.colors[0];
    }
    for (const [turn, input] of turnInputs) input.checked = model.turn === turn;
  }

  function renderPool(): void {
    if (!poolCard || !spec.dealt) return;
    poolBody.replaceChildren();
    const rows = poolRows(model, spec);
    for (const color of spec.colors) {
      const group = document.createElement('div');
      group.className = 'editor-pool__group';
      group.dataset.color = color;
      const heading = document.createElement('h4');
      heading.className = 'editor-pool__color';
      heading.textContent = t(COLOR_LABEL_KEY[color]);
      group.append(heading);
      for (const row of rows.filter((entry) => entry.color === color)) {
        const line = document.createElement('div');
        line.className = 'editor-pool__row';
        line.dataset.role = row.role;
        const name = document.createElement('span');
        name.className = 'editor-pool__role';
        name.textContent = t(roleKey(spec, row.role));
        const remaining = document.createElement('span');
        remaining.className = 'editor-pool__remaining';
        remaining.title = t('editor.remaining');
        remaining.textContent = String(row.remaining);
        const stepper = document.createElement('span');
        stepper.className = 'editor-stepper';
        stepper.title = t('editor.captured');
        const minus = stepButton('-', t('editor.fewerCaptured'), row.captured <= 0, () =>
          setCaptured(row.color, row.role, row.captured - 1, row.remaining),
        );
        const count = document.createElement('span');
        count.className = 'editor-stepper__count';
        count.textContent = String(row.captured);
        const plus = stepButton('+', t('editor.moreCaptured'), row.captured >= row.remaining, () =>
          setCaptured(row.color, row.role, row.captured + 1, row.remaining),
        );
        stepper.append(minus, count, plus);
        line.append(name, remaining, stepper);
        group.append(line);
      }
      poolBody.append(group);
    }
    const tiles = faceDownCounts(model);
    const pool = rows.reduce((sum, row) => sum + row.pool, 0);
    poolStatus.textContent = t('editor.poolStatus', { tiles: tiles.total, pieces: pool });
  }

  function setCaptured(color: EditorColor, role: string, next: number, max: number): void {
    const value = Math.max(0, Math.min(max, next));
    const key = capturedKey(color, role);
    if (value === 0) model.captured.delete(key);
    else model.captured.set(key, value);
    update();
  }

  /** The editor's own checks, ahead of the variant parser: a pool that does not
   *  match the face-down tiles is a position no parser will accept. */
  function localProblem(): string | null {
    if (!spec.dealt) return null;
    const rows = poolRows(model, spec);
    const tiles = faceDownCounts(model);
    if (spec.grammar.faceDown === 'coloured') {
      for (const color of spec.colors) {
        const onBoard = tiles.byColor[color] ?? 0;
        const pooled = rows
          .filter((row) => row.color === color)
          .reduce((sum, row) => sum + row.pool, 0);
        if (onBoard !== pooled) {
          return t('editor.poolMismatchColor', {
            color: t(COLOR_LABEL_KEY[color]),
            tiles: onBoard,
            pieces: pooled,
          });
        }
      }
      return null;
    }
    const pooled = rows.reduce((sum, row) => sum + row.pool, 0);
    return tiles.total === pooled ? null : t('editor.poolMismatch');
  }

  /** Re-renders the variant's extras card. It reconciles the model with the
   *  board (rights the board cannot honour are dropped), so it runs before the
   *  FEN is written. Focus survives the re-render by element id. */
  function renderExtras(): void {
    if (!spec.extras) return;
    const active = document.activeElement;
    const focusId =
      active instanceof HTMLElement && extrasHolder.contains(active) && active.id
        ? active.id
        : null;
    const card = spec.extras(model, update);
    extrasHolder.replaceChildren(...(card ? [card] : []));
    extrasHolder.hidden = card === null;
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again && extrasHolder.contains(again)) again.focus();
    }
  }

  function renderFenAndLink(): string {
    const fen = spec.toFen(model);
    fenInput.value = fen;
    const problem = localProblem();
    const result = normalizeStartFen(spec.id, fen);
    const error = problem ?? (result.ok ? null : result.error);
    const canonical = result.ok && !problem ? result.fen : null;
    // The href always carries the editor's FEN so the link is inspectable; the
    // control itself is inert until the variant parser accepts the position.
    analysisLink.href = `/analysis/${variant}?fen=${encodeURIComponent(canonical ?? fen)}`;
    analysisLink.setAttribute('aria-disabled', error ? 'true' : 'false');
    analysisLink.classList.toggle('is-disabled', error !== null);
    if (error) analysisLink.setAttribute('tabindex', '-1');
    else analysisLink.removeAttribute('tabindex');
    validation.hidden = error === null;
    validation.textContent = error ?? '';
    // The pool status line doubles as the mismatch marker on the dealt variants.
    poolStatus.classList.toggle('is-error', problem !== null);
    return fen;
  }

  /** ?fen= follows the position: replaced in place (no history entries), and
   *  removed at the start position so a fresh editor keeps a clean URL. Slashes
   *  stay raw for a readable share link; URLSearchParams reads either form. */
  function syncUrl(fen: string): void {
    const params = new URLSearchParams(window.location.search);
    params.delete('fen');
    const rest = params.toString();
    const fenPart = fen === startFen ? '' : `fen=${encodeURIComponent(fen).replace(/%2F/g, '/')}`;
    const query = [rest, fenPart].filter(Boolean).join('&');
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, '', next);
  }

  function renderNotice(): void {
    noticeEl.textContent = notice ?? '';
    noticeEl.hidden = notice === null;
  }

  function update(): void {
    renderTurn();
    renderBoard();
    renderPalettes();
    renderPool();
    renderExtras();
    syncUrl(renderFenAndLink());
    renderNotice();
    notice = null;
  }

  function turnLabel(turn: EditorTurn): string {
    return turn === '-' ? t('editor.opening') : t(COLOR_LABEL_KEY[turn]);
  }

  function translateParams(params: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
      out[name] =
        value === 'red' || value === 'black' || value === 'white'
          ? t(COLOR_LABEL_KEY[value])
          : value;
    }
    return out;
  }

  update();
}

// ── Small DOM helpers ─────────────────────────────────────────────────────

function card(className: string): HTMLElement {
  const el = document.createElement('section');
  el.className = `editor-card ${className}`;
  return el;
}

function cardTitle(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.className = 'editor-card__title';
  el.textContent = text;
  return el;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'editor-btn';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function stepButton(
  glyph: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'editor-stepper__button';
  el.textContent = glyph;
  el.setAttribute('aria-label', label);
  el.disabled = disabled;
  el.addEventListener('click', onClick);
  return el;
}

function squaresOf(spec: EditorSpec): string[] {
  const out: string[] = [];
  for (let rank = 1; rank <= spec.grammar.ranks; rank += 1) {
    for (let file = 0; file < spec.grammar.files; file += 1) {
      out.push(spec.grammar.square(file, rank));
    }
  }
  return out;
}

function roleKey(spec: EditorSpec, role: string): I18nKey {
  for (const color of spec.colors) {
    const entry = spec
      .palette(color)
      .find((item) => !item.piece.faceDown && item.piece.role === role);
    if (entry) return entry.labelKey;
  }
  return 'editor.role.piece';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function pointerIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3l12 9-5.2 1.2L15 19l-2.6 1.2-2.2-5.8L6 18z" fill="currentColor"/></svg>';
}

function deleteIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 7h12l-1 13H7z M9 4h6l1 2H8z" fill="currentColor"/></svg>';
}
