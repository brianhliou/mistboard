// The appearance/sound settings-panel UI: the lichess-style drill-in menu the
// signed-out nav gear and the signed-in profile dropdown (account-nav.ts) share.
//
// This module is loaded LAZILY (dynamic import from theme.ts, on first gear
// interaction or when a dropdown embeds the menu) so its builders and the piece
// tile previews stay out of the entry chunk. theme.ts keeps the applied-theme
// bootstrap, the storage readers, the change events, and the high-level
// preference setters this panel calls — the panel is a dumb view over that API.
import { trackLocaleChanged, trackNotationChanged } from './analytics.js';
import { type ConnectionStatus, createConnectionStatus } from './connection-status.js';
import { type I18nKey, t } from './i18n/catalog.js';
import {
  currentLocale,
  LOCALE_META,
  type Locale,
  localeSwitchNavigation,
  SUPPORTED_LOCALES,
  setStoredLocale,
} from './i18n/locale.js';
import { readStoredSoundSet, SOUND_SETS, type SoundSetId } from './sound-sets.js';
import {
  type AppearanceMenuOptions,
  type BoardFamily,
  formatVolume,
  readEffectiveSoundVolume,
  readStoredSiteTheme,
  readStoredSoundMuted,
  readStoredXiangqiBoardColor,
  readStoredXiangqiRiverText,
  readStoredXiangqiStartMarkers,
  readXiangqiBoardChoice,
  type SiteTheme,
  setSiteThemePreference,
  setSoundSetPreference,
  setSoundVolumePreference,
  setXiangqiBoardChoicePreference,
  setXiangqiBoardColorPreference,
  setXiangqiNotationPreference,
  setXiangqiPieceSetPreference,
  setXiangqiRiverTextPreference,
  setXiangqiStartMarkersPreference,
  showAppearanceView,
  siteThemeOptions,
  type TileKind,
  type XiangqiBoardChoice,
  xiangqiAppearanceEnabled,
} from './theme.js';
import { buildUiIcon, type UiIconName } from './ui-icon.js';
import {
  readStoredXiangqiPieceSet,
  xiangqiBoardGrainFlag,
  xiangqiNotationOptions,
} from './xiangqi-appearance-storage.js';
import {
  JUNGLE_XIANGQI_BOARD_COLOR,
  XIANGQI_BOARD_COLOR_PRESETS,
  type XiangqiBoardColor,
  xiangqiBoardColorPreset,
} from './xiangqi-board-color.js';
import { currentXiangqiNotationPreference } from './xiangqi-notation.js';
import {
  XIANGQI_PIECE_SETS,
  type XiangqiPieceSet,
  xiangqiPieceTilePreview,
} from './xiangqi-piece-sets.js';
import { XIANGQI_RIVER_TEXTS, type XiangqiRiverText } from './xiangqi-river-text.js';

// Only boards that are genuinely different get a tile (Brian, 2026-10-08: the
// old International/Traditional tiles were a colour and a river caption riding
// on a "board", while start markers were a checkbox). Jungle was a third tile
// until his next review ("really just a reskin of the second one"); it is now
// the square grid's last colour swatch.
const xiangqiBoardChoices: Array<{ id: XiangqiBoardChoice; label: string }> = [
  { id: 'lined', label: 'Lined' },
  { id: 'cell', label: 'Square grid' },
];

// Fills the signed-out gear's dropdown panel: the shared appearance menu, a
// divider, and the connection-status footer. Returns the status so theme.ts can
// start/stop its polling with the menu's open state.
export function populateThemeControlPanel(
  control: HTMLElement,
  panel: HTMLElement,
): ConnectionStatus {
  const status = createConnectionStatus();
  panel.append(
    buildAppearanceMenu({
      includeLanguage: true,
      onViewChange: (view) => {
        control.dataset.themeControlView = view === 'root' ? 'root' : 'submenu';
      },
    }),
    createThemeDivider(),
    status.element,
  );
  return status;
}

