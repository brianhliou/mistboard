import { beforeEach, expect, test } from 'vitest';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';

// 1.C2.5 H8+7 2.H2+3 P7+1 — four real plies, enough to judge one of them.
const ICCS = 'h2e2 h9g7 h0g2 g6g5';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const base: XiangqiReplaySpec = {
  iccs: ICCS,
  red: 'Red',
  black: 'Black',
  event: 'Test',
  resultText: '1-0',
};

const mainButtons = (el: HTMLElement) => [
  ...el.querySelectorAll('.xq-replay-row .xq-replay-move-button'),
];
const branchButtons = (el: HTMLElement) => [
  ...el.querySelectorAll('.xq-replay-branch .xq-replay-move-button'),
];

let el: HTMLElement;
beforeEach(() => {
  el = host();
});

// The annotated surface is additive. An existing article passing no
// annotations must render exactly the stepper it always did.
test('a spec without annotations attaches no study nodes', () => {
  const c = mountXiangqiReplay(el, base);
  expect(el.classList.contains('xq-replay-annotated')).toBe(false);
  expect(el.querySelector('.xq-replay-grid')).toBeNull();
  expect(el.querySelector('.xq-replay-moves')).toBeNull();
  c.destroy();
});

test('annotations lay the board and the move tree out in two columns', () => {
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  const grid = el.querySelector('.xq-replay-grid');
  expect(grid).not.toBeNull();
  expect(grid?.querySelector('.xq-replay-board-col .raw-svg-stepper-frame-xq')).not.toBeNull();
  expect(grid?.querySelector('.xq-replay-move-col .xq-replay-moves')).not.toBeNull();
  // Every mainline ply is listed, in the reader's notation setting. With
  // nothing stored that is algebraic; the notation test below covers the rest.
  expect(mainButtons(el)).toHaveLength(4);
  expect(mainButtons(el)[0]?.textContent).toContain('Che3');
  c.destroy();
});

test('a judged move carries its glyph and draws the engine line inline beneath it', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: { byPly: { 3: { glyph: '??', cp: -420, line: 'b0c2 c9e7' } } },
  });
  const glyphs = [...el.querySelectorAll('.xq-replay-glyph')].map((n) => n.textContent);
  expect(glyphs).toEqual(['??']);
  expect(el.querySelector('.xq-replay-glyph')?.className).toContain('blunder');

  // The variation is a branch in the tree, not a separate panel, and it is
  // visible without being opened first.
  const branch = el.querySelector('.xq-replay-branch');
  expect(branch).not.toBeNull();
  expect(branchButtons(el)).toHaveLength(2);
  expect(mainButtons(el)).toHaveLength(4);
  c.destroy();
});

test('clicking into the line steps the board, and arrows walk the line not the game', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: { byPly: { 3: { glyph: '?', cp: -180, line: 'b0c2 c9e7 a0b0' } } },
  });
  (branchButtons(el)[0] as HTMLButtonElement).click();
  expect(branchButtons(el)[0]?.className).toContain('is-current');

  (el.querySelector('.stepper-button-next') as HTMLButtonElement).click();
  expect(branchButtons(el)[1]?.className).toContain('is-current');

  // The "Back to the game" button is gone with the annotation card, so both
  // remaining exits have to work or a reader can get stuck in a sideline.
  // 1. Stepping back past the head of the line drops out of it.
  (el.querySelector('.stepper-button-prev') as HTMLButtonElement).click();
  (el.querySelector('.stepper-button-prev') as HTMLButtonElement).click();
  expect(el.querySelector('.xq-replay-branch .is-current')).toBeNull();

  // 2. Clicking any mainline move leaves the line and goes there.
  (branchButtons(el)[0] as HTMLButtonElement).click();
  expect(branchButtons(el)[0]?.className).toContain('is-current');
  (mainButtons(el)[1] as HTMLButtonElement).click();
  expect(el.querySelector('.xq-replay-branch .is-current')).toBeNull();
  expect(mainButtons(el)[1]?.className).toContain('is-current');
  c.destroy();
});

