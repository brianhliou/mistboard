import { PIECE_SVGS } from '@mistboard/board-render';
import {
  BANQI_SPEC_ID,
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  CROSSROADS_CHESS_SPEC_ID,
  canonicalVariantOrderIndex,
  DARK_CHESS_SPEC_ID,
  DARK_CRAZYHOUSE_SPEC_ID,
  DARK_CROSSROADS_CHESS_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  DARK_MINI_XIANGQI_SPEC_ID,
  DARK_SHOGI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DROP_MINI_XIANGQI_SPEC_ID,
  DUAL_CHESS_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  engineTimeControlPin,
  FORTRESS_XIANGQI_SPEC_ID,
  gameSpecForId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  KRIEGSPIEL_SPEC_ID,
  MINI_XIANGQI_SPEC_ID,
  RATED_TIME_CONTROLS,
  REVEAL_CHESS_SPEC_ID,
  TIME_CONTROLS,
  type TimeClass,
  type TimeControlId,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import {
  classifyTimeControl,
  gameSpecAnalyticsProps,
  gameSpecAnalyticsPropsForId,
  track,
} from './analytics.js';
import { bindBotPlayControl } from './bot-play.js';
import { correspondenceEnabled, crossroadsChessEnabled } from './feature-flags.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import {
  LANDING_BOT_GAME_SPEC_IDS,
  landingBotLineup,
  landingBotOffer,
  landingBotRotationBucket,
  landingXiangqiBotOffers,
} from './landing-bot-policy.js';
import { rememberedPveEngine } from './pve-memory.js';
import { isRatedModeEnabled } from './rated-flag.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildUiIcon, type UiIconName } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import { variantSupportsPve } from './variant-public-surfaces.js';
import {
  defaultTimePresetForSpec,
  webVariantTenantForSpecId,
  webVariantTenants,
} from './variant-tenant/registry.js';
import { isVariantEnabled, variantMiniIdForGameSpec } from './variants.js';
import { ENGINE_OFFER_AFTER_MS, shouldOfferEngine } from './web-utils.js';

export type PlayableEngine = {
  id: string;
  name: string;
  familyName: string;
  kind: string;
};

type LandingPlayChoice = {
  engineId?: string;
  engines?: PlayableEngine[];
  initialGameSpecId?: LandingGameSpecId;
  locale?: Locale;
  mode: LandingPlayMode;
  // Unified entry point: render the opponent switcher (Computer / A friend /
  // Anyone) at the top of the dialog. Switching rebuilds the dialog in the
  // picked mode, carrying the variant selection and engine roster over.
  modeSwitcher?: boolean;
  ratedDisabled?: boolean;
  // Open on the correspondence (days-per-move) side of the time-control toggle
  // instead of real time. The Correspondence tab's own CTA uses it so the dialog
  // it opens matches the tab the player clicked from.
  initialTimeMode?: 'realtime' | 'correspondence';
};
type LandingPlayMode = 'lobby' | 'pvp' | 'pve';
type LandingGameSpecId =
  | typeof DARK_CHESS_SPEC_ID
  | typeof MINI_XIANGQI_SPEC_ID
  | typeof DARK_MINI_XIANGQI_SPEC_ID
  | typeof DROP_MINI_XIANGQI_SPEC_ID
  | typeof DARK_XIANGQI_SPEC_ID
  | typeof CROSSROADS_CHESS_SPEC_ID
  | typeof DARK_CROSSROADS_CHESS_SPEC_ID
  | typeof DARK_SHOGI_SPEC_ID
  | typeof DARK_CRAZYHOUSE_SPEC_ID
  | typeof KRIEGSPIEL_SPEC_ID
  | typeof JIEQI_SPEC_ID
  | typeof BANQI_SPEC_ID
  | typeof REVEAL_CHESS_SPEC_ID
  | typeof JUNGLE_SPEC_ID
  | typeof JUNGLE_FLIP_SPEC_ID
  | typeof FORTRESS_XIANGQI_SPEC_ID
  | typeof XIANGQI_SPEC_ID
  | typeof DUCK_XIANGQI_SPEC_ID;
type LandingStartFormat = 'standard' | 'draft960';
type LandingTimePresetId = TimeControlId;
type LandingTimePreset = {
  id: LandingTimePresetId;
  label: string;
  initialMs: number;
  incrementMs: number;
  timeClass: TimeClass;
};
type LandingColorPreference = 'white' | 'red' | 'black' | 'random';
type LandingPlayerColor = Exclude<LandingColorPreference, 'random'>;
type LandingGameSpecCapabilities = {
  firstColor: LandingPlayerColor;
  firstGlyph: string;
  firstLabel: string;
  glyphClass?: string;
  neutralGlyphColor?: boolean;
  pickerLabel?: string;
  secondColor: LandingPlayerColor;
  secondGlyph: string;
  secondLabel: string;
  supportsRated: boolean;
  supportsStartFormat: boolean;
  supportsTimeControl: boolean;
};
export type LandingRoomSetup = {
  gameSpecId: LandingGameSpecId;
  startFormat: LandingStartFormat;
  rated: boolean;
  timeControl: {
    initialMs: number;
    incrementMs: number;
  };
  preferredColor: LandingColorPreference;
};
type LandingSetupPreference = {
  // Legacy single-slot engine pick (pre per-variant). Still read/written for
  // back-compat; `engineIdByGameSpec` is the source of truth going forward.
  engineId?: string;
  // Last-played engine per variant, so picking a banqi engine never clobbers the
  // remembered jieqi engine (and vice versa).
  engineIdByGameSpec?: Partial<Record<LandingGameSpecId, string>>;
  gameSpecId?: LandingGameSpecId;
  preferredColor?: LandingColorPreference;
  rated?: boolean;
  startFormat?: LandingStartFormat;
  timePresetId?: LandingTimePresetId;
};
type LobbyTicketResponse = {
  pollAfterMs?: number;
  status?: 'waiting' | 'matched';
  ticketId?: string;
  url?: string;
};
type OpenLobbyRequest = {
  gameSpecId?: string;
  hiddenDraft960: boolean;
  rated?: boolean;
  timeControl: {
    initialMs: number;
    incrementMs: number;
  };
  waitingMs: number;
};
type RoomCreationFailure = {
  error?: string;
};

const ENGINE_SEAT_RETRY_MS = 3_000;
const LANDING_TIME_PRESETS: LandingTimePreset[] = TIME_CONTROLS.map((tc) => ({
  id: tc.id,
  label: tc.label,
  initialMs: tc.initialMs,
  incrementMs: tc.incrementMs,
  timeClass: tc.timeClass,
}));

// The engine-pace pin for a variant, from the shared policy in @mistboard/game
// (engineTimeControlPin) that the create route also rejects against. Fog Chess
// PvE is pinned to 5+5 because Misty's per-move floor outruns a 2s increment
// and it loses on time in long games (#283); see that policy for the detail.
function pveTimePresetPin(gameSpecId: LandingGameSpecId): LandingTimePresetId | null {
  return engineTimeControlPin(gameSpecId)?.id ?? null;
}

// Lichess pairs every quick-pairing pool with its speed category (Bullet / Blitz /
// Rapid) under the clock. English-for-now, matching the rest of the lobby board.
// Which time-control presets the picker offers, per variant and mode. Tenant
// variants declare their own choices in the web registry; Fog Chess uses all
// three official live controls. Both the engine pin above and `rated` NARROW
// that set rather than replacing it, so a variant that does not offer a pace
// casually never offers it rated or against a bot either.
function allowedTimePresetIds(
  gameSpecId: LandingGameSpecId,
  rated: boolean,
  mode: LandingPlayMode,
): ReadonlySet<LandingTimePresetId> {
  const tenantLanding = webVariantTenantForSpecId(gameSpecId)?.landing;
  // The no-tenant-config fallback is fog chess and draft960. Their PvE is
  // pinned to 5+5 (#283) and the pin narrows this set below, so the 10+5 rung
  // here only ever reaches their human games.
  const offered = tenantLanding
    ? new Set<LandingTimePresetId>(tenantLanding.timePresetIds)
    : new Set<LandingTimePresetId>(['1m1', '3m2', '5m5', '10m5']);
  const pin = mode === 'pve' ? pveTimePresetPin(gameSpecId) : null;
  const paced = pin && offered.has(pin) ? new Set<LandingTimePresetId>([pin]) : offered;
  if (!rated) return paced;
  // Same source as the server's rated allowlist: the `rated` flag on each
  // time-control spec (@mistboard/game), so the two cannot drift.
  const ratedIds = new Set<string>(RATED_TIME_CONTROLS.map((tc) => tc.id));
  return new Set<LandingTimePresetId>([...paced].filter((id) => ratedIds.has(id)));
}
// Dark chess is always offered. Integrated tenant variants join the normal play
// entry points through their registry landing config.
function enabledLandingVariantGameSpecs(
  _mode: LandingPlayMode,
  locale: Locale,
): { gameSpecId: LandingGameSpecId; label: string }[] {
  const specs: { gameSpecId: LandingGameSpecId; label: string }[] = [
    { gameSpecId: DARK_CHESS_SPEC_ID, label: variantLabelForGameSpec(DARK_CHESS_SPEC_ID, locale) },
  ];
  // Each tenant's registry entry decides whether it appears in normal play-menu
  // entry points (Dark Xiangqi never does: it has no live room/lobby runtime).
  for (const tenant of webVariantTenants()) {
    if (!tenant.landing?.offerInMenu()) continue;
    specs.push({
      gameSpecId: tenant.gameSpecId as LandingGameSpecId,
      label: variantLabelForGameSpec(tenant.gameSpecId as LandingGameSpecId, locale),
    });
  }
  // The tenant registry iterates in import order, not the rail's order; present
  // the picker in the one canonical variant order shared with every surface.
  specs.sort(
    (a, b) => canonicalVariantOrderIndex(a.gameSpecId) - canonicalVariantOrderIndex(b.gameSpecId),
  );
  return specs;
}

function variantLabelForGameSpec(gameSpecId: LandingGameSpecId, locale: Locale): string {
  const key = variantNameKeyForGameSpec(gameSpecId);
  return key ? t(key, {}, locale) : gameSpecForId(gameSpecId).publicName;
}

function variantNameKeyForGameSpec(gameSpecId: LandingGameSpecId): I18nKey | null {
  switch (gameSpecId) {
    case DARK_CHESS_SPEC_ID:
      return 'variant.darkChess.name';
    case DARK_CRAZYHOUSE_SPEC_ID:
      return 'variant.darkCrazyhouse.name';
    case KRIEGSPIEL_SPEC_ID:
      return 'variant.kriegspiel.name';
    case REVEAL_CHESS_SPEC_ID:
      return 'variant.revealChess.name';
    case MINI_XIANGQI_SPEC_ID:
      return 'variant.miniXiangqi.name';
    case DARK_MINI_XIANGQI_SPEC_ID:
      return 'variant.darkMiniXiangqi.name';
    case DROP_MINI_XIANGQI_SPEC_ID:
      return 'variant.dropMiniXiangqi.name';
    case DARK_XIANGQI_SPEC_ID:
      return 'variant.darkXiangqi.name';
    case JIEQI_SPEC_ID:
      return 'variant.jieqi.name';
    case BANQI_SPEC_ID:
      return 'variant.banqi.name';
    case CROSSROADS_CHESS_SPEC_ID:
      return 'variant.crossroadsChess.name';
    case DARK_CROSSROADS_CHESS_SPEC_ID:
      return 'variant.darkCrossroadsChess.name';
    case DARK_SHOGI_SPEC_ID:
      return 'variant.darkShogi.name';
    case JUNGLE_SPEC_ID:
      return 'variant.jungle.name';
    case JUNGLE_FLIP_SPEC_ID:
      return 'variant.jungleFlip.name';
    case FORTRESS_XIANGQI_SPEC_ID:
      return 'variant.fortressXiangqi.name';
    case DUCK_XIANGQI_SPEC_ID:
      return 'variant.duckXiangqi.name';
    case XIANGQI_SPEC_ID:
      return 'variant.xiangqi.name';
    default:
      return null;
  }
}

function parseLandingGameSpecId(value: string): LandingGameSpecId {
  const tenant = webVariantTenantForSpecId(value);
  return tenant ? (tenant.gameSpecId as LandingGameSpecId) : DARK_CHESS_SPEC_ID;
}

// Fog Chess is the one picker row NOT sourced from the tenant registry:
// enabledLandingVariantGameSpecs hardcodes it, because ordinary fog rooms ride
// the pre-registry chess shell and the dark-chess tenant entry exists only for
// correspondence rooms (no landing config, so no acceptsDeepLink). Mirror that
// hardcode here or the picker offers a variant no link can name: without it,
// ?variant=dark-chess resolved to undefined and the dialog fell through to
// `storedPreference ?? fallback` below, so a player whose last PvP setup was
// jieqi opened a Jieqi dialog from a Fog Chess link (measured 2026-09-04).
//
// The rest stays keyed on the tenant's own acceptsDeepLink, which is
// DELIBERATELY wider than offerInMenu: menu-hidden lab surfaces (DMX, Drop Mini
// Xiangqi, Dark Shogi, Dark Crazyhouse) have no other door, and the soft-link
// branch in the dialog exists to seat them. Collapsing the two lists makes
// `npm run dev:lab` unable to reach any of them.
/** Whether a play deep link can name this spec, i.e. whether the dialog will
 *  actually open ON it rather than falling through to the player's stored
 *  preference. The post-game invite gates on this so the two cannot disagree. */
export function landingPlayDeepLinkAccepts(variant: string): boolean {
  return deepLinkInitialVariant(variant, 'pvp') !== undefined;
}

function deepLinkInitialVariant(
  variant: string | null,
  _mode: LandingPlayMode,
): LandingGameSpecId | undefined {
  if (variant === DARK_CHESS_SPEC_ID) return DARK_CHESS_SPEC_ID;
  const tenant = variant ? webVariantTenantForSpecId(variant) : null;
  if (tenant?.landing?.acceptsDeepLink()) return tenant.gameSpecId as LandingGameSpecId;
  return undefined;
}
const DARK_CHESS_LANDING_CAPABILITIES: LandingGameSpecCapabilities = {
  firstColor: 'white',
  firstGlyph: '♚',
  firstLabel: 'White',
  secondColor: 'black',
  secondGlyph: '♚',
  secondLabel: 'Black',
  supportsRated: true,
  supportsStartFormat: true,
  supportsTimeControl: true,
};

// UI-only placeholder shown in the engine picker before /api/engines/playable
// resolves (or if every retry fails). It is NOT a real, submittable engine: the
// id is a sentinel the server rejects with 400 invalid_engine, so it can never
// produce a game. We label it "Misty" (the brand) instead of the old built-in
// "Random Legal v1" so a slow or failed load never shows a wrong opponent name.
// landing.ts retries the fetch and refetches on refocus to shrink this window to
// near-zero; the real roster ("Misty 1.0") swaps in the moment the API lands.
export const PENDING_ENGINE_ID = 'pending-engine';
export function fallbackPlayableEngines(): PlayableEngine[] {
  return [{ id: PENDING_ENGINE_ID, name: 'Misty', familyName: 'Misty', kind: 'builtin' }];
}

// How the play panel hands off to a freshly created/matched room. Defaults to a
// full document navigation; mountLanding swaps in an in-place SPA transition so
// the starting click's user activation carries into the room (lets the engine's
// opening move sound without a fresh in-room gesture — see live-sound.ts).
type RoomNavigator = (url: string) => void;
const fullReloadNavigator: RoomNavigator = (url) => {
  window.location.href = url;
};
let roomNavigator: RoomNavigator = fullReloadNavigator;
export function setRoomNavigator(nav: RoomNavigator | null): void {
  roomNavigator = nav ?? fullReloadNavigator;
}

// The currently open setup dialog's close handler, if any. An in-place room
// transition must dismiss the dialog (it lives on document.body, outside #app,
// so the DOM swap would otherwise strand it and its document-level keydown
// listener).
let activeDialogClose: (() => void) | null = null;
export function closeActiveLandingDialog(): void {
  activeDialogClose?.();
}

export function buildLandingPlayPanel(
  engines: PlayableEngine[],
  options: { locale?: Locale; showLobbyRequests?: boolean } = {},
): HTMLElement {
  const locale = options.locale ?? currentLocale();
  const panel = document.createElement('aside');
  panel.className = 'landing-play-panel';
  panel.setAttribute('aria-label', t('play.startPlaying', {}, locale));

  const availableEngines = engines.length > 0 ? engines : fallbackPlayableEngines();
  const defaultEngineId = availableEngines[0]?.id;

  // One unified entry point: a single primary button opens the setup dialog
  // with the opponent switcher inside (Computer / A friend / Anyone), replacing
  // the old three stacked per-mode CTAs. Computer is the opening mode because
  // it's the always-available action with no human-liquidity dependency.
  // Correspondence stays the long end of the time-control axis inside the
  // dialog, not a separate action.
  const playButton = landingPlayAction(t('play.playGame', {}, locale), 'play');
  playButton.classList.add('landing-play-action-primary');
  playButton.addEventListener('click', () => {
    openLandingSetupDialog({
      engineId: defaultEngineId,
      engines: availableEngines,
      locale,
      mode: 'pve',
      modeSwitcher: true,
    });
  });
  panel.append(playButton);

  if (options.showLobbyRequests) {
    panel.append(buildLobbyRequestsWindow(locale));
  }
  return panel;
}

