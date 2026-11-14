import type { ClockState, GameEvent, GameState } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  createClockPanel,
  renderClockPanel,
  replayClockDisplayAt,
  setClockPanelNames,
} from './replay-clocks.js';
import type { GameMeta } from './replay-meta.js';

function playingState(turn: 'white' | 'black' = 'white'): GameState {
  return { status: { turn, type: 'playing' } } as GameState;
}

function finishedState(): GameState {
  return { status: { reason: 'king-captured', type: 'finished', winner: 'white' } } as GameState;
}

describe('replayClockDisplayAt', () => {
  it('uses the last event timestamp before falling back to the running clock', () => {
    const events = [{ at: 100 }, { at: 250 }] as GameEvent[];
    const state = { clock: { runningSince: 75 } } as GameState;

    expect(replayClockDisplayAt(events, state)).toBe(250);
    expect(replayClockDisplayAt([], state)).toBe(75);
  });
});

describe('renderClockPanel', () => {
  const meta: GameMeta = {
    blackName: 'Engine',
    modeLabel: 'Fog of War',
    plyCount: 8,
    result: 'white-wins',
    termination: 'king-captured',
    variant: null,
    timeControl: { kind: 'per-move', milliseconds: 5_000 },
    whiteName: 'Guest',
  };

  it('renders clockless thinking progress from replay metadata', () => {
    const panel = createClockPanel();
    setClockPanelNames(panel, meta);

    renderClockPanel(panel, undefined, playingState('white'), meta, undefined, {
      activeColor: 'white',
      budgetMs: 5_000,
      elapsedMs: 250,
    });

    expect(panel.el.hidden).toBe(false);
    expect(panel.label.textContent).toBe('Time 0:05 / move');
    expect(panel.whiteLabel.textContent).toBe('Guest');
    expect(panel.blackLabel.textContent).toBe('Engine');
    // The seat to move counts its per-move budget DOWN (5s allowance, 0.25s of it spent);
    // the idle seat shows the full allowance it gets on its own turn. Together they read as
    // a clock. The progress fill still tracks the fraction CONSUMED.
    expect(panel.whiteTime.textContent).toBe('4.8s');
    expect(panel.blackTime.textContent).toBe('5s');
    expect(panel.whiteRow.classList.contains('active')).toBe(true);
    expect(panel.whiteRow.classList.contains('is-thinking')).toBe(true);
    expect(panel.whiteRow.style.getPropertyValue('--replay-thinking-progress')).toBe('0.05');
  });

  it('keeps a barely-started countdown one decimal wide, so the label cannot jump', () => {
    const panel = createClockPanel();

    renderClockPanel(panel, undefined, playingState('white'), meta, undefined, {
      activeColor: 'white',
      budgetMs: 5_000,
      elapsedMs: 50,
    });

    // "5.0s", not "5s": the countdown keeps its tenth so the row does not reflow on the
    // first tick. The idle seat's bare "5s" is a different label and stays integer.
    expect(panel.whiteTime.textContent).toBe('5.0s');
  });

  it('pins an over-budget engine at zero rather than a negative remainder', () => {
    const panel = createClockPanel();

    // Misty routinely overshoots its per-move budget; the caller caps elapsed at the budget
    // so the countdown bottoms out instead of counting past it.
    renderClockPanel(panel, undefined, playingState('white'), meta, undefined, {
      activeColor: 'white',
      budgetMs: 5_000,
      elapsedMs: 5_000,
    });

    expect(panel.whiteTime.textContent).toBe('0.0s');
  });

  it('leaves per-move budget clocks blank after clockless games finish', () => {
    const panel = createClockPanel();
    setClockPanelNames(panel, meta);

    renderClockPanel(panel, undefined, finishedState(), meta);

    expect(panel.el.hidden).toBe(false);
    expect(panel.whiteTime.textContent).toBe('');
    expect(panel.blackTime.textContent).toBe('');
    expect(panel.whiteRow.classList.contains('active')).toBe(false);
    expect(panel.blackRow.classList.contains('active')).toBe(false);
  });

  it('renders real clock time using display overrides', () => {
    const panel = createClockPanel();
    const clock: ClockState = {
      activeColor: 'black',
      incrementMs: 1_000,
      initialMs: 180_000,
      remainingMs: { black: 120_000, white: 60_000 },
      runningSince: 1_000,
    };

    renderClockPanel(panel, clock, playingState('black'), undefined, 11_000);

    expect(panel.label.textContent).toBe('Time 3:00+1');
    expect(panel.whiteTime.textContent).toBe('1:00.0');
    expect(panel.blackTime.textContent).toBe('1:50.0');
    expect(panel.blackRow.classList.contains('active')).toBe(true);
    expect(panel.blackToMove.getAttribute('aria-hidden')).toBe('false');
  });
});
