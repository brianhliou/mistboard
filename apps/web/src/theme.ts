import './theme.css';
import type { GameFamilyId } from '@mistboard/game';
import type { ConnectionStatus } from './connection-status.js';
import { readDisplayPreferences, writeDisplayPreference } from './display-preferences.js';
import type { Locale } from './i18n/locale.js';
import {
  readStoredShogiBoardTheme,
  readStoredShogiPieceSet,
  type ShogiBoardTheme,
  writeStoredShogiBoardTheme,
  writeStoredShogiPieceSet,
} from './shogi-appearance-storage.js';
import type { ShogiPieceSet } from './shogi-piece-sets.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { readStoredSoundSet, type SoundSetId, storeSoundSet } from './sound-sets.js';
import {
  readStoredXiangqiBoardLayout,
  readStoredXiangqiBoardTheme,
  readStoredXiangqiNotation,
  readStoredXiangqiPieceSet,
  writeStoredXiangqiBoardLayout,
  writeStoredXiangqiBoardTheme,
  writeStoredXiangqiNotation,
  writeStoredXiangqiPieceSet,
  type XiangqiBoardLayout,
  type XiangqiBoardTheme,
  type XiangqiNotationPreference,
} from './xiangqi-appearance-storage.js';
import { xiangqiNotationChangedEvent } from './xiangqi-notation.js';
import type { XiangqiPieceSet } from './xiangqi-piece-sets.js';

export { readStoredShogiPieceSet } from './shogi-appearance-storage.js';
export {
  readStoredXiangqiBoardLayout,
  readStoredXiangqiPieceSet,
} from './xiangqi-appearance-storage.js';

// This module is the ALWAYS-LOADED theme layer: applying stored preferences at
// boot, the storage readers/writers, the change events every board surface
// listens to, and the small nav plumbing (gear trigger, open/close). The
// settings-panel UI itself (the drill-in appearance menu with its tile pickers
// and previews) lives in theme-settings-panel.ts and is dynamically imported on
// first use, so it stays out of the entry chunk.

// ONE chess board (2026-07-31). Every other id — Tournament green, High
// contrast, Colorblind, Classic, Blue, Monochrome — is gone from the union, the
// CSS and the picker; a stored preference for any of them normalizes to this.
// The wood pair itself carries the accessibility floor now (it clears 3:1 on its
// own, see the :root block in app-base.css), which is what made removing the
// High contrast escape hatch defensible.
export type BoardTheme = 'standard';
export type FogTheme = 'veil' | 'solid' | 'drift' | 'mistveil' | 'void' | 'invisible';
export type PieceSet = 'cburnett' | 'merida' | 'chessnut' | 'fantasy' | 'letter';
export type SiteTheme = 'system' | 'light' | 'dark';
// The appearance "family" is the GameSpec family (chess-family games share board
// themes + piece sets; likewise for xiangqi). Driven by gameSpecForId(id).family.
export type BoardFamily = GameFamilyId;
// The xiangqi Board picker folds the board theme and the cell/intersection
// layout into one choice row: the two themes plus the square-grid layout.
export type XiangqiBoardChoice = XiangqiBoardTheme | 'cell';

