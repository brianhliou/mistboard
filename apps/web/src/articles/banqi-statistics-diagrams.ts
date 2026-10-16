// Figures for the banqi statistics article. Two are charts over the 200-game
// MistyBanqi self-play run (seeds 1000-1199, ten million nodes a move, reduced
// by scripts/banqi-games-stats.ts); two are boards from the exhibit game in
// content/banqi-statistics-game.ts, replayed through the real kernel so they
// cannot drift from the position they claim to show.
//
// The numbers below are transcribed from that run's output and are the same
// numbers the prose quotes. They live here as literals because the 200 game
// files are not in the repo; the test beside this file checks that each figure
// still sums to the sample it claims.
import {
  banqiBackPieces,
  BANQI_BOARD_H,
  BANQI_BOARD_W,
  BANQI_CELL,
  BANQI_MARGIN,
  banqiBoardGrid,
  banqiPiecesFromView,
  banqiReplayViewAt,
  xqSvg,
} from './diagrams.js';
import { BANQI_STATS_GAME, BANQI_STATS_GAME_DECIDING_PLY } from './content/banqi-statistics-game.js';

const TITLE_H = 28;
const FULL_W = 568;

/**
 * Leader's win rate by how big the lead is, at four points in the game.
 * Material is counted on MistyBanqi's own evaluation values (general 30,
 * chariot 14, cannon 12, advisor and elephant 10, horse 8, soldier 4), from
 * misty-banqi/banqi_rust/src/engine.rs. Games level on material at the
 * checkpoint are not in any column: 16 at move 10, 6 at move 20, 2 at move 30,
 * 3 at move 40.
 */
export const LEAD_SAFETY = {
  buckets: ['1-9', '10-19', '20-39', '40+'],
  rows: [
    {
      move: 10,
      cells: [
        { pct: 52, n: 33 },
        { pct: 67, n: 51 },
        { pct: 81, n: 52 },
        { pct: 89, n: 18 },
      ],
    },
    {
      move: 20,
      cells: [
        { pct: 52, n: 33 },
        { pct: 69, n: 39 },
        { pct: 87, n: 55 },
        { pct: 95, n: 37 },
      ],
    },
    {
      move: 30,
      cells: [
        { pct: 59, n: 37 },
        { pct: 81, n: 27 },
        { pct: 89, n: 46 },
        { pct: 100, n: 56 },
      ],
    },
    {
      move: 40,
      cells: [
        { pct: 59, n: 27 },
        { pct: 81, n: 31 },
        { pct: 90, n: 42 },
        { pct: 98, n: 62 },
      ],
    },
  ],
} as const;

/** Where in the game the material lead changed hands for the last time. */
export const LEAD_SETTLE = {
  labels: ['1-5', '6-10', '11-15', '16-20', '21-25', '26-30', '31-35', '36-40', '41-45', '46+'],
  counts: [43, 21, 18, 7, 10, 10, 8, 12, 3, 36],
  median: 16,
} as const;

function heatFill(pct: number): string {
  // One hue, opacity carrying the rate: readable in every board theme, and it
  // keeps the eye on the column where the numbers stop moving.
  const alpha = 0.1 + (Math.max(pct - 40, 0) / 60) * 0.75;
  return `rgba(21, 120, 91, ${alpha.toFixed(2)})`;
}

export const BANQI_LEAD_SAFETY_GRID = () => {
  const colW = 108;
  const rowH = 56;
  const labelW = 136;
  const headH = 52;
  const width = labelW + colW * LEAD_SAFETY.buckets.length;
  const height = TITLE_H + headH + rowH * LEAD_SAFETY.rows.length;
  const parts: string[] = [
    `<text x="${width / 2}" y="14" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title">HOW OFTEN THE MATERIAL LEADER WINS</text>`,
    // The columns are meaningless without their unit, and the unit is the
    // engine's own point scale, so it gets said here and not only in the caption.
    `<text x="${labelW + (colW * LEAD_SAFETY.buckets.length) / 2}" y="${TITLE_H + 14}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">size of the lead, in points</text>`,
  ];
  LEAD_SAFETY.buckets.forEach((bucket, i) => {
    const x = labelW + i * colW + colW / 2;
    parts.push(
      `<text x="${x}" y="${TITLE_H + 38}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title">${bucket}</text>`,
    );
  });
  LEAD_SAFETY.rows.forEach((row, r) => {
    const y = TITLE_H + headH + r * rowH;
    parts.push(
      `<text x="${labelW - 12}" y="${y + rowH / 2 + 4}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" class="xq-diagram-outside-text">after move ${row.move}</text>`,
    );
    row.cells.forEach((cell, c) => {
      const x = labelW + c * colW;
      parts.push(
        `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" rx="6" fill="${heatFill(cell.pct)}"/>`,
        `<text x="${x + colW / 2}" y="${y + rowH / 2}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17" font-weight="700" class="xq-diagram-title">${cell.pct}%</text>`,
        `<text x="${x + colW / 2}" y="${y + rowH / 2 + 15}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" class="xq-diagram-outside-text">n=${cell.n}</text>`,
      );
    });
  });
  return xqSvg(width, height, parts.join(''));
};

