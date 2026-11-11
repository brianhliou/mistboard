// Retrograde tables for small all-face-up banqi endings (the 兩子三 question:
// does chariot+horse+soldier beat chariot+horse, and how long does it take?).
//
//   npx tsx --import ./scripts/banqi-tablebase/css-stub.mjs \
//     scripts/banqi-tablebase/endgame-table.ts [--a RH] [--b RHS] [--check 2000]
//   ... --line '<fen>' [--html out.html]   also play out the optimal line from a
//   position by DTM (winner takes the fastest win, loser the slowest loss).
//   ... --export apps/web/public/tablebase/banqi   write every solved table in the
//   shipped format (packages/game/src/banqi-endgame-tablebase.ts), then read each
//   file back and check every slot and every position against the solver.
//
// --a / --b name each ink's pieces (R chariot, H horse, S soldier, A advisor,
// E elephant, G general; red is a, black is b; no cannons: a cannon's jump does
// not fit the one-step move generator below). Every sub-ending a capture can
// reach is solved first. Two metrics per table, both with no draw clock and no
// repetition rule (a standard tablebase):
//   DTM: plies to the win, the loser delaying.
//   DTZ: plies to the next capture (or stalemate) that keeps the win. A capture
//        resets the no-progress clock, so a win holds under an N-ply clock when
//        every phase of it has DTZ <= N.
// Moves and captures are checked against the kernel's getBanqiLegalMoves on
// --check random positions before anything is solved.

import {
  ALL_BANQI_SQUARES,
  BANQI_TABLEBASE_MATERIALS,
  BANQI_TABLEBASE_VERSION,
  type BanqiColor,
  type BanqiPieceRole,
  banqiCanCapture,
  banqiTablebaseKeyOf,
  banqiTablebasePieces,
  banqiTablebaseSlot,
  banqiTablebaseSlotCount,
  decodeBanqiTablebaseSlot,
  getBanqiLegalMoves,
  parseBanqiFen,
} from '@mistboard/game';

