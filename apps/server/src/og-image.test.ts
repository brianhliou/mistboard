import assert from 'node:assert/strict';
import test from 'node:test';
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
async function getRoute(path: string): Promise<RouteCapture> {
  const { createHttpRequestHandler } = await import('./server-http.js');
  const handler = createHttpRequestHandler({
    staticDir: WEB_PUBLIC,
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

test('the article card route serves each aspect at its size, board and site cards alike', async () => {
  const { pngSize } = await import('./og-raster.js');
  const expected = { '16x9': [1920, 1080], '4x3': [1600, 1200], '1x1': [1200, 1200] } as const;
  // jungle: a rules board; banqi: the widest board (2:1); pikafish: an
  // article's board; jieqi-platform: no card of its own, so the site card
  // re-framed.
  for (const slug of ['jungle', 'banqi', 'pikafish', 'jieqi-platform']) {
    for (const [aspect, [width, height]] of Object.entries(expected)) {
      const res = await getRoute(`/og/article/${slug}.png?v=5&aspect=${aspect}`);
      assert.equal(res.status, 200, `${slug} ${aspect}`);
      assert.equal(res.headers['content-type'], 'image/png');
      assert.deepEqual(pngSize(res.body), { width, height }, `${slug} ${aspect}`);
    }
  }
  // The wide card is untouched: still 2400x1260 with no aspect.
  const wide = await getRoute('/og/article/jungle.png?v=5');
  assert.deepEqual(pngSize(wide.body), { width: 2400, height: 1260 });
});

test('an unknown aspect is a 400, never the wide card under a square URL', async () => {
  for (const bad of ['2x1', '1X1', '', 'square']) {
    const res = await getRoute(`/og/article/jungle.png?v=5&aspect=${bad}`);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.notEqual(res.headers['content-type'], 'image/png');
  }
});

test('a hand-drawn card has no aspect versions and says so with a 404', async () => {
  const res = await getRoute('/og/article/yin-sheng.png?v=5&aspect=1x1');
  assert.equal(res.status, 404);
  const unknown = await getRoute('/og/article/no-such-article.png?v=5&aspect=1x1');
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
      const plain = await getRoute(`/og/article/${slug}.png?v=5${shape}`);
      const hans = await getRoute(`/og/article/${slug}.png?v=5&lang=zh-hans${shape}`);
      const hant = await getRoute(`/og/article/${slug}.png?v=5&lang=zh-hant${shape}`);
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
      const title = articleCardTitleZh(zhTitles[lang]);
      assert.match(title, /\p{Script=Han}/u, `${slug} ${lang}: ${title}`);
      assert.doesNotMatch(title, /[—：]/, `${slug} ${lang}: ${title}`);
      const svg = renderBoardCard(board, new Map(), { title: [title] }, 'traditional');
      // One line at the type scale's 52: fitted, never shrunk or broken.
      const lines = [...svg.matchAll(/font-size="(\d+)" font-weight="700">([^<]*)<\/text>/g)]
        .filter((m) => m[2] === title)
        .map((m) => Number(m[1]));
      assert.deepEqual(lines, [52], `${slug} ${lang}: ${title}`);
    }
  }
  assert.equal(articleCardTitleZh(ARTICLE_META.banqi!.zhTitles!['zh-hant']), '暗棋規則');
});

test('an unknown lang is a 400 and a card with no zh version is a 404', async () => {
  for (const bad of ['zh', 'zh-Hant', 'zh-tw', 'en', 'traditional', '']) {
    const res = await getRoute(`/og/article/banqi.png?v=5&lang=${bad}`);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.notEqual(res.headers['content-type'], 'image/png');
  }
  // The retired pre-release parameter is not quietly honoured either.
  const old = await getRoute('/og/article/banqi.png?v=5&pieces=traditional');
  const plain = await getRoute('/og/article/banqi.png?v=5');
  assert.ok(old.body.equals(plain.body), 'pieces= is ignored, not mapped to a zh card');
  for (const path of [
    '/og/article/jungle.png?v=5&lang=zh-hant',
    '/og/article/yin-sheng.png?v=5&lang=zh-hant',
    '/og/article/jieqi-platform.png?v=5&lang=zh-hans&aspect=1x1',
    '/og/article/no-such-article.png?v=5&lang=zh-hans',
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
  assert.equal(articleOgImageUrl(host, 'banqi'), `${host}/og/article/banqi.png?v=5`);
  for (const prefix of ['zh-hans', 'zh-hant']) {
    for (const slug of ['banqi', 'pikafish']) {
      assert.equal(
        articleOgImageUrl(host, slug, prefix),
        `${host}/og/article/${slug}.png?v=5&lang=${prefix}`,
      );
    }
    assert.equal(articleOgImageUrl(host, 'jungle', prefix), `${host}/og/article/jungle.png?v=5`);
  }
  for (const other of ['vi', 'zh', 'en']) {
    assert.equal(articleOgImageUrl(host, 'banqi', other), `${host}/og/article/banqi.png?v=5`);
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
  const { renderBoardAspectCard, CARD_ASPECT_FRAMES } = await import('./og-card-board.js');
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
      assert.ok(x >= 24 && y >= 24, `${variant} ${aspect} inside the pad`);
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
