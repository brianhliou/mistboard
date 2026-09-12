// Anti xiangqi: the figures for the write-up, drawn from the data on disk so a
// corrected number redraws the picture.
//
//   npx tsx scripts/variant-lab/anti-xiangqi-figures.ts --sweep <exits-100k.json> --proofs <proofs.json> --out <dir>
//
// Writes SVGs: opening-branches, dump-strip, surviving-position, dead-position,
// exits-by-depth, cascade-tree. Every position is produced by the rule kernel.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleState,
} from '../../packages/game/src/xiangqi-rule-kernel.js';
import { parseRuleArgs, resolveRules } from './lab/rules.js';
import { antiXiangqiKernelConfig, antiXiangqiVariant } from './lab/variants/anti-xiangqi.js';

// ── Palette (light, fixed: these SVGs travel as images) ────────────────────
const C = {
  board: '#e7cc9f',
  line: '#7a5230',
  river: '#8c6a45',
  red: '#b5342c',
  black: '#2a2724',
  face: '#f8eed8',
  faceEdge: '#c9b58f',
  last: '#d9a441',
  gold: '#c9931f',
  draw: '#8a8375',
  ink: '#24201a',
  muted: '#6f6659',
  paper: '#f4efe6',
  palace: 'rgba(122,82,48,0.10)',
};
const CJK = '"Noto Serif SC","Songti SC","SimSun",serif';
const SANS = '"Source Sans 3","Helvetica Neue",Arial,sans-serif';
const MONO = '"JetBrains Mono",Menlo,monospace';
const GLYPH: Record<'red' | 'black', Record<string, string>> = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '傌',
    chariot: '俥',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};

const FILES = 'abcdefghi';
const U = 60;
const OX = 40;
const OY = 40;
const BW = 560;
const BH = 620;

function xy(square: string): [number, number] {
  const f = FILES.indexOf(square[0]!);
  const r = Number(square.slice(1));
  return [OX + f * U, OY + (10 - r) * U];
}

type BoardOptions = {
  lastMove?: { from: string; to: string; capture: boolean };
  shadeConfinement?: boolean;
  caption?: string;
  /** Extra SVG placed inside the board group. */
  extra?: string;
};

