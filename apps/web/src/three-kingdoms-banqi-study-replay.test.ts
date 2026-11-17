import {
  createInitialThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedBoardHandle } from './embed/embed-card.js';
import type { DecisionOverlay } from './review/analysis-marks.js';
import { threeKingdomsBanqiDecisionOverlay } from './review/three-kingdoms-banqi-decisions.js';
import type { StudyChapterPayload } from './study-chapter-spec.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  renderThreeKingdomsBanqiLiveBoardSvg,
} from './three-kingdoms-banqi-diagrams.js';
import {
  mountThreeKingdomsBanqiStudyReplay,
  threeKingdomsBanqiStudyLine,
} from './three-kingdoms-banqi-study-replay.js';

vi.mock('./three-kingdoms-banqi-diagrams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./three-kingdoms-banqi-diagrams.js')>();
  return {
    ...actual,
    animateThreeKingdomsBanqiBoardMove: vi.fn(),
    animateThreeKingdomsBanqiReveal: vi.fn(),
    renderThreeKingdomsBanqiLiveBoardSvg: vi.fn(actual.renderThreeKingdomsBanqiLiveBoardSvg),
  };
});

const chapter: StudyChapterPayload = {
  id: 'tk',
  variant: 'three-kingdoms-banqi',
  root: {
    replay: 'three-kingdoms-banqi-public-v1',
    root: {
      children: [
        { uci: '@a1:R', children: [{ uci: '@b1:s', children: [{ uci: 'a1b1' }] }] },
        { uci: '@c1:H' },
      ],
    },
  },
};

const handles: EmbedBoardHandle[] = [];
function mount(source = chapter, decisions?: DecisionOverlay) {
  const host = document.createElement('div');
  document.body.append(host);
  const line = threeKingdomsBanqiStudyLine(source);
  const onPlyChange = vi.fn();
  const handle = mountThreeKingdomsBanqiStudyReplay(host, line, decisions, { onPlyChange }, 'red');
  handles.push(handle);
  return { host, line, handle, onPlyChange, frame: host.firstElementChild as HTMLElement };
}

function expectNoAnimation() {
  expect(animateThreeKingdomsBanqiReveal).not.toHaveBeenCalled();
  expect(animateThreeKingdomsBanqiBoardMove).not.toHaveBeenCalled();
}

