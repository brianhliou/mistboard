import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ARTICLE_META } from './article-meta.js';
import { fitStudyTitleLines, studyChapterOgPieces } from './og-image.js';

// Golden Roc composition 1 ("The horse leaps Tan Creek"), taken from the live
// study. A 排局 IS its diagram, so the card has to key off the chapter's own
// hand-set position rather than the variant's start.
const COMPOSITION_FEN = '3ak4/4a4/b3b3P/9/4N2R1/9/2p6/1p1AB4/3KA4/n3r1B2 r - - 0 1';

test('a composition chapter renders its own hand-set position', () => {
  const pieces = studyChapterOgPieces({
    version: 1,
    root: { children: [] },
    rootFen: COMPOSITION_FEN,
  });
  assert.ok(pieces);
  assert.equal(pieces.length, 17);
  // The red soldier on i8 is the piece the composition turns on; if the rank or
  // file mapping ever flips, this moves.
  assert.ok(
    pieces.some((p) => p.color === 'red' && p.role === 'soldier' && p.file === 8 && p.rank === 8),
  );
  assert.ok(pieces.some((p) => p.color === 'black' && p.role === 'general'));
});

test('a chapter with no rootFen renders the standard start', () => {
  const pieces = studyChapterOgPieces({ version: 1, root: { children: [] } });
  assert.ok(pieces);
  assert.equal(pieces.length, 32);
});

// Falling back to the default card is the only safe answer: rendering the
// standard start for a composition would publish a board that is not the one
// the study actually holds.
test('an unparseable rootFen falls back rather than rendering a wrong board', () => {
  assert.equal(
    studyChapterOgPieces({ version: 1, root: { children: [] }, rootFen: 'nonsense' }),
    null,
  );
  assert.equal(studyChapterOgPieces({ version: 1, root: { children: [] }, rootFen: '' }), null);
});

test('a malformed tree blob still yields the standard start rather than throwing', () => {
  for (const root of [null, undefined, 'x', {}, { rootFen: 42 }]) {
    assert.equal(studyChapterOgPieces(root)?.length, 32);
  }
});

// Mirrors the route in server-http.ts. Both forms have to resolve, and a deeper
// path must NOT match (it would silently render the wrong chapter).
const STUDY_OG_ROUTE = /^\/og\/study\/([^/]+?)(?:\/([^/]+?))?\.png$/;

test('the og route resolves study and chapter forms', () => {
  const study = STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE.png');
  assert.deepEqual([study?.[1], study?.[2]], ['Dfi3NpRE', undefined]);

  const chapter = STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE/Xzlg0GwU.png');
  assert.deepEqual([chapter?.[1], chapter?.[2]], ['Dfi3NpRE', 'Xzlg0GwU']);

  assert.equal(STUDY_OG_ROUTE.exec('/og/study/a/b/c.png'), null);
  assert.equal(STUDY_OG_ROUTE.exec('/og/study/.png'), null);
  assert.equal(STUDY_OG_ROUTE.exec('/og/study/Dfi3NpRE'), null);
});

// --- card titles ---------------------------------------------------------------

// Composition titles are sentences. 50 of the 52 published chapter titles exceed
// the 24-char cap the game card applies to player names, so the study card wrapped
// instead of inheriting a limit tuned for a different layout.
test('a short title stays on one line', () => {
  assert.deepEqual(fitStudyTitleLines('1. The horse leaps Tan Creek'), [
    '1. The horse leaps Tan Creek',
  ]);
});

test('the longest published title wraps whole, at a word boundary', () => {
  const lines = fitStudyTitleLines(
    'Small opposing cannons give up the elephant to trap the chariot',
  );
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), 'Small opposing cannons give up the elephant to trap the chariot');
  assert.ok(!lines[0]!.endsWith(' '));
});

// CJK has no spaces, so word-boundary wrapping would return one unbreakable
// token and overflow the card.
test('a CJK title wraps per character and counts double width', () => {
  assert.deepEqual(fitStudyTitleLines('雙車難破馬砲士象全'), ['雙車難破馬砲士象全']);
  const long = fitStudyTitleLines('橘中秘卷三車卒殘局第十七局又局兌車和單車肘心變着詳解補遺');
  assert.equal(long.length, 2);
  assert.ok(long[0]!.length <= 23, 'a wide-script line holds at most half the half-widths');
});

test('a title too long for both lines is ellipsized rather than overrunning', () => {
  const lines = fitStudyTitleLines('x'.repeat(200));
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.endsWith('…'));
});

test('an empty or whitespace title degrades to one empty line', () => {
  assert.deepEqual(fitStudyTitleLines(''), ['']);
  assert.deepEqual(fitStudyTitleLines('   '), ['']);
});

// ── Aspect cards (the Article JSON-LD's 16:9, 4:3 and 1:1 images) ─────────────

const WEB_PUBLIC = new URL('../../web/public', import.meta.url).pathname;

type RouteCapture = { status: number; headers: Record<string, string>; body: Buffer };

/** Drives the real HTTP handler for one GET and resolves when it ends; the og
 *  routes return before touching any of the handler's game options. */
async function getRoute(path: string, staticDir = WEB_PUBLIC): Promise<RouteCapture> {
  const { createHttpRequestHandler } = await import('./server-http.js');
  const handler = createHttpRequestHandler({
    staticDir,
    publicHost: 'https://mistboard.test',
  } as unknown as Parameters<typeof createHttpRequestHandler>[0]);
  return new Promise((resolveCapture) => {
    const capture: RouteCapture = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const response = {
      headersSent: false,
      setHeader() {},
      writeHead(status: number, headers?: Record<string, string>) {
        capture.status = status;
        capture.headers = headers ?? {};
        response.headersSent = true;
      },
      end(chunk?: Buffer | string) {
        if (chunk) capture.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        resolveCapture(capture);
      },
    };
    handler({ url: path, method: 'GET', headers: {} } as never, response as never);
  });
}

