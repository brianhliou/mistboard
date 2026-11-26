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
import { formatFFQBanqiBestMove } from './review/ffq-banqi-decisions.js';
import { mountFFQBanqiReview } from './review/ffq-banqi-review.js';
import {
  type FFQBanqiReviewSnapshot,
  makeFFQBanqiTreeAdapter,
} from './review/ffq-banqi-tree-adapter.js';
import type { GameAnalysis } from './review/game-analysis.js';
import { createGameTree } from './review/game-tree.js';
import { setResolvedSignedIn } from './signed-in-state.js';
import { ffqBanqiWatchRecord, mountFFQBanqiWatchReplay } from './watch-ffq-banqi-replay.js';
import { syncWatchSeatScores } from './watch-route.js';

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
// The dealt states behind the record, only to list legal moves (an observer view
// carries none); every assertion reads the masked snapshots.
const dealt = [createInitialFFQBanqiState(ROOM, 800)];
for (const { move } of record.timeline) dealt.push(applyFFQBanqiMove(dealt.at(-1)!, move!));
const legalAt = (ply: number) => getFFQBanqiLegalMoves(dealt[ply]!);
const square = (m: FFQBanqiMove) => ({ from: ffqBanqiSquare(m.from), to: ffqBanqiSquare(m.to) });
const engineUci = (m: FFQBanqiMove) =>
  [m.from, m.to].map((n) => `${String.fromCharCode(97 + (n % 4))}${Math.floor(n / 4)}`).join('');
const sameMove = (a: { from: string; to: string } | undefined, m: FFQBanqiMove) =>
  a?.from === ffqBanqiSquare(m.from) && a?.to === ffqBanqiSquare(m.to);
/** A legal move off the record from a face-up piece to a square the masked board
 * shows (empty, or a face-up piece), after a recorded move that drew nothing. */
