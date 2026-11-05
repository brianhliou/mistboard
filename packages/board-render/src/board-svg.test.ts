import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBoardSvg } from './board-svg.js';
import { renderBoardComposition } from './composition.js';

const fogEdges = (svg: string) => svg.match(/<(?:rect|path)[^>]*fill="none"[^>]*\/>/g) ?? [];

test('a fog line in a rounded corner follows the curve, not the square', () => {
  const svg = renderBoardSvg([], ['a8', 'h1', 'd4'], 0, 0, 800, 'white', {
    clipId: 'c',
    cornerRadius: 20,
  });
  const [a8, h1, d4] = fogEdges(svg);
  assert.match(a8!, /A19\.5 19\.5 0 0 1 20 0\.5Z/);
  assert.match(h1!, /A19\.5 19\.5 0 0 1 780 799\.5/);
  assert.match(d4!, /^<rect/, 'an inner square keeps its square line');
});

test('a fog line stays square where the board has no rounded corner', () => {
  const unclipped = renderBoardSvg([], ['a8'], 0, 0, 800, 'white');
  assert.match(fogEdges(unclipped)[0]!, /^<rect/);
  const square = renderBoardSvg([], ['a8'], 0, 0, 800, 'white', { clipId: 'c', cornerRadius: 0 });
  assert.match(fogEdges(square)[0]!, /^<rect/);
});

test('the composition passes a corner radius through to the board clip', () => {
  const render = (cornerRadius?: number) =>
    renderBoardComposition({
      layout: 'single',
      canvasWidth: 800,
      boardY: 0,
      boardSize: 800,
      boards: [{ pieces: [] }],
      ...(cornerRadius === undefined ? {} : { cornerRadius }),
    });
  assert.match(render(), /<clipPath[^>]*><rect[^>]*rx="15\.2"/);
  assert.match(render(0), /<clipPath[^>]*><rect[^>]*rx="0"/);
});
