import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  canonicalVariantOrderIndex,
  DAYS_PER_MOVE_OPTIONS,
  defaultEngineTimeControl,
  type GameSpecId,
  RATED_TIME_CONTROLS,
  TIME_CONTROLS,
  type TimeControlId,
} from '@mistboard/game';
import { track } from './analytics.js';
import { loginHrefForCurrentPage } from './auth-redirect.js';
import { type BotPlayRequest, bindBotPlayControl } from './bot-play.js';
import { correspondenceRatedAvailable } from './correspondence-model.js';
import { correspondenceEnabled } from './feature-flags.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import {
  type LandingBotRung,
  landingBotLadder,
  landingBotLadderIndex,
  landingBotOffer,
} from './landing-bot-policy.js';
import {
  allowedTimePresetIds,
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
  openLandingSetupDialog,
  variantLabelForGameSpec,
} from './landing-play.js';
import './landing-play-panel.css';
import { rememberedPveEngine } from './pve-memory.js';
import { isRatedModeEnabled } from './rated-flag.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { renderVariantMarker } from './variant-markers.js';
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

type StoredPanel = {
  tab?: PanelTab;
  mode?: PersonMode;
  bots?: Record<string, { botId?: string; tc?: TimeControlId }>;
  people?: Record<string, string>;
  last?: { gameSpecId: string; botId: string; tc: TimeControlId };
};

const STORAGE_KEY = 'mistboard.playPanel.v1';
const LOBBY_POLL_MS = 3_000;

function readStored(): StoredPanel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPanel) : {};
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