// The exit above clicks a DIFFERENT mainline move than the one the line belongs
// to, which is the one case that always worked: the repaint was gated on the
// mainline cursor moving. Opening a line leaves that cursor on the owning move,
// so clicking it did nothing and a reader deep in a sideline was stuck.
test('clicking the move the line hangs off returns to the game', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: { byPly: { 3: { glyph: '??', cp: -420, line: 'b0c2 c9e7 a0b0' } } },
  });
  // The flow that breaks: step onto the judged move first (which is how a
  // reader notices the ?? at all), then walk into the line beneath it.
  (mainButtons(el)[2] as HTMLButtonElement).click();
  (branchButtons(el)[0] as HTMLButtonElement).click();
  (el.querySelector('.stepper-button-next') as HTMLButtonElement).click();
  (el.querySelector('.stepper-button-next') as HTMLButtonElement).click();
  expect(branchButtons(el)[2]?.className).toContain('is-current');

  // Ply 3 is both the current mainline ply and the move the branch belongs to.
  (mainButtons(el)[2] as HTMLButtonElement).click();
  expect(el.querySelector('.xq-replay-branch .is-current')).toBeNull();
  expect(mainButtons(el)[2]?.className).toContain('is-current');
  c.destroy();
});

// A line that does not replay legally (a stale annotation against a corrected
// record) must truncate rather than throw or notate a move that cannot be made.
test('an illegal continuation truncates the branch', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: { byPly: { 3: { glyph: '?!', cp: 0, line: 'b0c2 a0a9 a0b0' } } },
  });
  // Only the legal first move survives; the rest of the line is dropped.
  expect(branchButtons(el)).toHaveLength(1);
  expect(el.querySelector('.raw-svg-stepper-frame-xq')?.innerHTML).toContain('<svg');
  c.destroy();
});

test('move labels follow the notation preference and relabel when it changes', () => {
  // The widget hardcoded WXF, so an article embed ignored the setting every
  // other xiangqi surface on the site obeys.
  // This environment has no localStorage; the preference reader swallows that
  // and falls back to the default, which would make the assertions below pass
  // for the wrong reason.
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  const setNotation = (value: string) => {
    store.set('mistboard.xiangqiNotation', value);
    store.set('mistboard.xiangqiNotationVersion', '2');
  };
  // Nothing stored: the locale default, chess-style algebraic outside zh.
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  expect(mainButtons(el)[0]?.textContent).toContain('Che3');

  setNotation('wxf');
  window.dispatchEvent(new CustomEvent('mistboard:xiangqi-notation-changed'));
  expect(mainButtons(el)[0]?.textContent).toContain('C2.5');

  setNotation('chinese');
  window.dispatchEvent(new CustomEvent('mistboard:xiangqi-notation-changed'));
  expect(mainButtons(el)[0]?.textContent).toContain('炮二平五');

  // ICCS and coordinates left the gear; a stored choice of either reads as
  // unset and the default comes back.
  setNotation('iccs');
  window.dispatchEvent(new CustomEvent('mistboard:xiangqi-notation-changed'));
  expect(mainButtons(el)[0]?.textContent).toContain('Che3');

  c.destroy();
  if (original) Object.defineProperty(window, 'localStorage', original);
  else Reflect.deleteProperty(window, 'localStorage');
});

test('the study layout drops the scrubber and the ply counter', () => {
  // The move list is the position indicator and it is clickable, so a slider
  // and a "12 / 156" readout were a second, worse copy of it.
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  expect(el.querySelector('.xq-replay-slider')).toBeNull();
  expect(el.querySelector('.stepper-counter')).toBeNull();
  c.destroy();

  // The plain stepper keeps both.
  const plain = mountXiangqiReplay(el, base);
  expect(el.querySelector('.xq-replay-slider')).not.toBeNull();
  expect(el.querySelector('.stepper-counter')).not.toBeNull();
  plain.destroy();
});

test('a judged move carries its cost on the move, not in a card below', () => {
  // There used to be a card under the list restating the glyph, pointing at a
  // line already drawn beside it, and shifting the list as the reader stepped.
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: {
      byPly: {
        1: {
          glyph: '?',
          note: 'mistake: 12.6 win% given up, eval +0.10 after. The engine wanted the line in the sibling branch.',
          line: 'h0g2 h9g7',
        },
      },
    },
  });
  expect(el.querySelector('.xq-replay-line')).toBeNull();

  const title = mainButtons(el)[0]?.getAttribute('title') ?? '';
  expect(title).toContain('Mistake');
  expect(title).toContain('12.6% win chance given up');
  expect(title).toContain('eval +0.10');
  expect(title).not.toContain('sibling branch');

  // The sideline says what it is rather than where it came from.
  expect(el.querySelector('.xq-replay-branch-tag')?.textContent).toBe('better was');
  c.destroy();
});

