import {
  applyJieqiMove,
  assertValidJieqiDeal,
  getJieqiLegalMovesFrom,
  getJieqiPlayerView,
  getJieqiPublicView,
  isJieqiLegalMove,
  type JieqiGameState,
  type JieqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { jieqiArticle } from './articles/content/jieqi.js';
import { JIEQI_RULES_LINES, jieqiRulesMoves, jieqiRulesStates } from './jieqi-rules-diagrams.js';

function end(example: keyof typeof JIEQI_RULES_LINES): JieqiGameState {
  const { deal, moves } = JIEQI_RULES_LINES[example];
  return jieqiRulesStates(deal, moves).at(-1)!;
}

function destinations(state: JieqiGameState, from: JieqiSquare): string[] {
  return getJieqiLegalMovesFrom(state, from)
    .map((move) => move.to)
    .sort();
}

describe('Jieqi rules examples through the game kernel', () => {
  for (const [name, { deal, moves }] of Object.entries(JIEQI_RULES_LINES)) {
    it(`${name}: every displayed position is reached from a valid deal by legal moves`, () => {
      expect(() => assertValidJieqiDeal(deal)).not.toThrow();
      const states = jieqiRulesStates(deal, moves);
      const line = jieqiRulesMoves(moves);
      expect(states).toHaveLength(line.length + 1);
      for (const [i, move] of line.entries()) {
        expect(isJieqiLegalMove(states[i], move)).toBe(true);
        expect(states[i + 1].lastMove).toEqual(move);
        const mover = states[i].status;
        if (mover.type !== 'playing') throw new Error('Example continued after the game ended');
        expect(getJieqiPlayerView(states[i + 1], mover.turn).inCheck).toBe(false);
      }
    });
  }

  it('the starting points use horse legs, chariot blockers and confined advisor/elephant moves', () => {
    const state = end('start');
    expect(destinations(state, 'b1')).toContain('c3');
    expect(destinations(state, 'b1')).not.toContain('d2'); // c1 blocks the leg
    expect(destinations(state, 'a1')).toEqual(['a2', 'a3']); // a4 blocks the file
    expect(destinations(state, 'd1')).toEqual(['e2']);
    expect(destinations(state, 'c1')).toEqual(['a3', 'e3']);
    expect(isJieqiLegalMove(state, { from: 'b1', to: 'b1' })).toBe(false);
  });

  it('the horse-point move reveals an advisor that can leave the palace', () => {
    expect(end('horse').board.c3).toEqual({ color: 'red', role: 'advisor', faceDown: false });
    const line = JIEQI_RULES_LINES.advisor;
    const states = jieqiRulesStates(line.deal, line.moves);
    expect(destinations(states[2], 'c3')).toEqual(['b2', 'b4', 'd2', 'd4']);
    expect(end('advisor').board.d4?.role).toBe('advisor');
  });

  it('the dark cannon needs b8 as its screen, captures b10, and becomes a soldier', () => {
    const state = end('start');
    expect(state.board.b8).toBeDefined();
    expect(destinations(state, 'b3')).toContain('b10');
    expect(destinations(state, 'b3')).not.toContain('b8');
    const after = end('cannon');
    expect(after.board.b10).toEqual({ color: 'red', role: 'soldier', faceDown: false });
    expect(after.board.b8).toEqual(state.board.b8);
    expect(after.captures).toEqual([{ owner: 'black', role: 'cannon', revealedAtCapture: false }]);
    const states = jieqiRulesStates(JIEQI_RULES_LINES.soldier.deal, 'b3b10 i7i6');
    expect(destinations(states[2], 'b10')).toEqual(['a10', 'c10']);
    expect(destinations(states[2], 'b10')).not.toContain('b9');
    expect(end('soldier').board.c10?.role).toBe('soldier');
  });

  it('the elephant crosses the river only after revealing and still needs a clear eye', () => {
    const line = JIEQI_RULES_LINES.elephant;
    const states = jieqiRulesStates(line.deal, line.moves);
    expect(states[1].board.a5).toEqual({ color: 'red', role: 'elephant', faceDown: false });
    expect(states[2].board.b6).toBeUndefined();
    expect(end('elephant').board.c7?.role).toBe('elephant');
    const blocked = { ...states[2], board: { ...states[2].board, b6: states[2].board.i6 } };
    expect(isJieqiLegalMove(blocked, { from: 'a5', to: 'c7' })).toBe(false);
  });

  it('a corner can reveal a soldier which is blocked by its own front line', () => {
    const after = end('corner');
    expect(after.board.a3).toEqual({ color: 'red', role: 'soldier', faceDown: false });
    const redTurn: JieqiGameState = { ...after, status: { type: 'playing', turn: 'red' } };
    expect(destinations(redTurn, 'a3')).toEqual([]);
    expect(after.noCaptureClock).toBe(1); // revealing alone does not reset the clock
  });

  it('a reveal without capture still reaches the no-capture draw limit', () => {
    const before = { ...end('start'), noCaptureClock: 119 };
    const after = applyJieqiMove(before, { from: 'e4', to: 'e5' });
    expect(after.noCaptureClock).toBe(120);
    expect(after.status).toEqual({ type: 'finished', winner: null, reason: 'no-capture-clock' });
  });

  it('the cannon capture gives the capturer information absent from the whole public/victim payload', () => {
    const after = end('cannon');
    expect(after.noCaptureClock).toBe(0);
    const publicPayload = getJieqiPublicView(after);
    const victimPayload = getJieqiPlayerView(after, 'black');
    expect(publicPayload.captured).toEqual([{ owner: 'black', role: null }]);
    expect(victimPayload.captured).toEqual([{ owner: 'black', role: null }]);
    expect(getJieqiPlayerView(after, 'red').captured).toEqual([
      { owner: 'black', role: 'cannon', takenFaceDown: true },
    ]);
    // Change only the secretly captured identity, then compare full payloads.
    const other = { ...after, captures: [{ ...after.captures[0], role: 'horse' as const }] };
    expect(JSON.stringify(getJieqiPublicView(other))).toBe(JSON.stringify(publicPayload));
    expect(JSON.stringify(getJieqiPlayerView(other, 'black'))).toBe(JSON.stringify(victimPayload));
  });

  it('renders every rules figure using the existing diagram blocks', () => {
    let figures = 0;
    for (const section of jieqiArticle.sections) {
      for (const block of section.blocks ?? []) {
        const renderers =
          block.kind === 'raw-svg'
            ? [block.svg]
            : block.kind === 'svg-row'
              ? block.items.map((item) => item.svg)
              : [];
        for (const renderer of renderers) {
          const svg = typeof renderer === 'function' ? renderer() : renderer;
          expect(svg).toContain('<svg');
          expect(svg).toContain('</svg>');
          expect(svg).toContain('hidden piece');
          figures += 1;
        }
      }
    }
    expect(figures).toBe(7);
  });
});
