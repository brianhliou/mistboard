import type { GameEvent } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { mountReplay } from './replay.js';
import {
  compactReplayClockSidesForOrientation,
  resolveWallClockReplayPosition,
  resolveWallClockThinkingElapsedMs,
} from './replay-wall-clock.js';

describe('compactReplayClockSidesForOrientation', () => {
  it('puts the side facing the top of a white-oriented board above the board', () => {
    expect(compactReplayClockSidesForOrientation('white')).toEqual({
      top: 'black',
      bottom: 'white',
    });
  });

  it('puts the side facing the bottom of a black-oriented board below the board', () => {
    expect(compactReplayClockSidesForOrientation('black')).toEqual({
      top: 'white',
      bottom: 'black',
    });
  });
});

describe('mountReplay capture rows', () => {
  it('keeps split captures aligned to the shared board orientation across the triptych', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const replay = await mountReplay(root, 'review-captures-test', {
      autoplay: false,
      captureLayout: 'split',
      initialPly: 4,
      loaderForId: async () => reviewCaptureEvents,
      revealOnFinish: false,
      showControls: false,
    });

    try {
      expect(captureLabels(root, '.replay-pane-white .replay-captures-top')).toEqual([
        'white pawn',
      ]);
      expect(captureLabels(root, '.replay-pane-white .replay-captures-bottom')).toEqual([
        'black pawn',
      ]);
      expect(captureLabels(root, '.replay-pane-truth .replay-captures-top')).toEqual([
        'white pawn',
      ]);
      expect(captureLabels(root, '.replay-pane-truth .replay-captures-bottom')).toEqual([
        'black pawn',
      ]);
      expect(captureLabels(root, '.replay-pane-black .replay-captures-top')).toEqual([
        'white pawn',
      ]);
      expect(captureLabels(root, '.replay-pane-black .replay-captures-bottom')).toEqual([
        'black pawn',
      ]);
    } finally {
      replay.destroy();
      root.remove();
    }
  });
});

// Mistboard TV's rail draws the game page's capture strips from the handle at the
// board's ply: the second mover's captures on top, the first mover's below.
describe('mountReplay rail material', () => {
  it('fills the rail strips with what each side has captured by the current ply', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const replay = await mountReplay(root, 'review-captures-test', {
      autoplay: false,
      initialPly: 2,
      loaderForId: async () => reviewCaptureEvents,
      revealOnFinish: false,
      showControls: false,
    });
    const slots = railSlots();

    try {
      expect(replay.fillMaterial).toBeTypeOf('function');
      replay.fillMaterial?.(slots);
      expect(slotLabels(slots.top)).toEqual([]);
      expect(slotLabels(slots.bottom)).toEqual([]);
      expect(slots.bottom.classList.contains('has-captures')).toBe(false);

      replay.jumpToPly?.(3);
      replay.fillMaterial?.(slots);
      expect(slotLabels(slots.top)).toEqual([]);
      expect(slotLabels(slots.bottom)).toEqual(['black pawn']);
      expect(slots.bottom.classList.contains('has-captures')).toBe(true);

      replay.jumpToPly?.(4);
      replay.fillMaterial?.(slots);
      expect(slotLabels(slots.top)).toEqual(['white pawn']);
      expect(slotLabels(slots.bottom)).toEqual(['black pawn']);

      // Scrubbing back redraws, never accumulates.
      replay.jumpToPly?.(3);
      replay.fillMaterial?.(slots);
      expect(slotLabels(slots.top)).toEqual([]);
      expect(slots.top.classList.contains('has-captures')).toBe(false);
    } finally {
      replay.destroy();
      root.remove();
    }
  });
});

function railSlots(): { top: HTMLElement; bottom: HTMLElement; pool: HTMLElement } {
  return {
    top: document.createElement('div'),
    bottom: document.createElement('div'),
    pool: document.createElement('div'),
  };
}