// A feed SVG with 24-unit strips at either edge: at 2.5x, the wide card
// must remove exactly those 60 pixels above and below the centre artwork.
const THUMB_ART =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#00aacc"/><rect width="480" height="24" fill="#ff0000"/><rect y="276" width="480" height="24" fill="#ff0000"/><circle cx="240" cy="150" r="60" fill="#ffffff"/></svg>';

function thumbBuild(slugs: string[], source = THUMB_ART): string {
  const dir = mkdtempSync(join(tmpdir(), 'article-og-thumb-'));
  mkdirSync(join(dir, 'thumb', 'article'), { recursive: true });
  copyFileSync(join(WEB_PUBLIC, 'logo-mark.png'), join(dir, 'logo-mark.png'));
  for (const slug of slugs) writeFileSync(join(dir, 'thumb', 'article', `${slug}.svg`), source);
  return dir;
}

test('a wide article card uses thumbnail vectors at the declared 2400x1260 with a centre crop and cache', async () => {
  const { pngSize, svgToPng } = await import('./og-raster.js');
  const staticDir = thumbBuild(['ab-jchess']);
  const first = await getRoute('/og/article/ab-jchess.png?v=8', staticDir);
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-type'], 'image/png');
  assert.match(first.headers['cache-control'] ?? '', /immutable/);
  assert.equal(first.headers['x-og-cache'], 'MISS');
  assert.deepEqual(pngSize(first.body), { width: 2400, height: 1260 });
  const expected = await svgToPng(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#00aacc"/><circle cx="600" cy="315" r="150" fill="#ffffff"/></svg>',
    '#33312e',
    2,
  );
  assert.deepEqual(first.body, expected, 'renders vectors at output size and crops both edges');
  const { readFile } = await import('node:fs/promises');
  assert.notDeepEqual(first.body, await readFile(join(WEB_PUBLIC, 'og-image.png')));
  const second = await getRoute('/og/article/ab-jchess.png?v=8', staticDir);
  assert.equal(second.headers['x-og-cache'], 'HIT');
  assert.deepEqual(second.body, first.body);
});

test('missing or unrenderable thumbnail art still redirects to the default card', async () => {
  for (const [slug, source] of [
    ['jqe', null],
    ['horde-xiangqi', 'not an SVG'],
    [
      'co-up',
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><image href="/missing.png" width="480" height="300"/></svg>',
    ],
    [
      'jieqi-platform',
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><circle cx="50" cy="5000" r="10" opacity="0.5"/></svg>',
    ],
  ] as const) {
    const staticDir = thumbBuild(source ? [slug] : [], source ?? THUMB_ART);
    const res = await getRoute(`/og/article/${slug}.png?v=8`, staticDir);
    assert.equal(res.status, 302, slug);
    assert.equal(res.headers.location, '/og-image.png', slug);
    assert.equal(res.body.length, 0, slug);
  }
});

test('custom, position and board cards keep priority over thumbnail art', async () => {
  const { pngSize } = await import('./og-raster.js');
  const slugs = ['server-enforced-fog', 'fog-chess', 'jungle'];
  const staticDir = thumbBuild(slugs);
  for (const slug of slugs) {
    const res = await getRoute(`/og/article/${slug}.png?v=8`, staticDir);
    assert.equal(res.status, 200, slug);
    assert.deepEqual(pngSize(res.body), { width: 2400, height: 1260 }, slug);
  }
});

const FULL_BOARD_ARTICLES = [
  'shortest-stalemate-xiangqi',
  'helpmates-in-xiangqi',
  'jieqi-puzzle-search',
  'xiangqi-endgames',
  'duck-xiangqi-game-tree',
  'en-passant-under-fog',
  'most-played-move',
  'chess960-starting-positions',
  'lichess-analysis-accuracy',
  'jieqi-openings',
  'khai-cuoc-co-up',
  'riverbank-cannon',
  'dou-shou-qi-engine',
  'jungle-den-term',
] as const;

test('all fourteen full-board articles resolve a board and serve it in every shape', async () => {
  const { positionCardBoard } = await import('./og-image.js');
  const { renderBoardCard, renderBoardAspectCard } = await import('./og-card-board.js');
  const { svgToPng } = await import('./og-raster.js');
  // Deliberately distinctive thumbnail art: a fallback cannot pass by returning
  // a PNG of the right size. No piece art here, so the expected glyphs match.
  const staticDir = thumbBuild([...FULL_BOARD_ARTICLES]);
  for (const slug of FULL_BOARD_ARTICLES) {
    const board = positionCardBoard(slug);
    assert.ok(board, `${slug} parses/resolves through positionCardBoard`);
    const wide = await getRoute(`/og/article/${slug}.png?v=8`, staticDir);
    assert.equal(wide.status, 200, slug);
    assert.deepEqual(
      wide.body,
      await svgToPng(
        renderBoardCard(board, new Map(), { title: [ARTICLE_META[slug]!.title], wrapTitle: true }),
      ),
      `${slug}: whole board and title, never the cropped thumbnail`,
    );
    for (const aspect of ['16x9', '4x3', '1x1'] as const) {
      const res = await getRoute(`/og/article/${slug}.png?v=8&aspect=${aspect}`, staticDir);
      assert.equal(res.status, 200, `${slug} ${aspect}`);
      assert.deepEqual(
        res.body,
        await svgToPng(renderBoardAspectCard(board, new Map(), aspect)),
        `${slug} ${aspect}: board alone, never the site logo`,
      );
    }
  }
});

