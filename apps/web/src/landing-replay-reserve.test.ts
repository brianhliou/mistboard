// The homepage viewer's slot below the desktop band. The seats sit in flow there,
// so a mounted viewer is two seat rows plus a board whose height depends on the
// variant, and the loading skeleton cannot know which game the TV will open on.
//
// Decided 2026-11-26: phone space is too valuable for a reserve. No variant may
// sit in blank space or shrink to fit a box held for a taller one, so the slot
// holds nothing once a board mounts and every board keeps its own size. The
// skeleton alone takes the box of the site's main game (the xiangqi family), so
// that board lands without moving the page.
//
// happy-dom does no layout, so this reads the rules out of landing.css and
// checks them against each admitted variant's mounted height, measured in a
// phone browser on 2026-11-26 (board height for a board S wide).
import { readFileSync } from 'node:fs';
import { createXmjRoomState, createXmjSetup, GAME_SPECS, xmjViewFor } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { homepageTvAdmits } from './landing-tv.js';
import { mountXiangqiMahjongWatchReplay } from './watch-xiangqi-mahjong-replay.js';

// Board height over board width, from each renderer's viewBox. 'content' is the
// compact Xiangqi Mahjong table, whose height follows its own content (337px
// for a 358px board on a 390px phone).
const BOARD_RATIO: Record<string, number | 'content'> = {
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
  'xiangqi-mahjong': 'content',
};
const XIANGQI_RATIO = 612 / 552;

const css = readFileSync('src/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { selector: string; body: string; media: string[] };

// Every style rule in landing.css with the at-rules around it.
function parseRules(source: string): Rule[] {
  const found: Rule[] = [];
  const stack: Array<{ prelude: string; start: number }> = [];
  let preludeStart = 0;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '{') {
      stack.push({ prelude: source.slice(preludeStart, at).trim(), start: at + 1 });
      preludeStart = at + 1;
    } else if (char === '}') {
      const open = stack.pop();
      if (open && !open.prelude.startsWith('@')) {
        found.push({
          selector: open.prelude.replace(/\s+/g, ' '),
          body: source.slice(open.start, at).replace(/\s+/g, ' '),
          media: stack.map((outer) => outer.prelude.replace(/\s+/g, ' ')),
        });
      }
      preludeStart = at + 1;
    } else if (char === ';') {
      preludeStart = at + 1;
    }
  }
  return found;
}

const rules = parseRules(css);
const BELOW_DESKTOP = '@media (max-width: 1240px)';
const DESKTOP = '@media (min-width: 1241px)';

// A selector whose subject is the viewer slot itself (not something inside it).
function targetsSlot(selector: string): boolean {
  return selector
    .split(',')
    .some((part) => /#landing-replay(?::[\w-]+(?:\([^)]*\))?)*\s*$/.test(part.trim()));
}

function px(token: string): number {
  const match = css.match(new RegExp(`${token}:\\s*([\\d.]+)px`));
  if (!match) throw new Error(`no ${token} in landing.css`);
  return Number(match[1]);
}

// The phone skeleton's height as board-size ratio and fixed rows, or null.
function phoneSkeleton(): { ratio: number; seatRows: number } | null {
  const rule = rules.find(
    (candidate) =>
      candidate.selector === '.landing-board-column #landing-replay .watch-replay-skeleton' &&
      candidate.media.includes(BELOW_DESKTOP),
  );
  const match = rule?.body.match(
    /min-height: calc\( var\(--showcase-widget-size\) \* (\d+) \/ (\d+) \+ \(var\(--landing-board-caption-line\) \+ var\(--landing-board-caption-gap\)\) \* (\d+) \);/,
  );
  if (!match) return null;
  return { ratio: Number(match[1]) / Number(match[2]), seatRows: Number(match[3]) };
}

describe('homepage viewer slot below the desktop band', () => {
  const seat = px('--landing-board-caption-line') + px('--landing-board-caption-gap');
  const admitted = GAME_SPECS.filter(
    (spec) => spec.runtimeStatus !== 'retired' && homepageTvAdmits(spec.id),
  ).map((spec) => spec.id);

  it('knows the board shape of every variant the homepage TV can show', () => {
    // A newly admitted variant fails here until its phone height is measured.
    expect([...admitted].sort()).toEqual(Object.keys(BOARD_RATIO).sort());
  });

  it('holds no minimum height on the slot, so no mounted board sits in blank space', () => {
    // A reserve sized for the tallest board left a banqi strip 106px of blank
    // space above and below it on a phone.
    const holding = rules.filter(
      (rule) => targetsSlot(rule.selector) && /(^|[\s;])min-height:/.test(rule.body),
    );
    expect(holding.map((rule) => rule.selector)).toEqual([]);
  });

  it('keeps jungle at full width on a phone', () => {
    // The desktop band gives jungle the xiangqi board's height; below it, the
    // same clamp made the phone board 14% narrower to fit a reserved slot.
    const clamps = rules.filter(
      (rule) =>
        rule.selector.includes('#landing-replay:has(.jungle-live-svg)') &&
        rule.body.includes('--showcase-widget-size'),
    );
    expect(clamps.length).toBeGreaterThan(0);
    for (const rule of clamps) expect(rule.media).toEqual([DESKTOP]);
  });

  // 300 and 358 are 360px and 390px phones, 380 a 412px phone, 534 the cap.
  for (const size of [300, 358, 380, 534]) {
    it(`sizes the loading box to a mounted xiangqi-family board at a ${size}px board`, () => {
      const skeleton = phoneSkeleton();
      expect(skeleton).not.toBeNull();
      const loading = size * (skeleton?.ratio ?? 0) + seat * (skeleton?.seatRows ?? 0);
      for (const specId of admitted) {
        if (BOARD_RATIO[specId] !== XIANGQI_RATIO) continue;
        expect({ specId, height: Math.round(loading * 10) / 10 }).toEqual({
          specId,
          height: Math.round((size * XIANGQI_RATIO + seat * 2) * 10) / 10,
        });
      }
    });
  }

  it('styles the prerendered shell as the page does, before the script adds .landing-page', () => {
    // The shell kept the panel's 8px padding and 1px border, so the slot was
    // 18px taller until the page script added .landing-page and zeroed them.
    const frameless = rules.find(
      (rule) =>
        rule.selector === '.landing-board-column #landing-replay' &&
        rule.media.length === 0 &&
        /padding: 0;/.test(rule.body) &&
        /border: none;/.test(rule.body),
    );
    expect(frameless).toBeDefined();
    const skeletonRules = rules.filter((rule) =>
      rule.selector.endsWith('#landing-replay .watch-replay-skeleton'),
    );
    expect(skeletonRules.length).toBeGreaterThan(0);
    for (const rule of skeletonRules) expect(rule.selector).not.toContain('.landing-page');
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

describe('compact Xiangqi Mahjong table', () => {
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
