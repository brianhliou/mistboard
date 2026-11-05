import { existsSync, readFileSync } from 'node:fs';
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
import { writeDisplayPreference } from './display-preferences.js';
import type { GomokuPostgameResponse } from './gomoku-postgame.js';
import type { XiangqiGameAnalysisResponse } from './review/game-analysis.js';

const ROOM = 'gmk_review';

// The recorded long game (1 MB of offline Rapfi output) lives in the private
// repo beside the ladder records, so its suite skips where docs-private is
// absent (hosted CI, fresh worktrees); GOMOKU_LADDER_DATA points elsewhere.
type LongReview = {
  opening: GomokuOpening;
  plies: { ply: number; uci: string; mover: string }[];
  ply_count: number;
  termination: string;
  result: string;
  rated: boolean;
  _header: { levels: unknown[]; sweep: { transcripts: { ply: number; lines: string[] }[] } };
  analysis: XiangqiGameAnalysisResponse;
};
const GOMOKU_DATA = process.env.GOMOKU_LADDER_DATA
  ? new URL(`file://${process.env.GOMOKU_LADDER_DATA.replace(/\/?$/, '/')}`)
  : new URL('../../../docs-private/gomoku/', import.meta.url);
const LONG_REVIEW = new URL('long-review.json', GOMOKU_DATA);
const longGame: LongReview | null = existsSync(LONG_REVIEW)
  ? JSON.parse(readFileSync(LONG_REVIEW, 'utf8'))
  : null;

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

