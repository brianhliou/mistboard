import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import {
  banqiStateToEngineFen,
  createInitialBanqiState,
  createInitialDuckXiangqiState,
  createInitialFortressXiangqiState,
  createInitialJieqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  createInitialXiangqiState,
  duckXiangqiFen,
  fortressXiangqiEngineFen,
  jieqiStateToPikafishFen,
  jungleFlipStateToEngineFen,
  jungleStateToEngineFen,
  standardXiangqiFen,
} from '@mistboard/game';
import {
  intersectionGeometry,
  POSITION_FEN_MAX_LENGTH,
  POSITION_OG_VARIANTS,
  type PositionOgVariant,
  publicPositionFen,
  renderPositionOgSvg,
  resolvePositionOg,
  servePositionOgImage,
} from './og-position.js';

// Every variant's start position, spelled by the kernel's own writer so the
// fixture cannot drift from the parser it feeds.
const START_FENS: Record<PositionOgVariant, string> = {
  xiangqi: standardXiangqiFen(createInitialXiangqiState('t')),
  'dark-xiangqi': standardXiangqiFen(createInitialXiangqiState('t')),
  jieqi: jieqiStateToPikafishFen(createInitialJieqiState('t')),
  'fortress-xiangqi': fortressXiangqiEngineFen(createInitialFortressXiangqiState('t')),
  banqi: banqiStateToEngineFen(createInitialBanqiState('t')),
  'jungle-flip': jungleFlipStateToEngineFen(createInitialJungleFlipState('t')),
  jungle: jungleStateToEngineFen(createInitialJungleState('t')),
  'dark-chess': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  // The duck starts OFF the board ('-' in the seventh field), so the start
  // position is the one duck FEN that draws no duck.
  'duck-xiangqi': duckXiangqiFen(createInitialDuckXiangqiState('t')),
};

// A duck on the board: Red has played, and the duck sits on e5 (the river
// crossing on the central file), where it screens both cannons.
const DUCK_ON_BOARD = `${START_FENS['duck-xiangqi'].replace(/ -$/, '')} e5`;

// Mid-game public positions of the three hidden-deal variants, plus two deals
// for each (the sixth field) that are permutations of the same pool.
const BANQI_PUBLIC = 'X1X2r1X/2XGX1X1/X1s1XX1X/1XXX2XX r A2E2R1H2C1S3a1e1h1c1 3 12';
const BANQI_DEALS = ['AAEERHHCSSSaehc', 'aehcSSSCHHREEAA'];

const JIEQI_PUBLIC =
  'x1xakxx1x/2n6/1x5x1/x1x3x1x/4p4/2R6/X1X1X1X1X/1X5X1/9/XXX1KXXXX w R1A2C2P5N2B2r2a1c1p4n1b2 0 9';
const JIEQI_DEALS = ['rracppppnbbRAACCPPPPPNNBB', 'bbnppppcarrBBNNPPPPPCCAAR'];

const JUNGLE_FLIP_PUBLIC = 'X1tX/2X1/XlX1/1X1X r R1C1D1W1P1r1e1 2 7';
const JUNGLE_FLIP_DEALS = ['RCDWPre', 'erPWDCR'];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Capture = { status: number | null; headers: Record<string, string>; body: Buffer };

function captureResponse(): ServerResponse & Capture {
  const capture = {
    status: null as number | null,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0) as Buffer,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: Buffer | string) {
      if (chunk) capture.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      return capture;
    },
  };
  return capture as unknown as ServerResponse & Capture;
}

const svgFor = (variant: string, fen: string): string => {
  const resolved = resolvePositionOg(variant, fen);
  assert.ok(resolved, `${variant} did not resolve: ${fen}`);
  return renderPositionOgSvg(resolved);
};

// --- every variant renders its start position to a PNG ------------------------

for (const variant of POSITION_OG_VARIANTS) {
  test(`${variant}: the start position serves as a PNG`, async () => {
    const response = captureResponse();
    await servePositionOgImage({ variant, fen: START_FENS[variant], response });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.ok(response.body.subarray(0, 8).equals(PNG_SIGNATURE), 'body is a PNG');
  });
}

test('a second fetch of the same position is a cache hit', async () => {
  const first = captureResponse();
  await servePositionOgImage({ variant: 'jungle', fen: START_FENS.jungle, response: first });
  const second = captureResponse();
  await servePositionOgImage({ variant: 'jungle', fen: START_FENS.jungle, response: second });
  assert.equal(second.headers['x-og-cache'], 'HIT');
  assert.ok(second.body.equals(first.body));
});

