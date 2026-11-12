import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_SPEC_ID,
  FFQ_BANQI_START_HP,
  type FFQBanqiMove,
  ffqBanqiStateToFen,
  gameSpecForId,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import {
  type FFQBanqiPostgameResponse,
  ffqBanqiPostgameApiUrl,
  mountFFQBanqiPostgame,
} from './live-ffq-banqi-postgame.js';
import { mountFFQBanqiReview } from './review/ffq-banqi-review.js';
import {
  type FFQBanqiReviewSnapshot,
  makeFFQBanqiTreeAdapter,
} from './review/ffq-banqi-tree-adapter.js';
import { createGameTree } from './review/game-tree.js';
import { setResolvedSignedIn } from './signed-in-state.js';
import { ffqBanqiWatchRecord, mountFFQBanqiWatchReplay } from './watch-ffq-banqi-replay.js';

const ROOM = 'ffq_review_web';
function fixture(): FFQBanqiPostgameResponse {
  let state = createInitialFFQBanqiState(ROOM, 800);
  const snapshots: FFQBanqiReviewSnapshot[] = [
    {
      ply: 0,
      view: getFFQBanqiPlayerView(state, 'observer'),
      fen: ffqBanqiStateToFen(state),
      damage: { red: 0, black: 0 },
    },
  ];
  const moves: FFQBanqiMove[] = [];
  while (state.status.type === 'playing' && moves.length < 100) {
    const legal = getFFQBanqiLegalMoves(state);
    const move =
      legal.find((m) => m.from !== m.to && state.board[m.to]) ??
      legal.find((m) => m.from === m.to) ??
      legal[0]!;
    const captureCount = state.captures.length;
    moves.push(move);
    state = applyFFQBanqiMove(state, move);
    snapshots.push({
      ply: state.ply,
      view: getFFQBanqiPlayerView(state, 'observer'),
      fen: ffqBanqiStateToFen(state),
      damage: (() => {
        const damage = { red: 0, black: 0 };
        const capture = state.captures[captureCount];
        if (capture) damage[capture.owner] = FFQ_BANQI_DAMAGE[capture.role];
        return damage;
      })(),
    });
  }
  return {
    game: {
      roomId: ROOM,
      variant: FFQ_BANQI_SPEC_ID,
      mode: 'pvp',
      result: 'red-wins',
      termination: 'points',
      plyCount: moves.length,
      rated: false,
      visibility: 'private',
      initialMs: null,
      incrementMs: null,
      startedAt: new Date(1).toISOString(),
      endedAt: new Date(100).toISOString(),
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    timeline: moves.map((move, index) => ({
      type: 'move-played',
      move,
      at: index + 10,
      color: index % 2 === 0 ? 'red' : 'black',
      ply: index + 1,
    })),
    view: getFFQBanqiPlayerView(state, 'observer'),
    history: { truth: snapshots },
  };
}
const record = fixture();
const played = record.timeline.map(({ move }) => ({
  from: ffqBanqiSquare(move!.from),
  to: ffqBanqiSquare(move!.to),
}));
const roots: HTMLElement[] = [];
const destroy: Array<() => void> = [];
function root() {
  const el = document.createElement('div');
  document.body.append(el);
  roots.push(el);
  return el;
}
function assertMasked(payload: unknown) {
  JSON.parse(JSON.stringify(payload), (key, value) => {
    expect(['setup', 'deal', 'seed', 'revealed', 'faceDownFaces']).not.toContain(key);
    if (value?.faceDown === true) expect(value).toEqual({ faceDown: true });
    return value;
  });
}

function assertHpBars(host: HTMLElement, ply: number): void {
  expect(host.querySelectorAll('progress')).toHaveLength(2);
  for (const side of ['red', 'black'] as const) {
    const bars = host.querySelectorAll<HTMLProgressElement>(
      `:is(.ffq-banqi-hp, .ffq-banqi-hp-meter)[data-side="${side}"] progress`,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]!.max).toBe(FFQ_BANQI_START_HP);
    expect(bars[0]!.value).toBe(record.history.truth[ply]!.view.hp[side]);
    expect(bars[0]!.getAttribute('aria-label')).toBe(side === 'red' ? 'Red' : 'Black');
  }
}