function longRecording(long: LongReview): GomokuPostgameResponse {
  const payload = fixture();
  let state = createGomokuRoomState(ROOM, long.opening as GomokuOpening);
  payload.history.truth = [{ ply: 0, at: 0, view: getGomokuPlayerView(state, 'black', true) }];
  payload.timeline = [];
  for (const entry of long.plies) {
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
    plyCount: long.ply_count,
    termination: long.termination,
    result: long.result === 'draw' ? 'draw' : `${long.result}-wins`,
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
  options: { signedIn?: boolean; cached?: boolean } = {},
) {
  vi.resetModules();
  const { setResolvedAdmin } = await import('./signed-in-state.js');
  setResolvedAdmin(admin);
  const { setResolvedSignedIn } = await import('./signed-in-state.js');
  setResolvedSignedIn(options.signedIn ?? true);
  const { setPostHogInstance } = await import('./analytics.js');
  setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/analysis/jobs/'))
      return Response.json({ status: 'done', result: analysis });
    if (String(input).endsWith('/analysis'))
      return init?.method === 'POST'
        ? Response.json({ jobId: 'sweep' }, { status: 202 })
        : options.cached
          ? Response.json(analysis)
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
  await mountGomokuPostgame(root, ROOM);
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
    const button = root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse');
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

  it('shows signed-out viewers the shared sign-in link without requesting a sweep', async () => {
    const { root, fetchSpy } = await mount(fixture(), 200, false, undefined, { signedIn: false });
    const request = root.querySelector<HTMLAnchorElement>('a.xiangqi-review__analyse')!;
    expect(request.textContent).toBe('Sign in to request analysis');
    expect(request.pathname).toBe('/account');
    expect(root.querySelector('.engine-panel')).not.toBeNull();
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it.each([3, 4, 5])(
    'loads cached analysis into marks and the correct players for a %i-stone opening',
    async (count) => {
      const opening = GOMOKU_OPENINGS.find((entry) => entry.stones.length === count)!;
      const response = {
        engineId: 'rapfi-gomoku',
        depth: 9,
        plies: [0, -1000, -1000, -1000].map((cp, ply) => ({ ply, cp, mate: null, best: null })),
      };
      const { root, fetchSpy } = await mount(fixture(opening), 200, false, response, {
        cached: true,
      });
      expect(root.querySelector('.advantage-chart__line')).not.toBeNull();
      expect(root.querySelector('.xiangqi-review__analyse')).toBeNull();
      expect(root.querySelectorAll('.analysis-summary__player')).toHaveLength(2);
      expect(root.querySelectorAll('.review-move-list__suffix.review-move--blunder')).toHaveLength(
        count === 4 ? 1 : 0,
      );
      const players = [...root.querySelectorAll('.analysis-summary__player')];
      expect(players[0]?.textContent).toContain('Alice');
      expect(players[1]?.textContent).toContain('Bob');
      expect(players[0]?.querySelectorAll('.analysis-summary__stat--blunder')).toHaveLength(
        count === 4 ? 1 : 0,
      );
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
      expect(root.querySelector('.review-move-times__bar')?.classList).toContain(
        count === 4 ? 'review-move-times__bar--black' : 'review-move-times__bar--white',
      );
    },
  );

  it('offers server analysis and the local switch to every player once the flag is on', async () => {
    const { root } = await mount(fixture(), 200, false);
    expect(root.querySelector('.xiangqi-review__analyse')).not.toBeNull();
    expect(root.querySelector('.engine-panel')).not.toBeNull();
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
    expect(root.querySelectorAll('.gomoku-pv .gomoku-pv-number')).toHaveLength(2);
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
      const button = root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!;
      expect(button.textContent).toBe(t('replay.requestComputerAnalysis'));
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
      expect(button.textContent).toBe(t('replay.analysisFailed'));
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
    expect(root.querySelector('[data-replay-flip]:not([hidden])')).toBeNull();
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
  it.each([false, true])('mounts the shared review columns and tabs (admin: %s)', async (admin) => {
    const { root } = await mount(fixture(), 200, admin);
    expect(root.querySelector('.review-shell__center .gomoku-live-board')).not.toBeNull();
    expect(root.querySelector('.review-shell__right .engine-panel')).not.toBeNull();
    expect(root.querySelector('.review-shell__right .move-tree')).not.toBeNull();
    expect(root.querySelector('.review-shell__right .review-controls')).not.toBeNull();
    expect(root.querySelector('.review-share a[download$=".json"]')).not.toBeNull();
    expect(
      [...root.querySelectorAll('.review-underboard-tabs button')].map((el) => el.textContent),
    ).toEqual(['Computer analysis', 'Move times', 'Share & export']);
    expect(root.querySelector('.review-spectator-chat')).not.toBeNull();
    expect(root.querySelector('.review-info-sheet')).not.toBeNull();
    expect(root.querySelector('.review-seat--bottom')?.textContent).toContain('Alice');
    expect(root.querySelector('.review-seat--top')?.textContent).toContain('Bob');
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
        expect(Boolean(root.querySelector('.xiangqi-review__analyse'))).toBe(admitted);
        expect(Boolean(root.querySelector('.engine-panel'))).toBe(admitted);
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
      expect(root.querySelector('.move-tree')?.textContent).toContain('a1');
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
        ...root.querySelectorAll<HTMLButtonElement>('.move-tree button.move-tree__move'),
      ].find((button) => button.querySelector('.review-move-list__san')?.textContent === 'b1');
      expect(second).toBeDefined();
      second?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 2);
      key('End');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 3);
      root.querySelector<HTMLElement>('[data-replay="first"]')?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      expect(root.querySelectorAll('.gomoku-move-number')).toHaveLength(0);
      expect(root.querySelectorAll('.gomoku-ghost')).not.toHaveLength(0);
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
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    root.querySelector<HTMLButtonElement>('[data-move-nav-menu]')!.click();
    const action = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find(
      (button) => button.textContent?.includes('Analyse from here'),
    )!;
    expect(action).toBeDefined();
    action.click();
    const url = new URL(String(assign.mock.calls[0]![0]), window.location.href);
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
      [...root.querySelectorAll('.review-seat__clock')].map((el) => el.textContent);
    expect(clocks()).toContain('0:59');
    expect(clocks()).toContain('0:58');
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

  it('loads a valid finished rated recording', async () => {
    const payload = fixture();
    payload.game.rated = true;
    const { root } = await mount(payload);
    expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(3);
    expect(root.textContent).not.toContain('Postgame unavailable');
    expect(root.textContent).toContain('Rated');
    expect(root.textContent).not.toContain('Casual');
    key('Home');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    key('End');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(3);
    expect(capture).toHaveBeenCalledWith('review_opened', expect.any(Object));
  });

  it.each(['unfinished', 'missing-root', 'wrong-room', 'wrong-variant'])(
    'refuses a %s recording',
    async (kind) => {
      const payload = fixture();
      if (kind === 'unfinished') payload.view = payload.history.truth[0]!.view;
      if (kind === 'missing-root') payload.history.truth = payload.history.truth.slice(1);
      if (kind === 'wrong-room') payload.game.roomId = 'gmk_other';
      if (kind === 'wrong-variant') (payload.game as { variant: string }).variant = 'xiangqi';
      const { root } = await mount(payload);
      expect(root.querySelector('.gomoku-live-board')).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    },
  );
});

describe.skipIf(!longGame)('s-da96: recorded long-game Rapfi acceptance', () => {
  const long = longGame as LongReview;
  const last = longGame?.ply_count ?? 0;
  it('is a finished JSON export with no early five and a real evaluation sign change', async () => {
    const { parseGomokuExport } = await import('./gomoku-analysis-import.js');
    const game = parseGomokuExport(JSON.stringify(long));
    expect(game).not.toBeNull();
    expect(game!.moves.length).toBeGreaterThanOrEqual(80);
    expect(long._header.levels).toHaveLength(2);
    expect(long.rated).toBe(false);
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
    for (const { ply, lines } of long._header.sweep.transcripts) {
      const candidate = parseRapfiOutput(lines)[0];
      const sign = (ply % 2 === 0) === (game!.opening.turn === 'black') ? 1 : -1;
      const forced = candidate?.forcedFive;
      expect(long.analysis.plies[ply]).toMatchObject({
        cp: !candidate || forced ? null : sign * candidate.eval || 0,
        mate: forced
          ? sign * (forced.result === 'win' ? 1 : -1) * Math.max(1, Math.ceil(forced.plies / 2))
          : null,
      });
    }
    const signs = new Set(
      long.analysis.plies.map((point) => Math.sign(point.mate ?? point.cp ?? 0)),
    );
    expect(signs.has(1) && signs.has(-1)).toBe(true);
  });

  it('Analyse polls the sweep into one shared graph point per position', async () => {
    const { root } = await mount(longRecording(long), 200, true, long.analysis);
    root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      root.querySelector('.advantage-chart__line')?.getAttribute('points')?.split(' '),
    ).toHaveLength(last + 1);
    expect(root.querySelector('.advantage-chart__line')?.getAttribute('points')).not.toMatch(
      /NaN|Infinity/,
    );
  });

  it('steps board and graph to k, then jumps from the graph to another recorded ply', async () => {
    const { root } = await mount(longRecording(long), 200, true, long.analysis);
    root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    key('Home');
    for (let i = 0; i < 12; i += 1) key('ArrowRight');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(
      long.opening.stones.length + 12,
    );
    expect(root.querySelector('.advantage-chart__cursor')?.getAttribute('x1')).toBe(
      ((300 * 12) / last).toFixed(2),
    );
    const svg = root.querySelector<SVGElement>('.advantage-chart__svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 300 } as DOMRect);
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: (300 * 40) / last }));
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(
      long.opening.stones.length + 40,
    );
    expect(root.querySelector('.advantage-chart__cursor')?.getAttribute('x1')).toBe(
      ((300 * 40) / last).toFixed(2),
    );
    expect(new URLSearchParams(window.location.search).get('ply')).toBe('40');
  });

  it('local analysis draws recorded best-move/PV ink while retaining the graph', async () => {
    const { root } = await mount(longRecording(long), 200, true, long.analysis);
    root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const graph = root.querySelector('.advantage-chart');
    key('Home');
    root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
    const worker = WorkerStub.instances.at(-1)!;
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    const output = long._header.sweep.transcripts[0]!.lines;
    for (const line of output) worker.emit({ type: 'line', line });
    worker.emit({ type: 'done', elapsedMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.gomoku-best')?.getAttribute('data-square')).toBe(
      long.analysis.plies[0]!.best,
    );
    expect(root.querySelector('.gomoku-pv .gomoku-pv-number')?.textContent).toBe('1');
    expect(root.querySelector('.advantage-chart')).toBe(graph);
    expect(root.querySelector('[data-square] .gomoku-hit[aria-disabled="false"]')).not.toBeNull();
  });

  it('a recorded forced five clips at the shared graph edge and reads as win in N locally', async () => {
    const { root } = await mount(longRecording(long), 200, true, long.analysis);
    root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
    await vi.advanceTimersByTimeAsync(2000);
    const forced = [...long.analysis.plies].reverse().find((point) => point.mate !== null)!;
    const point = root.querySelector('.advantage-chart__line')!.getAttribute('points')!.split(' ')[
      forced.ply
    ]!;
    const y = Number(point.split(',')[1]);
    expect(y).toBeGreaterThanOrEqual(forced.mate! > 0 ? 4 : 95);
    expect(y).toBeLessThanOrEqual(forced.mate! > 0 ? 5 : 96);
    // Score presentation does not need to repaint every preceding position;
    // keyboard stepping is covered by the navigation case above.
    const square = long.plies[forced.ply - 1]!.uci;
    const move = [...root.querySelectorAll<HTMLButtonElement>('.move-tree__move')].find(
      (button) => button.querySelector('.review-move-list__san')?.textContent === square,
    );
    expect(move).toBeDefined();
    move!.click();
    root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
    const worker = WorkerStub.instances.at(-1)!;
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    for (const line of long._header.sweep.transcripts.find((entry) => entry.ply === forced.ply)!
      .lines)
      worker.emit({ type: 'line', line });
    worker.emit({ type: 'done', elapsedMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('.engine-panel__eval')?.textContent).toBe(
      `${forced.mate! > 0 ? 'Black' : 'White'} wins in ${Math.abs(forced.mate!)}`,
    );
  }, 60_000);

  it('a non-admin with the flag off sees no Analyse or board and never fetches the recording', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { root, fetchSpy } = await mount(longRecording(long), 200, false);
    expect(root.querySelector('.xiangqi-review__analyse, .engine-panel, .gomoku-svg')).toBeNull();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).startsWith('/api/gomoku/'))).toBe(
      false,
    );
    expect(root.textContent).toContain('This route is not enabled');
  });
});