type LandingPlayIcon = 'computer' | 'friend' | 'lobby' | 'play';
const LANDING_PLAY_ICON_ID: Record<LandingPlayIcon, UiIconName> = {
  computer: 'play-engine',
  friend: 'challenge-friend',
  lobby: 'find-opponent',
  play: 'play-game',
};

function landingPlayAction(label: string, icon: LandingPlayIcon): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-play-action landing-play-action-${icon} landing-play-action-dobutsu`;
  appendLandingActionContent(button, label, icon);
  return button;
}

function appendLandingActionContent(
  element: HTMLAnchorElement | HTMLButtonElement,
  label: string,
  icon: LandingPlayIcon,
): void {
  const iconEl = document.createElement('span');
  iconEl.className = 'landing-play-icon landing-play-icon-dobutsu';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.append(buildUiIcon(LANDING_PLAY_ICON_ID[icon]));
  const labelEl = document.createElement('span');
  labelEl.className = 'landing-play-action-label';
  labelEl.textContent = label;
  element.append(iconEl, labelEl);
}

export function buildLobbyRequestsWindow(
  locale: Locale = currentLocale(),
  options: { hydrate?: boolean } = {},
): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'landing-lobby-requests';
  shell.setAttribute('aria-label', t('play.openPairingRequests', {}, locale));

  const header = document.createElement('div');
  header.className = 'landing-lobby-requests-header';
  const title = document.createElement('strong');
  title.textContent = t('play.openRequests', {}, locale);
  const count = document.createElement('span');
  count.textContent = t('play.checking', {}, locale);
  header.append(title, count);

  const list = document.createElement('div');
  list.className = 'landing-lobby-requests-list';
  // Placeholder row with the empty-state's exact markup so the window reserves
  // its usual one-row footprint from first paint; render() replaces it, so the
  // common no-requests answer lands without any shift.
  const placeholder = document.createElement('p');
  placeholder.className = 'landing-lobby-requests-empty';
  placeholder.textContent = ' ';
  list.append(placeholder);

  shell.append(header, list);

  const render = (requests: OpenLobbyRequest[]) => {
    count.textContent = t('play.waitingCount', { count: requests.length }, locale);
    list.replaceChildren();
    if (requests.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'landing-lobby-requests-empty';
      empty.textContent = t('play.noOpenRequests', {}, locale);
      list.append(empty);
      return;
    }
    for (const request of requests) {
      list.append(lobbyRequestRow(request, locale));
    }
  };

  const refresh = async () => {
    try {
      const requests = await fetchOpenLobbyRequests();
      render(requests);
    } catch (err) {
      console.warn(err);
      count.textContent = t('play.unavailable', {}, locale);
      list.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'landing-lobby-requests-empty';
      empty.textContent = t('play.openRequestsLoadFailed', {}, locale);
      list.append(empty);
    }
  };

  // The prerendered shell renders the frame only (hydrate: false): fetching and
  // polling start when the client builds its live copy.
  if (options.hydrate !== false) {
    void refresh();
    const refreshTimer = window.setInterval(() => {
      if (!document.body.contains(shell)) {
        window.clearInterval(refreshTimer);
        return;
      }
      void refresh();
    }, 3_000);
  }

  return shell;
}

// Engine "seeds": rotating always-available bot seeks rendered as a compact
// lichess-lobby-style hook table at the top of the Lobby tab, so the seeks
// surface is never an empty table at zero human liquidity. These are NOT server
// seeks: the pool is derived client-side from one six-hour UTC bucket, so every
// visitor agrees on the lineup and an open page never changes rows underneath
// them. One click creates and joins the PvE room directly (no setup dialog);
// the server resolves the concrete engine from the bot identity.
type LandingEngineSeed = {
  botId: string;
  botName: string;
  gameSpecId: LandingGameSpecId;
  variantLabel: string;
  timeControlId: TimeControlId;
};

const LANDING_ENGINE_SEED_VARIANT_COUNT = 6;

// A seed only lists when its variant is currently offered: dark chess is always
// on; tenant variants follow the same offerInMenu gate as every play menu.
function landingSeedVariantOffered(gameSpecId: LandingGameSpecId): boolean {
  if (gameSpecId === DARK_CHESS_SPEC_ID) return true;
  return webVariantTenantForSpecId(gameSpecId)?.landing?.offerInMenu() === true;
}

function landingEngineSeeds(locale: Locale, rotationBucket: number): LandingEngineSeed[] {
  const desired = landingBotLineup(rotationBucket);
  const picked = desired.filter(landingSeedVariantOffered);
  // Kill-switched variants drop out without shrinking the table when another
  // supported live variant can backfill the slot.
  for (const gameSpecId of LANDING_BOT_GAME_SPEC_IDS) {
    if (picked.length >= LANDING_ENGINE_SEED_VARIANT_COUNT) break;
    if (!picked.includes(gameSpecId) && landingSeedVariantOffered(gameSpecId)) {
      picked.push(gameSpecId);
    }
  }
  return (
    picked
      .sort((a, b) => canonicalVariantOrderIndex(a) - canonicalVariantOrderIndex(b))
      .map((gameSpecId) => landingBotOffer(gameSpecId))
      .filter((offer): offer is NonNullable<typeof offer> => offer !== null)
      // Xiangqi expands into its whole ladder. The expansion runs after the
      // variant sort, so the ladder has to carry its own order (ascending by
      // level) rather than inherit one.
      .flatMap((offer) =>
        offer.gameSpecId === XIANGQI_SPEC_ID ? landingXiangqiBotOffers() : [offer],
      )
      .map((offer) => ({
        ...offer,
        variantLabel: variantLabelForGameSpec(offer.gameSpecId, locale),
      }))
  );
}

/** Opponent cell shared by every hook row: kind glyph, name, variant, and an
 *  explicit Bot/Human tag. Bots and humans sit in one list (humans first), so
 *  each row has to say what it is on its own rather than lean on a section
 *  heading above it. */
function lobbyPlayerCell(opts: {
  kind: 'bot' | 'human';
  name: string;
  variantLabel: string;
  locale: Locale;
}): HTMLElement {
  const player = document.createElement('span');
  player.className = 'landing-lobby-seed-player';

  const opponent = document.createElement('span');
  opponent.className = 'landing-lobby-seed-opponent';
  // The name rides its own span so a phone-width row can ellipsize it: a bare
  // text node inside this inline-flex box is an anonymous flex item, and
  // text-overflow does not reach one.
  const opponentName = document.createElement('span');
  opponentName.className = 'landing-lobby-seed-opponent-name';
  opponentName.textContent = opts.name;
  opponent.append(
    buildUiIcon(opts.kind === 'bot' ? 'play-engine' : 'player-human', 'landing-lobby-seed-boticon'),
    opponentName,
  );

  const variant = document.createElement('span');
  variant.className = 'landing-lobby-seed-variant';
  variant.textContent = opts.variantLabel;

  const tag = document.createElement('span');
  tag.className = `landing-lobby-kind landing-lobby-kind-${opts.kind}`;
  tag.textContent = t(opts.kind === 'bot' ? 'lobby.tagBot' : 'lobby.tagHuman', {}, opts.locale);

  player.append(opponent, variant, tag);
  return player;
}

function engineSeedRow(seed: LandingEngineSeed, locale: Locale): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'landing-lobby-seed';
  // The rating hydrate pass (and tests) address rows by bot + variant + pace.
  row.dataset.botId = seed.botId;
  row.dataset.gameSpec = seed.gameSpecId;
  const timeControl = TIME_CONTROLS.find((spec) => spec.id === seed.timeControlId);
  if (timeControl) row.dataset.timeClass = timeControl.timeClass;
  row.setAttribute(
    'aria-label',
    `${t('play.playEngine', {}, locale)}: ${seed.variantLabel}, ${seed.botName}`,
  );

  const thumb = document.createElement('span');
  thumb.className = 'landing-lobby-seed-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  const miniId = variantMiniIdForGameSpec(seed.gameSpecId);
  if (miniId) {
    thumb.innerHTML = renderVariantMarker(miniId, {
      size: 100,
      label: `${seed.variantLabel} marker`,
    });
  }

  const player = lobbyPlayerCell({
    kind: 'bot',
    name: seed.botName,
    variantLabel: seed.variantLabel,
    locale,
  });

  const rating = document.createElement('span');
  rating.className = 'landing-lobby-seed-rating';
  rating.textContent = '—';

  const time = document.createElement('span');
  time.className = 'landing-lobby-seed-time';
  time.textContent = timeControl ? timeControl.label.replace(/\s+/g, '') : '';

  // Mode cell (lichess's speed glyph + Casual/Rated). Bot games are always
  // casual, and this cell doubles as the row's status slot: the one-click start
  // swaps its contents for "Starting" / "Could not start".
  const mode = document.createElement('span');
  mode.className = 'landing-lobby-seed-cta landing-lobby-td-mode';
  const idleMode = (): Node[] => [
    ...(timeControl ? [buildSpeedIcon(timeControl.timeClass)] : []),
    document.createTextNode(t('play.casual', {}, locale)),
  ];
  mode.append(...idleMode());

  row.append(thumb, player, rating, time, mode);
  bindBotPlayControl(
    row,
    () => ({
      botId: seed.botId,
      gameSpecId: seed.gameSpecId,
      ...(timeControl
        ? {
            timeControl: { initialMs: timeControl.initialMs, incrementMs: timeControl.incrementMs },
          }
        : {}),
      preferredColor: 'random',
    }),
    {
      onStateChange: (state) => {
        if (state === 'pending') mode.textContent = t('lobby.botStarting', {}, locale);
        else if (state === 'error') mode.textContent = t('lobby.botStartFailed', {}, locale);
        else mode.replaceChildren(...idleMode());
      },
    },
  );
  return row;
}

// Minimal slice of GET /api/bots used to decorate seed rows with ratings.
type LandingBotRosterRating = {
  gameSpecId: string;
  timeClass: string;
  rating: number;
  provisional?: boolean;
};
type LandingBotRosterEntry = { id: string; ratings?: LandingBotRosterRating[] };

// Best rating for a seed: the seed's own variant + time class, else the
// variant's blitz rating, else any rating recorded for the variant.
function seedRosterRating(
  ratings: LandingBotRosterRating[],
  gameSpecId: string,
  timeClass: string | undefined,
): LandingBotRosterRating | undefined {
  const forSpec = ratings.filter((entry) => entry.gameSpecId === gameSpecId);
  return (
    forSpec.find((entry) => entry.timeClass === timeClass) ??
    forSpec.find((entry) => entry.timeClass === 'blitz') ??
    forSpec[0]
  );
}

function fillSeedRatings(seedsBlock: HTMLElement, bots: LandingBotRosterEntry[]): void {
  for (const row of seedsBlock.querySelectorAll<HTMLElement>('.landing-lobby-seed')) {
    const cell = row.querySelector<HTMLElement>('.landing-lobby-seed-rating');
    if (!cell) continue;
    const bot = bots.find((entry) => entry.id === row.dataset.botId);
    if (!bot?.ratings) continue;
    const rating = seedRosterRating(bot.ratings, row.dataset.gameSpec ?? '', row.dataset.timeClass);
    if (!rating) continue;
    // The number is an engine-pool rating (engines against engines, random play
    // anchored at 1500), not the human Glicko scale: Pikafish went 23-0 against
    // humans at a number that reads like a club player. Printed in the rating
    // column it invites lichess's own "2000 bot plays like 1250" complaint, so
    // the cell keeps its dash and the number lives in a tooltip that names the
    // scale it is on (#373). The data attribute keeps it addressable.
    const poolRating = `${Math.round(rating.rating)}${rating.provisional ? '?' : ''}`;
    const label = t('lobby.enginePoolRating', { rating: poolRating });
    cell.dataset.poolRating = poolRating;
    cell.title = label;
    row.title = label;
  }
}

// ── Quick pairing: promoted pools that START, not pickers that open a dialog ──
// One row per flagship variant, one chip per time control it offers. A chip
// click posts the open seek immediately (real pairing, waiting inline) and the
// trailing Computer chip creates the bot room outright. Nothing here opens the
// setup dialog: the whole point of the tab is to remove that step, so every
// choice the dialog would ask for is baked into the cell you clicked (casual,
// random color, standard start).
const QUICK_PAIR_COLUMN_IDS: TimeControlId[] = ['1m1', '3m2', '5m5'];
// How many variants get a promoted pool row. Order is the canonical product
// order (xiangqi first since the 2026-07 pivot), so this promotes the top of the
// catalog rather than a second hand-maintained ranking. Sized to the full
// product catalog (config/product-profile.json), so in prod every playable
// variant gets a pool row and the grid fills the card instead of trailing off
// into dead space; the cap only bites in the lab profile, where the parked
// variants would otherwise stretch the panel well past the tabs beside it.
const QUICK_PAIR_ROW_COUNT = 8;

// One pool = one variant at one clock, the granularity a chip pairs at. Shared
// by the chip index and the open-seek counter so the two can only agree.
function quickPairPoolKey(gameSpecId: string, initialMs: number, incrementMs: number): string {
  return `${gameSpecId}|${initialMs}|${incrementMs}`;
}

type QuickPairPools = {
  element: HTMLElement;
  /** Re-badge the chips from the open-seek poll the Lobby tab already runs. A
   *  pool somebody is already waiting in is the one click that pairs INSTANTLY,
   *  and at our liquidity that is the difference between playing now and
   *  queueing into an empty pool, so it belongs on the chip. */
  applyOpenSeeks: (requests: OpenLobbyRequest[]) => void;
};

function buildQuickPairPools(locale: Locale): QuickPairPools {
  const wrap = document.createElement('div');
  wrap.className = 'landing-quickpair-pools';

  const status = document.createElement('p');
  status.className = 'landing-quickpair-status';
  status.hidden = true;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'landing-quickpair-cancel';
  cancel.textContent = t('setup.cancel', {}, locale);
  cancel.hidden = true;

  // Only one seek at a time: starting a second pool cancels the first (and
  // deletes its ticket) rather than queueing the player into two pools.
  let cancelPending: (() => void) | null = null;
  const chipResets: (() => void)[] = [];
  // Pool key → the chips that pair into it, so the open-seek poll can badge them
  // without re-rendering the grid out from under a click.
  const chipsByPool = new Map<
    string,
    { chip: HTMLButtonElement; badge: HTMLElement; label: string }[]
  >();
  const clearPending = (): void => {
    cancelPending?.();
    cancelPending = null;
    for (const reset of chipResets) reset();
    status.hidden = true;
    status.textContent = '';
    cancel.hidden = true;
  };
  cancel.addEventListener('click', clearPending);

  const head = document.createElement('div');
  head.className = 'landing-quickpair-row landing-quickpair-head';
  const columns = QUICK_PAIR_COLUMN_IDS.map((id) =>
    TIME_CONTROLS.find((spec) => spec.id === id),
  ).filter((spec): spec is (typeof TIME_CONTROLS)[number] => Boolean(spec));
  head.append(headCell(''), headCell(''));
  for (const column of columns) head.append(headCell(column.label.replace(/\s+/g, '')));
  head.append(headCell(t('play.opponentEngine', {}, locale)));
  wrap.append(head);

  for (const { gameSpecId, label } of enabledLandingVariantGameSpecs('pvp', locale).slice(
    0,
    QUICK_PAIR_ROW_COUNT,
  )) {
    const row = document.createElement('div');
    row.className = 'landing-quickpair-row';
    row.dataset.gameSpec = gameSpecId;

    const thumb = document.createElement('span');
    thumb.className = 'landing-lobby-seed-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    const miniId = variantMiniIdForGameSpec(gameSpecId);
    if (miniId) {
      thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${label} marker` });
    }
    const name = document.createElement('span');
    name.className = 'landing-quickpair-variant';
    name.textContent = label;
    row.append(thumb, name);

    // The pool chips on this row pair humans; the Computer chip below is PvE and
    // takes its own (possibly narrower) set.
    const allowed = allowedTimePresetIds(gameSpecId, false, 'pvp');
    for (const column of columns) {
      if (!allowed.has(column.id)) {
        const gap = document.createElement('span');
        gap.className = 'landing-quickpair-gap';
        row.append(gap);
        continue;
      }
      const chipLabel = column.label.replace(/\s+/g, '');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'landing-quickpair-chip';
      chip.dataset.timeControl = column.id;
      chip.setAttribute('aria-label', `${label} ${chipLabel}`);
      // The chip keeps showing its time control while waiting (the status line
      // below and the highlighted chip carry the state). joinLobbyFromPlay
      // writes its "Waiting" / "Try again" text into the first
      // `.landing-play-action-label` it finds, so that node is a visually
      // hidden live label rather than the chip's own text — otherwise the chip
      // would resize and wrap mid-pool.
      const chipText = document.createElement('span');
      chipText.className = 'landing-quickpair-chip-text';
      chipText.textContent = chipLabel;
      const chipState = document.createElement('span');
      chipState.className = 'landing-play-action-label landing-quickpair-chip-state';
      chipState.textContent = chipLabel;
      // Liquidity badge: how many people are already waiting in THIS pool. It
      // sits absolutely on the chip's corner so a pool filling up never reflows
      // the grid, and stays empty (not "0") when the pool is cold.
      const badge = document.createElement('span');
      badge.className = 'landing-quickpair-waiting';
      badge.setAttribute('aria-hidden', 'true');
      badge.hidden = true;
      chip.append(chipText, chipState, badge);
      const poolChips = chipsByPool.get(
        quickPairPoolKey(gameSpecId, column.initialMs, column.incrementMs),
      );
      const chipEntry = { chip, badge, label: `${label} ${chipLabel}` };
      if (poolChips) poolChips.push(chipEntry);
      else
        chipsByPool.set(quickPairPoolKey(gameSpecId, column.initialMs, column.incrementMs), [
          chipEntry,
        ]);
      chipResets.push(() => {
        chip.disabled = false;
        chip.removeAttribute('aria-busy');
        chip.classList.remove('is-waiting');
        chipState.textContent = chipLabel;
      });
      chip.addEventListener('click', () => {
        clearPending();
        chip.classList.add('is-waiting');
        status.hidden = false;
        cancel.hidden = false;
        // Quick pairing posts casual seeks: rated pairing still lives in the
        // setup dialog, where the rated gate and its sign-in check are wired.
        cancelPending = joinLobbyFromPlay(
          chip,
          {
            gameSpecId,
            startFormat: 'standard',
            rated: false,
            timeControl: { initialMs: column.initialMs, incrementMs: column.incrementMs },
            preferredColor: 'random',
          },
          status,
          locale,
        );
      });
      row.append(chip);
    }

    const botOffer = landingVariantSupportsPve(gameSpecId)
      ? landingBotOffer(gameSpecId, {
          rememberedXiangqiBotId: rememberedPveEngine(XIANGQI_SPEC_ID),
        })
      : null;
    if (botOffer) {
      // The shared bot policy names the pace; retain the first-offered fallback
      // so a future variant with narrower clocks cannot render a dead control.
      // Resolved against the PvE set, not the human-pool one above, so a pinned
      // engine pace (pveTimePresetPin) cannot be widened back here.
      //
      // Looked up in LANDING_TIME_PRESETS, NOT in `columns`: the bot chip is
      // appended after the grid rather than being one of its cells, so it is
      // not confined to the pooled column paces. Searching `columns` silently
      // dropped any offer priced outside QUICK_PAIR_COLUMN_IDS onto the
      // fallback — which is the FIRST preset, ie. the fastest — so a variant
      // defaulting to 10+5 advertised 10+5 and started the game at 1+1.
      const botAllowed = allowedTimePresetIds(gameSpecId, false, 'pve');
      const botControl =
        LANDING_TIME_PRESETS.find(
          (preset) => preset.id === botOffer.timeControlId && botAllowed.has(preset.id),
        ) ?? LANDING_TIME_PRESETS.find((preset) => botAllowed.has(preset.id));
      const botChip = document.createElement('button');
      botChip.type = 'button';
      botChip.className = 'landing-quickpair-chip landing-quickpair-bot';
      botChip.dataset.botId = botOffer.botId;
      botChip.setAttribute('aria-label', `${t('play.playEngine', {}, locale)}: ${label}`);
      botChip.append(
        buildUiIcon('play-engine', 'landing-lobby-seed-boticon'),
        document.createTextNode(botControl ? botControl.label.replace(/\s+/g, '') : ''),
      );
      bindBotPlayControl(
        botChip,
        () => ({
          botId: botOffer.botId,
          gameSpecId,
          ...(botControl
            ? {
                timeControl: {
                  initialMs: botControl.initialMs,
                  incrementMs: botControl.incrementMs,
                },
              }
            : {}),
          preferredColor: 'random',
        }),
        {
          pendingLabel: t('lobby.botStarting', {}, locale),
          errorLabel: t('lobby.botStartFailed', {}, locale),
        },
      );
      row.append(botChip);
    } else {
      const gap = document.createElement('span');
      gap.className = 'landing-quickpair-gap';
      row.append(gap);
    }

    wrap.append(row);
  }

  const statusRow = document.createElement('div');
  statusRow.className = 'landing-quickpair-statusrow';
  statusRow.append(status, cancel);
  wrap.append(statusRow);

  const applyOpenSeeks = (requests: OpenLobbyRequest[]): void => {
    const counts = new Map<string, number>();
    for (const request of requests) {
      // These chips post casual, standard-start seeks, so a rated hook or a
      // draft960 one is a DIFFERENT pool even at the same variant and clock:
      // counting it here would promise an instant pair that never comes.
      if (request.rated || request.hiddenDraft960) continue;
      const key = quickPairPoolKey(
        request.gameSpecId ?? DARK_CHESS_SPEC_ID,
        request.timeControl.initialMs,
        request.timeControl.incrementMs,
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, chips] of chipsByPool) {
      const count = counts.get(key) ?? 0;
      for (const { chip, badge, label } of chips) {
        // The pool you are personally sitting in counts YOUR ticket, and the
        // chip already says so in accent. Badging it "1" would read as somebody
        // to pair with; anyone actually there would have matched you instantly.
        const own = chip.classList.contains('is-waiting');
        chip.classList.toggle('has-waiting', count > 0 && !own);
        badge.hidden = count === 0 || own;
        badge.textContent = count > 0 && !own ? String(count) : '';
        chip.setAttribute(
          'aria-label',
          count > 0 && !own ? `${label}, ${t('play.waitingCount', { count }, locale)}` : label,
        );
      }
    }
  };

  return { element: wrap, applyOpenSeeks };
}

