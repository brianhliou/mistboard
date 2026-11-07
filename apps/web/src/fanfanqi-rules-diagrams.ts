// Kernel positions, masked through getFFQBanqiPlayerView before drawing.
import {
  applyFFQBanqiMove,
  type BanqiPieceRole,
  createInitialFFQBanqiState,
  FFQ_BANQI_RULES,
  type FFQBanqiState,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import './live-banqi-board.css';
import { renderFFQBanqiBoardSvg } from './live-ffq-banqi-render.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

// A lone diagram matches the width of one board in a three-up row.
const FULL_WIDTH = 568;
export const SINGLE_WIDTH = 320;

function renderPosition(
  id: string,
  state: FFQBanqiState,
  from?: number,
  maxWidth = FULL_WIDTH,
): string {
  const seat = state.ply % 2 === 0 ? 'red' : 'black';
  return renderFFQBanqiBoardSvg(getFFQBanqiPlayerView(state, seat), {
    selectedSquare: from === undefined ? null : ffqBanqiSquare(from),
    pieceSet: activeXiangqiPieceSet,
  })
    .trim()
    .replace(
      '<svg ',
      `<svg data-fanfanqi-diagram="${id}" width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto" `,
    );
}

export function fanfanqiPositionDiagram(opts: { id: string; state: FFQBanqiState }): () => string {
  return () => renderPosition(opts.id, opts.state);
}

/** Every destination, including quiet steps, must agree with the kernel. */
export function fanfanqiMoveDiagram(opts: {
  id: string;
  state: FFQBanqiState;
  from: number;
  expect: readonly number[];
  maxWidth?: number;
}): () => string {
  return () => {
    const piece = opts.state.board[opts.from];
    if (!piece || piece.faceDown) {
      throw new Error(`Fanfanqi diagram ${opts.id}: nothing to move on ${opts.from}`);
    }
    const targets = getFFQBanqiLegalMoves(opts.state)
      .filter((m) => m.from === opts.from && m.from !== m.to)
      .map((m) => m.to)
      .sort((a, b) => a - b);
    const expected = [...opts.expect].sort((a, b) => a - b);
    if (targets.join(' ') !== expected.join(' ')) {
      throw new Error(
        `Fanfanqi diagram ${opts.id}: kernel allows ${opts.from} -> [${targets.join(' ')}], diagram expects [${expected.join(' ')}]`,
      );
    }
    return renderPosition(opts.id, opts.state, opts.from, opts.maxWidth);
  };
}

// Sparse tactical positions use the same state fields and move generator as
// the room. Identities under backs are only kernel inputs, never SVG inputs.
function tacticalState(board: FFQBanqiState['board']): FFQBanqiState {
  return { ...createInitialFFQBanqiState('fanfanqi-tactic', 2), board };
}

const soldierBoard: FFQBanqiState['board'] = Array(32).fill(null);
soldierBoard[9] = { color: 'red', role: 'soldier', faceDown: false };
soldierBoard[10] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_SOLDIER_TAKES_GENERAL = fanfanqiMoveDiagram({
  id: 'soldier-takes-general',
  state: tacticalState(soldierBoard),
  from: 9,
  expect: [5, 8, 10, 13],
});

const generalBoard: FFQBanqiState['board'] = Array(32).fill(null);
generalBoard[9] = { color: 'red', role: 'general', faceDown: false };
generalBoard[10] = { color: 'black', role: 'soldier', faceDown: false };
export const FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER = fanfanqiMoveDiagram({
  id: 'general-cannot-take-soldier',
  state: tacticalState(generalBoard),
  from: 9,
  expect: [5, 8, 13],
});

// The walk-through: one screen then the target, a shot at a back, and a
// cannon with no shot, which also has no move at all.
const shotBoard: FFQBanqiState['board'] = Array(32).fill(null);
shotBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
shotBoard[13] = { color: 'black', role: 'soldier', faceDown: false };
shotBoard[21] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_CANNON_SHOT = fanfanqiMoveDiagram({
  id: 'cannon-shot',
  state: tacticalState(shotBoard),
  from: 9,
  expect: [21],
  maxWidth: SINGLE_WIDTH,
});

const gambleBoard: FFQBanqiState['board'] = Array(32).fill(null);
gambleBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
gambleBoard[10] = { color: 'red', role: 'soldier', faceDown: false };
gambleBoard[11] = { color: 'red', role: 'advisor', faceDown: true };
export const FANFANQI_CANNON_GAMBLE = fanfanqiMoveDiagram({
  id: 'cannon-gamble',
  state: tacticalState(gambleBoard),
  from: 9,
  expect: [11],
  maxWidth: SINGLE_WIDTH,
});

const stuckBoard: FFQBanqiState['board'] = Array(32).fill(null);
stuckBoard[9] = { color: 'red', role: 'cannon', faceDown: false };
stuckBoard[11] = { color: 'black', role: 'horse', faceDown: false };
stuckBoard[13] = { color: 'black', role: 'chariot', faceDown: false };
stuckBoard[17] = { color: 'red', role: 'horse', faceDown: false };
stuckBoard[25] = { color: 'black', role: 'general', faceDown: false };
export const FANFANQI_CANNON_NO_SHOT = fanfanqiMoveDiagram({
  id: 'cannon-no-shot',
  state: tacticalState(stuckBoard),
  from: 9,
  expect: [],
  maxWidth: SINGLE_WIDTH,
});

// Seed 2 deals a red cannon face up beside two face-down screens, so the
// opening board shows Red's only kinds of first move: a flip or that cannon's
// shots. Every square is full, so nothing can step.
const setup = createInitialFFQBanqiState('fanfanqi-setup', 2);
export const FANFANQI_SETUP = fanfanqiMoveDiagram({
  id: 'setup',
  state: setup,
  from: 6,
  expect: [4, 14],
});

// The same game one ply later: the cannon has shot the face-down piece at the
// end of its row. The board is drawn from Black's seat, Black being to move.
const SHOT_TO = 14;
const afterShot = applyFFQBanqiMove(setup, { from: 6, to: SHOT_TO });
export const FANFANQI_COVERED_CAPTURE = fanfanqiPositionDiagram({
  id: 'covered-capture',
  state: afterShot,
});

const ROLE_NAME: Record<BanqiPieceRole, string> = {
  general: 'general',
  advisor: 'advisor',
  elephant: 'elephant',
  chariot: 'chariot',
  horse: 'horse',
  cannon: 'cannon',
  soldier: 'soldier',
};
const cap = (word: string) => word[0]!.toUpperCase() + word.slice(1);
const FIGURE_STYLE = (maxWidth: number) =>
  `width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto"`;

/** What each seat's own view reports about the capture: read from the masked
 *  views, never the canonical board, and the same for both seats or it throws. */
export function coveredCaptureKnowledge(before: FFQBanqiState, after: FFQBanqiState) {
  const cards = (['red', 'black'] as const).map((seat) => {
    const view = getFFQBanqiPlayerView(after, seat);
    const record = view.captured.at(-1);
    if (!record?.wasFaceDown) throw new Error('Fanfanqi capture figure: no face-down capture');
    const hpBefore = getFFQBanqiPlayerView(before, seat).hp[record.owner];
    return {
      seat,
      owner: record.owner,
      role: record.role,
      hpBefore,
      hpAfter: view.hp[record.owner],
    };
  });
  const [red, black] = cards;
  if (JSON.stringify({ ...red, seat: '' }) !== JSON.stringify({ ...black, seat: '' })) {
    throw new Error('Fanfanqi capture figure: the seats saw different captures');
  }
  return cards;
}

export const FANFANQI_CAPTURE_CARDS = (): string => {
  const width = 568;
  const gap = 28;
  const cardW = (width - gap) / 2;
  const top = 30;
  const body = coveredCaptureKnowledge(setup, afterShot)
    .map((card, i) => {
      const x = i * (cardW + gap);
      return [
        `<rect x="${x + 0.75}" y="${top}" width="${cardW - 1.5}" height="94" rx="10" class="xq-jieqi-capture-card" stroke-width="1.5"/>`,
        renderXiangqiPieceGlyphed({ color: card.owner, role: card.role }, activeXiangqiPieceSet, {
          x: x + 18,
          y: top + 24,
          size: 46,
          shape: 'disc',
        }),
        `<text x="${x + 82}" y="${top + 34}" font-size="13" font-weight="700" class="xq-jieqi-capture-label">${card.seat.toUpperCase()} SEES</text>`,
        `<text x="${x + 82}" y="${top + 56}" font-size="13" class="xq-jieqi-capture-detail">a ${card.owner} ${ROLE_NAME[card.role]} was taken</text>`,
        `<text x="${x + 82}" y="${top + 76}" font-size="13" class="xq-jieqi-capture-detail">${cap(card.owner)} HP: ${card.hpBefore} → ${card.hpAfter}</text>`,
      ].join('');
    })
    .join('');
  const title = `<text x="${width / 2}" y="16" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">WHAT EACH PLAYER SEES</text>`;
  return `<svg data-fanfanqi-diagram="capture-cards" viewBox="0 0 ${width} ${top + 96}" role="img" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" aria-label="Red and Black both see which piece was captured" ${FIGURE_STYLE(width)}><g class="xq-article-svg">${title}${body}</g></svg>`;
};

// The ladder, strongest on the left. Who takes whom is asked of the kernel,
// one attacker beside one victim; any pair that breaks "same rank or lower" is
// an exception, and the figure draws exactly the exceptions it finds.
function kernelCaptures(attacker: BanqiPieceRole, victim: BanqiPieceRole): boolean {
  const board: FFQBanqiState['board'] = Array(32).fill(null);
  board[9] = { color: 'red', role: attacker, faceDown: false };
  board[10] = { color: 'black', role: victim, faceDown: false };
  return getFFQBanqiLegalMoves(tacticalState(board)).some((m) => m.from === 9 && m.to === 10);
}

export function ladderExceptions(): Array<{
  attacker: BanqiPieceRole;
  victim: BanqiPieceRole;
  captures: boolean;
}> {
  const order = FFQ_BANQI_RULES.captureRankOrder as readonly BanqiPieceRole[];
  const found = [];
  for (const attacker of order) {
    if (attacker === 'cannon') continue; // a cannon never captures beside it
    for (const victim of order) {
      const captures = kernelCaptures(attacker, victim);
      if (captures !== order.indexOf(victim) >= order.indexOf(attacker)) {
        found.push({ attacker, victim, captures });
      }
    }
  }
  return found;
}

export const FANFANQI_RANK_LADDER = (): string => {
  const order = FFQ_BANQI_RULES.captureRankOrder as readonly BanqiPieceRole[];
  const exceptions = ladderExceptions();
  const up = exceptions.filter((e) => e.captures);
  const down = exceptions.filter((e) => !e.captures);
  if (up.length !== 1 || down.length !== 1) {
    throw new Error(
      `Fanfanqi ladder: expected one exception each way, kernel gives ${JSON.stringify(exceptions)}`,
    );
  }
  const slot = 76;
  const token = 46;
  const width = order.length * slot;
  const cx = (role: BanqiPieceRole) => order.indexOf(role) * slot + slot / 2;
  const pieceY = 60;
  const labelY = pieceY + token / 2 + 18;
  const ink = 'fill="currentColor"';
  const pieces = order
    .map((role, i) =>
      [
        renderXiangqiPieceGlyphed({ color: 'red', role }, activeXiangqiPieceSet, {
          x: cx(role) - token / 2,
          y: pieceY - token / 2,
          size: token,
          shape: 'disc',
        }),
        `<text x="${cx(role)}" y="${labelY}" font-size="12" font-weight="600" text-anchor="middle" ${ink}>${cap(ROLE_NAME[role])}</text>`,
        i > 0
          ? `<text x="${i * slot}" y="${pieceY + 6}" font-size="18" text-anchor="middle" ${ink} opacity="0.6">&gt;</text>`
          : '',
      ].join(''),
    )
    .join('');
  const lead = `<text x="${width / 2}" y="13" font-size="12" text-anchor="middle" ${ink}>Each piece captures its own rank and every rank to its right</text>
<line x1="8" y1="24" x2="${width - 14}" y2="24" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
<polygon points="${width - 6},24 ${width - 15},19 ${width - 15},29" ${ink} opacity="0.6"/>`;
  const from = cx(up[0]!.attacker);
  const to = cx(up[0]!.victim);
  const arcTop = labelY + 8;
  const arcLow = arcTop + 44;
  const arc = `<path d="M ${from} ${arcTop} C ${from} ${arcLow}, ${to} ${arcLow}, ${to} ${arcTop + 6}" fill="none" stroke="var(--site-accent, #2f7f6c)" stroke-width="2"/>
<polygon points="${to},${arcTop - 1} ${to - 5},${arcTop + 9} ${to + 5},${arcTop + 9}" fill="var(--site-accent, #2f7f6c)"/>
<text x="${width / 2}" y="${arcTop + 24}" font-size="12" text-anchor="middle" ${ink}>Exceptions: a ${up[0]!.attacker} takes a ${up[0]!.victim}; a ${down[0]!.attacker} cannot take a ${down[0]!.victim}</text>`;
  const height = arcLow + 2;
  return `<svg data-fanfanqi-diagram="rank-ladder" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" aria-label="The Fanfanqi pieces in rank order, strongest to weakest, with the soldier and general exceptions" ${FIGURE_STYLE(width)}>${lead}${pieces}${arc}</svg>`;
};
