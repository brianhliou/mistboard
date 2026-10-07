// Figures for the article "What the duck does to xiangqi's game tree"
// (apps/web/src/articles/content/duck-xiangqi-game-tree.ts).
//
//   node scripts/duck-tree-figures.mjs                 write the 18 SVGs
//   node scripts/duck-tree-figures.mjs --extract <dir> refresh the figure 3 data
//                                                      from <dir>/per-ply.csv
//
// Figures 1 and 2 are computed here from the site's own rules kernel
// (@mistboard/game, built dist), and every count the article quotes is asserted
// before anything is written. If the kernel and the prose ever disagree, this
// throws instead of shipping a figure that contradicts the paragraph beside it.
//
// Figure 3 reads scripts/data/duck-tree-figures.json: for each game, one row
// [ply, p25, median, p75] of legal moves at that ply across 64 Fairy-Stockfish
// self-play games (100k nodes a move, NNUE off).
//
// Output: apps/web/public/article-thumbs/duck-tree-{trees,board,branching}
// {,-dark}.svg (zh variants once the English is final). Text uses a system font stack because web
// fonts do not load inside an <img>.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderXiangqiOgBoardSvg } from '@mistboard/board-render';
import * as G from '@mistboard/game';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(ROOT, 'scripts/data/duck-tree-figures.json');
const OUT_DIR = path.join(ROOT, 'apps/web/public/article-thumbs');

// ---------- --extract ----------
const extractAt = process.argv.indexOf('--extract');
if (extractAt !== -1) {
  const dir = process.argv[extractAt + 1];
  if (!dir) throw new Error('--extract needs the directory holding per-ply.csv');
  const lines = readFileSync(path.join(dir, 'per-ply.csv'), 'utf8').trim().split('\n');
  const header = lines.shift().split(',');
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`per-ply.csv has no ${name} column`);
    return i;
  };
  const [cg, cp, c25, cm, c75] = ['game', 'ply', 'p25', 'median', 'p75'].map(col);
  const out = { games: 64, xiangqi: [], duck: [] };
  for (const line of lines) {
    const c = line.split(',');
    const rows = out[c[cg]];
    if (!rows) throw new Error(`unknown game ${c[cg]}`);
    rows.push([Number(c[cp]), Number(c[c25]), Number(c[cm]), Number(c[c75])]);
  }
  writeFileSync(DATA_PATH, `${JSON.stringify(out)}\n`);
  console.log(
    `wrote ${path.relative(ROOT, DATA_PATH)}: ${out.xiangqi.length} xiangqi plies, ${out.duck.length} duck plies`,
  );
  process.exit(0);
}

// ---------- counts from the kernel ----------
const key = (m) => `${m.from}${m.to}`;
function assertEq(label, actual, expected) {
  if (actual !== expected)
    throw new Error(`${label}: kernel says ${actual}, article says ${expected}`);
}

// Xiangqi two plies deep, strictly legal. The kernel plays to general capture,
// so a black reply that leaves black's general capturable is dropped.
const x0 = G.createInitialXiangqiState('g');
const xiangqi = G.getLegalMoves(x0).map((m) => {
  const s1 = G.applyMove(x0, m);
  const safe = (r) => {
    const s2 = G.applyMove(s1, r);
    return !G.getLegalMoves(s2).some((q) => s2.board[q.to]?.role === 'general');
  };
  return { m: key(m), replies: G.getLegalMoves(s1).filter(safe).map(key) };
});

// Duck Xiangqi one ply deep. Each duck placement is scored against black's
// replies on the same board with no duck at all.
const d0 = G.createInitialDuckXiangqiState('g');
const byMove = new Map();
for (const t of G.getDuckXiangqiLegalTurns(d0)) {
  const s1 = G.applyDuckXiangqiTurn(d0, t);
  const k = key(t);
  if (!byMove.has(k)) {
    const bare = { ...s1, duck: undefined };
    byMove.set(k, {
      m: k,
      board: s1.board,
      base: G.getDuckXiangqiLegalPieceMoves(bare).map(key),
      ducks: [],
    });
  }
  const g = byMove.get(k);
  const withDuck = new Set(G.getDuckXiangqiLegalPieceMoves(s1).map(key));
  const base = new Set(g.base);
  g.ducks.push({
    sq: t.duckTo,
    rm: g.base.filter((r) => !withDuck.has(r)),
    add: [...withDuck].filter((r) => !base.has(r)),
    cls: -1,
  });
}
// Placements that leave black the same replies are one situation.
const duck = [...byMove.values()].map((g) => {
  const classes = new Map();
  for (const d of g.ducks) {
    const sig = `${d.rm.join()}|${d.add.join()}`;
    if (!classes.has(sig)) classes.set(sig, classes.size);
    d.cls = classes.get(sig);
  }
  return { ...g, classes: classes.size };
});