const siteThemeStorageKey = 'mistboard.siteTheme';
const boardStorageKey = 'mistboard.boardTheme';
const fogStorageKey = 'mistboard.fogTheme';
const pieceSetStorageKey = 'mistboard.pieceSet';
const soundVolumeStorageKey = 'mistboard.soundVolume';
const soundMutedStorageKey = 'mistboard.soundMuted';
export const soundSettingsChangedEvent = 'mistboard:sound-settings-changed';
export const siteThemeChangedEvent = 'mistboard:site-theme-changed';
export const boardAppearanceChangedEvent = 'mistboard:board-appearance-changed';
// Fired when a xiangqi-family appearance setting (board theme or piece set)
// changes. The xiangqi board renders pieces as inline SVG, so unlike the
// CSS-driven chess board it must re-render to pick up a new piece set.
export const xiangqiAppearanceChangedEvent = 'mistboard:xiangqi-appearance-changed';
// Fired when a shogi appearance setting (board theme or piece set) changes. Like
// xiangqi, the shogi board renders pieces as inline SVG, so it re-renders to pick
// up a new set rather than restyling through CSS.
export const shogiAppearanceChangedEvent = 'mistboard:shogi-appearance-changed';
const defaultSiteTheme: SiteTheme = 'system';
const defaultTheme: BoardTheme = 'standard';
const defaultFogTheme: FogTheme = 'solid';
const defaultPieceSet: PieceSet = 'cburnett';
const defaultSoundVolume = 0.7;
let cachedSoundVolume = defaultSoundVolume;
let cachedSoundMuted = false;
export const siteThemeOptions: Array<{ id: SiteTheme; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
// The 2026-07-26 trim cut the chess board tiles to the accessibility floor (a
// tile earns a slot by changing LEGIBILITY, not taste). 2026-07-31 finished the
// job: ONE board, no picker at all, the same shape pieceSets already has below.
// The wood pair was chosen to clear 3:1 by itself precisely so the High contrast
// tile could go with the taste tiles instead of outliving them. What the tiles
// cost was never the CSS: it was every renderer, OG card, marker and static
// diagram having to stay honest across N palettes.
// This list survives only so the stored-preference normalizer keeps a target;
// the board tile field is gone from the settings panel (theme-settings-panel.ts).
export const boardThemes: Array<{ id: BoardTheme; label: string }> = [
  { id: 'standard', label: 'Wood' },
];
// Fog shading affects readability, so it kept a control longer than the board and
// piece pickers did. HIDDEN FOR NOW (2026-08-27): the row is out of the settings
// panel (theme-settings-panel.ts) and everyone plays on the first entry. Nothing
// is erased, so putting the row back also brings back whatever each player had
// picked. The list stays because the stored-preference normalizer targets it.
export const fogThemes: Array<{ id: FogTheme; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'veil', label: 'Veil' },
  { id: 'invisible', label: 'None' },
];
// ONE chess set (2026-07-26). The chess family is a single deranked fog variant,
// so its piece art is a product decision, not a per-player one — the picker is
// gone from the settings panel entirely (see theme-settings-panel.ts) and this
// list exists only so the stored-preference normalizer keeps a target. Retired
// ids alias here rather than snapping, same as the board themes.
export const pieceSets: Array<{ id: PieceSet; label: string }> = [
  { id: 'cburnett', label: 'Cburnett' },
];
const defaultBoardFamily: BoardFamily = 'xiangqi';

// Xiangqi appearance (board themes + piece sets) is shared by full Dark Xiangqi,
// Dark Mini Xiangqi and Mini Xiangqi. These variants are baseline surfaces, so
// the family controls are always available.
export function xiangqiAppearanceEnabled(): boolean {
  return true;
}

// Shogi is no longer a player-facing game family. Keep its render/storage
// support available to historical surfaces, but do not advertise controls for
// a game that cannot be selected from the product.
export function shogiAppearanceEnabled(): boolean {
  return false;
}

export function enabledAppearanceFamilies(): Array<{ id: BoardFamily; label: string }> {
  return [
    ...(xiangqiAppearanceEnabled() ? [{ id: 'xiangqi' as BoardFamily, label: 'Xiangqi' }] : []),
    { id: 'chess', label: 'Chess' },
    ...(shogiAppearanceEnabled() ? [{ id: 'shogi' as BoardFamily, label: 'Shogi' }] : []),
  ];
}
let navObserver: MutationObserver | null = null;
let systemThemeWatcherBound = false;
const statusByThemeControl = new WeakMap<HTMLElement, ConnectionStatus>();

// The settings-panel chunk, shared by every mount point and loaded at most
// once. Warmed on gear hover/focus so the first click rarely waits on it.
type ThemeSettingsPanelModule = typeof import('./theme-settings-panel.js');
let panelModulePromise: Promise<ThemeSettingsPanelModule> | null = null;
function loadThemeSettingsPanel(): Promise<ThemeSettingsPanelModule> {
  panelModulePromise ??= import('./theme-settings-panel.js');
  return panelModulePromise;
}

