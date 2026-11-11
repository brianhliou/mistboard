// Local, one-answer teaching positions. Use the annotator's built game modules
// and win curve, and the same SerializedTree builder as the game chapters.
import { winPercent } from '../../packages/game/dist/analysis.js';
import { createInitialXiangqiState } from '../../packages/game/dist/variants-xiangqi.js';
import { applyXiangqiRecordMove } from '../../packages/game/dist/variants-xiangqi-standard.js';
import { formatXiangqiMoves } from '../../packages/game/dist/xiangqi-notation-format.js';
import { standardXiangqiEngineFen } from '../../packages/game/dist/xiangqi-position.js';
import {
  pikafishUciToXiangqiSquares,
  xiangqiMoveToPikafishUci,
} from '../../packages/game/dist/xiangqi-uci.js';
import { buildTree } from './player-study-tree.mjs';

export const MOMENT_RULES = Object.freeze({
  minPly: 10,
  minLost: 10,
  minGap: 8,
  minWinBefore: 15,
  maxWinBefore: 85,
  maxPerGame: 2,
  maxOverall: 10,
  minExpected: 3,
  mainlinePlies: 2,
  // Plies of the engine line named in the answer's comment.
  lineLabelPlies: 8,
});

const englishName = (names, raw, side) => {
  const entry = names[raw];
  return (typeof entry === 'string' ? entry : entry?.en) || side;
};

function replay(moves) {
  let state = createInitialXiangqiState('kit-moment');
  for (const move of moves) {
    const next = move && applyXiangqiRecordMove(state, move);
    if (!next || next === state) throw new Error('illegal moment continuation');
    state = next;
  }
  return state;
}

function chapterFor({ board, annotation, row, pv, names, number }) {
  const prefix = board.moves.slice(0, row.ply);
  const state = replay(prefix);
  if (state.status.type !== 'playing' || state.status.turn !== board.colour)
    throw new Error('moment turn does not match the record');
  const line = pv.map(pikafishUciToXiangqiSquares);
  const labels = formatXiangqiMoves([...prefix, ...line], 'algebraic').slice(prefix.length);
  // A relayed record may carry no round tag; the board id names it (…-r06-r06t02).
  const round = (
    board.roundNameEn ||
    (/^[\d.]+$/.test(board.roundName) ? board.roundName : '') ||
    String(board.boardId ?? '').match(/-r0*(\d+)-r\d+t\d+$/)?.[1] ||
    '?'
  ).replace(/^Round\s+/i, '');
  const game = annotation.game ?? {};
  const red = englishName(names, board.red?.name ?? game.red, 'Red');
  const black = englishName(names, board.black?.name ?? game.black, 'Black');
  const who = board.colour === 'red' ? red : black;
  const opponent = board.colour === 'red' ? black : red;
  const played = board.moves[row.ply - 1];
  if (xiangqiMoveToPikafishUci(played) !== row.uci)
    throw new Error('moment move does not match the record');
  const playedLabel = formatXiangqiMoves(prefix, 'algebraic').at(-1);
  const before = prefix.slice(0, -1);
  // Replay from the new root through the recorded mistake and the entire named line.
  replay([...before, played, ...line]);
  const tree = buildTree([row.uci, ...pv.slice(0, MOMENT_RULES.mainlinePlies)].join(' '));
  tree.rootFen = standardXiangqiEngineFen(replay(before));
  const mistake = tree.root.children[0];
  mistake.annotations = {
    comments: [{ text: `Round ${round}: ${opponent} just played ${playedLabel}.` }],
  };
  mistake.children[0].annotations = {
    comments: [
      {
        text: `After ${opponent} played ${playedLabel}, ${who} found ${labels[0]}. Pikafish continues ${labels.slice(0, MOMENT_RULES.lineLabelPlies).join(' ')}.`,
      },
    ],
  };
  return {
    name: `Moment ${number} · Round ${round}`,
    orientation: board.colour,
    gamebook: true,
    tree,
    tags: {
      red,
      black,
      result: game.result ?? board.result,
      event: game.event ?? board.tourNameEn ?? board.tourName ?? '',
      ...(game.date || board.playedOn
        ? {
            date: String(game.date || board.playedOn)
              .slice(0, 10)
              .replace(/-00$/, ''),
          }
        : {}),
      ...(game.sourceUrl || board.sourceUrl ? { site: game.sourceUrl || board.sourceUrl } : {}),
      round,
      ply: String(row.ply + 1),
    },
  };
}

export async function findCriticalMoments({ annotations, names, budgets, analyzeMoves }) {
  const candidates = annotations
    .flatMap(({ board, annotation }) =>
      annotation.rows
        .filter(
          (row) =>
            Number.isInteger(row.ply) &&
            row.ply >= MOMENT_RULES.minPly &&
            row.ply < board.moves.length &&
            Number.isFinite(row.lost) &&
            row.lost >= MOMENT_RULES.minLost &&
            Number.isFinite(row.winBefore) &&
            row.winBefore >= MOMENT_RULES.minWinBefore &&
            row.winBefore <= MOMENT_RULES.maxWinBefore &&
            row.best &&
            row.best !== row.uci &&
            ['red', 'black'].includes(row.side) &&
            ['red', 'black'].includes(board.colour) &&
            row.side !== board.colour,
        )
        .map((row) => ({ board, annotation, row })),
    )
    .sort(
      (a, b) =>
        b.row.lost - a.row.lost ||
        a.board.boardId.localeCompare(b.board.boardId) ||
        a.row.ply - b.row.ply,
    );
  const moments = [];
  const perGame = new Map();
  for (const candidate of candidates) {
    if (moments.length >= MOMENT_RULES.maxOverall) break;
    const { board, row } = candidate;
    if ((perGame.get(board.boardId) ?? 0) >= MOMENT_RULES.maxPerGame) continue;
    const prefix = board.moves.slice(0, row.ply).map(xiangqiMoveToPikafishUci);
    const played = xiangqiMoveToPikafishUci(board.moves[row.ply]);
    const lines = await analyzeMoves(
      prefix,
      { nodes: budgets.verifyNodes, depth: budgets.verifyDepth },
      2,
    );
    const [best, second] = lines;
    if (
      best?.rank !== 1 ||
      second?.rank !== 2 ||
      !best.pvUci?.length ||
      !second.pvUci?.length ||
      best.pvUci[0] === second.pvUci[0] ||
      best.pvUci[0] !== played
    )
      continue;
    const scoreWin = ({ score }) => {
      if (!score || (!Number.isFinite(score.cp) && !Number.isFinite(score.mate))) return null;
      // UCI scores already use the mover's POV, including Black's positions.
      return winPercent(score.cp ?? null, score.mate ?? null);
    };
    const firstWin = scoreWin(best);
    const secondWin = scoreWin(second);
    if (firstWin === null || secondWin === null) continue;
    const gap = firstWin - secondWin;
    if (gap < MOMENT_RULES.minGap) continue;
    const chapter = chapterFor({ ...candidate, pv: best.pvUci, names, number: moments.length + 1 });
    moments.push({
      id: `${board.boardId}:${row.ply + 1}`,
      boardId: board.boardId,
      ply: row.ply + 1,
      side: board.colour,
      lost: row.lost,
      best: best.pvUci[0],
      played,
      gap,
      chapter,
    });
    perGame.set(board.boardId, (perGame.get(board.boardId) ?? 0) + 1);
  }
  return moments;
}