const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const allDucks = duck.flatMap((g) => g.ducks);
const counts = {
  redMoves: xiangqi.length,
  xiangqiLeaves: sum(xiangqi, (c) => c.replies.length),
  duckRedMoves: duck.length,
  duckLeaves: allDucks.length,
  noEffect: allDucks.filter((d) => !d.rm.length && !d.add.length).length,
  classes: sum(duck, (g) => g.classes),
  adds: allDucks.filter((d) => d.add.length).length,
  minClasses: Math.min(...duck.map((g) => g.classes)),
  maxClasses: Math.max(...duck.map((g) => g.classes)),
};
assertEq('xiangqi red moves', counts.redMoves, 44);
assertEq('xiangqi positions after two moves', counts.xiangqiLeaves, 1920);
assertEq('duck red piece moves', counts.duckRedMoves, 44);
assertEq('duck positions after one move', counts.duckLeaves, 2554);
assertEq('placements with no effect', counts.noEffect, 1268);
assertEq('distinct situations', counts.classes, 1310);
assertEq('placements that add a reply', counts.adds, 364);
assertEq('fewest situations per red move', counts.minClasses, 26);
assertEq('most situations per red move', counts.maxClasses, 31);
for (const g of duck) {
  const e8 = g.ducks.find((d) => d.sq === 'e8');
  assertEq(`e8 replies removed after ${g.m}`, e8?.rm.length, 8);
}
// Red's half: across all 44 moves, only the cannon files b2-b5 and h2-h5 ever matter.
const redHalf = new Set();
for (const d of allDucks)
  if (Number(d.sq.slice(1)) <= 5 && (d.rm.length || d.add.length)) redHalf.add(d.sq);
assertEq(
  "points on red's half with an effect",
  [...redHalf].sort().join(),
  'b2,b3,b4,b5,h2,h3,h4,h5',
);

// Figure 2's move, against the article's table.
const H3E3 = duck.find((g) => g.m === 'h3e3');
assertEq('black replies after h3e3', H3E3.base.length, 45);
assertEq('situations after h3e3', H3E3.classes, 31);
const EXPECTED_H3E3 =
  'b2 -1, h2 -1/+1, h3 -2/+1, b4 -2/+1, h4 -3/+1, b5 -3/+1, h5 -4/+1, a6 -1, b6 -4/+1, c6 -1, e6 -1, g6 -1, h6 -5/+1, i6 -1, b7 -5/+1, h7 -6/+1, a8 -4, c8 -7, d8 -6, e8 -8, f8 -6, g8 -7, i8 -4, a9 -2, b9 -4, d9 -1, e9 -3, f9 -1, h9 -4, i9 -2';
const rankOf = (sq) => Number(sq.slice(1));
const fileOf = (sq) => sq.charCodeAt(0) - 97;
const effective = H3E3.ducks
  .filter((d) => d.rm.length || d.add.length)
  .sort((a, b) => rankOf(a.sq) - rankOf(b.sq) || fileOf(a.sq) - fileOf(b.sq));
assertEq(
  'h3e3 effect table',
  effective
    .map((d) => `${d.sq} -${d.rm.length}${d.add.length ? `/+${d.add.length}` : ''}`)
    .join(', '),
  EXPECTED_H3E3,
);
assertEq('duck points after h3e3', H3E3.ducks.length, 58);
assertEq('h3e3 points that change black', effective.length, 30);
console.log('kernel counts match the article:', JSON.stringify(counts));

