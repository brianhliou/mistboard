import { describe, expect, it } from 'vitest';
import * as diagrams from './banqi-rules-diagrams.js';

// Every diagram asks the kernel for its marks and throws if the kernel
// disagrees with what the diagram claims to show; rendering them all is the
// test that the rules page draws no rule the engine would refuse.
describe('banqi rules diagrams', () => {
  const thunks = Object.entries(diagrams).filter(
    (entry): entry is [string, () => string] =>
      typeof entry[1] === 'function' && /^BANQI_/.test(entry[0]),
  );

  it('exports the diagrams the rules page uses', () => {
    expect(thunks.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'BANQI_RANK_LADDER',
        'BANQI_SETUP',
        'BANQI_STEP',
        'BANQI_RANK_CAPTURE',
        'BANQI_SOLDIER_TAKES_GENERAL',
        'BANQI_GENERAL_CANNOT_TAKE_SOLDIER',
        'BANQI_CANNON_SCREEN',
        'BANQI_CANNON_NO_SCREEN',
        'BANQI_CANNON_FRIENDLY_SCREEN',
        'BANQI_CANNON_AS_TARGET',
        'BANQI_SOLDIER_CANNOT_TAKE_CANNON',
      ]),
    );
  });

  for (const [name, thunk] of thunks) {
    it(`${name} renders and the kernel agrees with it`, () => {
      const svg = thunk();
      expect(svg.startsWith('<svg')).toBe(true);
    });
  }

  it('a move diagram marks exactly the destinations the kernel allows', () => {
    const svg = diagrams.BANQI_CANNON_NO_SCREEN();
    // Three step hints, no capture ring: the adjacent chariot is not a target.
    expect(svg.match(/<circle class="banqi-hint"/g)?.length).toBe(3);
    expect(svg).not.toMatch(/<circle class="banqi-hint-capture"/);
    const screen = diagrams.BANQI_CANNON_SCREEN();
    expect(screen.match(/<circle class="banqi-hint-capture"/g)?.length).toBe(1);
  });
});
