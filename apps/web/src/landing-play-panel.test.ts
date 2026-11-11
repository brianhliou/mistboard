import { readFileSync } from 'node:fs';
import { GAME_SPECS, isPublicGameSpec, RATED_TIME_CONTROLS } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knownEngineIds, loadEngine } from '../../server/src/engine-registry.js';
import { FIRST_PARTY_BOT_PROFILES } from '../../server/src/first-party-bots.js';
import { THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES } from '../../server/src/three-kingdoms-banqi-engine.js';
import { landingBotLadder } from './landing-bot-policy.js';
import { enabledLandingVariantGameSpecs, setRoomNavigator } from './landing-play.js';
import {
  buildPlayPanel,
  orderPanelSpecs,
  panelBotPaces,
  panelPersonPaces,
  playPanelEnabled,
} from './landing-play-panel.js';
import { resetLiveStatsCacheForTests } from './live-stats-client.js';
import { openLobbySeekCount, withdrawLobbySeeks } from './lobby-seek-registry.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn, setResolvedStatsExcluded } from './signed-in-state.js';
import { setThreeKingdomsBanqiEngineOptions } from './three-kingdoms-banqi-access.js';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function row(board: HTMLElement, spec: string, kind: 'bot' | 'person' = 'bot'): HTMLElement {
  const selector = kind === 'bot' ? '.pp-row-bot' : '.pp-person-rows .pp-tile';
  const el = board.querySelector<HTMLElement>(`${selector}[data-game-spec="${spec}"]`);
  if (!el) throw new Error(`no ${kind} row for ${spec}`);
  return el;
}

function stepValue(el: HTMLElement, which: 'level' | 'clock'): string {
  // The level a rung reads as: its second line when the engine has levels,
  // otherwise the engine name alone (the NNUE tag is not part of it).
  const value = el.querySelector(`.pp-step-${which} .pp-step-value`);
  const sub = value?.querySelector('.pp-step-sub')?.textContent;
  if (sub) return sub;
  return value?.querySelector('.pp-step-main')?.firstChild?.textContent ?? '';
}

// The shared pace bar above the Play a person tiles.
function paceBar(board: HTMLElement): HTMLElement {
  const el = board.querySelector<HTMLElement>('.pp-view-person .pp-pace');
  if (!el) throw new Error('no pace bar');
  return el;
}

function tiles(board: HTMLElement): HTMLElement[] {
  return [...board.querySelectorAll<HTMLElement>('.pp-person-rows .pp-tile')];
}

function tileNote(tile: HTMLElement): string | null {
  return tile.querySelector('.pp-tile-meta')?.textContent ?? null;
}

function clickNext(el: HTMLElement, which: 'level' | 'clock', times = 1): void {
  for (let i = 0; i < times; i++) {
    el.querySelectorAll<HTMLButtonElement>(`.pp-step-${which} .pp-step-btn`)[1]!.click();
  }
}

// Signed in, Play a person opens on 3 days per move (#1058); a test of the live search picks 5+5 the
// way a returning visitor's saved pace does.
function rememberLivePace(): void {
  localStorage.setItem('mistboard.playPanel.v1', JSON.stringify({ personFamily: 'live' }));
}

// /api/live-stats reads are shared through a module cache; start each test cold.
beforeEach(() => resetLiveStatsCacheForTests());