// ---------- shared drawing bits ----------
const DUCK = '#f2c230'; // the duck's own yellow, for 'a point the duck could land on'
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const THEMES = {
  light: {
    xiangqi: '#007f9e',
    rm: '#c8650f',
    add: '#6a32c9',
    none: '#b5b2ac',
    ink: 'hsl(40, 3%, 30%)',
    muted: 'hsl(40, 2%, 47%)',
    rule: 'hsl(40, 5%, 84%)',
  },
  dark: {
    xiangqi: '#2aa3c4',
    rm: '#d4731f',
    add: '#9a7ae8',
    none: '#5f5c57',
    ink: 'hsl(0, 0%, 73%)',
    muted: 'hsl(0, 0%, 58%)',
    rule: 'hsl(40, 4%, 25%)',
  },
};
const f1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (x, y, s, { size = 14, fill, weight = 400, anchor = 'start' } = {}) =>
  `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const svgDoc = (w, h, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${esc(FONT)}">${body}</svg>\n`;
// Many dots of one colour and size: one path of zero-length round-capped segments.
const dots = (pts, r, fill) =>
  pts.length
    ? `<path d="${pts.map(([x, y]) => `M${f1(x)} ${f1(y)}h0`).join('')}" stroke="${fill}" stroke-width="${f1(2 * r)}" stroke-linecap="round" fill="none"/>`
    : '';

// ---------- in-figure text ----------
const L = {
  en: {
    a: 'Xiangqi, red and black each move once',
    aN: '1,920 positions',
    b: 'Duck Xiangqi, red moves once',
    bN: '2,554 positions',
    c: 'Placements that change nothing, merged',
    cN: '1,310 left to search',
    d: 'The duck taken away',
    dN: '44 positions, as in xiangqi',
    kX: 'A xiangqi position',
    kNone: 'The duck changes nothing for black',
    kRm: 'The duck takes black replies away',
    kAdd: 'The duck gives black a new reply',
    boardHeadAll: 'After cannon h3 to e3, the duck can land on any of these 58 points',
    boardAll: 'A point the duck can land on. Each one is a different position.',
    boardHead: 'Only 30 of those 58 points change what black can play',
    cX1: 'Xiangqi, after red moves',
    cX2: 'Xiangqi, after red and black have both moved',
    cD1: 'Duck Xiangqi, after red moves and places the duck',
    cD2: 'Duck Xiangqi, counting placements that leave black the same replies once',
    boardRm: 'A duck here takes this many of black’s 45 replies away',
    boardAdd: 'The duck also screens a black cannon: one new reply',
    boardNone: 'A duck here changes nothing for black',
    yAxis: 'Legal moves at this ply (log scale)',
    xAxis: 'Ply',
    lineX: 'Xiangqi',
    lineD: 'Duck Xiangqi',
    legend: 'Line: median of 64 games. Band: the middle half of the games.',
    times: (n) => `about ${n}×`,
  },
  'zh-hans': {
    a: '象棋：红黑各走一步',
    aN: '1,920 个局面',
    b: '鸭子象棋：红方走一步',
    bN: '2,554 个局面',
    c: '同一步，合并毫无影响的落点',
    cN: '1,310 种不同局面',
    d: '同一步，去掉鸭子',
    dN: '44 个局面',
    kX: '一个象棋局面',
    kNone: '鸭子对黑方毫无影响',
    kRm: '鸭子减少黑方应着',
    kAdd: '鸭子给黑方新增应着',
    boardHead: '红方炮 h3 平 e3。没有鸭子时，黑方有 45 种应着。',
    boardRm: '鸭子落在此点时减少的黑方应着数',
    boardAdd: '鸭子同时给黑炮当炮架：新增一种应着',
    boardNone: '鸭子落在此点对黑方毫无影响',
    yAxis: '该半回合的合法着法数（对数刻度）',
    xAxis: '半回合',
    lineX: '象棋',
    lineD: '鸭子象棋',
    legend: '线：64 局的中位数。色带：中间一半的对局。',
    times: (n) => `约 ${n} 倍`,
  },
  'zh-hant': {
    a: '象棋：紅黑各走一步',
    aN: '1,920 個局面',
    b: '鴨子象棋：紅方走一步',
    bN: '2,554 個局面',
    c: '同一步，合併毫無影響的落點',
    cN: '1,310 種不同局面',
    d: '同一步，去掉鴨子',
    dN: '44 個局面',
    kX: '一個象棋局面',
    kNone: '鴨子對黑方毫無影響',
    kRm: '鴨子減少黑方應著',
    kAdd: '鴨子給黑方新增應著',
    boardHead: '紅方炮 h3 平 e3。沒有鴨子時，黑方有 45 種應著。',
    boardRm: '鴨子落在此點時減少的黑方應著數',
    boardAdd: '鴨子同時給黑炮當炮架：新增一種應著',
    boardNone: '鴨子落在此點對黑方毫無影響',
    yAxis: '該半回合的合法著法數（對數刻度）',
    xAxis: '半回合',
    lineX: '象棋',
    lineD: '鴨子象棋',
    legend: '線：64 局的中位數。色帶：中間一半的對局。',
    times: (n) => `約 ${n} 倍`,
  },
};