function headCell(label: string): HTMLElement {
  const cell = document.createElement('span');
  cell.textContent = label;
  return cell;
}

// The homepage lobby board (lichess / PlayStrategy-shaped): three tabs over a
// framed panel — Lobby (a standing engine-seed list plus open real-time human
// seeks as a Game/Time/Mode table), Quick pairing (the time-control pool grid),
// and Correspondence (open days-per-move seeks). The "start a game" CTAs stay in
// the right column; this is the browse-and-join surface. Reuses the existing
// lobby fetch/join, setup dialog, and presets.
export function buildLobbyPanel(
  locale: Locale = currentLocale(),
  options: { hydrate?: boolean } = {},
): HTMLElement {
  // Capture once per mount: crossing a six-hour boundary never swaps a row
  // underneath someone already browsing the panel.
  const rotationBucket = landingBotRotationBucket();
  const board = document.createElement('section');
  board.className = 'landing-lobby-board';
  board.setAttribute('aria-label', t('play.openPairingRequests', {}, locale));

  // Lobby leads: the standing engine seeds keep it populated at zero human
  // liquidity, and live player seeks surface there the moment they exist. Quick
  // pairing (the variant quick-play grid) and Correspondence follow.
  const tabDefs: { id: string; label: string }[] = [
    { id: 'lobby', label: t('lobby.tabLobby', {}, locale) },
    { id: 'quick', label: t('lobby.tabQuick', {}, locale) },
    { id: 'correspondence', label: t('lobby.tabCorrespondence', {}, locale) },
  ];
  const tabBar = document.createElement('div');
  tabBar.className = 'landing-lobby-tabs';
  tabBar.setAttribute('role', 'tablist');
  const tabButtons = new Map<string, HTMLButtonElement>();
  const panels = new Map<string, HTMLElement>();

  const selectTab = (id: string): void => {
    for (const def of tabDefs) {
      const active = def.id === id;
      tabButtons.get(def.id)?.classList.toggle('is-active', active);
      tabButtons.get(def.id)?.setAttribute('aria-selected', active ? 'true' : 'false');
      const panel = panels.get(def.id);
      if (panel) panel.hidden = !active;
    }
  };
  for (const def of tabDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'landing-lobby-tab';
    button.setAttribute('role', 'tab');
    button.textContent = def.label;
    button.addEventListener('click', () => selectTab(def.id));
    tabButtons.set(def.id, button);
    tabBar.append(button);
  }

  // Lobby tab: one lichess-shaped hook table. A single header sits at the top of
  // the panel and every row below it (bots and humans alike) shares the same
  // five-column grammar — marker / opponent / rating / time / mode — so the
  // columns line up straight down the panel. Bots and humans share ONE list with
  // human seeks on top; each row carries its own Bot/Human tag instead of
  // sitting under a section heading. The first two header cells stay blank
  // (lichess labels only the right-hand columns).
  const lobbyPanelEl = document.createElement('div');
  lobbyPanelEl.className = 'landing-lobby-tabpanel landing-lobby-flush';
  lobbyPanelEl.setAttribute('role', 'tabpanel');
  const lobbyHead = document.createElement('div');
  lobbyHead.className = 'landing-lobby-thead';
  for (const label of [
    '',
    '',
    t('lobby.colRating', {}, locale),
    t('lobby.colTime', {}, locale),
    t('lobby.colMode', {}, locale),
  ]) {
    const cell = document.createElement('span');
    cell.textContent = label;
    lobbyHead.append(cell);
  }
  // Human seeks lead the list; the bot block below them keeps the surface
  // populated at zero human liquidity. Two containers, one visual list: the
  // human half re-renders on every poll while the bot half is built once (and
  // decorated with ratings later), so they stay separate elements.
  const lobbyRows = document.createElement('div');
  lobbyRows.className = 'landing-lobby-tbody';

  const seeds = landingEngineSeeds(locale, rotationBucket);
  const seedsBlock = document.createElement('div');
  seedsBlock.className = 'landing-lobby-seeds';
  for (const seed of seeds) seedsBlock.append(engineSeedRow(seed, locale));

  lobbyPanelEl.append(lobbyHead, lobbyRows, seedsBlock);
  // No human seeks simply means no human rows: the bot rows below carry the
  // list, so an empty-state line would only add noise above them.
  const renderLobby = (requests: OpenLobbyRequest[]): void => {
    lobbyRows.replaceChildren(...requests.map((request) => lobbyTableRow(request, locale)));
    // One poll feeds both tabs: the same open seeks that fill this table are
    // what make a Quick pairing chip an instant match rather than a queue.
    quickPairPools.applyOpenSeeks(requests);
  };

  // Quick pairing tab: the variant catalog, filling the panel edge to edge (no
  // inset card inside the card). A variant opens the vetted setup dialog, which
  // owns the opponent choice via its own Computer / A friend / Anyone switcher,
  // plus time control, engine resolution, and color. The tab used to carry its
  // own Computer/Friend toggle at the bottom; that duplicated the dialog's
  // switcher, so the card just opens the dialog on the mode the variant can
  // actually serve (engine when it has one, otherwise a friend challenge).
  const quickPanelEl = document.createElement('div');
  quickPanelEl.className = 'landing-lobby-tabpanel landing-lobby-flush landing-lobby-quickpair';
  quickPanelEl.setAttribute('role', 'tabpanel');
  quickPanelEl.hidden = true;

  const quickPairPools = buildQuickPairPools(locale);
  quickPanelEl.append(quickPairPools.element);

  // Correspondence tab: open days-per-move seeks (they carry a creator name). A row
  // links to the challenge/accept page.
  const corrPanelEl = document.createElement('div');
  corrPanelEl.className = 'landing-lobby-tabpanel landing-lobby-flush';
  corrPanelEl.setAttribute('role', 'tabpanel');
  corrPanelEl.hidden = true;
  // Seek rows carry their own four-column grammar, so they get their own header
  // rather than borrowing the real-time table's five. It stays hidden until
  // there are rows to label: a header over a centered empty state reads as a
  // broken table.
  const corrHead = document.createElement('div');
  corrHead.className = 'landing-lobby-thead landing-lobby-thead-corr';
  corrHead.hidden = true;
  for (const label of [
    t('lobby.colPlayer', {}, locale),
    t('lobby.colGame', {}, locale),
    t('lobby.colPace', {}, locale),
    '',
  ]) {
    const cell = document.createElement('span');
    cell.textContent = label;
    corrHead.append(cell);
  }
  const corrRows = document.createElement('div');
  corrRows.className = 'landing-lobby-tbody landing-lobby-tbody-corr';
  // Seed the empty state with a centered "Create a game" CTA (lichess-style)
  // from first paint, so a loading/empty list is a call to action rather than a
  // blank panel. It survives the fetch when no seeks come back; only a non-empty
  // list replaces it with rows, and only the server saying the feature is off
  // replaces it with the coming-soon line.
  corrRows.append(correspondenceEmptyState(locale));
  corrPanelEl.append(corrHead, corrRows);
  const renderCorrespondence = (feed: LobbyCorrespondenceFeed): void => {
    corrRows.replaceChildren();
    if (feed.status === 'disabled') {
      // Server truth beats the build flag: the web bundle ships correspondence
      // on, so a deploy that lands before MISTBOARD_CORRESPONDENCE_ENABLED does
      // shows the coming-soon line instead of a CTA that 404s.
      corrHead.hidden = true;
      const soon = document.createElement('p');
      soon.className = 'landing-lobby-empty';
      soon.textContent = t('lobby.corrComingSoon', {}, locale);
      corrRows.append(soon);
      return;
    }
    if (feed.seeks.length === 0) {
      corrHead.hidden = true;
      corrRows.append(correspondenceEmptyState(locale));
      return;
    }
    corrHead.hidden = false;
    for (const seek of feed.seeks) corrRows.append(corrSeekRow(seek, locale));
    corrRows.append(correspondenceListFooter(locale));
  };

  panels.set('lobby', lobbyPanelEl);
  panels.set('quick', quickPanelEl);
  panels.set('correspondence', corrPanelEl);
  // The tab strip sits ABOVE the framed card (lichess anatomy), so the card
  // holds only the active panel and the tabs read as page chrome.
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'landing-lobby-body';
  bodyWrap.append(lobbyPanelEl, quickPanelEl, corrPanelEl);
  const card = document.createElement('div');
  card.className = 'landing-lobby-card';
  card.append(bodyWrap);
  board.append(tabBar, card);
  selectTab('lobby');

  if (options.hydrate !== false) {
    const refreshLobby = async (): Promise<void> => {
      try {
        renderLobby(await fetchOpenLobbyRequests());
      } catch (err) {
        console.warn(err);
      }
    };
    void refreshLobby();
    // One-shot, purely decorative: fill the seed rows' rating cells from the
    // public bot roster. Failures leave the placeholder in place.
    void fetch('/api/bots', { headers: { accept: 'application/json' } })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ bots?: LandingBotRosterEntry[] }>) : null,
      )
      .then((data) => {
        if (data?.bots) fillSeedRatings(seedsBlock, data.bots);
      })
      .catch(() => {
        /* keep the placeholder */
      });
    const refreshCorrespondence = (): void => {
      if (!correspondenceEnabled()) return;
      void fetchCorrespondenceSeeks()
        .then(renderCorrespondence)
        .catch(() => {
          /* keep whatever is on screen */
        });
    };
    refreshCorrespondence();
    // One timer for both tabs. The correspondence board moves on a days scale,
    // so it rides every tenth tick of the real-time poll (~30s) instead of
    // taking an interval of its own: a second timer is a second thing to leak.
    let tick = 0;
    const timer = window.setInterval(() => {
      if (!document.body.contains(board)) {
        window.clearInterval(timer);
        return;
      }
      void refreshLobby();
      tick += 1;
      if (tick % 10 === 0) refreshCorrespondence();
    }, 3_000);
  }

  return board;
}

// Monochrome speed glyphs for the hooks table, tinted muted grey via CSS (they
// distinguish bullet/blitz/rapid at a glance without pulling color into the
// restrained palette). Official lobby pools only ever produce the first three;
// `classical` covers the classifier's unofficial-TC fallback and reuses the
// stopwatch so no time class ever renders iconless.
const SPEED_ICON_SVG: Record<'bullet' | 'blitz' | 'rapid' | 'classical', string> = {
  bullet: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.4"/></svg>',
  blitz:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.2 1.4 3.7 8.8h3.4l-1 5.8 5.5-7.7H8.2z"/></svg>',
  rapid:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9.2" r="4.8"/><path d="M8 9.2V6.4"/><path d="M6.6 2h2.8"/><path d="M8 2v2.3"/></svg>',
  classical:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9.2" r="4.8"/><path d="M8 9.2V6.4"/><path d="M6.6 2h2.8"/><path d="M8 2v2.3"/></svg>',
};

