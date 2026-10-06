import type { XiangqiSquare } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderShotSvg } from './frame.js';
import { BOARD_HEIGHT, BOARD_WIDTH, PIECE_SIZE, squareCenter } from './geometry.js';
import { type ScenePlan, validateScenePlan } from './manifest.js';
import { inlinePieceImages } from './raster.js';
import { SHOW_SECTION_LABEL, VIDEO_PIECE_SET } from './theme.js';
import { expandTimeline, type Shot } from './timeline.js';

const basePlan = (segments: ScenePlan['segments']): ScenePlan => ({
  id: 'test',
  title: 'Test',
  fps: 30,
  width: 1920,
  height: 1080,
  background: '#101418',
  segments,
});

describe('expandTimeline', () => {
  it('pads a segment out to its target duration', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 5000,
        steps: [{ kind: 'position', position: 'empty', holdMs: 500 }],
      },
    ]);
    const timeline = expandTimeline(plan);
    expect(timeline.totalMs).toBe(5000);
    expect(timeline.segmentStartsMs.a).toBe(0);
  });

  it('stretches still holds proportionally but keeps animation and blink rhythm', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 10_000,
        steps: [
          {
            kind: 'position',
            position: [{ square: 'e5', color: 'red', role: 'chariot' }],
            holdMs: 300,
          },
          { kind: 'move', from: 'e5', to: 'e9', durationMs: 200, holdAfterMs: 300 },
        ],
      },
    ]);
    const timeline = expandTimeline(plan);
    expect(timeline.totalMs).toBeCloseTo(10_000, 5);
    // Animation frames keep 1000/30 ms each; both holds scale by the same factor.
    const animation = timeline.shots.filter((shot) => shot.moving !== null);
    for (const shot of animation) expect(shot.durationMs).toBeCloseTo(1000 / 30, 5);
    const stills = timeline.shots.filter((shot) => shot.moving === null);
    expect(stills.length).toBe(2);
    expect(stills[1]!.durationMs / stills[0]!.durationMs).toBeCloseTo(1, 5);
    // The landing sound moved with the stretched pre-move hold.
    const preMoveHold = stills[0]!.durationMs;
    expect(timeline.soundEvents[0]?.atMs).toBeCloseTo(preMoveHold + 200, 5);
  });

  it('lets long steps extend past the target (never cuts an animation)', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 100,
        steps: [{ kind: 'position', position: 'empty', holdMs: 900 }],
      },
      { id: 'b', durationMs: 1000, steps: [] },
    ]);
    const timeline = expandTimeline(plan);
    expect(timeline.segmentStartsMs.b).toBe(900);
    expect(timeline.totalMs).toBe(1900);
  });

  it('expands a move into per-frame shots with a sound at landing', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 0,
        steps: [
          {
            kind: 'position',
            position: [{ square: 'e5', color: 'red', role: 'chariot' }],
            holdMs: 100,
          },
          { kind: 'move', from: 'e5', to: 'e9', durationMs: 200, holdAfterMs: 100 },
        ],
      },
    ]);
    const timeline = expandTimeline(plan);
    const movingShots = timeline.shots.filter((shot) => shot.moving !== null);
    expect(movingShots.length).toBe(6); // 200ms at 30fps
    expect(movingShots.at(-1)?.moving?.t).toBe(1);
    expect(timeline.soundEvents).toEqual([{ atMs: 300, sound: 'move' }]);
    const settle = timeline.shots.at(-1);
    expect(settle?.board.e9?.role).toBe('chariot');
    expect(settle?.lastMove).toEqual({ from: 'e5', to: 'e9' });
  });

  it('marks captures with the capture sound and removes the victim', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 0,
        steps: [
          {
            kind: 'position',
            position: [
              { square: 'c5', color: 'red', role: 'cannon' },
              { square: 'f5', color: 'red', role: 'horse' },
              { square: 'h5', color: 'black', role: 'chariot' },
            ],
            holdMs: 100,
          },
          { kind: 'move', from: 'c5', to: 'h5', durationMs: 100, holdAfterMs: 0 },
        ],
      },
    ]);
    const timeline = expandTimeline(plan);
    expect(timeline.soundEvents[0]?.sound).toBe('capture');
    const during = timeline.shots.find((shot) => shot.moving !== null);
    expect(during?.board.h5).toBeUndefined(); // victim hidden mid-flight
    expect(during?.board.c5).toBeUndefined();
  });

  it('keeps overlays sticky until cleared and drops them on position', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 0,
        steps: [
          { kind: 'position', position: 'empty', holdMs: 100 },
          { kind: 'region', region: 'river', holdMs: 100 },
          { kind: 'hold', ms: 100 },
          { kind: 'clearOverlays', holdMs: 100 },
          { kind: 'position', position: 'start', holdMs: 100 },
        ],
      },
    ]);
    const timeline = expandTimeline(plan);
    const regions = timeline.shots.map((shot) => shot.overlays.region);
    expect(regions).toEqual([null, 'river', 'river', null, null]);
  });

  it('flash blinks and ends lit for the hold remainder', () => {
    const plan = basePlan([
      {
        id: 'a',
        durationMs: 0,
        steps: [
          {
            kind: 'position',
            position: [
              { square: 'e1', color: 'red', role: 'general' },
              { square: 'd10', color: 'black', role: 'general' },
            ],
            holdMs: 100,
          },
          { kind: 'flash', from: 'd10', to: 'e10', holdMs: 1500 },
        ],
      },
    ]);
    const timeline = expandTimeline(plan);
    const flashes = timeline.shots.slice(1).map((shot) => shot.overlays.flash !== null);
    expect(flashes).toEqual([true, false, true, false, true, true]);
  });
});