/** One board as an SVG fragment at origin; `state` supplies the pieces. */
function boardFragment(state: XiangqiRuleState, options: BoardOptions = {}): string {
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${BW}" height="${BH}" rx="8" fill="${C.board}"/>`);
  if (options.shadeConfinement) {
    // Palaces and the two halves: where the confined pieces live.
    parts.push(
      `<rect x="${OX + 3 * U}" y="${OY}" width="${2 * U}" height="${2 * U}" fill="${C.palace}"/>`,
    );
    parts.push(
      `<rect x="${OX + 3 * U}" y="${OY + 7 * U}" width="${2 * U}" height="${2 * U}" fill="${C.palace}"/>`,
    );
  }
  const g: string[] = [];
  for (let r = 0; r < 10; r += 1)
    g.push(`<line x1="${OX}" y1="${OY + r * U}" x2="${OX + 8 * U}" y2="${OY + r * U}"/>`);
  for (let f = 0; f < 9; f += 1) {
    if (f === 0 || f === 8)
      g.push(`<line x1="${OX + f * U}" y1="${OY}" x2="${OX + f * U}" y2="${OY + 9 * U}"/>`);
    else {
      g.push(`<line x1="${OX + f * U}" y1="${OY}" x2="${OX + f * U}" y2="${OY + 4 * U}"/>`);
      g.push(`<line x1="${OX + f * U}" y1="${OY + 5 * U}" x2="${OX + f * U}" y2="${OY + 9 * U}"/>`);
    }
  }
  for (const [x0, y0] of [
    [3, 0],
    [3, 7],
  ]) {
    g.push(
      `<line x1="${OX + x0 * U}" y1="${OY + y0 * U}" x2="${OX + (x0 + 2) * U}" y2="${OY + (y0 + 2) * U}"/>`,
    );
    g.push(
      `<line x1="${OX + (x0 + 2) * U}" y1="${OY + y0 * U}" x2="${OX + x0 * U}" y2="${OY + (y0 + 2) * U}"/>`,
    );
  }
  parts.push(`<g stroke="${C.line}" stroke-width="1.6" fill="none">${g.join('')}</g>`);
  parts.push(
    `<rect x="0.5" y="0.5" width="${BW - 1}" height="${BH - 1}" rx="8" stroke="${C.line}" stroke-width="3" fill="none"/>`,
  );
  parts.push(
    `<text x="${OX + 4 * U}" y="${OY + 4.5 * U + 9}" text-anchor="middle" fill="${C.river}" font-size="24" letter-spacing="18" font-family='${CJK}'>楚河　　漢界</text>`,
  );
  for (let f = 0; f < 9; f += 1)
    parts.push(
      `<text x="${OX + f * U}" y="${OY + 9 * U + 30}" text-anchor="middle" fill="${C.river}" font-size="13" font-family='${MONO}'>${FILES[f]}</text>`,
    );
  for (let r = 1; r <= 10; r += 1)
    parts.push(
      `<text x="${OX + 8 * U + 24}" y="${OY + (10 - r) * U + 5}" text-anchor="middle" fill="${C.river}" font-size="13" font-family='${MONO}'>${r}</text>`,
    );
  if (options.lastMove) {
    const [fx, fy] = xy(options.lastMove.from);
    const [tx, ty] = xy(options.lastMove.to);
    parts.push(`<circle cx="${fx}" cy="${fy}" r="9" fill="${C.last}" opacity="0.9"/>`);
    parts.push(
      `<circle cx="${tx}" cy="${ty}" r="30" fill="none" stroke="${C.last}" stroke-width="4"/>`,
    );
    if (options.lastMove.capture)
      parts.push(
        `<circle cx="${tx}" cy="${ty}" r="34" fill="none" stroke="${C.red}" stroke-width="2" stroke-dasharray="4 4"/>`,
      );
  }
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    const [x, y] = xy(square);
    const color = piece.color === 'red' ? C.red : C.black;
    parts.push(
      `<g transform="translate(${x} ${y})"><circle r="25" fill="${C.face}" stroke="${C.faceEdge}" stroke-width="1.5"/><circle r="21" fill="none" stroke="${color}" stroke-width="2"/><text text-anchor="middle" y="9" font-size="26" font-weight="700" fill="${color}" font-family='${CJK}'>${GLYPH[piece.color][piece.role]}</text></g>`,
    );
  }
  if (options.extra) parts.push(options.extra);
  return parts.join('');
}

