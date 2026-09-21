// Chapter builder: a game plus its verdicts becomes a study tree. Every note is
// a fact the analysis or the explorer produced (a judgment with its numbers, the
// engine's line beside the move, the usual move where the game left it); there
// is no free prose and no model in the loop, so a chapter can be re-derived
// byte-for-byte from the same inputs.
//
// Two shapes:
// - model game: the whole game as the mainline, glyphs on every judged move,
//   comments and a refutation branch on the worst few, the root comment
//   carrying provenance and accuracy.
// - decisive moment: the chapter starts from the position BEFORE the loser's
//   decisive move (a rootFen), the mainline is the engine's answer so the
//   gamebook player can grade a guess, and the game's move sits beside it as a
//   variation with its judgment.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  formatXiangqiMove,
  judgmentComment,
  standardXiangqiFen,
  standardXiangqiPositionKey,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiJudgment,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import { judgmentCommentI18n } from '../xiangqi-judgment-comment-i18n.js';
import { canonicalPosition, mirrorMove } from '../xiangqi-opening-mirror.js';
import {
  findDecisiveMoment,
  type GameResult,
  type GameVerdicts,
  type PlyVerdict,
  topMoments,
  winnerOf,
} from './moments.js';
import type { StudyRecipe } from './recipes.js';

/** Bump when the tree a given (game, analysis, recipe) produces would change. */
export const ANNOTATOR_VERSION = 1;

// The tree grammar the study page reads (apps/web/src/review/tree-serialize.ts).
// Duplicated here as plain JSON, the way every seeder does it.
export type NodeComment = { by?: string; text: string; i18n?: Record<string, string> };
export type NodeShape = { kind: 'arrow' | 'circle'; brush: string; orig: string; dest?: string };
export type NodeAnnotations = {
  comments?: NodeComment[];
  shapes?: NodeShape[];
  glyphs?: number[];
  gamebook?: { hint?: string; deviation?: string };
};
export type SerializedNode = {
  uci?: string;
  annotations?: NodeAnnotations;
  children: SerializedNode[];
};
export type SerializedTree = { version: 1; root: SerializedNode; rootFen?: string };

/** NAG codes the review tree renders: 4 = ??, 2 = ?, 6 = ?!. */
const NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };

export type CuratorPlayer = { name: string; nameEn?: string | null };

export type CuratorGame = {
  id: string;
  kind: 'broadcast';
  moves: XiangqiMove[];
  result: GameResult;
  red: CuratorPlayer;
  black: CuratorPlayer;
  event: { name: string; nameEn?: string | null };
  round?: { name: string; nameEn?: string | null } | null;
  playedOn?: string | null;
  sourceUrl?: string | null;
};

/** Explorer rows for a position key in the CALLER's frame (moves as our uci). */
export type ExplorerRow = { move: string; games: number };
export type ExplorerLookup = (positionKey: string) => Promise<ExplorerRow[]>;

export type ChapterDraft = {
  name: string;
  i18n: Record<string, unknown>;
  orientation: 'red' | 'black';
  root: SerializedTree;
  tags: {
    red: string;
    black: string;
    result: string;
    event: string;
    date?: string;
    round?: string;
    site?: string;
  };
  gamebook: boolean;
};

export function uciOf(move: XiangqiMove): string {
  return `${move.from}${move.to}`;
}

export function moveOf(uci: string): XiangqiMove | null {
  const match = /^([a-i](?:[1-9]|10))([a-i](?:[1-9]|10))$/.exec(uci);
  if (!match) return null;
  return { from: match[1] as XiangqiSquare, to: match[2] as XiangqiSquare };
}

function applyMove(state: XiangqiGameState, move: XiangqiMove): XiangqiGameState {
  return applyStandardXiangqiMove(state, move);
}

/** Replay a line from `state`, truncating at the first move the board refuses. */
export function legalLine(state: XiangqiGameState, line: readonly string[]): XiangqiMove[] {
  const out: XiangqiMove[] = [];
  let cursor = state;
  for (const raw of line) {
    const move = moveOf(raw);
    if (!move) break;
    const next = applyMove(cursor, move);
    if (next === cursor) break;
    out.push(move);
    cursor = next;
  }
  return out;
}