test('Chess960 deliberately shows SP-783, while the two openings cards use the article’s spent-option diagram', async () => {
  const { positionCardBoard } = await import('./og-image.js');
  const chess = positionCardBoard('chess960-starting-positions');
  assert.ok(chess?.kind === 'chess');
  assert.equal(chess.pieces.length, 32);
  assert.deepEqual(
    chess.pieces
      .filter((p) => p.rank === 0)
      .sort((a, b) => a.file - b.file)
      .map((p) => p.role),
    ['queen', 'rook', 'king', 'knight', 'rook', 'knight', 'bishop', 'bishop'],
  );
  const opening = positionCardBoard('jieqi-openings');
  assert.ok(opening?.kind === 'intersection');
  assert.deepEqual(opening, positionCardBoard('jieqi'));
  assert.deepEqual(positionCardBoard('khai-cuoc-co-up'), opening);
  assert.equal(opening.orientation ?? 'red', 'red');
  const lichess = positionCardBoard('lichess-analysis-accuracy');
  assert.ok(lichess?.kind === 'chess');
  assert.equal(lichess.orientation, 'black');
});

test('the fog article serializes only Black’s view, with the thumbnail’s exact fog', async () => {
  const { positionCardBoard } = await import('./og-image.js');
  const { parseDarkChessFen, darkChessVariant } = await import('@mistboard/game');
  const { boardToPieces, fogSquaresFromVisible } = await import('@mistboard/board-render');
  const parsed = parseDarkChessFen('5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ g3 0 29', 'test');
  assert.ok(parsed.ok);
  const view = darkChessVariant.getPlayerView(parsed.state, 'black');
  const board = JSON.parse(JSON.stringify(positionCardBoard('en-passant-under-fog')));
  assert.deepEqual(board, {
    kind: 'chess',
    orientation: 'black',
    pieces: boardToPieces(view.board),
    fogSquares: fogSquaresFromVisible(view.visibleSquares),
  });
  assert.equal(board.pieces.length, 5, 'four black pieces and only the visible white pawn');
  for (const pc of board.pieces) {
    const square = `${String.fromCharCode(97 + pc.file)}${pc.rank + 1}`;
    assert.ok(!board.fogSquares.some((at) => at === square), `${square} is visible`);
  }
  assert.doesNotMatch(JSON.stringify(board), /queen|rook|bishop|knight|fen/i);
});

test('the jieqi puzzle serializes backs with no hidden identities and keeps Black at the bottom', async () => {
  const { positionCardBoard } = await import('./og-image.js');
  const { resolvePositionOg } = await import('./og-position.js');
  const board = positionCardBoard('jieqi-puzzle-search');
  assert.ok(board?.kind === 'intersection');
  const serialized = JSON.stringify(board);
  // The source thumbnail’s actual deal is deliberately only in this test.
  // Changing which role lies under a back cannot change any byte of the card.
  const source = 'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X b R0A0C0P0N0B2r0a0c0p1n1b0 0 28';
  for (const deal of ['pnBB', 'npBB']) {
    const resolved = resolvePositionOg('jieqi', `${source} ${deal}`);
    assert.ok(resolved);
    assert.deepEqual(JSON.parse(serialized), { ...resolved.board, orientation: 'black' });
  }
  assert.deepEqual(JSON.parse(serialized).extras, [
    { file: 0, rank: 10, kind: 'face-down', ink: 'black' },
    { file: 8, rank: 10, kind: 'face-down', ink: 'black' },
    { file: 8, rank: 4, kind: 'face-down', ink: 'red' },
    { file: 8, rank: 1, kind: 'face-down', ink: 'red' },
  ]);
  for (const back of board.extras) {
    assert.ok(!board.pieces.some((p) => p.file === back.file && p.rank === back.rank));
  }
  assert.doesNotMatch(serialized, /faceDown|deal|hiddenRole|pool|fen/);
});

test('the thirteen translated board articles serve their complete published zh titles', async () => {
  const { positionCardBoard, ARTICLE_OG_ZH_SLUGS } = await import('./og-image.js');
  const { renderBoardCard } = await import('./og-card-board.js');
  const { svgToPng } = await import('./og-raster.js');
  const staticDir = thumbBuild([]);
  for (const slug of FULL_BOARD_ARTICLES) {
    const meta = ARTICLE_META[slug]!;
    if (slug === 'khai-cuoc-co-up') {
      assert.ok(!ARTICLE_OG_ZH_SLUGS.includes(slug));
      continue;
    }
    assert.ok(ARTICLE_OG_ZH_SLUGS.includes(slug), slug);
    for (const lang of ['zh-hans', 'zh-hant'] as const) {
      const res = await getRoute(`/og/article/${slug}.png?v=8&lang=${lang}`, staticDir);
      assert.equal(res.status, 200, `${slug} ${lang}`);
      assert.deepEqual(
        res.body,
        await svgToPng(
          renderBoardCard(
            positionCardBoard(slug)!,
            new Map(),
            { title: [meta.zhTitles![lang]], wrapTitle: true },
            'traditional',
          ),
        ),
      );
    }
  }
});

test('thumbnail art does not add localized or aspect cards', async () => {
  const staticDir = thumbBuild(['ab-jchess']);
  const path = '/og/article/ab-jchess.png?v=8';
  const { pngSize } = await import('./og-raster.js');
  assert.equal((await getRoute(`${path}&lang=zh-hans`, staticDir)).status, 404);
  for (const [aspect, size] of Object.entries({
    '1x1': { width: 1200, height: 1200 },
    '4x3': { width: 1600, height: 1200 },
    '16x9': { width: 1920, height: 1080 },
  })) {
    const res = await getRoute(`${path}&aspect=${aspect}`, staticDir);
    assert.equal(res.status, 200, aspect);
    assert.deepEqual(pngSize(res.body), size, aspect);
  }
});