export function initializeThemeSettings(): void {
  applySiteTheme(readStoredSiteTheme());
  applyBoardTheme(readStoredTheme());
  // Pinned to the default while the fog picker is hidden: a stored choice is
  // ignored, not read, so the whole site renders one shading style.
  applyFogTheme(defaultFogTheme);
  applyPieceSet(readStoredPieceSet());
  applyXiangqiBoardLayout(readStoredXiangqiBoardLayout());
  applyBoardCoordinates(readDisplayPreferences().boardCoordinates);
  applyXiangqiBoardTheme(readStoredXiangqiBoardTheme());
  applyXiangqiPieceSet(readStoredXiangqiPieceSet());
  applyShogiBoardTheme(readStoredShogiBoardTheme());
  applyShogiPieceSet(readStoredShogiPieceSet());
  if (!document.documentElement.dataset.boardFamily) {
    document.documentElement.dataset.boardFamily = defaultBoardFamily;
  }
  watchForSystemThemeChanges();
  mountThemeControls();
  watchForNavChanges();
}

// Set by the active route so the settings panel shows the right board/piece
// pickers (chess vs xiangqi).
export function setBoardFamily(family: BoardFamily): void {
  document.documentElement.dataset.boardFamily = family;
  syncBoardFamilyControls();
}

export function currentBoardFamily(): BoardFamily {
  const value = document.documentElement.dataset.boardFamily;
  return enabledAppearanceFamilies().some((family) => family.id === value)
    ? (value as BoardFamily)
    : defaultBoardFamily;
}

// Set when a document pins its own theme (the embed's ?theme=). It is NOT
// persisted: the pin belongs to that URL, not to the reader, so it must not
// leak into the preference every other Mistboard page reads.
let siteThemeOverride: 'light' | 'dark' | null = null;

/**
 * Pin the site theme for this document, ignoring both the stored preference and
 * the OS. Used by the embed so a host page with a single theme can ask for a
 * board that matches it.
 */
export function pinSiteTheme(theme: 'light' | 'dark'): void {
  siteThemeOverride = theme;
  applySiteTheme(theme);
}

function applySiteTheme(theme: SiteTheme): void {
  const resolved = resolveSiteTheme(theme);
  document.documentElement.dataset.siteTheme = theme;
  document.documentElement.dataset.effectiveTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
  updateThemeColorMeta(resolved);
}

function applyBoardTheme(theme: BoardTheme): void {
  document.documentElement.dataset.boardTheme = theme;
}

function applyFogTheme(theme: FogTheme): void {
  document.documentElement.dataset.fogTheme = theme;
}

function applyPieceSet(pieceSet: PieceSet): void {
  document.documentElement.dataset.pieceSet = pieceSet;
}

function applyXiangqiBoardTheme(theme: XiangqiBoardTheme): void {
  document.documentElement.dataset.xiangqiBoardTheme = theme;
}

function applyXiangqiBoardLayout(layout: XiangqiBoardLayout): void {
  document.documentElement.dataset.xiangqiBoardLayout = layout;
}

/** Mirrors the coordinate preference onto the root so CSS can pick the matching
 *  board aspect. The label gutter is only reserved when labels are shown, so the
 *  board is a different rectangle in each state and the host slot has to agree
 *  with the SVG viewBox -- it clips with overflow:hidden, and a stale ratio eats
 *  the outer rank. */
export function applyBoardCoordinates(on: boolean): void {
  document.documentElement.dataset.boardCoordinates = on ? 'on' : 'off';
}

function applyXiangqiPieceSet(pieceSet: XiangqiPieceSet): void {
  document.documentElement.dataset.xiangqiPieceSet = pieceSet;
}

function applyShogiBoardTheme(theme: ShogiBoardTheme): void {
  document.documentElement.dataset.shogiBoardTheme = theme;
}

function applyShogiPieceSet(pieceSet: ShogiPieceSet): void {
  document.documentElement.dataset.shogiPieceSet = pieceSet;
}

// --- high-level preference setters ---------------------------------------------
// Called by the lazily loaded settings panel (theme-settings-panel.ts). Each one
// applies the value, persists it, re-syncs every mounted control, and fires the
// change event the board surfaces re-render on — so the panel stays a dumb view.

export function setBoardThemePreference(theme: BoardTheme): void {
  applyBoardTheme(theme);
  writeStoredTheme(theme);
  syncThemeControls();
  dispatchBoardAppearanceChanged();
}

