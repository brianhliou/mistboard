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
  const prefix = board.moves.slice(0, row.ply - 1);
  const state = replay(prefix);
  if (state.status.type !== 'playing' || state.status.turn !== row.side)
    throw new Error('moment turn does not match the record');
  const line = pv.map(pikafishUciToXiangqiSquares);
  // Validate the whole named continuation, not just the two displayed plies.
  replay([...prefix, ...line]);
  const labels = formatXiangqiMoves([...prefix, ...line], 'wxf').slice(prefix.length);
  const side = row.side === 'red' ? 'Red' : 'Black';
  const round = (
    board.roundNameEn || (/^[\d.]+$/.test(board.roundName) ? board.roundName : '?')
  ).replace(/^Round\s+/i, '');
  const game = annotation.game ?? {};
  const red = englishName(names, board.red?.name ?? game.red, 'Red');
  const black = englishName(names, board.black?.name ?? game.black, 'Black');
  const who = row.side === 'red' ? red : black;
  const played = board.moves[row.ply - 1];
  if (xiangqiMoveToPikafishUci(played) !== row.uci)
    throw new Error('moment move does not match the record');
  replay([...prefix, played]);
  const playedLabel = formatXiangqiMoves([...prefix, played], 'wxf').at(-1);
  const tree = buildTree(pv.slice(0, MOMENT_RULES.mainlinePlies).join(' '));
  tree.rootFen = standardXiangqiEngineFen(state);
  tree.root.annotations.comments = [{ text: `${side} to play. Find the strongest move.` }];
  tree.root.children[0].annotations = {
    comments: [{ text: `Pikafish continues ${labels.join(' ')}.` }],
  };
  const sideline = buildTree(row.uci).root.children[0];
  sideline.annotations = {
    comments: [
      {
        text: `In the game, ${who} played ${playedLabel} in Round ${round} and gave up about ${Math.round(row.lost)}% of their winning chances.`,
      },
    ],
  };
  tree.root.children.push(sideline);
  return {
    name: `Moment ${number} · Round ${round} · ${side} to play`,
    orientation: row.side,
    gamebook: true,
    tree,
    tags: {
      red,
      black,
      result: game.result ?? board.result,
      event: game.event ?? board.tourName ?? '',
      ...(game.date || board.playedOn
        ? {
            date: String(game.date || board.playedOn)
              .slice(0, 10)
              .replace(/-00$/, ''),
          }
        : {}),
      ...(game.sourceUrl || board.sourceUrl ? { site: game.sourceUrl || board.sourceUrl } : {}),
      round,
      ply: String(row.ply),
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
            row.ply <= board.moves.length &&
            Number.isFinite(row.lost) &&
            row.lost >= MOMENT_RULES.minLost &&
            Number.isFinite(row.winBefore) &&
            row.winBefore >= MOMENT_RULES.minWinBefore &&
            row.winBefore <= MOMENT_RULES.maxWinBefore &&
            row.best &&
            row.best !== row.uci &&
            ['red', 'black'].includes(row.side),
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
    const prefix = board.moves.slice(0, row.ply - 1).map(xiangqiMoveToPikafishUci);
    const lines = await analyzeMoves(prefix, { nodes: budgets.verifyNodes }, 2);
    const [best, second] = lines;
    if (
      best?.rank !== 1 ||
      second?.rank !== 2 ||
      !best.pvUci?.length ||
      !second.pvUci?.length ||
      best.pvUci[0] === second.pvUci[0] ||
      best.pvUci[0] === row.uci
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
      id: `${board.boardId}:${row.ply}`,
      boardId: board.boardId,
      ply: row.ply,
      side: row.side,
      lost: row.lost,
      best: best.pvUci[0],
      played: row.uci,
      gap,
      chapter,
    });
    perGame.set(board.boardId, (perGame.get(board.boardId) ?? 0) + 1);
  }
  return moments;
}
