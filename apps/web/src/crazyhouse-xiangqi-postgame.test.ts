// The Crazyhouse Xiangqi postgame is the shared tree review (the Fortress and
// Atomic surface), not the bare step-through page it replaced: it opens on the
// final position, shows both pockets at every ply, rings a drop where it
// landed, runs the browser Fairy-Stockfish, and shows the server's whole-game
// analysis (advantage chart, move judgments) the way Atomic's postgame does.
import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./feature-flags.js')>()),
  crazyhouseXiangqiEnabled: () => true,
}));

const { mountCrazyhouseXiangqiPostgame } = await import('./crazyhouse-xiangqi-postgame.js');
type CrazyhouseXiangqiPostgameResponse =
  import('./crazyhouse-xiangqi-postgame.js').CrazyhouseXiangqiPostgameResponse;

const ROOM_ID = 'chx_postgame';

// Cxh10 Rxh10 (Red takes a horse, Black takes the cannon back), then Red drops
// the horse on e5 and Black answers by dropping the cannon on e8.
const MOVES: CrazyhouseXiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
  { drop: 'horse', to: 'e5' },
  { drop: 'cannon', to: 'e8' },
];

describe('Crazyhouse Xiangqi postgame review', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function mounted(analysis: unknown = null): Promise<HTMLElement> {
    const fixture = postgameFixture();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/analysis')) {
        // No cached analysis yet answers 204, exactly as the server does.
        return analysis ? jsonResponse(analysis) : new Response(null, { status: 204 });
      }
      return jsonResponse(fixture);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);
    mountCrazyhouseXiangqiPostgame(root, ROOM_ID);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return root;
  }

  it('mounts the shared review shell with the move tree, not the old step-through page', async () => {
    const root = await mounted();
    expect(root.querySelector('.review-shell')).not.toBeNull();
    expect(root.querySelector('.chx-postgame')).toBeNull();
    const moves = [...root.querySelectorAll('.review-move-list__move')].map((el) =>
      el.textContent?.trim(),
    );
    expect(moves).toHaveLength(4);
    expect(moves[2]).toContain('N@e5');
    expect(moves[3]).toContain('C@e8');
    expect(root.querySelector('svg')).not.toBeNull();
  });

  it('opens on the final position, where the last move was a drop', async () => {
    const root = await mounted();
    // The last move is a drop: ringed where it landed, with no from-point.
    expect(root.querySelectorAll('.xq-live-lastmove-ring').length).toBe(1);
    expect(root.querySelector('.xq-live-lastmove-from')).toBeNull();
    // Both captures have been dropped back, so each hand holds only the
    // advisors and elephants it started with.
    const held = [
      ...root.querySelectorAll<HTMLElement>(
        '.review-material-row .drop-mini-reserve-piece:not(.is-empty)',
      ),
    ].map((el) => `${el.closest<HTMLElement>('[data-hand]')?.dataset.hand} ${el.dataset.role}`);
    expect(held.sort()).toEqual(['black advisor', 'black elephant', 'red advisor', 'red elephant']);
  });

  it('shows both pockets at every ply, six slots each in the fixed order', async () => {
    const root = await mounted();
    const rows = root.querySelectorAll('.review-material-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.classList.contains('drop-pocket')).toBe(true);
      const roles = [...row.querySelectorAll<HTMLElement>('.drop-mini-reserve-piece')].map(
        (el) => el.dataset.role,
      );
      expect(roles).toEqual(['soldier', 'cannon', 'horse', 'chariot', 'elephant', 'advisor']);
    }
    // Two plies back (after Rxh10): Red holds the horse, Black the cannon,
    // beside the advisors and elephants both started with.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    const held = [
      ...root.querySelectorAll<HTMLElement>(
        '.review-material-row .drop-mini-reserve-piece:not(.is-empty)',
      ),
    ].map((el) => `${el.closest<HTMLElement>('[data-hand]')?.dataset.hand} ${el.dataset.role}`);
    expect(held.sort()).toEqual([
      'black advisor',
      'black cannon',
      'black elephant',
      'red advisor',
      'red elephant',
      'red horse',
    ]);
  });

  it('asks the crazyhouse analysis route for the cached analysis and offers a request', async () => {
    const root = await mounted();
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls).toContain(`/api/crazyhouse-xiangqi/games/${ROOM_ID}/analysis`);
    // Signed out: the account-gated compute is a sign-in CTA, not a dead button.
    const analyse = root.querySelector<HTMLElement>('.xiangqi-review__analyse');
    expect(analyse).not.toBeNull();
    expect(analyse?.textContent).toContain('Sign in to request analysis');
    expect(root.querySelector('.advantage-chart')).toBeNull();
  });

  it('draws the advantage chart and judges the moves from the cached analysis', async () => {
    // Red POV: level, level, then the black cannon drop on e8 throws the game.
    const root = await mounted({
      engineId: 'fairy-stockfish-crazyhouse-xiangqi-analysis@0.1.0',
      depth: 12,
      plies: [
        { ply: 0, cp: 20, mate: null, best: 'h3h10' },
        { ply: 1, cp: 30, mate: null, best: 'i10h10' },
        { ply: 2, cp: 10, mate: null, best: 'N@e5' },
        { ply: 3, cp: 40, mate: null, best: 'C@e6' },
        { ply: 4, cp: 900, mate: null, best: 'e5f7' },
      ],
    });
    expect(root.querySelector('.advantage-chart')).not.toBeNull();
    const suffixes = [...root.querySelectorAll('.review-move-list__suffix')].map(
      (el) => el.textContent,
    );
    expect(suffixes).toContain('??');
  });

  it('has the local engine panel (the browser Fairy-Stockfish)', async () => {
    const root = await mounted();
    expect(root.querySelector('.engine-panel')).not.toBeNull();
  });
});

function postgameFixture(): CrazyhouseXiangqiPostgameResponse {
  const finalStatus = { type: 'finished', winner: 'black', reason: 'resignation' } as const;
  let state: CrazyhouseXiangqiGameState = createInitialCrazyhouseXiangqiState(ROOM_ID);
  const history = [{ ply: 0, view: getCrazyhouseXiangqiPlayerView(state, 'red') }];
  MOVES.forEach((move, index) => {
    state = applyCrazyhouseXiangqiMove(state, move);
    history.push({ ply: index + 1, view: getCrazyhouseXiangqiPlayerView(state, 'red') });
  });
  const truth = { ...getCrazyhouseXiangqiPlayerView(state, 'red'), status: finalStatus };
  return {
    game: {
      roomId: ROOM_ID,
      variant: 'crazyhouse-xiangqi',
      mode: 'pve',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: MOVES.length,
      startedAt: '2026-10-01T08:00:00.000Z',
      endedAt: '2026-10-01T08:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 180000,
      incrementMs: 2000,
      players: [
        { color: 'red', name: 'Red player', rating: null, kind: 'account' },
        { color: 'black', name: 'Fairy-Stockfish Level 1', rating: null, kind: 'engine' },
      ],
    },
    state: { status: finalStatus, moveNumber: state.moveNumber },
    timeline: MOVES.map((move, index) => ({
      type: 'move-played',
      at: 10 + index,
      color: index % 2 === 0 ? ('red' as const) : ('black' as const),
      move,
      ply: index + 1,
    })),
    view: truth,
    views: { truth },
    history: { truth: history },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
