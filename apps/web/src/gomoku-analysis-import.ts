import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuMove,
  type GomokuOpening,
  isGomokuColor,
  parseGomokuMove,
} from '@mistboard/game';
import { t } from './i18n/catalog.js';

export type GomokuAnalysisGame = { opening: GomokuOpening; moves: GomokuMove[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shared by JSON import and review handoff. Reject the entire line on an
 * invalid opening or placement: a legal prefix would silently change the game. */
export function gomokuAnalysisGame(
  opening: unknown,
  tokens: readonly unknown[],
): GomokuAnalysisGame | null {
  if (
    !record(opening) ||
    !Array.isArray(opening.stones) ||
    opening.stones.length > 225 ||
    !isGomokuColor(opening.turn) ||
    (opening.rule !== undefined && opening.rule !== 'freestyle') ||
    tokens.length > 225 - opening.stones.length
  )
    return null;
  const stones: GomokuOpening['stones'][number][] = [];
  for (const stone of opening.stones) {
    if (!record(stone) || typeof stone.square !== 'string' || !isGomokuColor(stone.color))
      return null;
    const move = parseGomokuMove(stone.square);
    if (!move) return null;
    stones.push({ square: move.to, color: stone.color });
  }
  const normalized: GomokuOpening = { stones, turn: opening.turn };
  try {
    let state = createGomokuRoomState('analysis', normalized);
    const moves: GomokuMove[] = [];
    for (const token of tokens) {
      const move = typeof token === 'string' ? parseGomokuMove(token) : null;
      if (!move) return null;
      const next = applyGomokuRoomMove(state, move);
      if (next === state) return null;
      moves.push(move);
      state = next;
    }
    return { opening: normalized, moves };
  } catch {
    return null;
  }
}

/** Mistboard's existing tenant JSON export (1.1). Metadata is ignored, while
 * the opening, ply count, sequence, movers and every placement are checked. */
export function parseGomokuExport(text: string): GomokuAnalysisGame | null {
  try {
    const data: unknown = JSON.parse(text);
    if (
      !record(data) ||
      data.schema_version !== '1.1' ||
      data.variant !== 'gomoku' ||
      !Array.isArray(data.plies) ||
      data.ply_count !== data.plies.length ||
      data.plies.length > 225
    )
      return null;
    const tokens: unknown[] = [];
    for (const [i, ply] of data.plies.entries()) {
      if (!record(ply) || ply.ply !== i + 1 || !isGomokuColor(ply.mover)) return null;
      tokens.push(ply.uci);
    }
    const game = gomokuAnalysisGame(data.opening, tokens);
    if (!game) return null;
    for (const [i, ply] of data.plies.entries()) {
      const expected =
        i % 2 === 0 ? game.opening.turn : game.opening.turn === 'black' ? 'white' : 'black';
      if (ply.mover !== expected) return null;
    }
    return game;
  } catch {
    return null;
  }
}

/** Compact enough for a full 225-ply URL; never includes player metadata or
 * evaluations. `game` is immutable while `ply` follows mainline navigation. */
export function gomokuAnalysisHref(game: GomokuAnalysisGame, ply = game.moves.length): string {
  const params = new URLSearchParams({
    game: JSON.stringify({ opening: game.opening, moves: game.moves.map((move) => move.to) }),
    ply: String(
      Math.max(0, Math.min(Number.isInteger(ply) ? ply : game.moves.length, game.moves.length)),
    ),
  });
  return `/analysis/gomoku?${params}`;
}

export function readGomokuAnalysisGame(text: string): GomokuAnalysisGame | null {
  try {
    const data: unknown = JSON.parse(text);
    return record(data) && Array.isArray(data.moves)
      ? gomokuAnalysisGame(data.opening, data.moves)
      : null;
  } catch {
    return null;
  }
}

/** JSON only: Gomoku has no FEN/editor capability. Use the shared underboard
 * field styles without advertising those unrelated actions. */
export function createGomokuImportPanel(initialError = ''): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'review-import';
  const label = document.createElement('label');
  label.className = 'review-share__label review-import__label review-import__label--moves';
  label.textContent = 'JSON';
  const input = document.createElement('textarea');
  input.id = 'gomoku-import-json';
  label.htmlFor = input.id;
  input.className = 'review-share__field review-share__field--moves review-import__field';
  input.rows = 3;
  input.spellcheck = false;
  input.placeholder = t('analysis.gomokuJsonPlaceholder');
  input.setAttribute('aria-label', t('analysis.gomokuJsonPlaceholder'));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-share__copy review-import__button review-import__button--moves';
  button.textContent = t('analysis.importJson');
  const foot = document.createElement('div');
  foot.className = 'review-import__foot';
  const error = document.createElement('span');
  error.className = 'review-import__error';
  error.setAttribute('role', 'alert');
  error.textContent = initialError;
  const hint = document.createElement('span');
  hint.className = 'review-import__hint';
  hint.textContent = t('analysis.gomokuJsonHint');
  button.addEventListener('click', () => {
    const game = parseGomokuExport(input.value);
    if (!game) {
      error.textContent = t('analysis.invalidGomokuJson');
      return;
    }
    window.location.assign(gomokuAnalysisHref(game));
  });
  foot.append(error, hint);
  panel.append(label, input, button, foot);
  return panel;
}
