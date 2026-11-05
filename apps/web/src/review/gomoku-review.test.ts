import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuMove,
  type GomokuOpening,
  getGomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeDisplayPreference } from '../display-preferences.js';
import { gomokuBoardSvg } from '../gomoku-board.js';
import { computeGameAnalysis } from './game-analysis.js';
import { createGameTree } from './game-tree.js';
import { type GomokuReviewConfig, mountGomokuReview } from './gomoku-review.js';
import { makeGomokuTreeAdapter } from './gomoku-tree-adapter.js';
import type { TreeReviewHandle } from './tree-review.js';

// Recorded structured output from the pinned Rapfi WASM, also exercised in
// rapfi-ceval.test.ts. The human MESSAGE coordinates deliberately differ.
const recorded = `INFO PV 0
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 12
INFO NODES 413
INFO TOTALNODES 3925
INFO TOTALTIME 30
INFO SPEED 130833
INFO EVAL 482
INFO WINRATE 0.917587
INFO BESTLINE 5,6 7,6 9,6 8,5 9,4 6,5 9,8
INFO PV DONE
MESSAGE (1) 482 | 9-12 | F9 H9 J9 I10 J11 G10 J7
INFO PV 1
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 10
INFO NODES 624
INFO TOTALNODES 3994
INFO TOTALTIME 30
INFO SPEED 133133
INFO EVAL 271
INFO WINRATE 0.794946
INFO BESTLINE 6,6 9,9 9,6 8,6 5,6 5,5 8,5 7,4 5,9
INFO PV DONE
INFO PV 2
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 11
INFO NODES 709
INFO TOTALNODES 4224
INFO TOTALTIME 32
INFO SPEED 132000
INFO EVAL 544
INFO WINRATE 0.938196
INFO BESTLINE 7,9 8,9 5,6 6,9 9,6 5,8 5,7 8,10
INFO PV DONE`;

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: { type: string; commands?: string[] }[] = [];
  readonly terminate = vi.fn();
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(message: { type: string; commands?: string[] }) {
    this.sent.push(message);
  }
  emit(data: object) {
    this.onmessage?.({ data } as MessageEvent);
  }
  output(output = recorded) {
    for (const line of output.split('\n')) this.emit({ type: 'line', line });
    this.emit({ type: 'done', elapsedMs: 40 });
  }
  get commands() {
    return this.sent.flatMap((message) => message.commands ?? []);
  }
}
const latest = () => WorkerStub.instances.at(-1)!;
const moves: GomokuMove[] = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'].map((to) => parseGomokuMove(to)!);
const opening: GomokuOpening = {
  turn: 'black',
  stones: [
    { square: 'h8', color: 'black' },
    { square: 'i9', color: 'black' },
    { square: 'g9', color: 'black' },
    { square: 'h9', color: 'white' },
    { square: 'i8', color: 'white' },
    { square: 'g8', color: 'white' },
  ],
};
const handles: TreeReviewHandle[] = [];
function mount(config: Partial<GomokuReviewConfig> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountGomokuReview(root, {
    ariaLabel: 'Review',
    title: 'Gomoku',
    summary: '',
    moves: [...moves],
    opening,
    analysis: null,
    ...config,
  });
  handles.push(handle);
  return { root, handle };
}
function press(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}
function board(root: HTMLElement) {
  return root.querySelector<HTMLElement>('.gomoku-live-board')!;
}
function stones(root: HTMLElement) {
  return [...board(root).querySelectorAll('[data-piece-square]')].map((el) =>
    el.getAttribute('data-piece-square'),
  );
}
function toggle(root: HTMLElement) {
  root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
}
async function ready() {
  latest().emit({ type: 'ready' });
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerStub);
  WorkerStub.instances = [];
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('Gomoku tree review', () => {
  it('replays every recorded ply from its dealt root using the rules kernel', () => {
    const adapter = makeGomokuTreeAdapter(opening);
    const tree = createGameTree(adapter, moves);
    let state = createGomokuRoomState('analysis', opening);
    for (let ply = 0; ply <= moves.length; ply += 1) {
      const node = tree.nodeAt(tree.mainlinePath().slice(0, ply))!;
      expect(node.truth).toEqual(state);
      const view = adapter.project(node.truth)[0]!.view;
      expect(view.board).toEqual(state.board);
      expect(view.legalMoves).toHaveLength(225 - state.ply);
      if (moves[ply]) state = applyGomokuRoomMove(state, moves[ply]!);
    }
    expect(adapter.fromUci('o15', state)).toEqual({ to: 'o15' });
    expect(adapter.fromUci('a0', state)).toBeNull();
    expect(tree.addMove([], { to: 'h8' })).toBeNull();
  });

  it('starts local analysis off, with no worker or engine overlays', () => {
    const { root } = mount();
    expect(root.querySelector('.engine-panel__switch')?.getAttribute('aria-checked')).toBe('false');
    expect(WorkerStub.instances).toHaveLength(0);
    expect(board(root).querySelector('.gomoku-engine-overlay')).toBeNull();
    expect(root.querySelector('.review-eval-bar')).not.toBeNull();
  });

  it('draws the top recorded PV as alternating numbered translucent stones and a best marker', async () => {
    const { root } = mount();
    toggle(root);
    await ready();
    latest().output();
    expect(root.querySelectorAll('.engine-panel__line')).toHaveLength(3);
    expect(board(root).querySelector('.gomoku-best')?.getAttribute('data-square')).toBe('h10');
    const pv = [...board(root).querySelectorAll('.gomoku-pv')];
    expect(pv).toHaveLength(8);
    expect(pv.map((el) => el.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(pv[0]?.getAttribute('data-square')).toBe('h10');
    expect(pv[0]?.querySelector('circle')?.classList.contains('gomoku-stone--black')).toBe(true);
    expect(pv[1]?.querySelector('circle')?.classList.contains('gomoku-stone--white')).toBe(true);
    expect(pv[0]?.getAttribute('opacity')).toBe('0.43');
    expect(stones(root)).toHaveLength(opening.stones.length + moves.length);
  });

  it('clears all engine drawing immediately on off and rejects late worker output', async () => {
    const { root } = mount();
    toggle(root);
    await ready();
    const worker = latest();
    worker.output();
    expect(board(root).querySelectorAll('.gomoku-pv')).toHaveLength(8);
    toggle(root);
    expect(board(root).querySelector('.gomoku-engine-overlay')).toBeNull();
    expect(worker.terminate).toHaveBeenCalled();
    worker.output();
    expect(board(root).querySelector('.gomoku-engine-overlay')).toBeNull();
  });

  it('steps to ply k, clears stale ink and restarts Rapfi with exactly that position', async () => {
    window.history.replaceState(null, '', '/?ply=3');
    const { root } = mount({ urlPly: true });
    expect(stones(root)).toHaveLength(opening.stones.length + 3);
    expect(stones(root)).not.toContain('d1');
    toggle(root);
    await ready();
    latest().output();
    expect(
      board(root).querySelector('.gomoku-pv circle')?.classList.contains('gomoku-stone--white'),
    ).toBe(true);
    const previous = latest();
    press('ArrowLeft');
    expect(stones(root)).toHaveLength(opening.stones.length + 2);
    expect(board(root).querySelector('.gomoku-engine-overlay')).toBeNull();
    expect(previous.terminate).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await ready();
    expect(latest()).not.toBe(previous);
    const commands = latest().commands;
    const placements = commands
      .find((command) => command.startsWith('YXBOARD\n'))!
      .split('\n')
      .slice(1, -1);
    expect(new Set(placements)).toEqual(
      new Set(['7,7,1', '8,8,1', '6,8,1', '7,8,2', '8,7,2', '6,7,2', '0,0,1', '1,0,2']),
    );
    expect(commands).toContain('YXNBEST 3');
  });

  it('uses first/previous/next/last buttons and arrow keys over the shared move tree', () => {
    const { root } = mount();
    const click = (action: string) =>
      root.querySelector<HTMLButtonElement>(`[data-replay="${action}"]`)!.click();
    click('first');
    expect(stones(root)).toHaveLength(6);
    click('next');
    expect(stones(root)).toContain('a1');
    click('prev');
    expect(stones(root)).not.toContain('a1');
    click('latest');
    expect(stones(root)).toContain('f1');
    press('ArrowUp');
    expect(stones(root)).toHaveLength(6);
    press('ArrowRight');
    expect(stones(root)).toHaveLength(7);
    press('ArrowDown');
    expect(stones(root)).toHaveLength(12);
  });

  it('plays a side line without rewriting the recorded main line, including after serialization', () => {
    const { root, handle } = mount();
    press('ArrowUp');
    press('ArrowRight');
    board(root)
      .querySelector<SVGElement>('[data-square="o15"] .gomoku-hit')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(stones(root)).toContain('o15');
    expect(stones(root)).not.toContain('b1');
    const saved = handle.serialize();
    expect(saved.root.children[0]?.children.map((child) => child.uci)).toEqual(['b1', 'o15']);
    press('ArrowDown');
    expect(stones(root)).toContain('f1');
    expect(stones(root)).not.toContain('o15');
    const reloaded = mount({ initialTree: saved });
    expect(reloaded.handle.serialize()).toEqual(saved);
  });

  it('numbers the selected branch without numbering the dealt opening stones', () => {
    const { root, handle } = mount();
    expect(board(root).querySelectorAll('.gomoku-move-number')).toHaveLength(moves.length);
    press('Home');
    expect(board(root).querySelectorAll('.gomoku-move-number')).toHaveLength(0);
    press('ArrowRight');
    board(root)
      .querySelector('[data-square="o15"] .gomoku-hit')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(board(root).querySelector('[data-square="o15"] .gomoku-move-number')?.textContent).toBe(
      '2',
    );
    expect(board(root).querySelector('.gomoku-last')).not.toBeNull();
    const saved = handle.serialize();
    press('End');
    expect(board(root).querySelectorAll('.gomoku-move-number')).toHaveLength(moves.length);
    const restored = mount({ initialTree: saved });
    expect(board(restored.root).querySelectorAll('.gomoku-move-number')).toHaveLength(moves.length);
  });

  it('remembers both on and off across mounts and tolerates storage refusal', async () => {
    let mounted = mount();
    toggle(mounted.root);
    mounted.handle.destroy();
    mounted = mount();
    expect(mounted.root.querySelector('.engine-panel__switch')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    toggle(mounted.root);
    mounted.handle.destroy();
    mounted = mount();
    expect(mounted.root.querySelector('.engine-panel__switch')?.getAttribute('aria-checked')).toBe(
      'false',
    );
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mounted = mount();
    expect(() => toggle(mounted.root)).not.toThrow();
    await ready();
  });

  it('keeps a1 bottom-left, respects coordinates, and never offers or applies a flip', () => {
    window.history.replaceState(null, '', '/?flip=1');
    const { root } = mount({
      initialFlipped: true,
      seatLabels: true,
      players: { red: 'Black player', black: 'White player' },
    });
    const a1 = () => board(root).querySelector('[data-square="a1"] circle');
    expect(a1()?.getAttribute('cx')).toBe('32');
    expect(a1()?.getAttribute('cy')).toBe('480');
    expect(board(root).querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
    writeDisplayPreference('boardCoordinates', true);
    expect(board(root).querySelectorAll('.gomoku-coordinate')).toHaveLength(30);
    press('f');
    expect(a1()?.getAttribute('cx')).toBe('32');
    expect(a1()?.getAttribute('cy')).toBe('480');
    expect(root.querySelector('[data-seat-ink-family="gomoku"]')).not.toBeNull();
    expect(
      root.querySelector('.review-seat--bottom')?.classList.contains('review-seat--black'),
    ).toBe(true);
    expect(root.querySelector('.review-seat--top')?.classList.contains('review-seat--white')).toBe(
      true,
    );
    expect(root.querySelector('.review-seat--bottom')?.textContent).toContain('Black player');
    expect(root.textContent).not.toContain('Flip board');
  });

  it('never draws stored engine advice while local analysis is off', async () => {
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 9,
      plies: [
        { ply: 0, cp: 300, mate: null, best: 'h10' },
        { ply: 1, cp: -300, mate: null, best: 'i10' },
      ],
    });
    const { root } = mount({
      initialPosition: 'start',
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(board(root).querySelector('.gomoku-engine-overlay')).toBeNull();
  });

  it('omits the terminal result score while preserving signed mate distances', async () => {
    const winningMoves = ['a1', 'a15', 'b1', 'b15', 'c1', 'c15', 'd1', 'd15', 'e1'].map(
      (to) => parseGomokuMove(to)!,
    );
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 9,
      plies: Array.from({ length: 10 }, (_, ply) => ({
        ply,
        cp: ply === 9 ? -30000 : null,
        mate: ply === 9 ? null : ply % 2 ? -2 : 3,
        best: null,
      })),
    });
    const { root } = mount({
      opening: { stones: [], turn: 'black' },
      moves: winningMoves,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const scores = [...root.querySelectorAll('.review-move-list__eval')].map(
      (el) => el.textContent,
    );
    expect(scores.at(-1)).toBe('');
    expect(scores).not.toContain('-#');
    expect(scores).toContain('#3');
    expect(scores).toContain('-#2');
  });

  it('badges only the current blunder and clears it when navigating away', async () => {
    const analysis = computeGameAnalysis({
      engineId: 'test',
      depth: 9,
      plies: [
        { ply: 0, cp: 600, mate: null, best: null },
        { ply: 1, cp: -600, mate: null, best: null },
        { ply: 2, cp: -600, mate: null, best: null },
      ],
    });
    const { root } = mount({
      moves: moves.slice(0, 2),
      initialPosition: 'start',
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => analysis,
        run: async () => analysis,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    press('ArrowRight');
    const badge = board(root).querySelector('.gomoku-glyph')!;
    expect(badge.getAttribute('data-square')).toBe('a1');
    expect(badge.querySelector('.xq-marker__label')?.textContent).toBe('??');
    expect(board(root).querySelectorAll('.xq-marker--glyph')).toHaveLength(1);
    const disc = badge.querySelector('circle')!;
    const radius = Number(disc.getAttribute('r'));
    expect(Number(disc.getAttribute('cx')) + radius).toBeLessThan(512);
    expect(Number(disc.getAttribute('cy')) - radius).toBeGreaterThan(0);
    press('ArrowRight');
    expect(board(root).querySelector('.gomoku-glyph')).toBeNull();
    press('Home');
    expect(board(root).querySelector('.gomoku-glyph')).toBeNull();
  });

  it('opens a full-board draw and suppresses analysis until stepping back', async () => {
    // The kernel's proven draw pattern: every run is at most two stones long.
    const stones: GomokuOpening['stones'] = Array.from({ length: 225 }, (_, index) => ({
      square: parseGomokuMove(
        `${String.fromCharCode(97 + (index % 15))}${1 + Math.floor(index / 15)}`,
      )!.to,
      color: ((index % 15) + 2 * Math.floor(index / 15)) % 4 < 2 ? 'black' : 'white',
    }));
    const { root } = mount({
      opening: { stones: stones.slice(1), turn: 'black' },
      moves: [{ to: 'a1' }],
    });
    toggle(root);
    expect(WorkerStub.instances).toHaveLength(0);
    expect(root.textContent).toContain('Game over');
    press('ArrowLeft');
    await vi.advanceTimersByTimeAsync(200);
    await ready();
    expect(latest().commands.join('\n')).toContain('YXNBEST 3');
  });

  it('stops PV drawing at an illegal placement or a terminal five without touching the board', () => {
    let state = createGomokuRoomState('analysis');
    const view = getGomokuPlayerView(state, 'black');
    const host = document.createElement('div');
    host.innerHTML = gomokuBoardSvg(view, true, [
      { kind: 'pv', moves: [{ to: 'a1' }, { to: 'a1' }, { to: 'c1' }] },
    ]);
    expect(host.querySelectorAll('.gomoku-pv')).toHaveLength(1);
    expect(state.board.every((stone) => stone === null)).toBe(true);
    for (const to of ['a1', 'a15', 'b1', 'b15', 'c1', 'c15', 'd1', 'd15']) {
      state = applyGomokuRoomMove(state, parseGomokuMove(to)!);
    }
    host.innerHTML = gomokuBoardSvg(getGomokuPlayerView(state, 'black'), true, [
      { kind: 'pv', moves: [{ to: 'e1' }, { to: 'e15' }] },
    ]);
    expect(host.querySelectorAll('.gomoku-pv')).toHaveLength(1);
    expect(state.status.type).toBe('playing');
  });

  it('places by keyboard for either side and refuses input after destroy or in a read-only board', () => {
    const { root, handle } = mount({ moves: [], opening: undefined });
    const place = (square: string) =>
      board(root)
        .querySelector(`[data-square="${square}"] .gomoku-hit`)!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    place('a1');
    place('b1');
    expect(stones(root)).toEqual(['a1', 'b1']);
    handle.destroy();
    place('c1');
    expect(stones(root)).toEqual(['a1', 'b1']);
    const readonly = mount({
      moves: [],
      opening: undefined,
      boardReadOnly: { reason: 'Read only' },
    });
    board(readonly.root)
      .querySelector('[data-square="a1"] .gomoku-hit')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(stones(readonly.root)).toHaveLength(0);
  });
});
