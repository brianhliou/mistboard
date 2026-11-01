import {
  applyStandardXiangqiMove,
  parseStandardXiangqiFen,
  standardXiangqiEngineFen,
  XIANGQI_PUZZLES,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from '../analytics.js';
import { parsePracticePositionParams } from '../practice-position-params.js';
import type { PuzzleSession } from './adapter.js';
import { feedbackPanel } from './detail-panels.js';

vi.mock('../analytics.js', () => ({ track: vi.fn() }));

function position(fen: string): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(fen, 'play-position-test');
  if (!parsed.ok) throw new Error('invalid test position');
  return parsed.state;
}

function play(state: XiangqiGameState, move: XiangqiMove): XiangqiGameState {
  return applyStandardXiangqiMove(state, move);
}

function materialSession(side: XiangqiColor = 'red'): PuzzleSession {
  const initial = position(`r3k4/9/9/9/4p4/4P4/9/9/9/R3K4 ${side === 'red' ? 'w' : 'b'} - - 0 1`);
  const move: XiangqiMove = side === 'red' ? { from: 'a1', to: 'a10' } : { from: 'a10', to: 'a1' };
  return {
    puzzle: {
      id: `material-${side}`,
      variant: 'xiangqi',
      initial,
      sideToMove: side,
      title: 'Win a chariot',
      goal: { type: 'winning-advantage', winner: side },
      themes: [],
      motifs: [],
      solutionPlyCount: 1,
      rating: 1500,
      ratingProvisional: true,
    },
    state: play(initial, move),
    playedMoves: [move],
    solverMoves: [move],
    viewPly: 1,
    solved: true,
    failed: false,
    revealed: false,
    submitting: false,
    feedback: { kind: 'good', text: '' },
    qualitySessionId: 'play-position-test',
    selectedSquare: null,
    selectedDrop: null,
    draggingFrom: null,
    focusNext: false,
    vote: null,
    setupIntro: null,
  };
}

function panel(session: PuzzleSession): HTMLElement {
  return feedbackPanel(
    session,
    {
      index: 0,
      total: 2,
      hasPrevious: false,
      hasNext: true,
      goPrevious: vi.fn(),
      goNext: vi.fn(),
    },
    vi.fn(),
    { onHint: vi.fn(), onReveal: vi.fn(), onVote: vi.fn() },
    session.viewPly === 0 ? session.puzzle.initial : session.state,
  );
}

function playLink(el: HTMLElement): HTMLAnchorElement | null {
  return el.querySelector('[data-puzzle-play-position]');
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('play the displayed puzzle position', () => {
  it.each(['red', 'black'] as const)(
    'hands the final material position to practice as %s',
    (side) => {
      const session = materialSession(side);
      const el = panel(session);
      const link = playLink(el);
      expect(link).not.toBeNull();
      const url = new URL(link!.href);
      expect(url.pathname).toBe('/practice/position');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        fen:
          side === 'red'
            ? 'R3k4/9/9/9/4p4/4P4/9/9/9/4K4 b - - 0 1'
            : '4k4/9/9/9/4p4/4P4/9/9/9/r3K4 w - - 0 2',
        side,
        goal: 'mate',
      });
      expect(parsePracticePositionParams(url.searchParams).ok).toBe(true);
      expect(link!.closest('.puzzle-solved-panel')).toBe(el);
      // A quiet link under Next puzzle, never in the vote row.
      expect(link!.closest('.puzzle-vote-actions')).toBeNull();
      expect(link!.previousElementSibling?.matches('.puzzle-continue-button')).toBe(true);
      expect(el.querySelectorAll('.puzzle-vote-actions button')).toHaveLength(2);
      expect(link!.querySelector('.ui-icon-play-engine')).not.toBeNull();
      expect(link!.textContent).toBe('Play the computer');
      expect(link!.getAttribute('style')).toBeNull();
      expect(link!.target).toBe('_blank');
      expect(link!.rel).toBe('noopener');
    },
  );

  it.each([false, true])('follows a replay step back after solve/reveal (%s)', (revealed) => {
    const session = materialSession();
    session.revealed = revealed;
    const finalHref = playLink(panel(session))!.href;
    session.viewPly -= 1;
    const link = playLink(panel(session));
    expect(link).not.toBeNull();
    expect(link!.href).not.toBe(finalHref);
    expect(new URL(link!.href).searchParams.get('fen')).toBe(
      standardXiangqiEngineFen(session.puzzle.initial as XiangqiGameState),
    );
    expect(link!.closest('.puzzle-vote-actions')).toBeNull();
    expect(link!.target).toBe('_blank');
    link!.addEventListener('click', (event) => event.preventDefault());
    link!.click();
    expect(track).toHaveBeenCalledExactlyOnceWith('puzzle_play_position', {
      puzzle_id: session.puzzle.id,
      outcome: revealed ? 'revealed' : 'solved',
      ply: 0,
    });
  });

  it.each(['solved', 'failed', 'revealed'] as const)(
    'tracks one click with outcome %s',
    (outcome) => {
      const session = materialSession();
      session.failed = outcome !== 'solved';
      session.solved = outcome !== 'revealed';
      session.revealed = outcome === 'revealed';
      const el = panel(session);
      expect(track).not.toHaveBeenCalled();
      const link = playLink(el);
      expect(link).not.toBeNull();
      // Prevent navigation while exercising the real click listener.
      link!.addEventListener('click', (event) => event.preventDefault());
      link!.click();
      expect(track).toHaveBeenCalledExactlyOnceWith('puzzle_play_position', {
        puzzle_id: session.puzzle.id,
        outcome,
        ply: 1,
      });
    },
  );

  it.each([false, true])('omits a finished mate after solve/reveal (%s)', (revealed) => {
    const puzzle = XIANGQI_PUZZLES.find((entry) => entry.goal.type === 'checkmate')!;
    const session = materialSession();
    session.state = puzzle.solution.reduce(play, puzzle.initial);
    session.puzzle.initial = puzzle.initial;
    expect(session.state.status.type).toBe('finished');
    session.revealed = revealed;
    expect(playLink(panel(session))).toBeNull();
    // A finished live state must not hide a playable earlier board position.
    session.viewPly = 0;
    expect(playLink(panel(session))).not.toBeNull();
  });

  it('also omits a no-move position whose parsed status still says playing', () => {
    const session = materialSession();
    session.puzzle.initial = position('3k5/3R5/3R5/9/9/9/9/9/9/4K4 b - - 0 1');
    session.viewPly = 0;
    expect(session.puzzle.initial.status.type).toBe('playing');
    expect(playLink(panel(session))).toBeNull();
  });

  it('does not offer practice during an unfinished failed attempt', () => {
    const session = materialSession();
    session.solved = false;
    session.failed = true;
    expect(playLink(panel(session))).toBeNull();
  });

  it('does not send another variant to the xiangqi practice route', () => {
    const session = materialSession();
    session.puzzle.variant = 'jungle';
    expect(playLink(panel(session))).toBeNull();
  });

  it.each([
    ['en', 'Play the computer'],
    ['zh-Hans', '与电脑对弈'],
    ['zh-Hant', '與電腦對弈'],
  ])('localizes the action for %s', (locale, label) => {
    window.history.replaceState(
      null,
      '',
      locale === 'en' ? '/puzzles' : `/${locale.toLowerCase()}/puzzles`,
    );
    const link = playLink(panel(materialSession()));
    expect(link?.title).toBe(label);
    expect(link?.getAttribute('aria-label')).toBe(label);
    expect(link?.textContent).toBe(label);
    expect(new URL(link!.href).pathname).toBe('/practice/position');
  });
});
