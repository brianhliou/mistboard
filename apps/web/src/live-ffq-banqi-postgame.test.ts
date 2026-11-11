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
      `.ffq-banqi-hp[data-side="${side}"] progress`,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]!.max).toBe(FFQ_BANQI_START_HP);
    expect(bars[0]!.value).toBe(record.history.truth[ply]!.view.hp[side]);
    expect(bars[0]!.getAttribute('aria-label')).toBe(side === 'red' ? 'Red' : 'Black');
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } }),
    ),
  );
});
afterEach(() => {
  for (const stop of destroy.splice(0)) stop();
  for (const host of roots.splice(0)) host.remove();
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

  it('steps the board, both HP counters and capture damage together without hidden faces', () => {
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
      const damage = record.history.truth[ply]!.damage;
      for (const side of ['red', 'black'] as const) {
        const material = host.querySelector(`[data-side="${side}"]`)!.parentElement!;
        if (damage[side]) expect(material.textContent).toContain(`${damage[side]} damage`);
        else expect(material.textContent).not.toContain('damage');
      }
      if (damage.red + damage.black)
        expect(handle.mainlineMoveLabel(ply)).toContain(`${damage.red + damage.black} damage`);
      expect(host.querySelectorAll('.face-down-face')).toHaveLength(0);
    }
    assertMasked(handle.serialize());
    expect(record.view.board.some((piece) => piece?.faceDown)).toBe(true);
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
    expect(host.querySelector('a[href$="?watch=1"]')).not.toBeNull();
    expect(host.querySelector('.game-favorite-action, .review-spectator-chat')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      ffqBanqiPostgameApiUrl(ROOM),
    ]);
    expect(host.textContent).not.toContain('Request computer analysis');
    expect(host.querySelector('textarea')?.value ?? '').not.toContain('/embed/');
    expect(ffqBanqiPostgameApiUrl('ffq a')).toBe('/api/ffq-banqi/games/ffq%20a');
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