// The appearance controls as a lichess-style drill-in menu: a compact list of
// category rows (Appearance, Fog, Sound, Board, Pieces) that each open a
// sub-panel with that category's controls. Shared by the signed-out gear above
// and the signed-in profile dropdown (account-nav.ts, through the lazy facade
// in theme.ts), which embeds it directly so there's no standalone gear when
// logged in.
//
// Board + piece pickers are per game family. When a xiangqi variant is enabled a
// Game selector sits above the Board/Pieces rows and scopes which family's tiles
// the sub-panels show (the family-gating CSS hides the inactive family). On a
// chess-only build there's no selector and the menu mirrors a single-game setup.
export function buildAppearanceMenu(options: AppearanceMenuOptions = {}): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'appearance-menu';
  const locale = currentLocale();

  const root = document.createElement('div');
  root.className = 'appearance-menu-root';
  const submenus: HTMLElement[] = [];

  const addCategory = (
    key: string,
    label: string,
    body: HTMLElement[],
    icon?: UiIconName,
  ): void => {
    root.append(createAppearanceRow(key, label, icon));
    submenus.push(createAppearanceSubmenu(key, label, body));
  };

  // Row order mirrors the lichess dasher (Language, Sound, Appearance, Board,
  // Piece set). The per-game Board/Piece pickers carry the Game family selector
  // inside their own sub-panel, so the root stays a narrow list of rows.
  // Language is the one row that carries a glyph, as on lichess: it is the row a
  // reader who cannot read the current interface language has to find, so it
  // needs a marker that survives not reading the label. The sibling rows stay
  // text-only on purpose; icons on all five would drown it out.
  if (options.includeLanguage) {
    addCategory(
      'language',
      t('nav.language', {}, locale),
      [createLanguageField(locale, options.onLocaleSelect)],
      'language',
    );
  }
  addCategory('sound', t('prefs.sound', {}, locale), [createSoundPanel()]);
  addCategory('theme', t('prefs.appearance', {}, locale), [createSiteThemeList()]);

  // Board carries XIANGQI ONLY (2026-07-31), for the same reason Pieces did in
  // July: chess ships ONE board now, so there is no choice to offer — and with
  // nothing left to scope, the Game selector goes with it. Keeping the selector
  // would reproduce the empty-panel bug called out under Pieces below, since
  // choosing 'chess' would gate away the only remaining field. That also means
  // the xiangqi field must NOT be family-gated.
  const boardBody: HTMLElement[] = [];
  if (xiangqiAppearanceEnabled()) {
    boardBody.push(
      createTileField(
        'xqboard',
        t('prefs.boardStyle', {}, locale),
        t('prefs.xiangqiBoardPresentation', {}, locale),
        xiangqiBoardChoices,
        readXiangqiBoardChoice(),
        setXiangqiBoardChoicePreference,
        undefined,
        false,
      ),
      createXiangqiBoardColorField(locale),
      createXiangqiRiverTextField(locale),
      createXiangqiStartMarkersField(locale),
    );
  }
  addCategory('board', t('prefs.board', {}, locale), boardBody);

  // Pieces carries XIANGQI ONLY (2026-07-26). Chess ships one set, so there is no
  // choice to offer — and with nothing to scope, the Game selector goes too: it
  // would leave an EMPTY panel whenever the shared family state (set from the
  // Board panel, which still has chess themes) happened to be 'chess'. That also
  // means the xiangqi field must NOT be family-gated, or the same empty panel
  // comes back through the gating CSS.
  const pieceBody: HTMLElement[] = [];
  if (xiangqiAppearanceEnabled()) {
    pieceBody.push(
      createTileField(
        'xqpiece',
        t('prefs.pieces', {}, locale),
        t('prefs.xiangqiPieceSet', {}, locale),
        XIANGQI_PIECE_SETS,
        readStoredXiangqiPieceSet(),
        setXiangqiPieceSetPreference,
        undefined,
        false,
      ),
    );
  }
  addCategory('pieces', t('prefs.pieces', {}, locale), pieceBody);

  // Move-notation display mode for xiangqi review/analysis move lists.
  if (xiangqiAppearanceEnabled()) {
    addCategory('notation', t('prefs.notation', {}, locale), [createXiangqiNotationList()]);
  }

  // Fog was our one row beyond the lichess set and sat last. HIDDEN FOR NOW
  // (2026-08-27): everyone gets the first shading style, pinned in theme.ts. The
  // options, the CSS per skin and the stored values all survive, so restoring
  // this row is the whole revert.

  menu.append(root, ...submenus);

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-appearance-target]')) {
    button.addEventListener('click', () =>
      showAppearanceView(menu, button.dataset.appearanceTarget ?? 'root', options.onViewChange),
    );
  }
  for (const back of menu.querySelectorAll<HTMLButtonElement>('.appearance-submenu-back')) {
    back.addEventListener('click', () => showAppearanceView(menu, 'root', options.onViewChange));
  }
  showAppearanceView(menu, 'root', options.onViewChange);
  return menu;
}