function svg(width: number, height: number, body: string, background = C.paper): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family='${SANS}'><rect width="${width}" height="${height}" fill="${background}"/>${body}</svg>\n`;
}

function label(
  x: number,
  y: number,
  text: string,
  opts: { size?: number; anchor?: string; fill?: string; weight?: number; family?: string } = {},
): string {
  return `<text x="${x}" y="${y}" text-anchor="${opts.anchor ?? 'start'}" font-size="${opts.size ?? 15}" fill="${opts.fill ?? C.ink}" font-weight="${opts.weight ?? 400}" font-family='${opts.family ?? SANS}'>${text}</text>`;
}

// ── Data ───────────────────────────────────────────────────────────────────

type Row = {
  leaf: number;
  exitPly: number;
  opening: string;
  winner: 'red' | 'black' | null;
  reason: string;
  afterExit: number;
};
type Outcome = {
  leaf: number;
  opening: string;
  attacker: string;
  result: string;
  proofSize?: number;
  line?: string[];
};

const DECISIVE = new Set([
  'extinction',
  'stalemate',
  'checkmate',
  'bare-general',
  'general-lost',
  'general-captured',
]);
const MIRROR: Record<string, string> = {
  a: 'i',
  b: 'h',
  c: 'g',
  d: 'f',
  e: 'e',
  f: 'd',
  g: 'c',
  h: 'b',
  i: 'a',
};
const mirror = (line: string) => line.replace(/[a-i]/g, (c) => MIRROR[c]!);

function main() {
  const { values } = parseArgs({
    options: {
      sweep: { type: 'string' },
      proofs: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.sweep || !values.proofs || !values.out)
    throw new Error('--sweep --proofs --out are required');
  mkdirSync(values.out, { recursive: true });
  const sweep = JSON.parse(readFileSync(values.sweep, 'utf8')) as { nodes: number; rows: Row[] };
  const proofs = JSON.parse(readFileSync(values.proofs, 'utf8')) as { outcomes: Outcome[] };
  const kernel = createXiangqiRuleKernel(
    antiXiangqiKernelConfig(resolveRules(antiXiangqiVariant.ruleSchema, parseRuleArgs([]))),
  );

  // Exit value under stock rules, keyed by the b3b10-half opening line.
  const value = new Map<string, 'red' | 'black' | 'draw'>();
  for (const r of sweep.rows)
    value.set(r.opening, DECISIVE.has(r.reason) ? (r.winner as 'red' | 'black') : 'draw');
  const proven = new Set(
    proofs.outcomes.filter((o) => o.result === 'proven').map((o) => o.opening),
  );
  const exitValue = (line: string[]): 'red' | 'black' | 'draw' => {
    const key = line.join(' ');
    return value.get(key) ?? value.get(mirror(key)) ?? 'draw';
  };
  const isProven = (line: string[]) =>
    proven.has(line.join(' ')) || proven.has(mirror(line.join(' ')));

  const replay = (moves: string[]): XiangqiRuleState => {
    let s = kernel.initial('fig');
    for (const m of moves) {
      const mv = kernel.fromUci(s, m);
      if (!mv) throw new Error(`bad move ${m}`);
      s = kernel.apply(s, mv);
    }
    return s;
  };
  const san = (before: XiangqiRuleState, m: string) => {
    const mv = kernel.fromUci(before, m)!;
    const piece = before.board[mv.from]!;
    const code = {
      general: 'K',
      advisor: 'A',
      elephant: 'B',
      horse: 'N',
      chariot: 'R',
      cannon: 'C',
      soldier: 'P',
    }[piece.role];
    return `${code}${mv.from}${before.board[mv.to] ? 'x' : '-'}${mv.to}`;
  };

  // ── Figure 1: the first three plies as branches ──────────────────────────
  {
    const W = 1000;
    const H = 480;
    const BOXW = 260;
    const b: string[] = [];
    type Tone = 'red' | 'black' | 'draw' | 'plain';
    const strokeOf = (tone: Tone) =>
      tone === 'red' ? C.red : tone === 'black' ? C.black : tone === 'draw' ? C.gold : C.muted;
    const node = (x: number, y: number, text: string, sub: string, tone: Tone) => {
      b.push(
        `<rect x="${x - BOXW / 2}" y="${y - 26}" width="${BOXW}" height="52" rx="8" fill="#fff" stroke="${strokeOf(tone)}" stroke-width="${tone === 'plain' ? 1.5 : 3}"/>`,
      );
      b.push(label(x, y - 4, text, { anchor: 'middle', size: 17, weight: 600, family: MONO }));
      b.push(label(x, y + 16, sub, { anchor: 'middle', size: 13, fill: C.muted }));
    };
    const edge = (x1: number, y1: number, x2: number, y2: number, tone: Tone) => {
      b.push(
        `<line x1="${x1}" y1="${y1 + 26}" x2="${x2}" y2="${y2 - 26}" stroke="${strokeOf(tone)}" stroke-width="${tone === 'draw' ? 4 : 1.5}"/>`,
      );
    };
    const recapture = ['b3b10', 'a10b10', 'h3h10', 'i10h10'];
    const v = exitValue(recapture);
    const tone: Tone = v === 'draw' ? 'draw' : v;
    node(500, 60, '1. Cb3xb10', 'two mirror-image first moves', 'plain');
    node(
      250,
      190,
      '1...Ra10xb10',
      v === 'red'
        ? `the natural recapture: Red wins in 34${isProven(recapture) ? ', proven' : ''}`
        : `the natural recapture: ${v}`,
      tone,
    );
    node(730, 190, '1...Ch8xh1', 'the only move', 'draw');
    edge(500, 60, 250, 190, tone);
    edge(500, 60, 730, 190, 'draw');
    node(540, 320, '2. Cb10xd10', 'also fine for Red; Black must then find Ke10xd10', 'draw');
    node(860, 320, '2. Ri1xh1', 'ends the exchange', 'draw');
    edge(730, 190, 540, 320, 'draw');
    edge(730, 190, 860, 320, 'draw');
    node(860, 420, '2...Ra10xb10', 'forced; the cascade is over, material equal', 'draw');
    edge(860, 320, 860, 420, 'draw');
    node(420, 420, '2...Ch1xf1', 'the greedy capture: Red wins (engine)', 'red');
    node(660, 420, '2...Ke10xd10', 'holds; 3. Ri1xh1 and it is over', 'draw');
    edge(540, 320, 420, 420, 'red');
    edge(540, 320, 660, 420, 'draw');
    b.push(
      label(
        20,
        H - 10,
        'Gold: the moves that hold. A red box is a loss for Black, who has both of the decisions; Red cannot go wrong.',
        { size: 13, fill: C.muted },
      ),
    );
    writeFileSync(join(values.out, 'opening-branches.svg'), svg(W, H, b.join('')));
  }

  // ── Figure 2: a forced dump as a strip ───────────────────────────────────
  {
    const opening = ['b3b10', 'a10b10', 'h3h10', 'i10h10'];
    const proof = proofs.outcomes.find(
      (o) => o.opening === opening.join(' ') && o.result === 'proven',
    );
    if (!proof?.line) throw new Error('no proof line for the chariot-recapture exit');
    const line = [...opening, ...proof.line];
    const stops = [4, 12, 20, 28, line.length];
    const scale = 0.5;
    const gap = 30;
    const W = stops.length * (BW * scale + gap) + gap;
    const H = BH * scale + 110;
    const b: string[] = [];
    stops.forEach((ply, i) => {
      const state = replay(line.slice(0, ply));
      const before = replay(line.slice(0, ply - 1));
      const last = kernel.fromUci(before, line[ply - 1]!)!;
      const x = gap + i * (BW * scale + gap);
      b.push(
        `<g transform="translate(${x} 70) scale(${scale})">${boardFragment(state, { lastMove: { from: last.from, to: last.to, capture: before.board[last.to] !== undefined } })}</g>`,
      );
      const redCount = Object.values(state.board).filter((p) => p?.color === 'red').length;
      const blackCount = Object.values(state.board).filter((p) => p?.color === 'black').length;
      b.push(
        label(x + (BW * scale) / 2, 40, `ply ${ply}`, { anchor: 'middle', size: 18, weight: 600 }),
      );
      b.push(
        label(
          x + (BW * scale) / 2,
          60,
          `${san(before, line[ply - 1]!)}   Red ${redCount}, Black ${blackCount}`,
          { anchor: 'middle', size: 13, fill: C.muted, family: MONO },
        ),
      );
    });
    b.push(
      label(
        gap,
        H - 14,
        `After 1. Cb3xb10 Ra10xb10 2. Ch3xh10 Ri10xh10, Red gives every piece away and Black must take each one: a proof tree of ${proof.proofSize} nodes, ${line.length} plies.`,
        { size: 14, fill: C.muted },
      ),
    );
    writeFileSync(join(values.out, 'dump-strip.svg'), svg(W, H, b.join('')));
  }

  // ── Figure 3: the surviving position ─────────────────────────────────────
  {
    const line = ['b3b10', 'h8h1', 'i1h1', 'a10b10'];
    const state = replay(line);
    const before = replay(line.slice(0, 3));
    const body = `<g transform="translate(20 20)">${boardFragment(state, { lastMove: { from: 'a10', to: 'b10', capture: before.board.b10 !== undefined } })}</g>${label(20 + BW / 2, BH + 52, '1. Cb3xb10 Ch8xh1 2. Ri1xh1 Ra10xb10', { anchor: 'middle', size: 15, family: MONO })}${label(20 + BW / 2, BH + 74, 'The only position both sides can reach without a losing choice.', { anchor: 'middle', size: 14, fill: C.muted })}`;
    writeFileSync(join(values.out, 'surviving-position.svg'), svg(BW + 40, BH + 96, body));
  }

  // ── Figure 4: the dead position ──────────────────────────────────────────
  {
    const state = kernel.parseFen('4ka3/4a4/4b4/9/9/9/9/9/4A4/4K4 w - - 0 1', 'dead')!;
    const body = `<g transform="translate(20 20)">${boardFragment(state, { shadeConfinement: true })}</g>${label(20 + BW / 2, BH + 52, 'Generals and advisors never leave the palace; elephants never cross the river.', { anchor: 'middle', size: 14, fill: C.muted })}${label(20 + BW / 2, BH + 74, 'Nothing here can ever capture anything.', { anchor: 'middle', size: 14, fill: C.muted })}`;
    writeFileSync(join(values.out, 'dead-position.svg'), svg(BW + 40, BH + 96, body));
  }

  // ── Figure 5: exits by depth, coloured by who wins ───────────────────────
  {
    const byDepth = new Map<number, { red: number; black: number; draw: number }>();
    for (const r of sweep.rows) {
      const d = byDepth.get(r.exitPly) ?? { red: 0, black: 0, draw: 0 };
      d[value.get(r.opening)!] += 1;
      byDepth.set(r.exitPly, d);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    const W = 760;
    const H = 360;
    const left = 60;
    const bottom = H - 60;
    const maxN = Math.max(
      ...depths.map((d) => {
        const v = byDepth.get(d)!;
        return v.red + v.black + v.draw;
      }),
    );
    const scaleY = (bottom - 50) / maxN;
    const bw = (W - left - 30) / depths.length;
    const b: string[] = [];
    for (let n = 0; n <= maxN; n += 6) {
      const y = bottom - n * scaleY;
      b.push(
        `<line x1="${left}" y1="${y}" x2="${W - 20}" y2="${y}" stroke="#ddd3c1" stroke-width="1"/>`,
      );
      b.push(
        label(left - 8, y + 4, String(n), { anchor: 'end', size: 12, fill: C.muted, family: MONO }),
      );
    }
    depths.forEach((d, i) => {
      const v = byDepth.get(d)!;
      const x = left + i * bw + bw * 0.15;
      let y = bottom;
      for (const [k, color] of [
        ['red', C.red],
        ['black', C.black],
        ['draw', C.gold],
      ] as const) {
        const h = v[k] * scaleY;
        if (h > 0)
          b.push(`<rect x="${x}" y="${y - h}" width="${bw * 0.7}" height="${h}" fill="${color}"/>`);
        y -= h;
      }
      b.push(
        label(x + bw * 0.35, bottom + 18, String(d), { anchor: 'middle', size: 13, family: MONO }),
      );
      b.push(
        label(x + bw * 0.35, bottom + 34, d % 2 === 0 ? 'Red' : 'Black', {
          anchor: 'middle',
          size: 11,
          fill: C.muted,
        }),
      );
    });
    b.push(
      label(
        left,
        28,
        `Exits of the cascade by depth (83 distinct), coloured by who wins from there at ${sweep.nodes / 1000}k nodes a move`,
        { size: 15, weight: 600 },
      ),
    );
    b.push(
      label(
        left,
        H - 8,
        'Under each depth: who has the first free move there. Red: Red wins; black: Black wins; gold: a stall, a draw as written.',
        { size: 12, fill: C.muted },
      ),
    );
    writeFileSync(join(values.out, 'exits-by-depth.svg'), svg(W, H, b.join('')));
  }

  // ── Figure 6: the whole cascade as a tree ────────────────────────────────
  {
    type TNode = { line: string[]; depth: number; children: TNode[]; x: number; leaf: boolean };
    const build = (state: XiangqiRuleState, line: string[]): TNode => {
      const captures = kernel.legalMoves(state).filter((m) => state.board[m.to] !== undefined);
      const node: TNode = {
        line,
        depth: line.length,
        children: [],
        x: 0,
        leaf: captures.length === 0,
      };
      for (const m of captures)
        node.children.push(build(kernel.apply(state, m), [...line, `${m.from}${m.to}`]));
      return node;
    };
    const root = build(kernel.initial('tree'), []);
    let nextX = 0;
    const place = (n: TNode) => {
      if (n.children.length === 0) {
        n.x = nextX;
        nextX += 1;
        return;
      }
      for (const c of n.children) place(c);
      n.x = n.children.reduce((a, c) => a + c.x, 0) / n.children.length;
    };
    place(root);
    const leaves = nextX;
    const W = 1400;
    const H = 640;
    const left = 40;
    const right = 90;
    const top = 40;
    const sx = (W - left - right) / (leaves - 1);
    const sy = (H - top - 70) / 18;
    const px = (n: TNode) => left + n.x * sx;
    const py = (n: TNode) => top + n.depth * sy;
    const surviving = new Set([
      'b3b10 h8h1 i1h1 a10b10',
      'b3b10 h8h1 b10d10 e10d10 i1h1',
      mirror('b3b10 h8h1 i1h1 a10b10'),
      mirror('b3b10 h8h1 b10d10 e10d10 i1h1'),
    ]);
    const onSurviving = (n: TNode) =>
      [...surviving].some((s) => s === n.line.join(' ') || s.startsWith(`${n.line.join(' ')} `));
    const edges: string[] = [];
    const dots: string[] = [];
    const walk = (n: TNode) => {
      for (const c of n.children) {
        const gold =
          onSurviving(c) && n.line.length > 0 ? true : onSurviving(c) && n.line.length === 0;
        edges.push(
          `<line x1="${px(n)}" y1="${py(n)}" x2="${px(c)}" y2="${py(c)}" stroke="${gold ? C.gold : '#c7b99f'}" stroke-width="${gold ? 3 : 1}"/>`,
        );
        walk(c);
      }
      if (n.leaf) {
        const v = exitValue(n.line);
        const fill = v === 'red' ? C.red : v === 'black' ? C.black : C.gold;
        const r = isProven(n.line) ? 4.5 : 3;
        dots.push(
          `<circle cx="${px(n)}" cy="${py(n)}" r="${r}" fill="${fill}"${isProven(n.line) ? '' : ' opacity="0.55"'}/>`,
        );
      } else if (n.line.length > 0) {
        dots.push(`<circle cx="${px(n)}" cy="${py(n)}" r="1.8" fill="${C.muted}"/>`);
      }
    };
    walk(root);
    const b: string[] = [];
    b.push(...edges, ...dots);
    for (let d = 4; d <= 18; d += 2)
      b.push(
        label(W - 8, top + d * sy + 4, `ply ${d}`, {
          anchor: 'end',
          size: 11,
          fill: C.muted,
          family: MONO,
        }),
      );
    b.push(
      label(
        left,
        22,
        'The opening cascade: 166 exits. Red dot: Red wins from there; black: Black wins; gold: a stall. Large dots are proven; the gold paths are the two lines that survive.',
        { size: 14, weight: 600 },
      ),
    );
    writeFileSync(join(values.out, 'cascade-tree.svg'), svg(W, H, b.join('')));
  }
  console.log(`figures written to ${values.out}`);
}

main();