function buildSpeedIcon(timeClass: 'bullet' | 'blitz' | 'rapid' | 'classical'): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `landing-speed-icon landing-speed-${timeClass}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = SPEED_ICON_SVG[timeClass];
  return icon;
}

/** The correspondence-eligible variant to open the tab's own CTA on: the first
 *  member of the shared allowlist that is actually offered in the play menu,
 *  in canonical (product) order. Without this the dialog opened on whatever
 *  variant was last played and showed real-time clocks only. */
function defaultCorrespondenceGameSpecId(locale: Locale): LandingGameSpecId {
  const offered = new Set(
    enabledLandingVariantGameSpecs('lobby', locale).map((option) => option.gameSpecId),
  );
  const eligible = (CORRESPONDENCE_ELIGIBLE_SPEC_IDS as readonly string[])
    .filter((id): id is LandingGameSpecId => offered.has(id as LandingGameSpecId))
    .sort((a, b) => canonicalVariantOrderIndex(a) - canonicalVariantOrderIndex(b));
  return eligible[0] ?? DARK_CHESS_SPEC_ID;
}

// Centered empty state for the correspondence tab: the "no open games" line plus
// a primary CTA that opens the Find-opponent setup dialog ON THE CORRESPONDENCE
// segment (posting an open seek there is what populates this very tab). It used
// to open the plain real-time dialog, so the tab offered 1+1 / 3+2 / 5+5 clocks
// and no days-per-move option at all.
function correspondenceEmptyState(locale: Locale): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'landing-lobby-empty-cta';
  const message = document.createElement('p');
  message.className = 'landing-lobby-empty';
  message.textContent = t('lobby.corrEmpty', {}, locale);
  // An empty board has to say what the format IS, not just that nobody is on
  // it: correspondence is the one surface that works at zero concurrency, and a
  // first-time visitor has no reason to guess that from a bare "no games" line.
  const explainer = document.createElement('p');
  explainer.className = 'landing-lobby-empty landing-lobby-empty-explainer';
  explainer.textContent = t('lobby.corrExplainer', {}, locale);
  const create = correspondenceCreateButton(locale);
  // The full board (your games in progress, the post form, private share links)
  // lives on /correspondence; this tab is the shop window onto it, so it links
  // there instead of growing a second copy of that page.
  const mine = document.createElement('a');
  mine.className = 'landing-lobby-empty-link';
  mine.href = '/correspondence';
  mine.textContent = t('lobby.corrYourGames', {}, locale);
  wrap.append(message, explainer, create, mine);
  return wrap;
}

// The one control that posts an open days-per-move seek: opens the Find-opponent
// dialog on its correspondence segment. Shared by the empty state and the footer
// under a populated list, so posting a game never depends on the board being
// empty (before, a single existing seek hid the only way to add your own).
function correspondenceCreateButton(locale: Locale): HTMLButtonElement {
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'landing-lobby-create';
  create.textContent = t('lobby.corrCreate', {}, locale);
  create.addEventListener('click', () => {
    openLandingSetupDialog({
      locale,
      mode: 'lobby',
      initialGameSpecId: defaultCorrespondenceGameSpecId(locale),
      initialTimeMode: 'correspondence',
      // Correspondence is casual-only, so the rated toggle never applies here.
      ratedDisabled: true,
    });
  });
  return create;
}

// Footer under a populated seek list: the same "Create a game" control the empty
// state leads with, demoted to a row under the rows.
function correspondenceListFooter(locale: Locale): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'landing-lobby-corr-footer';
  const mine = document.createElement('a');
  mine.className = 'landing-lobby-empty-link';
  mine.href = '/correspondence';
  mine.textContent = t('lobby.corrYourGames', {}, locale);
  footer.append(correspondenceCreateButton(locale), mine);
  return footer;
}

function lobbyTableRow(request: OpenLobbyRequest, locale: Locale): HTMLElement {
  // The whole row is the join control (lichess hooks have no per-row button):
  // clicking anywhere on it enters the pairing pool. The mode cell carries a
  // `landing-play-action-label` span so setButtonLabel writes the waiting /
  // retry text into that one cell instead of wiping the row's columns.
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'landing-lobby-trow';
  const specId = parseLandingGameSpecId(request.gameSpecId ?? DARK_CHESS_SPEC_ID);
  const gameLabel =
    specId === DARK_CHESS_SPEC_ID
      ? request.hiddenDraft960
        ? t('setup.darkDraft960', {}, locale)
        : t('play.standard', {}, locale)
      : variantLabelForGameSpec(specId, locale);
  const thumb = document.createElement('span');
  thumb.className = 'landing-lobby-seed-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  const miniId = variantMiniIdForGameSpec(specId);
  if (miniId) {
    thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${gameLabel} marker` });
  }
  // Open seeks are anonymous on the wire, so the opponent reads "Anonymous" with
  // the same cell grammar (and an explicit Human tag) the bot rows use.
  const game = lobbyPlayerCell({
    kind: 'human',
    name: t('lobby.anonymous', {}, locale),
    variantLabel: gameLabel,
    locale,
  });
  // Open seeks are anonymous on the wire (no creator, no rating), so the rating
  // column holds the same em dash the unrated bot rows use.
  const rating = document.createElement('span');
  rating.className = 'landing-lobby-td landing-lobby-seed-rating';
  rating.textContent = '—';
  const time = document.createElement('span');
  time.className = 'landing-lobby-td landing-lobby-seed-time';
  const timeClass = classifyTimeControl(
    request.timeControl.initialMs,
    request.timeControl.incrementMs,
  );
  // Same tight "3+2" shape the bot rows use, so the column reads as one list.
  time.textContent = formatTimeControl(request.timeControl).replace(/\s+/g, '');
  const mode = document.createElement('span');
  mode.className = 'landing-lobby-td landing-lobby-td-mode';
  const modeLabel = document.createElement('span');
  modeLabel.className = 'landing-play-action-label';
  modeLabel.textContent =
    request.rated === false ? t('play.casual', {}, locale) : t('play.rated', {}, locale);
  mode.append(buildSpeedIcon(timeClass), modeLabel);
  row.setAttribute(
    'aria-label',
    `${t('play.join', {}, locale)}: ${gameLabel} ${formatTimeControl(request.timeControl)}`,
  );
  const join = row;
  join.addEventListener('click', () => {
    join.disabled = true;
    modeLabel.textContent = t('play.joining', {}, locale);
    const status = document.createElement('span');
    const setup: LandingRoomSetup = {
      gameSpecId: specId,
      startFormat: request.hiddenDraft960 ? 'draft960' : 'standard',
      rated: request.rated ?? true,
      timeControl: request.timeControl,
      preferredColor: 'random',
    };
    // Same detached-status shape as lobbyRequestRow: a non-instant match means
    // the seek was taken in the refresh window, so fail fast instead of
    // queueing invisibly.
    joinLobbyFromPlay(join, setup, status, locale, undefined, {
      onNoInstantMatch: () => {
        modeLabel.textContent = t('play.offerTaken', {}, locale);
        window.setTimeout(() => {
          join.disabled = false;
          modeLabel.textContent =
            request.rated === false ? t('play.casual', {}, locale) : t('play.rated', {}, locale);
        }, 2000);
      },
    });
  });
  row.append(thumb, game, rating, time, mode);
  return row;
}

type LobbyCorrespondenceSeek = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
  isMine: boolean;
};

// What the tab knows after one poll. `disabled` is the server's own answer
// (404 correspondence_disabled), kept distinct from "no seeks" and from a
// transient network failure so only the first one hides the CTA.
type LobbyCorrespondenceFeed =
  | { status: 'ok'; seeks: LobbyCorrespondenceSeek[] }
  | { status: 'disabled' };

async function fetchCorrespondenceSeeks(): Promise<LobbyCorrespondenceFeed> {
  const response = await fetch('/api/correspondence/seeks').catch(() => null);
  if (!response) return { status: 'ok', seeks: [] };
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'correspondence_disabled') return { status: 'disabled' };
    return { status: 'ok', seeks: [] };
  }
  if (!response.ok) return { status: 'ok', seeks: [] };
  const data = (await response.json()) as { seeks?: LobbyCorrespondenceSeek[] };
  return { status: 'ok', seeks: Array.isArray(data.seeks) ? data.seeks : [] };
}

function corrSeekRow(seek: LobbyCorrespondenceSeek, locale: Locale): HTMLElement {
  // Correspondence seeks carry a creator name and no rating, so they keep their
  // own four-column grammar (player / game / pace / action) rather than the
  // real-time table's five.
  const row = document.createElement('div');
  row.className = 'landing-lobby-trow landing-lobby-trow-corr';
  const who = document.createElement('span');
  who.className = 'landing-lobby-td landing-lobby-td-game';
  who.textContent = seek.creatorName ?? t('lobby.anonymous', {}, locale);
  const game = document.createElement('span');
  game.className = 'landing-lobby-td';
  game.textContent = variantLabelForGameSpec(parseLandingGameSpecId(seek.gameSpecId), locale);
  const time = document.createElement('span');
  time.className = 'landing-lobby-td';
  time.textContent = t('lobby.daysPerMove', { days: seek.daysPerMove }, locale);
  if (seek.isMine) {
    const mine = document.createElement('span');
    mine.className = 'landing-lobby-join is-mine';
    mine.textContent = t('lobby.yours', {}, locale);
    row.append(who, game, time, mine);
  } else {
    const join = document.createElement('a');
    join.className = 'landing-lobby-join';
    join.href = `/challenge/${encodeURIComponent(seek.id)}`;
    join.textContent = t('play.join', {}, locale);
    row.append(who, game, time, join);
  }
  return row;
}

function lobbyRequestRow(request: OpenLobbyRequest, locale: Locale = currentLocale()): HTMLElement {
  const row = document.createElement('div');
  row.className = 'landing-lobby-request-row';

  const details = document.createElement('div');
  details.className = 'landing-lobby-request-details';

  const requestSpecId = parseLandingGameSpecId(request.gameSpecId ?? DARK_CHESS_SPEC_ID);
  const primary = document.createElement('span');
  const ratedLabel =
    request.rated === false ? t('play.casual', {}, locale) : t('play.rated', {}, locale);
  // Chess shows its start format; other variants show the game name (a DMX open
  // request isn't "Standard/Draft960").
  const formatLabel =
    requestSpecId === DARK_CHESS_SPEC_ID
      ? request.hiddenDraft960
        ? t('setup.darkDraft960', {}, locale)
        : t('play.standard', {}, locale)
      : variantLabelForGameSpec(requestSpecId, locale);
  // Time control + game on the bold line; the casual/rated tag drops to the
  // meta line with the wait age so a long variant name (Dark Mini Xiangqi)
  // doesn't orphan "· Casual" onto its own wrapped line.
  primary.textContent = `${formatTimeControl(request.timeControl)} ${formatLabel}`;
  const secondary = document.createElement('small');
  secondary.textContent = `${ratedLabel} · ${t('play.waitingAge', { age: formatWaitAge(request.waitingMs) }, locale)}`;
  details.append(primary, secondary);

  const join = document.createElement('button');
  join.type = 'button';
  join.textContent = t('play.join', {}, locale);
  join.addEventListener('click', () => {
    join.disabled = true;
    join.textContent = t('play.joining', {}, locale);
    const status = document.createElement('span');
    const setup: LandingRoomSetup = {
      gameSpecId: requestSpecId,
      startFormat: request.hiddenDraft960 ? 'draft960' : 'standard',
      rated: request.rated ?? true,
      timeControl: request.timeControl,
      preferredColor: 'random',
    };
    // Joining an open request matches instantly, so no engine offer is involved
    // (unchanged from chess) — the offer only arms while waiting. The row has
    // no waiting UI (`status` is never attached), so a non-instant match means
    // the offer was already taken: fail fast rather than queue invisibly.
    joinLobbyFromPlay(join, setup, status, locale, undefined, {
      onNoInstantMatch: () => {
        join.textContent = t('play.offerTaken', {}, locale);
        window.setTimeout(() => {
          join.disabled = false;
          join.textContent = t('play.join', {}, locale);
        }, 2000);
      },
    });
  });

  row.append(details, join);
  return row;
}

async function fetchOpenLobbyRequests(): Promise<OpenLobbyRequest[]> {
  const response = await fetch('/api/lobby');
  if (!response.ok) throw new Error(`lobby requests failed: ${response.status}`);
  const data = (await response.json()) as { requests?: OpenLobbyRequest[] };
  return Array.isArray(data.requests) ? data.requests : [];
}

