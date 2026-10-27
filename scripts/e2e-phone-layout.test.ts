import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Window } from 'happy-dom';

import { phoneLayoutProblems } from '../tests/e2e/phone-layout.js';

// Geometry and hit testing are supplied explicitly: happy-dom does not lay out
// a page. The browser journey runs this same probe against real phone pixels.
const targets = { board: '#board', controls: ['#previous', '#next'] };
let window: Window;
let hit: Element | null;

function rect(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;
}

beforeEach(() => {
  window = new Window();
  Object.assign(globalThis, {
    document: window.document,
    innerWidth: 390,
    innerHeight: 844,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  window.document.body.innerHTML = `
    <div id="board"></div>
    <button id="previous" disabled><span>上一步</span></button>
    <button id="next">下一步</button>`;
  Object.defineProperty(document.documentElement, 'scrollWidth', {
    value: 390,
    configurable: true,
  });
  rect(document.querySelector('#board')!, 0, 60, 390, 440);
  rect(document.querySelector('#previous')!, 0, 500, 48, 44);
  rect(document.querySelector('#next')!, 48, 500, 48, 44);
  hit = null;
  document.elementFromPoint = (x) =>
    hit ?? document.querySelector(x < 48 ? '#previous span' : '#next');
});

afterEach(async () => {
  await window.happyDOM.close();
});

test('phone probe accepts a fitting board and visible controls, including a disabled arrow', () => {
  assert.deepEqual(phoneLayoutProblems(targets), []);
});

test('phone probe rejects sideways page scroll', () => {
  Object.defineProperty(document.documentElement, 'scrollWidth', { value: 420 });
  assert.match(phoneLayoutProblems(targets).join('\n'), /horizontal overflow/);
});

test('phone probe catches a clipped board even when the page has no scroll overflow', () => {
  rect(document.querySelector('#board')!, -20, 60, 390, 440);
  assert.match(phoneLayoutProblems(targets).join('\n'), /#board.*outside viewport/);
});

test('phone probe requires every named control', () => {
  document.querySelector('#next')!.remove();
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*missing/);
});

test('phone probe rejects a hidden control', () => {
  document.querySelector<HTMLElement>('#next')!.style.visibility = 'hidden';
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*hidden/);
});

test('phone probe rejects controls hidden by a transparent parent', () => {
  // Transparent elements still receive pointer events, so center hit testing
  // alone would report this invisible toolbar as usable.
  const toolbar = document.createElement('div');
  toolbar.style.opacity = '0';
  document.body.append(toolbar);
  toolbar.append(document.querySelector('#next')!);
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*hidden/);
});

test('phone probe rejects controls below the fold without scrolling them into view', () => {
  rect(document.querySelector('#next')!, 48, 830, 48, 44);
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*outside viewport/);
});

test('phone probe rejects a zero-size control', () => {
  rect(document.querySelector('#next')!, 48, 500, 0, 0);
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*hidden/);
});

test('phone probe catches a floating widget covering a control', () => {
  hit = document.querySelector('#board');
  assert.match(phoneLayoutProblems(targets).join('\n'), /#next.*covered/);
});

test('phone probe reports a missing board rather than silently passing', () => {
  document.querySelector('#board')!.remove();
  assert.match(phoneLayoutProblems(targets).join('\n'), /#board.*missing/);
});