function publicAlternative({ quiet = false } = {}) {
  for (const frame of record.history.truth.slice(0, -1)) {
    const next = record.timeline[frame.ply]!.move!;
    if (next.from === next.to || frame.view.board[next.to]?.faceDown) continue;
    const alt = legalAt(frame.ply).find(
      (m) =>
        m.from !== m.to &&
        !frame.view.board[m.from]?.faceDown &&
        (quiet ? !frame.view.board[m.to] : !frame.view.board[m.to]?.faceDown) &&
        !sameMove(played[frame.ply], m),
    );
    if (alt) return { frame, alt };
  }
  throw new Error('fixture has no public alternative');
}
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
      /\/(analysis|decisions)$/.test(String(input))
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
      // A capture's damage shows in the HP bars only; the move list keeps the move.
      if (ply > 0) expect(handle.mainlineMoveLabel(ply)).not.toMatch(/damage|·/);
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
      `${ffqBanqiPostgameApiUrl(ROOM)}/decisions`,
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
      if (String(input).endsWith('/decisions'))
        return new Response(
          JSON.stringify({ engineId: 'misty-ffq-banqi-decisions@test', depth: 12, decisions: [] }),
        );
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

  it('shows luck on flips and covered captures, with no per-seat totals, from cached decisions without POST', async () => {
    const chance = record.timeline.flatMap(({ move, color }, i) =>
      record.history.truth[i]!.view.board[move!.to]?.faceDown
        ? [{ ply: i + 1, color, capture: move!.from !== move!.to }]
        : [],
    );
    const flip = chance.find((row) => !row.capture)!;
    const capture = chance.find((row) => row.capture)!;
    expect(capture).toBeDefined();
    const decisions = [
      {
        ply: flip.ply,
        mover: flip.color!,
        bestWin: 70,
        playedWin: 50,
        realizedWin: 80,
        playedRank: 2,
      },
      {
        ply: capture.ply,
        mover: capture.color!,
        bestWin: 60,
        playedWin: 60,
        realizedWin: 30,
        playedRank: 1,
      },
    ];
    const analysis = {
      engineId: 'misty-ffq-banqi-analysis@test',
      depth: 12,
      plies: record.history.truth.map(({ ply }) => ({ ply, cp: 0, mate: null, best: null })),
      chancePlies: chance.map((row) => row.ply),
    };
    const spy = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/analysis')
              ? analysis
              : String(input).endsWith('/decisions')
                ? { engineId: 'misty-ffq-banqi-decisions@test', depth: 12, decisions }
                : record,
          ),
        ),
    );
    vi.stubGlobal('fetch', spy);
    const host = root();
    mountFFQBanqiPostgame(host, ROOM);
    await vi.waitFor(() => expect(host.textContent).toContain('🎲 +30%'));
    expect(host.textContent).toContain('🎲 -30%');
    // Decided 2026-11-15: the per-move luck is the whole story; no per-seat totals line.
    expect(host.textContent).not.toContain('decision loss');
    expect(host.textContent).not.toMatch(/luck [+-]?\d+\.\d pp/);
    expect(spy.mock.calls).toHaveLength(3);
    assertMasked(decisions);
  });

  it('reads the stored grades beside the game, not after it, and only once each', async () => {
    const analysis = {
      engineId: 'misty-ffq-banqi-analysis@test',
      depth: 12,
      plies: record.history.truth.map(({ ply }) => ({ ply, cp: 0, mate: null, best: null })),
      chancePlies: [],
    };
    let releaseGame!: () => void;
    const game = new Promise<void>((resolve) => {
      releaseGame = resolve;
    });
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/analysis')) return new Response(JSON.stringify(analysis));
      if (url.endsWith('/decisions'))
        return new Response(
          JSON.stringify({ engineId: 'misty-ffq-banqi-decisions@test', depth: 12, decisions: [] }),
        );
      await game;
      return new Response(JSON.stringify(record));
    });
    vi.stubGlobal('fetch', spy);
    const host = root();
    mountFFQBanqiPostgame(host, ROOM);
    // All three reads are in flight while the game itself is still loading.
    expect(spy.mock.calls.map(([url]) => String(url))).toEqual([
      ffqBanqiPostgameApiUrl(ROOM),
      `${ffqBanqiPostgameApiUrl(ROOM)}/analysis`,
      `${ffqBanqiPostgameApiUrl(ROOM)}/decisions`,
    ]);
    releaseGame();
    await vi.waitFor(() => expect(host.querySelector('.advantage-chart__line')).not.toBeNull());
    await vi.waitFor(() => expect(host.querySelector('.review-move-list__move')).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('reads the game alone for the as-played replay', () => {
    window.history.replaceState(null, '', '/ffq-banqi/game/x?watch=1');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Promise<Response>(() => {})),
      );
      mountFFQBanqiPostgame(root(), ROOM);
      expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
        ffqBanqiPostgameApiUrl(ROOM),
      ]);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('translates native FFQ engine coordinates into the recorded continuation', () => {
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

  it('branches off the record only where the masked board already shows the outcome', () => {
    const adapter = makeFFQBanqiTreeAdapter(record.history.truth, played);
    const { frame, alt } = publicAlternative();
    const uci = engineUci(alt);
    expect(adapter.isLegal(frame, square(alt))).toBe(true);
    expect(adapter.fromUci(uci, frame)).toEqual(square(alt));
    const branch = adapter.applyMove(frame, square(alt));
    expect(branch.ply).toBe(frame.ply + 1);
    expect(branch).toBe(adapter.applyMove(frame, square(alt)));
    // The same backs, still anonymous, and the same hidden pool: nothing about a
    // covered piece is known after the branch move that was not known before it.
    const backs = (view: typeof frame.view) =>
      view.board.flatMap((piece, i) => (piece?.faceDown ? [i] : []));
    expect(backs(branch.view)).toEqual(backs(frame.view));
    expect(branch.view.pool).toEqual(frame.view.pool);
    assertMasked(branch);
    // A flip or a covered capture off the record draws from the hidden pool, so
    // neither has an outcome to show.
    const back = backs(branch.view)[0]!;
    const flip = { from: back, to: back };
    expect(adapter.isLegal(branch, square(flip))).toBe(false);
    expect(adapter.fromUci(engineUci(flip), branch)).toBeNull();
    const covered = record.history.truth.flatMap((f) =>
      legalAt(f.ply)
        .filter((m) => m.from !== m.to && f.view.board[m.to]?.faceDown)
        .filter((m) => !sameMove(played[f.ply], m))
        .map((m) => ({ f, m })),
    )[0]!;
    expect(covered).toBeDefined();
    expect(adapter.isLegal(covered.f, square(covered.m))).toBe(false);
  });

  it('grafts the stored best move as a clickable branch, arrows it and names it in board squares', async () => {
    const { frame, alt } = publicAlternative({ quiet: true });
    const judgedPly = frame.ply + 1;
    const cp = judgedPly % 2 === 1 ? -1500 : 1500;
    const analysis: GameAnalysis = {
      engineId: 'misty-ffq-banqi-analysis@test',
      depth: 12,
      evals: record.history.truth.map(({ ply }) => ({
        ply,
        cp: ply < judgedPly ? 0 : cp,
        mate: null,
        best: ply === frame.ply ? engineUci(alt) : null,
        pv: [],
      })),
      moves: played.map((_, i) => ({
        ply: i + 1,
        mover: i % 2 === 0 ? 'red' : 'black',
        judgment: i + 1 === judgedPly ? 'blunder' : null,
        accuracy: i + 1 === judgedPly ? 10 : 100,
      })),
      chancePlies: [],
      unstablePlies: [],
      bestPlayedPlies: [],
      red: { accuracy: 90, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
      black: { accuracy: 90, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
    };
    const host = root();
    const handle = mountFFQBanqiReview(host, record.history.truth, {
      moves: played,
      ariaLabel: 'Review',
      title: gameSpecForId(FFQ_BANQI_SPEC_ID).publicName,
      summary: '',
      seatLabels: true,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
    });
    destroy.push(handle.destroy);
    await vi.waitFor(() => expect(host.querySelector('.move-tree__variation')).not.toBeNull());
    const label = formatFFQBanqiBestMove(engineUci(alt));
    expect(host.textContent).toContain(`${label} was best`);
    // The position the blunder was played from carries the better move's arrow.
    handle.jumpToPly(frame.ply);
    await vi.waitFor(() => expect(host.querySelector('.xq-arrow--best')).not.toBeNull());
    const branchMove = host.querySelector<HTMLButtonElement>(
      '.move-tree__variation .review-move-list__move',
    )!;
    branchMove.click();
    await vi.waitFor(() =>
      expect(branchMove.classList.contains('review-move-list__move--current')).toBe(true),
    );
    assertMasked(handle.serialize());
    expect(host.querySelectorAll('.face-down-face')).toHaveLength(0);
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

  // /watch's rail rows and the homepage TV seats show each side's HP beside its
  // name at the ply on the board. Red is the first mover; HP is keyed by ink.
  it('puts each seat HP beside its name at the shown ply, on the watch rail and homepage seats', async () => {
    const hit = record.history.truth.find((frame) => frame.damage.red + frame.damage.black > 0)!;
    const hurt = hit.damage.red > 0 ? 'red' : 'black';
    const hp = (ply: number, side: 'red' | 'black') =>
      `${record.history.truth[ply]!.view.hp[side]}/${FFQ_BANQI_START_HP} HP`;

    const host = root();
    const handle = await mountFFQBanqiWatchReplay(host, ROOM, {
      autoplay: false,
      compact: true,
      seatScores: true,
    });
    destroy.push(handle.destroy);
    const seatText = (seat: 'first' | 'second') =>
      host.querySelector(`.showcase-seat[data-seat="${seat}"] .showcase-seat-score`)?.textContent;
    const top = document.createElement('div');
    const bottom = document.createElement('div');
    for (const [slot, name] of [
      [top, 'Black player'],
      [bottom, 'Red player'],
    ] as const) {
      slot.innerHTML = `<span class="clock-player-line watch-game-table__player"><span class="clock-name">${name}</span><span class="clock-to-move"></span></span>`;
    }

    handle.jumpToPly?.(0);
    expect(seatText('first')).toBe('60/60 HP');
    expect(seatText('second')).toBe('60/60 HP');
    handle.jumpToPly?.(hit.ply);
    expect(seatText('first')).toBe(hp(hit.ply, 'red'));
    expect(seatText('second')).toBe(hp(hit.ply, 'black'));
    expect(record.history.truth[hit.ply]!.view.hp[hurt]).toBe(
      FFQ_BANQI_START_HP - hit.damage[hurt],
    );
    // The name, then the score, then the rest of the row.
    const name = host.querySelector('.showcase-seat[data-seat="first"]')!.children;
    expect([...name].map((el) => el.className)).toEqual([
      expect.stringContaining('showcase-seat-name'),
      'showcase-seat-score',
      'showcase-seat-clock',
    ]);

    syncWatchSeatScores(top, bottom, handle);
    const railText = (slot: HTMLElement) =>
      slot.querySelector('.watch-player-score .ffq-banqi-hp-meter__value')?.textContent;
    expect(railText(bottom)).toBe(hp(hit.ply, 'red'));
    expect(railText(top)).toBe(hp(hit.ply, 'black'));
    expect(
      [...bottom.querySelector('.watch-game-table__player')!.children].map((el) => el.className),
    ).toEqual(['clock-name', 'watch-player-score', 'clock-to-move']);
    // A scrub replaces the score rather than adding another.
    handle.jumpToPly?.(0);
    syncWatchSeatScores(top, bottom, handle);
    expect(bottom.querySelectorAll('.watch-player-score')).toHaveLength(1);
    expect(railText(bottom)).toBe('60/60 HP');
    // A board with no score leaves the row as it was.
    syncWatchSeatScores(top, bottom, null);
    expect(bottom.querySelectorAll('.watch-player-score')).toHaveLength(0);
  });

  it('keeps the compact seat rows unscored unless the host asks (queue previews, /games cards)', async () => {
    const host = root();
    const handle = await mountFFQBanqiWatchReplay(host, ROOM, { autoplay: false, compact: true });
    destroy.push(handle.destroy);
    expect(host.querySelectorAll('.showcase-seat')).toHaveLength(2);
    expect(host.querySelector('.showcase-seat-score')).toBeNull();
    expect(host.querySelector('.ffq-banqi-hp-meter')).toBeNull();
  });
});