describe('homepage play panel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    sessionStorage.clear();
    setResolvedSignedIn(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    setRatedModeEnabled(false);
    setResolvedStatsExcluded(undefined);
    setThreeKingdomsBanqiEngineOptions([]);
    window.history.replaceState(null, '', '/');
  });

  it('opens on Play the computer with a row per bot-playable game', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const tabs = [...board.querySelectorAll('.pp-tab')].map((el) => el.textContent);
    expect(tabs[0]).toBe('Play the computer');
    expect(tabs[1]).toContain('Play a person');
    expect(board.querySelector('.pp-tab.is-active')?.textContent).toBe('Play the computer');
    const specs = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (el) => el.dataset.gameSpec,
    );
    expect(specs).toEqual(expect.arrayContaining(['xiangqi', 'jieqi', 'banqi']));
    expect(new Set(specs).size).toBe(specs.length);
  });

  it('walks the xiangqi ladder to full-strength Pikafish and stops there', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const xiangqi = row(board, 'xiangqi');
    // A device with no bot history starts on the first-game rung (#365).
    expect(stepValue(xiangqi, 'level')).toBe('Level 2');
    clickNext(xiangqi, 'level', 12);
    expect(stepValue(xiangqi, 'level')).toBe('Pikafish');
    const [, harder] = xiangqi.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn');
    expect(harder?.disabled).toBe(true);
  });

  it('ends the jieqi ladder on AB-JChess', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const jieqi = row(board, 'jieqi');
    // A device with no remembered jieqi bot starts on the newcomer level.
    expect(stepValue(jieqi, 'level')).toBe('Level 2');
    clickNext(jieqi, 'level', 6);
    expect(stepValue(jieqi, 'level')).toBe('Level 8');
    clickNext(jieqi, 'level', 12);
    expect(stepValue(jieqi, 'level')).toBe('AB-JChess');
  });

  it('already lists every live-roster bot variant at first paint unless explicitly exempted', async () => {
    vi.useFakeTimers();
    for (const flag of [
      'XIANGQI',
      'JIEQI',
      'BANQI',
      'DARK_XIANGQI',
      'JUNGLE',
      'JUNGLE_FLIP',
      'XIANGQI_MAHJONG',
      'GOMOKU',
      'THREE_KINGDOMS_BANQI',
      'FFQ_BANQI',
      'MAHJONG',
    ]) {
      vi.stubEnv(`VITE_${flag}_ENABLED`, 'true');
    }
    // Intentional homepage omissions: Fog games remain in the setup dialog.
    // Keep this explicit; newly launched public PvE variants get no exemption.
    const excluded = ['dark-xiangqi', 'dark-chess'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url === '/api/engines/playable'
            ? {
                banqiEngines: knownEngineIds().map((id) => ({ id })),
                jungleFlipEngines: knownEngineIds().map((id) => ({ id })),
                threeKingdomsBanqiEngines: THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES,
              }
            : url === '/api/bots'
              ? {
                  bots: FIRST_PARTY_BOT_PROFILES.map((bot) => ({
                    id: bot.id,
                    playOptions: Object.keys(bot.engines).map((gameSpecId) => ({
                      gameSpecId,
                      playable: true,
                    })),
                  })),
                }
              : {},
        ),
      ),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    const firstPaintBots = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (el) => el.dataset.gameSpec,
    );
    await vi.advanceTimersByTimeAsync(0);
    // The same bot identities used by /api/bots, independent of the web
    // picker's PvE predicate: a server bot omitted by the web must fail too.
    // Engine-only bots (TK) have no public bot profile. Include the server's
    // engine catalog too, or a profile omission hides the missing row again.
    const botSpecs = new Set([
      ...FIRST_PARTY_BOT_PROFILES.flatMap((bot) => Object.keys(bot.engines)),
      ...knownEngineIds().map((id) => loadEngine(id).gameSpecId),
    ]);
    const expected = GAME_SPECS.filter(
      (spec) =>
        spec.runtimeStatus === 'live' &&
        isPublicGameSpec(spec.id) &&
        !excluded.includes(spec.id) &&
        botSpecs.has(spec.id),
    ).map((spec) => spec.id);
    const bots = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (el) => el.dataset.gameSpec,
    );
    expect(bots).toEqual(orderPanelSpecs(expected));
    for (const spec of bots) {
      expect(firstPaintBots, `${spec} must already have a row before the live roster`).toContain(
        spec,
      );
    }
    expect(firstPaintBots.indexOf('three-kingdoms-banqi')).toBe(
      firstPaintBots.indexOf('banqi') + 1,
    );
    // A generic fallback row is not coverage if its bot does not play this
    // spec. In particular, TK cannot send Misty's public-profile botId.
    for (const spec of expected) {
      const ladder = landingBotLadder(spec, new Set(), new Set(knownEngineIds()));
      expect(ladder.length, `${spec} needs a homepage bot ladder`).toBeGreaterThan(0);
      for (const rung of ladder) {
        if (rung.botId) {
          expect(
            FIRST_PARTY_BOT_PROFILES.find((bot) => bot.id === rung.botId)?.engines[spec],
            `${spec}: ${rung.botId} must support the advertised variant`,
          ).toBeDefined();
        }
        if (rung.engineId) {
          expect(loadEngine(rung.engineId).gameSpecId).toBe(spec);
        }
      }
    }
    const people = tiles(board).map((el) => el.dataset.gameSpec);
    expect(people).toEqual(
      orderPanelSpecs(
        enabledLandingVariantGameSpecs('pvp', 'en')
          .filter(
            (spec) => isPublicGameSpec(spec.gameSpecId) && !excluded.includes(spec.gameSpecId),
          )
          .map((spec) => spec.gameSpecId),
      ),
    );
    for (const spec of [
      ...excluded,
      ...GAME_SPECS.filter((spec) => !isPublicGameSpec(spec.id)).map((spec) => spec.id),
    ]) {
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
    }
    expect(bots.at(-1)).toBe('gomoku');
    expect(people.at(-1)).toBe('gomoku');
    expect(bots.indexOf('three-kingdoms-banqi')).toBe(bots.indexOf('banqi') + 1);
  });

  it('omits flag-off variants and hidden playtests from both tabs', () => {
    vi.stubEnv('DEV', false);
    for (const flag of ['XIANGQI', 'GOMOKU', 'XIANGQI_MAHJONG', 'THREE_KINGDOMS_BANQI']) {
      vi.stubEnv(`VITE_${flag}_ENABLED`, 'false');
    }
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    const board = buildPlayPanel('en', { hydrate: false });
    for (const spec of [
      'xiangqi',
      'gomoku',
      'xiangqi-mahjong',
      'three-kingdoms-banqi',
      'ffq-banqi',
    ]) {
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
    }
  });

  it.each(['true', 'false'])('offers TK on both tabs only with its launch flag on (%s)', (flag) => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', flag);
    setThreeKingdomsBanqiEngineOptions([
      {
        id: 'misty-three-kingdoms-banqi-level-1',
        name: 'Misty Level 1',
        familyName: 'Misty',
        kind: 'container',
      },
    ]);
    const board = buildPlayPanel('en', { hydrate: false });
    for (const selector of ['.pp-row-bot', '.pp-person-rows .pp-tile']) {
      expect(
        board.querySelector(`${selector}[data-game-spec="three-kingdoms-banqi"]`) !== null,
      ).toBe(flag === 'true');
    }
  });

  it.each(['true', 'false'])(
    'paints the static TK Levels 1-7 after Banqi only with the public flag (%s), before any engine response',
    (flag) => {
      vi.useFakeTimers();
      vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', flag);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      if (flag === 'false') {
        expect(
          board.querySelector('.pp-row-bot[data-game-spec="three-kingdoms-banqi"]'),
        ).toBeNull();
        return;
      }
      const tk = row(board, 'three-kingdoms-banqi');
      expect(tk.previousElementSibling?.getAttribute('data-game-spec')).toBe('banqi');
      expect(stepValue(tk, 'level')).toBe('Level 4');
      expect(tk.querySelector('.pp-step-tag')).toBeNull();
      const easier = tk.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn')[0]!;
      for (let i = 0; i < 10; i++) easier.click();
      const levels = [stepValue(tk, 'level')];
      for (let i = 0; i < 6; i++) {
        clickNext(tk, 'level');
        levels.push(stepValue(tk, 'level'));
      }
      clickNext(tk, 'level');
      expect(levels).toEqual(Array.from({ length: 7 }, (_, i) => `Level ${i + 1}`));
      expect(stepValue(tk, 'level')).toBe('Level 7');
      expect(
        tk.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn')[1]!.disabled,
      ).toBe(true);
    },
  );

  it('hydrates the TK row after Banqi, defaults to Level 4, and starts the exact engine-only pick', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(
        url === '/api/engines/playable'
          ? { threeKingdomsBanqiEngines: THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES }
          : url === '/api/rooms'
            ? { url: '/room/tk-level-5' }
            : {},
        { status: url === '/api/rooms' ? 201 : 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en');
    document.body.append(board);
    expect(stepValue(row(board, 'three-kingdoms-banqi'), 'level')).toBe('Level 4');
    await vi.advanceTimersByTimeAsync(0);
    const tk = row(board, 'three-kingdoms-banqi');
    expect(tk.previousElementSibling?.getAttribute('data-game-spec')).toBe('banqi');
    expect(tk.querySelector('.pp-step-main')?.textContent).toBe('Misty');
    expect(stepValue(tk, 'level')).toBe('Level 4');
    expect(stepValue(tk, 'clock')).toBe('10+5');
    expect(panelBotPaces('three-kingdoms-banqi').ids).toEqual(['1m1', '3m2', '5m5', '10m5']);
    clickNext(tk, 'level');
    tk.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();
    const requests = () =>
      fetchSpy.mock.calls
        .filter(([url]) => url === '/api/rooms')
        .map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests()).toEqual([
      {
        mode: 'pve',
        gameSpecId: 'three-kingdoms-banqi',
        engineId: 'misty-three-kingdoms-banqi-level-5',
        timeControl: { initialMs: 600_000, incrementMs: 5_000 },
        preferredColor: 'random',
        rated: false,
      },
    ]);
    const returning = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(row(returning, 'three-kingdoms-banqi'), 'level')).toBe('Level 5');
    expect(returning.querySelector('.pp-feature-again')?.textContent).toContain('Misty Level 5');
    returning.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
    await flush();
    expect(requests()[1]).toEqual(requests()[0]);
    clickNext(row(returning, 'three-kingdoms-banqi'), 'level', 10);
    expect(stepValue(row(returning, 'three-kingdoms-banqi'), 'level')).toBe('Level 8');
    expect(row(returning, 'three-kingdoms-banqi').querySelector('.pp-step-tag')?.textContent).toBe(
      'NNUE',
    );
  });

  it.each(['no-net', 'no-binary', 'empty', 'missing', 'failed', 'unavailable'])(
    'replaces the static TK ladder only with an explicit live list (%s)',
    async (availability) => {
      vi.useFakeTimers();
      vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url !== '/api/engines/playable') return Response.json({});
          if (availability === 'failed') throw new Error('offline');
          if (availability === 'unavailable') return new Response(null, { status: 503 });
          if (availability === 'missing') return Response.json({});
          const tiers = THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES;
          return Response.json({
            threeKingdomsBanqiEngines:
              availability === 'no-net'
                ? tiers.slice(0, 7)
                : availability === 'no-binary'
                  ? tiers.slice(0, 1)
                  : [],
          });
        }),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      await vi.advanceTimersByTimeAsync(0);
      if (availability === 'empty') {
        expect(
          board.querySelector('.pp-row-bot[data-game-spec="three-kingdoms-banqi"]'),
        ).toBeNull();
      } else {
        const tk = row(board, 'three-kingdoms-banqi');
        clickNext(tk, 'level', 10);
        expect(stepValue(tk, 'level')).toBe(availability === 'no-binary' ? 'Level 1' : 'Level 7');
        expect(tk.querySelector('.pp-step-tag')).toBeNull();
      }
    },
  );

  it.each(['dark-xiangqi', 'dark-chess'])(
    'keeps %s off remembered and waiting-player hero rows',
    async (spec) => {
      vi.useFakeTimers();
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({ last: { gameSpecId: spec, botId: 'misty', tc: '10m5' } }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
          if (input === '/api/lobby')
            return Response.json({
              requests: [
                {
                  gameSpecId: spec,
                  rated: false,
                  timeControl: { initialMs: 600_000, incrementMs: 5_000 },
                  createdAt: Date.now(),
                },
              ],
            });
          if (input === '/api/correspondence/seeks')
            return Response.json({
              seeks: [{ id: 'fog-seek', gameSpecId: spec, daysPerMove: 1, rated: false }],
            });
          return Response.json({ bots: [], engines: [], playing: 0, online: 0 });
        }),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      await flush();
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
      expect(board.querySelector('.pp-feature-again')).toBeNull();
      expect(board.querySelector('.pp-feature-waiting')).toBeNull();
      expect(board.querySelector<HTMLElement>('.pp-badge')?.hidden).toBe(true);
      board.remove();
      await vi.advanceTimersByTimeAsync(3_000);
    },
  );

  it('walks Gomoku Levels 1-8, shows its icon and clock, and starts the chosen Rapfi level', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) =>
      Response.json({ url: '/room/gomoku' }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    const gomoku = row(board, 'gomoku');
    expect(gomoku.querySelector('[data-variant-marker-id="gomoku"]')).not.toBeNull();
    expect(stepValue(gomoku, 'clock')).toBe('10+5');
    for (let level = 1; level <= 8; level++) {
      expect(stepValue(gomoku, 'level')).toBe(`Level ${level}`);
      expect(gomoku.querySelector('.pp-step-main')?.textContent).toBe('Rapfi');
      if (level < 8) clickNext(gomoku, 'level');
    }
    expect(
      gomoku.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn')[1]?.disabled,
    ).toBe(true);
    gomoku.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      botId: 'rapfi-level-8',
      gameSpecId: 'gomoku',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    });
  });

  it.each(['banqi', 'jungle-flip'])(
    'starts %s at Level 4, sends Level 5 and remembers it for Play again',
    async (spec) => {
      const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) =>
        Response.json({ url: '/room/level-5' }, { status: 201 }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const board = buildPlayPanel('en', { hydrate: false });
      const bot = row(board, spec);
      expect(bot.querySelector('.pp-step-main')?.textContent).toBe('Misty');
      expect(stepValue(bot, 'level')).toBe('Level 4');
      clickNext(bot, 'level');
      bot.querySelector<HTMLButtonElement>('.pp-act')!.click();
      await flush();
      const engineId = `misty-${spec}-level-5`;
      expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
        botId: 'misty',
        gameSpecId: spec,
        engineId,
        mode: 'pve',
        rated: false,
      });
      expect(JSON.parse(localStorage.getItem('mistboard.playPanel.v1')!).bots[spec].botId).toBe(
        engineId,
      );
      expect(
        JSON.parse(localStorage.getItem('mistboard:setup:pve')!).engineIdByGameSpec[spec],
      ).toBe(engineId);
      expect(JSON.parse(localStorage.getItem('mistboard:last-bot-game')!).botId).toBe(engineId);
      const returning = buildPlayPanel('en', { hydrate: false });
      expect(stepValue(row(returning, spec), 'level')).toBe('Level 5');
      expect(returning.querySelector('.pp-feature-again')?.textContent).toContain('Misty Level 5');
      returning.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
      await flush();
      expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)).engineId).toBe(engineId);
    },
  );

  it.each(['banqi', 'jungle-flip'])('maps an old %s stored Misty pick to Level 7', (spec) => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ bots: { [spec]: { botId: 'misty', tc: '10m5' } } }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(row(board, spec), 'level')).toBe('Level 7');
    clickNext(row(board, spec), 'level', 4);
    expect(stepValue(row(board, spec), 'level')).toBe('Level 7');
  });

  it.each(['banqi', 'jungle-flip'])(
    'offers NNUE %s L8 only after the runtime roster confirms it',
    async (spec) => {
      vi.useFakeTimers();
      const engineId = `misty-${spec}-level-8`;
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({ bots: { [spec]: { botId: engineId, tc: '10m5' } } }),
      );
      let available = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          Response.json(
            url === '/api/engines/playable'
              ? {
                  [spec === 'banqi' ? 'banqiEngines' : 'jungleFlipEngines']: available
                    ? [{ id: engineId }]
                    : [],
                }
              : {},
          ),
        ),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      expect(stepValue(row(board, spec), 'level')).toBe('Level 4');
      await vi.advanceTimersByTimeAsync(0);
      expect(stepValue(row(board, spec), 'level')).toBe('Level 8');
      expect(row(board, spec).querySelector('.pp-step-tag')?.textContent).toBe('NNUE');
      board.remove();
      available = false;
      const noNet = buildPlayPanel('en');
      document.body.append(noNet);
      await vi.advanceTimersByTimeAsync(0);
      clickNext(row(noNet, spec), 'level', 12);
      expect(stepValue(row(noNet, spec), 'level')).toBe('Level 7');
      expect(row(noNet, spec).querySelector('.pp-step-tag')).toBeNull();
    },
  );

  it('puts the engine on top and the level with its NNUE tag under it', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const xiangqi = row(board, 'xiangqi');
    const main = () =>
      xiangqi.querySelector('.pp-step-level .pp-step-main')?.firstChild?.textContent;
    const tag = () => xiangqi.querySelector('.pp-step-level .pp-step-tag')?.textContent ?? null;
    const sub = () => xiangqi.querySelector('.pp-step-level .pp-step-sub')?.textContent ?? null;
    expect([main(), tag(), sub()]).toEqual(['Fairy-Stockfish', null, 'Level 2']);
    clickNext(xiangqi, 'level', 6);
    expect([main(), tag(), sub()]).toEqual(['Fairy-Stockfish', 'NNUE', 'Level 8']);
    // The tag rides the second line, never the engine name's.
    expect(xiangqi.querySelector('.pp-step-level .pp-step-main .pp-step-tag')).toBeNull();
    expect(xiangqi.querySelector('.pp-step-level .pp-step-meta .pp-step-tag')).not.toBeNull();
    clickNext(xiangqi, 'level');
    expect([main(), tag(), sub()]).toEqual(['Pikafish', 'NNUE', null]);
    expect(xiangqi.querySelector('.pp-step-level .pp-step-main')?.textContent).toBe('Pikafish');
    const jieqi = row(board, 'jieqi');
    expect(jieqi.querySelector('.pp-step-level .pp-step-main')?.firstChild?.textContent).toBe(
      'Pikafish',
    );
    expect(jieqi.querySelector('.pp-step-level .pp-step-tag')).toBeNull();
    // No name is gold: gold in this panel means a person.
    expect(board.querySelector('.pp-step-level .is-named')).toBeNull();
  });

  it('sizes the marker with a rule that outranks the shared 24px seed thumb', () => {
    // The production bundle loads landing.css after this panel's CSS, so an
    // equal-specificity .pp-thumb lost to .landing-lobby-seed-thumb (24px) in
    // prod while dev, loading them the other way round, showed 40px.
    const panelCss = readFileSync('src/landing-play-panel.css', 'utf8');
    const landingCss = readFileSync('src/landing.css', 'utf8');
    expect(landingCss).toMatch(/^\.landing-lobby-seed-thumb \{[^}]*width: 24px/m);
    expect(panelCss).toMatch(/^\.pp-board \.pp-thumb \{[^}]*width: var\(--pp-icon\)/m);
    expect(panelCss).not.toMatch(/^\.pp-thumb \{/m);
  });

  it('reserves ten natural-height rows on the shared card only in the three-column hero', () => {
    const css = readFileSync('src/landing-play-panel.css', 'utf8');
    const desktop = css.match(/@media \(min-width: 1241px\) \{([\s\S]*?)^\}/m)?.[1] ?? '';
    expect(desktop).toMatch(/--pp-min-rows: 10;/);
    expect(desktop).toMatch(/--pp-row-height: 40px;/);
    expect(desktop).toMatch(/--pp-card-border-width: 1px;/);
    expect(desktop).toMatch(
      /\.landing-demo \.pp-card \{[^}]*min-height: calc\(\s*var\(--pp-min-rows\) \* var\(--pp-row-height\) \+ 2 \* var\(--pp-card-border-width\)\s*\);[^}]*border-width: var\(--pp-card-border-width\);/,
    );
    expect(desktop).toMatch(
      /\.landing-demo \.pp-view-computer \.pp-row \{\s*flex: 0 0 auto;\s*min-height: var\(--pp-row-height\);/,
    );
    // No minimum leaks into the two-column or stacked layouts.
    expect(css.replace(desktop, '')).not.toContain('--pp-min-rows');

    const board = buildPlayPanel('en', { hydrate: false });
    const card = board.querySelector('.pp-card')!;
    expect(card.contains(board.querySelector('.pp-view-computer'))).toBe(true);
    expect(card.contains(board.querySelector('.pp-view-person'))).toBe(true);
    board.querySelectorAll<HTMLButtonElement>('.pp-tab')[1]!.click();
    expect(board.querySelector('.pp-card')).toBe(card);
  });

  // The stepper clips with an ellipsis: at 118px "3 days/move" read "3 days/…".
  // Its text needs 81px at 13.5px and the two 22px arrows with their 3px gaps
  // take 50, so the shared pace stepper is at least 131px wide.
  it('gives the shared pace stepper room for the whole days label', () => {
    const css = readFileSync('src/landing-play-panel.css', 'utf8');
    const width = Number(css.match(/\.pp-pace \.pp-step-clock \{\s*flex: 0 0 (\d+)px;/)?.[1]);
    expect(width).toBeGreaterThanOrEqual(131);
  });

  // Play a person never scrolls (2026-10-27): the tiles share the height left
  // under the open games, so on desktop their grid flexes and its rows shrink.
  it('lets the tile grid give up height instead of scrolling on desktop', () => {
    const css = readFileSync('src/landing-play-panel.css', 'utf8');
    const desktop = [...css.matchAll(/@media \(min-width: 641px\) \{([\s\S]*?)^\}/gm)]
      .map((m) => m[1])
      .join('\n');
    expect(desktop).toMatch(
      /\.pp-person-rows \{\s*flex: 1 1 auto;\s*min-height: 0;\s*grid-auto-rows: minmax\(min-content, 46px\);/,
    );
    expect(css).toMatch(
      /\.pp-offers,\n\.pp-person-rows \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    const phone = css.match(/@media \(max-width: 640px\) \{[\s\S]*$/)?.[0] ?? '';
    expect(phone).toMatch(
      /\.pp-offers,\n {2}\.pp-person-rows \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  // #543: .pp-name clips its overflow, so a line box shorter than the font's
  // glyph box (Noto Sans 1.36, CJK fallback 1.45) cuts descenders.
  it('gives both name lines a line box tall enough for descenders', () => {
    const panelCss = readFileSync('src/landing-play-panel.css', 'utf8');
    for (const selector of ['.pp-name-label', '.pp-playing']) {
      const block = panelCss.match(
        new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm'),
      )?.[1];
      const lineHeight = Number(block?.match(/line-height: ([\d.]+);/)?.[1]);
      expect(lineHeight, selector).toBeGreaterThanOrEqual(1.45);
    }
  });

  it('covers the bot list on the person tab instead of removing it', () => {
    // The bot list sets the panel's height for both tabs, so it must stay in
    // flow: [hidden] is display:none !important site-wide.
    const board = buildPlayPanel('en', { hydrate: false });
    const computer = board.querySelector<HTMLElement>('.pp-view-computer')!;
    const person = board.querySelector<HTMLElement>('.pp-view-person')!;
    const [computerTab, personTab] = board.querySelectorAll<HTMLButtonElement>('.pp-tab');
    personTab!.click();
    expect(computer.hidden).toBe(false);
    expect(computer.classList.contains('is-covered')).toBe(true);
    expect(computer.inert).toBe(true);
    expect(person.hidden).toBe(false);
    computerTab!.click();
    expect(computer.classList.contains('is-covered')).toBe(false);
    expect(computer.inert).toBe(false);
    expect(person.hidden).toBe(true);
  });

  it('only searches for a person from Find, never from a stray tile click', () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const person = row(board, 'xiangqi', 'person');
    person.querySelector<HTMLElement>('.pp-name')!.click();
    person.click();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(true);
  });

  it('offers KataGo above Misty in jungle once /api/bots says it is playable', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === '/api/bots') {
        return Response.json({
          bots: [
            {
              id: 'misty',
              playOptions: [
                { gameSpecId: 'jungle', playable: true },
                { gameSpecId: 'jungle-flip', playable: true },
              ],
            },
            { id: 'katago', playOptions: [{ gameSpecId: 'jungle', playable: true }] },
          ],
        });
      }
      if (input === '/api/rooms') return Response.json({ url: '/jungle/room-1' }, { status: 201 });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en');
    document.body.append(board);
    // Before the roster lands the row is the fixed Misty every box can serve.
    expect(row(board, 'jungle').querySelector('.pp-step-level.is-fixed')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    const jungle = row(board, 'jungle');
    expect(stepValue(jungle, 'level')).toBe('Misty');
    expect(jungle.querySelector('.pp-step-level.is-fixed')).toBeNull();
    const [easier, stronger] = jungle.querySelectorAll<HTMLButtonElement>(
      '.pp-step-level .pp-step-btn',
    );
    expect(easier?.getAttribute('aria-label')).toBe('Easier opponent');
    expect(stronger?.getAttribute('aria-label')).toBe('Stronger opponent');
    expect(easier?.disabled).toBe(true);
    clickNext(jungle, 'level');
    expect(stepValue(jungle, 'level')).toBe('KataGo');
    expect(stronger?.disabled).toBe(true);
    // A ResNet, not an NNUE: the general net tag (Brian, 2026-10-04).
    expect(jungle.querySelector('.pp-step-level .pp-step-meta .pp-step-tag')?.textContent).toBe(
      'Neural net',
    );
    // Flip Jungle's classical ladder does not depend on the bot profile.
    expect(stepValue(row(board, 'jungle-flip'), 'level')).toBe('Level 4');

    jungle.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();
    const create = fetchSpy.mock.calls.find(([url]) => url === '/api/rooms');
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      mode: 'pve',
      botId: 'katago',
      gameSpecId: 'jungle',
    });
    const stored = JSON.parse(localStorage.getItem('mistboard.playPanel.v1') ?? '{}');
    expect(stored.bots.jungle.botId).toBe('katago');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('comes back to a remembered KataGo, and never offers it when the server cannot seat it', async () => {
    vi.useFakeTimers();
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ bots: { jungle: { botId: 'katago', tc: '10m5' } } }),
    );
    let katagoPlayable = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input === '/api/bots'
          ? Response.json({
              bots: [
                { id: 'misty', playOptions: [{ gameSpecId: 'jungle', playable: true }] },
                {
                  id: 'katago',
                  playOptions: [{ gameSpecId: 'jungle', playable: katagoPlayable }],
                },
              ],
            })
          : Response.json({}),
      ),
    );
    const remembered = buildPlayPanel('en');
    document.body.append(remembered);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(stepValue(row(remembered, 'jungle'), 'level')).toBe('KataGo');
    remembered.remove();

    katagoPlayable = false;
    const unplayable = buildPlayPanel('en');
    document.body.append(unplayable);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const jungle = row(unplayable, 'jungle');
    expect(stepValue(jungle, 'level')).toBe('Misty');
    expect(jungle.querySelector('.pp-step-level.is-fixed')).not.toBeNull();
    unplayable.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('starts a bot game only from Play, never from a stray row click', () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const bot = row(board, 'xiangqi');
    bot.querySelector<HTMLElement>('.pp-name')!.click();
    bot.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never offers a fog bot a clock under a 5 s increment (#283)', () => {
    const fog = panelBotPaces('dark-chess');
    expect(fog.ids.length).toBeGreaterThan(0);
    expect(fog.ids).not.toContain('3m2');
    expect(fog.ids).not.toContain('1m1');
    expect(panelBotPaces('xiangqi').defaultId).toBe('10m5');
  });

  it('starts the chosen bot and clock in one click, labelled and remembered', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ url: '/xiangqi/room-1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const xiangqi = row(board, 'xiangqi');
    clickNext(xiangqi, 'level', 2);
    // Clock stepper: 10+5 is the slowest bot pace, so step down once.
    xiangqi.querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn')[0]!.click();
    xiangqi.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rooms');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      mode: 'pve',
      botId: 'fairy-stockfish-level-4',
      gameSpecId: 'xiangqi',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
    expect(JSON.parse(sessionStorage.getItem('mistboard.gameStartSource') ?? '{}').source).toBe(
      'panel-bot',
    );
    expect(JSON.parse(localStorage.getItem('mistboard:last-bot-game') ?? '{}')).toEqual({
      gameSpecId: 'xiangqi',
      botId: 'fairy-stockfish-level-4',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
  });

  // Brian, 2026-10-23: the row still named Duck Xiangqi against Fairy-Stockfish
  // Level 8 after a later game, because only this panel's own Play button wrote
  // its record. A game started from the setup dialog or a room's play again
  // writes the shared one, and the row follows it.
  it('offers Play again for a bot game started outside the panel', async () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({
        last: { gameSpecId: 'duck-xiangqi', botId: 'fairy-stockfish-level-8', tc: '10m5' },
      }),
    );
    // The setup dialog names the jieqi levels by engine id.
    localStorage.setItem(
      'mistboard:last-bot-game',
      JSON.stringify({
        gameSpecId: 'jieqi',
        botId: 'pikafish-jieqi-level-5',
        timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      }),
    );
    const fetchSpy = vi.fn(async () => Response.json({ url: '/jieqi/room-1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const again = board.querySelector('.pp-feature-again');
    expect(again?.textContent).toContain('Pikafish Level 5');
    expect(again?.textContent).not.toContain('Duck');
    expect(again?.textContent).toContain('5+5');

    board.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
    await flush();
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      mode: 'pve',
      botId: 'pikafish-level-5',
      gameSpecId: 'jieqi',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
  });

  it('offers no Play again for a last game at a pace the panel has no preset for', () => {
    localStorage.setItem(
      'mistboard:last-bot-game',
      JSON.stringify({
        gameSpecId: 'xiangqi',
        botId: 'fairy-stockfish-level-4',
        timeControl: { initialMs: 420_000, incrementMs: 0 },
      }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    expect(board.querySelector('.pp-feature-again')).toBeNull();
  });

  it('offers Play again for the last bot game, and keeps the picked level', () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({
        last: { gameSpecId: 'jieqi', botId: 'pikafish-level-5', tc: '10m5' },
        bots: { jieqi: { botId: 'pikafish-level-5', tc: '10m5' } },
      }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    const again = board.querySelector('.pp-feature-again');
    expect(again?.textContent).toContain('Play again');
    expect(again?.textContent).toContain('Pikafish Level 5');
    expect(stepValue(row(board, 'jieqi'), 'level')).toBe('Level 5');
  });

  it('shows a waiting player on top and counts open games on the person tab', async () => {
    vi.useFakeTimers();
    rememberLivePace();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/lobby') {
          return Response.json({
            requests: [
              {
                gameSpecId: 'xiangqi',
                rated: false,
                timeControl: { initialMs: 300_000, incrementMs: 5_000 },
                waitingMs: 14_000,
              },
            ],
          });
        }
        if (input === '/api/live-stats') return Response.json({ playingBySpec: { jieqi: 3 } });
        return Response.json({});
      }),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(board.querySelector('.pp-feature-waiting')?.textContent).toContain('Xiangqi');
    expect(board.querySelector('.pp-badge')?.textContent).toBe('1');
    expect(row(board, 'jieqi').querySelector('.pp-playing')?.textContent).toBe('3 playing');
    // Its own line under the label, so a long name cannot ellipsise it away.
    const jieqiName = row(board, 'jieqi').querySelector('.pp-name');
    expect(jieqiName?.querySelector('.pp-name-label')?.textContent).toBe('Jieqi');
    expect(jieqiName?.lastElementChild?.className).toBe('pp-playing');
    const person = row(board, 'xiangqi', 'person');
    expect(person.classList.contains('has-waiting')).toBe(true);
    expect(row(board, 'jieqi', 'person').classList.contains('has-waiting')).toBe(false);
    // The open game is a chip above the tiles.
    const chip = board.querySelector<HTMLElement>('.pp-offers .pp-offer');
    expect(chip?.dataset.gameSpec).toBe('xiangqi');
    expect(chip?.querySelector('.pp-tile-meta')?.textContent).toContain('5+5');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('does not offer you your own seek while you wait', async () => {
    vi.useFakeTimers();
    rememberLivePace();
    const mine = {
      gameSpecId: 'xiangqi',
      rated: false,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      waitingMs: 1_000,
    };
    let posted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === '/api/lobby' && init?.method === 'POST') {
          posted = true;
          return Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 });
        }
        if (input === '/api/lobby') return Response.json({ requests: posted ? [mine] : [] });
        return Response.json({});
      }),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    await vi.advanceTimersByTimeAsync(0);
    row(board, 'xiangqi', 'person').querySelector<HTMLButtonElement>('.pp-act')!.click();
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();

    expect(posted).toBe(true);
    expect(board.querySelector('.pp-offer')).toBeNull();
    expect(board.querySelector('.pp-feature-waiting')).toBeNull();
    expect(board.querySelector<HTMLElement>('.pp-badge')?.hidden).toBe(true);
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('sends a guest who picks Rated to sign in', () => {
    setRatedModeEnabled(true);
    const board = buildPlayPanel('en', { hydrate: false });
    const rated = [...board.querySelectorAll<HTMLButtonElement>('.pp-mode-btn')].find(
      (el) => el.textContent === 'Rated',
    );
    rated?.click();
    expect(window.location.href).toContain('/account?tab=login');
  });

  it('says in plain words why Rated is out of reach, per account state', async () => {
    const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
    await ensureLocaleCatalog('zh-Hans');
    await ensureLocaleCatalog('zh-Hant');
    const note = (board: HTMLElement) => board.querySelector('.pp-note')?.textContent;
    // Rated off on the server: no switch, no note.
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('');
    setRatedModeEnabled(true);
    // A guest is told to sign in.
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('Sign in to play rated games.');
    // A signed-in counted account in Casual sees nothing.
    setResolvedSignedIn(true);
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('');
    // A stats-excluded account plays casual only.
    setResolvedStatsExcluded(true);
    const excluded = buildPlayPanel('en', { hydrate: false });
    expect(note(excluded)).toBe('This account plays casual games only.');
    expect(note(buildPlayPanel('zh-Hans', { hydrate: false }))).toBe('此账号只能下休闲对局。');
    expect(note(buildPlayPanel('zh-Hant', { hydrate: false }))).toBe('此帳號只能下休閒對局。');
    for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      expect(note(buildPlayPanel(locale, { hydrate: false }))).not.toMatch(/counted|计入|計入|—/);
    }
  });

  it('shows Casual/Rated once /api/server-status turns rated on after the panel is built', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    expect(board.querySelectorAll('.pp-mode-btn')).toHaveLength(0);
    setRatedModeEnabled(true);
    const labels = [...board.querySelectorAll('.pp-mode-btn')].map((el) => el.textContent);
    expect(labels).toEqual(['Casual', 'Rated']);
  });

  it('opens signed in on 3 days per move for every tile, with no bot-offer note', () => {
    setResolvedSignedIn(true);
    const board = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(paceBar(board), 'clock')).toBe('3 days/move');
    const days = paceBar(board).querySelector('[data-family="days"]');
    expect(days?.getAttribute('aria-pressed')).toBe('true');
    const person = row(board, 'xiangqi', 'person');
    expect(person.querySelector('.pp-act')?.textContent).toBe('+ Post');
    expect(person.querySelector('.pp-act')?.getAttribute('aria-label')).toBe(
      '+ Post: Xiangqi · 3 days/move',
    );
    expect(tileNote(person)).toBeNull();
    expect(board.querySelector('.pp-note')?.textContent).toBe('');
    // The pace bar is one control: no tile has its own stepper.
    expect(board.querySelectorAll('.pp-view-person .pp-step-clock')).toHaveLength(1);
    // Rated has no days while rated correspondence is held, so it opens on 5+5
    // and says why the days went away.
    setRatedModeEnabled(true);
    const signedIn = buildPlayPanel('en', { hydrate: false });
    [...signedIn.querySelectorAll<HTMLButtonElement>('.pp-mode-btn')]
      .find((el) => el.textContent === 'Rated')!
      .click();
    expect(stepValue(paceBar(signedIn), 'clock')).toBe('5+5');
    expect(
      paceBar(signedIn).querySelector<HTMLButtonElement>('[data-family="days"]')?.disabled,
    ).toBe(true);
    expect(row(signedIn, 'xiangqi', 'person').querySelector('.pp-act')?.textContent).toBe('Find');
    expect(signedIn.querySelector('.pp-note')?.textContent).toBe(
      'Rated: 1+1, 3+2, 5+5, 10+5. Correspondence is casual for now.',
    );
  });

  it('offers a signed-out visitor live clocks only, opening on 5+5 with Find', () => {
    setResolvedSignedIn(false);
    // An old pick of days per move on this device does not bring days back.
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ people: { xiangqi: '3d' }, personFamily: 'days', personPace: '7d' }),
    );
    expect(panelPersonPaces('xiangqi', 'casual', false).every((p) => p.kind === 'live')).toBe(true);
    const board = buildPlayPanel('en', { hydrate: false });
    const bar = paceBar(board);
    expect(stepValue(bar, 'clock')).toBe('5+5');
    const days = bar.querySelector<HTMLButtonElement>('[data-family="days"]')!;
    expect(days.disabled).toBe(true);
    expect(days.title).toBe('Sign in for days per move');
    const hint = bar.querySelector<HTMLAnchorElement>('.pp-pace-hint');
    expect(hint?.textContent).toBe('Sign in for days per move');
    expect(hint?.getAttribute('href')).toContain('/account?tab=login');
    expect(tiles(board).length).toBeGreaterThan(1);
    for (const person of tiles(board)) {
      expect(person.querySelector('.pp-act')?.textContent, person.dataset.gameSpec).toBe('Find');
    }
    // Walk the whole stepper: no days per move anywhere, on the bar or a tile.
    clickNext(bar, 'clock', 12);
    expect(stepValue(paceBar(board), 'clock')).not.toMatch(/day/);
    for (const person of tiles(board)) {
      expect(person.querySelector('.pp-act')?.getAttribute('aria-label')).not.toMatch(/day/);
    }
  });

  it('labels one day per move in the singular', () => {
    setResolvedSignedIn(true);
    const board = buildPlayPanel('en', { hydrate: false });
    const prev = () =>
      paceBar(board).querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn')[0]!.click();
    prev();
    prev();
    expect(stepValue(paceBar(board), 'clock')).toBe('1 day/move');
  });

  it('moves every tile with the one shared pace, and names a game that lacks it', () => {
    // Xiangqi Mahjong plays two live clocks and no days per move.
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    setResolvedSignedIn(true);
    rememberLivePace();
    const board = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(paceBar(board), 'clock')).toBe('5+5');
    for (const el of tiles(board)) {
      expect(el.querySelector('.pp-act')?.getAttribute('aria-label'), el.dataset.gameSpec).toMatch(
        / · 5\+5$/,
      );
      expect(tileNote(el), el.dataset.gameSpec).toBeNull();
    }
    // Days per move: every tile posts at 3 days, but Xiangqi Mahjong has no days
    // per move and says which clock it plays instead.
    paceBar(board).querySelector<HTMLButtonElement>('[data-family="days"]')!.click();
    expect(stepValue(paceBar(board), 'clock')).toBe('3 days/move');
    const mahjongSeen = tiles(board).some((el) => el.dataset.gameSpec === 'xiangqi-mahjong');
    expect(mahjongSeen).toBe(true);
    for (const el of tiles(board)) {
      const spec = el.dataset.gameSpec!;
      const hasDays = panelPersonPaces(spec as never, 'casual', true).some(
        (p) => p.kind === 'days',
      );
      const label = el.querySelector('.pp-act')?.getAttribute('aria-label') ?? '';
      if (hasDays) {
        expect(label, spec).toMatch(/ · 3 days\/move$/);
        expect(tileNote(el), spec).toBeNull();
      } else {
        expect(el.querySelector('.pp-act')?.textContent, spec).toBe('Find');
        expect(tileNote(el), spec).toBe('5+5 only');
      }
    }
    expect(tileNote(row(board, 'xiangqi-mahjong', 'person'))).toBe('5+5 only');
    // Walk every live clock: a tile that has it plays it with no note; one
    // that lacks it plays its nearest live clock and says so.
    paceBar(board).querySelector<HTMLButtonElement>('[data-family="live"]')!.click();
    const btns = () =>
      paceBar(board).querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn');
    for (let i = 0; i < 12; i++) btns()[0]!.click();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const shown = stepValue(paceBar(board), 'clock');
      seen.add(shown);
      for (const el of tiles(board)) {
        const spec = el.dataset.gameSpec!;
        const label = el.querySelector('.pp-act')?.getAttribute('aria-label') ?? '';
        const note = tileNote(el);
        if (label.endsWith(` · ${shown}`)) expect(note, `${spec} ${shown}`).toBeNull();
        else expect(note, `${spec} ${shown}: ${label}`).toMatch(/^\S+ instead$/);
      }
      btns()[1]!.click();
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('remembers the one shared pace on this device', () => {
    setResolvedSignedIn(true);
    rememberLivePace();
    const board = buildPlayPanel('en', { hydrate: false });
    // Days per move, then down from 3 days to 1.
    paceBar(board).querySelector<HTMLButtonElement>('[data-family="days"]')!.click();
    paceBar(board).querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn')[0]!.click();
    paceBar(board).querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn')[0]!.click();
    expect(stepValue(paceBar(board), 'clock')).toBe('1 day/move');
    const again = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(paceBar(again), 'clock')).toBe('1 day/move');
    expect(row(again, 'jieqi', 'person').querySelector('.pp-act')?.getAttribute('aria-label')).toBe(
      '+ Post: Jieqi · 1 day/move',
    );
    const stored = JSON.parse(localStorage.getItem('mistboard.playPanel.v1')!);
    expect(stored.personFamily).toBe('days');
    expect(stored.personPace).toBe('1d');
    expect(stored.personPicks).toBeUndefined();
  });

  it('reads old or broken panel storage without crashing, and drops the per-row records', () => {
    setResolvedSignedIn(true);
    for (const raw of ['null', '[]', '7', '{"personPace":5,"personFamily":"weekly"}']) {
      localStorage.setItem('mistboard.playPanel.v1', raw);
      const board = buildPlayPanel('en', { hydrate: false });
      expect(stepValue(paceBar(board), 'clock'), raw).toBe('3 days/move');
    }
    // The per-row records from before the shared pace are ignored.
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({
        tab: 'person',
        people: { xiangqi: '5m5' },
        personPicks: { jieqi: '7d' },
      }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(paceBar(board), 'clock')).toBe('3 days/move');
    clickNext(paceBar(board), 'clock');
    const stored = JSON.parse(localStorage.getItem('mistboard.playPanel.v1')!);
    expect(stored.people).toBeUndefined();
    expect(stored.personPicks).toBeUndefined();
    expect(stored.tab).toBe('person');
    expect(stored.personPace).toBe('7d');
  });

  it('posts a days-per-move seek straight from + Post and lands on /correspondence', async () => {
    setResolvedSignedIn(true);
    const navigate = vi.fn();
    setRoomNavigator(navigate);
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) =>
      Response.json({ seek: { gameSpecId: 'jieqi' } }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      clickNext(paceBar(board), 'clock'); // 3 days -> 7 days
      expect(stepValue(paceBar(board), 'clock')).toBe('7 days/move');
      row(board, 'jieqi', 'person').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await flush();
      expect(document.querySelector('.landing-setup-overlay')).toBeNull();
      const post = fetchSpy.mock.calls.find(([url]) => url === '/api/correspondence/seeks');
      expect(post?.[1]?.method).toBe('POST');
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        gameSpecId: 'jieqi',
        daysPerMove: 7,
        preferredColor: 'random',
      });
      expect(navigate).toHaveBeenCalledWith('/correspondence');
    } finally {
      setRoomNavigator(null);
      document.body.replaceChildren();
    }
  });

  it('shows why a + Post failed and keeps the button for another try', async () => {
    setResolvedSignedIn(true);
    const navigate = vi.fn();
    setRoomNavigator(navigate);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'needs_account' }, { status: 401 })),
    );
    try {
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      const xiangqi = row(board, 'xiangqi', 'person');
      xiangqi.querySelector<HTMLButtonElement>('.pp-act')!.click();
      await flush();
      await flush();
      expect(navigate).not.toHaveBeenCalled();
      const bar = board.querySelector<HTMLElement>('.pp-search')!;
      expect(bar.hidden).toBe(false);
      expect(bar.querySelector('.pp-search-status')?.textContent).not.toBe('');
      expect(xiangqi.querySelector('.pp-act')?.textContent).toBe('Try again');
      bar.querySelector<HTMLButtonElement>('.pp-search-cancel')!.click();
      expect(bar.hidden).toBe(true);
      expect(row(board, 'xiangqi', 'person').querySelector('.pp-act')?.textContent).toBe('+ Post');
    } finally {
      setRoomNavigator(null);
      document.body.replaceChildren();
    }
  });

  it('shows four open games at most: past four, three and a link to the rest', async () => {
    vi.useFakeTimers();
    rememberLivePace();
    const request = (gameSpecId: string) => ({
      gameSpecId,
      rated: false,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      waitingMs: 1_000,
    });
    const specs = ['xiangqi', 'jieqi', 'banqi', 'xiangqi', 'jieqi', 'banqi'];
    let open = specs.slice(0, 4);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/lobby') return Response.json({ requests: open.map(request) });
        return Response.json({});
      }),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(board.querySelectorAll('.pp-offers .pp-offer')).toHaveLength(4);
    expect(board.querySelector('.pp-offers-more')).toBeNull();
    open = specs;
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(board.querySelectorAll('.pp-offers .pp-offer')).toHaveLength(3);
    const more = board.querySelector<HTMLAnchorElement>('.pp-offers-more');
    expect(more?.textContent).toBe('+3 more');
    expect(more?.getAttribute('href')).toBe('/correspondence');
    expect(board.querySelector('.pp-view-person .pp-section')?.textContent).toBe('Open games · 6');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('narrows rated to the rated clocks; days per move are rated where correspondence rates', () => {
    // Rated switch off: rated is live clocks only.
    const rated = panelPersonPaces('xiangqi', 'rated', true);
    const ratedIds = new Set(RATED_TIME_CONTROLS.map((tc) => tc.id));
    expect(rated.every((p) => p.kind === 'live' && ratedIds.has(p.id))).toBe(true);
    const casual = panelPersonPaces('xiangqi', 'casual', true);
    expect(casual.some((p) => p.kind === 'days')).toBe(true);
    // Every variant plays by correspondence since 2026-10-02.
    expect(panelPersonPaces('jieqi', 'casual', true).some((p) => p.kind === 'days')).toBe(true);
    // Rated switch off: no rated days anywhere.
    expect(panelPersonPaces('jieqi', 'rated', true).some((p) => p.kind === 'days')).toBe(false);
    // Rated switch on (2026-10-02): a correspondence-rated variant offers days in Rated
    // too, live clocks still narrowed to the rated ones.
    // Live rated on alone (rated correspondence held, the default): no rated days.
    setRatedModeEnabled(true);
    expect(panelPersonPaces('xiangqi', 'rated', true).some((p) => p.kind === 'days')).toBe(false);
    setRatedModeEnabled(true, true);
    const ratedOn = panelPersonPaces('xiangqi', 'rated', true);
    expect(ratedOn.filter((p) => p.kind === 'live').every((p) => ratedIds.has(p.id))).toBe(true);
    expect(ratedOn.some((p) => p.kind === 'days')).toBe(true);
    expect(panelPersonPaces('jieqi', 'rated', true).some((p) => p.kind === 'days')).toBe(true);
  });

  it('orders rows in canonical order', () => {
    expect(orderPanelSpecs(['fortress-xiangqi', 'banqi', 'crazyhouse-xiangqi', 'xiangqi'])).toEqual(
      ['xiangqi', 'banqi', 'crazyhouse-xiangqi', 'fortress-xiangqi'],
    );
  });

  it('ignores a play-count order cached by an earlier visit', () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ order: ['jieqi', 'banqi', 'xiangqi', 'crazyhouse-xiangqi'] }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    const specs = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (row) => row.dataset.gameSpec as string,
    );
    expect(specs.length).toBeGreaterThan(1);
    expect(specs).toEqual(orderPanelSpecs(specs));
    expect(specs[0]).toBe('xiangqi');
  });

  // Prod, 2026-10-09: a guest's seek outlived the bot game the same tab
  // started, and the next joiner was seated in a room nobody entered.
  describe('an open seek', () => {
    type Call = { url: string; method: string; keepalive: boolean };
    const lobbyFetch = (opts: { post?: Promise<Response>; poll?: () => Response } = {}) => {
      const calls: Call[] = [];
      const fn = vi.fn(async (input: string, init?: RequestInit) => {
        calls.push({ url: input, method: init?.method ?? 'GET', keepalive: !!init?.keepalive });
        if (input === '/api/lobby' && init?.method === 'POST') {
          return (
            opts.post ??
            Response.json(
              { status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 },
              { status: 202 },
            )
          );
        }
        if (input === '/api/lobby/t1' && !init?.method && opts.poll) return opts.poll();
        if (input === '/api/rooms') return Response.json({ url: '/room/bot-1' }, { status: 201 });
        return Response.json({ ok: true });
      });
      vi.stubGlobal('fetch', fn);
      const index = (url: string, method: string): number =>
        calls.findIndex((c) => c.url === url && c.method === method);
      const deletes = (): Call[] => calls.filter((c) => c.method === 'DELETE');
      return { calls, index, deletes };
    };
    const settle = async (ms = 0): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
      await flush();
    };
    const seek = async (board: HTMLElement): Promise<void> => {
      row(board, 'xiangqi', 'person').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();
    };

    beforeEach(() => {
      vi.useFakeTimers();
      rememberLivePace();
    });
    afterEach(async () => {
      await withdrawLobbySeeks();
    });

    it('withdraws the seek before a bot row starts its game', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(false);

      row(board, 'jieqi').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
      expect(net.calls[del]?.keepalive).toBe(true);
      expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(true);
      expect(openLobbySeekCount()).toBe(0);
    });

    it('withdraws the seek before Play again starts its game', async () => {
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({
          last: { gameSpecId: 'jieqi', botId: 'pikafish-level-5', tc: '10m5' },
          people: { xiangqi: '5m5' },
        }),
      );
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);

      board.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
    });

    it('deletes a ticket whose POST was still in flight when a bot game started', async () => {
      let answer!: (r: Response) => void;
      const post = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      const net = lobbyFetch({ post });
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      row(board, 'jieqi').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();
      expect(net.index('/api/rooms', 'POST')).toBe(-1);

      answer(Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 }));
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
    });

    it('withdraws the seek with a keepalive DELETE when the page goes away', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);

      window.dispatchEvent(new Event('pagehide'));
      await settle();

      expect(net.deletes()).toEqual([{ url: '/api/lobby/t1', method: 'DELETE', keepalive: true }]);
    });

    it('stops listening for pagehide once the seek is cancelled or matched', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      board.querySelector<HTMLButtonElement>('.pp-search-cancel')!.click();
      await settle();
      expect(net.deletes()).toHaveLength(1);
      window.dispatchEvent(new Event('pagehide'));
      await settle();
      expect(net.deletes()).toHaveLength(1);

      const matched = lobbyFetch({
        post: Promise.resolve(
          Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 1_000 }),
        ),
        poll: () => Response.json({ status: 'matched', ticketId: 't1', url: '/room/r1' }),
      });
      await seek(board);
      await settle(1_000);
      expect(matched.index('/api/lobby/t1', 'GET')).toBeGreaterThanOrEqual(0);
      window.dispatchEvent(new Event('pagehide'));
      await settle();
      expect(matched.deletes()).toEqual([]);
      expect(openLobbySeekCount()).toBe(0);
    });
  });

  it('is on by default; ?hero=lobby brings the old tabs back until ?hero=grid', () => {
    expect(playPanelEnabled('')).toBe(true);
    expect(playPanelEnabled('?hero=lobby')).toBe(false);
    expect(playPanelEnabled('')).toBe(false);
    expect(playPanelEnabled('?hero=grid')).toBe(true);
    expect(playPanelEnabled('')).toBe(true);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