function formatTimeControl(timeControl: OpenLobbyRequest['timeControl']): string {
  const minutes = timeControl.initialMs / 60_000;
  const increment = timeControl.incrementMs / 1000;
  const minuteLabel = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${minuteLabel} + ${increment}`;
}

function formatWaitAge(waitingMs: number): string {
  const seconds = Math.max(0, Math.floor(waitingMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

// Deep link: `/?play=lobby` (also `friend` / `computer`) auto-opens the
// matching play-setup modal on landing load, so article CTAs can drop a
// visitor straight into "Find opponent". Consumed params are cleared from the
// URL so a refresh doesn't reopen the modal or trigger the dev live shortcut.
export function maybeOpenPlayDeepLink(engines: PlayableEngine[]): void {
  const locale = currentLocale();
  const params = new URLSearchParams(window.location.search);
  const play = params.get('play');
  if (!play) return;

  const availableEngines = engines.length > 0 ? engines : fallbackPlayableEngines();
  const defaultEngineId = availableEngines[0]?.id;

  switch (play) {
    case 'lobby':
      openLandingSetupDialog({
        engineId: defaultEngineId,
        engines: availableEngines,
        initialGameSpecId: deepLinkInitialVariant(
          params.get('gameSpecId') ?? params.get('variant'),
          'lobby',
        ),
        locale,
        mode: 'lobby',
        modeSwitcher: true,
        ratedDisabled: !isRatedModeEnabled() || !isLikelySignedIn(),
      });
      break;
    case 'friend':
      openLandingSetupDialog({
        engineId: defaultEngineId,
        engines: availableEngines,
        initialGameSpecId: deepLinkInitialVariant(
          params.get('gameSpecId') ?? params.get('variant'),
          'pvp',
        ),
        locale,
        mode: 'pvp',
        modeSwitcher: true,
        ratedDisabled: true,
      });
      break;
    case 'engine':
    case 'computer':
      openLandingSetupDialog({
        engineId: defaultEngineId,
        engines: availableEngines,
        initialGameSpecId: deepLinkInitialVariant(
          params.get('gameSpecId') ?? params.get('variant'),
          'pve',
        ),
        locale,
        mode: 'pve',
        modeSwitcher: true,
      });
      break;
    default:
      return;
  }

  params.delete('play');
  params.delete('gameSpecId');
  params.delete('variant');
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

// Whether a variant has a computer opponent in the play menu. PvP-first
// variants with no bot yet return false, so the engine flow greys them out
// instead of offering a dead "Play the engine" that silently falls back to a
// PvP room. The rule itself lives in variant-public-surfaces so that the rules
// pages, which link straight into this dialog, cannot answer it differently.
const landingVariantSupportsPve = (gameSpecId: LandingGameSpecId): boolean =>
  variantSupportsPve(gameSpecId);

/** Which variant a first-time player lands on. Xiangqi is the flagship (the
 *  same one bare `/analysis` opens), so the dialog opens there rather than on
 *  the fog variant it used to default to. Dark chess stays the last resort
 *  because it is the one variant that is always offered. */
function defaultLandingGameSpecId(
  variantOptions: readonly { gameSpecId: LandingGameSpecId }[],
  mode: LandingPlayMode,
): LandingGameSpecId {
  const offered = (id: LandingGameSpecId) =>
    variantOptions.some((option) => option.gameSpecId === id) &&
    (mode !== 'pve' || landingVariantSupportsPve(id));
  if (offered(XIANGQI_SPEC_ID)) return XIANGQI_SPEC_ID;
  if (offered(DARK_CHESS_SPEC_ID)) return DARK_CHESS_SPEC_ID;
  const first = variantOptions.find((option) => offered(option.gameSpecId));
  return first?.gameSpecId ?? DARK_CHESS_SPEC_ID;
}

function openLandingSetupDialog(choice: LandingPlayChoice): void {
  const locale = choice.locale ?? currentLocale();
  const existing = document.querySelector('.landing-setup-overlay');
  existing?.remove();

  const storedPreference = loadSetupPreference(choice.mode);
  const wantsCorrespondence = choice.initialTimeMode === 'correspondence';
  let startFormat: LandingStartFormat = storedPreference.startFormat ?? 'standard';
  // Correspondence is casual-only, so opening on that segment implies casual.
  let rated =
    choice.mode === 'pve' || choice.ratedDisabled || wantsCorrespondence
      ? false
      : (storedPreference.rated ?? true);
  const publicVariantOptions = enabledLandingVariantGameSpecs(choice.mode, locale);
  const softLinkedHiddenVariant =
    choice.initialGameSpecId &&
    !publicVariantOptions.some((option) => option.gameSpecId === choice.initialGameSpecId)
      ? choice.initialGameSpecId
      : undefined;
  const variantOptions = softLinkedHiddenVariant
    ? [
        {
          gameSpecId: softLinkedHiddenVariant,
          label: variantLabelForGameSpec(softLinkedHiddenVariant, locale),
        },
      ]
    : publicVariantOptions;
  const fallbackGameSpecId = defaultLandingGameSpecId(variantOptions, choice.mode);
  let selectedGameSpecId: LandingGameSpecId =
    choice.initialGameSpecId ?? storedPreference.gameSpecId ?? fallbackGameSpecId;
  if (!variantOptions.some((option) => option.gameSpecId === selectedGameSpecId)) {
    selectedGameSpecId = fallbackGameSpecId;
  }
  // In the engine flow, never default-select a variant with no bot (it shows
  // greyed-out below); fall back to one that has an engine.
  if (choice.mode === 'pve' && !landingVariantSupportsPve(selectedGameSpecId)) {
    selectedGameSpecId = fallbackGameSpecId;
  }
  // A stored preference is the player's own choice and always wins; otherwise
  // the variant's own default, then the house default.
  let selectedPreset: LandingTimePresetId =
    storedPreference.timePresetId ?? defaultTimePresetForSpec(selectedGameSpecId);
  // Whether selectedPreset is a CHOICE or merely the variant's default. Every
  // variant offers 10+5, so switching variants no longer narrows the preset out
  // of the allowed set — without this flag, xiangqi's 10+5 default would follow
  // the player into banqi and every other variant would silently inherit it,
  // which is precisely what offering-without-defaulting is meant to avoid. A
  // stored preference counts as a past explicit choice.
  let presetIsExplicit = storedPreference.timePresetId !== undefined;
  // Non-null when a correspondence (days-per-move) option is chosen — it takes
  // over from the real-time preset above. Only offered for Challenge-a-friend
  // and Find opponent on casual dark chess.
  let selectedCorrespondenceDays: number | null = wantsCorrespondence
    ? DEFAULT_CORRESPONDENCE_DAYS
    : null;
  // Which side of the time-control segmented toggle is active. Drives whether the
  // real-time presets or the correspondence day-chips show; only ever flips to
  // 'correspondence' when that segment is actually offered (correspondenceAvailable).
  let selectedTimeMode: 'realtime' | 'correspondence' = wantsCorrespondence
    ? 'correspondence'
    : 'realtime';
  // Engine choice is remembered per variant rather than sharing one slot across
  // all PvE variants. Seed from the stored per-variant map; migrate the legacy
  // single engineId onto the variant the dialog opens on (the last one played) so
  // existing players keep their pick.
  const engineByGameSpec = new Map<LandingGameSpecId, string>();
  for (const [spec, id] of Object.entries(storedPreference.engineIdByGameSpec ?? {})) {
    if (id) engineByGameSpec.set(spec as LandingGameSpecId, id);
  }
  if (storedPreference.engineId && !engineByGameSpec.has(selectedGameSpecId)) {
    engineByGameSpec.set(selectedGameSpecId, storedPreference.engineId);
  }
  let selectedEngineId =
    engineByGameSpec.get(selectedGameSpecId) ?? storedPreference.engineId ?? choice.engineId;
  // Same shape as presetIsExplicit above, for the same reason. An untouched side
  // follows the selected variant's declared first mover; without the flag the
  // default would persist as if it were a pick and then leak sideways, because
  // the colors are variant-declared: xiangqi storing 'red' would coerce to Gote
  // (SECOND) in Dark Shogi, whose first mover is black. A stored preference or
  // the legacy global key counts as a past explicit choice.
  const storedColor = storedPreference.preferredColor ?? loadStoredColorPreference();
  let colorIsExplicit = storedColor !== undefined;
  let preferredColor: LandingColorPreference =
    storedColor ?? defaultColorPreference(choice.mode, selectedGameSpecId);
  let syncGameSpecificSections = () => {};
  let syncVariantControls = () => {};
  let syncColorPreferenceControls = () => {};
  let syncSetupAccordion = () => {};
  let openSetupSection = (_id: string) => {};
  let openNextSetupSection = (_id: string) => {};

  const overlay = document.createElement('div');
  overlay.className = 'landing-setup-overlay';
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'landing-setup-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'landing-setup-title');

  const heading = document.createElement('strong');
  heading.className = 'landing-setup-title';
  heading.id = 'landing-setup-title';
  heading.textContent = t('play.playGame', {}, locale);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'landing-setup-close';
  closeButton.setAttribute('aria-label', t('setup.close', {}, locale));
  closeButton.textContent = '×';

  const header = document.createElement('div');
  header.className = 'landing-setup-header';
  header.append(heading, closeButton);

  // Unified-entry opponent picker (Bot / A friend / Lobby). It lives in
  // the setup row sequence near the end, after game type. Each mode renders a
  // different section set, so switching closes this dialog and reopens it in
  // the picked mode, carrying the live variant selection and engine roster over.
  let modeSwitcher: HTMLElement | null = null;
  if (choice.modeSwitcher) {
    modeSwitcher = document.createElement('div');
    modeSwitcher.className = 'landing-start-options three landing-setup-mode-switcher';
    modeSwitcher.setAttribute('role', 'radiogroup');
    modeSwitcher.setAttribute('aria-label', t('play.opponentLabel', {}, locale));
    const modeOptions: { mode: LandingPlayMode; label: string }[] = [
      { mode: 'pve', label: t('play.opponentEngine', {}, locale) },
      { mode: 'pvp', label: t('play.opponentFriend', {}, locale) },
      { mode: 'lobby', label: t('play.opponentLobby', {}, locale) },
    ];
    for (const option of modeOptions) {
      const button = startOptionButton(option.label, option.mode === choice.mode);
      button.dataset.playMode = option.mode;
      if (option.mode !== choice.mode) {
        button.addEventListener('click', () => {
          reopenSetupDialogInMode(choice, option.mode, selectedGameSpecId);
        });
      }
      modeSwitcher.append(button);
    }
  }

  const variantSection = document.createElement('div');
  variantSection.className = 'landing-setup-section';
  variantSection.append(setupSectionLabel(t('setup.variant', {}, locale)));

  // The picker appears only when a second variant exists beyond chess. The
  // option set is mode-aware because PvE can show non-engine variants as
  // disabled cards instead of hiding them entirely.
  const variantSelectable = variantOptions.length > 1;
  if (variantSelectable) {
    // A visual radiogroup of variant cards (marker + name) replaces the old
    // native <select>, so the picker doubles as a showcase of what's playable.
    const grid = document.createElement('div');
    grid.className = 'landing-variant-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', t('setup.variant', {}, locale));
    const cards = new Map<LandingGameSpecId, HTMLButtonElement>();
    for (const { gameSpecId, label } of variantOptions) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'landing-variant-card';
      card.setAttribute('role', 'radio');
      card.dataset.gameSpec = gameSpecId;
      // No computer opponent yet (Dark Xiangqi, Reveal Chess): grey the card out
      // of the engine flow rather than letting it be picked and silently create
      // a PvP room.
      const pveDisabled = choice.mode === 'pve' && !landingVariantSupportsPve(gameSpecId);
      if (pveDisabled) {
        card.disabled = true;
        card.classList.add('landing-variant-card-disabled');
        card.setAttribute('aria-disabled', 'true');
        card.title = t('setup.noComputerOpponentYet', { variant: label }, locale);
      }
      const miniId = variantMiniIdForGameSpec(gameSpecId);
      if (miniId) {
        const thumb = document.createElement('span');
        thumb.className = 'landing-variant-card-thumb';
        thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${label} marker` });
        card.append(thumb);
      }
      const name = document.createElement('span');
      name.className = 'landing-variant-card-name';
      name.textContent = label;
      card.append(name);
      if (pveDisabled) {
        const badge = document.createElement('span');
        badge.className = 'landing-variant-card-badge';
        badge.textContent = t('setup.soon', {}, locale);
        card.append(badge);
      } else {
        card.addEventListener('click', () => {
          selectedGameSpecId = gameSpecId;
          syncVariantControls();
          syncGameSpecificSections();
          openNextSetupSection('variant');
        });
      }
      cards.set(gameSpecId, card);
      grid.append(card);
    }
    syncVariantControls = () => {
      for (const [specId, card] of cards) {
        const on = specId === selectedGameSpecId;
        card.classList.toggle('selected', on);
        card.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    };
    syncVariantControls();
    variantSection.append(grid);
  } else {
    const variantControl = document.createElement('div');
    variantControl.className = 'landing-variant-control';
    const label = variantLabelForGameSpec(selectedGameSpecId, locale);
    const miniId = variantMiniIdForGameSpec(selectedGameSpecId);
    if (miniId) {
      const thumb = document.createElement('span');
      thumb.className = 'landing-variant-control-thumb';
      thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${label} marker` });
      variantControl.append(thumb);
    }
    const name = document.createElement('span');
    name.className = 'landing-variant-control-name';
    name.textContent = label;
    variantControl.append(name);
    variantSection.append(variantControl);
  }

  const engineSection =
    choice.mode === 'pve'
      ? buildEngineSetupSection(
          choice.engines ?? fallbackPlayableEngines(),
          selectedEngineId,
          (engineId, gameSpecId) => {
            selectedEngineId = engineId;
            engineByGameSpec.set(gameSpecId, engineId);
            syncSetupAccordion();
            openNextSetupSection('engine');
          },
          locale,
        )
      : null;

  const draft960Enabled = isVariantEnabled('fog_draft960');
  const draft960Selectable = draft960Enabled && choice.mode !== 'lobby';
  let startGroup: HTMLDivElement | null = null;
  const standardButton = startOptionButton(t('play.standard', {}, locale), true);
  const draftButton = startOptionButton(
    draft960Selectable
      ? t('setup.darkDraft960', {}, locale)
      : t('setup.darkDraft960ComingSoon', {}, locale),
    false,
  );
  if (draft960Enabled) {
    startGroup = document.createElement('div');
    startGroup.className = 'landing-start-options';
    startGroup.setAttribute('role', 'radiogroup');
    startGroup.setAttribute('aria-label', t('setup.variant', {}, locale));
    if (!draft960Selectable) {
      draftButton.disabled = true;
      draftButton.classList.add('disabled');
      draftButton.title = t('setup.soon', {}, locale);
    }
    const syncOptions = () => {
      standardButton.classList.toggle('selected', startFormat === 'standard');
      standardButton.setAttribute('aria-checked', startFormat === 'standard' ? 'true' : 'false');
      draftButton.classList.toggle('selected', startFormat === 'draft960');
      draftButton.setAttribute('aria-checked', startFormat === 'draft960' ? 'true' : 'false');
    };
    standardButton.addEventListener('click', () => {
      startFormat = 'standard';
      syncOptions();
      syncSetupAccordion();
    });
    if (draft960Selectable) {
      draftButton.addEventListener('click', () => {
        startFormat = 'draft960';
        syncOptions();
        syncSetupAccordion();
      });
    }
    startGroup.append(standardButton, draftButton);
    variantSection.append(startGroup);
  }

  const timeSection = document.createElement('div');
  timeSection.className = 'landing-setup-section';
  timeSection.append(setupSectionLabel(t('setup.timeControl', {}, locale)));

  // Lichess-style segmented toggle: Real time vs Correspondence. It only appears
  // when correspondence is actually offered for the current selection (casual
  // dark chess in Challenge-a-friend / Find opponent); otherwise the section is
  // real-time-only and the toggle stays hidden. Correspondence is the long end of
  // the time axis, not a separate mode — Challenge-a-friend creates a private
  // room, Find opponent posts an open seek.
  const timeModeToggle = document.createElement('div');
  timeModeToggle.className = 'landing-start-options landing-time-mode';
  timeModeToggle.setAttribute('role', 'radiogroup');
  timeModeToggle.setAttribute('aria-label', t('setup.timeControlType', {}, locale));
  const realtimeModeButton = startOptionButton(t('setup.realTime', {}, locale), true);
  const correspondenceModeButton = startOptionButton(t('setup.correspondence', {}, locale), false);
  realtimeModeButton.addEventListener('click', () => {
    selectedTimeMode = 'realtime';
    selectedCorrespondenceDays = null;
    syncTimeControls();
  });
  correspondenceModeButton.addEventListener('click', () => {
    selectedTimeMode = 'correspondence';
    if (selectedCorrespondenceDays === null) {
      selectedCorrespondenceDays = DEFAULT_CORRESPONDENCE_DAYS;
    }
    syncTimeControls();
  });
  timeModeToggle.append(realtimeModeButton, correspondenceModeButton);

  const presetGroup = document.createElement('div');
  presetGroup.className = 'landing-time-presets';
  presetGroup.setAttribute('role', 'radiogroup');
  presetGroup.setAttribute('aria-label', t('setup.timeControl', {}, locale));

  const presetButtons = LANDING_TIME_PRESETS.map((preset) => {
    const button = startOptionButton(preset.label, preset.id === selectedPreset);
    button.addEventListener('click', () => {
      if (button.hidden) return;
      selectedPreset = preset.id;
      presetIsExplicit = true;
      selectedTimeMode = 'realtime';
      selectedCorrespondenceDays = null;
      syncTimeControls();
      openNextSetupSection('time');
    });
    presetGroup.append(button);
    return { button, preset };
  });

  const correspondenceGroup = document.createElement('div');
  correspondenceGroup.className = 'landing-time-presets landing-correspondence-presets';
  correspondenceGroup.setAttribute('role', 'radiogroup');
  correspondenceGroup.setAttribute('aria-label', t('setup.daysPerMove', {}, locale));
  const correspondenceButtons = CORRESPONDENCE_DAY_OPTIONS.map((option) => {
    const button = startOptionButton(dayOptionLabel(option.days, locale), false);
    button.addEventListener('click', () => {
      if (button.hidden) return;
      selectedTimeMode = 'correspondence';
      selectedCorrespondenceDays = option.days;
      syncTimeControls();
      openNextSetupSection('time');
    });
    correspondenceGroup.append(button);
    return { button, option };
  });

  // Which variants may be played by correspondence is a shared product list in
  // @mistboard/game (the server's fail-closed allowlist reads the same array).
  // This used to hard-code dark chess, which silently drifted when xiangqi
  // joined the list on 2026-07-04: the Correspondence tab's own "Create a game"
  // opened on a non-eligible variant and offered nothing but real-time clocks.
  const correspondenceAvailable = () =>
    (choice.mode === 'pvp' || choice.mode === 'lobby') &&
    (CORRESPONDENCE_ELIGIBLE_SPEC_IDS as readonly string[]).includes(selectedGameSpecId) &&
    !rated &&
    correspondenceEnabled();

  // Re-scope the picker to the current variant/rated/mode. Hides the segmented
  // toggle (and forces real time) when correspondence isn't offered; shows exactly
  // one chip group for the active segment; keeps the allowed real-time presets in
  // sync (5+5 is hidden for Crossroads casual, rated keeps only rated-eligible
  // paces, and a pick that is no longer offered falls back to 3+2).
  const syncTimeControls = () => {
    const corrAvailable = correspondenceAvailable();
    if (!corrAvailable) {
      selectedTimeMode = 'realtime';
      selectedCorrespondenceDays = null;
    }
    const corrActive = selectedTimeMode === 'correspondence';

    timeModeToggle.hidden = !corrAvailable;
    realtimeModeButton.classList.toggle('selected', !corrActive);
    realtimeModeButton.setAttribute('aria-checked', !corrActive ? 'true' : 'false');
    correspondenceModeButton.classList.toggle('selected', corrActive);
    correspondenceModeButton.setAttribute('aria-checked', corrActive ? 'true' : 'false');

    presetGroup.hidden = corrActive;
    correspondenceGroup.hidden = !corrActive;

    const allowed = allowedTimePresetIds(selectedGameSpecId, rated, choice.mode);
    // An untouched preset follows the selected variant; a chosen one sticks.
    if (!presetIsExplicit) selectedPreset = defaultTimePresetForSpec(selectedGameSpecId);
    // Fall back INSIDE the allowed set: the variant's default is the first
    // choice, but a pinned engine pace or the rated allowlist can exclude it,
    // and selecting a hidden preset would start a game at a pace the picker
    // refuses to show.
    if (!allowed.has(selectedPreset)) {
      const preferred = defaultTimePresetForSpec(selectedGameSpecId);
      selectedPreset =
        allowed.has(preferred) || allowed.size === 0
          ? preferred
          : (LANDING_TIME_PRESETS.find((preset) => allowed.has(preset.id))?.id ?? preferred);
    }
    for (const { button, preset } of presetButtons) {
      const show = allowed.has(preset.id);
      button.hidden = !show;
      const selected = show && !corrActive && selectedPreset === preset.id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
    for (const { button, option } of correspondenceButtons) {
      const selected = corrActive && selectedCorrespondenceDays === option.days;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
    syncSetupAccordion();
  };
  syncTimeControls();
  timeSection.append(timeModeToggle, presetGroup, correspondenceGroup);

  const actions = document.createElement('div');
  actions.className = 'landing-setup-actions';

  const status = document.createElement('p');
  status.className = 'landing-setup-status';
  status.setAttribute('aria-live', 'polite');

  let cancelLobbyWait: (() => void) | null = null;
  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'landing-setup-start';
  startButton.textContent =
    choice.mode === 'lobby'
      ? t('play.findOpponent', {}, locale)
      : choice.mode === 'pvp'
        ? t('setup.createRoom', {}, locale)
        : t('setup.startGame', {}, locale);
  startButton.addEventListener('click', () => {
    if (selectedCorrespondenceDays !== null) {
      // Challenge a friend creates a private invite room; Find opponent posts an
      // open seek to the board (color server-assigned there, like the live pool).
      if (choice.mode === 'lobby') {
        void postCorrespondenceSeekFromPlay(
          startButton,
          status,
          selectedCorrespondenceDays,
          locale,
        );
      } else {
        void createCorrespondenceFromPlay(
          startButton,
          status,
          selectedCorrespondenceDays,
          preferredColor,
          locale,
        );
      }
      return;
    }
    const setup = selectedRoomSetup(
      selectedGameSpecId,
      startFormat,
      rated,
      selectedPreset,
      preferredColor,
    );
    storeSetupPreference(choice.mode, setup, selectedPreset, selectedEngineId, colorIsExplicit);
    if (choice.mode === 'lobby') {
      cancelLobbyWait?.();
      // The empty-lobby "play the engine" offer is chess-only (no engine plays
      // the xiangqi family yet), so DMX seekers wait without it.
      const lobbyEngineId = setup.gameSpecId === DARK_CHESS_SPEC_ID ? selectedEngineId : undefined;
      cancelLobbyWait = joinLobbyFromPlay(startButton, setup, status, locale, lobbyEngineId);
      return;
    }
    void createRoomFromPlay(startButton, choice.mode, selectedEngineId, setup, status, locale);
  });

  const close = () => {
    cancelLobbyWait?.();
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    if (activeDialogClose === close) activeDialogClose = null;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);

  // Keep game type visible in the bot flow too. Bot games are always
  // casual, so Rated is present but unavailable; human modes retain their
  // existing launch and sign-in gates.
  const ratingSection = buildRatedToggleSection(
    () => rated,
    (v) => {
      rated = v;
    },
    () =>
      choice.mode === 'pve' ||
      Boolean(choice.ratedDisabled) ||
      !landingGameSpecCapabilities(selectedGameSpecId).supportsRated,
    () => {
      syncTimeControls();
      openNextSetupSection('gameType');
    },
    locale,
  );

  // Color picker shows for PvE and Challenge-a-friend. Hidden for casual/rated
  // lobby matchmaking — color is server-assigned there so the pool stays unified.
  const colorSection =
    choice.mode === 'pve' || choice.mode === 'pvp'
      ? buildColorPreferenceSection(
          () => preferredColor,
          (value) => {
            preferredColor = value;
            colorIsExplicit = true;
            syncSetupAccordion();
          },
          () => selectedGameSpecId,
          (sync) => {
            syncColorPreferenceControls = sync;
          },
          locale,
        )
      : null;

  syncGameSpecificSections = () => {
    const capabilities = landingGameSpecCapabilities(selectedGameSpecId);
    if (!capabilities.supportsStartFormat || !draft960Selectable) {
      startFormat = 'standard';
    }
    if (!capabilities.supportsRated) {
      rated = false;
    }
    // An untouched side follows the selected variant (each declares its own first
    // mover); a chosen one sticks, coerced into the colors this variant offers.
    preferredColor = colorIsExplicit
      ? coerceColorPreferenceForCapabilities(preferredColor, capabilities)
      : defaultColorPreference(choice.mode, selectedGameSpecId);
    // Some variants (Banqi) have no choosable side — the ink is bound by the
    // first mover's opening flip — so suppress the color picker and randomize.
    const hideColorPicker =
      webVariantTenantForSpecId(selectedGameSpecId)?.landing?.hideColorPicker ?? false;
    if (hideColorPicker) preferredColor = 'random';
    if (colorSection) {
      // `.hidden` alone won't hide it: `.landing-setup-section` sets
      // `display: grid`, which overrides the `[hidden]` attribute's
      // `display: none`. Toggle the inline display so it actually disappears.
      colorSection.hidden = hideColorPicker;
      colorSection.style.display = hideColorPicker ? 'none' : '';
    }
    if (startGroup) startGroup.hidden = !capabilities.supportsStartFormat;
    ratingSection.sync();
    if (engineSection) {
      engineSection.sync(
        selectedGameSpecId,
        engineByGameSpec.get(selectedGameSpecId) ?? selectedEngineId,
      );
      engineSection.section.hidden = !engineSection.hasMultipleChoices();
    }
    timeSection.hidden = !capabilities.supportsTimeControl;
    syncTimeControls(); // re-scope the preset picker to the selected variant
    syncVariantControls();
    syncColorPreferenceControls();
    syncSetupAccordion();
  };
  syncGameSpecificSections();

  const timeSummary = () => {
    if (selectedCorrespondenceDays !== null) {
      return dayOptionLabel(selectedCorrespondenceDays, locale);
    }
    return (
      LANDING_TIME_PRESETS.find((candidate) => candidate.id === selectedPreset)?.label ?? '3 + 2'
    );
  };
  const gameTypeSummary = () =>
    rated && !choice.ratedDisabled ? t('play.rated', {}, locale) : t('play.casual', {}, locale);
  const opponentSummary = () =>
    choice.mode === 'pve'
      ? t('play.opponentEngine', {}, locale)
      : choice.mode === 'pvp'
        ? t('play.opponentFriend', {}, locale)
        : t('play.opponentLobby', {}, locale);
  const variantSummary = () =>
    selectedGameSpecId === DARK_CHESS_SPEC_ID && startFormat === 'draft960'
      ? t('setup.darkDraft960', {}, locale)
      : variantLabelForGameSpec(selectedGameSpecId, locale);
  const engineSummary = () => {
    const availableEngines =
      webVariantTenantForSpecId(selectedGameSpecId)?.landing?.engineOptions ??
      (choice.engines && choice.engines.length > 0 ? choice.engines : fallbackPlayableEngines());
    const engineId = engineByGameSpec.get(selectedGameSpecId) ?? selectedEngineId;
    return (
      availableEngines.find((engine) => engine.id === engineId)?.name ??
      availableEngines[0]?.name ??
      'Misty'
    );
  };
  const colorSummary = () => {
    if (preferredColor === 'random') return t('setup.random', {}, locale);
    const capabilities = landingGameSpecCapabilities(selectedGameSpecId);
    if (preferredColor === capabilities.firstColor)
      return localizeSetupLabel(capabilities.firstLabel, locale);
    if (preferredColor === capabilities.secondColor)
      return localizeSetupLabel(capabilities.secondLabel, locale);
    return t('setup.random', {}, locale);
  };
  const setupSections = [
    buildSetupAccordionSection(
      'variant',
      t('setup.variant', {}, locale),
      variantSection,
      variantSummary,
    ),
    buildSetupAccordionSection(
      'time',
      t('setup.timeControl', {}, locale),
      timeSection,
      timeSummary,
    ),
    ...(colorSection
      ? [
          buildSetupAccordionSection(
            'side',
            t('setup.side', {}, locale),
            colorSection,
            colorSummary,
          ),
        ]
      : []),
    buildSetupAccordionSection(
      'gameType',
      t('setup.gameType', {}, locale),
      ratingSection.section,
      gameTypeSummary,
    ),
    ...(modeSwitcher
      ? [
          buildSetupAccordionSection(
            'opponent',
            t('play.opponentLabel', {}, locale),
            modeSwitcher,
            opponentSummary,
          ),
        ]
      : []),
    ...(engineSection
      ? [
          buildSetupAccordionSection(
            'engine',
            t('setup.engine', {}, locale),
            engineSection.section,
            engineSummary,
          ),
        ]
      : []),
  ];
  let openSetupSectionId = variantSelectable ? 'variant' : 'time';
  syncSetupAccordion = () => {
    const isSectionHidden = (content: HTMLElement) =>
      content.hidden || content.style.display === 'none';
    if (
      !setupSections.some(
        (section) => section.id === openSetupSectionId && !isSectionHidden(section.content),
      )
    ) {
      openSetupSectionId =
        setupSections.find((section) => !isSectionHidden(section.content))?.id ??
        openSetupSectionId;
    }
    for (const section of setupSections) {
      const hidden = isSectionHidden(section.content);
      const active = section.id === openSetupSectionId && !hidden;
      section.wrapper.hidden = hidden;
      section.wrapper.classList.toggle('active', active);
      section.button.setAttribute('aria-expanded', active ? 'true' : 'false');
      section.panel.hidden = !active;
      section.value.textContent = section.valueText();
    }
  };
  openSetupSection = (id: string) => {
    openSetupSectionId = id;
    syncSetupAccordion();
  };
  openNextSetupSection = (id: string) => {
    const isSectionHidden = (content: HTMLElement) =>
      content.hidden || content.style.display === 'none';
    const currentIndex = setupSections.findIndex((section) => section.id === id);
    const next = setupSections
      .slice(currentIndex + 1)
      .find((section) => !isSectionHidden(section.content));
    if (next) {
      openSetupSection(next.id);
    } else {
      syncSetupAccordion();
    }
  };
  for (const section of setupSections) {
    section.button.addEventListener('click', () => openSetupSection(section.id));
  }
  syncSetupAccordion();

  // The decision sequence closes with game type and opponent. Computer adds one
  // final engine row after the opponent choice.
  const accordion = document.createElement('div');
  accordion.className = 'landing-setup-accordion';
  accordion.append(...setupSections.map((section) => section.wrapper));
  actions.append(startButton);
  dialog.append(header);
  dialog.append(accordion);
  dialog.append(status, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  activeDialogClose = close;
  (draft960Enabled && selectedGameSpecId === DARK_CHESS_SPEC_ID
    ? standardButton
    : startButton
  ).focus();
}

// Close the open setup dialog and reopen it in another mode, keeping the
// current variant selection and the caller's engine roster. Rated availability
// is recomputed per mode.
function reopenSetupDialogInMode(
  choice: LandingPlayChoice,
  mode: LandingPlayMode,
  gameSpecId: LandingGameSpecId,
): void {
  const locale = choice.locale ?? currentLocale();
  closeActiveLandingDialog();
  openLandingSetupDialog({
    engineId: choice.engineId,
    engines: choice.engines,
    initialGameSpecId: gameSpecId,
    locale,
    mode,
    modeSwitcher: true,
    ratedDisabled:
      mode === 'pvp'
        ? true
        : mode === 'lobby'
          ? !isRatedModeEnabled() || !isLikelySignedIn()
          : undefined,
  });
}

// The days-per-move options offered at the long end of the time-control picker
// (openLandingSetupDialog). Selecting one routes the submit to the correspondence
// path — a private room (Challenge a friend) or an open seek (Find opponent) —
// instead of the real-time create.
const CORRESPONDENCE_DAY_OPTIONS: { days: number }[] = [{ days: 1 }, { days: 3 }, { days: 7 }];
// Pre-selected day-chip when the player first flips to the Correspondence segment,
// so the Start button is immediately valid (mirrors lichess defaulting its slider).
const DEFAULT_CORRESPONDENCE_DAYS = 3;

function dayOptionLabel(days: number, locale: Locale): string {
  return days === 1 ? t('setup.oneDay', {}, locale) : t('setup.days', { count: days }, locale);
}

function localizeSetupLabel(label: string, locale: Locale): string {
  switch (label) {
    case 'White':
      return t('setup.white', {}, locale);
    case 'Black':
      return t('setup.black', {}, locale);
    case 'Red':
      return t('setup.red', {}, locale);
    case 'Random':
      return t('setup.random', {}, locale);
    case 'First':
      return t('setup.first', {}, locale);
    case 'Second':
      return t('setup.second', {}, locale);
    case 'Sente':
      return t('setup.sente', {}, locale);
    case 'Gote':
      return t('setup.gote', {}, locale);
    case 'Color':
      return t('setup.color', {}, locale);
    case 'Move order':
      return t('setup.moveOrder', {}, locale);
    default:
      return label;
  }
}

async function createCorrespondenceFromPlay(
  button: HTMLButtonElement,
  status: HTMLElement,
  daysPerMove: number,
  preferredColor: LandingColorPreference,
  locale: Locale,
): Promise<void> {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = t('setup.creating', {}, locale);
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameSpecId: DARK_CHESS_SPEC_ID,
        mode: 'correspondence',
        daysPerMove,
        // The picker offers white/black/random only (chess colors).
        preferredColor: preferredColor === 'red' ? 'random' : preferredColor,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { url?: string };
      if (!data.url) throw new Error('room creation did not return a URL');
      if (!status.isConnected) return;
      roomNavigator(data.url);
      return;
    }
    const failure = await readRoomCreationFailure(response);
    if (!status.isConnected) return;
    status.replaceChildren();
    if (failure.error === 'correspondence_requires_account') {
      status.append('Correspondence games need an account. ', accountLink('Sign in'), ' first.');
    } else if (failure.error === 'invalid_days_per_move') {
      status.textContent = 'Pick 1, 3, or 7 days per move.';
    } else if (failure.error === 'server_draining') {
      status.textContent = 'The server is restarting. Try again in a minute.';
    } else {
      status.textContent = 'Correspondence is unavailable right now. Try again later.';
    }
    button.textContent = t('setup.tryAgain', {}, locale);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  } catch (err) {
    console.warn(err);
    if (status.isConnected) {
      status.textContent = 'Could not reach the server. Check your connection and try again.';
    }
    button.textContent = t('setup.tryAgain', {}, locale);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

// Find opponent + a correspondence allowance: post an open seek to the board
// rather than create a private room. Color is server-assigned (random), matching
// the live pool's unified-pool rule; players who want a specific color use the
// "Post a game" form on /correspondence. Lands on the board so the player sees
// their seek and can join someone else's while they wait.
async function postCorrespondenceSeekFromPlay(
  button: HTMLButtonElement,
  status: HTMLElement,
  daysPerMove: number,
  locale: Locale,
): Promise<void> {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = t('setup.posting', {}, locale);
  try {
    const response = await fetch('/api/correspondence/seeks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ daysPerMove, preferredColor: 'random' }),
    });
    if (response.ok) {
      if (!status.isConnected) return;
      roomNavigator('/correspondence');
      return;
    }
    const failure = await readRoomCreationFailure(response);
    if (!status.isConnected) return;
    status.replaceChildren();
    if (failure.error === 'not_signed_in' || failure.error === 'correspondence_requires_account') {
      status.append('Correspondence games need an account. ', accountLink('Sign in'), ' first.');
    } else if (failure.error === 'invalid_days_per_move') {
      status.textContent = 'Pick 1, 3, or 7 days per move.';
    } else if (failure.error === 'seek_limit_reached') {
      status.textContent = 'You already have the most open games allowed. Cancel one first.';
    } else if (failure.error === 'server_draining') {
      status.textContent = 'The server is restarting. Try again in a minute.';
    } else {
      status.textContent = 'Correspondence is unavailable right now. Try again later.';
    }
    button.textContent = t('setup.tryAgain', {}, locale);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  } catch (err) {
    console.warn(err);
    if (status.isConnected) {
      status.textContent = 'Could not reach the server. Check your connection and try again.';
    }
    button.textContent = t('setup.tryAgain', {}, locale);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function accountLink(label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '/account';
  link.textContent = label;
  return link;
}

function buildEngineSetupSection(
  engines: PlayableEngine[],
  selectedEngineId: string | undefined,
  onSelect: (engineId: string, gameSpecId: LandingGameSpecId) => void,
  locale: Locale,
): {
  hasMultipleChoices(): boolean;
  section: HTMLElement;
  sync(gameSpecId: LandingGameSpecId, selectedEngineId: string | undefined): void;
} {
  const section = document.createElement('div');
  section.className = 'landing-setup-section';
  section.append(setupSectionLabel(t('setup.engine', {}, locale)));
  const body = document.createElement('div');
  section.append(body);
  let choiceCount = 0;

  const sync = (gameSpecId: LandingGameSpecId, currentEngineId: string | undefined) => {
    body.replaceChildren();
    const tenantEngineOptions = webVariantTenantForSpecId(gameSpecId)?.landing?.engineOptions;
    const availableEngines = tenantEngineOptions
      ? [...tenantEngineOptions]
      : engines.length > 0
        ? engines
        : fallbackPlayableEngines();
    choiceCount = availableEngines.length;
    const selected =
      currentEngineId && availableEngines.some((engine) => engine.id === currentEngineId)
        ? currentEngineId
        : defaultEngineIdForGameSpec(gameSpecId, availableEngines);
    if (selected) onSelect(selected, gameSpecId);

    // A single bot is implicit in the opponent choice, so only variants with a
    // real bot roster need a dedicated selection row.
    if (availableEngines.length <= 1) {
      return;
    }

    const select = document.createElement('select');
    select.className = 'landing-engine-select';
    select.setAttribute('aria-label', t('setup.engine', {}, locale));
    for (const engine of availableEngines) {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engine.name;
      select.append(option);
    }
    select.value = selected;
    select.addEventListener('change', () => onSelect(select.value, gameSpecId));
    body.append(select);
  };

  sync(DARK_CHESS_SPEC_ID, selectedEngineId);
  return { hasMultipleChoices: () => choiceCount > 1, section, sync };
}

function defaultEngineIdForGameSpec(
  gameSpecId: LandingGameSpecId,
  availableEngines: readonly PlayableEngine[],
): string {
  const tenantDefault = webVariantTenantForSpecId(gameSpecId)?.landing?.defaultEngineId;
  if (tenantDefault) return tenantDefault;
  return availableEngines[0]?.id ?? '';
}

function buildRatedToggleSection(
  get: () => boolean,
  set: (v: boolean) => void,
  isRatedDisabled: () => boolean = () => false,
  onChange: () => void = () => undefined,
  locale: Locale = currentLocale(),
): { section: HTMLElement; sync(): void } {
  const section = document.createElement('div');
  section.className = 'landing-setup-section';
  section.append(setupSectionLabel(t('setup.gameType', {}, locale)));

  const group = document.createElement('div');
  group.className = 'landing-start-options';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('setup.gameType', {}, locale));

  const ratedButton = startOptionButton(t('play.rated', {}, locale), true);
  const casualButton = startOptionButton(t('play.casual', {}, locale), false);

  const sync = () => {
    const ratedDisabled = isRatedDisabled();
    const isRated = get();
    updateStartOptionButtonLabel(
      ratedButton,
      ratedDisabled ? t('setup.ratedComingSoon', {}, locale) : t('play.rated', {}, locale),
    );
    ratedButton.disabled = ratedDisabled;
    ratedButton.classList.toggle('disabled', ratedDisabled);
    ratedButton.classList.toggle('selected', isRated && !ratedDisabled);
    ratedButton.setAttribute('aria-checked', isRated && !ratedDisabled ? 'true' : 'false');
    casualButton.classList.toggle('selected', !isRated || ratedDisabled);
    casualButton.setAttribute('aria-checked', !isRated || ratedDisabled ? 'true' : 'false');
  };
  ratedButton.addEventListener('click', () => {
    if (isRatedDisabled()) return;
    set(true);
    sync();
    onChange();
  });
  casualButton.addEventListener('click', () => {
    set(false);
    sync();
    onChange();
  });
  sync();
  group.append(ratedButton, casualButton);

  // The Rated segment's own "COMING SOON" badge already signals the beta state,
  // so the explanatory helper paragraph is dropped to keep the dialog compact.
  section.append(group);
  return { section, sync };
}

const COLOR_PREFERENCE_STORAGE_KEY = 'mistboard:setup:preferredColor';
const SETUP_PREFERENCE_STORAGE_PREFIX = 'mistboard:setup:';

// Legacy global key, read-only: nothing has written it since the per-mode
// preference landed. Returns undefined rather than a color when absent, so the
// caller can tell "no choice yet" from "chose random" and seed the mode default.
function loadStoredColorPreference(): LandingColorPreference | undefined {
  try {
    const raw = window.localStorage.getItem(COLOR_PREFERENCE_STORAGE_KEY);
    if (raw === 'white' || raw === 'red' || raw === 'black' || raw === 'random') return raw;
  } catch {
    // ignore — storage may be disabled (private mode, quota); fall through to default
  }
  return undefined;
}

// The side a freshly opened dialog starts on, before the player touches the
// picker. PvE seats the human as the variant's first mover: a game against a bot
// has no fairness argument for a coin flip, and on the flip variants the picker
// is MOVE ORDER rather than ink (banqi and Flip Jungle bind the ink on the first
// flip), so landing on "Second" means the board moves before the player has done
// anything — the worst possible first frame for someone arriving from a rules
// page CTA. PvP and lobby keep 'random', where the coin flip IS the fairness
// mechanism. Read from the variant's own capabilities rather than a hardcoded
// red/white ordering, since each variant declares its own first mover.
function defaultColorPreference(
  mode: LandingPlayMode,
  gameSpecId: LandingGameSpecId,
): LandingColorPreference {
  if (mode !== 'pve') return 'random';
  return landingGameSpecCapabilities(gameSpecId).firstColor;
}

function setupPreferenceStorageKey(mode: LandingPlayMode): string {
  return `${SETUP_PREFERENCE_STORAGE_PREFIX}${mode}`;
}

function loadSetupPreference(mode: LandingPlayMode): LandingSetupPreference {
  try {
    const raw = window.localStorage.getItem(setupPreferenceStorageKey(mode));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      engineId: typeof parsed.engineId === 'string' ? parsed.engineId : undefined,
      engineIdByGameSpec: normalizeStoredEngineMap(parsed.engineIdByGameSpec),
      gameSpecId: normalizeStoredGameSpecId(parsed.gameSpecId),
      preferredColor: normalizeStoredColorPreference(parsed.preferredColor),
      rated: typeof parsed.rated === 'boolean' ? parsed.rated : undefined,
      startFormat: normalizeStoredStartFormat(parsed.startFormat),
      timePresetId: normalizeStoredTimePresetId(parsed.timePresetId),
    };
  } catch {
    return {};
  }
}

function storeSetupPreference(
  mode: LandingPlayMode,
  setup: LandingRoomSetup,
  timePresetId: LandingTimePresetId,
  engineId: string | undefined,
  colorIsExplicit: boolean,
): void {
  // Merge into the existing per-variant engine map so persisting one variant's
  // pick never drops another variant's remembered engine.
  const engineIdByGameSpec = { ...(loadSetupPreference(mode).engineIdByGameSpec ?? {}) };
  if (mode === 'pve' && engineId) engineIdByGameSpec[setup.gameSpecId] = engineId;
  const preference: LandingSetupPreference = {
    gameSpecId: setup.gameSpecId,
    rated: setup.rated,
    startFormat: setup.startFormat,
    timePresetId,
  };
  if (Object.keys(engineIdByGameSpec).length > 0) {
    preference.engineIdByGameSpec = engineIdByGameSpec;
  }
  // Only a real pick is remembered. Persisting the untouched default would make
  // it indistinguishable from a choice on the next open, which is how a default
  // taken in one variant ends up seating the player in another (see the
  // colorIsExplicit comment in openLandingSetupDialog).
  if (mode !== 'lobby' && colorIsExplicit) preference.preferredColor = setup.preferredColor;
  if (mode === 'pve' && engineId) preference.engineId = engineId;
  try {
    window.localStorage.setItem(setupPreferenceStorageKey(mode), JSON.stringify(preference));
  } catch {
    // ignore
  }
}

function normalizeStoredGameSpecId(value: unknown): LandingGameSpecId | undefined {
  if (value === DARK_CHESS_SPEC_ID) return DARK_CHESS_SPEC_ID;
  if (typeof value === 'string') {
    const tenant = webVariantTenantForSpecId(value);
    if (tenant?.landing?.offerInMenu()) return tenant.gameSpecId as LandingGameSpecId;
  }
  if (
    (value === CROSSROADS_CHESS_SPEC_ID || value === DUAL_CHESS_SPEC_ID) &&
    crossroadsChessEnabled()
  )
    return CROSSROADS_CHESS_SPEC_ID;
  return undefined;
}

function normalizeStoredEngineMap(
  value: unknown,
): Partial<Record<LandingGameSpecId, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [spec, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string') out[spec] = id;
  }
  // Stale entries (engine ids no longer valid for a variant) are harmless: the
  // engine section re-validates against the variant's current option list and
  // falls back to that variant's default.
  return Object.keys(out).length > 0
    ? (out as Partial<Record<LandingGameSpecId, string>>)
    : undefined;
}

function normalizeStoredColorPreference(value: unknown): LandingColorPreference | undefined {
  if (value === 'white' || value === 'red' || value === 'black' || value === 'random') return value;
  return undefined;
}

function coerceColorPreferenceForCapabilities(
  preferredColor: LandingColorPreference,
  capabilities: LandingGameSpecCapabilities,
): LandingColorPreference {
  if (preferredColor === 'random') return preferredColor;
  if (preferredColor === capabilities.firstColor || preferredColor === capabilities.secondColor) {
    return preferredColor;
  }
  if (preferredColor === 'white') return capabilities.firstColor;
  if (preferredColor === 'black') return capabilities.secondColor;
  return capabilities.firstColor === 'red' ? capabilities.firstColor : capabilities.secondColor;
}

function normalizeStoredStartFormat(value: unknown): LandingStartFormat | undefined {
  if (value === 'standard' || value === 'draft960') return value;
  return undefined;
}

function normalizeStoredTimePresetId(value: unknown): LandingTimePresetId | undefined {
  return LANDING_TIME_PRESETS.some((preset) => preset.id === value)
    ? (value as LandingTimePresetId)
    : undefined;
}

function buildColorPreferenceSection(
  get: () => LandingColorPreference,
  set: (value: LandingColorPreference) => void,
  getGameSpecId: () => LandingGameSpecId = () => DARK_CHESS_SPEC_ID,
  onSync?: (sync: () => void) => void,
  locale: Locale = currentLocale(),
): HTMLElement {
  const section = document.createElement('div');
  section.className = 'landing-setup-section';
  const sectionLabel = setupSectionLabel(t('setup.color', {}, locale));
  section.append(sectionLabel);

  const group = document.createElement('div');
  group.className = 'landing-start-options three';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('setup.color', {}, locale));

  const initial = get();
  const firstButton = colorOptionButton('white', t('setup.white', {}, locale), initial === 'white');
  const randomButton = colorOptionButton(
    'random',
    t('setup.random', {}, locale),
    initial === 'random',
  );
  const blackButton = colorOptionButton('black', t('setup.black', {}, locale), initial === 'black');

  const sync = () => {
    const gameSpecId = getGameSpecId();
    const capabilities = landingGameSpecCapabilities(gameSpecId);
    const firstValue: LandingColorPreference = capabilities.firstColor;
    const secondValue: LandingColorPreference = capabilities.secondColor;
    const current = get();
    const pickerLabel = localizeSetupLabel(capabilities.pickerLabel ?? 'Color', locale);
    sectionLabel.textContent = pickerLabel;
    group.setAttribute('aria-label', pickerLabel);
    updateColorOptionButton(
      firstButton,
      firstValue,
      localizeSetupLabel(capabilities.firstLabel, locale),
      gameSpecId,
    );
    updateColorOptionButton(randomButton, 'random', t('setup.random', {}, locale), gameSpecId);
    updateColorOptionButton(
      blackButton,
      secondValue,
      localizeSetupLabel(capabilities.secondLabel, locale),
      gameSpecId,
    );
    for (const [button, value] of [
      [firstButton, firstValue],
      [randomButton, 'random'],
      [blackButton, secondValue],
    ] as const) {
      const selected = current === value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  };

  firstButton.addEventListener('click', () => {
    set(landingGameSpecCapabilities(getGameSpecId()).firstColor);
    sync();
  });
  randomButton.addEventListener('click', () => {
    set('random');
    sync();
  });
  blackButton.addEventListener('click', () => {
    set(landingGameSpecCapabilities(getGameSpecId()).secondColor);
    sync();
  });

  onSync?.(sync);
  group.append(firstButton, randomButton, blackButton);
  section.append(group);
  return section;
}

function colorOptionButton(
  value: LandingColorPreference,
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

function updateColorOptionButton(
  button: HTMLButtonElement,
  value: LandingColorPreference,
  label: string,
  gameSpecId: LandingGameSpecId,
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
  value: LandingColorPreference,
  gameSpecId: LandingGameSpecId = DARK_CHESS_SPEC_ID,
): Node[] {
  if (gameSpecId === JUNGLE_SPEC_ID) {
    return jungleElephantGlyphNodes(value);
  }
  if (gameSpecId === DARK_CHESS_SPEC_ID) {
    return chessKingGlyphNodes(value);
  }
  const capabilities = landingGameSpecCapabilities(gameSpecId);
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

function jungleElephantGlyphNodes(value: LandingColorPreference): Node[] {
  const elephant = (color: 'red' | 'black') => {
    const image = document.createElement('img');
    image.className = `landing-color-piece jungle ${color}`;
    image.src = `/piece-sets/jungle/dobutsu/${color}-elephant.png`;
    image.alt = '';
    return image;
  };
  if (value === 'random') return [elephant('red'), elephant('black')];
  return [elephant(value === 'black' ? 'black' : 'red')];
}

function chessKingGlyphNodes(value: LandingColorPreference): Node[] {
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

function landingGameSpecCapabilities(gameSpecId: LandingGameSpecId): LandingGameSpecCapabilities {
  // Tenant capabilities live on their registry entries; chess (the fallback)
  // keeps its row here until the P2 migration.
  return (
    webVariantTenantForSpecId(gameSpecId)?.landing?.capabilities ?? DARK_CHESS_LANDING_CAPABILITIES
  );
}

function setupSectionLabel(text: string): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = 'landing-setup-label';
  label.textContent = text;
  return label;
}

function buildSetupAccordionSection(
  id: string,
  label: string,
  content: HTMLElement,
  valueText: () => string,
): {
  button: HTMLButtonElement;
  content: HTMLElement;
  id: string;
  panel: HTMLElement;
  value: HTMLElement;
  valueText: () => string;
  wrapper: HTMLElement;
} {
  const leadingLabel = content.firstElementChild;
  if (leadingLabel?.classList.contains('landing-setup-label')) leadingLabel.remove();

  const wrapper = document.createElement('section');
  wrapper.className = 'landing-setup-accordion-section';
  wrapper.dataset.setupSection = id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'landing-setup-summary';
  button.setAttribute('aria-controls', `landing-setup-panel-${id}`);
  button.setAttribute('aria-expanded', 'false');

  const title = document.createElement('span');
  title.className = 'landing-setup-summary-title';
  title.textContent = label;

  const value = document.createElement('span');
  value.className = 'landing-setup-summary-value';

  const chevron = document.createElement('span');
  chevron.className = 'landing-setup-summary-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';

  button.append(title, value, chevron);

  const panel = document.createElement('div');
  panel.id = `landing-setup-panel-${id}`;
  panel.className = 'landing-setup-accordion-panel';
  panel.hidden = true;
  panel.append(content);

  wrapper.append(button, panel);
  return { button, content, id, panel, value, valueText, wrapper };
}

function selectedRoomSetup(
  gameSpecId: LandingGameSpecId,
  startFormat: LandingStartFormat,
  rated: boolean,
  presetId: LandingTimePresetId,
  preferredColor: LandingColorPreference,
): LandingRoomSetup {
  const preset =
    LANDING_TIME_PRESETS.find((candidate) => candidate.id === presetId) ?? LANDING_TIME_PRESETS[1];
  return {
    gameSpecId,
    startFormat,
    rated,
    timeControl: {
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
    },
    preferredColor,
  };
}

function startOptionButton(label: string, selected: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-start-option${selected ? ' selected' : ''}`;
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', selected ? 'true' : 'false');
  updateStartOptionButtonLabel(button, label);
  return button;
}

function updateStartOptionButtonLabel(button: HTMLButtonElement, label: string): void {
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

async function createRoomFromPlay(
  button: HTMLButtonElement,
  mode: 'pvp' | 'pve',
  engineId?: string,
  setup: LandingRoomSetup = {
    gameSpecId: DARK_CHESS_SPEC_ID,
    startFormat: 'standard',
    rated: true,
    timeControl: { initialMs: 30_000, incrementMs: 2_000 },
    preferredColor: 'random',
  },
  status?: HTMLElement,
  locale: Locale = currentLocale(),
): Promise<void> {
  const label = button.querySelector<HTMLElement>('.landing-play-action-label');
  const originalText = label?.textContent ?? button.textContent ?? '';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  setButtonLabel(button, t('setup.creating', {}, locale));
  if (status) {
    status.hidden = false;
    status.textContent = mode === 'pve' ? t('setup.checkingEngineSeats', {}, locale) : '';
  }
  try {
    while (true) {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(roomCreationRequestBody(mode, setup, engineId)),
      });
      if (status && !status.isConnected) return;
      if (response.ok) {
        const data = (await response.json()) as { url?: string };
        if (!data.url) throw new Error('room creation did not return a URL');
        if (status && !status.isConnected) return;
        roomNavigator(data.url);
        return;
      }
      const failure = await readRoomCreationFailure(response);
      if (mode === 'pve' && failure.error === 'engine_busy' && status?.isConnected) {
        status.textContent = t('setup.engineSeatsActive', {}, locale);
        setButtonLabel(button, t('setup.waitingForSeat', {}, locale));
        await sleep(ENGINE_SEAT_RETRY_MS);
        if (status.isConnected) continue;
        return;
      }
      throw roomCreationError(response.status, failure);
    }
  } catch (err) {
    console.warn(err);
    if (status?.isConnected) {
      status.textContent = roomCreationStatusText(err, mode);
    }
    setButtonLabel(button, t('setup.tryAgain', {}, locale));
    button.disabled = false;
    button.removeAttribute('aria-busy');
    window.setTimeout(() => {
      if (button.disabled) return;
      setButtonLabel(button, originalText);
    }, 1800);
  }
}