describe('renderShotSvg', () => {
  const shot = (over: Partial<Shot>): Shot => ({
    board: { e5: { color: 'red', role: 'chariot' } },
    lastMove: null,
    overlays: {
      glow: [],
      dimOthers: false,
      points: [],
      pointsCapture: false,
      pointsBlocked: false,
      raysFrom: null,
      region: null,
      arrows: [],
      measures: [],
      measuresDim: true,
      flash: null,
    },
    moving: null,
    label: null,
    durationMs: 100,
    ...over,
  });
  const plan = basePlan([{ id: 'a', durationMs: 100, steps: [] }]);

  it('sizes the nested board svg so the stage transform can scale it', () => {
    // Regression: the sizing patch matched an exact class string, so the board
    // root gaining a layout modifier class silently no-oped it. An unsized
    // nested <svg> fills the viewport and scale() throws the board off-canvas.
    const svg = renderShotSvg(plan, shot({}));
    const boardRoot = svg.match(/<svg\b[^>]*class="xq-live-svg[^>]*>/)?.[0];
    expect(boardRoot).toBeDefined();
    expect(boardRoot).toContain(`width="${BOARD_WIDTH}"`);
    expect(boardRoot).toContain(`height="${BOARD_HEIGHT}"`);
    // The injected size must match the board's own viewBox or centering drifts.
    expect(boardRoot).toContain(`viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}"`);
  });

  it('pins the channel piece set instead of inheriting the product default', () => {
    // The product resolves the set from localStorage, which does not exist in
    // the render process — unpinned, the whole back catalog silently re-skins
    // whenever the app default changes. Pinning it is a branding decision, so
    // changing this value should have to break a test.
    expect(VIDEO_PIECE_SET).toBe('international');
    // International is an image set: every piece resolves to a
    // /piece-sets/xiangqi/international/ href, inlined as a data URI at raster
    // time. A layer that draws anything else is a layer the pin stopped
    // reaching. Every path that draws a piece must carry it, not just the board
    // layer: the overlay layer re-draws glowed pieces and the sliding piece
    // itself, and those calls silently fell back to the product default.
    const glow = { ...shot({}).overlays, glow: ['e5' as XiangqiSquare], dimOthers: true };
    const cases = {
      board: renderShotSvg(plan, shot({})),
      glowed: renderShotSvg(plan, shot({ overlays: glow })),
      moving: renderShotSvg(
        plan,
        shot({
          moving: {
            piece: { color: 'red', role: 'chariot' },
            from: 'e5' as XiangqiSquare,
            to: 'e9' as XiangqiSquare,
            t: 0.5,
          },
        }),
      ),
    };
    for (const [name, svg] of Object.entries(cases)) {
      expect(svg, `${name} layer drew no piece art`).toContain(
        '/piece-sets/xiangqi/international/',
      );
      // No other set may appear anywhere in the frame, which is what a fallback
      // to the product default would look like.
      expect(
        svg.match(/\/piece-sets\/xiangqi\/([^/]+)\//g) ?? [],
        `${name} layer mixed sets`,
      ).toEqual(
        Array.from(
          { length: (svg.match(/\/piece-sets\/xiangqi\//g) ?? []).length },
          () => '/piece-sets/xiangqi/international/',
        ),
      );
    }
    expect(cases.board).toContain('aria-label="red chariot"');
  });

  it('draws gutter chrome outside the board transform, and honours the label flag', () => {
    // Coordinates must live in canvas space: the board's own margin is 36 units
    // against a 27-unit piece radius, so anything drawn there sits under the
    // edge pieces. Gutter chrome belongs after the board group, not inside it.
    const svg = renderShotSvg(plan, { ...shot({}), label: 'The cannon' });
    // The first </svg> closes the nested board; anything after it is canvas
    // space, outside the scale() transform.
    const boardEnd = svg.indexOf('</svg>');
    expect(boardEnd).toBeGreaterThan(-1);
    // Match the attribute, not the bare class name: the inlined <style> block
    // mentions both selectors near the top of the document.
    expect(svg.indexOf('class="xqv-coords"')).toBeGreaterThan(boardEnd);
    for (const rank of [1, 5, 10]) expect(svg).toContain(`>${rank}</text>`);
    // Section titles are a channel look, not a renderer feature: the flag turns
    // them off without touching the story's chapter fields, which still drive
    // YouTube chapter generation. Assert whichever state is configured, so
    // flipping it back cannot quietly lose the canvas-space placement above.
    if (SHOW_SECTION_LABEL) {
      expect(svg).toContain('THE CANNON');
      expect(svg.indexOf('class="xqv-label"')).toBeGreaterThan(boardEnd);
    } else {
      expect(svg).not.toContain('THE CANNON');
      expect(svg).not.toContain('class="xqv-label"');
    }
  });

  it('places overlays where the product board draws the piece, from both sides (drift guard)', () => {
    // e5 sits on the middle file, so a check there cannot tell a rotation from a
    // top-to-bottom mirror; the corners can. squareCenter flipped only the rank
    // until 2026-10-06, so every black-side overlay landed on the mirrored file.
    for (const perspective of ['red', 'black'] as const) {
      for (const square of ['a1', 'i10', 'e5'] as XiangqiSquare[]) {
        const svg = renderShotSvg(
          { ...plan, perspective },
          shot({
            board: { [square]: { color: 'red', role: 'chariot' } },
            overlays: { ...shot({}).overlays, glow: [square] },
          }),
        );
        const slot = new RegExp(
          `data-piece-square="${square}">[^]*?\\sx="([\\d.-]+)"[^>]*?\\sy="([\\d.-]+)"`,
        ).exec(svg);
        expect(slot, `${square} piece slot`).not.toBeNull();
        const drawn = {
          x: Number(slot?.[1]) + PIECE_SIZE / 2,
          y: Number(slot?.[2]) + PIECE_SIZE / 2,
        };
        const center = squareCenter(square, perspective);
        expect([perspective, square, center]).toEqual([perspective, square, drawn]);
        expect(svg).toContain(`class="xqv-glow-ring" cx="${center.x}" cy="${center.y}"`);
      }
    }
  });

  it('boxes a file region on that file from either side', () => {
    // The a-file line is at the left margin for red and the right one for black
    // (36 and 36 + 8 * 60), whatever squareCenter says.
    for (const [perspective, x] of [
      ['red', 36],
      ['black', 516],
    ] as const) {
      const svg = renderShotSvg(
        { ...plan, perspective },
        shot({ overlays: { ...shot({}).overlays, region: { file: 'a' } } }),
      );
      expect(svg).toContain(`<rect class="xqv-region" x="${x - 20}"`);
    }
  });

  it('renders kernel rays as hint markers', () => {
    const svg = renderShotSvg(
      plan,
      shot({ overlays: { ...shot({}).overlays, raysFrom: 'e5' as XiangqiSquare } }),
    );
    // A lone chariot on e5 sees 17 destinations (8 horizontal + 9 vertical).
    expect(svg.match(/<circle class="xq-live-hint-dot"/g)?.length).toBe(17);
  });

  it('renders the moving piece at interpolated coordinates', () => {
    const from = squareCenter('e5' as XiangqiSquare, 'red');
    const to = squareCenter('e9' as XiangqiSquare, 'red');
    const svg = renderShotSvg(
      plan,
      shot({
        board: {},
        moving: {
          piece: { color: 'red', role: 'chariot' },
          from: 'e5' as XiangqiSquare,
          to: 'e9' as XiangqiSquare,
          t: 0.5,
        },
      }),
    );
    const midY = (from.y + to.y) / 2 - PIECE_SIZE / 2;
    expect(svg).toContain(`y="${midY}"`);
  });

  it('dims the board and re-lights glowed pieces', () => {
    const svg = renderShotSvg(
      plan,
      shot({
        overlays: {
          ...shot({}).overlays,
          glow: ['e5' as XiangqiSquare],
          dimOthers: true,
        },
      }),
    );
    expect(svg).toContain('xqv-dim');
    expect(svg).toContain('xqv-glow-ring');
  });
});

describe('inlinePieceImages', () => {
  it('rewrites piece hrefs to data URIs and strips cache-bust params', () => {
    const svg = '<image href="/piece-sets/xiangqi/international/red-chariot.png?v=7"/>';
    const out = inlinePieceImages(svg, () => Buffer.from('png-bytes'));
    expect(out).toContain('href="data:image/png;base64,');
    expect(out).not.toContain('?v=7');
  });
});

describe('validateScenePlan', () => {
  it('flags bad squares, bad durations, and duplicate ids', () => {
    const errors = validateScenePlan(
      basePlan([
        { id: 'a', durationMs: 0, steps: [] },
        {
          id: 'a',
          durationMs: Number.NaN,
          steps: [{ kind: 'move', from: 'z9' as XiangqiSquare, to: 'e5' as XiangqiSquare }],
        },
      ]),
    );
    expect(errors.some((error) => error.includes('duplicate segment id'))).toBe(true);
    expect(errors.some((error) => error.includes("bad square 'z9'"))).toBe(true);
    expect(errors.some((error) => error.includes('durationMs'))).toBe(true);
    expect(errors.some((error) => error.includes('neither duration nor steps'))).toBe(true);
  });
});