function chainOf(moves: readonly XiangqiMove[], leaf?: NodeAnnotations): SerializedNode | null {
  let child: SerializedNode | null = null;
  for (const [index, move] of [...moves].reverse().entries()) {
    const node: SerializedNode = { uci: uciOf(move), children: child ? [child] : [] };
    if (index === 0 && leaf) node.annotations = leaf;
    child = node;
  }
  return child;
}

function evalText(cp: number | null, mate: number | null): string {
  if (mate != null) return `mate in ${Math.abs(mate)}`;
  if (cp == null) return '';
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}

function judgmentOf(verdict: PlyVerdict, hasLine: boolean): XiangqiJudgment {
  return {
    judgment: verdict.judgment ?? 'inaccuracy',
    lost: Math.round(verdict.drop),
    evalText: evalText(verdict.cpAfter, verdict.mateAfter),
    hasLine,
  };
}

export function playerName(player: CuratorPlayer): string {
  return player.nameEn?.trim() || player.name.trim();
}

function playerNameZh(player: CuratorPlayer): string {
  // The source name is Chinese for a mainland event; drop a team prefix if one
  // rode along ("上海 谢靖" -> "谢靖").
  return player.name.trim().split(/\s+/).slice(-1)[0] ?? player.name;
}

function eventName(game: CuratorGame): string {
  return game.event.nameEn?.trim() || game.event.name;
}

function roundName(game: CuratorGame): string | null {
  if (!game.round) return null;
  return game.round.nameEn?.trim() || game.round.name;
}

function outcomeEn(game: CuratorGame): string {
  const winner = winnerOf(game.result);
  if (winner === 'red') return `${playerName(game.red)} won`;
  if (winner === 'black') return `${playerName(game.black)} won`;
  return 'Drawn';
}

function outcomeZh(game: CuratorGame, script: 'zh-Hans' | 'zh-Hant'): string {
  const winner = winnerOf(game.result);
  const won = script === 'zh-Hans' ? '胜' : '勝';
  if (winner === 'red') return `${playerNameZh(game.red)}${won}`;
  if (winner === 'black') return `${playerNameZh(game.black)}${won}`;
  return '和棋';
}

function provenanceEn(game: CuratorGame, verdicts: GameVerdicts, recipe: StudyRecipe): string {
  const parts = [
    `${playerName(game.red)} (Red) vs ${playerName(game.black)} (Black)`,
    eventName(game),
    roundName(game),
    game.playedOn ?? null,
    outcomeEn(game),
  ].filter((p): p is string => Boolean(p));
  const opening = recipe.opening ? ` Opening: ${recipe.opening.name}.` : '';
  return `${parts.join(' · ')}.${opening} Engine notes are Pikafish at 1,000,000 nodes a position, the same path the review page uses. Accuracy: Red ${verdicts.accuracy.red.toFixed(1)}, Black ${verdicts.accuracy.black.toFixed(1)}.`;
}

function provenanceZh(
  game: CuratorGame,
  verdicts: GameVerdicts,
  recipe: StudyRecipe,
  script: 'zh-Hans' | 'zh-Hant',
): string {
  const t = script === 'zh-Hant';
  const parts = [
    `${playerNameZh(game.red)}（${t ? '紅' : '红'}）${t ? '對' : '对'}${playerNameZh(game.black)}（黑）`,
    game.event.name,
    game.round?.name ?? null,
    game.playedOn ?? null,
    outcomeZh(game, script),
  ].filter((p): p is string => Boolean(p));
  const opening = recipe.opening?.nameZh
    ? `${t ? '開局' : '开局'}：${recipe.opening.nameZh}。`
    : '';
  const notes = t
    ? `引擎註解為 Pikafish，每步一百萬節點，與複盤頁所用相同。準確率：紅 ${verdicts.accuracy.red.toFixed(1)}，黑 ${verdicts.accuracy.black.toFixed(1)}。`
    : `引擎注解为 Pikafish，每步一百万节点，与复盘页所用相同。准确率：红 ${verdicts.accuracy.red.toFixed(1)}，黑 ${verdicts.accuracy.black.toFixed(1)}。`;
  return `${parts.join(' · ')}。${opening}${notes}`;
}