export function roomCreationRequestBody(
  mode: 'pvp' | 'pve',
  setup: LandingRoomSetup,
  engineId?: string,
): Record<string, unknown> {
  const gameSpecId = roomCreationGameSpecId(setup);
  if (setup.gameSpecId === CROSSROADS_CHESS_SPEC_ID) {
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor: setup.preferredColor === 'red' ? 'black' : setup.preferredColor,
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === JUNGLE_SPEC_ID) {
    // Jungle is perfect-info red/black Dou Shou Qi; PvP + in-process PvE bot,
    // casual-only. PvE sends the picked Misty Jungle engine id.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === JUNGLE_FLIP_SPEC_ID) {
    // Flip Jungle is symmetric hidden-identity 4×4 flip animal chess; move-order
    // seats (ink binds on the first flip), casual-only. PvP + in-process-spawned
    // PvE bot (MistyJungleFlip); PvE sends the picked engine id.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === JIEQI_SPEC_ID) {
    // Jieqi PvE sends the picked engine id (unlike DMX, which defaults it
    // server-side); colors are xiangqi red/black, never rated.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === BANQI_SPEC_ID) {
    // Banqi PvE sends the picked MistyBanqi id; seats are red/black move-order
    // (ink binds on the first flip), never rated.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === DROP_MINI_XIANGQI_SPEC_ID) {
    // Drop Mini Xiangqi is open-info red/black mini xiangqi with reserves.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      ...(mode === 'pvp' ? { rated: setup.rated } : {}),
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === FORTRESS_XIANGQI_SPEC_ID) {
    // Fortress Xiangqi is open-info red/black 7x8 xiangqi with reserves + the
    // Treasure. Rating-ready (rated flag off until launch); PvE sends the picked
    // Fairy-Stockfish engine id.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      ...(mode === 'pvp' ? { rated: setup.rated } : {}),
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === MINI_XIANGQI_SPEC_ID) {
    // Mini Xiangqi is open-info red/black mini xiangqi without drops, casual-only
    // for now. PvE plays via Fairy-Stockfish's native minixiangqi variant.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
      ...(mode === 'pve' && engineId ? { engineId } : {}),
    };
  }
  if (setup.gameSpecId === REVEAL_CHESS_SPEC_ID) {
    // Reveal Chess is PvP-only and casual-only (rated not launched); colors are
    // standard chess white/black, with no draft960 / start-format axis.
    return {
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor: setup.preferredColor,
    };
  }
  if (setup.gameSpecId === DARK_CROSSROADS_CHESS_SPEC_ID) {
    // Dark Crossroads is PvP-only and casual-only (no engine — Fairy-Stockfish is
    // perfect-info — and rated not launched); colors are the variant's own
    // white/red, passed straight through (the picker normalizes 'black' -> 'red').
    return {
      mode: 'pvp',
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor: setup.preferredColor === 'black' ? 'red' : setup.preferredColor,
    };
  }
  if (setup.gameSpecId === DARK_SHOGI_SPEC_ID) {
    // Dark Shogi is PvP-only and casual-only (no bot yet, rated not launched).
    // Shogi colors are black (sente) / white (gote), passed straight through.
    return {
      mode: 'pvp',
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'black' || setup.preferredColor === 'white'
          ? setup.preferredColor
          : 'random',
    };
  }
  if (setup.gameSpecId === DARK_CRAZYHOUSE_SPEC_ID) {
    // Dark Crazyhouse is PvP-only and casual-only (no bot yet, rated not
    // launched); standard chess white/black, passed straight through.
    return {
      mode: 'pvp',
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'white' || setup.preferredColor === 'black'
          ? setup.preferredColor
          : 'random',
    };
  }
  if (setup.gameSpecId === KRIEGSPIEL_SPEC_ID) {
    // Kriegspiel is PvP-only from setup (no bot yet; rated rooms are not exposed
    // here); standard chess white/black, passed straight through.
    return {
      mode: 'pvp',
      gameSpecId,
      timeControl: setup.timeControl,
      rated: false,
      preferredColor:
        setup.preferredColor === 'white' || setup.preferredColor === 'black'
          ? setup.preferredColor
          : 'random',
    };
  }
  if (setup.gameSpecId === DARK_XIANGQI_SPEC_ID || setup.gameSpecId === DARK_MINI_XIANGQI_SPEC_ID) {
    return {
      // Xiangqi fog engines are defaulted server-side, so no engine id is sent.
      mode,
      gameSpecId,
      timeControl: setup.timeControl,
      ...(mode === 'pvp' ? { rated: setup.rated } : {}),
      preferredColor:
        setup.preferredColor === 'white'
          ? 'red'
          : setup.preferredColor === 'red' || setup.preferredColor === 'black'
            ? setup.preferredColor
            : 'random',
    };
  }
  return {
    mode,
    gameSpecId,
    hiddenDraft960: setup.startFormat === 'draft960',
    timeControl: setup.timeControl,
    rated: setup.rated,
    preferredColor: setup.preferredColor,
    ...(mode === 'pve' && engineId ? { engineId } : {}),
  };
}

