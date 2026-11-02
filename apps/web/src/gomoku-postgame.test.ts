import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  type GomokuOpening,
  getGomokuPlayerView,
  parseGomokuMove,
  parseRapfiOutput,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import longGame from '../../../fixtures/gomoku/long-review.json';
import { writeDisplayPreference } from './display-preferences.js';
import type { GomokuPostgameResponse } from './gomoku-postgame.js';
import type { XiangqiGameAnalysisResponse } from './review/game-analysis.js';

const ROOM = 'gmk_review';

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: { type: string; commands?: string[] }[] = [];
  terminate = vi.fn();
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(message: { type: string; commands?: string[] }) {
    this.sent.push(message);
  }
  emit(data: object) {
    this.onmessage?.({ data } as MessageEvent);
  }
  output(score = '482') {
    for (const line of `INFO PV 0\nINFO NUMPV 1\nINFO DEPTH 9\nINFO SELDEPTH 12\nINFO NODES 413\nINFO TOTALNODES 3925\nINFO TOTALTIME 30\nINFO SPEED 130833\nINFO EVAL ${score}\nINFO WINRATE 0.9\nINFO BESTLINE 1,1 2,1\nINFO PV DONE`.split(
      '\n',
    ))
      this.emit({ type: 'line', line });
    this.emit({ type: 'done', elapsedMs: 40 });
  }
}