// ---------- figure 1: the trees ----------
// Radial layout: 44 red moves on a hub ring, each move's leaves stacked outward
// as a spoke three dots wide. Row spacing is the same in every panel, so a
// spoke's length is its count: the longest (59 duck squares) reaches the rim.
const SPOKE_COLS = 3;
const SPOKE_R0 = 0.48;
const SPOKE_DR = (0.98 - SPOKE_R0) / (Math.ceil(59 / SPOKE_COLS) - 1);
function fan(_n, sector, i) {
  const row = Math.floor(i / SPOKE_COLS);
  const c = i % SPOKE_COLS;
  const mid = (sector[0] + sector[1]) / 2;
  const a = mid + (c - (SPOKE_COLS - 1) / 2) * (sector[1] - sector[0]) * 0.25;
  const r = SPOKE_R0 + row * SPOKE_DR;
  return [Math.cos(a) * r, Math.sin(a) * r];
}
const sectorOf = (gi, n) => {
  const a0 = -Math.PI / 2 + (gi / n) * 2 * Math.PI;
  return [a0, a0 + (2 * Math.PI) / n];
};
function treeLayout(groups, leavesOf) {
  const hubs = [];
  const leaves = [];
  groups.forEach((g, gi) => {
    const sector = sectorOf(gi, groups.length);
    const mid = (sector[0] + sector[1]) / 2;
    hubs.push([Math.cos(mid) * 0.36, Math.sin(mid) * 0.36]);
    const ls = leavesOf(g);
    ls.forEach((leaf, i) => {
      leaves.push({ ...leaf, p: fan(ls.length, sector, i, 6, 0.5, 0.98) });
    });
  });
  return { hubs, leaves };
}
const effectOf = (d) => (d.add.length ? 'add' : d.rm.length ? 'rm' : 'none');