/** A FEN as kernel state; a FEN this script wrote and cannot read back is a bug. */
function loadPuzzle(fen: string) {
  const parsed = parseBanqiFen(fen);
  if (!parsed.ok) throw new Error(`unreadable FEN ${fen}: ${parsed.error}`);
  return parsed.state;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ROLE: Record<string, BanqiPieceRole> = {
  G: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  H: 'horse',
  S: 'soldier',
};
const FEN_LETTER: Record<BanqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

type Piece = { color: BanqiColor; role: BanqiPieceRole };
const parseSide = (s: string, color: BanqiColor): Piece[] =>
  [...s].map((c) => {
    if (!ROLE[c]) throw new Error(`unknown piece letter ${c}`);
    return { color, role: ROLE[c] };
  });
const A = parseSide(flag('a', 'RH'), 'red');
const B = parseSide(flag('b', 'RHS'), 'black');
const CHECK = Number(flag('check', '2000'));

const W = 8;
const SQ = 32;
const NEIGH: number[][] = Array.from({ length: SQ }, (_, i) => {
  const f = i % W;
  const r = Math.floor(i / W);
  const out: number[] = [];
  if (f > 0) out.push(i - 1);
  if (f < W - 1) out.push(i + 1);
  if (r > 0) out.push(i - W);
  if (r < 3) out.push(i + W);
  return out;
});

// ── Tables ──────────────────────────────────────────────────────────────────
// A table is one material set: pieces in a fixed order (all of a, then all of
// b), index = stm * 32^k + sum(square_i * 32^i), stm 0 = red to move.
// value: 0 draw / unknown, +d win in d plies, -(d+1) loss in d plies.

type Table = { key: string; pieces: Piece[]; dtm: Int16Array; dtz: Int16Array };
const tables = new Map<string, Table>();
const keyOf = (pieces: Piece[]) => pieces.map((p) => `${p.color[0]}${FEN_LETTER[p.role]}`).join('');

const isWin = (v: number) => v > 0;
const isLoss = (v: number) => v < 0;
const dist = (v: number) => (v > 0 ? v : -v - 1);

class Bucket {
  lists: Int32Array[] = [];
  lens: number[] = [];
  push(level: number, idx: number) {
    while (this.lists.length <= level) {
      this.lists.push(new Int32Array(1024));
      this.lens.push(0);
    }
    if (this.lens[level] === this.lists[level].length) {
      const bigger = new Int32Array(this.lists[level].length * 2);
      bigger.set(this.lists[level]);
      this.lists[level] = bigger;
    }
    this.lists[level][this.lens[level]++] = idx;
  }
}

function decode(idx: number, k: number, sq: number[]): number {
  let rest = idx;
  for (let i = 0; i < k; i++) {
    sq[i] = rest % SQ;
    rest = Math.floor(rest / SQ);
  }
  return rest; // stm
}
const encode = (sq: number[], k: number, stm: number) => {
  let idx = stm;
  for (let i = k - 1; i >= 0; i--) idx = idx * SQ + sq[i];
  return idx;
};

function solve(pieces: Piece[]): Table {
  const key = keyOf(pieces);
  const known = tables.get(key);
  if (known) return known;
  const k = pieces.length;
  // Sub-tables for each capture, solved first.
  const subs: (Table | null)[] = pieces.map((_, i) => {
    const rest = pieces.filter((__, j) => j !== i);
    const bothInks = rest.some((p) => p.color === 'red') && rest.some((p) => p.color === 'black');
    return bothInks ? solve(rest) : null;
  });
  const per = SQ ** k;
  const size = per * 2;
  const color = pieces.map((p) => (p.color === 'red' ? 0 : 1));
  const canTake = pieces.map((p) =>
    pieces.map((q) => p.color !== q.color && banqiCanCapture(p.role, q.role)),
  );

  const table: Table = { key, pieces, dtm: new Int16Array(size), dtz: new Int16Array(size) };
  for (const metric of ['dtm', 'dtz'] as const) {
    const value = table[metric];
    const count = new Uint8Array(size);
    const exitMax = new Int16Array(size); // largest DTM/DTZ among exits that win for the opponent
    const flags = new Uint8Array(size); // 1 valid, 2 has a drawn exit, 4 determined, 8 processed, 16 capture win pending
    const bucket = new Bucket();
    const sq = new Array<number>(k);
    const sub = new Array<number>(k);
    const occ = new Int8Array(SQ);

    for (let idx = 0; idx < size; idx++) {
      const stm = decode(idx, k, sq);
      occ.fill(-1);
      let valid = true;
      for (let i = 0; i < k; i++) {
        if (occ[sq[i]] >= 0) {
          valid = false;
          break;
        }
        occ[sq[i]] = i;
      }
      if (!valid) continue;
      flags[idx] = 1;
      let quiet = 0;
      let bestWin = -1;
      let drawExit = false;
      let worst = 0;
      let anyMove = false;
      for (let i = 0; i < k; i++) {
        if (color[i] !== stm) continue;
        for (const to of NEIGH[sq[i]]) {
          const j = occ[to];
          if (j < 0) {
            quiet += 1;
            anyMove = true;
          } else if (canTake[i][j]) {
            anyMove = true;
            // Capture: piece j leaves; opponent to move in the sub-ending.
            const subT = subs[j];
            let child: number; // value for the opponent
            if (!subT)
              child = -1; // opponent has no piece left: loss in 0
            else {
              let n = 0;
              for (let m = 0; m < k; m++) if (m !== j) sub[n++] = m === i ? to : sq[m];
              child = subT[metric][encode(sub, k - 1, 1 - stm)];
            }
            if (isLoss(child)) {
              const d = metric === 'dtm' ? dist(child) + 1 : 1;
              if (bestWin < 0 || d < bestWin) bestWin = d;
            } else if (isWin(child)) {
              const d = metric === 'dtm' ? dist(child) + 1 : 1;
              if (d > worst) worst = d;
            } else drawExit = true;
          }
        }
      }
      if (!anyMove) {
        value[idx] = -1; // stalemate: loss in 0
        flags[idx] |= 4;
        bucket.push(0, idx);
        continue;
      }
      count[idx] = quiet;
      exitMax[idx] = worst;
      if (drawExit) flags[idx] |= 2;
      if (bestWin > 0) {
        // Won through a capture; a quiet move may still win faster, but no defence
        // count may ever run this position down to a loss.
        value[idx] = bestWin;
        flags[idx] |= 16;
        bucket.push(bestWin, idx);
      } else if (quiet === 0 && !drawExit) {
        value[idx] = -(worst + 1);
        flags[idx] |= 4;
        bucket.push(worst, idx);
      }
    }

    for (let level = 0; level < bucket.lists.length; level++) {
      // Seeded wins were pushed with no value; finalize them at their level.
      for (let n = 0; n < bucket.lens[level]; n++) {
        const idx = bucket.lists[level][n];
        if (flags[idx] & 16 && value[idx] === level) flags[idx] = (flags[idx] | 4) & ~16;
        if (flags[idx] & 8) continue; // pushed twice (a seed and an in-table win)
        if (value[idx] !== level && !(isLoss(value[idx]) && dist(value[idx]) === level)) continue;
        flags[idx] |= 8;
        // Unmoves: the side NOT to move here made a quiet step into its square.
        const stm = decode(idx, k, sq);
        const prev = 1 - stm;
        occ.fill(-1);
        for (let i = 0; i < k; i++) occ[sq[i]] = i;
        const v = value[idx];
        for (let i = 0; i < k; i++) {
          if (color[i] !== prev) continue;
          const here = sq[i];
          for (const from of NEIGH[here]) {
            if (occ[from] >= 0) continue;
            sq[i] = from;
            const p = encode(sq, k, prev);
            sq[i] = here;
            if (flags[p] & 4) continue;
            if (isLoss(v)) {
              if (flags[p] & 16 && value[p] <= level + 1) continue; // the capture is as fast
              value[p] = level + 1;
              flags[p] = (flags[p] | 4) & ~16;
              bucket.push(level + 1, p);
            } else {
              if (flags[p] & 16) continue; // already won by a capture
              count[p] -= 1;
              if (count[p] === 0 && !(flags[p] & 2)) {
                const d = Math.max(level + 1, exitMax[p]); // exitMax already counts the capture ply
                value[p] = -(d + 1);
                flags[p] |= 4;
                bucket.push(d, p);
              }
            }
          }
        }
      }
    }
    for (let idx = 0; idx < size; idx++) if (!(flags[idx] & 1)) value[idx] = 0;
  }
  tables.set(key, table);
  return table;
}

// ── Kernel cross-check ──────────────────────────────────────────────────────

function fenOf(pieces: Piece[], sq: number[], stm: number): string {
  const cell = new Array<string>(SQ).fill('');
  pieces.forEach((p, i) => {
    const l = FEN_LETTER[p.role];
    cell[sq[i]] = p.color === 'red' ? l : l.toLowerCase();
  });
  const rows: string[] = [];
  for (let r = 3; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < W; f++) {
      const c = cell[r * W + f];
      if (!c) empty += 1;
      else {
        if (empty) row += empty;
        empty = 0;
        row += c;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${stm === 0 ? 'r' : 'b'} - 0 1`;
}

function crossCheck(pieces: Piece[], n: number) {
  const k = pieces.length;
  let rng = 12345;
  const rand = (m: number) => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng % m;
  };
  if (ALL_BANQI_SQUARES[9] !== 'b2')
    throw new Error(`square order changed: index 9 is ${ALL_BANQI_SQUARES[9]}`);
  for (let t = 0; t < n; t++) {
    const used = new Set<number>();
    const sq: number[] = [];
    while (sq.length < k) {
      const s = rand(SQ);
      if (!used.has(s)) {
        used.add(s);
        sq.push(s);
      }
    }
    const stm = rand(2);
    const mine = new Set<string>();
    pieces.forEach((p, i) => {
      if ((p.color === 'red' ? 0 : 1) !== stm) return;
      for (const to of NEIGH[sq[i]]) {
        const j = sq.indexOf(to);
        if (j < 0 || (pieces[j].color !== p.color && banqiCanCapture(p.role, pieces[j].role)))
          mine.add(`${ALL_BANQI_SQUARES[sq[i]]}-${ALL_BANQI_SQUARES[to]}`);
      }
    });
    const state = loadPuzzle(fenOf(pieces, sq, stm));
    const kernel = new Set(getBanqiLegalMoves(state).map((m) => `${m.from}-${m.to}`));
    const same = mine.size === kernel.size && [...mine].every((m) => kernel.has(m));
    if (!same)
      throw new Error(
        `move mismatch at ${fenOf(pieces, sq, stm)}: ours ${[...mine].sort()} kernel ${[...kernel].sort()}`,
      );
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

const pieces = [...A, ...B];
crossCheck(pieces, CHECK);
const started = Date.now();
const top = solve(pieces);
const k = pieces.length;
const per = SQ ** k;
const sq = new Array<number>(k);

function report(t: Table) {
  const kk = t.pieces.length;
  const out: Record<string, unknown> = { table: t.key };
  for (const stm of [0, 1]) {
    let win = 0;
    let loss = 0;
    let draw = 0;
    let valid = 0;
    let maxDtm = 0;
    let maxDtmIdx = -1;
    let maxDtz = 0;
    let maxDtzIdx = -1;
    const winsOver = { 40: 0, 60: 0, 120: 0 };
    const base = stm * SQ ** kk;
    for (let i = 0; i < SQ ** kk; i++) {
      const idx = base + i;
      decode(idx, kk, sq);
      let dup = false;
      for (let a = 0; a < kk && !dup; a++)
        for (let b = a + 1; b < kk; b++) if (sq[a] === sq[b]) dup = true;
      if (dup) continue;
      valid += 1;
      const m = t.dtm[idx];
      const z = t.dtz[idx];
      if (isWin(m)) {
        win += 1;
        if (m > maxDtm) {
          maxDtm = m;
          maxDtmIdx = idx;
        }
      } else if (isLoss(m)) loss += 1;
      else draw += 1;
      if (isWin(z)) {
        if (z > maxDtz) {
          maxDtz = z;
          maxDtzIdx = idx;
        }
        for (const lim of [40, 60, 120] as const) if (z > lim) winsOver[lim] += 1;
      }
    }
    const fen = (idx: number) => {
      if (idx < 0) return null;
      const s = decode(idx, kk, sq);
      return fenOf(t.pieces, sq.slice(0, kk), s);
    };
    out[stm === 0 ? 'redToMove' : 'blackToMove'] = {
      valid,
      win,
      loss,
      draw,
      maxDtm,
      maxDtmFen: fen(maxDtmIdx),
      maxDtz,
      maxDtzFen: fen(maxDtzIdx),
      winsNeedingMoreThan: winsOver,
    };
  }
  return out;
}

// Every position's stored value must be the minimax of its children's, in both
// metrics; this is the check that caught a capture win being marked lost.
function consistency(t: Table, samples: number) {
  const k = t.pieces.length;
  const sq = new Array<number>(k);
  const sub = new Array<number>(k);
  let rng = 987654321;
  let bad = 0;
  for (let n = 0; n < samples; n++) {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const idx = rng % t.dtm.length;
    const stm = decode(idx, k, sq);
    if (new Set(sq).size < k) continue;
    for (const metric of ['dtm', 'dtz'] as const) {
      let win = Infinity;
      let draw = false;
      let worst = 0;
      let any = false;
      for (let i = 0; i < k; i++) {
        if ((t.pieces[i].color === 'red' ? 0 : 1) !== stm) continue;
        for (const to of NEIGH[sq[i]]) {
          const j = sq.indexOf(to);
          if (
            j >= 0 &&
            (t.pieces[j].color === t.pieces[i].color ||
              !banqiCanCapture(t.pieces[i].role, t.pieces[j].role))
          )
            continue;
          any = true;
          let child: number;
          if (j < 0) {
            const was = sq[i];
            sq[i] = to;
            child = t[metric][encode(sq, k, 1 - stm)];
            sq[i] = was;
          } else {
            const rest = t.pieces.filter((_, m) => m !== j);
            const subT = tables.get(keyOf(rest));
            let c = 0;
            for (let m = 0; m < k; m++) if (m !== j) sub[c++] = m === i ? to : sq[m];
            child = subT ? subT[metric][encode(sub, k - 1, 1 - stm)] : -1;
          }
          const d = metric === 'dtz' && j >= 0 ? 1 : dist(child) + 1;
          if (isLoss(child)) win = Math.min(win, d);
          else if (isWin(child)) worst = Math.max(worst, d);
          else draw = true;
        }
      }
      const want = !any ? -1 : win < Infinity ? win : draw ? 0 : -(worst + 1);
      if (t[metric][idx] !== want) {
        if (bad < 3)
          console.error(
            `${t.key} ${metric} ${fenOf(t.pieces, sq, stm)}: stored ${t[metric][idx]}, children say ${want}`,
          );
        bad += 1;
      }
    }
  }
  return bad;
}
// An independent solve for small tables: sweep every undetermined position per
// level, straight from the move rules, with no retrograde bookkeeping.
function naive(t: Table, metric: 'dtm' | 'dtz') {
  const k = t.pieces.length;
  const out = new Int16Array(t.dtm.length);
  const done = new Uint8Array(t.dtm.length);
  const sq = new Array<number>(k);
  const sub = new Array<number>(k);
  let open: number[] = [];
  for (let idx = 0; idx < out.length; idx++) {
    decode(idx, k, sq);
    if (new Set(sq).size === k) open.push(idx);
  }
  let empty = 0;
  for (let level = 0; empty < 80 && open.length; level++) {
    const set: [number, number][] = [];
    const rest: number[] = [];
    for (const idx of open) {
      const stm = decode(idx, k, sq);
      let any = false;
      let winAt = Infinity;
      let allWin = true;
      let worst = 0;
      for (let i = 0; i < k; i++) {
        if ((t.pieces[i].color === 'red' ? 0 : 1) !== stm) continue;
        for (const to of NEIGH[sq[i]]) {
          const j = sq.indexOf(to);
          if (
            j >= 0 &&
            (t.pieces[j].color === t.pieces[i].color ||
              !banqiCanCapture(t.pieces[i].role, t.pieces[j].role))
          )
            continue;
          any = true;
          let child: number;
          let known: boolean;
          if (j < 0) {
            const was = sq[i];
            sq[i] = to;
            const ci = encode(sq, k, 1 - stm);
            sq[i] = was;
            known = done[ci] === 1;
            child = out[ci];
          } else {
            const subT = tables.get(keyOf(t.pieces.filter((_, m) => m !== j)));
            let c = 0;
            for (let m = 0; m < k; m++) if (m !== j) sub[c++] = m === i ? to : sq[m];
            child = subT ? subT[metric][encode(sub, k - 1, 1 - stm)] : -1;
            known = child !== 0;
          }
          const d = metric === 'dtz' && j >= 0 ? 1 : dist(child) + 1;
          if (known && isLoss(child)) winAt = Math.min(winAt, d);
          else if (known && isWin(child)) worst = Math.max(worst, d);
          else allWin = false;
        }
      }
      if (!any && level === 0) set.push([idx, -1]);
      else if (winAt === level) set.push([idx, level]);
      else if (any && winAt === Infinity && allWin && worst === level)
        set.push([idx, -(level + 1)]);
      else rest.push(idx);
    }
    for (const [idx, v] of set) {
      out[idx] = v;
      done[idx] = 1;
    }
    empty = set.length ? 0 : empty + 1;
    open = rest;
  }
  let bad = 0;
  for (let idx = 0; idx < out.length; idx++) if (out[idx] !== t[metric][idx]) bad += 1;
  return bad;
}
if (flag('naive', '0') !== '0')
  for (const t of tables.values())
    if (t.pieces.length <= Number(flag('naive', '0')))
      console.error(`naive ${t.key}: dtm ${naive(t, 'dtm')} differ, dtz ${naive(t, 'dtz')} differ`);
for (const t of tables.values()) {
  const bad = consistency(t, Number(flag('verify', '200000')));
  if (bad) console.error(`${t.key}: ${bad} inconsistent samples`);
}

// The two metrics rank the same wins differently but must agree on who wins.
for (const t of tables.values()) {
  let bad = 0;
  let first = -1;
  for (let i = 0; i < t.dtm.length; i++)
    if (Math.sign(t.dtm[i]) !== Math.sign(t.dtz[i])) {
      bad += 1;
      if (first < 0) first = i;
    }
  if (bad)
    console.error(
      `${t.key}: ${bad} positions where dtm and dtz disagree, e.g. idx ${first} dtm ${t.dtm[first]} dtz ${t.dtz[first]}`,
    );
}
const EXPORT = flag('export', '');
if (EXPORT) await exportTables(EXPORT);
else if (!flag('line', '')) for (const t of tables.values()) console.log(JSON.stringify(report(t)));
const LINE = flag('line', '');
if (LINE) await playLine(LINE, flag('html', ''));

// ── Export ──────────────────────────────────────────────────────────────────
// One gzip file per material: DTM bytes then DTZ bytes, one signed byte per
// slot of the shared index. Every slot is read back from the written file and
// compared with the solver (that checks the bytes), then every solver position,
// in all four mirrors, is looked up through banqiTablebaseSlot and compared
// (that checks the symmetry the index relies on).
async function exportTables(dir: string) {
  const { gzipSync, gunzipSync } = await import('node:zlib');
  const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const outDir = join(dir, BANQI_TABLEBASE_VERSION);
  mkdirSync(outDir, { recursive: true });
  const written = new Set<string>();
  let rawTotal = 0;
  let gzTotal = 0;
  const LIMIT = 15 * 1024 * 1024;
  // Largest first, so the size question is answered before the small ones.
  for (const t of [...tables.values()].sort((a, b) => b.pieces.length - a.pieces.length)) {
    const key = banqiTablebaseKeyOf(t.pieces);
    const canon = banqiTablebasePieces(key);
    const k = canon.length;
    // perm[c] = where canonical piece c sits in the solver's order.
    const perm = canon.map((c) =>
      t.pieces.findIndex((p) => p.color === c.color && p.role === c.role),
    );
    if (new Set(perm).size !== k || perm.includes(-1))
      throw new Error(`${t.key}: cannot map to ${key}`);
    const slots = banqiTablebaseSlotCount(k);
    const bytes = new Int8Array(2 * slots);
    const solverSq = new Array<number>(k);
    const solverIdx = (slot: number): number => {
      const { squares, stm } = decodeBanqiTablebaseSlot(slot, k);
      if (new Set(squares).size < k) return -1;
      for (let c = 0; c < k; c++) solverSq[perm[c]] = squares[c];
      return encode(solverSq, k, stm);
    };
    for (let slot = 0; slot < slots; slot++) {
      const idx = solverIdx(slot);
      if (idx < 0) continue;
      for (const [offset, v] of [
        [0, t.dtm[idx]],
        [slots, t.dtz[idx]],
      ] as const) {
        if (v > 127 || v < -128) throw new Error(`${key}: value ${v} does not fit a signed byte`);
        bytes[offset + slot] = v;
      }
    }
    const raw = new Uint8Array(bytes.buffer);
    const gz = gzipSync(raw, { level: 9 });
    const path = join(outDir, `${key}.bin.gz`);
    writeFileSync(path, gz);
    written.add(key);
    rawTotal += raw.length;
    gzTotal += gz.length;

    // Check 1: every slot of the file as written.
    const unzipped = gunzipSync(readFileSync(path));
    const back = new Int8Array(unzipped.buffer, unzipped.byteOffset, unzipped.byteLength);
    if (back.length !== 2 * slots)
      throw new Error(`${key}: read back ${back.length} bytes, want ${2 * slots}`);
    let slotChecks = 0;
    for (let slot = 0; slot < slots; slot++) {
      const idx = solverIdx(slot);
      const wantM = idx < 0 ? 0 : t.dtm[idx];
      const wantZ = idx < 0 ? 0 : t.dtz[idx];
      if (back[slot] !== wantM || back[slots + slot] !== wantZ)
        throw new Error(
          `${key} slot ${slot}: file ${back[slot]}/${back[slots + slot]}, solver ${wantM}/${wantZ}`,
        );
      slotChecks += 2;
    }
    // Check 2: every solver position (every mirror) through the shared index.
    let positionChecks = 0;
    const sqAll = new Array<number>(k);
    const canonSq = new Array<number>(k);
    for (let idx = 0; idx < t.dtm.length; idx++) {
      const stm = decode(idx, k, sqAll) as 0 | 1;
      if (new Set(sqAll).size < k) continue;
      for (let c = 0; c < k; c++) canonSq[c] = sqAll[perm[c]];
      const slot = banqiTablebaseSlot(canonSq, stm);
      if (back[slot] !== t.dtm[idx] || back[slots + slot] !== t.dtz[idx])
        throw new Error(
          `${key}: ${fenOf(t.pieces, sqAll, stm)} reads ${back[slot]}/${back[slots + slot]}, solver ${t.dtm[idx]}/${t.dtz[idx]}`,
        );
      positionChecks += 1;
    }
    console.log(
      JSON.stringify({
        key,
        pieces: k,
        slots,
        rawBytes: raw.length,
        gzBytes: gz.length,
        slotChecks,
        positionChecks,
      }),
    );
    if (gzTotal > LIMIT)
      throw new Error(
        `compressed total ${gzTotal} bytes passed the 15 MB budget at ${key}; stopping`,
      );
  }
  const shipped = new Set(BANQI_TABLEBASE_MATERIALS);
  const missing = [...shipped].filter((key) => !written.has(key));
  const extra = [...written].filter((key) => !shipped.has(key));
  if (missing.length || extra.length)
    throw new Error(`BANQI_TABLEBASE_MATERIALS out of step: missing ${missing}, unlisted ${extra}`);
  console.log(
    JSON.stringify({ files: written.size, rawBytes: rawTotal, gzBytes: gzTotal, dir: outDir }),
  );
}

type Alt = { move: string; dtm: number; dtz: number }; // values from the mover's side, table encoding
type Step = {
  fen: string;
  move: string | null;
  mover: BanqiColor | null;
  dtm: number;
  dtz: number;
  alts: Alt[];
};

async function playLine(fen: string, html: string) {
  // Position from FEN, matched to a table by its material.
  const state0 = loadPuzzle(fen);
  let live: { sq: number; piece: Piece }[] = [];
  ALL_BANQI_SQUARES.forEach((name, i) => {
    const p = state0.board[name];
    if (p) live.push({ sq: i, piece: { color: p.color as BanqiColor, role: p.role } });
  });
  let stm = fen.split(' ')[1] === 'r' ? 0 : 1;
  const order = (ps: Piece[]) => [...ps].sort((x, y) => keyOf([x]).localeCompare(keyOf([y])));
  const lookup = () => {
    const ps = order(
      [
        ...live.filter((l) => l.piece.color === 'red'),
        ...live.filter((l) => l.piece.color === 'black'),
      ].map((l) => l.piece),
    );
    // Tables keep a-pieces then b-pieces in --a/--b order; rebuild that order.
    const want = [...A, ...B].filter((p) => ps.some((q) => q === p || keyOf([q]) === keyOf([p])));
    void want;
    const reds = live.filter((l) => l.piece.color === 'red');
    const blacks = live.filter((l) => l.piece.color === 'black');
    const seq = [
      ...A.map((p) => reds.find((l) => l.piece.role === p.role)),
      ...B.map((p) => blacks.find((l) => l.piece.role === p.role)),
    ].filter((l): l is { sq: number; piece: Piece } => !!l);
    const t = tables.get(keyOf(seq.map((l) => l.piece)));
    if (!t) return null;
    return {
      t,
      seq,
      idx: encode(
        seq.map((l) => l.sq),
        seq.length,
        stm,
      ),
    };
  };
  // Every legal move from the current position, valued for the side making it.
  // A child lost in d means a win in d+1; a capture restarts the clock, so its
  // DTZ is 1 whatever follows.
  const flipV = (child: number, zeroing: boolean, metric: 'dtm' | 'dtz') =>
    isLoss(child)
      ? metric === 'dtz' && zeroing
        ? 1
        : dist(child) + 1
      : isWin(child)
        ? -(dist(child) + 1) - 1
        : 0;
  const children = () => {
    const color: BanqiColor = stm === 0 ? 'red' : 'black';
    const out: (Alt & { from: number; to: number })[] = [];
    for (const me of live.filter((l) => l.piece.color === color)) {
      for (const to of NEIGH[me.sq]) {
        const there = live.find((l) => l.sq === to);
        if (
          there &&
          (there.piece.color === color || !banqiCanCapture(me.piece.role, there.piece.role))
        )
          continue;
        const saved = live;
        live = live
          .filter((l) => l !== there)
          .map((l) => (l === me ? { sq: to, piece: l.piece } : l));
        stm = 1 - stm;
        const C = lookup();
        const cm = C ? C.t.dtm[C.idx] : -1; // no table: the opponent has nothing left
        const cz = C ? C.t.dtz[C.idx] : -1;
        stm = 1 - stm;
        live = saved;
        const move = `${ALL_BANQI_SQUARES[me.sq]}${there ? 'x' : '-'}${ALL_BANQI_SQUARES[to]}`;
        out.push({
          move,
          from: me.sq,
          to,
          dtm: flipV(cm, !!there, 'dtm'),
          dtz: flipV(cz, !!there, 'dtz'),
        });
      }
    }
    return out;
  };
  const steps: Step[] = [];
  const at = (move: string | null, mover: BanqiColor | null) => {
    const L = lookup();
    const seqP = live.map((l) => l.piece);
    const alts = L ? children().map(({ move, dtm, dtz }) => ({ move, dtm, dtz })) : [];
    steps.push({
      fen: fenOf(
        seqP,
        live.map((l) => l.sq),
        stm,
      ),
      move,
      mover,
      dtm: L ? L.t.dtm[L.idx] : 0,
      dtz: L ? L.t.dtz[L.idx] : 0,
      alts,
    });
  };
  at(null, null);
  for (let ply = 0; ply < 400; ply++) {
    const L = lookup();
    if (!L) break; // one ink is gone
    const v = L.t.dtm[L.idx];
    if (v === 0 || v === -1) break; // draw, or stalemate (loss in 0)
    let best: { from: number; to: number; score: number } | null = null;
    for (const c of children()) {
      // Winner: fastest win. Loser: slowest loss.
      const score = isWin(v)
        ? isWin(c.dtm)
          ? -dist(c.dtm)
          : -1e9
        : isLoss(c.dtm)
          ? dist(c.dtm)
          : -1e9;
      if (!best || score > best.score) best = { from: c.from, to: c.to, score };
    }
    if (!best) break;
    const me = live.find((l) => l.sq === best.from);
    const there = live.find((l) => l.sq === best.to);
    const move = `${ALL_BANQI_SQUARES[best.from]}${there ? 'x' : '-'}${ALL_BANQI_SQUARES[best.to]}`;
    live = live
      .filter((l) => l !== there)
      .map((l) => (l === me ? { sq: best.to, piece: l.piece } : l));
    stm = 1 - stm;
    at(move, stm === 0 ? 'black' : 'red');
  }
  const plies = steps.length - 1;
  console.log(
    JSON.stringify({
      start: fen,
      startDtm: steps[0].dtm,
      startDtz: steps[0].dtz,
      plies,
      moves: steps.slice(1).map((s) => s.move),
    }),
  );
  if (!html) return;
  const { getBanqiPlayerView } = await import('@mistboard/game');
  const { BANQI_BOARD_CSS, renderBanqiBoardSvg } = await import(
    '../../apps/web/src/live-banqi-render.js'
  );
  const { DEFAULT_XIANGQI_PIECE_SET } = await import('../../apps/web/src/xiangqi-piece-sets.js');
  const { writeFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const root = `file://${resolve(import.meta.dirname, '../../apps/web/public/piece-sets')}`;
  const frames = steps.map((s) => {
    const st = loadPuzzle(s.fen);
    const view = getBanqiPlayerView(st, 'first');
    const arrows = s.move
      ? [
          {
            from: s.move.slice(0, 2),
            to: s.move.slice(3),
            color: '#1f6f5b',
            opacity: 0.88,
            width: 9,
          },
        ]
      : [];
    return renderBanqiBoardSvg(view, view.perspective, {
      pieceSet: DEFAULT_XIANGQI_PIECE_SET,
      coordinates: true,
      arrows: arrows as never,
    })
      .trim()
      .replace('<svg ', '<svg width="100%" style="height:auto;display:block" ')
      .replaceAll('href="/piece-sets/', `href="${root}/`);
  });
  const label = (s: Step, i: number) =>
    i === 0 ? 'Start' : `${i}. ${s.mover === 'red' ? 'Red' : 'Black'} ${s.move}`;
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Banqi longest win</title>
<style>${BANQI_BOARD_CSS}
body{font:15px system-ui;margin:16px;max-width:980px;background:#faf8f3;color:#222}
.wrap{display:flex;gap:16px;flex-wrap:wrap}.board{flex:1 1 520px;max-width:620px}
.side{flex:1 1 260px}.moves{height:420px;overflow:auto;border:1px solid #ddd;background:#fff;padding:6px}
.moves div{cursor:pointer;padding:1px 4px}.moves div.on{background:#1f6f5b;color:#fff}
table.alts{border-collapse:collapse;margin:6px 0;width:100%}.alts td{padding:2px 6px;border-bottom:1px solid #eee}
.alts tr.played td{font-weight:700;background:#e7f2ee}.w{color:#1f6f5b}.l{color:#a33}.dr{color:#777}
button{font-size:15px;padding:4px 12px;margin-right:6px}</style></head><body>
<h2>Chariot + horse vs chariot + horse + soldier: the longest forced win</h2>
<p>Black (chariot, horse, soldier) to move wins in ${plies} plies against the longest defence. Checked: every 3- and 4-piece sub-ending matches an independent solver exactly; 1M sampled positions of this table are consistent with their moves. Start ${fen}. Line chosen from the tablebase: the winner takes the fastest win, the loser the slowest loss. No draw clock, no repetition rule.</p>
<div class="wrap"><div class="board" id="b"></div><div class="side">
<p><button id="p">Back</button><button id="n">Forward</button> <span id="c"></span></p>
<p id="d"></p><p id="sum"></p><table class="alts" id="alts"></table><div class="moves" id="m"></div><p>Arrow keys step. "Next capture" is how many plies the winner needs to reach a capture that keeps the win: our draw clock ends the game at 40 plies without one.</p></div></div>
<script>
const F=${JSON.stringify(frames)};const S=${JSON.stringify(steps.map((s, i) => ({ l: label(s, i), dtm: s.dtm, dtz: s.dtz, alts: s.alts, next: steps[i + 1]?.move ?? null })))};
const res=(a)=>a.dtm>0?['w','wins in '+a.dtm]:a.dtm<0?['l','loses in '+(-a.dtm-1)]:['dr','draw'];
function altsHtml(s){if(!s.alts.length)return '';const w=s.dtm>0;
const rows=[...s.alts].sort((a,b)=>(b.dtm>0)-(a.dtm>0)||(a.dtm>0?a.dtm-b.dtm:0)||(a.dtm<0&&b.dtm<0?a.dtm-b.dtm:0)||(a.dtm===0)-(b.dtm===0));
return '<tr><td>Move</td><td>Result</td>'+(w?'<td>Next capture</td>':'')+'</tr>'+rows.map(a=>{const [c,t]=res(a);
return '<tr class="'+(a.move===s.next?'played':'')+'"><td>'+a.move+(a.move===s.next?' (line)':'')+'</td><td class="'+c+'">'+t+'</td>'+(w?'<td>'+(a.dtz>0?a.dtz:'')+'</td>':'')+'</tr>'}).join('')}
function summary(s){if(!s.alts.length)return '';const n=s.alts.length;
if(s.dtm>0){const k=s.alts.filter(a=>a.dtm>0).length,best=s.alts.filter(a=>a.dtm===s.dtm).length;
return k+' of '+n+' moves keep the win; '+best+' '+(best===1?'is':'are')+' the fastest. Within 40 plies of the next capture: '+s.alts.filter(a=>a.dtz>0&&a.dtz<=40).length+'.'}
if(s.dtm<0){const d=s.alts.filter(a=>a.dtm===0).length;return d?d+' of '+n+' moves draw.':'Every move loses; the line takes the slowest.'}return ''}
let i=0;const m=document.getElementById('m');
S.forEach((s,k)=>{const d=document.createElement('div');d.textContent=s.l;d.onclick=()=>go(k);m.appendChild(d)});
function go(k){i=Math.max(0,Math.min(F.length-1,k));document.getElementById('b').innerHTML=F[i];
document.getElementById('c').textContent='ply '+i+' of '+(F.length-1);
const v=S[i].dtm;document.getElementById('d').textContent=v>0?'Side to move wins in '+v+' plies (next capture needed within '+S[i].dtz+')':v<0?'Side to move loses in '+(-v-1)+' plies':'Game over';
document.getElementById('sum').textContent=summary(S[i]);document.getElementById('alts').innerHTML=altsHtml(S[i]);
[...m.children].forEach((c,k)=>c.className=k===i?'on':'');m.children[i].scrollIntoView({block:'nearest'})}
document.getElementById('p').onclick=()=>go(i-1);document.getElementById('n').onclick=()=>go(i+1);
document.onkeydown=e=>{if(e.key==='ArrowLeft')go(i-1);if(e.key==='ArrowRight')go(i+1)};go(0);
</script></body></html>`;
  writeFileSync(html, page);
  console.error(`wrote ${html}`);
}
console.error(
  `solved ${tables.size} tables in ${((Date.now() - started) / 1000).toFixed(1)} s; top ${top.key}, ${per * 2} entries`,
);