test('renders are rate-limited per client; cache hits and the default card are not', async () => {
  const { createAuthRateLimiter } = await import('./auth-rate-limit.js');
  const limiter = createAuthRateLimiter(2, 60_000);
  // Three distinct positions (distinct cache keys) from one client: the third
  // render is over budget and degrades to the default card.
  const fens = [
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/3K4 w - - 0 1',
    '4k3/8/8/8/8/8/8/2K5 w - - 0 1',
  ];
  const statuses: number[] = [];
  for (const fen of fens) {
    const response = captureResponse();
    await servePositionOgImage({
      variant: 'dark-chess',
      fen,
      response,
      renderKey: 'ip-a',
      limiter,
    });
    statuses.push(response.status ?? 0);
  }
  assert.deepEqual(statuses, [200, 200, 302]);
  // A position already in the cache is still served over budget (no render).
  const hit = captureResponse();
  await servePositionOgImage({
    variant: 'dark-chess',
    fen: fens[0],
    response: hit,
    renderKey: 'ip-a',
    limiter,
  });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers['x-og-cache'], 'HIT');
  // Another client has its own budget.
  const other = captureResponse();
  await servePositionOgImage({
    variant: 'dark-chess',
    fen: fens[2],
    response: other,
    renderKey: 'ip-b',
    limiter,
  });
  assert.equal(other.status, 200);
});

test('the footer names the variant and the side to move', () => {
  assert.match(svgFor('banqi', BANQI_PUBLIC), /Banqi<\/tspan>.*Red to move/);
  assert.match(svgFor('dark-chess', START_FENS['dark-chess']), /Fog Chess<\/tspan>.*White to move/);
  assert.match(svgFor('fortress-xiangqi', START_FENS['fortress-xiangqi']), /Fortress Xiangqi/);
  // Before the first flip no ink is bound, so there is no side to move.
  assert.match(svgFor('banqi', START_FENS.banqi), /First flip/);
});

// --- validation and fallback ----------------------------------------------------

test('an unknown variant, an absent FEN, or a bad FEN falls back to the default card', async () => {
  for (const [variant, fen] of [
    ['chess', START_FENS['dark-chess']],
    ['mini-xiangqi', START_FENS.xiangqi],
    ['xiangqi', null],
    ['xiangqi', ''],
    ['xiangqi', 'nonsense'],
    ['banqi', START_FENS.xiangqi], // right shape for another variant
    ['jieqi', 'X'.repeat(POSITION_FEN_MAX_LENGTH + 1)],
  ] as const) {
    const response = captureResponse();
    await servePositionOgImage({ variant, fen, response });
    assert.equal(response.status, 302, `${variant} ${String(fen).slice(0, 20)}`);
    assert.equal(response.headers.location, '/og-image.png');
    assert.equal(resolvePositionOg(variant, fen), null);
  }
});

test('a FEN at the length cap is still parsed; one over is refused before parsing', () => {
  // Padding goes BETWEEN fields (trim strips the ends; a field split tolerates
  // any run of spaces), so the cap is measured on what the parser would see.
  const padTo = (length: number): string =>
    START_FENS.xiangqi.replace(' r ', ` r${' '.repeat(length - START_FENS.xiangqi.length + 1)}`);
  const atCap = padTo(POSITION_FEN_MAX_LENGTH);
  assert.equal(atCap.length, POSITION_FEN_MAX_LENGTH);
  assert.ok(resolvePositionOg('xiangqi', atCap));
  assert.equal(resolvePositionOg('xiangqi', padTo(POSITION_FEN_MAX_LENGTH + 1)), null);
});

// --- hidden-information invariant ------------------------------------------------

// The card is a public artifact. Two links that differ only in the deal under
// their face-down pieces must produce the same bytes, and a five-field (public)
// link must produce them too: nothing about the sample or the deal may reach
// the SVG.
for (const [variant, publicFen, deals] of [
  ['banqi', BANQI_PUBLIC, BANQI_DEALS],
  ['jieqi', JIEQI_PUBLIC, JIEQI_DEALS],
  ['jungle-flip', JUNGLE_FLIP_PUBLIC, JUNGLE_FLIP_DEALS],
] as const) {
  test(`${variant}: the card is byte-identical across deals and for the public FEN`, () => {
    const fromPublic = svgFor(variant, publicFen);
    for (const deal of deals) {
      assert.equal(svgFor(variant, `${publicFen} ${deal}`), fromPublic, `deal ${deal}`);
    }
    // Sampling is random per parse; two public renders must still agree.
    assert.equal(svgFor(variant, publicFen), fromPublic);
  });

  test(`${variant}: the public FEN strips the deal and is canonical`, () => {
    for (const deal of deals) {
      assert.equal(publicPositionFen(variant, `${publicFen} ${deal}`), publicFen);
    }
    assert.equal(publicPositionFen(variant, publicFen), publicFen);
    assert.equal(publicPositionFen(variant, publicFen)?.split(' ').length, 5);
  });
}

const ALL_GLYPHS = Object.keys(XIANGQI_GLYPH_PATHS);
const glyphsIn = (svg: string): string[] =>
  ALL_GLYPHS.filter((glyph) => svg.includes(`d="${XIANGQI_GLYPH_PATHS[glyph]}"`));