export function setFogThemePreference(theme: FogTheme): void {
  applyFogTheme(theme);
  writeStoredFogTheme(theme);
  syncThemeControls();
  dispatchBoardAppearanceChanged();
}

export function setPieceSetPreference(pieceSet: PieceSet): void {
  applyPieceSet(pieceSet);
  writeStoredPieceSet(pieceSet);
  syncThemeControls();
  dispatchBoardAppearanceChanged();
}

export function setXiangqiBoardChoicePreference(value: XiangqiBoardChoice): void {
  if (value !== 'cell') {
    applyXiangqiBoardTheme(value);
    writeStoredXiangqiBoardTheme(value);
  }
  const layout: XiangqiBoardLayout = value === 'cell' ? 'cell' : 'intersection';
  applyXiangqiBoardLayout(layout);
  writeStoredXiangqiBoardLayout(layout);
  syncThemeControls();
  dispatchXiangqiAppearanceChanged();
}

export function setXiangqiPieceSetPreference(pieceSet: XiangqiPieceSet): void {
  applyXiangqiPieceSet(pieceSet);
  writeStoredXiangqiPieceSet(pieceSet);
  syncThemeControls();
  dispatchXiangqiAppearanceChanged();
}

export function setShogiBoardThemePreference(theme: ShogiBoardTheme): void {
  applyShogiBoardTheme(theme);
  writeStoredShogiBoardTheme(theme);
  syncThemeControls();
  dispatchShogiAppearanceChanged();
}

export function setShogiPieceSetPreference(pieceSet: ShogiPieceSet): void {
  applyShogiPieceSet(pieceSet);
  writeStoredShogiPieceSet(pieceSet);
  syncThemeControls();
  dispatchShogiAppearanceChanged();
}

export function setXiangqiNotationPreference(value: XiangqiNotationPreference): void {
  writeStoredXiangqiNotation(value);
  syncThemeControls();
  // Review surfaces relabel their move trees on this event.
  window.dispatchEvent(new Event(xiangqiNotationChangedEvent));
  // The notation ALSO draws on the board now: coordinate labels follow it, and
  // the four styles do not agree on what a file is called or whether ranks are
  // named at all. It stopped being display-only the day coordinates shipped, so
  // the boards have to re-render too.
  dispatchXiangqiAppearanceChanged();
}

/** Turning board coordinates on or off changes the board's geometry, not just
 *  its paint: the label gutter is reserved only while they are shown. Boards
 *  re-render on the appearance event, and the root attribute is what CSS reads
 *  to pick the matching aspect ratio. */
export function setBoardCoordinatesPreference(on: boolean): void {
  writeDisplayPreference('boardCoordinates', on);
  applyBoardCoordinates(on);
  dispatchXiangqiAppearanceChanged();
}

export function setSoundVolumePreference(volume: number): void {
  const nextVolume = normalizeVolume(volume);
  writeStoredSoundVolume(nextVolume);
  if (nextVolume > 0 && readStoredSoundMuted()) {
    writeStoredSoundMuted(false);
  }
  dispatchSoundSettingsChanged();
  syncThemeControls();
}

export function setSoundSetPreference(id: SoundSetId | 'silent'): void {
  if (id === 'silent') {
    writeStoredSoundMuted(true);
    dispatchSoundSettingsChanged();
  } else {
    storeSoundSet(id);
    if (readStoredSoundMuted()) {
      writeStoredSoundMuted(false);
      dispatchSoundSettingsChanged();
    }
  }
  syncThemeControls();
}

function mountThemeControls(): void {
  for (const control of document.querySelectorAll<HTMLElement>('body > [data-theme-control]')) {
    control.remove();
  }
  for (const nav of document.querySelectorAll<HTMLElement>('.site-nav')) {
    mountThemeControl(nav);
  }
}

function watchForNavChanges(): void {
  if (navObserver) return;
  navObserver = new MutationObserver(() => mountThemeControls());
  navObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', closeThemeMenusOnOutsideClick);
  document.addEventListener('keydown', closeThemeMenusOnEscape);
}