describe('Three Kingdoms Banqi study replay animations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const handle of handles.splice(0)) handle.destroy();
    document.body.replaceChildren();
  });

  it('turns over only the observed tile after painting a one-ply forward flip', () => {
    const { handle, frame, line, onPlyChange } = mount();
    const original = JSON.stringify(line);
    expectNoAnimation();
    expect(frame.innerHTML).not.toMatch(/chariot|soldier|horse/);
    vi.mocked(animateThreeKingdomsBanqiReveal).mockImplementationOnce((host) => {
      expect(host.querySelector('[data-piece-square="a1"]')).not.toBeNull();
      expect(host.innerHTML).toContain('chariot');
      expect(host.innerHTML).not.toMatch(/soldier|horse/);
      return true;
    });

    handle.jumpToPly?.(1);

    expect(animateThreeKingdomsBanqiReveal).toHaveBeenCalledExactlyOnceWith(frame, 'a1');
    expect(animateThreeKingdomsBanqiBoardMove).not.toHaveBeenCalled();
    expect(onPlyChange).toHaveBeenLastCalledWith(1, 3);
    expect(JSON.stringify(line)).toBe(original);
  });

  it('glides a one-ply forward move after painting its destination, including a capture', () => {
    const { handle, frame, line } = mount();
    handle.jumpToPly?.(2);
    vi.clearAllMocks();
    vi.mocked(animateThreeKingdomsBanqiBoardMove).mockImplementationOnce((host) => {
      expect(host.querySelector('[data-piece-square="a1"]')).toBeNull();
      expect(host.querySelector('[data-piece-square="b1"]')).not.toBeNull();
      expect(host.innerHTML).toContain('chariot');
      expect(host.innerHTML).not.toContain('soldier');
    });

    handle.jumpToPly?.(3);

    expect(animateThreeKingdomsBanqiBoardMove).toHaveBeenCalledExactlyOnceWith(
      frame,
      line.played[2],
    );
    expect(animateThreeKingdomsBanqiReveal).not.toHaveBeenCalled();
  });

  it.each([
    [3, 2],
    [2, 1],
    [1, 0],
    [0, 2],
    [0, 3],
    [3, 1],
    [3, 0],
    [1, 1],
  ])('repaints without animation from ply %i to %i', (from, to) => {
    const { handle, frame, onPlyChange } = mount();
    handle.jumpToPly?.(from);
    vi.clearAllMocks();

    handle.jumpToPly?.(to);

    expectNoAnimation();
    expect(renderThreeKingdomsBanqiLiveBoardSvg).toHaveBeenCalledTimes(1);
    expect(onPlyChange).toHaveBeenLastCalledWith(to, 3);
    if (to === 0) expect(frame.innerHTML).not.toMatch(/chariot|soldier|horse/);
  });

  it('repaints when leaving a sideline, then resumes one-ply mainline animations', () => {
    const { handle, frame } = mount();
    handle.jumpToLine?.(1, 1);
    expect(frame.innerHTML).toContain('horse');
    expectNoAnimation();

    handle.jumpToPly?.(1);

    expectNoAnimation();
    expect(frame.innerHTML).not.toContain('horse');
    handle.jumpToPly?.(2);
    expect(animateThreeKingdomsBanqiReveal).toHaveBeenCalledExactlyOnceWith(frame, 'b1');
  });

  it('keeps a dealt study root masked while animating its played flip', () => {
    const { handle, frame } = mount({
      id: 'dealt',
      variant: 'three-kingdoms-banqi',
      root: {
        rootFen: threeKingdomsBanqiStateToDealtFen(
          createInitialThreeKingdomsBanqiState('study', 11),
        ),
        root: { children: [{ uci: 'a1a1' }] },
      },
    });

    handle.jumpToPly?.(1);

    expect(animateThreeKingdomsBanqiReveal).toHaveBeenCalledExactlyOnceWith(frame, 'a1');
    const boards = JSON.parse(
      JSON.stringify(vi.mocked(renderThreeKingdomsBanqiLiveBoardSvg).mock.calls.map(([b]) => b)),
    );
    expect(boards).toHaveLength(2);
    expect(boards[0].a1).toEqual({ faceDown: true });
    expect(boards[1].a1.faceDown).toBe(false);
    for (const board of boards)
      for (const tile of Object.values(board))
        if ((tile as { faceDown: boolean }).faceDown) expect(tile).toEqual({ faceDown: true });
  });

  it('preserves the shared choice grade and move-list luck through a flip animation', () => {
    const decisions = threeKingdomsBanqiDecisionOverlay([
      {
        ply: 1,
        mover: 'red',
        bestWin: 70,
        playedWin: 50,
        realizedWin: 62,
        playedRank: 2,
        candidates: [
          { move: 'b1b1', win: 70 },
          { move: 'a1a1', win: 50, played: true },
        ],
      },
    ]);
    const { handle, frame } = mount(chapter, decisions);
    expect(handle.moveEntries?.()[0]).toMatchObject({
      ply: 1,
      suffix: '??',
      suffixClass: 'blunder',
      note: 'Blunder. b1 flip was best.',
      luck: 12,
    });

    handle.jumpToPly?.(1);

    expect(animateThreeKingdomsBanqiReveal).toHaveBeenCalledExactlyOnceWith(frame, 'a1');
    expect(frame.querySelector('.xq-marker--blunder')).not.toBeNull();
    expect(frame.querySelector('.luck-mark')).toBeNull();
  });
});
