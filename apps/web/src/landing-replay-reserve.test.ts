// The homepage viewer's slot below the desktop band. The seats sit in flow there,
// so the mounted viewer is two seat rows plus a board whose height depends on the
// variant, while the loading skeleton cannot know which game the TV will put
// on. Nothing below the viewer may move when the first game lands (it measured a
// 41px jump and CLS 0.18 on a phone) or when the TV swaps variants.
//
// happy-dom does no layout, so this reads the rules out of landing.css and
// checks them against each admitted variant's mounted height, measured in a
// phone browser on 2026-11-26 (board height for a board S wide).
import { readFileSync } from 'node:fs';
import { createXmjRoomState, createXmjSetup, GAME_SPECS, xmjViewFor } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { homepageTvAdmits } from './landing-tv.js';
import { mountXiangqiMahjongWatchReplay } from './watch-xiangqi-mahjong-replay.js';

// Board height over board width, from each renderer's viewBox. 'fills' is the
// compact Xiangqi Mahjong table, which grows its felt to the host's box and
// stands 341px tall when the host follows its content.
const BOARD_RATIO: Record<string, number | 'fills'> = {
  xiangqi: 612 / 552,
  jieqi: 612 / 552,
  'duck-xiangqi': 612 / 552,
  'crazyhouse-xiangqi': 612 / 552,
  banqi: 312 / 568,
  'ffq-banqi': 312 / 568,
  'three-kingdoms-banqi': 330 / 586,
  jungle: 432 / 336,
  'jungle-flip': 1,
  gomoku: 1,
  'xiangqi-mahjong': 'fills',
};
const XMJ_CONTENT_HEIGHT = 341;
const JUNGLE_RATIO = 432 / 336;

const css = readFileSync('src/landing.css', 'utf8');

function px(token: string): number {
  const match = css.match(new RegExp(`${token}:\\s*([\\d.]+)px`));
  if (!match) throw new Error(`no ${token} in landing.css`);
  return Number(match[1]);
}

// The block of rules that applies below the desktop band ('' when absent).
function belowDesktopBlock(): string {
  const start = css.indexOf('@media (max-width: 1240px) {');
  if (start < 0) return '';
  const end = css.indexOf('\n}\n', start);
  return css.slice(start, end);
}

// The slot's reserved board height as a multiple of the base board size, or 0
// when the viewer reserves nothing.
function reservedBoardRatio(): number {
  const match = belowDesktopBlock().match(
    /#landing-replay \{\s*min-height: calc\(\s*var\(--landing-replay-base-size\)\s*\*\s*(\d+)\s*\/\s*(\d+)\s*\+\s*\(var\(--landing-board-caption-line\)\s*\+\s*var\(--landing-board-caption-gap\)\)\s*\*\s*2\s*\);/,
  );
  return match ? Number(match[1]) / Number(match[2]) : 0;
}

// Jungle's board width as a multiple of the base board size (1 when unclamped).
function jungleWidthFactor(): number {
  const match = belowDesktopBlock().match(
    /#landing-replay:has\(\.jungle-live-svg\) \{\s*--showcase-widget-size: calc\(\s*var\(--landing-replay-base-size\)\s*\*\s*(\d+)\s*\/\s*(\d+)\s*\*\s*(\d+)\s*\/\s*(\d+)\s*\);/,
  );
  if (!match) return 1;
  const [, a, b, c, d] = match.map(Number);
  return ((a ?? 1) / (b ?? 1)) * ((c ?? 1) / (d ?? 1));
}

function skeletonRatio(): number {
  const match = css.match(
    /\.landing-board-column #landing-replay \.watch-replay-skeleton \{\s*min-height: calc\(var\(--showcase-widget-size\) \* (\d+) \/ (\d+)\);/,
  );
  if (!match) throw new Error('no skeleton min-height in landing.css');
  return Number(match[1]) / Number(match[2]);
}