beforeEach(() => {
  setResolvedSignedIn(true);
  vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/analysis')
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } }),
    ),
  );
});
afterEach(() => {
  for (const stop of destroy.splice(0)) stop();
  for (const host of roots.splice(0)) host.remove();
  setResolvedSignedIn(undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('FFQ masked review', () => {
  it('replays only the recorded line and never synthesizes a dealt position', () => {
    const adapter = makeFFQBanqiTreeAdapter(record.history.truth, played);
    const tree = createGameTree(adapter, played);
    expect(tree.last()).toHaveLength(played.length);
    assertMasked(tree.project(tree.nodeAt(tree.last())!));
    expect(adapter.isLegal(tree.root.truth, { from: 'h4', to: 'h4' })).toBe(false);
    expect(adapter.fromUci('h4h4', tree.root.truth)).toBeNull();
    expect(() => makeFFQBanqiTreeAdapter(record.history.truth.slice(1), played)).toThrow(
      'Incomplete',
    );
  });

  it('steps the board, both HP meters and each seat captures together without hidden faces', () => {
    const host = root();
    const handle = mountFFQBanqiReview(host, record.history.truth, {
      moves: played,
      ariaLabel: 'Review',
      title: gameSpecForId(FFQ_BANQI_SPEC_ID).publicName,
      summary: '',
      seatLabels: true,
      analysis: null,
    });
    destroy.push(handle.destroy);
    for (const ply of [
      0,
      1,
      record.history.truth.find((frame) => frame.damage.red + frame.damage.black > 0)!.ply,
      played.length,
    ]) {
      handle.jumpToPly(ply);
      assertHpBars(host, ply);
      const frame = record.history.truth[ply]!;
      const damage = frame.damage;
      for (const side of ['red', 'black'] as const) {
        // The seat row: the pieces this seat took, then its HP (as Three
        // Kingdoms shows points), with no damage note or counters.
        const material = host.querySelector(`.ffq-banqi-hp-meter[data-side="${side}"]`)!
          .parentElement!;
        expect(material.textContent).toContain(`${frame.view.hp[side]}/${FFQ_BANQI_START_HP} HP`);
        expect(material.textContent).not.toMatch(/damage|progress|chase/i);
        expect(material.querySelectorAll('.review-capture-piece').length).toBe(
          new Set(
            frame.view.captured
              .filter((capture) => capture.capturedBy === side)
              .map((capture) => `${capture.owner}:${capture.role}:${capture.wasFaceDown}`),
          ).size,
        );
      }
      if (damage.red + damage.black)
        expect(handle.mainlineMoveLabel(ply)).toContain(`${damage.red + damage.black} damage`);
      expect(host.querySelectorAll('.face-down-face')).toHaveLength(0);
    }
    assertMasked(handle.serialize());
    expect(record.view.board.some((piece) => piece?.faceDown)).toBe(true);
  });

  it('lays the review out as banqi and Three Kingdoms do: a gauge track and the phone fork picker', () => {
    const host = root();
    const handle = mountFFQBanqiReview(host, record.history.truth, {
      moves: played,
      ariaLabel: 'Review',
      title: gameSpecForId(FFQ_BANQI_SPEC_ID).publicName,
      summary: '',
      seatLabels: true,
      analysis: null,
    });
    destroy.push(handle.destroy);
    // No engine, so no eval bar: the spacer keeps the columns where an engine
    // page puts them.
    expect(host.querySelectorAll('.review-shell__gauge-spacer')).toHaveLength(1);
    expect(host.querySelectorAll('.review-fork-picker')).toHaveLength(1);
  });

  it('mounts the gated page with canonical name and no exports, share card or embed', async () => {
    const host = root();
    host.dataset.favoriteGameId = ROOM;
    mountFFQBanqiPostgame(host, ROOM);
    await vi.waitFor(() => expect(host.querySelector('.game-meta-card')).not.toBeNull());
    expect(host.textContent).toContain(gameSpecForId(FFQ_BANQI_SPEC_ID).publicName);
    expect(host.querySelector('a[href$="export.pgn"]')).toBeNull();
    expect(host.querySelector('a[href$="export.json"]')).toBeNull();
    expect(host.querySelector(`a[href*="/og/game/${ROOM}.png"]`)).toBeNull();
    // The left column is the meta card alone, as on banqi and Three Kingdoms;
    // the as-played replay link sits with the share rows.
    expect(host.querySelector('.review-actions--rail')).toBeNull();
    const watch = host.querySelector<HTMLAnchorElement>('a[href$="?watch=1"]');
    expect(watch?.closest('.review-share__row')).not.toBeNull();
    expect(watch?.closest('.review-rail-group')).toBeNull();
    expect(watch?.textContent).toBe('Replay as played');
    expect(host.querySelector('.game-favorite-action, .review-spectator-chat')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      ffqBanqiPostgameApiUrl(ROOM),
      `${ffqBanqiPostgameApiUrl(ROOM)}/analysis`,
    ]);
    expect(host.textContent).toContain('Request computer analysis');
    expect(host.querySelector('textarea')?.value ?? '').not.toContain('/embed/');
    expect(ffqBanqiPostgameApiUrl('ffq a')).toBe('/api/ffq-banqi/games/ffq%20a');
  });

  it('requests analysis, renders the chart and move marks, and reloads the cache', async () => {
    let cached = false;
    const chancePlies = record.timeline.flatMap(({ move }, i) =>
      record.history.truth[i]!.view.board[move!.to]?.faceDown ? [i + 1] : [],
    );
    const judgedPly = record.timeline.findIndex((_, i) => !chancePlies.includes(i + 1)) + 1;
    expect(judgedPly).toBeGreaterThan(0);
    const cp = judgedPly % 2 === 1 ? -1500 : 1500;
    const analysis = {
      engineId: 'misty-ffq-banqi-analysis@test',
      depth: 12,
      plies: record.history.truth.map(({ ply }) => ({
        ply,
        cp: ply < judgedPly ? 0 : cp,
        mate: null,
        best: null,
      })),
      chancePlies,
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/analysis')) return new Response(JSON.stringify(record));
      if (init?.method === 'POST') cached = true;
      return cached ? new Response(JSON.stringify(analysis)) : new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const host = root();
    mountFFQBanqiPostgame(host, ROOM);
    await vi.waitFor(() => expect(host.querySelector('.xiangqi-review__analyse')).not.toBeNull());
    expect(host.querySelector('.advantage-chart')).toBeNull();
    host.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')!.click();
    await vi.waitFor(() => expect(host.querySelector('.advantage-chart__line')).not.toBeNull());
    expect(host.querySelector('.review-move--blunder')).not.toBeNull();
    expect(host.querySelectorAll('.analysis-summary__player')).toHaveLength(2);
    host.querySelector<HTMLButtonElement>('.review-move--blunder')!.click();
    expect(host.querySelector('.xq-marker--blunder')).not.toBeNull();
    const reloaded = root();
    mountFFQBanqiPostgame(reloaded, ROOM);
    await vi.waitFor(() => expect(reloaded.querySelector('.advantage-chart__line')).not.toBeNull());
    expect(reloaded.querySelector('.xiangqi-review__analyse')).toBeNull();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('translates native FFQ engine coordinates only into the recorded continuation', () => {
    const adapter = makeFFQBanqiTreeAdapter(record.history.truth, played);
    for (let ply = 0; ply < played.length; ply++) {
      const native = record.timeline[ply]!.move!;
      const square = (n: number) => `${String.fromCharCode(97 + (n % 4))}${Math.floor(n / 4)}`;
      const uci = square(native.from) + square(native.to);
      expect(adapter.toEngineUci(played[ply]!)).toBe(uci);
      expect(adapter.fromUci(uci, record.history.truth[ply]!)).toEqual(played[ply]);
    }
    expect(adapter.fromUci('a0a0', record.history.truth.at(-1)!)).toBeNull();
  });

  it('does not fetch when disabled and handles the server access refusal', async () => {
    const host = root();
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'false');
    mountFFQBanqiPostgame(host, ROOM);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })),
    );
    mountFFQBanqiPostgame(host, ROOM);
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Game not found'));
  });

  it('watch replay serializes only masked frames and steps through the same HP', async () => {
    const watch = ffqBanqiWatchRecord(record);
    assertMasked(watch);
    const host = root();
    const handle = await mountFFQBanqiWatchReplay(host, ROOM, { autoplay: false });
    destroy.push(handle.destroy);
    for (const ply of [
      0,
      record.history.truth.find((frame) => frame.damage.red + frame.damage.black > 0)!.ply,
      played.length,
      0,
    ]) {
      handle.jumpToPly?.(ply);
      assertHpBars(host, ply);
    }
    expect(host.querySelectorAll('.face-down-face')).toHaveLength(0);
  });
});