export const BANQI_LEAD_SETTLE_CHART = () => {
  const chartH = 150;
  const axisY = TITLE_H + chartH;
  const barW = 44;
  const gap = 10;
  const left = 34;
  const width = FULL_W;
  const height = axisY + 40;
  const max = Math.max(...LEAD_SETTLE.counts);
  const parts: string[] = [
    `<text x="${width / 2}" y="14" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title">WHEN THE WINNER TOOK THE LEAD FOR GOOD</text>`,
    `<line x1="${left - 8}" y1="${axisY}" x2="${width - 8}" y2="${axisY}" class="xq-diagram-line" stroke-width="1"/>`,
    `<text x="14" y="${TITLE_H + 40}" text-anchor="middle" transform="rotate(-90 14 ${TITLE_H + 40})" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">games</text>`,
  ];
  LEAD_SETTLE.counts.forEach((count, i) => {
    const x = left + i * (barW + gap);
    const h = Math.round((count / max) * (chartH - 18));
    parts.push(
      `<rect x="${x}" y="${axisY - h}" width="${barW}" height="${h}" rx="3" fill="rgba(21, 120, 91, 0.75)"/>`,
      `<text x="${x + barW / 2}" y="${axisY - h - 5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="600" class="xq-diagram-title">${count}</text>`,
      `<text x="${x + barW / 2}" y="${axisY + 15}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" class="xq-diagram-outside-text">${LEAD_SETTLE.labels[i]}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${axisY + 33}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">move the lead last changed hands</text>`,
  );
  return xqSvg(width, height, parts.join(''));
};

// The live board's last-move marks, in the diagram's own geometry: the square
// moved from tinted lightly, the square moved to tinted harder, both in the ink
// of the side that acted. Same fills as live-banqi-render.ts, so a reader who
// has played a game here recognises the mark instead of learning a new one.
const LAST_MOVE_FILL: Record<'red' | 'black', { from: string; to: string }> = {
  red: { from: 'rgba(194, 32, 26, 0.19)', to: 'rgba(194, 32, 26, 0.36)' },
  black: { from: 'rgba(22, 40, 58, 0.22)', to: 'rgba(22, 40, 58, 0.44)' },
};

function squareRect(square: string, fill: string): string {
  // Square ids are file letter + rank digit; the grid draws rank 4 on top.
  const col = square.charCodeAt(0) - 97;
  const row = 4 - Number(square[1]);
  const x = BANQI_MARGIN + col * BANQI_CELL;
  const y = TITLE_H + BANQI_MARGIN + row * BANQI_CELL;
  return `<rect x="${x}" y="${y}" width="${BANQI_CELL}" height="${BANQI_CELL}" fill="${fill}"/>`;
}

function exhibitBoard(ply: number, title: string, mover: 'red' | 'black'): () => string {
  return () => {
    const view = banqiReplayViewAt(BANQI_STATS_GAME.deal, BANQI_STATS_GAME.moves, ply);
    const parts = [
      `<text x="${BANQI_BOARD_W / 2}" y="14" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title">${title}</text>`,
      banqiBoardGrid(0, TITLE_H),
    ];
    const last = view.lastMove;
    if (last) {
      const fill = LAST_MOVE_FILL[mover];
      parts.push(squareRect(last.from, fill.from));
      if (last.to !== last.from) parts.push(squareRect(last.to, fill.to));
    }
    parts.push(banqiPiecesFromView(view, 0, TITLE_H));
    return xqSvg(BANQI_BOARD_W, BANQI_BOARD_H + TITLE_H, parts.join(''));
  };
}

// Ply 24 is black's b3-b4, taking a soldier; ply 25 is red's d3-c3, taking the
// general it just saw flipped.
export const BANQI_STATS_BEFORE = exhibitBoard(
  BANQI_STATS_GAME_DECIDING_PLY - 1,
  'MOVE 12: BLACK LEADS BY 4',
  'black',
);
export const BANQI_STATS_AFTER = exhibitBoard(
  BANQI_STATS_GAME_DECIDING_PLY,
  'MOVE 13: THE SOLDIER TAKES THE GENERAL',
  'red',
);

// Card thumbnail: the position every banqi game starts from, all thirty-two
// tiles face down. On an index of board cards the card's job is to be
// recognisable at 140px rather than to argue the finding, and the share card
// (apps/server/src/og-image.ts) already carries the numbers. Distinguishable
// from the MistyBanqi card, which is the same board thirty plies in with
// pieces revealed.
export const BANQI_STATS_THUMBNAIL = () =>
  xqSvg(BANQI_BOARD_W, BANQI_BOARD_H, [banqiBoardGrid(0, 0), banqiBackPieces(0, 0)].join(''));