function createAppearanceRow(key: string, label: string, icon?: UiIconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'appearance-menu-row';
  button.dataset.appearanceTarget = key;
  const text = document.createElement('span');
  text.className = 'appearance-menu-row-label';
  text.textContent = label;
  const chevron = document.createElement('span');
  chevron.className = 'appearance-menu-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  if (icon) button.append(buildUiIcon(icon, 'appearance-menu-row-icon'));
  button.append(text, chevron);
  return button;
}

function createAppearanceSubmenu(key: string, label: string, body: HTMLElement[]): HTMLDivElement {
  const sub = document.createElement('div');
  sub.className = 'appearance-submenu';
  sub.dataset.key = key;

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'appearance-submenu-back';
  const arrow = document.createElement('span');
  arrow.className = 'appearance-submenu-back-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  const backText = document.createElement('span');
  backText.textContent = label;
  back.append(arrow, backText);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'appearance-submenu-body';
  bodyWrap.append(...body);

  sub.append(back, bodyWrap);
  return sub;
}

function createLanguageField(
  locale: Locale = currentLocale(),
  onSelect?: (locale: Locale) => void,
): HTMLDivElement {
  const list = document.createElement('div');
  list.className = 'appearance-language-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', t('nav.language', {}, locale));

  for (const optionLocale of SUPPORTED_LOCALES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'appearance-language-option';
    option.dataset.locale = optionLocale;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(optionLocale === locale));
    option.textContent = LOCALE_META[optionLocale].displayName;
    if (optionLocale === locale) option.classList.add('selected');
    option.addEventListener('click', () => {
      onSelect?.(optionLocale);
      if (optionLocale !== locale) trackLocaleChanged(locale, optionLocale);
      setStoredLocale(optionLocale);
      const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const navigation = localeSwitchNavigation(currentHref, optionLocale);
      if (navigation.kind === 'reload') window.location.reload();
      else window.location.href = navigation.href;
    });
    list.append(option);
  }

  return list;
}

function createThemeDivider(): HTMLDivElement {
  const divider = document.createElement('div');
  divider.className = 'account-nav-divider theme-control-divider';
  divider.setAttribute('role', 'separator');
  return divider;
}

function createSiteThemeList(): HTMLDivElement {
  const list = document.createElement('div');
  list.className = 'appearance-choice-list appearance-theme-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Site appearance');

  for (const option of siteThemeOptions) {
    list.append(createSiteThemeButton(option.id, siteThemeMenuLabel(option.id)));
  }

  return list;
}

function createSiteThemeButton(theme: SiteTheme, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'appearance-choice-option';
  button.dataset.siteThemeOption = theme;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(readStoredSiteTheme() === theme));
  button.textContent = label;
  if (readStoredSiteTheme() === theme) button.classList.add('selected');
  button.addEventListener('click', () => setSiteThemePreference(theme));
  return button;
}

function siteThemeMenuLabel(theme: SiteTheme): string {
  if (theme === 'system') return 'Device theme';
  return siteThemeOptions.find((option) => option.id === theme)?.label ?? theme;
}