function fixture(opening?: GomokuOpening): GomokuPostgameResponse {
  let state = createGomokuRoomState(ROOM, opening);
  const history = [{ ply: 0, at: 1000, view: getGomokuPlayerView(state, 'black', true) }];
  const timeline: GomokuPostgameResponse['timeline'] = [];
  for (const [index, to] of (['a1', 'b1', 'a2'] as const).entries()) {
    const color = state.status.type === 'playing' ? state.status.turn : 'black';
    state = applyGomokuRoomMove(state, { to });
    const ply = index + 1;
    timeline.push({ type: 'move-played', color, move: { to }, ply, at: 1000 + ply * 1000 });
    history.push({ ply, at: 1000 + ply * 1000, view: getGomokuPlayerView(state, 'black', true) });
  }
  state = { ...state, status: { type: 'finished', winner: 'black', reason: 'resignation' } };
  history[3] = { ply: 3, at: 5000, view: getGomokuPlayerView(state, 'black', true) };
  return {
    game: {
      roomId: ROOM,
      variant: 'gomoku',
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: 3,
      rated: false,
      initialMs: null,
      incrementMs: null,
      players: [
        { color: 'black', name: 'Alice' },
        { color: 'white', name: 'Bob' },
      ],
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    view: getGomokuPlayerView(state, 'black', true),
    history: { truth: history },
    timeline,
  };
}

function longRecording(): GomokuPostgameResponse {
  const payload = fixture();
  let state = createGomokuRoomState(ROOM, longGame.opening as GomokuOpening);
  payload.history.truth = [{ ply: 0, at: 0, view: getGomokuPlayerView(state, 'black', true) }];
  payload.timeline = [];
  for (const entry of longGame.plies) {
    const move = parseGomokuMove(entry.uci)!;
    state = applyGomokuRoomMove(state, move);
    payload.history.truth.push({
      ply: entry.ply,
      at: entry.ply * 1000,
      view: getGomokuPlayerView(state, 'black', true),
    });
    payload.timeline.push({
      type: 'move-played',
      ply: entry.ply,
      at: entry.ply * 1000,
      color: entry.mover as 'black' | 'white',
      move,
    });
  }
  payload.game = {
    ...payload.game,
    mode: 'eve',
    plyCount: longGame.ply_count,
    termination: longGame.termination,
    result: longGame.result === 'draw' ? 'draw' : `${longGame.result}-wins`,
  };
  payload.view = getGomokuPlayerView(state, 'black', true);
  payload.state = { status: state.status, moveNumber: state.moveNumber };
  return payload;
}

const capture = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
  window.history.replaceState(null, '', `/gomoku/game/${ROOM}`);
  document.body.innerHTML = '<div id="app"></div>';
  capture.mockClear();
  WorkerStub.instances = [];
  vi.stubGlobal('Worker', WorkerStub);
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(
  payload: unknown,
  status = 200,
  admin?: boolean,
  analysis?: XiangqiGameAnalysisResponse,
) {
  vi.resetModules();
  const { setResolvedAdmin } = await import('./signed-in-state.js');
  setResolvedAdmin(admin);
  const { setPostHogInstance } = await import('./analytics.js');
  setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/analysis/jobs/'))
      return Response.json({ status: 'done', result: analysis });
    if (String(input).endsWith('/analysis'))
      return init?.method === 'POST'
        ? Response.json({ jobId: 'sweep' }, { status: 202 })
        : new Response(null, { status: 204 });
    return new Response(
      JSON.stringify(String(input).startsWith('/api/gomoku/games/') ? payload : {}),
      {
        status: String(input).startsWith('/api/gomoku/games/') ? status : 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', fetchSpy);
  const { currentLocale } = await import('./i18n/locale.js');
  const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
  await ensureLocaleCatalog(currentLocale());
  const { mountGomokuPostgame } = await import('./gomoku-postgame.js');
  const root = document.querySelector<HTMLDivElement>('#app')!;
  mountGomokuPostgame(root, ROOM);
  await vi.advanceTimersByTimeAsync(0);
  return { root, fetchSpy };
}

const key = (name: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name }));

describe('Gomoku finished-game review', () => {
  it('requests the existing sweep and keeps the shared graph in sync with navigation', async () => {
    const analysis = {
      engineId: 'rapfi-gomoku',
      depth: 0,
      plies: [
        { ply: 0, cp: null, mate: null, best: null },
        { ply: 1, cp: 100, mate: null, best: 'b1' },
        { ply: 2, cp: -100, mate: null, best: 'a2' },
        { ply: 3, cp: null, mate: 3, best: 'b2' },
      ],
    };
    const { root, fetchSpy } = await mount(fixture(), 200, true, analysis);
    const button = root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]');
    expect(button).not.toBeNull();
    button!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSpy).toHaveBeenCalledWith(`/api/gomoku/games/${ROOM}/analysis`, { method: 'POST' });
    expect(fetchSpy).toHaveBeenCalledWith(`/api/gomoku/games/${ROOM}/analysis/jobs/sweep`, {
      method: 'GET',
    });
    const curve = root.querySelector('.advantage-chart__line')!;
    expect(curve.getAttribute('points')?.split(' ')).toHaveLength(4);
    expect(curve.getAttribute('points')).not.toMatch(/NaN|Infinity/);
    key('Home');
    key('ArrowRight');
    expect(root.querySelector('.advantage-chart__cursor')?.getAttribute('x1')).toBe('100.00');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(1);
  });

  it('keeps server analysis and the local switch admin-only even with the flag on', async () => {
    const { root } = await mount(fixture(), 200, false);
    expect(root.querySelector('[data-gomoku-analyse], .engine-panel')).toBeNull();
  });

  it('draws local Rapfi best move and numbered PV at the selected ply and clears stale output', async () => {
    const { root } = await mount(fixture(), 200, true);
    key('Home');
    key('ArrowRight');
    root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
    const worker = WorkerStub.instances.at(-1)!;
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.sent.flatMap((message) => message.commands ?? [])).toContain(
      'YXBOARD\n0,0,2\nDONE',
    );
    worker.output();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.gomoku-best')?.getAttribute('data-square')).toBe('b2');
    expect(root.querySelectorAll('.gomoku-pv-number')).toHaveLength(2);
    key('ArrowRight');
    expect(root.querySelector('.gomoku-best')).toBeNull();
    expect(worker.terminate).toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    worker.output();
    expect(root.querySelector('.gomoku-best')).toBeNull();
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'])(
    'translates sweep progress, retry and forced-five output in %s',
    async (locale) => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });
      window.history.replaceState(null, '', `/gomoku/game/${ROOM}?lang=${locale}`);
      const { root, fetchSpy } = await mount(fixture(), 200, true);
      const { t } = await import('./i18n/catalog.js');
      const button = root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]')!;
      expect(button.textContent).toBe(t('replay.analyse'));
      fetchSpy.mockImplementation(async () =>
        Response.json({ status: 'failed', error: 'analysis_engine_unavailable' }),
      );
      button.click();
      expect(button.textContent).toBe(t('replay.analysingWholeGame'));
      await vi.advanceTimersByTimeAsync(0);
      expect(button.disabled).toBe(false);
      // A failed request stays retryable. The actual async queue error gets
      // its existing unavailable copy, rather than an empty graph.
      fetchSpy.mockImplementation(async (input: RequestInfo | URL) =>
        String(input).includes('/jobs/')
          ? Response.json({ status: 'failed', error: 'analysis_engine_unavailable' })
          : Response.json({ jobId: 'failed' }, { status: 202 }),
      );
      button.click();
      await vi.advanceTimersByTimeAsync(2000);
      expect(button.textContent).toBe(t('engine.unavailable', { error: 'Rapfi' }));
      expect(button.disabled).toBe(false);
      key('Home');
      root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
      const worker = WorkerStub.instances.at(-1)!;
      worker.emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(0);
      worker.output('+M5');
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('.engine-panel__eval')?.textContent).toBe(
        locale === 'en'
          ? 'Black wins in 3'
          : locale === 'zh-Hans'
            ? '黑方 3 步内获胜'
            : '黑方 3 步內獲勝',
      );
    },
  );
  it('keeps the fixed board orientation, has no hover stone or flip, and follows coordinates', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const { root } = await mount(fixture());
    const stone = root.querySelector('[data-piece-square="a1"]')!;
    expect([stone.getAttribute('cx'), stone.getAttribute('cy')]).toEqual(['32', '480']);
    expect(root.querySelector('[data-replay-flip]:not([hidden]), .gomoku-ghost')).toBeNull();
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
    writeDisplayPreference('boardCoordinates', true);
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(30);
    writeDisplayPreference('boardCoordinates', false);
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
  });
  it.each(['en', 'zh-Hans', 'zh-Hant'])('offers the JSON download in %s', async (locale) => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    window.history.replaceState(null, '', `/gomoku/game/${ROOM}?lang=${locale}`);
    const { root } = await mount(fixture());
    const link = root.querySelector<HTMLAnchorElement>('a[download$=".json"]');
    expect(link?.getAttribute('href')).toBe(`/api/games/${ROOM}/export.json`);
    expect(link?.download).toBe(`mistboard-${ROOM}.json`);
    expect(link?.textContent).toBe('JSON');
    expect(link?.closest('.review-share__row')?.textContent).toContain(
      locale === 'en' ? 'Download' : locale === 'zh-Hans' ? '下载' : '下載',
    );
  });
  for (const enabled of [false, true]) {
    it.each([undefined, false, true])(
      `admits review by role with flag ${enabled}: admin %s`,
      async (admin) => {
        vi.stubEnv('VITE_GOMOKU_ENABLED', String(enabled));
        const { root, fetchSpy } = await mount(fixture(), 200, admin);
        const admitted = enabled || admin === true;
        expect(
          fetchSpy.mock.calls.some(([input]) => String(input).startsWith('/api/gomoku/')),
        ).toBe(admitted);
        expect(Boolean(root.querySelector('.gomoku-live-board'))).toBe(admitted);
        expect(Boolean(root.querySelector('[data-replay-analysis]:not([hidden])'))).toBe(admitted);
      },
    );
  }

  it.each([3, 4, 5])(
    'keeps the recorded %i-stone opening through board and move-list navigation',
    async (count) => {
      const opening = GOMOKU_OPENINGS.find((entry) => entry.stones.length === count)!;
      const payload = fixture(opening);
      const { root, fetchSpy } = await mount(payload);
      expect(fetchSpy).toHaveBeenCalledWith(`/api/gomoku/games/${ROOM}`);
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 3);
      expect(root.querySelector('.game-meta-card')?.textContent).toContain('Gomoku');
      expect(root.querySelector('.move-list')?.textContent).toContain('a1');
      key('Home');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      for (const { square, color } of opening.stones) {
        expect(
          root.querySelector(`[data-piece-square="${square}"]`)?.getAttribute('class'),
        ).toContain(color);
      }
      key('ArrowRight');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 1);
      const second = [
        ...root.querySelectorAll<HTMLButtonElement>('.move-list button.move-jump'),
      ].find((button) => button.textContent === 'b1');
      expect(second).toBeDefined();
      second?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 2);
      key('End');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 3);
      root.querySelector<HTMLElement>('[data-replay="first"]')?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      expect(
        root.querySelector('[data-square="b2"] .gomoku-hit')?.getAttribute('tabindex'),
      ).not.toBe('0');
      expect(root.querySelector('.presence-dot, .postgame-actions')).toBeNull();
      expect(capture.mock.calls.filter(([name]) => name === 'review_opened')).toEqual([
        [
          'review_opened',
          expect.objectContaining({
            variant: 'gomoku',
            game_spec: 'gomoku',
            route: '/gomoku/game/:id',
            review_surface: 'game',
            has_analysis: true,
          }),
        ],
      ]);
      expect(
        capture.mock.calls.filter(([name]) => ['game_started', 'game_finished'].includes(name)),
      ).toEqual([]);
    },
  );

  it('hands the recorded opening and full game to analysis at the selected ply with the flag off', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const opening = GOMOKU_OPENINGS.find((entry) => entry.stones.length === 3)!;
    const { root } = await mount(fixture(opening), 200, true);
    key('Home');
    key('ArrowRight');
    const link = root.querySelector<HTMLAnchorElement>('[data-replay-analysis]:not([hidden])')!;
    expect(link).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-move-nav-menu]')!.click();
    expect(link.textContent).toContain('Analyse from here');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/analysis/gomoku');
    expect(url.searchParams.get('ply')).toBe('1');
    // Follow the actual link through the analysis mount, without browser navigation.
    window.dispatchEvent(new Event('pagehide'));
    window.history.replaceState(null, '', url);
    const { mountVariantAnalysisPage } = await import('./variant-analysis.js');
    await mountVariantAnalysisPage(root, 'gomoku', document.createElement('div'));
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(4);
    for (const stone of opening.stones) {
      expect(
        root
          .querySelector(`[data-piece-square="${stone.square}"]`)
          ?.classList.contains(`gomoku-stone--${stone.color}`),
      ).toBe(true);
    }
    key('End');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(6);
    expect(root.querySelector('.review-move-list')?.textContent).toContain('a2');
  });

  it('opens at the linked ply and reads the recorded clocks without advancing them', async () => {
    const payload = fixture(GOMOKU_OPENINGS.find((entry) => entry.stones.length === 3)!);
    payload.state.timeControl = { initialMs: 60_000, incrementMs: 1000 };
    payload.history.truth = payload.history.truth.map((frame) => ({
      ...frame,
      clock: {
        remainingMs: { black: 60_000 - frame.ply * 1000, white: 60_000 - frame.ply * 2000 },
        activeColor: frame.view.status.type === 'playing' ? frame.view.status.turn : null,
        runningSince: frame.at,
        initialMs: 60_000,
        incrementMs: 1000,
      },
    }));
    window.history.replaceState(null, '', `/gomoku/game/${ROOM}?ply=1`);
    const { root } = await mount(payload);
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(4);
    const clocks = () =>
      [...root.querySelectorAll('.clock-time-row strong')].map((el) => el.textContent);
    expect(clocks()).toContain('00:59');
    expect(clocks()).toContain('00:58');
    const before = clocks();
    await vi.advanceTimersByTimeAsync(5000);
    expect(clocks()).toEqual(before);
  });

  it('supports legacy empty-board recordings and clamps a linked ply to the end', async () => {
    window.history.replaceState(null, '', `/gomoku/game/${ROOM}?ply=9999`);
    const { root } = await mount(fixture());
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(3);
    key('Home');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'])(
    'uses existing localized review strings in %s',
    async (locale) => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });
      window.history.replaceState(null, '', `/gomoku/game/${ROOM}?lang=${locale}`);
      const { root } = await mount({ error: 'not_found' }, 404);
      expect(root.querySelector('.gomoku-live-board')).toBeNull();
      expect(root.querySelector('h1')?.textContent).toBeTruthy();
      expect(root.textContent).toContain(locale === 'en' ? 'Gomoku' : '五子棋');
      expect(capture).not.toHaveBeenCalled();
    },
  );

  // The server serves the export only under the flag (gomoku-registration.ts),
  // so an admin on prod reviews a game with no download link to a 404.
  it('offers no download to an admin while the flag is off', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { root } = await mount(fixture(), 200, true);
    expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
    expect(root.querySelector('a[download]')).toBeNull();
  });

  it('does not fetch or count a review while the flag is off', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { root, fetchSpy } = await mount(fixture());
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/gomoku/')),
    ).toEqual([]);
    expect(root.querySelector('.gomoku-live-board')).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(['unfinished', 'missing-root', 'wrong-room', 'wrong-variant', 'rated'])(
    'refuses a %s recording',
    async (kind) => {
      const payload = fixture();
      if (kind === 'unfinished') payload.view = payload.history.truth[0]!.view;
      if (kind === 'missing-root') payload.history.truth = payload.history.truth.slice(1);
      if (kind === 'wrong-room') payload.game.roomId = 'gmk_other';
      if (kind === 'wrong-variant') (payload.game as { variant: string }).variant = 'xiangqi';
      if (kind === 'rated') payload.game.rated = true;
      const { root } = await mount(payload);
      expect(root.querySelector('.gomoku-live-board')).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    },
  );
});