function paceKey(pace: PersonPace): string {
  return pace.kind === 'live' ? pace.id : `${pace.days}d`;
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
    if (tag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'pp-step-tag';
      tagEl.textContent = tag;
      main.append(tagEl);
    }
    value.replaceChildren(main);
    if (sub) {
      const small = document.createElement('small');
      small.className = 'pp-step-sub';
      small.textContent = sub;
      value.append(small);
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
 *  variant can be rated by correspondence (correspondenceRatedAvailable). */
export function panelPersonPaces(gameSpecId: LandingGameSpecId, mode: PersonMode): PersonPace[] {
  // A casual-only variant has no rated seek, so its row drops out of Rated
  // rather than offering a Find the lobby would refuse.
  if (mode === 'rated' && !landingVariantSupportsRated(gameSpecId)) return [];
  const allowed = allowedTimePresetIds(gameSpecId, mode === 'rated', 'lobby');
  const live: PersonPace[] = TIME_CONTROLS.filter((tc) => allowed.has(tc.id)).map((tc) => ({
    kind: 'live',
    id: tc.id,
  }));
  const days: PersonPace[] =
    (mode === 'casual' || correspondenceRatedAvailable(gameSpecId, isRatedModeEnabled())) &&
    correspondenceEnabled() &&
    (CORRESPONDENCE_ELIGIBLE_SPEC_IDS as readonly string[]).includes(gameSpecId)
      ? DAYS_PER_MOVE_OPTIONS.map((d) => ({ kind: 'days', days: d }))
      : [];
  return [...live, ...days];
}

export function buildPlayPanel(
  locale: Locale = currentLocale(),
  options: { hydrate?: boolean } = {},
): HTMLElement {
  const stored = readStored();
  const signedIn = isLikelySignedIn();
  const ratedAvailable = isRatedModeEnabled();
  let tab: PanelTab = stored.tab ?? 'computer';
  let mode: PersonMode = stored.mode === 'rated' && signedIn && ratedAvailable ? 'rated' : 'casual';
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
    if (!ownSeek) return openRequests;
    const own = ownSeek;
    let skipped = false;
    return openRequests.filter((r) => {
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

  const variants = enabledLandingVariantGameSpecs('pvp', locale);
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
  computerView.className = 'pp-view';
  computerView.setAttribute('role', 'tabpanel');
  const personView = document.createElement('div');
  personView.className = 'pp-view';
  personView.setAttribute('role', 'tabpanel');
  card.append(computerView, personView);
  board.append(tabBar, card);

  const selectTab = (next: PanelTab, user: boolean): void => {
    tab = next;
    computerTab.classList.toggle('is-active', next === 'computer');
    personTab.classList.toggle('is-active', next === 'person');
    computerTab.setAttribute('aria-selected', String(next === 'computer'));
    personTab.setAttribute('aria-selected', String(next === 'person'));
    computerView.hidden = next !== 'computer';
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

  const botRequest = (gameSpecId: string): BotPlayRequest => {
    const state = botState.get(gameSpecId)!;
    const preset = LANDING_TIME_PRESETS.find((p) => p.id === state.tc);
    return {
      botId: state.ladder[state.at]!.botId,
      gameSpecId,
      ...(preset
        ? { timeControl: { initialMs: preset.initialMs, incrementMs: preset.incrementMs } }
        : {}),
      preferredColor: 'random',
    };
  };
  const rememberStart = (req: BotPlayRequest): void => {
    const state = botState.get(req.gameSpecId);
    if (!state) return;
    writeStored((s) => {
      s.last = { gameSpecId: req.gameSpecId, botId: req.botId, tc: state.tc };
    });
  };

  const renderBotRows = (): void => {
    botRows.replaceChildren();
    playingEls.clear();
    for (const gameSpecId of ordered()) {
      if (!landingVariantSupportsPve(gameSpecId)) continue;
      const ladder = landingBotLadder(gameSpecId);
      if (ladder.length === 0) continue;
      const paces = panelBotPaces(gameSpecId);
      if (paces.ids.length === 0) continue;
      const label = labelFor(gameSpecId);
      const saved = stored.bots?.[gameSpecId];
      let state = botState.get(gameSpecId);
      if (!state) {
        const fromPanel = landingBotLadderIndex(ladder, saved?.botId);
        const fromMemory = landingBotLadderIndex(ladder, rememberedPveEngine(gameSpecId));
        const policy = landingBotLadderIndex(
          ladder,
          landingBotOffer(gameSpecId, {
            rememberedXiangqiBotId: rememberedPveEngine(gameSpecId),
          })?.botId,
        );
        const at = [fromPanel, fromMemory, policy, 0].find((i) => i >= 0) ?? 0;
        const tc = saved?.tc && paces.ids.includes(saved.tc) ? saved.tc : paces.defaultId;
        state = { ladder, at, tc };
        botState.set(gameSpecId, state);
      }
      const current = state;

      const row = document.createElement('div');
      row.className = 'pp-row pp-row-bot';
      row.dataset.gameSpec = gameSpecId;

      const name = document.createElement('span');
      name.className = 'pp-name';
      name.textContent = label;
      const playing = document.createElement('em');
      playing.className = 'pp-playing';
      name.append(playing);
      playingEls.set(gameSpecId, playing);

      const save = (): void =>
        writeStored((s) => {
          s.bots ??= {};
          s.bots[gameSpecId] = { botId: current.ladder[current.at]!.botId, tc: current.tc };
        });
      const levelStep = stepper({
        className: 'pp-step-level',
        count: ladder.length,
        index: current.at,
        render: (i) => {
          const rung = ladder[i]!;
          // One grammar on every row (Brian, 2026-10-02): the top line is
          // always the engine, with an NNUE tag on the rungs that play on a
          // net; the second line is the level, only for an engine that has
          // levels. Names stay plain: gold in this panel means a person.
          const tag = rung.nnue ? 'NNUE' : undefined;
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
        onCreated: rememberStart,
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
    othersRequests().filter((r) => r.rated === false || (signedIn && ratedAvailable));

  const renderFeatures = (): void => {
    const rows: HTMLElement[] = [];
    const last = readStored().last;
    const lastLadder = last ? landingBotLadder(last.gameSpecId) : [];
    const lastRung = last ? lastLadder.find((r) => r.botId === last.botId) : undefined;
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
          botId: last.botId,
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
  control.append(ratedAvailable ? modeSwitch : document.createElement('span'), note);

  const personScroll = document.createElement('div');
  personScroll.className = 'pp-scroll';
  const offersSlot = document.createElement('div');
  const personRows = document.createElement('div');
  personScroll.append(offersSlot, personRows);

  const searchBar = document.createElement('div');
  searchBar.className = 'pp-search';
  searchBar.hidden = true;
  const searchStatus = document.createElement('span');
  searchStatus.className = 'pp-search-status';
  const searchCancel = button('pp-search-cancel', t('setup.cancel', {}, locale));
  searchBar.append(searchStatus, searchCancel);
  personView.append(control, personScroll, searchBar);

  const stopSearch = (): void => {
    searching?.();
    searching = null;
    ownSeek = null;
    searchBar.querySelector('.landing-engine-offer')?.remove();
    searchBar.hidden = true;
    renderPersonRows();
  };
  searchCancel.addEventListener('click', stopSearch);

  const personPace = new Map<string, number>();

  const renderMode = (): void => {
    casualBtn.classList.toggle('is-active', mode === 'casual');
    ratedBtn.classList.toggle('is-active', mode === 'rated');
    if (!signedIn) ratedBtn.title = t('lobby.panelRatedSignIn', {}, locale);
    note.textContent =
      mode === 'rated'
        ? t(
            'lobby.panelRatedNote',
            { clocks: RATED_TIME_CONTROLS.map((tc) => compactLabel(tc.id)).join(', ') },
            locale,
          )
        : t('lobby.panelBotFallbackNote', {}, locale);
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

  const waitingIn = (gameSpecId: string, pace?: PersonPace): number =>
    othersRequests().filter(
      (r) =>
        (r.gameSpecId ?? 'dark-chess') === gameSpecId &&
        (mode === 'rated' ? r.rated !== false : r.rated === false) &&
        (!pace ||
          (pace.kind === 'live' &&
            LANDING_TIME_PRESETS.some(
              (p) =>
                p.id === pace.id &&
                p.initialMs === r.timeControl.initialMs &&
                p.incrementMs === r.timeControl.incrementMs,
            ))),
    ).length;

  const renderOffers = (): void => {
    const rows: HTMLElement[] = [];
    for (const request of othersRequests()) {
      if (mode === 'rated' ? request.rated === false : request.rated !== false) continue;
      const gameSpecId = request.gameSpecId ?? 'dark-chess';
      const join = button('pp-act pp-act-join', t('play.join', {}, locale));
      join.addEventListener('click', () => joinRequest(request, join, 'panel-offer'));
      rows.push(
        offerRow(
          gameSpecId,
          t('lobby.panelAnonymous', {}, locale),
          formatClock(request.timeControl),
          join,
        ),
      );
    }
    // Each mode lists the correspondence seeks of its own kind, like the live rows.
    for (const seek of corrSeeks.filter((s) => (s.rated === true) === (mode === 'rated'))) {
      const label = t('lobby.daysPerMove', { days: seek.daysPerMove }, locale);
      let action: HTMLElement;
      if (seek.isMine) {
        action = document.createElement('span');
        action.className = 'pp-yours';
        action.textContent = t('lobby.panelYours', {}, locale);
      } else {
        const link = document.createElement('a');
        link.className = 'pp-act';
        link.href = `/challenge/${encodeURIComponent(seek.id)}`;
        link.textContent = t('play.join', {}, locale);
        action = link;
      }
      rows.push(
        offerRow(
          seek.gameSpecId,
          seek.creatorName ?? t('lobby.panelAnonymous', {}, locale),
          label,
          action,
          true,
        ),
      );
    }
    if (rows.length === 0) {
      offersSlot.replaceChildren();
      return;
    }
    const head = document.createElement('div');
    head.className = 'pp-section';
    head.textContent = t('lobby.panelOpenGames', {}, locale);
    const tail = document.createElement('div');
    tail.className = 'pp-section';
    tail.textContent = t('lobby.panelStartOne', {}, locale);
    offersSlot.replaceChildren(head, ...rows, tail);
  };

  const offerRow = (
    gameSpecId: string,
    who: string,
    pace: string,
    action: HTMLElement,
    slow = false,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'pp-offer';
    const label = labelFor(gameSpecId);
    const text = document.createElement('span');
    text.className = 'pp-name';
    text.textContent = label;
    const whoEl = document.createElement('small');
    whoEl.textContent = ` · ${who}`;
    text.append(whoEl);
    const paceEl = document.createElement('span');
    paceEl.className = `pp-offer-pace${slow ? ' is-slow' : ''}`;
    paceEl.textContent = pace;
    row.append(marker(gameSpecId, label), text, paceEl, action);
    return row;
  };

  const renderPersonRows = (): void => {
    personRows.replaceChildren();
    for (const gameSpecId of ordered()) {
      const paces = panelPersonPaces(gameSpecId, mode);
      if (paces.length === 0) continue;
      const label = labelFor(gameSpecId);
      const savedKey = readStored().people?.[gameSpecId];
      let index = personPace.get(`${mode}:${gameSpecId}`);
      if (index === undefined || index >= paces.length) {
        const fromSaved = paces.findIndex((p) => paceKey(p) === savedKey);
        const fallback = paces.findIndex((p) => p.kind === 'live' && p.id === '5m5');
        index = fromSaved >= 0 ? fromSaved : fallback >= 0 ? fallback : 0;
      }
      let at = index;

      const row = document.createElement('div');
      row.className = 'pp-row pp-row-person';
      row.dataset.gameSpec = gameSpecId;
      const name = document.createElement('span');
      name.className = 'pp-name';
      name.textContent = label;
      const waiting = document.createElement('span');
      waiting.className = 'pp-waiting';
      const act = button('pp-act', '');
      const paint = (): void => {
        const pace = paces[at]!;
        const count = waitingIn(gameSpecId, pace);
        const any = waitingIn(gameSpecId);
        waiting.textContent = any > 0 ? t('play.waitingCount', { count: any }, locale) : '';
        row.classList.toggle('has-waiting', count > 0);
        act.textContent =
          pace.kind === 'days'
            ? `+ ${t('lobby.panelPost', {}, locale)}`
            : t('lobby.panelFind', {}, locale);
      };
      const clockStep = stepper({
        className: 'pp-step-clock',
        count: paces.length,
        index: at,
        render: (i) => {
          const pace = paces[i]!;
          return pace.kind === 'live'
            ? { text: compactLabel(pace.id) }
            : { text: t('lobby.daysPerMove', { days: pace.days }, locale), named: true };
        },
        onChange: (i) => {
          at = i;
          personPace.set(`${mode}:${gameSpecId}`, i);
          writeStored((s) => {
            s.people ??= {};
            s.people[gameSpecId] = paceKey(paces[i]!);
          });
          paint();
        },
        prevLabel: t('lobby.panelFaster', {}, locale),
        nextLabel: t('lobby.panelSlower', {}, locale),
      });
      act.addEventListener('click', () => {
        const pace = paces[at]!;
        if (pace.kind === 'days') {
          openLandingSetupDialog({
            locale,
            mode: 'lobby',
            initialGameSpecId: gameSpecId,
            initialTimeMode: 'correspondence',
            initialCorrespondenceDays: pace.days,
            source: 'correspondence',
            initialRated: mode === 'rated',
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
        // Casual seekers get the 15 s "play a bot instead" offer; a rated
        // seeker asked for a rated game, so it is not offered there.
        const fallbackBot = mode === 'casual' ? landingBotLadder(gameSpecId) : [];
        const policyBot = landingBotOffer(gameSpecId)?.botId;
        const botId =
          fallbackBot.find((r) => r.botId === policyBot)?.botId ?? fallbackBot[0]?.botId;
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
            ...(botId && landingVariantSupportsPve(gameSpecId)
              ? { botFallback: { botId, gameSpecId, preferredColor: 'random' as const } }
              : {}),
          },
        );
      });
      // No whole-row click here either: a stray click on a person row posted a
      // public seek nobody meant to make, and 15 s later the bot offer appeared
      // out of nowhere. Only Find searches.
      paint();
      row.append(marker(gameSpecId, label), name, clockStep, waiting, act);
      personRows.append(row);
    }
  };

  const renderBadge = (): void => {
    const count = visibleRequests().length + corrSeeks.filter((s) => !s.isMine).length;
    badge.hidden = count === 0;
    badge.textContent = count > 0 ? String(count) : '';
  };

  const renderPerson = (): void => {
    renderMode();
    renderOffers();
    if (!searching) renderPersonRows();
    renderBadge();
  };

  renderBotRows();
  renderFeatures();
  renderPerson();
  selectTab(tab, false);

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
          corrSeeks = feed.status === 'ok' ? feed.seeks : [];
          renderOffers();
          renderBadge();
        })
        .catch(() => {});
    };
    const refreshPlaying = (): void => {
      void fetch('/api/live-stats', { headers: { accept: 'application/json' } })
        .then((r) =>
          r.ok ? (r.json() as Promise<{ playingBySpec?: Record<string, number> }>) : null,
        )
        .then((data) => {
          playingBySpec = data?.playingBySpec ?? {};
          paintPlaying();
        })
        .catch(() => {});
    };
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