// One row of panels: ids picks from a (xiangqi), b (duck), c (merged), d (no duck).
function figureTrees(locale, theme, ids) {
  const t = L[locale];
  const c = THEMES[theme];
  const W = 1000;
  const GAP = 20;
  const PW = (W - GAP * (ids.length - 1)) / ids.length;
  const R = Math.min(205, PW / 2 - 12);
  const HEAD = 62;
  const PH = HEAD + 2 * R + 24;
  const LEG = 70;
  const H = PH + LEG;
  const base = 1.45 * Math.max(0.75, R / 205);

  const X = treeLayout(xiangqi, (g) => g.replies.map(() => ({})));
  // Within a wedge: no-effect placements first, then those that remove, then those that add.
  const ORDER = { none: 0, rm: 1, add: 2 };
  const D = treeLayout(duck, (g) =>
    g.ducks
      .map((d) => ({ e: effectOf(d), cls: d.cls }))
      .sort((a, b) => ORDER[a.e] - ORDER[b.e] || a.cls - b.cls),
  );
  // Merged: one dot per situation, area growing with the placements it stands for.
  const merged = [];
  duck.forEach((g, gi) => {
    const sector = sectorOf(gi, duck.length);
    const reps = new Map();
    for (const d of g.ducks) {
      const r = reps.get(d.cls) ?? { e: effectOf(d), size: 0 };
      r.size += 1;
      reps.set(d.cls, r);
    }
    for (const [cls, r] of reps)
      merged.push({ ...r, p: fan(g.classes, sector, cls, 4, 0.5, 0.98) });
  });

  const parts = [];
  const panel = (id, title, count, draw) => {
    const col = ids.indexOf(id);
    if (col === -1) return;
    const ox = col * (PW + GAP);
    const oy = 0;
    const cx = ox + PW / 2;
    const cy = oy + HEAD + R;
    parts.push(text(cx, oy + 24, title, { size: 17, weight: 600, fill: c.ink, anchor: 'middle' }));
    parts.push(text(cx, oy + 46, count, { size: 15, fill: c.muted, anchor: 'middle' }));
    const at = ([x, y]) => [cx + x * R, cy + y * R];
    draw(at, cx, cy);
  };
  const hubsAndRoot = (at, cx, cy, hubs, hubR = base * 1.8) => {
    parts.push(
      `<path d="${hubs
        .map((h) => {
          const [x, y] = at(h);
          return `M${f1(cx)} ${f1(cy)}L${f1(x)} ${f1(y)}`;
        })
        .join('')}" stroke="${c.rule}" stroke-width="1" fill="none"/>`,
    );
    parts.push(dots(hubs.map(at), hubR, c.ink));
    parts.push(dots([[cx, cy]], base * 3, c.ink));
  };
  const byColour = (leaves, colourOf, radiusOf = () => base) => {
    const groups = new Map();
    for (const l of leaves) {
      const k = `${colourOf(l)}|${f1(radiusOf(l))}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    // Draw larger dots first so small ones stay visible on top.
    const keys = [...groups.keys()].sort(
      (a, b) => Number(b.split('|')[1]) - Number(a.split('|')[1]),
    );
    return keys.map((k) => [k.split('|')[0], Number(k.split('|')[1]), groups.get(k)]);
  };

  panel('a', t.a, t.aN, (at, cx, cy) => {
    hubsAndRoot(at, cx, cy, X.hubs);
    parts.push(
      dots(
        X.leaves.map((l) => at(l.p)),
        base,
        c.xiangqi,
      ),
    );
  });
  panel('b', t.b, t.bN, (at, cx, cy) => {
    hubsAndRoot(at, cx, cy, D.hubs);
    for (const [colour, r, ls] of byColour(D.leaves, (l) => c[l.e]))
      parts.push(
        dots(
          ls.map((l) => at(l.p)),
          r,
          colour,
        ),
      );
  });
  panel('c', t.c, t.cN, (at, cx, cy) => {
    hubsAndRoot(at, cx, cy, D.hubs);
    for (const [colour, r, ls] of byColour(
      merged,
      (l) => c[l.e],
      (l) => base * (1 + (Math.sqrt(l.size) - 1) * 0.55),
    ))
      parts.push(
        dots(
          ls.map((l) => at(l.p)),
          r,
          colour,
        ),
      );
  });
  panel('d', t.d, t.dN, (at, cx, cy) => {
    hubsAndRoot(at, cx, cy, D.hubs, base * 2.6);
  });

  // Legend, two rows of two.
  const ly = PH + 22;
  const keys = [
    ...(ids.includes('a') ? [[c.xiangqi, t.kX]] : []),
    [c.none, t.kNone],
    [c.rm, t.kRm],
    [c.add, t.kAdd],
  ];
  keys.forEach(([colour, label], i) => {
    const x = 70 + (i % 2) * 470;
    const y = ly + Math.floor(i / 2) * 28;
    parts.push(dots([[x, y - 5]], 6, colour));
    parts.push(text(x + 16, y, label, { size: 15, fill: c.ink }));
  });
  return svgDoc(W, H, ids.map((id) => `${t[id]}: ${t[`${id}N`]}.`).join(' '), parts.join(''));
}

// ---------- figure 2: the board after h3e3 ----------
// mode 'all': every point the duck could land on. mode 'matter': which of them change black's replies.
function figureBoard(locale, theme, mode) {
  const t = L[locale];
  const c = THEMES[theme];
  const light = THEMES.light; // the board is wood in both themes
  const W = 640;
  const BH = 620;
  const top = 56;
  const pieces = Object.entries(H3E3.board).map(([sq, p]) => ({
    file: fileOf(sq),
    rank: rankOf(sq),
    color: p.color,
    role: p.role,
  }));
  const board = renderXiangqiOgBoardSvg({
    files: 9,
    ranks: 10,
    pieces,
    riverBetweenRanks: [5, 6],
    palaces: [
      { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
      { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
    ],
    centerX: W / 2,
    y: top,
    height: BH,
    lineWidth: 1.6,
  });
  const cell = BH / (9 + 1.16);
  const margin = 0.58 * cell;
  const bw = 2 * margin + 8 * cell;
  const bx = W / 2 - bw / 2;
  const px = (file) => bx + margin + file * cell;
  const py = (rank) => top + margin + (10 - rank) * cell;

  const parts = [];
  const head = mode === 'all' ? t.boardHeadAll : t.boardHead;
  parts.push(text(W / 2, 30, head, { size: 17, weight: 600, fill: c.ink, anchor: 'middle' }));
  parts.push(board);
  // Arrow h3 -> e3, stopping at the cannon's disc.
  const [ax, ay, ex] = [px(7), py(3), px(4) + cell * 0.5];
  parts.push(
    `<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(ex + 10)}" y2="${f1(ay)}" stroke="#2b2118" stroke-width="4" stroke-linecap="round" opacity="0.85"/>`,
    `<path d="M${f1(ex)} ${f1(ay)}l14 -9v18z" fill="#2b2118" opacity="0.85"/>`,
  );
  const occupied = new Set(Object.keys(H3E3.board));
  for (const d of H3E3.ducks) {
    if (occupied.has(d.sq)) continue;
    const x = px(fileOf(d.sq));
    const y = py(rankOf(d.sq));
    if (mode === 'all') {
      parts.push(
        `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(cell * 0.16)}" fill="${DUCK}" stroke="#2b2118" stroke-width="1.2"/>`,
      );
      continue;
    }
    if (!d.rm.length && !d.add.length) {
      parts.push(
        `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(cell * 0.09)}" fill="#8f8a80" opacity="0.75"/>`,
      );
      continue;
    }
    const r = cell * (0.17 + 0.033 * d.rm.length);
    parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${light.rm}"/>`);
    parts.push(
      text(x, y + 6, String(d.rm.length), {
        size: 17,
        weight: 700,
        fill: '#ffffff',
        anchor: 'middle',
      }),
    );
  }

  const ly = top + BH + 34;
  const row = (y, mark, label) => {
    parts.push(mark(40, y - 5));
    parts.push(text(68, y, label, { size: 15, fill: c.ink }));
  };
  if (mode === 'all') {
    row(
      ly,
      (x, y) =>
        `<circle cx="${x}" cy="${y}" r="9" fill="${DUCK}" stroke="#2b2118" stroke-width="1.2"/>`,
      t.boardAll,
    );
    return svgDoc(W, ly + 20, head, parts.join(''));
  }
  row(
    ly,
    (x, y) =>
      `<circle cx="${x}" cy="${y}" r="11" fill="${light.rm}"/>${text(x, y + 5, '4', { size: 13, weight: 700, fill: '#ffffff', anchor: 'middle' })}`,
    t.boardRm,
  );
  row(ly + 30, (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="#8f8a80"/>`, t.boardNone);
  return svgDoc(W, ly + 50, head, parts.join(''));
}

// ---------- figure: positions after the first moves ----------
function figureCounts(locale, theme) {
  const t = L[locale];
  const c = THEMES[theme];
  const W = 900;
  const L0 = 20;
  const BAR_W = 700;
  const max = 2600;
  const rows = [
    [t.cX1, counts.redMoves, c.xiangqi],
    [t.cX2, counts.xiangqiLeaves, c.xiangqi],
    [t.cD1, counts.duckLeaves, c.rm],
    [t.cD2, counts.classes, c.none],
  ];
  const parts = [];
  let y = 20;
  for (const [label, n, colour] of rows) {
    parts.push(text(L0, y + 16, label, { size: 15, fill: c.ink }));
    const w = Math.max(3, (n / max) * BAR_W);
    parts.push(
      `<rect x="${L0}" y="${y + 26}" width="${f1(w)}" height="22" rx="3" fill="${colour}"/>`,
    );
    parts.push(
      text(L0 + w + 10, y + 43, n.toLocaleString('en'), { size: 16, weight: 600, fill: c.ink }),
    );
    y += 68;
  }
  return svgDoc(W, y + 4, rows.map(([l, n]) => `${l}: ${n}`).join('. '), parts.join(''));
}

// ---------- figure 3: branching across whole games ----------
const series = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
function figureBranching(locale, theme) {
  const t = L[locale];
  const c = THEMES[theme];
  const W = 900;
  const H = 540;
  const m = { l: 78, r: 140, t: 60, b: 64 };
  const xMax = 240;
  const [yLo, yHi] = [5, 10000];
  const sx = (p) => m.l + (p / xMax) * (W - m.l - m.r);
  const sy = (v) =>
    m.t +
    (1 - (Math.log10(v) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo))) * (H - m.t - m.b);
  const parts = [];
  for (const v of [10, 100, 1000, 10000]) {
    parts.push(
      `<line x1="${m.l}" x2="${W - m.r}" y1="${f1(sy(v))}" y2="${f1(sy(v))}" stroke="${c.rule}" stroke-width="1"/>`,
    );
    parts.push(
      text(m.l - 10, sy(v) + 5, v.toLocaleString('en'), { size: 14, fill: c.muted, anchor: 'end' }),
    );
  }
  for (let p = 0; p <= xMax; p += 40) {
    parts.push(text(sx(p), H - m.b + 24, String(p), { size: 14, fill: c.muted, anchor: 'middle' }));
  }
  parts.push(
    `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${c.muted}" stroke-width="1"/>`,
  );
  parts.push(
    text((m.l + W - m.r) / 2, H - 12, t.xAxis, { size: 14, fill: c.muted, anchor: 'middle' }),
  );
  parts.push(
    `<text x="20" y="${f1((m.t + H - m.b) / 2)}" font-size="14" fill="${c.muted}" text-anchor="middle" transform="rotate(-90 20 ${f1((m.t + H - m.b) / 2)})">${esc(t.yAxis)}</text>`,
  );
  const draw = (rows, colour, label) => {
    const band = `M${rows.map(([p, lo]) => `${f1(sx(p))} ${f1(sy(Math.max(lo, yLo)))}`).join('L')}L${[
      ...rows,
    ]
      .reverse()
      .map(([p, , , hi]) => `${f1(sx(p))} ${f1(sy(Math.min(hi, yHi)))}`)
      .join('L')}Z`;
    parts.push(`<path d="${band}" fill="${colour}" opacity="0.18"/>`);
    parts.push(
      `<path d="M${rows.map(([p, , med]) => `${f1(sx(p))} ${f1(sy(med))}`).join('L')}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-linejoin="round"/>`,
    );
    const last = rows[rows.length - 1];
    parts.push(
      text(sx(last[0]) + 10, sy(last[2]) + 5, label, { size: 15, weight: 600, fill: colour }),
    );
  };
  draw(series.duck, c.rm, t.lineD);
  draw(series.xiangqi, c.xiangqi, t.lineX);
  // How many times wider a Duck Xiangqi turn is, early and late.
  const at = (rows, p) => rows.find((r) => r[0] === p)[2];
  for (const [p, n, lo, hi] of [
    [10, 50, 40, 60],
    [200, 100, 85, 115],
  ]) {
    const ratio = at(series.duck, p) / at(series.xiangqi, p);
    if (ratio < lo || ratio > hi)
      throw new Error(`ply ${p}: Duck Xiangqi is ${ratio.toFixed(1)}x, article says about ${n}x`);
    const y1 = sy(at(series.xiangqi, p));
    const y2 = sy(at(series.duck, p));
    parts.push(
      `<line x1="${f1(sx(p))}" x2="${f1(sx(p))}" y1="${f1(y1 - 8)}" y2="${f1(y2 + 8)}" stroke="${c.ink}" stroke-width="1.2" stroke-dasharray="3 3"/>`,
    );
    parts.push(
      text(sx(p) + 8, (y1 + y2) / 2 + 5, t.times(n), { size: 14, weight: 600, fill: c.ink }),
    );
  }
  parts.push(text(m.l, 30, t.legend, { size: 14, fill: c.muted }));
  return svgDoc(W, H, `${t.lineX} / ${t.lineD}. ${t.legend}`, parts.join(''));
}

// ---------- write ----------
const FIGS = {
  counts: figureCounts,
  'board-all': (l, th) => figureBoard(l, th, 'all'),
  board: (l, th) => figureBoard(l, th, 'matter'),
  branching: figureBranching,
};
// English only until the English is final; zh labels stay in L for then.
const LOCALES = ['en'];
for (const [name, fig] of Object.entries(FIGS)) {
  for (const locale of LOCALES) {
    for (const theme of ['light', 'dark']) {
      const file = `duck-tree-${name}${theme === 'dark' ? '-dark' : ''}${locale === 'en' ? '' : `.${locale}`}.svg`;
      const out = path.join(OUT_DIR, file);
      writeFileSync(out, fig(locale, theme));
      const kb = statSync(out).size / 1024;
      if (kb > 200) throw new Error(`${file} is ${kb.toFixed(0)} KB, over the 200 KB budget`);
      console.log(`${file} ${kb.toFixed(0)} KB`);
    }
  }
}