function createTileField<T extends string>(
  kind: TileKind,
  label: string,
  ariaLabel: string,
  options: ReadonlyArray<{ id: T; label: string }>,
  value: T,
  onChange: (value: T) => void,
  family?: BoardFamily,
  showLabel = true,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'theme-control-field';
  if (family) field.dataset.appearanceFamily = family;

  const row = document.createElement('div');
  row.className = 'theme-tile-row';
  row.dataset.themeTileRow = kind;
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', ariaLabel);

  for (const option of options) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'theme-tile';
    tile.dataset.themeTile = kind;
    tile.dataset.id = option.id;
    tile.setAttribute('role', 'radio');
    tile.setAttribute('aria-checked', String(option.id === value));
    tile.setAttribute('aria-label', option.label);
    tile.title = option.label;
    if (option.id === value) tile.classList.add('selected');

    const preview = document.createElement('span');
    preview.className = `theme-tile-preview theme-tile-preview-${kind}`;
    preview.dataset.id = option.id;
    // Xiangqi piece tiles show a representative mark; the board tiles use
    // a CSS color swatch like the chess board tiles.
    if (kind === 'xqpiece') {
      const xiangqiPreview = xiangqiPieceTilePreview(option.id as XiangqiPieceSet);
      if (xiangqiPreview.kind === 'svg') {
        preview.innerHTML = xiangqiPreview.markup;
      } else {
        preview.textContent = xiangqiPreview.text;
      }
    }
    tile.append(preview);

    tile.addEventListener('click', () => onChange(option.id));
    row.append(tile);
  }

  if (showLabel) {
    const text = document.createElement('span');
    text.textContent = label;
    field.append(text);
  }
  field.append(row);
  return field;
}

const BOARD_COLOR_LABEL_KEYS: Record<XiangqiBoardColor, I18nKey> = {
  international: 'prefs.boardColorInternational',
  traditional: 'prefs.boardColorTraditional',
  paper: 'prefs.boardColorPaper',
  birch: 'prefs.boardColorBirch',
  oak: 'prefs.boardColorOak',
  grey: 'prefs.boardColorGrey',
  slate: 'prefs.boardColorSlate',
  grain: 'prefs.boardColorGrain',
  jungle: 'prefs.boardColorJungle',
};

// Board colour: one row of round swatches, a radiogroup like the tiles above.
// No free picker ("RGB selector is a bit too complex"). The last swatch is
// Jungle, a lawn with a strip of river; CSS (theme.css) shows it only on the
// square grid, the one layout Jungle is drawn on.
function createXiangqiBoardColorField(locale: Locale): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'theme-control-field xq-board-color-field';
  const label = document.createElement('span');
  label.textContent = t('prefs.boardColor', {}, locale);

  const row = document.createElement('div');
  row.className = 'xq-board-color-row';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', t('prefs.boardColor', {}, locale));

  const active = readStoredXiangqiBoardColor();
  const ids: XiangqiBoardColor[] = [
    ...XIANGQI_BOARD_COLOR_PRESETS.map((preset) => preset.id),
    ...(xiangqiBoardGrainFlag() ? (['grain'] as const) : []),
    JUNGLE_XIANGQI_BOARD_COLOR,
  ];
  for (const id of ids) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'xq-board-color-swatch';
    swatch.dataset.xqBoardColor = id;
    const name = t(BOARD_COLOR_LABEL_KEYS[id], {}, locale);
    swatch.title = name;
    swatch.setAttribute('aria-label', name);
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-checked', String(id === active));
    if (id === active) swatch.classList.add('selected');
    if (id !== JUNGLE_XIANGQI_BOARD_COLOR) {
      swatch.style.setProperty('--xq-swatch', xiangqiBoardColorPreset(id).fill);
    }
    swatch.addEventListener('click', () => setXiangqiBoardColorPreference(id));
    row.append(swatch);
  }

  field.append(label, row);
  return field;
}