describe('homepage viewer slot below the desktop band', () => {
  const seats = (px('--landing-board-caption-line') + px('--landing-board-caption-gap')) * 2;
  const admitted = GAME_SPECS.filter(
    (spec) => spec.runtimeStatus !== 'retired' && homepageTvAdmits(spec.id),
  ).map((spec) => spec.id);

  it('knows the mounted height of every variant the homepage TV can show', () => {
    // A newly admitted variant fails here until its phone height is measured.
    expect([...admitted].sort()).toEqual(Object.keys(BOARD_RATIO).sort());
  });

  // 300 and 358 are 360px and 390px phones, 380 a 412px phone, 534 the cap.
  for (const size of [300, 358, 380, 534]) {
    it(`keeps the loading box and every mounted variant the same height at a ${size}px board`, () => {
      const reserve = size * reservedBoardRatio() + (reservedBoardRatio() > 0 ? seats : 0);
      const loading = Math.max(reserve, size * skeletonRatio());
      for (const specId of admitted) {
        const ratio = BOARD_RATIO[specId];
        const width = specId === 'jungle' ? size * jungleWidthFactor() : size;
        const content =
          ratio === 'fills'
            ? reserve > 0
              ? reserve
              : XMJ_CONTENT_HEIGHT + seats
            : seats + width * (ratio ?? Number.NaN);
        const mounted = Math.max(reserve, content);
        expect({ specId, height: Math.round(mounted * 10) / 10 }).toEqual({
          specId,
          height: Math.round(loading * 10) / 10,
        });
      }
    });
  }

  it('gives jungle the xiangqi board height, as in the desktop band', () => {
    expect(jungleWidthFactor() * JUNGLE_RATIO).toBeCloseTo(612 / 552, 6);
  });

  it('stretches the mahjong layout from its seats-only first frame, so the seats never move', () => {
    // It mounts two seat rows before the match loads; centred in the slot, that
    // strip jumped to the slot's edges when the table arrived (CLS 0.11 on a phone).
    expect(belowDesktopBlock()).toMatch(
      /#landing-replay > \.xmj-watch-layout,\s*\.landing-board-column #landing-replay > \.xmj-watch-layout > \.xmj-watch-board \{\s*flex-grow: 1;/,
    );
  });

  it('leaves the desktop band to its own box model', () => {
    const block = belowDesktopBlock();
    expect(block).not.toBe('');
    expect(block).not.toContain('min-width');
  });

  it('holds the slot in the prerendered shell, which paints before the page adds .landing-page', () => {
    // Scoped under .landing-page, the shell's skeleton painted 440px and the
    // page's own 461px slot then pushed everything below down 21px.
    const block = belowDesktopBlock();
    expect(block).toMatch(/^\s*\.landing-board-column #landing-replay \{\s*min-height:/m);
    expect(block).not.toContain('.landing-page');
  });
});

// A match before its first move, shaped like /api/watch/live.
function openingFrame() {
  const state = createXmjRoomState(
    createXmjSetup(() => 0.5),
    'xmj_tv',
  );
  const view = xmjViewFor(state, 'spectator');
  return {
    game: { result: 'in-progress', termination: 'in-progress', plyCount: 0 },
    state: { status: state.status },
    timeline: [],
    seatDisplayNames: { east: 'Ada', west: 'Bo' },
    view,
    history: { spectator: [{ ply: 0, view }] },
  };
}

describe('compact Xiangqi Mahjong table in a held slot', () => {
  it('fills the host less the seat rows and the gaps between them, so it never overruns', async () => {
    const style = document.createElement('style');
    style.textContent = '.xmj-watch-layout { row-gap: 2px; }';
    document.head.append(style);
    const host = document.createElement('div');
    document.body.append(host);
    const proto = HTMLElement.prototype;
    const saved = {
      offsetHeight: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
      offsetWidth: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
      clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
      clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
    };
    Object.defineProperty(proto, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains('showcase-seat')) return 18;
        if (this.classList.contains('xmj-watch-board')) return 300;
        return 0;
      },
    });
    Object.defineProperty(proto, 'offsetWidth', {
      configurable: true,
      get: () => 380,
    });
    Object.defineProperty(proto, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this === host ? 461 : 0;
      },
    });
    Object.defineProperty(proto, 'clientWidth', {
      configurable: true,
      get: () => 380,
    });
    try {
      const handle = await mountXiangqiMahjongWatchReplay(host, 'xmj_tv', {
        autoplay: false,
        compact: true,
        live: false,
        metadataByRoomId: {},
        loadPostgameOverride: async () => ({ ok: true, postgame: openingFrame() }),
      });
      const table = host.querySelector<HTMLElement>('.xmj-table');
      // 461 host - 2 x 18 seats - 2 x 2 gaps - 1 spare pixel.
      expect(table?.style.minHeight).toBe('420px');
      handle.destroy();
    } finally {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
        else Reflect.deleteProperty(proto, name);
      }
      host.remove();
      style.remove();
    }
  });
});