describe('resolveWallClockReplayPosition', () => {
  const samples = [
    { sampleId: 'a', plyCount: 2 },
    { sampleId: 'b', plyCount: 1 },
  ];
  const timing = { epochMs: 100, holdMs: 500, plyMs: 1000 };

  it('maps elapsed wall-clock time to the current sample and ply', () => {
    expect(resolveWallClockReplayPosition(samples, 100, timing)).toMatchObject({
      ply: 0,
      plyElapsedMs: 0,
      sampleId: 'a',
      sampleIndex: 0,
    });
    expect(resolveWallClockReplayPosition(samples, 1100, timing)).toMatchObject({
      ply: 1,
      plyElapsedMs: 0,
      sampleId: 'a',
    });
    expect(resolveWallClockReplayPosition(samples, 2100, timing)).toMatchObject({
      ply: 2,
      plyElapsedMs: 0,
      sampleId: 'a',
    });
    expect(resolveWallClockReplayPosition(samples, 2600, timing)).toMatchObject({
      ply: 0,
      plyElapsedMs: 0,
      sampleId: 'b',
      sampleIndex: 1,
    });
  });

  it('reports elapsed time within the active ply', () => {
    expect(resolveWallClockReplayPosition(samples, 650, timing)).toMatchObject({
      ply: 0,
      plyElapsedMs: 550,
      sampleId: 'a',
    });
    expect(resolveWallClockReplayPosition(samples, 1850, timing)).toMatchObject({
      ply: 1,
      plyElapsedMs: 750,
      sampleId: 'a',
    });
  });

  it('wraps deterministically across the whole corpus cycle', () => {
    const cycle = resolveWallClockReplayPosition(samples, 100, timing)?.cycleMs;
    expect(cycle).toBe(4000);
    expect(resolveWallClockReplayPosition(samples, 4100, timing)).toMatchObject({
      ply: 0,
      sampleId: 'a',
    });
    expect(resolveWallClockReplayPosition(samples, 99, timing)).toMatchObject({
      ply: 1,
      sampleId: 'b',
    });
  });

  it('returns null for an empty corpus', () => {
    expect(resolveWallClockReplayPosition([], 100, timing)).toBeNull();
  });
});

function slotLabels(slot: ParentNode): string[] {
  return [...slot.querySelectorAll('.captures-piece')].map(
    (piece) => piece.getAttribute('aria-label') ?? '',
  );
}

function captureLabels(root: ParentNode, selector: string): string[] {
  const strip = root.querySelector(selector);
  return [...(strip?.querySelectorAll('.captures-piece') ?? [])].map(
    (piece) => piece.getAttribute('aria-label') ?? '',
  );
}

const reviewCaptureEvents: GameEvent[] = [
  {
    type: 'room-created',
    at: 1,
    roomId: 'review-captures-test',
    variant: 'dark-chess',
  },
  {
    type: 'move-played',
    at: 2,
    roomId: 'review-captures-test',
    color: 'white',
    move: { from: 'e2', to: 'e4' },
  },
  {
    type: 'move-played',
    at: 3,
    roomId: 'review-captures-test',
    color: 'black',
    move: { from: 'd7', to: 'd5' },
  },
  {
    type: 'move-played',
    at: 4,
    roomId: 'review-captures-test',
    color: 'white',
    move: { from: 'e4', to: 'd5' },
    capturedRole: 'pawn',
  },
  {
    type: 'move-played',
    at: 5,
    roomId: 'review-captures-test',
    color: 'black',
    move: { from: 'd8', to: 'd5' },
    capturedRole: 'pawn',
  },
];

describe('resolveWallClockThinkingElapsedMs', () => {
  it('advances homepage clock text at real elapsed time, not compressed replay speed', () => {
    expect(resolveWallClockThinkingElapsedMs(450, 5_000)).toBe(450);
    expect(resolveWallClockThinkingElapsedMs(900, 5_000)).toBe(900);
  });

  it('caps elapsed time at the recorded think time', () => {
    expect(resolveWallClockThinkingElapsedMs(1_200, 750)).toBe(750);
  });
});