// River text: a three-way segmented choice. The two captions are labelled with
// themselves (they read the same in every interface language); only "Off" is
// translated. Hidden on the square grid by CSS, whose river has no room for one.
function createXiangqiRiverTextField(locale: Locale): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'theme-control-field xq-river-text-field';
  const label = document.createElement('span');
  label.textContent = t('prefs.riverText', {}, locale);

  const row = document.createElement('div');
  row.className = 'xq-river-text-row';
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', t('prefs.riverText', {}, locale));

  const labels: Record<XiangqiRiverText, string> = {
    off: t('prefs.riverTextOff', {}, locale),
    classic: '楚河 漢界',
    brand: 'Mistboard',
  };
  const active = readStoredXiangqiRiverText();
  for (const id of XIANGQI_RIVER_TEXTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-mode-option';
    button.dataset.xqRiverText = id;
    button.textContent = labels[id];
    if (id === 'classic') button.lang = 'zh-Hant';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(id === active));
    if (id === active) button.classList.add('selected');
    button.addEventListener('click', () => setXiangqiRiverTextPreference(id));
    row.append(button);
  }

  field.append(label, row);
  return field;
}

// The printed start brackets. Hidden on the square grid by CSS (theme.css): the
// marks are drawn only on the lined layout, so the switch would do nothing there.
function createXiangqiStartMarkersField(locale: Locale): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'theme-control-check-field xq-start-markers-field';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.xqStartMarkers = '';
  input.checked = readStoredXiangqiStartMarkers();
  input.addEventListener('change', () => setXiangqiStartMarkersPreference(input.checked));
  const text = document.createElement('span');
  text.textContent = t('prefs.startMarkers', {}, locale);
  field.append(input, text);
  return field;
}

function createXiangqiNotationList(): HTMLDivElement {
  const list = document.createElement('div');
  list.className = 'appearance-choice-list appearance-notation-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', t('prefs.notation'));
  const current = currentXiangqiNotationPreference();
  for (const option of xiangqiNotationOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'appearance-choice-option appearance-notation-option';
    button.dataset.xqNotationOption = option.id;
    button.setAttribute('role', 'radio');
    const selected = option.id === current;
    button.setAttribute('aria-checked', String(selected));
    if (selected) button.classList.add('selected');
    const label = document.createElement('span');
    label.textContent = option.label;
    const preview = document.createElement('span');
    preview.className = 'appearance-notation-preview';
    preview.textContent = option.preview;
    button.append(label, preview);
    button.addEventListener('click', () => {
      const from = currentXiangqiNotationPreference();
      if (from === option.id) return;
      setXiangqiNotationPreference(option.id);
      trackNotationChanged(from, option.id, window.location.pathname);
    });
    list.append(button);
  }
  return list;
}

function createSoundPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'appearance-sound-panel';

  const volume = createVolumeField();
  volume.classList.add('appearance-sound-volume');

  const list = document.createElement('div');
  list.className = 'appearance-choice-list appearance-sound-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', t('prefs.soundSet'));

  for (const set of SOUND_SETS) {
    list.append(createSoundOption(set.id, set.label));
  }
  list.append(createSoundOption('silent', t('prefs.silent')));

  panel.append(volume, list);
  return panel;
}

function createVolumeField(): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'theme-control-field theme-control-volume-field';
  const row = document.createElement('span');
  row.className = 'theme-control-field-row';
  const label = document.createElement('span');
  label.textContent = t('prefs.volume');
  const value = document.createElement('output');
  value.dataset.soundVolumeValue = '';
  value.textContent = readStoredSoundMuted() ? 'Muted' : formatVolume(readEffectiveSoundVolume());
  row.append(label, value);

  if (readStoredSoundMuted()) field.classList.add('muted');

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(Math.round(readEffectiveSoundVolume() * 100));
  input.dataset.soundVolume = '';
  input.setAttribute('aria-label', 'Sound volume');
  input.addEventListener('input', () => {
    setSoundVolumePreference(Number(input.value) / 100);
  });

  field.append(row, input);
  return field;
}

function createSoundOption(id: SoundSetId | 'silent', label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'appearance-choice-option';
  button.dataset.soundOption = id;
  button.setAttribute('role', 'radio');
  const selected = readStoredSoundMuted() ? id === 'silent' : id === readStoredSoundSet();
  button.setAttribute('aria-checked', String(selected));
  button.textContent = label;
  if (selected) button.classList.add('selected');
  button.addEventListener('click', () => setSoundSetPreference(id));
  return button;
}