// The single canonical settings gear: 8-spoke, filled (the lichess dasher
// affordance). Every gear in the app renders through this — the signed-out nav
// trigger here and the signed-in profile menu's Preferences row (account-nav.ts)
// — so the two never drift again (issue #139). `size` sets both width/height in
// px; the 24x24 viewBox is fixed.
export function gearIconSvg(size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd" aria-hidden="true" focusable="false"><path d="M13.6 2h-3.2l-.7 2.4c-.4.1-.8.3-1.1.5L6.4 3.7 3.9 6.2l1.2 2.2c-.2.4-.4.7-.5 1.1L2 10.3v3.4l2.6.8c.1.4.3.8.5 1.1l-1.2 2.2 2.5 2.5 2.2-1.2c.4.2.7.4 1.1.5l.7 2.4h3.2l.7-2.4c.4-.1.8-.3 1.1-.5l2.2 1.2 2.5-2.5-1.2-2.2c.2-.4.4-.7.5-1.1l2.6-.8v-3.4l-2.6-.8c-.1-.4-.3-.8-.5-1.1l1.2-2.2-2.5-2.5-2.2 1.2c-.4-.2-.7-.4-1.1-.5L13.6 2zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/></svg>`;
}

function mountThemeControl(nav: HTMLElement): void {
  // Signed in, the appearance panel folds into the profile dropdown
  // (account-nav.ts), so the standalone gear is not shown — matches lichess.
  if (isLikelySignedIn()) return;

  const target =
    nav.querySelector<HTMLElement>('.site-nav-utilities') ??
    nav.querySelector<HTMLElement>('.site-nav-links');
  if (!target) return;
  if (target.querySelector('[data-theme-control]')) return;

  const control = document.createElement('div');
  control.className = 'theme-control';
  control.dataset.themeControl = '';
  control.dataset.themeControlView = 'root';
  control.setAttribute('aria-label', 'Display and sound settings');

  const trigger = document.createElement('button');
  trigger.className = 'theme-control-trigger theme-control-trigger-icon';
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Settings');
  trigger.title = 'Settings';
  // Canonical filled gear (see gearIconSvg), matching lichess's signed-out
  // settings affordance.
  trigger.innerHTML = gearIconSvg(22);

  const panel = document.createElement('div');
  panel.className = 'theme-control-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Display and sound settings');

  // The panel body (appearance menu + connection status) lives in the lazily
  // loaded settings chunk and is built on first open. Hover/focus on the gear
  // warms the chunk so the click usually finds it already fetched; if the click
  // wins the race, the open panel fills in as soon as the module lands.
  let populated = false;
  const populatePanel = (): void => {
    if (populated) return;
    populated = true;
    loadThemeSettingsPanel()
      .then((mod) => {
        if (!control.isConnected || panel.childElementCount > 0) return;
        const status = mod.populateThemeControlPanel(control, panel);
        statusByThemeControl.set(control, status);
        if (control.classList.contains('open')) status.start();
      })
      .catch((err) => {
        populated = false; // let a later click retry the load
        console.warn('theme settings panel failed to load', err);
      });
  };
  const warmPanelChunk = (): void => {
    void loadThemeSettingsPanel().catch(() => undefined);
  };
  trigger.addEventListener('pointerenter', warmPanelChunk, { once: true });
  trigger.addEventListener('focus', warmPanelChunk, { once: true });

  trigger.addEventListener('click', () => {
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    closeThemeMenus();
    if (!expanded) {
      populatePanel();
      openThemeMenu(control);
    }
  });

  control.append(trigger, panel);
  // Gear sits at the far right of the nav, after Sign in / Register (lichess order).
  target.append(control);
}

// Options for the shared appearance drill-in menu (theme-settings-panel.ts).
// Declared here so both the facade below and the panel module share one type.
export type AppearanceMenuOptions = {
  includeLanguage?: boolean;
  // Called with the picked locale before the page navigates to the localized
  // URL. The signed-in dropdown uses it to persist the choice to the account.
  onLocaleSelect?: (locale: Locale) => void;
  // Lets an embedding menu, such as the signed-in account dropdown, replace its
  // whole surface when the appearance menu drills into a sub-panel.
  onViewChange?: (view: string) => void;
};

// Facade over the lazily loaded panel builder, keeping account-nav's
// synchronous contract: returns a placeholder .appearance-menu immediately and
// swaps the real drill-in menu in once the settings chunk lands. Until then the
// placeholder is an empty (but structurally valid) menu, so open/reset helpers
// that query .appearance-menu stay no-ops rather than crashing.
export function buildAppearanceMenu(options: AppearanceMenuOptions = {}): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'appearance-menu';
  holder.dataset.view = 'root';
  loadThemeSettingsPanel()
    .then((mod) => {
      holder.replaceWith(mod.buildAppearanceMenu(options));
    })
    .catch((err) => {
      console.warn('appearance menu failed to load', err);
    });
  return holder;
}

// Drill state lives in the DOM (data-view + hidden), so multiple mounted menus
// (mobile + desktop nav, gear + dropdown) stay independent.
export function showAppearanceView(
  menu: HTMLElement,
  view: string,
  onViewChange?: (view: string) => void,
): void {
  menu.dataset.view = view;
  const root = menu.querySelector<HTMLElement>('.appearance-menu-root');
  if (root) root.hidden = view !== 'root';
  for (const sub of menu.querySelectorAll<HTMLElement>('.appearance-submenu')) {
    sub.hidden = sub.dataset.key !== view;
  }
  onViewChange?.(view);
}

// Return every mounted appearance menu to its root list. Called when a parent
// dropdown opens so it never reopens mid-drill on a stale sub-panel.
export function resetAppearanceMenus(root: ParentNode = document): void {
  for (const menu of root.querySelectorAll<HTMLElement>('.appearance-menu')) {
    showAppearanceView(menu, 'root');
  }
}

export function syncBoardFamilyControls(): void {
  const active = currentBoardFamily();
  document.querySelectorAll<HTMLElement>('[data-board-family-select]').forEach((group) => {
    for (const option of group.querySelectorAll<HTMLButtonElement>('[data-board-family-option]')) {
      const selected = option.dataset.boardFamilyOption === active;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-checked', String(selected));
    }
  });
}

export type TileKind =
  | 'board'
  | 'fog'
  | 'piece'
  | 'xqboard'
  | 'xqpiece'
  | 'shogiboard'
  | 'shogipiece';

function openThemeMenu(control: HTMLElement): void {
  resetAppearanceMenus(control);
  control.classList.add('open');
  control
    .querySelector<HTMLButtonElement>('.theme-control-trigger')
    ?.setAttribute('aria-expanded', 'true');
  statusByThemeControl.get(control)?.start();
}

function closeThemeMenus(): void {
  document.querySelectorAll<HTMLElement>('[data-theme-control]').forEach((control) => {
    control.classList.remove('open');
    control
      .querySelector<HTMLButtonElement>('.theme-control-trigger')
      ?.setAttribute('aria-expanded', 'false');
    statusByThemeControl.get(control)?.stop();
  });
}

function closeThemeMenusOnOutsideClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('[data-theme-control]')) return;
  closeThemeMenus();
}

function closeThemeMenusOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  closeThemeMenus();
}

function syncThemeControls(): void {
  const siteTheme = readStoredSiteTheme();
  const boardTheme = readStoredTheme();
  const fogTheme = readStoredFogTheme();
  const pieceSet = readStoredPieceSet();
  const soundMuted = readStoredSoundMuted();
  const effectiveVolume = readEffectiveSoundVolume();
  syncSiteThemeControls(siteTheme);
  syncBoardFamilyControls();
  syncTileRow('board', boardTheme);
  syncTileRow('xqboard', readXiangqiBoardChoice());
  syncTileRow('shogiboard', readStoredShogiBoardTheme());
  syncTileRow('fog', fogTheme);
  syncTileRow('piece', pieceSet);
  syncTileRow('xqpiece', readStoredXiangqiPieceSet());
  syncTileRow('shogipiece', readStoredShogiPieceSet());
  document.querySelectorAll<HTMLInputElement>('input[data-sound-volume]').forEach((input) => {
    input.value = String(Math.round(effectiveVolume * 100));
  });
  document.querySelectorAll<HTMLButtonElement>('button[data-sound-option]').forEach((button) => {
    const id = button.dataset.soundOption;
    const isActive = soundMuted ? id === 'silent' : id === readStoredSoundSet();
    button.setAttribute('aria-checked', String(isActive));
    button.classList.toggle('selected', isActive);
  });
  const notation = readStoredXiangqiNotation();
  document
    .querySelectorAll<HTMLButtonElement>('button[data-xq-notation-option]')
    .forEach((button) => {
      const isActive = button.dataset.xqNotationOption === notation;
      button.setAttribute('aria-checked', String(isActive));
      button.classList.toggle('selected', isActive);
    });
  document
    .querySelectorAll<HTMLOutputElement>('output[data-sound-volume-value]')
    .forEach((output) => {
      output.textContent = soundMuted ? 'Muted' : formatVolume(effectiveVolume);
    });
  document.querySelectorAll<HTMLElement>('.theme-control-volume-field').forEach((field) => {
    field.classList.toggle('muted', soundMuted);
  });
}

export function readXiangqiBoardChoice(): XiangqiBoardChoice {
  return readStoredXiangqiBoardLayout() === 'cell' ? 'cell' : readStoredXiangqiBoardTheme();
}

function syncSiteThemeControls(activeTheme: SiteTheme): void {
  document
    .querySelectorAll<HTMLButtonElement>('button[data-site-theme-option]')
    .forEach((button) => {
      const isActive = button.dataset.siteThemeOption === activeTheme;
      button.setAttribute('aria-checked', String(isActive));
      button.classList.toggle('selected', isActive);
    });
}

function syncTileRow(kind: TileKind, activeId: string): void {
  document
    .querySelectorAll<HTMLButtonElement>(`button[data-theme-tile="${kind}"]`)
    .forEach((tile) => {
      const isActive = tile.dataset.id === activeId;
      tile.setAttribute('aria-checked', String(isActive));
      tile.classList.toggle('selected', isActive);
    });
}

export function setSiteThemePreference(theme: SiteTheme): void {
  const normalized = normalizeSiteTheme(theme);
  applySiteTheme(normalized);
  writeStoredSiteTheme(normalized);
  syncThemeControls();
  window.dispatchEvent(new Event(siteThemeChangedEvent));
}

export function readStoredSiteTheme(): SiteTheme {
  try {
    return normalizeSiteTheme(window.localStorage.getItem(siteThemeStorageKey));
  } catch {
    return defaultSiteTheme;
  }
}

function writeStoredSiteTheme(theme: SiteTheme): void {
  try {
    window.localStorage.setItem(siteThemeStorageKey, theme);
  } catch {
    // The data attribute still updates for the current page.
  }
}

export function readStoredTheme(): BoardTheme {
  try {
    return normalizeTheme(window.localStorage.getItem(boardStorageKey));
  } catch {
    return defaultTheme;
  }
}

function writeStoredTheme(theme: BoardTheme): void {
  try {
    window.localStorage.setItem(boardStorageKey, theme);
  } catch {
    // The data attribute still updates for the current page.
  }
}

export function readStoredFogTheme(): FogTheme {
  try {
    return normalizeFogTheme(window.localStorage.getItem(fogStorageKey));
  } catch {
    return defaultFogTheme;
  }
}

function writeStoredFogTheme(theme: FogTheme): void {
  try {
    window.localStorage.setItem(fogStorageKey, theme);
  } catch {
    // The data attribute still updates for the current page.
  }
}

export function readStoredPieceSet(): PieceSet {
  try {
    return normalizePieceSet(window.localStorage.getItem(pieceSetStorageKey));
  } catch {
    return defaultPieceSet;
  }
}

function writeStoredPieceSet(pieceSet: PieceSet): void {
  try {
    window.localStorage.setItem(pieceSetStorageKey, pieceSet);
  } catch {
    // The data attribute still updates for the current page.
  }
}

function dispatchXiangqiAppearanceChanged(): void {
  window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));
  dispatchBoardAppearanceChanged();
}

function dispatchShogiAppearanceChanged(): void {
  // Only the shogi-specific event — NOT the chess-wide boardAppearanceChangedEvent
  // — so a shogi set/theme change re-renders only the shogi surfaces (live board,
  // postgame, rules diagrams) and never refreshes the chess variant rail (which
  // would re-floor and visibly shrink its thumbnails).
  window.dispatchEvent(new Event(shogiAppearanceChangedEvent));
}

function dispatchBoardAppearanceChanged(): void {
  window.dispatchEvent(new Event(boardAppearanceChangedEvent));
}

export function readEffectiveSoundVolume(): number {
  return readStoredSoundMuted() ? 0 : readStoredSoundVolume();
}

function readStoredSoundVolume(): number {
  try {
    cachedSoundVolume = normalizeVolume(window.localStorage.getItem(soundVolumeStorageKey));
    return cachedSoundVolume;
  } catch {
    return cachedSoundVolume;
  }
}

function writeStoredSoundVolume(volume: number): void {
  cachedSoundVolume = normalizeVolume(volume);
  try {
    window.localStorage.setItem(soundVolumeStorageKey, String(cachedSoundVolume));
  } catch {
    // Sound settings still update for the current page.
  }
}

export function readStoredSoundMuted(): boolean {
  try {
    cachedSoundMuted = window.localStorage.getItem(soundMutedStorageKey) === 'true';
    return cachedSoundMuted;
  } catch {
    return cachedSoundMuted;
  }
}

function writeStoredSoundMuted(muted: boolean): void {
  cachedSoundMuted = muted;
  try {
    window.localStorage.setItem(soundMutedStorageKey, muted ? 'true' : 'false');
  } catch {
    // Sound settings still update for the current page.
  }
}

function dispatchSoundSettingsChanged(): void {
  window.dispatchEvent(new Event(soundSettingsChangedEvent));
}

function watchForSystemThemeChanges(): void {
  if (systemThemeWatcherBound || !window.matchMedia) return;
  systemThemeWatcherBound = true;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    // A pinned document does not follow the OS, which is the whole point of it.
    if (siteThemeOverride) return;
    if (readStoredSiteTheme() !== 'system') return;
    applySiteTheme('system');
    syncThemeControls();
    window.dispatchEvent(new Event(siteThemeChangedEvent));
  });
}

function resolveSiteTheme(theme: SiteTheme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function updateThemeColorMeta(theme: 'light' | 'dark'): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = theme === 'dark' ? '#121615' : '#ebefee';
}

function normalizeSiteTheme(value: string | null): SiteTheme {
  return siteThemeOptions.some((theme) => theme.id === value)
    ? (value as SiteTheme)
    : defaultSiteTheme;
}

// No alias table any more: with one board there is no "nearest survivor" to map
// a retired id onto, so every stored value — 'green', 'contrast', 'colorblind',
// 'blue', 'mono', or junk — lands on the single board. (The fog aliases below
// still matter; that picker kept its options.)
function normalizeTheme(value: string | null): BoardTheme {
  if (boardThemes.some((theme) => theme.id === value)) return value as BoardTheme;
  return defaultTheme;
}

// 'mistveil'/'drift' were softer veils; 'void' was an opaque blackout, so it lands
// on Solid. 'soft'/'hatched' predate the current set.
const RETIRED_FOG_THEMES: Record<string, FogTheme> = {
  soft: 'solid',
  hatched: 'solid',
  mistveil: 'veil',
  drift: 'veil',
  void: 'solid',
};

function normalizeFogTheme(value: string | null): FogTheme {
  if (fogThemes.some((theme) => theme.id === value)) return value as FogTheme;
  return (value && RETIRED_FOG_THEMES[value]) || defaultFogTheme;
}

const RETIRED_PIECE_SETS: Record<string, PieceSet> = {
  merida: 'cburnett',
  chessnut: 'cburnett',
  fantasy: 'cburnett',
  letter: 'cburnett',
};

function normalizePieceSet(value: string | null): PieceSet {
  if (pieceSets.some((set) => set.id === value)) return value as PieceSet;
  return (value && RETIRED_PIECE_SETS[value]) || defaultPieceSet;
}

function normalizeVolume(value: string | number | null): number {
  if (value === null) return defaultSoundVolume;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return defaultSoundVolume;
  return Math.min(1, Math.max(0, parsed));
}

export function formatVolume(volume: number): string {
  return `${Math.round(normalizeVolume(volume) * 100)}%`;
}
