import {
  canonicalVariantOrderIndex,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DAYS_PER_MOVE_OPTIONS,
  DEFAULT_DAYS_PER_MOVE,
  defaultEngineTimeControl,
  type GameSpecId,
  isPublicGameSpec,
  RATED_TIME_CONTROLS,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  TIME_CONTROLS,
  type TimeControlId,
} from '@mistboard/game';
import { track } from './analytics.js';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { type BotPlayRequest, bindBotPlayControl } from './bot-play.js';
import { correspondenceRatedAvailable, isCorrespondenceSpecFor } from './correspondence-model.js';
import { correspondenceEnabled, threeKingdomsBanqiEnabled } from './feature-flags.js';
import { ffqBanqiEngineOptions, setFFQBanqiEngineOptions } from './ffq-banqi-access.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import {
  type LandingBotRosterPlayOptions,
  type LandingBotRung,
  landingBotLadder,
  landingBotLadderIndex,
  landingBotOffer,
  playableBotIdsBySpec,
} from './landing-bot-policy.js';
import {
  allowedTimePresetIds,
  daysPerMoveLabel,
  enabledLandingVariantGameSpecs,
  fetchCorrespondenceSeeks,
  fetchOpenLobbyRequests,
  joinLobbyFromPlay,
  LANDING_TIME_PRESETS,
  type LandingGameSpecId,
  type LobbyCorrespondenceSeek,
  landingVariantSupportsPve,
  landingVariantSupportsRated,
  type OpenLobbyRequest,
  postCorrespondenceSeekFromPlay,
  variantLabelForGameSpec,
} from './landing-play.js';
import { type ProfileTarget, playerNameEl, profileTargetFor } from './profile-link.js';
import './landing-play-panel.css';
import { fetchLiveStats } from './live-stats-client.js';
import { type LastBotGame, lastBotGame, rememberedPveEngine } from './pve-memory.js';
import {
  isCorrespondenceRatedModeEnabled,
  isRatedModeEnabled,
  onRatedModeChange,
} from './rated-flag.js';
import { buildSeekAcceptAction } from './seek-accept.js';
import {
  isLikelySignedIn,
  isLikelyStatsExcluded,
  statsExcludedResolvedEvent,
} from './signed-in-state.js';
import {
  setThreeKingdomsBanqiEngineOptions,
  threeKingdomsBanqiEngineOptions,
} from './three-kingdoms-banqi-access.js';
import { renderVariantMarker } from './variant-markers.js';
import {
  type WebTenantEngineOption,
  webVariantOfferedInMenu,
  webVariantTenantForSpecId,
} from './variant-tenant/registry.js';
import { variantMiniIdForGameSpec } from './variants.js';

// The homepage's bot-first play panel (#491), replacing the lichess-shaped
// Lobby / Quick pairing / Correspondence tabs. At our liquidity almost every
// game is against a bot and the human pool rarely matches, so the default tab
// is one row per game that starts a bot game in one click, with the level and
// clock chosen inline. Humans get their own tab, and the rows that only exist
// when they are true (a player waiting, your last bot game) sit on top, so the
// panel turns into a lobby on its own as people arrive instead of showing an
// empty one now.

type PanelTab = 'computer' | 'person';
type PersonMode = 'casual' | 'rated';
type PersonPace = { kind: 'live'; id: TimeControlId } | { kind: 'days'; days: number };
type PaceFamily = PersonPace['kind'];

type StoredPanel = {
  tab?: PanelTab;
  mode?: PersonMode;
  bots?: Record<string, { botId?: string; tc?: TimeControlId }>;
  /** Live clocks or days per move, shared by every game in Play a person. */
  personFamily?: PaceFamily;
  /** The shared pace bar's pick (a `paceKey`), used while it is in the family. */
  personPace?: string;
  /** Earlier per-row picks (`people` before 2026-11-11, `personPicks` until
   *  the shared pace bar). Ignored, and dropped on the next write. */
  personPicks?: Record<string, string>;
  people?: Record<string, string>;
  /** Before 2026-10-24 the Play again record, written only by this panel's own
   *  Play button. Read as a fallback until a bot game writes the shared one. */
  last?: { gameSpecId: string; botId: string; tc: TimeControlId };
};

/** Short names for Play a person tiles whose full name does not fit one. */
const TILE_NAME_KEYS: Partial<Record<string, Parameters<typeof t>[0]>> = {
  'three-kingdoms-banqi': 'variant.threeKingdomsBanqi.tileName',
};

// Homepage merchandising only: these games remain in the Play menu, lobby
// and setup deep links. New launches join automatically unless excluded here.
export const HOMEPAGE_HERO_EXCLUDED_GAME_SPEC_IDS: readonly GameSpecId[] = [
  DARK_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
];

const STORAGE_KEY = 'mistboard.playPanel.v1';
const LOBBY_POLL_MS = 3_000;

function readStored(): StoredPanel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // Anything but an object (a stray `null`, an array, a number) reads as empty.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredPanel)
      : {};
  } catch {
    return {};
  }
}