function setGomokuFlag(t: TestContext, flag: string | undefined): void {
  const original = process.env.MISTBOARD_GOMOKU_ENABLED;
  t.after(() => {
    if (original === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = original;
  });
  if (flag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = flag;
}

test('Gomoku rules card shows five connected stones through the existing board renderer', async () => {
  const { positionCardBoard, articleCardTitle } = await import('./og-image.js');
  const { renderBoardCard, renderBoardAspectCard, CARD_ASPECT_FRAMES } = await import(
    './og-card-board.js'
  );
  const board = positionCardBoard('gomoku');
  assert.ok(board && board.kind === 'gomoku', 'Gomoku registers its own rules board');
  assert.equal(board.position.board.length, 225);
  assert.equal(board.position.board.filter((stone) => stone === 'black').length, 5);
  assert.equal(board.position.board.filter((stone) => stone === 'white').length, 4);
  assert.deepEqual(board.position.lastMove, { to: 'i8' });
  assert.deepEqual([...board.position.winningLine].sort(), ['e8', 'f8', 'g8', 'h8', 'i8']);
  const meta = ARTICLE_META.gomoku!;
  const title = articleCardTitle(meta.kind, meta.title);
  assert.equal(title, 'Gomoku Rules');
  // English only until the rewritten rules are localized.
  assert.equal(meta.zhTitles, undefined);
  {
    const svg = renderBoardCard(board, new Map(), { title: [title] });
    assert.match(svg, /fill="#dcb975"/);
    assert.equal((svg.match(/class="gomoku-stone /g) ?? []).length, 9);
    assert.equal((svg.match(/class="gomoku-winning"/g) ?? []).length, 5);
    assert.equal((svg.match(/class="gomoku-last"/g) ?? []).length, 1);
    assert.match(svg, /data-piece-square="i8"[^>]*gomoku-stone--black/);
    assert.ok(svg.includes(`>${title}</text>`));
    assert.doesNotMatch(svg, /gomoku-hit|tabindex|role="button"/);
  }
  for (const aspect of ['16x9', '4x3', '1x1'] as const) {
    const svg = renderBoardAspectCard(board, new Map(), aspect);
    const { width, height } = CARD_ASPECT_FRAMES[aspect];
    assert.ok(svg.includes(`width="${width}" height="${height}"`));
    assert.equal((svg.match(/class="gomoku-stone /g) ?? []).length, 9);
  }
});

test('Gomoku rules share URLs serve every shape in English and 404 a zh caption when enabled', async (t) => {
  setGomokuFlag(t, 'true');
  const { articleOgImageUrl } = await import('./og-image.js');
  const { pngSize } = await import('./og-raster.js');
  const frames = {
    '': { width: 2400, height: 1260 },
    '16x9': { width: 1920, height: 1080 },
    '4x3': { width: 1600, height: 1200 },
    '1x1': { width: 1200, height: 1200 },
  };
  for (const [aspect, size] of Object.entries(frames)) {
    const url = new URL(articleOgImageUrl('https://mistboard.test', 'gomoku'));
    if (aspect) url.searchParams.set('aspect', aspect);
    const res = await getRoute(`${url.pathname}${url.search}`);
    assert.equal(res.status, 200, aspect);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(pngSize(res.body), size);
    for (const lang of ['zh-hans', 'zh-hant']) {
      assert.equal(
        articleOgImageUrl('https://mistboard.test', 'gomoku', lang),
        articleOgImageUrl('https://mistboard.test', 'gomoku'),
      );
      url.searchParams.set('lang', lang);
      assert.equal(
        (await getRoute(`${url.pathname}${url.search}`)).status,
        404,
        `${lang} ${aspect}`,
      );
    }
  }
  // The feature gate must run before a warm card cache can return bytes.
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  assert.equal((await getRoute('/og/article/gomoku.png?v=8')).status, 404);
});

test('Gomoku rules share images stay absent with the flag off or unset', async (t) => {
  setGomokuFlag(t, undefined);
  for (const flag of [undefined, 'false']) {
    if (flag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = flag;
    for (const lang of ['', '&lang=zh-hans', '&lang=zh-hant']) {
      for (const shape of ['', '&aspect=16x9', '&aspect=4x3', '&aspect=1x1']) {
        const res = await getRoute(`/og/article/gomoku.png?v=8${lang}${shape}`);
        assert.equal(res.status, 404, `${flag} ${lang} ${shape}`);
        assert.notEqual(res.headers['content-type'], 'image/png');
      }
    }
  }
});

test('the article card route serves each aspect at its size, board and site cards alike', async () => {
  const { pngSize } = await import('./og-raster.js');
  const expected = { '16x9': [1920, 1080], '4x3': [1600, 1200], '1x1': [1200, 1200] } as const;
  // jungle: a rules board; banqi: the widest board (2:1); pikafish: an
  // article's board; jieqi-platform: no card of its own, so the site card
  // re-framed.
  for (const slug of ['jungle', 'banqi', 'pikafish', 'jieqi-platform']) {
    for (const [aspect, [width, height]] of Object.entries(expected)) {
      const res = await getRoute(`/og/article/${slug}.png?v=8&aspect=${aspect}`);
      assert.equal(res.status, 200, `${slug} ${aspect}`);
      assert.equal(res.headers['content-type'], 'image/png');
      assert.deepEqual(pngSize(res.body), { width, height }, `${slug} ${aspect}`);
    }
  }
  // The wide card is untouched: still 2400x1260 with no aspect.
  const wide = await getRoute('/og/article/jungle.png?v=8');
  assert.deepEqual(pngSize(wide.body), { width: 2400, height: 1260 });
});

test('an unknown aspect is a 400, never the wide card under a square URL', async () => {
  for (const bad of ['2x1', '1X1', '', 'square']) {
    const res = await getRoute(`/og/article/jungle.png?v=8&aspect=${bad}`);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.notEqual(res.headers['content-type'], 'image/png');
  }
});

test('a hand-drawn card has no aspect versions and says so with a 404', async () => {
  const res = await getRoute('/og/article/yin-sheng.png?v=8&aspect=1x1');
  assert.equal(res.status, 404);
  const unknown = await getRoute('/og/article/no-such-article.png?v=8&aspect=1x1');
  assert.equal(unknown.status, 404);
});

// A zh page's card is the same board in the traditional set with the page's
// zh title: a URL of its own per script (?lang=zh-hans|zh-hant), every shape,
// never the English card's bytes.
test('a xiangqi-family card has a zh version per script at every shape', async () => {
  const { pngSize } = await import('./og-raster.js');
  const { ARTICLE_OG_ZH_SLUGS } = await import('./og-image.js');
  assert.ok(ARTICLE_OG_ZH_SLUGS.includes('banqi'));
  assert.ok(ARTICLE_OG_ZH_SLUGS.includes('xiangqi'));
  assert.ok(ARTICLE_OG_ZH_SLUGS.includes('pikafish'));
  assert.ok(!ARTICLE_OG_ZH_SLUGS.includes('jungle'), 'animal pieces have no hanzi set');
  for (const slug of ['banqi', 'pikafish']) {
    for (const shape of ['', '&aspect=16x9', '&aspect=4x3', '&aspect=1x1']) {
      const plain = await getRoute(`/og/article/${slug}.png?v=8${shape}`);
      const hans = await getRoute(`/og/article/${slug}.png?v=8&lang=zh-hans${shape}`);
      const hant = await getRoute(`/og/article/${slug}.png?v=8&lang=zh-hant${shape}`);
      for (const [name, res] of [
        ['zh-hans', hans],
        ['zh-hant', hant],
      ] as const) {
        assert.equal(res.status, 200, `${slug} ${name} ${shape}`);
        assert.equal(res.headers['content-type'], 'image/png');
        assert.deepEqual(pngSize(res.body), pngSize(plain.body), `${slug} same size ${shape}`);
        assert.ok(!res.body.equals(plain.body), `${slug} ${name} differs from English ${shape}`);
      }
      // The wide cards differ by caption script; an aspect card has no caption,
      // so both scripts are the same hanzi board.
      if (shape === '') assert.ok(!hans.body.equals(hant.body), `${slug} captions differ`);
    }
  }
});

test('every zh card captions in its own script, at full size, from the published title', async () => {
  const { ARTICLE_OG_LANGS, ARTICLE_OG_ZH_SLUGS, articleCardTitleZh, positionCardBoard } =
    await import('./og-image.js');
  const { renderBoardCard } = await import('./og-card-board.js');
  assert.equal(articleCardTitleZh('暗棋規則：玩法詳解與免費線上對弈'), '暗棋規則');
  assert.equal(articleCardTitleZh('象棋規則'), '象棋規則');
  for (const slug of ARTICLE_OG_ZH_SLUGS) {
    const zhTitles = ARTICLE_META[slug]?.zhTitles;
    assert.ok(zhTitles, `${slug} has published zh titles`);
    const board = positionCardBoard(slug);
    assert.ok(board, `${slug} has a board`);
    for (const lang of ARTICLE_OG_LANGS) {
      const isArticle = (FULL_BOARD_ARTICLES as readonly string[]).includes(slug);
      const title: string = isArticle ? zhTitles[lang] : articleCardTitleZh(zhTitles[lang]);
      assert.match(title, /\p{Script=Han}/u, `${slug} ${lang}: ${title}`);
      if (!isArticle) assert.doesNotMatch(title, /[—：]/, `${slug} ${lang}: ${title}`);
      const svg = renderBoardCard(
        board,
        new Map(),
        { title: [title], wrapTitle: isArticle },
        'traditional',
      );
      // Rules keep their existing single line; articles may wrap, still at 52.
      const lines = [...svg.matchAll(/font-size="(\d+)" font-weight="700">([^<]*)<\/text>/g)].map(
        (m) => ({ size: Number(m[1]), text: m[2]! }),
      );
      assert.equal(
        lines
          .map((l) => l.text)
          .join('')
          .replace(/\s/g, ''),
        title.replace(/\s/g, ''),
        `${slug} ${lang}`,
      );
      assert.ok(lines.every((l) => l.size === 52));
      if (!isArticle) assert.equal(lines.length, 1, `${slug} rules layout unchanged`);
    }
  }
  assert.equal(articleCardTitleZh(ARTICLE_META.banqi!.zhTitles!['zh-hant']), '暗棋規則');
});

test('an unknown lang is a 400 and a card with no zh version is a 404', async () => {
  for (const bad of ['zh', 'zh-Hant', 'zh-tw', 'en', 'traditional', '']) {
    const res = await getRoute(`/og/article/banqi.png?v=8&lang=${bad}`);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.notEqual(res.headers['content-type'], 'image/png');
  }
  // The retired pre-release parameter is not quietly honoured either.
  const old = await getRoute('/og/article/banqi.png?v=8&pieces=traditional');
  const plain = await getRoute('/og/article/banqi.png?v=8');
  assert.ok(old.body.equals(plain.body), 'pieces= is ignored, not mapped to a zh card');
  for (const path of [
    '/og/article/jungle.png?v=8&lang=zh-hant',
    '/og/article/yin-sheng.png?v=8&lang=zh-hant',
    '/og/article/jieqi-platform.png?v=8&lang=zh-hans&aspect=1x1',
    '/og/article/no-such-article.png?v=8&lang=zh-hans',
  ]) {
    const res = await getRoute(path);
    assert.equal(res.status, 404, path);
  }
});

test('the pikafish card is a legal main-line position, replayed by the kernel', async () => {
  const { PIKAFISH_CARD_FEN, PIKAFISH_CARD_MOVES } = await import('./og-image.js');
  const {
    applyStandardXiangqiMove,
    createInitialXiangqiState,
    importXiangqiGame,
    standardXiangqiFen,
  } = await import('@mistboard/game');
  const imported = importXiangqiGame(PIKAFISH_CARD_MOVES);
  assert.ok(!imported.error, imported.error);
  let state = createInitialXiangqiState('pikafish-card');
  for (const move of imported.moves) state = applyStandardXiangqiMove(state, move);
  assert.equal(imported.moves.length, 19);
  assert.equal(standardXiangqiFen(state), PIKAFISH_CARD_FEN);
});

test('the banqi rules card is a game under way, not the face-down start', async () => {
  const { BANQI_RULES_CARD_FEN } = await import('./og-image.js');
  const { resolvePositionOg } = await import('./og-position.js');
  const resolved = resolvePositionOg('banqi', BANQI_RULES_CARD_FEN);
  assert.ok(resolved && resolved.board.kind === 'grid', 'the card FEN parses, pool and all');
  const { files, ranks, tiles } = resolved.board;
  const up = tiles.filter((t) => !t.hidden);
  const down = tiles.filter((t) => t.hidden);
  assert.ok(up.length >= 10 && up.length <= 14, `${up.length} face up`);
  assert.ok(down.length >= 8, `${down.length} face down`);
  assert.ok(files * ranks - tiles.length >= 2, 'some squares are empty');
  assert.equal(new Set(up.map((t) => (t.hidden ? null : t.ink))).size, 2, 'both inks face up');
});

test('no position card shows its variant at the start position', async () => {
  const { positionCardBoard } = await import('./og-image.js');
  const { resolvePositionOg, startPositionFen } = await import('./og-position.js');
  const cards = {
    xiangqi: 'xiangqi',
    'fog-xiangqi': 'dark-xiangqi',
    jieqi: 'jieqi',
    banqi: 'banqi',
    'fortress-xiangqi': 'fortress-xiangqi',
    'duck-xiangqi': 'duck-xiangqi',
    'atomic-xiangqi': 'atomic-xiangqi',
    'crazyhouse-xiangqi': 'crazyhouse-xiangqi',
    jungle: 'jungle',
    'jungle-flip': 'jungle-flip',
    pikafish: 'xiangqi',
    'shortest-stalemate-xiangqi': 'xiangqi',
    'helpmates-in-xiangqi': 'xiangqi',
    'jieqi-puzzle-search': 'jieqi',
    'xiangqi-endgames': 'xiangqi',
    'duck-xiangqi-game-tree': 'duck-xiangqi',
    'en-passant-under-fog': 'dark-chess',
    'most-played-move': 'dark-chess',
    'lichess-analysis-accuracy': 'dark-chess',
    'jieqi-openings': 'jieqi',
    'khai-cuoc-co-up': 'jieqi',
    'riverbank-cannon': 'xiangqi',
    'dou-shou-qi-engine': 'jungle',
    'jungle-den-term': 'jungle',
  } as const;
  for (const [slug, variant] of Object.entries(cards)) {
    const card = positionCardBoard(slug);
    const start = resolvePositionOg(variant, startPositionFen(variant));
    assert.ok(card && start, slug);
    assert.notDeepEqual(card, start.board, `${slug} shows the start position`);
  }
});

test('every mid-game rules card is a legal line, replayed by its kernel', async () => {
  const og = await import('./og-image.js');
  const g = await import('@mistboard/game');
  const squares = (token: string) => {
    const m = /^([a-z]\d+)([a-z]\d+)$/.exec(token);
    assert.ok(m, token);
    return { from: m[1], to: m[2] } as never;
  };
  // Replays a line, asserting each move is legal first: several kernels'
  // apply functions return the state unchanged on an illegal move.
  const replay = <S>(
    name: string,
    start: S,
    line: string,
    parse: (token: string) => never,
    legal: (state: S, move: never) => boolean,
    apply: (state: S, move: never) => S,
  ): S => {
    let state = start;
    for (const token of line.split(' ')) {
      const move = parse(token);
      assert.ok(legal(state, move), `${name}: ${token} is legal`);
      state = apply(state, move);
    }
    return state;
  };

  for (const [name, moves, fen, plies] of [
    ['xiangqi', og.XIANGQI_CARD_MOVES, og.XIANGQI_CARD_FEN, 30],
    ['fog-xiangqi', og.FOG_XIANGQI_CARD_MOVES, og.FOG_XIANGQI_CARD_FEN, 26],
  ] as const) {
    const imported = g.importXiangqiGame(moves);
    assert.ok(!imported.error, imported.error);
    assert.equal(imported.moves.length, plies, name);
    let state = g.createInitialXiangqiState(name);
    for (const move of imported.moves) {
      assert.ok(g.isStandardXiangqiLegalMove(state, move), `${name}: ${move.from}${move.to}`);
      state = g.applyStandardXiangqiMove(state, move);
    }
    assert.equal(g.standardXiangqiFen(state), fen, name);
  }

  // A shuffled deal, fixed here so the reveals are reproducible.
  const jieqiDeal: import('@mistboard/game').JieqiDeal = {
    red: [
      'cannon',
      'cannon',
      'soldier',
      'horse',
      'advisor',
      'horse',
      'soldier',
      'chariot',
      'soldier',
      'elephant',
      'soldier',
      'chariot',
      'elephant',
      'advisor',
      'soldier',
    ],
    black: [
      'cannon',
      'soldier',
      'advisor',
      'chariot',
      'soldier',
      'soldier',
      'soldier',
      'soldier',
      'horse',
      'elephant',
      'horse',
      'elephant',
      'cannon',
      'advisor',
      'chariot',
    ],
  };
  const jieqi = replay(
    'jieqi',
    g.createInitialJieqiState('jieqi-card', jieqiDeal),
    og.JIEQI_CARD_MOVES,
    squares,
    g.isJieqiLegalMove,
    g.applyJieqiMove,
  );
  assert.equal(g.jieqiStateToPikafishFen(jieqi), og.JIEQI_CARD_FEN);

  const fortress = replay(
    'fortress',
    g.createInitialFortressXiangqiState('fortress-card'),
    og.FORTRESS_XIANGQI_CARD_MOVES,
    squares,
    g.isFortressXiangqiLegalMove,
    g.applyFortressXiangqiMove,
  );
  assert.equal(g.fortressXiangqiEngineFen(fortress), og.FORTRESS_XIANGQI_CARD_FEN);

  const duck = replay(
    'duck',
    g.createInitialDuckXiangqiState('duck-card'),
    og.DUCK_XIANGQI_CARD_MOVES,
    (token) => {
      const [move, duckTo] = token.split('@');
      return { ...(squares(move ?? '') as object), duckTo } as never;
    },
    g.isDuckXiangqiLegalTurn,
    g.applyDuckXiangqiTurn,
  );
  assert.equal(g.duckXiangqiFen(duck), og.DUCK_XIANGQI_CARD_FEN);

  const atomic = replay(
    'atomic',
    g.createInitialAtomicXiangqiState('atomic-card'),
    og.ATOMIC_XIANGQI_CARD_MOVES,
    squares,
    g.isAtomicXiangqiLegalMove,
    g.applyAtomicXiangqiMove,
  );
  assert.equal(g.atomicXiangqiFen(atomic), og.ATOMIC_XIANGQI_CARD_FEN);

  const crazyhouse = replay(
    'crazyhouse',
    g.createInitialCrazyhouseXiangqiState('crazyhouse-card'),
    og.CRAZYHOUSE_XIANGQI_CARD_MOVES,
    (token) => {
      const move = g.crazyhouseXiangqiMoveFromUci(token);
      assert.ok(move, token);
      return move as never;
    },
    g.isCrazyhouseXiangqiLegalMove,
    g.applyCrazyhouseXiangqiMove,
  );
  assert.equal(g.crazyhouseXiangqiFen(crazyhouse), og.CRAZYHOUSE_XIANGQI_CARD_FEN);

  const jungle = replay(
    'jungle',
    g.createInitialJungleState('jungle-card'),
    og.JUNGLE_CARD_MOVES,
    squares,
    g.isJungleLegalMove,
    g.applyJungleMove,
  );
  assert.equal(g.jungleStateToEngineFen(jungle), og.JUNGLE_CARD_FEN);

  const flipDeal: import('@mistboard/game').JungleFlipDeal = (
    [
      ['red', 'leopard'],
      ['black', 'tiger'],
      ['red', 'cat'],
      ['black', 'lion'],
      ['red', 'tiger'],
      ['red', 'dog'],
      ['black', 'rat'],
      ['black', 'elephant'],
      ['black', 'cat'],
      ['red', 'lion'],
      ['red', 'wolf'],
      ['black', 'wolf'],
      ['black', 'leopard'],
      ['red', 'elephant'],
      ['red', 'rat'],
      ['black', 'dog'],
    ] as const
  ).map(([color, role]) => ({ color, role }));
  const flip = replay(
    'jungle-flip',
    g.createInitialJungleFlipState('jungle-flip-card', flipDeal),
    og.JUNGLE_FLIP_CARD_MOVES,
    squares,
    g.isJungleFlipLegalMove,
    g.applyJungleFlipMove,
  );
  assert.equal(g.jungleFlipStateToEngineFen(flip), og.JUNGLE_FLIP_CARD_FEN);
});

test("a zh page names its script's card; the English page and other boards do not", async () => {
  const { articleOgImageUrl } = await import('./og-image.js');
  const host = 'https://mistboard.com';
  assert.equal(articleOgImageUrl(host, 'banqi'), `${host}/og/article/banqi.png?v=8`);
  for (const prefix of ['zh-hans', 'zh-hant']) {
    for (const slug of ['banqi', 'pikafish']) {
      assert.equal(
        articleOgImageUrl(host, slug, prefix),
        `${host}/og/article/${slug}.png?v=8&lang=${prefix}`,
      );
    }
    assert.equal(articleOgImageUrl(host, 'jungle', prefix), `${host}/og/article/jungle.png?v=8`);
  }
  for (const other of ['vi', 'zh', 'en']) {
    assert.equal(articleOgImageUrl(host, 'banqi', other), `${host}/og/article/banqi.png?v=8`);
  }
});

test('a rules card says "Rules" once, wherever the page title has it', async () => {
  const { articleCardTitle } = await import('./og-image.js');
  assert.equal(articleCardTitle('rules', 'Xiangqi'), 'Xiangqi Rules');
  assert.equal(articleCardTitle('rules', 'Xiangqi Rules'), 'Xiangqi Rules');
  assert.equal(
    articleCardTitle('rules', 'Banqi Rules (Chinese Dark Chess)'),
    'Banqi Rules (Chinese Dark Chess)',
  );
  assert.equal(articleCardTitle('article', 'How Banqi Works'), 'How Banqi Works');
  for (const [slug, meta] of Object.entries(ARTICLE_META)) {
    if (meta.kind !== 'rules') continue;
    const words = articleCardTitle('rules', meta.title).match(/\bRules\b/g) ?? [];
    assert.equal(words.length, 1, `${slug}: ${meta.title}`);
  }
});

test('an aspect card is the board alone, centred, with no caption to crop', async () => {
  const { renderBoardAspectCard, CARD_ASPECT_FRAMES, CARD_BG } = await import('./og-card-board.js');
  const { resolvePositionOg, startPositionFen } = await import('./og-position.js');
  for (const variant of ['xiangqi', 'banqi', 'jungle'] as const) {
    const resolved = resolvePositionOg(variant, startPositionFen(variant));
    assert.ok(resolved);
    for (const aspect of ['16x9', '4x3', '1x1'] as const) {
      const svg = renderBoardAspectCard(resolved.board, new Map(), aspect);
      const frame = CARD_ASPECT_FRAMES[aspect];
      const m = svg.match(
        /<rect[^>]*\/><svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/,
      );
      assert.ok(m, `${variant} ${aspect} board frame`);
      const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
      assert.ok(
        Math.abs(x + w / 2 - frame.width / 2) < 0.01,
        `${variant} ${aspect} centred across`,
      );
      assert.ok(Math.abs(y + h / 2 - frame.height / 2) < 0.01, `${variant} ${aspect} centred down`);
      if (aspect === '1x1') {
        // The square has no border: the board reaches the frame on its own colour.
        assert.ok(w === frame.width || h === frame.height, `${variant} square fills the frame`);
        assert.ok(!svg.includes(`fill="${CARD_BG}"`), `${variant} square has no dark frame`);
      } else {
        assert.ok(x >= 24 && y >= 24, `${variant} ${aspect} inside the pad`);
      }
      // A square centre crop of the frame keeps the whole of an upright board;
      // banqi (2:1) loses its outer files to one but stays board edge to edge.
      const side = Math.min(frame.width, frame.height);
      if (variant !== 'banqi') {
        assert.ok(w <= side && h <= side, `${variant} ${aspect} survives a square crop`);
      } else {
        assert.ok(h <= side, `${variant} ${aspect} keeps its height in a square crop`);
      }
      // Caption text is the wide card's; pieces may carry glyph text here (no art).
      assert.doesNotMatch(svg, /mistboard\.com|Rules</);
    }
  }
});

// The web build writes the card URLs into og:image and the JSON-LD and cannot
// import this module, so it mirrors three facts: the ?v=, which slugs are
// wide-only and which have a zh card. Either drifting ships a card scrapers never refetch or a JSON-LD
// image URL that 404s.
test('the web card-URL mirror carries the same version and wide-only slugs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { ARTICLE_OG_ZH_SLUGS, ARTICLE_OG_IMAGE_VERSION, ARTICLE_OG_WIDE_ONLY_SLUGS } =
    await import('./og-image.js');
  const source = await readFile(
    resolve(import.meta.dirname, '../../web/src/article-og-image.ts'),
    'utf-8',
  );
  assert.ok(
    source.includes(`export const ARTICLE_OG_IMAGE_VERSION = ${ARTICLE_OG_IMAGE_VERSION};`),
    `article-og-image.ts must declare ARTICLE_OG_IMAGE_VERSION = ${ARTICLE_OG_IMAGE_VERSION}`,
  );
  const block = source.match(/ARTICLE_OG_WIDE_ONLY_SLUGS[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, 'article-og-image.ts declares ARTICLE_OG_WIDE_ONLY_SLUGS');
  const mirrored = [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...mirrored].sort(), [...ARTICLE_OG_WIDE_ONLY_SLUGS].sort());
  const zhBlock = source.match(/ARTICLE_OG_ZH_SLUGS[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(zhBlock, 'article-og-image.ts declares ARTICLE_OG_ZH_SLUGS');
  const zh = [...zhBlock[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...zh].sort(), [...ARTICLE_OG_ZH_SLUGS].sort());
  const prerender = await readFile(
    resolve(import.meta.dirname, '../../web/scripts/prerender-articles.mjs'),
    'utf-8',
  );
  assert.ok(
    prerender.includes("ssrLoadModule(\n    '/src/article-og-image.ts'"),
    'the prerender uses it',
  );
});

// ── Xiangqi Mahjong rules card ────────────────────────────────────────────────

test('the Xiangqi Mahjong card shows a hand the rules kernel calls a win', async () => {
  const { xmjWinShape } = await import('@mistboard/game');
  const { XMJ_OG_HAND } = await import('./og-image.js');
  assert.equal(XMJ_OG_HAND.length, 2, 'one set and a pair');
  assert.deepEqual(
    XMJ_OG_HAND.map((group) => group.length),
    [3, 2],
  );
  assert.ok(xmjWinShape(XMJ_OG_HAND.flat(), []), 'the card hand is a win');
});

test('the Xiangqi Mahjong rules card renders wide only, at the card size', async () => {
  const { pngSize } = await import('./og-raster.js');
  const res = await getRoute('/og/article/xiangqi-mahjong-32.png?v=8');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.deepEqual(pngSize(res.body), { width: 2400, height: 1260 });
  const aspect = await getRoute('/og/article/xiangqi-mahjong-32.png?v=8&aspect=1x1');
  assert.equal(aspect.status, 404);
});