test('banqi: no role glyph and no ink appears for a face-down tile', () => {
  // Every tile is face-down at the start: the SVG carries no glyph path at all.
  const start = svgFor('banqi', START_FENS.banqi);
  assert.deepEqual(glyphsIn(start), []);
  assert.ok(!start.includes('#b91c1c') && !start.includes('#1f2937'), 'no ink colour on the board');
  // Mid-game: exactly the three revealed pieces carry glyphs (red general,
  // black chariot, black soldier); the 15 face-down tiles add none.
  assert.deepEqual(glyphsIn(svgFor('banqi', `${BANQI_PUBLIC} ${BANQI_DEALS[0]}`)).sort(), [
    '卒',
    '帥',
    '車',
  ]);
});

test('jieqi: only the revealed pieces carry glyphs; a dark piece is a bare disc', () => {
  // The start has 30 dark pieces and two generals: two glyphs, both generals.
  assert.deepEqual(glyphsIn(svgFor('jieqi', START_FENS.jieqi)).sort(), ['將', '帥']);
  // Mid-game: generals + the revealed advisor, horse, soldier, and chariot.
  const mid = svgFor('jieqi', `${JIEQI_PUBLIC} ${JIEQI_DEALS[0]}`);
  assert.deepEqual(glyphsIn(mid).sort(), ['俥', '卒', '士', '將', '帥', '馬']);
});

test('jungle-flip: no animal name appears for a face-down tile', () => {
  const names = ['Rat', 'Cat', 'Dog', 'Wolf', 'Leopard', 'Tiger', 'Lion', 'Elephant'];
  const start = svgFor('jungle-flip', START_FENS['jungle-flip']);
  for (const name of names) assert.ok(!start.includes(`>${name}<`), `${name} leaked`);
  const mid = svgFor('jungle-flip', `${JUNGLE_FLIP_PUBLIC} ${JUNGLE_FLIP_DEALS[0]}`);
  const shown = names.filter((name) => mid.includes(`>${name}<`));
  assert.deepEqual(shown.sort(), ['Lion', 'Tiger']);
});

// --- geometry ---------------------------------------------------------------------

// Jieqi's dark discs and Fortress's treasures are drawn by this module on top
// of the shared renderer's board, using a copy of its layout ratios. Pin the
// copy against the renderer: the red general the renderer places must land on
// exactly the point the copy computes for e1.
test('the overlay geometry matches the shared intersection renderer', () => {
  const svg = svgFor('jieqi', START_FENS.jieqi);
  const geom = intersectionGeometry(9, 10, 486);
  const s = geom.pieceSize;
  assert.ok(
    svg.includes(`translate(${geom.px(4) - s / 2} ${geom.py(1) - s / 2}) scale(${s / 100})`),
    'renderer placed the general where the overlay geometry expects',
  );
  // And a dark piece drawn by the overlay sits on its own point (a1).
  assert.ok(
    svg.includes(`translate(${geom.px(0) - s / 2} ${geom.py(1) - s / 2}) scale(${s / 100})`),
  );
});

test("duck-xiangqi: the duck is drawn on its point, in neither seat's ink", () => {
  const DUCK_INK = '#b8860b';
  // Off the board at the start: nothing neutral is drawn.
  const start = svgFor('duck-xiangqi', START_FENS['duck-xiangqi']);
  assert.ok(!start.includes(DUCK_INK), 'no duck before it enters the board');
  const withDuck = svgFor('duck-xiangqi', DUCK_ON_BOARD);
  // On e5, on the same points the shared renderer uses for the pieces.
  const geom = intersectionGeometry(9, 10, 486);
  const s = geom.pieceSize;
  assert.ok(
    withDuck.includes(`translate(${geom.px(4) - s / 2} ${geom.py(5) - s / 2}) scale(${s / 100})`),
    'the duck sits on e5',
  );
  assert.ok(withDuck.includes(`fill="${DUCK_INK}">DUCK</text>`), 'marked, in the neutral ink');
  // Neither seat's ink is ever used for it: the duck disc carries no red or
  // black stroke of its own. Both colours are on the board (32 pieces), so the
  // check is that the duck's own group is free of them.
  const group = withDuck.slice(withDuck.indexOf(`${geom.py(5) - s / 2}) scale(`));
  const duckGroup = group.slice(0, group.indexOf('</g>'));
  assert.ok(!duckGroup.includes('#b91c1c') && !duckGroup.includes('#1f2937'), 'no seat ink');
  // And the seventh field survives the round trip, so the card's cache key and
  // the og:image URL describe the position the duck is actually in.
  assert.equal(publicPositionFen('duck-xiangqi', DUCK_ON_BOARD), DUCK_ON_BOARD);
  assert.notEqual(
    svgFor('duck-xiangqi', DUCK_ON_BOARD),
    svgFor('duck-xiangqi', START_FENS['duck-xiangqi']),
  );
});

test('fortress draws its treasures', () => {
  const svg = svgFor('fortress-xiangqi', START_FENS['fortress-xiangqi']);
  assert.ok(glyphsIn(svg).includes('寶'));
});
