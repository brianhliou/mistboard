// The Play a game panel's parts, shared by the homepage setup dialog
// (landing-play.ts) and the correspondence Post a seek dialog
// (correspondence.ts): option buttons, side buttons with each variant's
// pieces, the label-beside-control row, and the variant tile. Their styles are
// landing-play.css.
import { PIECE_SVGS } from '@mistboard/board-render';
import {
  DARK_CHESS_SPEC_ID,
  type GameSpecId,
  JUNGLE_SPEC_ID,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import { jungleDobutsuPieceHref } from './jungle-art.js';
import { renderVariantMarker } from './variant-markers.js';
import {
  type WebTenantLandingConfig,
  webVariantTenantForSpecId,
} from './variant-tenant/registry.js';
import { variantMiniIdForGameSpec } from './variants.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

export type SetupColorPreference = 'white' | 'red' | 'black' | 'random';
export type SetupSideCapabilities = WebTenantLandingConfig['capabilities'];

const DARK_CHESS_LANDING_CAPABILITIES: SetupSideCapabilities = {
  firstColor: 'white',
  firstGlyph: '♚',
  firstLabel: 'White',
  secondColor: 'black',
  secondGlyph: '♚',
  secondLabel: 'Black',
  supportsRated: true,
  supportsTimeControl: true,
};

export function colorOptionButton(
  value: SetupColorPreference,
  label: string,
  selected: boolean,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-start-option landing-color-option${selected ? ' selected' : ''}`;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', selected ? 'true' : 'false');

  const glyph = document.createElement('span');
  glyph.className = `landing-color-glyph ${value}`;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(...colorGlyphNodes(value));

  const text = document.createElement('span');
  text.className = 'landing-color-label';
  text.textContent = label;

  button.append(glyph, text);
  return button;
}

export function updateColorOptionButton(
  button: HTMLButtonElement,
  value: SetupColorPreference,
  label: string,
  gameSpecId: GameSpecId,
): void {
  const glyph = button.querySelector<HTMLSpanElement>('.landing-color-glyph');
  const text = button.querySelector<HTMLSpanElement>('.landing-color-label');
  if (glyph) {
    const capabilities = landingGameSpecCapabilities(gameSpecId);
    glyph.className = capabilities.neutralGlyphColor
      ? `landing-color-glyph${value === 'random' ? ' random' : ''}`
      : `landing-color-glyph ${value}`;
    if (capabilities.glyphClass) glyph.classList.add(capabilities.glyphClass);
    glyph.replaceChildren(...colorGlyphNodes(value, gameSpecId));
  }
  if (text) text.textContent = label;
}

function colorGlyphNodes(
  value: SetupColorPreference,
  gameSpecId: GameSpecId = DARK_CHESS_SPEC_ID,
): Node[] {
  if (gameSpecId === JUNGLE_SPEC_ID) {
    return jungleElephantGlyphNodes(value);
  }
  if (gameSpecId === DARK_CHESS_SPEC_ID) {
    return chessKingGlyphNodes(value);
  }
  const capabilities = landingGameSpecCapabilities(gameSpecId);
  if (capabilities.glyphClass === 'xiangqi') {
    return xiangqiGeneralGlyphNodes(value);
  }
  if (capabilities.glyphClass === 'stone') {
    return gomokuStoneGlyphNodes(value);
  }
  if (value === 'random') {
    const first = document.createElement('span');
    first.className = capabilities.neutralGlyphColor ? '' : capabilities.firstColor;
    first.textContent = capabilities.firstGlyph;
    const second = document.createElement('span');
    second.className = capabilities.neutralGlyphColor ? '' : capabilities.secondColor;
    second.textContent = capabilities.secondGlyph;
    return [first, second];
  }
  return [
    document.createTextNode(
      value === capabilities.secondColor ? capabilities.secondGlyph : capabilities.firstGlyph,
    ),
  ];
}

function jungleElephantGlyphNodes(value: SetupColorPreference): Node[] {
  // The tile is the span; the art is zoomed inside it, because the elephant
  // fills only the middle of its 512px image.
  const elephant = (color: 'red' | 'black') => {
    const tile = document.createElement('span');
    tile.className = `landing-color-piece jungle ${color}`;
    const image = document.createElement('img');
    image.src = jungleDobutsuPieceHref(color, 'elephant');
    image.alt = '';
    tile.append(image);
    return tile;
  };
  if (value === 'random') return [elephant('red'), elephant('black')];
  return [elephant(value === 'black' ? 'black' : 'red')];
}

// The general in the player's own piece set, so an international-set player
// picks a side by the piece they will see on the board, not by 帥 and 將.
function xiangqiGeneralGlyphNodes(value: SetupColorPreference): Node[] {
  const general = (color: 'red' | 'black') => {
    const piece = document.createElement('span');
    piece.className = `landing-color-piece xiangqi ${color}`;
    piece.innerHTML = renderXiangqiPiece(
      { color, role: 'general' },
      { ariaLabel: `${color} general` },
    );
    return piece;
  };
  if (value === 'random') return [general('red'), general('black')];
  return [general(value === 'black' ? 'black' : 'red')];
}

// Gomoku sides are stones drawn like the board's own, never text glyphs: a
// character glyph turns white on the selected fill, so a picked Black read as
// a white stone (Brian's phone, 2026-11-05).
function gomokuStoneGlyphNodes(value: SetupColorPreference): Node[] {
  const stone = (color: 'black' | 'white') => {
    const piece = document.createElement('span');
    piece.className = `landing-color-piece stone ${color}`;
    piece.setAttribute('aria-hidden', 'true');
    return piece;
  };
  if (value === 'random') return [stone('black'), stone('white')];
  return [stone(value === 'white' ? 'white' : 'black')];
}

function chessKingGlyphNodes(value: SetupColorPreference): Node[] {
  const king = (color: 'white' | 'black') => {
    const piece = document.createElement('span');
    piece.className = `landing-color-piece chess ${color}`;
    piece.innerHTML = PIECE_SVGS[`${color}:king`] ?? '';
    piece.querySelector('svg')?.setAttribute('viewBox', '0 0 45 45');
    return piece;
  };
  if (value === 'random') return [king('white'), king('black')];
  return [king(value === 'black' ? 'black' : 'white')];
}

export function landingGameSpecCapabilities(gameSpecId: GameSpecId): SetupSideCapabilities {
  // Tenant capabilities live on their registry entries; chess (the fallback)
  // keeps its row here until the P2 migration.
  return (
    webVariantTenantForSpecId(gameSpecId)?.landing?.capabilities ?? DARK_CHESS_LANDING_CAPABILITIES
  );
}

export type SetupSectionOptions = {
  /** Muted line under the row label (open layout only). */
  hint?: string;
};

export type SetupSection = {
  button: HTMLButtonElement | null;
  content: HTMLElement;
  id: string;
  panel: HTMLElement | null;
  value: HTMLElement | null;
  valueText: () => string;
  wrapper: HTMLElement;
};

/** Phone row: the label above its control, always open. */
export function buildSetupRowSection(
  id: string,
  label: string,
  content: HTMLElement,
  valueText: () => string,
  options: SetupSectionOptions = {},
): SetupSection {
  const leadingLabel = content.firstElementChild;
  if (leadingLabel?.classList.contains('landing-setup-label')) leadingLabel.remove();

  const wrapper = document.createElement('section');
  wrapper.className = 'landing-setup-row';
  wrapper.dataset.setupSection = id;
  const title = document.createElement('span');
  title.className = 'landing-setup-row-label';
  title.textContent = label;
  if (options.hint) {
    // A muted second line under the label, e.g. what "3 + 2" counts.
    const hint = document.createElement('span');
    hint.className = 'landing-setup-row-hint';
    hint.textContent = options.hint;
    title.append(hint);
  }
  wrapper.append(title, content);
  return { button: null, content, id, panel: null, value: null, valueText, wrapper };
}

export function startOptionButton(label: string, selected: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-start-option${selected ? ' selected' : ''}`;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', selected ? 'true' : 'false');
  updateStartOptionButtonLabel(button, label);
  return button;
}

export function updateStartOptionButtonLabel(button: HTMLButtonElement, label: string): void {
  button.replaceChildren();
  // Split a trailing parenthetical ("3 + 2 (coming soon)") into a muted hint badge so
  // the live label stays prominent and the not-yet-available note de-emphasizes.
  const hintMatch = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (hintMatch) {
    const main = document.createElement('span');
    main.className = 'landing-start-option-text';
    main.textContent = hintMatch[1];
    const hint = document.createElement('span');
    hint.className = 'landing-start-option-hint';
    hint.textContent = hintMatch[2];
    button.append(main, hint);
  } else {
    button.textContent = label;
  }
}

/** One tile of the variant grid: the variant's marker over its short name. */
export function variantCardButton(
  gameSpecId: GameSpecId,
  label: string,
  locale: Locale,
): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'landing-variant-card';
  card.setAttribute('role', 'radio');
  card.dataset.gameSpec = gameSpecId;
  const miniId = variantMiniIdForGameSpec(gameSpecId);
  if (miniId) {
    const thumb = document.createElement('span');
    thumb.className = 'landing-variant-card-thumb';
    thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${label} marker` });
    card.append(thumb);
  }
  const name = document.createElement('span');
  name.className = 'landing-variant-card-name';
  // A tile has room for one short line; Three Kingdoms writes its number.
  name.textContent =
    gameSpecId === THREE_KINGDOMS_BANQI_SPEC_ID
      ? t('variant.threeKingdomsBanqi.cardName', {}, locale)
      : label;
  card.append(name);
  return card;
}