function writeStored(patch: (state: StoredPanel) => void): void {
  try {
    const state = readStored();
    patch(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the panel still works, it just forgets the picks.
  }
}

/** The game the Play again row offers: the last bot game this device started
 *  anywhere on the site, at a pace the panel has a preset for; else the record
 *  the panel kept before every start path wrote the shared one. */
export function playAgainPick(
  shared: LastBotGame | null,
  legacy: StoredPanel['last'],
): { gameSpecId: string; botId: string; tc: TimeControlId } | null {
  if (!shared) return legacy ?? null;
  const tc = shared.timeControl;
  const preset = tc
    ? LANDING_TIME_PRESETS.find(
        (p) => p.initialMs === tc.initialMs && p.incrementMs === tc.incrementMs,
      )
    : undefined;
  if (!preset) return null;
  return { gameSpecId: shared.gameSpecId, botId: shared.botId, tc: preset.id };
}

function paceKey(pace: PersonPace): string {
  return pace.kind === 'live' ? pace.id : `${pace.days}d`;
}

/** Which of a row's paces it opens on: its own pick while that pick is in the
 *  panel's family, else the family's default (5+5 live, 3 days per move), else
 *  the other family's default for a row that cannot play the family (Xiangqi
 *  Mahjong has no days; rated has none while rated correspondence is held). */
export function personPaceIndex(
  paces: readonly PersonPace[],
  family: PaceFamily,
  pick: string | undefined,
): number {
  const picked = paces.findIndex((p) => p.kind === family && paceKey(p) === pick);
  if (picked >= 0) return picked;
  const day = paces.findIndex((p) => p.kind === 'days' && p.days === DEFAULT_DAYS_PER_MOVE);
  const live = paces.findIndex((p) => p.kind === 'live' && p.id === '5m5');
  const [first, second] = family === 'days' ? [day, live] : [live, day];
  if (first >= 0) return first;
  const anyInFamily = paces.findIndex((p) => p.kind === family);
  if (anyInFamily >= 0) return anyInFamily;
  return second >= 0 ? second : 0;
}

function compactLabel(id: TimeControlId): string {
  return TIME_CONTROLS.find((tc) => tc.id === id)?.label.replace(/\s+/g, '') ?? id;
}

function marker(gameSpecId: string, label: string): HTMLElement {
  const thumb = document.createElement('span');
  thumb.className = 'landing-lobby-seed-thumb pp-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  const miniId = variantMiniIdForGameSpec(gameSpecId as GameSpecId);
  if (miniId)
    thumb.innerHTML = renderVariantMarker(miniId, { size: 100, label: `${label} marker` });
  return thumb;
}

function button(className: string, text: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  return el;
}

/** A `‹ value ›` stepper. Arrows hide (keeping their space) when there is only
 *  one value, and disable at the ends. */
function stepper(opts: {
  className: string;
  count: number;
  index: number;
  render: (index: number) => { text: string; tag?: string; sub?: string; named?: boolean };
  onChange: (index: number) => void;
  prevLabel: string;
  nextLabel: string;
}): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `pp-step ${opts.className}`;
  if (opts.count <= 1) wrap.classList.add('is-fixed');
  const prev = button('pp-step-btn', '‹');
  prev.setAttribute('aria-label', opts.prevLabel);
  const next = button('pp-step-btn', '›');
  next.setAttribute('aria-label', opts.nextLabel);
  const value = document.createElement('span');
  value.className = 'pp-step-value';
  let index = opts.index;
  const paint = (): void => {
    const { text, tag, sub, named } = opts.render(index);
    const main = document.createElement('span');
    main.className = 'pp-step-main';
    main.textContent = text;
    value.replaceChildren(main);
    // The second line carries the level and the NNUE tag together, so the
    // engine name keeps the whole top line (Brian, 2026-10-03).
    if (sub || tag) {
      const meta = document.createElement('span');
      meta.className = 'pp-step-meta';
      if (sub) {
        const small = document.createElement('small');
        small.className = 'pp-step-sub';
        small.textContent = sub;
        meta.append(small);
      }
      if (tag) {
        const tagEl = document.createElement('span');
        tagEl.className = 'pp-step-tag';
        tagEl.textContent = tag;
        meta.append(tagEl);
      }
      value.append(meta);
    }
    value.classList.toggle('is-named', Boolean(named));
    prev.disabled = index <= 0;
    next.disabled = index >= opts.count - 1;
  };
  const move = (delta: number) => (event: Event) => {
    event.stopPropagation();
    const target = Math.min(opts.count - 1, Math.max(0, index + delta));
    if (target === index) return;
    index = target;
    paint();
    opts.onChange(index);
  };
  prev.addEventListener('click', move(-1));
  next.addEventListener('click', move(1));
  paint();
  wrap.append(prev, value, next);
  return wrap;
}

/** Game spec ids in the panel's row order: the canonical shelf order, the
 *  same as every other variant list. (Until 2026-10-02 the panel sorted by
 *  28-day play, which put every new launch last and kept it there; Brian moved
 *  it to the editorial order so Crazyhouse and Fortress sit side by side.) */
export function orderPanelSpecs(specs: readonly string[]): string[] {
  return [...specs].sort(
    (a, b) =>
      canonicalVariantOrderIndex(a as GameSpecId) - canonicalVariantOrderIndex(b as GameSpecId),
  );
}

/** Bot paces a variant can start, slowest last, plus its default. */
export function panelBotPaces(gameSpecId: LandingGameSpecId): {
  ids: TimeControlId[];
  defaultId: TimeControlId;
} {
  const allowed = allowedTimePresetIds(gameSpecId, false, 'pve');
  const ids = TIME_CONTROLS.filter((tc) => allowed.has(tc.id)).map((tc) => tc.id);
  const preferred = defaultEngineTimeControl(gameSpecId).id;
  return { ids, defaultId: ids.includes(preferred) ? preferred : (ids.at(-1) ?? preferred) };
}

/** Paces a person can be sought at: the live clocks (rated narrows them), then
 *  days per move for the correspondence variants: casual, or rated where the
 *  variant can be rated by correspondence (correspondenceRatedAvailable). A
 *  correspondence seek needs an account, so a signed-out visitor is offered
 *  the live clocks only. */
export function panelPersonPaces(
  gameSpecId: LandingGameSpecId,
  mode: PersonMode,
  signedIn: boolean,
): PersonPace[] {
  // A casual-only variant has no rated seek, so its row drops out of Rated
  // rather than offering a Find the lobby would refuse.
  if (mode === 'rated' && !landingVariantSupportsRated(gameSpecId)) return [];
  const allowed = allowedTimePresetIds(gameSpecId, mode === 'rated', 'lobby');
  const live: PersonPace[] = TIME_CONTROLS.filter((tc) => allowed.has(tc.id)).map((tc) => ({
    kind: 'live',
    id: tc.id,
  }));
  const days: PersonPace[] =
    signedIn &&
    (mode === 'casual' ||
      correspondenceRatedAvailable(gameSpecId, isCorrespondenceRatedModeEnabled())) &&
    correspondenceEnabled() &&
    isCorrespondenceSpecFor(gameSpecId, webVariantOfferedInMenu)
      ? DAYS_PER_MOVE_OPTIONS.map((d) => ({ kind: 'days', days: d }))
      : [];
  return [...live, ...days];
}

/** Every pace the shared bar can offer for one family: the union of the
 *  games' paces, fastest first. */
export function personFamilyPaces(
  specs: readonly LandingGameSpecId[],
  family: PaceFamily,
  mode: PersonMode,
  signedIn: boolean,
): PersonPace[] {
  const seen = new Map<string, PersonPace>();
  for (const gameSpecId of specs)
    for (const pace of panelPersonPaces(gameSpecId, mode, signedIn))
      if (pace.kind === family && !seen.has(paceKey(pace))) seen.set(paceKey(pace), pace);
  const order = (pace: PersonPace): number =>
    pace.kind === 'live' ? TIME_CONTROLS.findIndex((tc) => tc.id === pace.id) : pace.days;
  return [...seen.values()].sort((a, b) => order(a) - order(b));
}