export function roomCreationGameSpecId(
  setup: LandingRoomSetup,
):
  | typeof DARK_CHESS_SPEC_ID
  | typeof DARK_DRAFT960_SPEC_ID
  | typeof MINI_XIANGQI_SPEC_ID
  | typeof DARK_MINI_XIANGQI_SPEC_ID
  | typeof DROP_MINI_XIANGQI_SPEC_ID
  | typeof DARK_XIANGQI_SPEC_ID
  | typeof CROSSROADS_CHESS_SPEC_ID
  | typeof DARK_CROSSROADS_CHESS_SPEC_ID
  | typeof DARK_SHOGI_SPEC_ID
  | typeof DARK_CRAZYHOUSE_SPEC_ID
  | typeof KRIEGSPIEL_SPEC_ID
  | typeof JIEQI_SPEC_ID
  | typeof BANQI_SPEC_ID
  | typeof REVEAL_CHESS_SPEC_ID
  | typeof JUNGLE_SPEC_ID
  | typeof JUNGLE_FLIP_SPEC_ID
  | typeof FORTRESS_XIANGQI_SPEC_ID
  | typeof XIANGQI_SPEC_ID {
  if (setup.gameSpecId === XIANGQI_SPEC_ID) return XIANGQI_SPEC_ID;
  if (setup.gameSpecId === FORTRESS_XIANGQI_SPEC_ID) return FORTRESS_XIANGQI_SPEC_ID;
  if (setup.gameSpecId === JUNGLE_SPEC_ID) return JUNGLE_SPEC_ID;
  if (setup.gameSpecId === JUNGLE_FLIP_SPEC_ID) return JUNGLE_FLIP_SPEC_ID;
  if (setup.gameSpecId === JIEQI_SPEC_ID) return JIEQI_SPEC_ID;
  if (setup.gameSpecId === BANQI_SPEC_ID) return BANQI_SPEC_ID;
  if (setup.gameSpecId === MINI_XIANGQI_SPEC_ID) return MINI_XIANGQI_SPEC_ID;
  if (setup.gameSpecId === DROP_MINI_XIANGQI_SPEC_ID) return DROP_MINI_XIANGQI_SPEC_ID;
  if (setup.gameSpecId === REVEAL_CHESS_SPEC_ID) return REVEAL_CHESS_SPEC_ID;
  if (setup.gameSpecId === CROSSROADS_CHESS_SPEC_ID) return CROSSROADS_CHESS_SPEC_ID;
  if (setup.gameSpecId === DARK_CROSSROADS_CHESS_SPEC_ID) return DARK_CROSSROADS_CHESS_SPEC_ID;
  if (setup.gameSpecId === DARK_SHOGI_SPEC_ID) return DARK_SHOGI_SPEC_ID;
  if (setup.gameSpecId === DARK_CRAZYHOUSE_SPEC_ID) return DARK_CRAZYHOUSE_SPEC_ID;
  if (setup.gameSpecId === KRIEGSPIEL_SPEC_ID) return KRIEGSPIEL_SPEC_ID;
  if (setup.gameSpecId === DARK_MINI_XIANGQI_SPEC_ID) return DARK_MINI_XIANGQI_SPEC_ID;
  if (setup.gameSpecId === DARK_XIANGQI_SPEC_ID) return DARK_XIANGQI_SPEC_ID;
  return setup.startFormat === 'draft960' ? DARK_DRAFT960_SPEC_ID : DARK_CHESS_SPEC_ID;
}

