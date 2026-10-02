// The Crazyhouse Xiangqi postgame is the shared tree review (the Fortress and
// Atomic surface), not the bare step-through page it replaced: it opens on the
// final position, shows both pockets at every ply, rings a drop where it
// landed, and has no engine (there is none for this variant in the browser).
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

  async function mounted(): Promise<HTMLElement> {
    const fixture = postgameFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(fixture)),
    );
    const root = document.createElement('div');
    document.body.append(root);
    mountCrazyhouseXiangqiPostgame(root, ROOM_ID);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
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
    // Both drops have been played, so neither hand holds anything.
    expect(
      root.querySelectorAll('.review-material-row .drop-mini-reserve-piece:not(.is-empty)'),
    ).toHaveLength(0);
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
    // Two plies back (after Rxh10): Red holds the horse, Black the cannon.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    const held = [
      ...root.querySelectorAll<HTMLElement>(
        '.review-material-row .drop-mini-reserve-piece:not(.is-empty)',
      ),
    ].map((el) => `${el.closest<HTMLElement>('[data-hand]')?.dataset.hand} ${el.dataset.role}`);
    expect(held.sort()).toEqual(['black cannon', 'red horse']);
  });

  it('has no engine panel or eval gauge', async () => {
    const root = await mounted();
    expect(root.querySelector('.ceval, .engine-panel, .eval-gauge, .review-eval-gauge')).toBeNull();
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