export function buildPlayPanel(
  locale: Locale = currentLocale(),
  options: { hydrate?: boolean } = {},
): HTMLElement {
  const stored = readStored();
  const signedIn = isLikelySignedIn();
  let ratedAvailable = isRatedModeEnabled();
  // An account excluded from stats never plays rated (the server refuses it);
  // the Rated switch is greyed out with the reason instead of failing on click.
  let ratedBlocked = isLikelyStatsExcluded();
  let tab: PanelTab = stored.tab ?? 'computer';
  let mode: PersonMode =
    stored.mode === 'rated' && signedIn && ratedAvailable && !ratedBlocked ? 'rated' : 'casual';
  let openRequests: OpenLobbyRequest[] = [];
  let corrSeeks: LobbyCorrespondenceSeek[] = [];
  let playingBySpec: Record<string, number> = {};
  let searching: (() => void) | null = null;
  // The seek this tab is sitting in. The open-seek feed lists it anonymously
  // like anyone else's, so without this the panel offers you your own game.
  let ownSeek: {
    gameSpecId: string;
    initialMs: number;
    incrementMs: number;
    rated: boolean;
  } | null = null;
  const othersRequests = (): OpenLobbyRequest[] => {
    const offered = openRequests.filter((r) =>
      variants.some((v) => v.gameSpecId === (r.gameSpecId ?? DARK_CHESS_SPEC_ID)),
    );
    if (!ownSeek) return offered;
    const own = ownSeek;
    let skipped = false;
    return offered.filter((r) => {
      const mine =
        !skipped &&
        (r.gameSpecId ?? 'dark-chess') === own.gameSpecId &&
        r.timeControl.initialMs === own.initialMs &&
        r.timeControl.incrementMs === own.incrementMs &&
        (r.rated ?? true) === own.rated;
      if (mine) skipped = true;
      return !mine;
    });
  };

  const variants = enabledLandingVariantGameSpecs('pvp', locale).filter(
    ({ gameSpecId }) =>
      isPublicGameSpec(gameSpecId) && !HOMEPAGE_HERO_EXCLUDED_GAME_SPEC_IDS.includes(gameSpecId),
  );
  const labelFor = (id: string): string =>
    variants.find((v) => v.gameSpecId === id)?.label ??
    variantLabelForGameSpec(id as LandingGameSpecId, locale);
  const ordered = (): LandingGameSpecId[] =>
    orderPanelSpecs(variants.map((v) => v.gameSpecId)) as LandingGameSpecId[];

  const board = document.createElement('section');
  board.className = 'landing-lobby-board pp-board';
  board.setAttribute('aria-label', t('play.startPlaying', {}, locale));

  // ── Tabs ──
  const tabBar = document.createElement('div');
  tabBar.className = 'pp-tabs';
  tabBar.setAttribute('role', 'tablist');
  const computerTab = button('pp-tab', t('lobby.panelTabComputer', {}, locale));
  const personTab = button('pp-tab', t('lobby.panelTabPerson', {}, locale));
  const badge = document.createElement('span');
  badge.className = 'pp-badge';
  badge.hidden = true;
  personTab.append(badge);
  for (const el of [computerTab, personTab]) el.setAttribute('role', 'tab');
  tabBar.append(computerTab, personTab);

  const card = document.createElement('div');
  card.className = 'landing-lobby-card pp-card';
  const computerView = document.createElement('div');
  computerView.className = 'pp-view pp-view-computer';
  computerView.setAttribute('role', 'tabpanel');
  const personView = document.createElement('div');
  personView.className = 'pp-view pp-view-person';
  personView.setAttribute('role', 'tabpanel');
  card.append(computerView, personView);
  board.append(tabBar, card);

  const selectTab = (next: PanelTab, user: boolean): void => {
    tab = next;
    computerTab.classList.toggle('is-active', next === 'computer');
    personTab.classList.toggle('is-active', next === 'person');
    computerTab.setAttribute('aria-selected', String(next === 'computer'));
    personTab.setAttribute('aria-selected', String(next === 'person'));
    // The computer view is covered, not hidden: it stays in flow so the person
    // tab gets its exact height (the site's [hidden] rule is display:none
    // !important). inert keeps the covered rows out of focus and the a11y tree.
    computerView.classList.toggle('is-covered', next !== 'computer');
    computerView.inert = next !== 'computer';
    personView.hidden = next !== 'person';
    if (user) {
      writeStored((s) => {
        s.tab = next;
      });
      track('play_panel_tab', { tab: next });
    }
  };
  computerTab.addEventListener('click', () => selectTab('computer', true));
  personTab.addEventListener('click', () => selectTab('person', true));

  // ── Play the computer ──
  const featureSlot = document.createElement('div');
  featureSlot.className = 'pp-features';
  const botRows = document.createElement('div');
  botRows.className = 'pp-scroll';
  computerView.append(featureSlot, botRows);

  const botState = new Map<
    string,
    { ladder: readonly LandingBotRung[]; at: number; tc: TimeControlId }
  >();
  const playingEls = new Map<string, HTMLElement>();
  // What GET /api/bots says each variant can seat; gated rungs (KataGo) wait for
  // it, so a box without the engine never offers a bot that cannot move.
  let playableBots = new Map<string, ReadonlySet<string>>();
  let playableEngines: ReadonlySet<string> = new Set();
  // Public TK must paint without waiting for the network, including in the
  // prerender. Levels 1-7 need no net; an explicit live list replaces this
  // fallback (even when empty), while a missing list or failed fetch keeps it.
  let threeKingdomsBanqiEngineIds: ReadonlySet<string> = new Set(
    threeKingdomsBanqiEngineOptions()?.map((engine) => engine.id) ??
      (threeKingdomsBanqiEnabled()
        ? Array.from({ length: 7 }, (_, i) => `misty-three-kingdoms-banqi-level-${i + 1}`)
        : []),
  );
  const ladderFor = (gameSpecId: string): readonly LandingBotRung[] =>
    landingBotLadder(
      gameSpecId,
      playableBots.get(gameSpecId),
      gameSpecId === THREE_KINGDOMS_BANQI_SPEC_ID
        ? threeKingdomsBanqiEngineIds
        : new Set([
            ...playableEngines,
            ...(ffqBanqiEngineOptions() ?? []).map((engine) => engine.id),
          ]),
    );
  const sameLadder = (a: readonly LandingBotRung[], b: readonly LandingBotRung[]): boolean =>
    a.length === b.length &&
    a.every((rung, i) => rung.botId === b[i]?.botId && rung.engineId === b[i]?.engineId);

  const botRequest = (gameSpecId: string): BotPlayRequest => {
    const state = botState.get(gameSpecId)!;
    const preset = LANDING_TIME_PRESETS.find((p) => p.id === state.tc);
    return {
      ...state.ladder[state.at]!,
      gameSpecId,
      ...(preset
        ? { timeControl: { initialMs: preset.initialMs, incrementMs: preset.incrementMs } }
        : {}),
      preferredColor: 'random',
    };
  };
  const renderBotRows = (): void => {
    botRows.replaceChildren();
    playingEls.clear();
    for (const gameSpecId of ordered()) {
      if (gameSpecId !== THREE_KINGDOMS_BANQI_SPEC_ID && !landingVariantSupportsPve(gameSpecId))
        continue;
      const ladder = ladderFor(gameSpecId);
      if (ladder.length === 0) continue;
      const paces = panelBotPaces(gameSpecId);
      if (paces.ids.length === 0) continue;
      const label = labelFor(gameSpecId);
      let state = botState.get(gameSpecId);
      // A ladder that grew when the roster arrived re-resolves the pick from
      // what is stored now, so a remembered KataGo comes back once it is offered.
      if (!state || !sameLadder(state.ladder, ladder)) {
        const saved = state ? readStored().bots?.[gameSpecId] : stored.bots?.[gameSpecId];
        const fromPanel = landingBotLadderIndex(ladder, saved?.botId);
        const fromMemory = landingBotLadderIndex(ladder, rememberedPveEngine(gameSpecId));
        const setupDefault = ladder.some((rung) => rung.engineId)
          ? landingBotLadderIndex(
              ladder,
              webVariantTenantForSpecId(gameSpecId)?.landing?.defaultEngineId ??
                (gameSpecId === THREE_KINGDOMS_BANQI_SPEC_ID
                  ? 'misty-three-kingdoms-banqi-level-4'
                  : undefined),
            )
          : -1;
        const policy = landingBotLadderIndex(
          ladder,
          landingBotOffer(gameSpecId, {
            rememberedXiangqiBotId: rememberedPveEngine(gameSpecId),
            rememberedJieqiBotId: rememberedPveEngine(gameSpecId),
          })?.botId,
        );
        const at = [fromPanel, fromMemory, setupDefault, policy, 0].find((i) => i >= 0) ?? 0;
        const tc =
          state?.tc ?? (saved?.tc && paces.ids.includes(saved.tc) ? saved.tc : paces.defaultId);
        state = { ladder, at, tc };
        botState.set(gameSpecId, state);
      }
      const current = state;

      const row = document.createElement('div');
      row.className = 'pp-row pp-row-bot';
      row.dataset.gameSpec = gameSpecId;

      const name = document.createElement('span');
      name.className = 'pp-name';
      // The live count sits on its own line under the label: inline, a long
      // name (Crazyhouse Xiangqi) ellipsised it out of sight.
      const labelText = document.createElement('span');
      labelText.className = 'pp-name-label';
      labelText.textContent = label;
      name.append(labelText);
      const playing = document.createElement('em');
      playing.className = 'pp-playing';
      name.append(playing);
      playingEls.set(gameSpecId, playing);

      const save = (): void =>
        writeStored((s) => {
          s.bots ??= {};
          const rung = current.ladder[current.at]!;
          s.bots[gameSpecId] = { botId: rung.engineId ?? rung.botId, tc: current.tc };
        });
      const levelStep = stepper({
        className: 'pp-step-level',
        count: ladder.length,
        index: current.at,
        render: (i) => {
          const rung = ladder[i]!;
          // One grammar on every row (Brian, 2026-10-02): the top line is
          // always the engine; the second line is the level (only for an
          // engine that has levels) and a net tag on the rungs that play on
          // one (NNUE, or the general tag for KataGo's ResNet). Names stay
          // plain: gold in this panel means a person.
          const tag =
            rung.net === 'nnue'
              ? 'NNUE'
              : rung.net === 'neural'
                ? t('lobby.panelNeuralNet', {}, locale)
                : undefined;
          return rung.level === null
            ? { text: rung.name, ...(tag ? { tag } : {}) }
            : {
                text: rung.engine,
                ...(tag ? { tag } : {}),
                sub: t('lobby.panelLevel', { level: rung.level }, locale),
              };
        },
        onChange: (i) => {
          current.at = i;
          save();
        },
        prevLabel: t('lobby.panelEasier', {}, locale),
        nextLabel: t('lobby.panelHarder', {}, locale),
      });
      const clockStep = stepper({
        className: 'pp-step-clock',
        count: paces.ids.length,
        index: Math.max(0, paces.ids.indexOf(current.tc)),
        render: (i) => ({ text: compactLabel(paces.ids[i]!) }),
        onChange: (i) => {
          current.tc = paces.ids[i]!;
          save();
        },
        prevLabel: t('lobby.panelFaster', {}, locale),
        nextLabel: t('lobby.panelSlower', {}, locale),
      });

      const play = button('pp-act', `▶ ${t('lobby.panelPlay', {}, locale)}`);
      play.setAttribute('aria-label', `${t('play.playEngine', {}, locale)}: ${label}`);
      bindBotPlayControl(play, () => botRequest(gameSpecId), {
        pendingLabel: t('lobby.botStarting', {}, locale),
        errorLabel: t('lobby.botStartFailed', {}, locale),
        source: 'panel-bot',
      });
      // Only Play starts the game (Brian, 2026-10-02): a whole-row click turned
      // a near miss on a stepper into a game nobody asked for.

      row.append(marker(gameSpecId, label), name, levelStep, clockStep, play);
      botRows.append(row);
    }
    paintPlaying();
  };

  const paintPlaying = (): void => {
    for (const [gameSpecId, el] of playingEls) {
      const count = playingBySpec[gameSpecId] ?? 0;
      el.textContent = count > 0 ? t('lobby.panelPlayingCount', { count }, locale) : '';
    }
  };

  const featureRow = (opts: {
    kind: 'again' | 'waiting';
    gameSpecId: string;
    kicker: string;
    title: string;
    detail: string;
    action: HTMLButtonElement;
  }): HTMLElement => {
    const row = document.createElement('div');
    row.className = `pp-feature pp-feature-${opts.kind}`;
    const text = document.createElement('div');
    text.className = 'pp-feature-text';
    const kicker = document.createElement('span');
    kicker.className = 'pp-kicker';
    kicker.textContent = opts.kicker;
    const title = document.createElement('span');
    title.className = 'pp-feature-title';
    title.textContent = opts.title;
    const detail = document.createElement('small');
    detail.textContent = ` · ${opts.detail}`;
    title.append(detail);
    text.append(kicker, title);
    row.append(marker(opts.gameSpecId, labelFor(opts.gameSpecId)), text, opts.action);
    return row;
  };

  const visibleRequests = (): OpenLobbyRequest[] =>
    othersRequests().filter(
      (r) => r.rated === false || (signedIn && ratedAvailable && !ratedBlocked),
    );

  const renderFeatures = (): void => {
    const rows: HTMLElement[] = [];
    const last = playAgainPick(lastBotGame(), readStored().last);
    const lastLadder = last ? ladderFor(last.gameSpecId) : [];
    const lastRung = last ? lastLadder[landingBotLadderIndex(lastLadder, last.botId)] : undefined;
    const lastPaces = last ? panelBotPaces(last.gameSpecId as LandingGameSpecId).ids : [];
    if (
      last &&
      lastRung &&
      lastPaces.includes(last.tc) &&
      variants.some((v) => v.gameSpecId === last.gameSpecId)
    ) {
      const again = button('pp-act', `▶ ${t('lobby.panelPlay', {}, locale)}`);
      const preset = LANDING_TIME_PRESETS.find((p) => p.id === last.tc);
      bindBotPlayControl(
        again,
        () => ({
          ...lastRung,
          gameSpecId: last.gameSpecId,
          ...(preset
            ? { timeControl: { initialMs: preset.initialMs, incrementMs: preset.incrementMs } }
            : {}),
          preferredColor: 'random',
        }),
        {
          pendingLabel: t('lobby.botStarting', {}, locale),
          errorLabel: t('lobby.botStartFailed', {}, locale),
          source: 'panel-play-again',
        },
      );
      rows.push(
        featureRow({
          kind: 'again',
          gameSpecId: last.gameSpecId,
          kicker: t('lobby.panelPlayAgain', {}, locale),
          title: t(
            'lobby.panelVersus',
            { variant: labelFor(last.gameSpecId), opponent: lastRung.name },
            locale,
          ),
          detail: compactLabel(last.tc),
          action: again,
        }),
      );
    }
    const waiting = visibleRequests()[0];
    if (waiting) rows.push(waitingFeature(waiting));
    featureSlot.replaceChildren(...rows);
  };

  const joinRequest = (
    request: OpenLobbyRequest,
    join: HTMLButtonElement,
    source: 'panel-waiting' | 'panel-offer',
  ): void => {
    const status = document.createElement('span');
    joinLobbyFromPlay(
      join,
      {
        gameSpecId: (request.gameSpecId ?? 'dark-chess') as LandingGameSpecId,
        rated: request.rated ?? true,
        timeControl: request.timeControl,
        preferredColor: 'random',
      },
      status,
      locale,
      undefined,
      {
        startSource: source,
        onNoInstantMatch: () => {
          join.textContent = t('play.offerTaken', {}, locale);
          window.setTimeout(() => {
            join.disabled = false;
            join.textContent = t('play.join', {}, locale);
          }, 2_000);
        },
      },
    );
  };

  const waitingFeature = (request: OpenLobbyRequest): HTMLElement => {
    const gameSpecId = request.gameSpecId ?? 'dark-chess';
    const join = button('pp-act pp-act-join', t('play.join', {}, locale));
    join.addEventListener('click', () => joinRequest(request, join, 'panel-waiting'));
    const clock = formatClock(request.timeControl);
    const modeLabel =
      request.rated === false ? t('play.casual', {}, locale) : t('play.rated', {}, locale);
    return featureRow({
      kind: 'waiting',
      gameSpecId,
      kicker: t('lobby.panelPlayerWaiting', {}, locale),
      title: `${labelFor(gameSpecId)} · ${clock}`,
      detail: modeLabel,
      action: join,
    });
  };

  // ── Play a person ──
  const control = document.createElement('div');
  control.className = 'pp-control';
  const modeSwitch = document.createElement('span');
  modeSwitch.className = 'pp-mode';
  const casualBtn = button('pp-mode-btn', t('play.casual', {}, locale));
  const ratedBtn = button('pp-mode-btn', t('play.rated', {}, locale));
  modeSwitch.append(casualBtn, ratedBtn);
  const note = document.createElement('span');
  note.className = 'pp-note';
  const modeSlot = document.createElement('span');
  control.append(modeSlot, note);
  const renderModeSlot = (): void => {
    modeSlot.replaceChildren(...(ratedAvailable ? [modeSwitch] : []));
  };
  renderModeSlot();

  // One pace bar for the whole tab (2026-11-11): Live or Days per move and
  // one stepper, then the open games, then every variant as a tile that
  // starts a game at that pace. The tab fits its card without scrolling.
  const personScroll = document.createElement('div');
  personScroll.className = 'pp-scroll';
  const paceSlot = document.createElement('div');
  paceSlot.className = 'pp-pace';
  const offersSlot = document.createElement('div');
  const startHead = document.createElement('div');
  startHead.className = 'pp-section';
  startHead.textContent = t('lobby.panelStartOne', {}, locale);
  const personRows = document.createElement('div');
  personRows.className = 'pp-person-rows';
  personScroll.append(paceSlot, offersSlot, startHead, personRows);

  const searchBar = document.createElement('div');
  searchBar.className = 'pp-search';
  searchBar.hidden = true;
  const searchStatus = document.createElement('span');
  searchStatus.className = 'pp-search-status';
  const searchCancel = button('pp-search-cancel', t('setup.cancel', {}, locale));
  searchBar.append(searchStatus, searchCancel);
  personView.append(control, personScroll, searchBar);

  const endSearch = (): void => {
    searching = null;
    ownSeek = null;
    searchBar.querySelector('.landing-engine-offer')?.remove();
    searchBar.hidden = true;
    renderPersonRows();
  };
  const stopSearch = (): void => {
    void searching?.();
    endSearch();
  };
  searchCancel.addEventListener('click', stopSearch);

  // The shared pace (family plus one pick), mirrored in memory so the panel
  // keeps it when storage is blocked. Nothing stored: a signed-in player opens
  // on days per move (a seek waits for someone instead of timing out to a bot
  // offer), a visitor on live clocks, the only pace open to a guest.
  let personFamily: PaceFamily =
    stored.personFamily === 'live' || stored.personFamily === 'days'
      ? stored.personFamily
      : signedIn
        ? 'days'
        : 'live';
  let personPick: string | undefined =
    typeof stored.personPace === 'string' ? stored.personPace : undefined;
  const savePace = (): void =>
    writeStored((s) => {
      s.personFamily = personFamily;
      if (personPick) s.personPace = personPick;
      else delete s.personPace;
      delete s.personPicks;
      delete s.people;
    });

  const renderMode = (): void => {
    casualBtn.classList.toggle('is-active', mode === 'casual');
    ratedBtn.classList.toggle('is-active', mode === 'rated');
    ratedBtn.disabled = ratedBlocked;
    // Why Rated is out of reach, in plain words (Brian, 2026-10-27: "what does
    // that mean, need a counted account?"): a guest is told to sign in; a
    // stats-excluded account (the owner's and QA's) is told it plays casual only.
    const ratedBlockedNote = t('lobby.ratedCasualOnlyAccount', {}, locale);
    const ratedSignInNote = t('lobby.panelRatedSignIn', {}, locale);
    if (ratedBlocked) ratedBtn.title = ratedBlockedNote;
    else if (!signedIn) ratedBtn.title = ratedSignInNote;
    else ratedBtn.removeAttribute('title');
    note.textContent = !ratedAvailable
      ? ''
      : ratedBlocked
        ? ratedBlockedNote
        : !signedIn
          ? ratedSignInNote
          : mode === 'rated'
            ? [
                t(
                  'lobby.panelRatedNote',
                  { clocks: RATED_TIME_CONTROLS.map((tc) => compactLabel(tc.id)).join(', ') },
                  locale,
                ),
                // Days per move leave the tiles in Rated while rated
                // correspondence is held; say why instead of dropping them silently.
                ...(isCorrespondenceRatedModeEnabled()
                  ? []
                  : [t('lobby.panelRatedCorrespondenceCasual', {}, locale)]),
              ].join(locale === 'en' ? ' ' : '')
            : '';
  };
  casualBtn.addEventListener('click', () => {
    if (mode === 'casual') return;
    mode = 'casual';
    writeStored((s) => {
      s.mode = mode;
    });
    renderPerson();
  });
  ratedBtn.addEventListener('click', () => {
    if (ratedBlocked) return;
    if (!signedIn) {
      window.location.href = loginHrefForCurrentPage(locale);
      return;
    }
    if (mode === 'rated') return;
    mode = 'rated';
    writeStored((s) => {
      s.mode = mode;
    });
    renderPerson();
  });

  const waitingIn = (gameSpecId: string, pace: PersonPace): number =>
    othersRequests().filter(
      (r) =>
        (r.gameSpecId ?? 'dark-chess') === gameSpecId &&
        (mode === 'rated' ? r.rated !== false : r.rated === false) &&
        pace.kind === 'live' &&
        LANDING_TIME_PRESETS.some(
          (p) =>
            p.id === pace.id &&
            p.initialMs === r.timeControl.initialMs &&
            p.incrementMs === r.timeControl.incrementMs,
        ),
    ).length;

  // ── The shared pace ──
  const shared = (): { family: PaceFamily; list: PersonPace[]; pace: PersonPace | undefined } => {
    const own = personFamilyPaces(ordered(), personFamily, mode, signedIn);
    // A family no tile can play here (days signed out, or in Rated while rated
    // correspondence is held) shows the other one; the stored family stays.
    const family: PaceFamily =
      own.length > 0 ? personFamily : personFamily === 'live' ? 'days' : 'live';
    const list = own.length > 0 ? own : personFamilyPaces(ordered(), family, mode, signedIn);
    return { family, list, pace: list[personPaceIndex(list, family, personPick)] };
  };

  const renderPace = (): void => {
    const { family, list, pace } = shared();
    const toggle = document.createElement('span');
    toggle.className = 'pp-mode pp-pace-family';
    for (const kind of ['live', 'days'] as const) {
      const btn = button(
        'pp-pace-btn',
        t(kind === 'live' ? 'lobby.panelPaceLive' : 'lobby.panelPaceDays', {}, locale),
      );
      btn.dataset.family = kind;
      btn.classList.toggle('is-active', family === kind);
      btn.setAttribute('aria-pressed', String(family === kind));
      if (personFamilyPaces(ordered(), kind, mode, signedIn).length === 0) {
        btn.disabled = true;
        btn.title = !signedIn
          ? t('lobby.panelDaysSignIn', {}, locale)
          : t('lobby.panelRatedCorrespondenceCasual', {}, locale);
      }
      btn.addEventListener('click', () => {
        if (family === kind) return;
        personFamily = kind;
        personPick = undefined;
        savePace();
        stopSearchForPace();
        renderPace();
        renderPersonRows();
        paceSlot.querySelector<HTMLButtonElement>(`[data-family="${kind}"]`)?.focus({
          preventScroll: true,
        });
      });
      toggle.append(btn);
    }
    const step = stepper({
      className: 'pp-step-clock',
      count: list.length,
      index: pace ? list.indexOf(pace) : 0,
      render: (i) => ({ text: paceLabel(list[i]!), named: list[i]!.kind === 'days' }),
      onChange: (i) => {
        personPick = paceKey(list[i]!);
        savePace();
        stopSearchForPace();
        renderPersonRows();
      },
      prevLabel: t('lobby.panelFaster', {}, locale),
      nextLabel: t('lobby.panelSlower', {}, locale),
    });
    const parts: HTMLElement[] = [toggle, step];
    if (!signedIn) {
      const hint = document.createElement('a');
      hint.className = 'pp-pace-hint';
      hint.href = loginHrefForCurrentPage(locale);
      hint.textContent = t('lobby.panelDaysSignIn', {}, locale);
      parts.push(hint);
    }
    paceSlot.replaceChildren(...parts);
  };

  // A new pace withdraws a live search or clears a failed post, so every tile
  // offers the pace now shown.
  const stopSearchForPace = (): void => {
    if (searching) stopSearch();
  };

  const paceLabel = (pace: PersonPace): string =>
    pace.kind === 'live' ? compactLabel(pace.id) : daysPerMoveLabel(pace.days, locale);
  const paceShort = (pace: PersonPace): string =>
    pace.kind === 'live'
      ? compactLabel(pace.id)
      : t('lobby.panelDaysShort', { days: pace.days }, locale);

  // ── Open games ──
  const OFFER_CAP = 4;
  const renderOffers = (): void => {
    const chips: HTMLElement[] = [];
    for (const request of othersRequests()) {
      if (mode === 'rated' ? request.rated === false : request.rated !== false) continue;
      const gameSpecId = request.gameSpecId ?? 'dark-chess';
      const join = button('pp-act pp-act-join', t('play.join', {}, locale));
      join.addEventListener('click', () => joinRequest(request, join, 'panel-offer'));
      chips.push(
        offerChip(
          gameSpecId,
          t('lobby.panelAnonymous', {}, locale),
          formatClock(request.timeControl),
          join,
        ),
      );
    }
    // Each mode lists the correspondence seeks of its own kind, like the live offers.
    for (const seek of corrSeeks.filter((s) => (s.rated === true) === (mode === 'rated'))) {
      let action: HTMLElement;
      if (seek.isMine) {
        action = document.createElement('span');
        action.className = 'pp-yours';
        action.textContent = t('lobby.panelYours', {}, locale);
      } else {
        // Join accepts in place and lands in the room, like the live offers
        // above (seek-accept.ts); signed out it signs in first.
        action = buildSeekAcceptAction({
          className: 'pp-act pp-act-join',
          label: t('play.join', {}, locale),
          locale,
          seek,
          signedIn,
          surface: 'home-panel',
        });
      }
      chips.push(
        offerChip(
          seek.gameSpecId,
          seek.creatorName ?? t('lobby.panelAnonymous', {}, locale),
          t('lobby.panelDaysShort', { days: seek.daysPerMove }, locale),
          action,
          true,
          profileTargetFor({ handle: seek.creatorHandle }),
        ),
      );
    }
    if (chips.length === 0) {
      offersSlot.replaceChildren();
      return;
    }
    const head = document.createElement('div');
    head.className = 'pp-section';
    head.textContent = `${t('lobby.panelOpenGames', {}, locale)} · ${chips.length}`;
    const grid = document.createElement('div');
    grid.className = 'pp-offers';
    // Past four, three games and a link to the rest, so the tiles keep the fold.
    const shown = chips.length > OFFER_CAP ? OFFER_CAP - 1 : OFFER_CAP;
    grid.append(...chips.slice(0, shown));
    if (chips.length > shown) {
      const more = document.createElement('a');
      more.className = 'pp-offers-more';
      more.href = localizedHref('/correspondence', locale);
      more.textContent = t('lobby.panelMoreGames', { count: chips.length - shown }, locale);
      grid.append(more);
    }
    offersSlot.replaceChildren(head, grid);
  };

  const offerChip = (
    gameSpecId: string,
    who: string,
    pace: string,
    action: HTMLElement,
    slow = false,
    // A correspondence seek's creator profile; live offers are anonymous.
    whoTarget: ProfileTarget | null = null,
  ): HTMLElement => {
    const chip = document.createElement('div');
    chip.className = 'pp-offer';
    chip.dataset.gameSpec = gameSpecId;
    const label = labelFor(gameSpecId);
    const text = document.createElement('span');
    text.className = 'pp-tile-text';
    const name = document.createElement('span');
    name.className = 'pp-name';
    name.textContent = label;
    const meta = document.createElement('small');
    meta.className = 'pp-tile-meta';
    const paceEl = document.createElement('span');
    paceEl.className = `pp-offer-pace${slow ? ' is-slow' : ''}`;
    paceEl.textContent = pace;
    meta.append(paceEl, ' · ', playerNameEl(who, whoTarget, 'pp-offer-who'));
    text.append(name, meta);
    chip.append(marker(gameSpecId, label), text, action);
    return chip;
  };

  // ── Start one ──
  /** The pace a tile starts at: the shared one where the game has it, else
   *  the game's nearest default, named on the tile. */
  const tilePace = (
    gameSpecId: LandingGameSpecId,
  ): { pace: PersonPace; note: string | null } | null => {
    const paces = panelPersonPaces(gameSpecId, mode, signedIn);
    if (paces.length === 0) return null;
    const { family, pace: sharedPace } = shared();
    const key = sharedPace ? paceKey(sharedPace) : personPick;
    const pace = paces[personPaceIndex(paces, family, key)]!;
    if (sharedPace && paceKey(pace) === paceKey(sharedPace)) return { pace, note: null };
    const note =
      pace.kind === family
        ? t('lobby.panelPaceInstead', { pace: paceShort(pace) }, locale)
        : t('lobby.panelPaceOnly', { pace: paceShort(pace) }, locale);
    return { pace, note };
  };

  const startPerson = (gameSpecId: LandingGameSpecId, pace: PersonPace, act: HTMLButtonElement) => {
    if (pace.kind === 'days') {
      // Post the seek straight away at this game and pace, casual (or rated
      // where that is on), colour by lot; no setup dialog. The helper lands on
      // /correspondence, where the seek is listed. A failure (no account, the
      // seek limit) shows in the search bar.
      searching?.();
      searchBar.querySelector('.landing-engine-offer')?.remove();
      searchStatus.replaceChildren();
      searchBar.hidden = true;
      // Holds the tiles still (the 3 s refresh redraws them only when nothing
      // is in flight) so the button keeps its Posting/Try again.
      searching = () => {};
      void postCorrespondenceSeekFromPlay(
        act,
        searchStatus,
        pace.days,
        gameSpecId,
        mode === 'rated',
        locale,
      ).then(() => {
        if (searchStatus.isConnected && searchStatus.textContent) searchBar.hidden = false;
      });
      return;
    }
    const preset = LANDING_TIME_PRESETS.find((p) => p.id === pace.id);
    if (!preset) return;
    searching?.();
    searchBar.querySelector('.landing-engine-offer')?.remove();
    searchBar.hidden = false;
    ownSeek = {
      gameSpecId,
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
      rated: mode === 'rated',
    };
    // Casual seekers get the 15 s "play a bot instead" offer; a rated seeker
    // asked for a rated game, so it is not offered there.
    const fallbackBot = mode === 'casual' ? ladderFor(gameSpecId) : [];
    const policyBot = landingBotOffer(gameSpecId)?.botId;
    const botId = fallbackBot.find((r) => r.botId === policyBot)?.botId ?? fallbackBot[0]?.botId;
    searching = joinLobbyFromPlay(
      act,
      {
        gameSpecId,
        rated: mode === 'rated',
        timeControl: { initialMs: preset.initialMs, incrementMs: preset.incrementMs },
        preferredColor: 'random',
      },
      searchStatus,
      locale,
      undefined,
      {
        startSource: 'panel-person',
        // Starting any other game from this page (a bot row, Play again, a
        // Join) withdraws the seek; put the search bar away with it.
        onWithdrawn: endSearch,
        ...(botId && landingVariantSupportsPve(gameSpecId)
          ? { botFallback: { botId, gameSpecId, preferredColor: 'random' as const } }
          : {}),
      },
    );
  };

  const renderPersonRows = (): void => {
    personRows.replaceChildren();
    for (const gameSpecId of ordered()) {
      const start = tilePace(gameSpecId);
      if (!start) continue;
      const { pace, note: paceNote } = start;
      const label = labelFor(gameSpecId);
      const tile = document.createElement('div');
      tile.className = 'pp-tile';
      tile.dataset.gameSpec = gameSpecId;
      tile.classList.toggle('has-waiting', waitingIn(gameSpecId, pace) > 0);
      const text = document.createElement('span');
      text.className = 'pp-tile-text';
      const name = document.createElement('span');
      name.className = 'pp-name';
      // A tile is half the panel wide, so a name too long for it takes its
      // short form instead of an ellipsis; the full name stays the title.
      const short = TILE_NAME_KEYS[gameSpecId];
      name.textContent = short ? t(short, {}, locale) : label;
      if (short) name.title = label;
      text.append(name);
      if (paceNote) {
        const sub = document.createElement('small');
        sub.className = 'pp-tile-meta';
        sub.textContent = paceNote;
        text.append(sub);
      }
      const act = button(
        'pp-act',
        pace.kind === 'days'
          ? `+ ${t('lobby.panelPost', {}, locale)}`
          : t('lobby.panelFind', {}, locale),
      );
      act.setAttribute('aria-label', `${act.textContent}: ${label} · ${paceLabel(pace)}`);
      // No whole-tile click: a stray click posted a public seek nobody meant
      // to make, and 15 s later the bot offer appeared out of nowhere. Only
      // the button starts.
      act.addEventListener('click', () => startPerson(gameSpecId, pace, act));
      tile.append(marker(gameSpecId, label), text, act);
      personRows.append(tile);
    }
  };

  const renderBadge = (): void => {
    const count = visibleRequests().length + corrSeeks.filter((s) => !s.isMine).length;
    badge.hidden = count === 0;
    badge.textContent = count > 0 ? String(count) : '';
  };

  const renderPerson = (): void => {
    renderMode();
    renderPace();
    renderOffers();
    if (!searching) renderPersonRows();
    renderBadge();
  };

  renderBotRows();
  renderFeatures();
  renderPerson();
  selectTab(tab, false);

  // The rated switch comes from /api/server-status, which usually answers
  // after the homepage builds this panel: show Casual/Rated when it lands.
  const stopRatedSync = onRatedModeChange(() => {
    stopRatedSync();
    ratedAvailable = isRatedModeEnabled();
    if (readStored().mode === 'rated' && signedIn && ratedAvailable && !ratedBlocked && !searching)
      mode = 'rated';
    if (!ratedAvailable) mode = 'casual';
    renderModeSlot();
    renderFeatures();
    renderPerson();
  });

  // The hint can be stale (a flag set since the last load): account-nav's
  // /api/auth/me answer settles it.
  window.addEventListener(
    statsExcludedResolvedEvent,
    () => {
      const blocked = isLikelyStatsExcluded();
      if (blocked === ratedBlocked) return;
      ratedBlocked = blocked;
      if (ratedBlocked && mode === 'rated' && !searching) mode = 'casual';
      renderFeatures();
      renderPerson();
    },
    { once: true },
  );

  if (options.hydrate !== false) {
    const refreshLobby = async (): Promise<void> => {
      try {
        openRequests = await fetchOpenLobbyRequests();
        renderFeatures();
        renderOffers();
        if (!searching) renderPersonRows();
        renderBadge();
      } catch (err) {
        console.warn(err);
      }
    };
    const refreshCorrespondence = (): void => {
      if (!correspondenceEnabled()) return;
      void fetchCorrespondenceSeeks()
        .then((feed) => {
          corrSeeks =
            feed.status === 'ok'
              ? feed.seeks.filter((s) => variants.some((v) => v.gameSpecId === s.gameSpecId))
              : [];
          renderOffers();
          renderBadge();
        })
        .catch(() => {});
    };
    const refreshPlaying = (): void => {
      void fetchLiveStats().then((data) => {
        playingBySpec = data?.playingBySpec ?? {};
        paintPlaying();
      });
    };
    const refreshBotLadders = (): void => {
      const changed = ordered().some(
        (gameSpecId) => !sameLadder(botState.get(gameSpecId)?.ladder ?? [], ladderFor(gameSpecId)),
      );
      if (!changed) return;
      renderBotRows();
      renderFeatures();
    };
    // Misty's neural tiers share a bot id, so their availability must come
    // from the runtime engine roster, not Misty's playable bot profile.
    void fetch('/api/engines/playable', { headers: { accept: 'application/json' } })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              banqiEngines?: { id: string }[];
              jungleFlipEngines?: { id: string }[];
              ffqBanqiEngines?: WebTenantEngineOption[];
              threeKingdomsBanqiEngines?: WebTenantEngineOption[];
            }>)
          : null,
      )
      .then((data) => {
        if (!data) return;
        if (data.threeKingdomsBanqiEngines !== undefined) {
          threeKingdomsBanqiEngineIds = new Set(
            data.threeKingdomsBanqiEngines.map((engine) => engine.id),
          );
          setThreeKingdomsBanqiEngineOptions(data.threeKingdomsBanqiEngines);
        }
        setFFQBanqiEngineOptions(data.ffqBanqiEngines ?? []);
        playableEngines = new Set(
          [...(data.banqiEngines ?? []), ...(data.jungleFlipEngines ?? [])].map((e) => e.id),
        );
        refreshBotLadders();
      })
      .catch(() => {});
    // One-shot: which gated bots this server can seat (playOptions[].playable).
    // A failure leaves them off, which is the safe side.
    void fetch('/api/bots', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<{ bots?: LandingBotRosterPlayOptions[] }>) : null))
      .then((data) => {
        if (!data?.bots) return;
        playableBots = playableBotIdsBySpec(data.bots);
        // Re-render only when a ladder changed, so a Play already pending on
        // another row keeps its button.
        refreshBotLadders();
      })
      .catch(() => {});
    void refreshLobby();
    refreshCorrespondence();
    refreshPlaying();
    let tick = 0;
    const timer = window.setInterval(() => {
      if (!document.body.contains(board)) {
        window.clearInterval(timer);
        searching?.();
        return;
      }
      void refreshLobby();
      tick += 1;
      if (tick % 10 === 0) {
        refreshCorrespondence();
        refreshPlaying();
      }
    }, LOBBY_POLL_MS);
  }

  return board;
}

function formatClock(timeControl: { initialMs: number; incrementMs: number }): string {
  const preset = LANDING_TIME_PRESETS.find(
    (p) => p.initialMs === timeControl.initialMs && p.incrementMs === timeControl.incrementMs,
  );
  if (preset) return preset.label.replace(/\s+/g, '');
  const minutes = timeControl.initialMs / 60_000;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}+${timeControl.incrementMs / 1000}`;
}

/** Whether this visit shows the play panel. It is the default (promoted
 *  2026-10-02); `?hero=lobby` brings the old lichess-shaped tabs back on this
 *  device and `?hero=grid` returns to the panel. */
export function playPanelEnabled(search: string = window.location.search): boolean {
  const param = new URLSearchParams(search).get('hero');
  try {
    localStorage.removeItem('mistboard.heroGrid');
    if (param === 'lobby') localStorage.setItem('mistboard.heroLobby', '1');
    if (param === 'grid') localStorage.removeItem('mistboard.heroLobby');
    return localStorage.getItem('mistboard.heroLobby') !== '1';
  } catch {
    return param !== 'lobby';
  }
}