async function readRoomCreationFailure(response: Response): Promise<RoomCreationFailure> {
  try {
    return (await response.json()) as RoomCreationFailure;
  } catch {
    return {};
  }
}

function roomCreationError(status: number, failure: RoomCreationFailure): Error {
  const err = new Error(`room creation failed: ${status}`);
  err.name = failure.error ?? 'room_creation_failed';
  return err;
}

function roomCreationStatusText(err: unknown, mode: 'pvp' | 'pve'): string {
  if (err instanceof Error && err.name === 'crossroads_chess_disabled') {
    return 'Crossroads Chess live rooms are not enabled on this server.';
  }
  if (err instanceof Error && err.name === 'crossroads_chess_unsupported_surface') {
    return 'Crossroads Chess rooms are only available for casual friend games.';
  }
  if (err instanceof Error && err.name === 'drop_mini_xiangqi_unsupported_surface') {
    return 'Drop Mini Xiangqi engine games are casual only.';
  }
  if (err instanceof Error && err.name === 'invalid_time_control') {
    return 'That time control is not available. Try another one.';
  }
  if (err instanceof Error && err.name === 'persistence_disabled') {
    return 'Room storage is not available on this server.';
  }
  if (mode === 'pve' && err instanceof Error && err.name === 'engine_unavailable') {
    return 'The engine service is unavailable. Try again soon.';
  }
  if (mode === 'pve') return 'Could not start an engine game. Try again.';
  return 'Could not create the room. Try again.';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function joinLobbyFromPlay(
  button: HTMLButtonElement,
  setup: LandingRoomSetup,
  status: HTMLElement,
  locale: Locale = currentLocale(),
  engineId?: string,
  opts?: {
    /** Fail fast instead of queueing: when the join POST does not match
     *  instantly (the offer was taken in the refresh window), delete the
     *  freshly-created ticket and hand control back to the caller. */
    onNoInstantMatch?: () => void;
  },
): () => void {
  const controller = new AbortController();
  const originalText = button.textContent ?? '';
  const queueJoinedAt = Date.now();
  const bucketProps = {
    variant: setup.startFormat,
    // Chess keeps the legacy resolver (so draft960 stays tagged dark-draft960);
    // other variants resolve straight from their spec id.
    ...(setup.gameSpecId === DARK_CHESS_SPEC_ID
      ? gameSpecAnalyticsProps({
          variant: DARK_CHESS_SPEC_ID,
          hiddenDraft960: setup.startFormat === 'draft960',
        })
      : gameSpecAnalyticsPropsForId(setup.gameSpecId)),
    initialMs: setup.timeControl.initialMs,
    incrementMs: setup.timeControl.incrementMs,
    time_class: classifyTimeControl(setup.timeControl.initialMs, setup.timeControl.incrementMs),
    rated: setup.rated,
  };
  let active = true;
  let ticketId: string | null = null;
  let pollTimer: number | null = null;
  let offerTimer: number | null = null;
  let offerEl: HTMLElement | null = null;

  const clearOfferTimer = () => {
    if (offerTimer !== null) {
      window.clearTimeout(offerTimer);
      offerTimer = null;
    }
  };

  const removeOffer = () => {
    offerEl?.remove();
    offerEl = null;
    status.hidden = false;
  };

  const cancel = () => {
    active = false;
    controller.abort();
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    clearOfferTimer();
    if (ticketId) {
      void fetch(`/api/lobby/${encodeURIComponent(ticketId)}`, { method: 'DELETE' }).catch(
        () => {},
      );
    }
  };

  // The seek's pace is a HUMAN pace; the bot the offer starts may not be able to
  // honor it (pveTimePresetPin). Re-pace the room here rather than let the offer
  // become the back door that reintroduces the flag — the seek itself keeps
  // waiting at whatever pace the player picked.
  const enginePreset = pveTimePresetPin(setup.gameSpecId);
  const engineTimeControl = enginePreset
    ? LANDING_TIME_PRESETS.find((preset) => preset.id === enginePreset)
    : undefined;
  const engineSetup: LandingRoomSetup =
    engineTimeControl &&
    (engineTimeControl.initialMs !== setup.timeControl.initialMs ||
      engineTimeControl.incrementMs !== setup.timeControl.incrementMs)
      ? {
          ...setup,
          timeControl: {
            initialMs: engineTimeControl.initialMs,
            incrementMs: engineTimeControl.incrementMs,
          },
        }
      : setup;
  const engineRepaced = engineSetup !== setup;

  const acceptEngineOffer = (playButton: HTMLButtonElement) => {
    if (!engineId) return;
    track('lobby_engine_offer_accepted', { ...bucketProps, waitMs: Date.now() - queueJoinedAt });
    cancel();
    void createRoomFromPlay(playButton, 'pve', engineId, engineSetup, status, locale);
  };

  const dismissEngineOffer = () => {
    track('lobby_engine_offer_dismissed', { ...bucketProps, waitMs: Date.now() - queueJoinedAt });
    removeOffer();
    scheduleEngineOffer();
  };

  const showEngineOffer = () => {
    if (!engineId || offerEl !== null || !status.isConnected) return;
    status.hidden = true;
    track('lobby_engine_offer_shown', { ...bucketProps, waitMs: Date.now() - queueJoinedAt });

    const block = document.createElement('div');
    block.className = 'landing-engine-offer';

    const prompt = document.createElement('p');
    prompt.className = 'landing-engine-offer-prompt';
    prompt.textContent = t('setup.noOpponentsEngineOffer', {}, locale);

    const actions = document.createElement('div');
    actions.className = 'landing-engine-offer-actions';

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'landing-setup-start';
    // Name the pace when the bot game will not run at the pace being sought, so
    // the button never starts a clock the player did not agree to.
    play.textContent = engineRepaced
      ? `${t('play.playEngine', {}, locale)} (${engineTimeControl?.label.replace(/\s+/g, '') ?? ''})`
      : t('play.playEngine', {}, locale);
    play.addEventListener('click', () => acceptEngineOffer(play));

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'landing-setup-back';
    keep.textContent = t('setup.keepWaiting', {}, locale);
    keep.addEventListener('click', dismissEngineOffer);

    actions.append(play, keep);
    block.append(prompt, actions);
    status.insertAdjacentElement('afterend', block);
    offerEl = block;
  };

  const scheduleEngineOffer = () => {
    if (!engineId) return;
    clearOfferTimer();
    offerTimer = window.setTimeout(() => {
      offerTimer = null;
      if (
        shouldOfferEngine({
          elapsedMs: Date.now() - queueJoinedAt,
          thresholdMs: ENGINE_OFFER_AFTER_MS,
          stillWaiting: active && offerEl === null,
          hasEngine: Boolean(engineId),
        })
      ) {
        showEngineOffer();
      }
    }, ENGINE_OFFER_AFTER_MS);
  };

  const redirectIfMatched = (ticket: LobbyTicketResponse): boolean => {
    if (ticket.status !== 'matched' || !ticket.url) return false;
    track('lobby_match_found', { ...bucketProps, waitMs: Date.now() - queueJoinedAt });
    window.location.href = ticket.url;
    return true;
  };

  const handleLobbyError = (err: unknown) => {
    if (!active) return;
    console.warn(err);
    clearOfferTimer();
    removeOffer();
    button.disabled = false;
    button.removeAttribute('aria-busy');
    setButtonLabel(button, t('setup.tryAgain', {}, locale));
    status.textContent = t('setup.couldNotJoinLobby', {}, locale);
    window.setTimeout(() => {
      if (button.disabled) return;
      setButtonLabel(button, originalText);
    }, 1800);
  };

  const poll = async () => {
    if (!active || !ticketId) return;
    const response = await fetch(`/api/lobby/${encodeURIComponent(ticketId)}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`lobby poll failed: ${response.status}`);
    const ticket = (await response.json()) as LobbyTicketResponse;
    if (!active || redirectIfMatched(ticket)) return;
    pollTimer = window.setTimeout(() => {
      void poll().catch(handleLobbyError);
    }, ticket.pollAfterMs ?? 1_000);
  };

  const start = async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setButtonLabel(button, t('setup.waiting', {}, locale));
    status.textContent = t('setup.waitingForOpponent', {}, locale);
    const response = await fetch('/api/lobby', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        gameSpecId: setup.gameSpecId,
        hiddenDraft960: setup.startFormat === 'draft960',
        timeControl: setup.timeControl,
        rated: setup.rated,
      }),
    });
    if (!response.ok) throw new Error(`lobby join failed: ${response.status}`);
    const ticket = (await response.json()) as LobbyTicketResponse;
    track('lobby_queue_joined', bucketProps);
    if (!active || redirectIfMatched(ticket)) return;
    if (opts?.onNoInstantMatch) {
      // The joined offer was taken between the widget refresh and the click;
      // the POST silently created a NEW ticket. Don't leave the user in an
      // invisible queue: drop the ticket and let the caller revert the row.
      track('lobby_offer_already_taken', bucketProps);
      ticketId = ticket.ticketId ?? null;
      cancel();
      opts.onNoInstantMatch();
      return;
    }
    if (!ticket.ticketId) throw new Error('lobby did not return a ticket');
    ticketId = ticket.ticketId;
    pollTimer = window.setTimeout(() => {
      void poll().catch(handleLobbyError);
    }, ticket.pollAfterMs ?? 1_000);
    scheduleEngineOffer();
  };

  void start().catch(handleLobbyError);
  return cancel;
}

function setButtonLabel(button: HTMLButtonElement, text: string): void {
  const label = button.querySelector<HTMLElement>('.landing-play-action-label');
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
}
