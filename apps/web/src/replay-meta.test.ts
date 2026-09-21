import type { GameEvent } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  createGameHeaderStrip,
  createGameMetaPanel,
  deriveThinkingBudgetMsFromEvents,
  renderGameHeader,
  renderGameMetaPanel,
  thinkingBudgetMsFromMeta,
  timeControlLabelFromMeta,
} from './replay-meta.js';

describe('timeControlLabelFromMeta', () => {
  it('preserves existing metadata time-control labels', () => {
    expect(timeControlLabelFromMeta({ label: '  3+2 blitz  ' })).toBe('3+2 blitz');
    expect(timeControlLabelFromMeta({ kind: 'none' })).toBe('Untimed');
    expect(timeControlLabelFromMeta({ initial_seconds: 300 })).toBe('5:00');
    expect(timeControlLabelFromMeta({ initial_seconds: 300, increment_seconds: 2 })).toBe('5:00+2');
    expect(timeControlLabelFromMeta({ initial_ms: 180_000 })).toBe('3:00');
    expect(timeControlLabelFromMeta({ initial_ms: 180_000, increment_ms: 1_000 })).toBe('3:00+1');
    expect(timeControlLabelFromMeta({ kind: 'per-move', milliseconds: 5_000 })).toBe('0:05 / move');
    expect(timeControlLabelFromMeta({ kind: 'custom-fast' })).toBe('custom-fast');
  });
});

describe('thinkingBudgetMsFromMeta', () => {
  it('reads explicit millisecond and second budgets', () => {
    expect(thinkingBudgetMsFromMeta({ budget_ms: 1_500 })).toBe(1_500);
    expect(thinkingBudgetMsFromMeta({ per_move_seconds: 2 })).toBe(2_000);
    expect(thinkingBudgetMsFromMeta({ budget_ms: 0, per_move_seconds: 0 })).toBeNull();
  });
});

describe('deriveThinkingBudgetMsFromEvents', () => {
  const move = (compute_ms: number): GameEvent =>
    ({ type: 'move-played', compute_ms, thinkTimeMs: compute_ms }) as unknown as GameEvent;

  it('recovers the per-move budget from a 5s engine game', () => {
    const events = [
      { type: 'room-created' } as unknown as GameEvent,
      ...[5000, 5002, 5001, 5003, 5294].map(move),
    ];
    expect(deriveThinkingBudgetMsFromEvents(events)).toBe(5_000);
  });

  it('recovers a 13s budget — not assuming a constant', () => {
    expect(deriveThinkingBudgetMsFromEvents([13001, 13010, 13006, 13023].map(move))).toBe(13_000);
  });

  it('ignores instant/forced moves so they do not drag the budget down', () => {
    // Many 0ms forced moves alongside full-budget moves: the budget is still 5s.
    const events = [0, 0, 0, 0, 5000, 5001, 5002].map(move);
    expect(deriveThinkingBudgetMsFromEvents(events)).toBe(5_000);
  });

  it('returns null when no move carries compute timing (e.g. real PvP)', () => {
    const events = [
      { type: 'move-played' } as unknown as GameEvent,
      { type: 'move-played' } as unknown as GameEvent,
    ];
    expect(deriveThinkingBudgetMsFromEvents(events)).toBeNull();
  });
});

describe('replay metadata rendering', () => {
  const meta = {
    blackName: 'Engine',
    gameUrl: '/games/example',
    modeLabel: 'Fog of War',
    plyCount: 42,
    result: 'white-wins',
    termination: 'king-captured',
    timeControl: { initial_seconds: 300, increment_seconds: 2 },
    whiteName: 'Guest',
  };

  it('renders header metadata from the extracted module', () => {
    const header = createGameHeaderStrip();
    renderGameHeader(header, meta);

    expect(header.title.textContent).toBe('Fog of War');
    expect(header.result.querySelector('.replay-game-header-result-chip')?.textContent).toBe(
      'White wins',
    );
    expect(header.result.querySelector('.replay-game-header-result-detail')?.textContent).toBe(
      'by king captured',
    );
    expect(header.meta.textContent).toContain('5:00+2');
    expect(header.meta.textContent).toContain('42 plies');
  });

  it('renders panel metadata from the extracted module', () => {
    const panel = createGameMetaPanel();
    renderGameMetaPanel(panel, meta, 'sample-id');

    expect(panel.el.hidden).toBe(false);
    expect(panel.details.textContent).toContain('Fog of War');
    expect(panel.details.textContent).toContain('White wins');
    expect(panel.details.textContent).toContain('King captured');
    expect(panel.details.textContent).toContain('5:00+2');
    expect(panel.details.textContent).toContain('sample-id');
  });
});
