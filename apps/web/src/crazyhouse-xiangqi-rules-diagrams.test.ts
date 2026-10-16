import { describe, expect, it } from 'vitest';
import {
  CRAZYHOUSE_XIANGQI_ADVISOR_PAIR,
  CRAZYHOUSE_XIANGQI_CAPTURE_PAIR,
  CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR,
  CRAZYHOUSE_XIANGQI_DROP_MATE_PAIR,
  CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR,
  CRAZYHOUSE_XIANGQI_INTRO_BOARD,
  CRAZYHOUSE_XIANGQI_START_BOARD,
  CRAZYHOUSE_XIANGQI_TURN_PAIR,
  CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE,
  CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF,
} from './crazyhouse-xiangqi-rules-diagrams.js';

// The figures are drawn from the kernel and throw when it no longer supports
// their captions, so rendering them is most of the test. The counts below pin
// what each figure shows: dots (r="6.5"), crosses (two red strokes each),
// rings around a dropped piece (r="16") and the hand strips' pieces.
const count = (svg: string, pattern: RegExp) => svg.match(pattern)?.length ?? 0;
const dots = (svg: string) => count(svg, /r="6\.5"/g);
const crosses = (svg: string) => count(svg, /stroke="#d4351c"/g) / 2;
const rings = (svg: string) => count(svg, /r="16"/g);
const hands = (svg: string) => count(svg, /class="xq-diagram-hand"/g);
const held = (svg: string, color: string) =>
  [...svg.matchAll(new RegExp(`data-hand-role="${color}-(\\w+)" data-count="(\\d+)"`, 'g'))]
    .map(([, role, n]) => `${role}${n}`)
    .sort();

describe('crazyhouse xiangqi rules diagrams', () => {
  const all = {
    INTRO_BOARD: CRAZYHOUSE_XIANGQI_INTRO_BOARD,
    START_BOARD: CRAZYHOUSE_XIANGQI_START_BOARD,
    TURN_PAIR: CRAZYHOUSE_XIANGQI_TURN_PAIR,
    CAPTURE_PAIR: CRAZYHOUSE_XIANGQI_CAPTURE_PAIR,
    ZONE_OWN_HALF: CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF,
    ZONE_ANYWHERE: CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE,
    DROP_CHECK_PAIR: CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR,
    DROP_MATE_PAIR: CRAZYHOUSE_XIANGQI_DROP_MATE_PAIR,
    ADVISOR_PAIR: CRAZYHOUSE_XIANGQI_ADVISOR_PAIR,
    ELEPHANT_PAIR: CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR,
  };
  for (const [name, render] of Object.entries(all)) {
    it(`${name} renders an SVG`, () => {
      const svg = render();
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    });
  }

  it('draws both hands at the start: two advisors and two elephants each', () => {
    const svg = CRAZYHOUSE_XIANGQI_START_BOARD();
    expect(hands(svg)).toBe(2);
    expect(held(svg, 'red')).toEqual(['advisor2', 'elephant2']);
    expect(held(svg, 'black')).toEqual(['advisor2', 'elephant2']);
  });

  it('ends the intro on the sample game’s mate, with what each side still holds', () => {
    const svg = CRAZYHOUSE_XIANGQI_INTRO_BOARD();
    expect(rings(svg)).toBe(1);
    expect(held(svg, 'red')).toEqual(['advisor1', 'cannon1', 'elephant1', 'soldier2']);
    expect(held(svg, 'black')).toEqual(['horse1']);
  });

  it('shows a drop taking the piece out of the hand and a move leaving it', () => {
    const svg = CRAZYHOUSE_XIANGQI_TURN_PAIR();
    expect(hands(svg)).toBe(4);
    expect(held(svg, 'red')).toEqual(['advisor2', 'advisor2', 'elephant1', 'elephant2']);
    expect(rings(svg)).toBe(1);
  });

  it('puts the captured horse in Red’s hand beside the soldier it already held', () => {
    const svg = CRAZYHOUSE_XIANGQI_CAPTURE_PAIR();
    expect(held(svg, 'red')).toEqual(['horse1', 'soldier1', 'soldier1']);
    expect(held(svg, 'black')).toEqual(['cannon1', 'cannon1']);
  });

  it('marks the drop zones on an empty board: 45 and 90 points', () => {
    expect(dots(CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF())).toBe(45);
    expect(dots(CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE())).toBe(90);
    // No board pieces, only the region's pieces in the strip above it.
    expect(count(CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE(), /data-piece-square/g)).toBe(0);
  });

  it('gives check with a dropped horse and with a dropped cannon screen', () => {
    const svg = CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR();
    expect(rings(svg)).toBe(2);
  });

  it('shows the mating drop: three soldiers in hand, then two and a ringed soldier on e9', () => {
    const svg = CRAZYHOUSE_XIANGQI_DROP_MATE_PAIR();
    expect(rings(svg)).toBe(1);
    expect(held(svg, 'red')).toContain('soldier3');
    expect(held(svg, 'red')).toContain('soldier2');
  });

  it('badges a count of two or more the way the live pocket does, and only then', () => {
    const svg = CRAZYHOUSE_XIANGQI_INTRO_BOARD();
    // Red holds soldier x2 and three singles; Black a single horse.
    expect(count(svg, /class="xq-diagram-hand-badge"/g)).toBe(1);
    expect(svg).toMatch(/class="xq-diagram-hand-badge-count"[^>]*>2</);
  });

  it('draws hand pieces at the board piece size, and the zone pieces larger', () => {
    const sizes = (svg: string) =>
      [...svg.matchAll(/data-hand-role="[^"]+" data-count="\d+"><svg[^>]*width="([\d.]+)"/g)].map(
        (m) => Number(m[1]),
      );
    const start = sizes(CRAZYHOUSE_XIANGQI_START_BOARD());
    const zone = sizes(CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE());
    expect(start.length).toBe(4);
    expect(zone.length).toBe(4);
    expect(Math.min(...zone)).toBeGreaterThan(Math.max(...start));
  });

  it('steps the advisor to four diagonals off the palace, and stops it at the river', () => {
    const svg = CRAZYHOUSE_XIANGQI_ADVISOR_PAIR();
    expect(dots(svg)).toBe(4 + 2);
    expect(crosses(svg)).toBe(2);
  });

  it('moves an elephant off its seven points and still honours the eye', () => {
    const svg = CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR();
    expect(dots(svg)).toBe(4 + 3);
    expect(crosses(svg)).toBe(1);
  });
});