test('prose we did not generate reaches the reader intact', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: {
      byPly: { 1: { glyph: '!!', note: 'Brilliant: the cannon cannot be taken.' } },
    },
  });
  expect(mainButtons(el)[0]?.getAttribute('title')).toContain('the cannon cannot be taken');
  c.destroy();
});

test('the control bar gives its four buttons equal width and identical icons', () => {
  // Both halves of a real regression: the grid kept a five-column template from
  // when a ply counter sat in the middle, so the next button landed in the
  // `auto` column and rendered 13px wide against its 92px neighbours; and the
  // labels were text glyphs (U+23EE/U+23ED vs U+2190/U+2192) that resolve from
  // different fallback fonts and never match in weight or optical size.
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  const controls = el.querySelector('.stepper-controls');
  const buttons = [...el.querySelectorAll('.stepper-button')];

  // Three since jump-to-start and jump-to-end moved into the menu.
  expect(buttons).toHaveLength(3);
  expect(controls?.children).toHaveLength(3);
  for (const button of buttons) {
    expect(button.textContent?.trim()).toBe('');
    const icon = button.querySelector('svg.stepper-icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // The icon is decoration; the button carries the name.
    expect(button.getAttribute('aria-label')).toBeTruthy();
  }
  c.destroy();
});

test('arrow keys keep working after clicking a move in the list', () => {
  // The list is rebuilt on every render, so the clicked button is detached
  // mid-render and focus falls to <body>. The arrow handler is on the widget,
  // so the keyboard silently stopped working until the reader clicked one of
  // the stepper controls, which are stable elements and keep focus.
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  const label = () =>
    el.querySelector('.xq-replay-move-button.is-current')?.textContent?.trim() ?? '';

  (mainButtons(el)[1] as HTMLButtonElement | undefined)?.click();
  expect(label()).toBe(mainButtons(el)[1]?.textContent?.trim());

  // Focus must still be inside the widget for the handler to receive the key.
  expect(el.contains(document.activeElement)).toBe(true);

  const after = label();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(label()).not.toBe(after);

  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(label()).toBe(after);
  c.destroy();
});

test('the study bar is back / menu / forward, and the menu keeps what it replaced', () => {
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  const labels = [...el.querySelectorAll('.stepper-button')].map((b) =>
    b.getAttribute('aria-label'),
  );
  expect(labels).toEqual(['Previous move', 'More', 'Next move']);

  // Jump-to-start and jump-to-end left the bar, so they have to be in the menu.
  const items = () => [...el.querySelectorAll('.xq-replay-menu-item')].map((i) => i.textContent);
  expect(items()).toEqual(['Flip the board', 'Back to the start', 'Jump to the end']);
  c.destroy();
});

test('flipping rebuilds the column in order instead of shuffling nodes past each other', () => {
  // Swapping the two seat bars around each other left the control bar above the
  // board, so the flip re-orders the whole column explicitly.
  const c = mountXiangqiReplay(el, { ...base, annotations: { byPly: {} } });
  const order = () =>
    [...(el.querySelector('.xq-replay-board-col')?.children ?? [])].map(
      (child) => child.className.split(' ')[0],
    );
  const seats = () => [...el.querySelectorAll('.xq-replay-seat')].map((s) => s.textContent?.trim());

  const startOrder = order();
  const startSeats = seats();
  const flip = () => {
    (el.querySelector('.stepper-button-menu') as HTMLButtonElement).click();
    const item = [...el.querySelectorAll('.xq-replay-menu-item')].find((i) =>
      /Flip/.test(i.textContent ?? ''),
    ) as HTMLButtonElement | undefined;
    item?.click();
  };

  flip();
  expect(order()).toEqual(startOrder);
  expect(seats()).toEqual([...startSeats].reverse());

  flip();
  expect(order()).toEqual(startOrder);
  expect(seats()).toEqual(startSeats);
  c.destroy();
});

test('a judged move is badged on the board, and only on the mainline', () => {
  const c = mountXiangqiReplay(el, {
    ...base,
    annotations: { byPly: { 1: { glyph: '?!', line: 'h0g2 h9g7' } } },
  });
  expect(el.querySelector('.xq-marker--glyph')).toBeNull(); // ply 0, nothing played

  (mainButtons(el)[0] as HTMLButtonElement | undefined)?.click();
  const badge = el.querySelector('.xq-marker--glyph');
  expect(badge?.getAttribute('class')).toContain('xq-marker--inaccuracy');
  expect(badge?.querySelector('text')?.textContent).toBe('?!');

  // A position inside an engine line is not a move anyone played.
  (branchButtons(el)[0] as HTMLButtonElement).click();
  expect(el.querySelector('.xq-marker--glyph')).toBeNull();
  c.destroy();
});

test('nothing drawn for an edge-rank move escapes the board viewBox', () => {
  // The margin was once sized to clear the piece alone, which cropped the
  // last-move ring on every edge move and cut the top off a badge on any piece
  // reaching the back rank. A corner move exercises both axes at once.
  const c = mountXiangqiReplay(el, {
    ...base,
    // a1-a10: Red's chariot up the edge file to Black's back rank.
    iccs: 'a0a4 h9g7 a4a9',
    annotations: { byPly: { 3: { glyph: '?!' } } },
  });
  const buttons = mainButtons(el);
  (buttons[buttons.length - 1] as HTMLButtonElement | undefined)?.click();

  const svg = el.querySelector('svg');
  const [, , vw, vh] = (svg?.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  // The board content sits inside a <g transform="translate(PAD PAD)">, so the
  // circle coordinates below are already in the same space as the viewBox.
  const circles = [...el.querySelectorAll('circle')];
  expect(circles.length).toBeGreaterThan(0);
  for (const circle of circles) {
    const cx = Number(circle.getAttribute('cx'));
    const cy = Number(circle.getAttribute('cy'));
    const r = Number(circle.getAttribute('r'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) continue;
    const label = circle.getAttribute('class') ?? 'circle';
    expect(cx - r, `${label} crosses the left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(cy - r, `${label} crosses the top edge`).toBeGreaterThanOrEqual(-0.5);
    expect(cx + r, `${label} crosses the right edge`).toBeLessThanOrEqual(vw + 0.5);
    expect(cy + r, `${label} crosses the bottom edge`).toBeLessThanOrEqual(vh + 0.5);
  }
  c.destroy();
});

// Clicking to the end of a game disables the "next" control, and a browser hands
// focus back to the document when the focused element is disabled. The arrow keys
// are bound to the widget host, so they went dead at exactly the moment a reader
// arrives at the last move and wants to step back through it.
//
// jsdom does NOT blur on disable, so these cannot reproduce the browser's part of
// it. What they pin is the fix's observable effect: when a control the reader was
// on becomes disabled, focus lands on the host, which is the element listening for
// the arrow keys. Without the handoff, focus stays on the dead button.
test('hands focus to the host when stepping onto the last move disables next', () => {
  mountXiangqiReplay(el, { ...base });
  const next = el.querySelector<HTMLButtonElement>('.stepper-button-next');
  expect(next, 'no next control').toBeTruthy();

  for (let i = 0; i < 4; i += 1) {
    next?.focus();
    next?.click();
  }
  expect(next?.disabled, 'next should be spent at the last move').toBe(true);
  expect(document.activeElement, 'focus was left on the dead button').toBe(el);

  // And the key the reader reaches for next still moves the game.
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(next?.disabled, 'ArrowLeft did not step back off the last move').toBe(false);
});

test('does the same at ply zero, where prev is the control that disables', () => {
  mountXiangqiReplay(el, { ...base });
  const next = el.querySelector<HTMLButtonElement>('.stepper-button-next');
  const prev = el.querySelector<HTMLButtonElement>('.stepper-button-prev');
  next?.focus();
  next?.click();
  prev?.focus();
  prev?.click();
  expect(prev?.disabled, 'prev should be spent at the start').toBe(true);
  expect(document.activeElement, 'focus was left on the dead button').toBe(el);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(prev?.disabled, 'ArrowRight did not step forward off ply zero').toBe(false);
});

test('leaves focus alone while the control the reader is on stays alive', () => {
  mountXiangqiReplay(el, { ...base });
  const next = el.querySelector<HTMLButtonElement>('.stepper-button-next');
  const prev = el.querySelector<HTMLButtonElement>('.stepper-button-prev');
  next?.click();
  next?.click();
  // Mid-game: prev is live and stays live, so stepping must not yank focus off it.
  prev?.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(prev?.disabled, 'prev should still be live mid-game').toBe(false);
  expect(document.activeElement, 'focus moved when it did not have to').toBe(prev);
});