export type OpeningDeviation = {
  /** 1-based ply of the move that left the usual line. */
  ply: number;
  games: number;
  played: { uci: string; share: number };
  usual: { uci: string; share: number };
};

/** Explorer thresholds: enough games to call something usual, a clear usual
 *  move, and a played move rare enough to be a departure rather than a minor line. */
export const DEVIATION_MIN_GAMES = 20;
export const DEVIATION_USUAL_SHARE = 0.3;
export const DEVIATION_PLAYED_SHARE = 0.08;
export const DEVIATION_MAX_PLY = 24;

/**
 * The first ply where the game leaves the explorer's usual moves. Walks the
 * position keys mirror-canonically (the explorer stores them that way) and
 * mirrors the answer back, exactly as the explorer route does.
 */
export async function findOpeningDeviation(
  moves: readonly XiangqiMove[],
  lookup: ExplorerLookup,
): Promise<OpeningDeviation | null> {
  let state = createInitialXiangqiState('study-curator-deviation');
  for (const [index, move] of moves.slice(0, DEVIATION_MAX_PLY).entries()) {
    if (state.status.type !== 'playing') return null;
    const canonical = canonicalPosition(standardXiangqiPositionKey(state));
    const stored = await lookup(canonical.key);
    const rows = canonical.mirrored
      ? stored.map((row) => {
          const parsed = moveOf(row.move);
          return parsed ? { ...row, move: uciOf(mirrorMove(parsed)) } : row;
        })
      : stored;
    const total = rows.reduce((sum, row) => sum + row.games, 0);
    if (total < DEVIATION_MIN_GAMES) return null;
    const played = uciOf(move);
    const playedGames = rows.find((row) => row.move === played)?.games ?? 0;
    const usual = [...rows].sort((a, b) => b.games - a.games)[0];
    if (!usual) return null;
    const usualShare = usual.games / total;
    const playedShare = playedGames / total;
    if (
      usual.move !== played &&
      usualShare >= DEVIATION_USUAL_SHARE &&
      playedShare < DEVIATION_PLAYED_SHARE
    ) {
      return {
        ply: index + 1,
        games: total,
        played: { uci: played, share: playedShare },
        usual: { uci: usual.move, share: usualShare },
      };
    }
    const next = applyMove(state, move);
    if (next === state) return null;
    state = next;
  }
  return null;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function deviationComment(state: XiangqiGameState, deviation: OpeningDeviation): NodeComment {
  const usual = moveOf(deviation.usual.uci);
  const played = moveOf(deviation.played.uci);
  if (!usual || !played) return { text: '' };
  const en = `Out of the usual line. In ${deviation.games} games from this position, ${formatXiangqiMove(state, usual, 'algebraic')} was played ${pct(deviation.usual.share)} of the time; ${formatXiangqiMove(state, played, 'algebraic')} appears in ${pct(deviation.played.share)}.`;
  const zhHans = `离开常见变化。此局面下的 ${deviation.games} 局中，${formatXiangqiMove(state, usual, 'chinese-simplified')} 占 ${pct(deviation.usual.share)}；${formatXiangqiMove(state, played, 'chinese-simplified')} 占 ${pct(deviation.played.share)}。`;
  const zhHant = `離開常見變化。此局面下的 ${deviation.games} 局中，${formatXiangqiMove(state, usual, 'chinese-traditional')} 佔 ${pct(deviation.usual.share)}；${formatXiangqiMove(state, played, 'chinese-traditional')} 佔 ${pct(deviation.played.share)}。`;
  return { text: en, i18n: { 'zh-Hans': zhHans, 'zh-Hant': zhHant } };
}

function orientationFor(recipe: StudyRecipe, game: CuratorGame): 'red' | 'black' {
  const wanted = recipe.study.orientation ?? 'red';
  if (wanted === 'winner') return winnerOf(game.result) ?? 'red';
  return wanted;
}

function tagsFor(game: CuratorGame): ChapterDraft['tags'] {
  const round = roundName(game);
  return {
    red: playerName(game.red),
    black: playerName(game.black),
    result: game.result,
    event: eventName(game),
    ...(game.playedOn ? { date: game.playedOn } : {}),
    ...(round ? { round } : {}),
    ...(game.sourceUrl ? { site: game.sourceUrl } : {}),
  };
}

function tagsI18n(game: CuratorGame) {
  return {
    'zh-Hans': {
      red: playerNameZh(game.red),
      black: playerNameZh(game.black),
      event: game.event.name,
    },
    'zh-Hant': {
      red: playerNameZh(game.red),
      black: playerNameZh(game.black),
      event: game.event.name,
    },
  };
}

/** A model-game chapter: the game played through with its judged moves marked. */
export async function buildModelGameChapter(
  game: CuratorGame,
  verdicts: GameVerdicts,
  recipe: StudyRecipe,
  explorer?: ExplorerLookup,
): Promise<ChapterDraft> {
  const maxMoments = recipe.annotate?.maxMoments ?? 6;
  const commented = new Set(topMoments(verdicts, maxMoments).map((v) => v.ply));
  const byPly = new Map(verdicts.verdicts.map((v) => [v.ply, v]));
  const deviation =
    (recipe.annotate?.openingDeviation ?? true) && explorer
      ? await findOpeningDeviation(game.moves, explorer)
      : null;

  const root: SerializedNode = {
    annotations: {
      comments: [
        {
          text: provenanceEn(game, verdicts, recipe),
          i18n: {
            'zh-Hans': provenanceZh(game, verdicts, recipe, 'zh-Hans'),
            'zh-Hant': provenanceZh(game, verdicts, recipe, 'zh-Hant'),
          },
        },
      ],
    },
    children: [],
  };

  let state = createInitialXiangqiState(`study-curator-${game.id}`);
  let parent = root;
  for (const [index, move] of game.moves.entries()) {
    const ply = index + 1;
    const node: SerializedNode = { uci: uciOf(move), children: [] };
    const verdict = byPly.get(ply);
    const playing = state.status.type === 'playing';
    const comments: NodeComment[] = [];
    let branch: SerializedNode | null = null;
    if (deviation && deviation.ply === ply && playing) {
      comments.push(deviationComment(state, deviation));
    }
    if (verdict?.judgment) {
      const line = playing && commented.has(ply) ? legalLine(state, verdict.pv) : [];
      if (commented.has(ply)) {
        const judged = judgmentOf(verdict, line.length > 0);
        comments.push({ text: judgmentComment(judged), i18n: judgmentCommentI18n(judged) });
      }
      node.annotations = { glyphs: [NAG[verdict.judgment] ?? 6] };
      // The refutation branches from the SAME position, so it is a sibling of
      // the played move, not a child of it.
      branch = chainOf(line);
    }
    if (comments.length) {
      node.annotations = { ...(node.annotations ?? {}), comments };
    }
    parent.children.push(node);
    if (branch) parent.children.push(branch);
    if (playing) state = applyMove(state, move);
    parent = node;
  }

  const round = roundName(game);
  const name = `${playerName(game.red)} vs ${playerName(game.black)}${round ? ` · ${round}` : ''} · ${game.result}`;
  const nameZh = (script: 'zh-Hans' | 'zh-Hant') =>
    `${playerNameZh(game.red)} ${script === 'zh-Hant' ? '對' : '对'} ${playerNameZh(game.black)}${game.round ? ` · ${game.round.name}` : ''} · ${game.result}`;
  const tags18 = tagsI18n(game);
  return {
    name,
    i18n: {
      'zh-Hans': { name: nameZh('zh-Hans'), tags: tags18['zh-Hans'] },
      'zh-Hant': { name: nameZh('zh-Hant'), tags: tags18['zh-Hant'] },
    },
    orientation: orientationFor(recipe, game),
    root: { version: 1, root },
    tags: tagsFor(game),
    gamebook: false,
  };
}

/** The position before the decisive move, when the game has one it can be
 *  parked on (the board must still be playing there). */
export function decisivePosition(
  game: CuratorGame,
  verdicts: GameVerdicts,
): { verdict: PlyVerdict; state: XiangqiGameState } | null {
  const moment = findDecisiveMoment(game.result, verdicts);
  if (!moment) return null;
  let state = createInitialXiangqiState(`study-curator-decisive-${game.id}`);
  for (const move of game.moves.slice(0, moment.verdict.ply - 1)) {
    if (state.status.type !== 'playing') return null;
    const next = applyMove(state, move);
    if (next === state) return null;
    state = next;
  }
  if (state.status.type !== 'playing') return null;
  return { verdict: moment.verdict, state };
}

/** A decisive-moment chapter: rooted before the loser's turning-point move,
 *  the engine's answer as the gamebook mainline, the game's move beside it. */
export function buildDecisiveMomentChapter(
  game: CuratorGame,
  verdicts: GameVerdicts,
  recipe: StudyRecipe,
): ChapterDraft | null {
  const found = decisivePosition(game, verdicts);
  if (!found) return null;
  const { verdict, state } = found;
  const solution = legalLine(state, verdict.pv);
  const played = game.moves[verdict.ply - 1];
  if (solution.length === 0 || !played) return null;
  const mover: XiangqiColor = verdict.mover;
  const moverName = mover === 'red' ? playerName(game.red) : playerName(game.black);
  const moverNameZh = mover === 'red' ? playerNameZh(game.red) : playerNameZh(game.black);
  const sideEn = mover === 'red' ? 'Red' : 'Black';
  const moveNumber = Math.ceil(verdict.ply / 2);

  const intro = `${sideEn} to move (${moverName}), move ${moveNumber}. ${provenanceEn(game, verdicts, recipe)} The game turned here: the move played gave up ${Math.round(verdict.drop)} win% points. Find the better move.`;
  const introZh = (script: 'zh-Hans' | 'zh-Hant') => {
    const t = script === 'zh-Hant';
    const side = mover === 'red' ? (t ? '紅方' : '红方') : '黑方';
    return `${side}走棋（${moverNameZh}），第 ${moveNumber} 回合。${provenanceZh(game, verdicts, recipe, script)}${t ? '勝負在此逆轉：實戰著法讓出了' : '胜负在此逆转：实战着法让出了'} ${Math.round(verdict.drop)} ${t ? '個勝率點。請找出更好的著法。' : '个胜率点。请找出更好的着法。'}`;
  };

  const judged = judgmentOf(verdict, true);
  const playedNode: SerializedNode = {
    uci: uciOf(played),
    annotations: {
      glyphs: [NAG[verdict.judgment ?? 'inaccuracy'] ?? 6],
      comments: [
        {
          text: `Played in the game. ${judgmentComment(judged)}`,
          i18n: judgmentCommentI18n(judged),
        },
      ],
    },
    children: [],
  };
  const solutionNode = chainOf(solution);
  if (!solutionNode) return null;

  const root: SerializedNode = {
    annotations: {
      comments: [
        { text: intro, i18n: { 'zh-Hans': introZh('zh-Hans'), 'zh-Hant': introZh('zh-Hant') } },
      ],
      gamebook: {
        hint: `${sideEn} is not losing yet. The engine's move keeps the game level or better.`,
      },
    },
    // The engine's line is the mainline the gamebook grades against; the game's
    // own move is the variation the reader most likely tries.
    children: [solutionNode, playedNode],
  };

  const name = `Move ${moveNumber}, ${sideEn} to play · ${playerName(game.red)} vs ${playerName(game.black)}`;
  const nameZh = (script: 'zh-Hans' | 'zh-Hant') =>
    `第 ${moveNumber} 回合，${mover === 'red' ? (script === 'zh-Hant' ? '紅' : '红') : '黑'}方走棋 · ${playerNameZh(game.red)} ${script === 'zh-Hant' ? '對' : '对'} ${playerNameZh(game.black)}`;
  const tags18 = tagsI18n(game);
  return {
    name,
    i18n: {
      'zh-Hans': { name: nameZh('zh-Hans'), tags: tags18['zh-Hans'] },
      'zh-Hant': { name: nameZh('zh-Hant'), tags: tags18['zh-Hant'] },
    },
    orientation: mover,
    root: { version: 1, root, rootFen: standardXiangqiFen(state) },
    tags: tagsFor(game),
    gamebook: true,
  };
}