describe('s-da96: recorded long-game Rapfi acceptance', () => {
  const last = longGame.ply_count;
  it('is a finished JSON export with no early five and a real evaluation sign change', async () => {
    const { parseGomokuExport } = await import('./gomoku-analysis-import.js');
    const game = parseGomokuExport(JSON.stringify(longGame));
    expect(game).not.toBeNull();
    expect(game!.moves.length).toBeGreaterThanOrEqual(80);
    expect(longGame._header.levels).toHaveLength(2);
    expect(longGame.rated).toBe(false);
    let state = createGomokuRoomState(ROOM, game!.opening);
    for (const move of game!.moves) {
      expect(state.status.type).toBe('playing');
      const next = applyGomokuRoomMove(state, move);
      expect(next).not.toBe(state);
      state = next;
    }
    expect(state.status).toMatchObject({ type: 'finished', reason: 'five' });
    // Prove these are parsed engine scores, including signed mate distances,
    // rather than a synthetic curve added just to satisfy the acceptance.
    for (const { ply, lines } of longGame._header.sweep.transcripts) {
      const candidate = parseRapfiOutput(lines)[0];
      const sign = (ply % 2 === 0) === (game!.opening.turn === 'black') ? 1 : -1;
      const forced = candidate?.forcedFive;
      expect(longGame.analysis.plies[ply]).toMatchObject({
        cp: !candidate || forced ? null : sign * candidate.eval || 0,
        mate: forced
          ? sign * (forced.result === 'win' ? 1 : -1) * Math.max(1, Math.ceil(forced.plies / 2))
          : null,
      });
    }
    const signs = new Set(
      longGame.analysis.plies.map((point) => Math.sign(point.mate ?? point.cp ?? 0)),
    );
    expect(signs.has(1) && signs.has(-1)).toBe(true);
  });

  it('Analyse polls the sweep into one shared graph point per position', async () => {
    const { root } = await mount(longRecording(), 200, true, longGame.analysis);
    root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      root.querySelector('.advantage-chart__line')?.getAttribute('points')?.split(' '),
    ).toHaveLength(last + 1);
    expect(root.querySelector('.advantage-chart__line')?.getAttribute('points')).not.toMatch(
      /NaN|Infinity/,
    );
  });

  it('steps board and graph to k, then jumps from the graph to another recorded ply', async () => {
    const { root } = await mount(longRecording(), 200, true, longGame.analysis);
    root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    key('Home');
    for (let i = 0; i < 12; i += 1) key('ArrowRight');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(
      longGame.opening.stones.length + 12,
    );
    expect(root.querySelector('.advantage-chart__cursor')?.getAttribute('x1')).toBe(
      ((300 * 12) / last).toFixed(2),
    );
    const svg = root.querySelector<SVGElement>('.advantage-chart__svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 300 } as DOMRect);
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: (300 * 40) / last }));
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(
      longGame.opening.stones.length + 40,
    );
    expect(root.querySelector('.advantage-chart__cursor')?.getAttribute('x1')).toBe(
      ((300 * 40) / last).toFixed(2),
    );
    expect(
      new URL(
        root.querySelector<HTMLAnchorElement>('[data-replay-analysis]')!.href,
      ).searchParams.get('ply'),
    ).toBe('40');
  });

  it('local analysis draws recorded best-move/PV ink while retaining the graph', async () => {
    const { root } = await mount(longRecording(), 200, true, longGame.analysis);
    root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const graph = root.querySelector('.advantage-chart');
    key('Home');
    root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
    const worker = WorkerStub.instances.at(-1)!;
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    const output = longGame._header.sweep.transcripts[0]!.lines;
    for (const line of output) worker.emit({ type: 'line', line });
    worker.emit({ type: 'done', elapsedMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.gomoku-best')?.getAttribute('data-square')).toBe(
      longGame.analysis.plies[0]!.best,
    );
    expect(root.querySelector('.gomoku-pv-number')?.textContent).toBe('1');
    expect(root.querySelector('.advantage-chart')).toBe(graph);
    expect(root.querySelector('[data-square] .gomoku-hit[aria-disabled="false"]')).toBeNull();
  });

  it('a recorded forced five clips at the shared graph edge and reads as win in N locally', async () => {
    const { root } = await mount(longRecording(), 200, true, longGame.analysis);
    root.querySelector<HTMLButtonElement>('[data-gomoku-analyse]')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const forced = [...longGame.analysis.plies].reverse().find((point) => point.mate !== null)!;
    const point = root.querySelector('.advantage-chart__line')!.getAttribute('points')!.split(' ')[
      forced.ply
    ]!;
    const y = Number(point.split(',')[1]);
    expect(y).toBeGreaterThanOrEqual(forced.mate! > 0 ? 4 : 95);
    expect(y).toBeLessThanOrEqual(forced.mate! > 0 ? 5 : 96);
    key('Home');
    for (let i = 0; i < forced.ply; i += 1) key('ArrowRight');
    root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
    const worker = WorkerStub.instances.at(-1)!;
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    for (const line of longGame._header.sweep.transcripts.find((entry) => entry.ply === forced.ply)!
      .lines)
      worker.emit({ type: 'line', line });
    worker.emit({ type: 'done', elapsedMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.engine-panel__eval')?.textContent).toBe(
      `${forced.mate! > 0 ? 'Black' : 'White'} wins in ${Math.abs(forced.mate!)}`,
    );
    // Stepping to the forced ply re-renders board and graph once per move:
    // about 4s locally and past 15s on a hosted CI runner (2026-11-01).
  }, 60_000);

  it('a non-admin with the flag off sees no Analyse or board and never fetches the recording', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { root, fetchSpy } = await mount(longRecording(), 200, false);
    expect(root.querySelector('[data-gomoku-analyse], .engine-panel, .gomoku-svg')).toBeNull();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).startsWith('/api/gomoku/'))).toBe(
      false,
    );
    expect(root.textContent).toContain('This route is not enabled');
  });
});
