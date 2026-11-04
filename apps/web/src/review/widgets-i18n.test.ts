import { createInitialXiangqiState, getStandardXiangqiLegalMoves } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredLocale } from '../i18n/locale.js';
import { createPane, renderTruthCaptures } from '../replay-board.js';
import { analysisMarks, type DecisionMoveInfo, decisionBestQuote } from './analysis-marks.js';
import { computeGameAnalysis } from './game-analysis.js';
import { createGameTree } from './game-tree.js';
import { createMoveAdvice } from './move-advice.js';
import { ADVICE_LABEL, formatFlipVariantBestMove, PRAISE_COMMENT } from './move-advice-text.js';
import { createMoveTree, pathKey } from './move-tree.js';
import { createOpeningExplorer } from './opening-explorer.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

const COPY = {
  'zh-Hans': {
    explorer: '开局库',
    columns: ['着法', '对局数', '红胜 / 和棋 / 黑胜'],
    loading: '正在载入开局统计…',
    unavailable: '开局统计暂不可用。',
    empty: '棋谱库中没有对局到达此局面。',
    corpus: '12,345 局',
    count: '此着法有 2 局，共记录 10003 局',
    compactCount: '1万',
    thin: '仅有 2 局结果已知的对局，不足以判断胜负倾向',
    red: '红胜：1',
    black: '黑胜：1',
    draw: '和棋：1',
    unknown: '没有记录结果',
    top: '精选对局',
    results: ['红方获胜', '黑方获胜', '和棋'],
    vs: '对',
    comment: '有评注',
    menu: ['提升为主线', '从此处删除'],
    played: '实战',
    captures: '被吃的棋子',
    whiteCaptures: '白方吃掉的黑子',
    blackCaptures: '黑方吃掉的白子',
    grades: ['不精确', '错着', '漏着'],
    blunder: '漏着。最佳是 h3-e3。',
    best: '最佳是 e8-a8。',
    flip: '翻开 b3',
    praise: ['妙着。弃子后，引擎确认无法收回。', '好棋。此局面唯一的好着。'],
  },
  'zh-Hant': {
    explorer: '開局庫',
    columns: ['著法', '對局數', '紅勝 / 和棋 / 黑勝'],
    loading: '正在載入開局統計…',
    unavailable: '開局統計暫不可用。',
    empty: '棋譜庫中沒有對局到達此局面。',
    corpus: '12,345 局',
    count: '此著法有 2 局，共記錄 10003 局',
    compactCount: '1萬',
    thin: '僅有 2 局結果已知的對局，不足以判斷勝負傾向',
    red: '紅勝：1',
    black: '黑勝：1',
    draw: '和棋：1',
    unknown: '沒有記錄結果',
    top: '精選對局',
    results: ['紅方獲勝', '黑方獲勝', '和棋'],
    vs: '對',
    comment: '有評註',
    menu: ['提升為主線', '從此處刪除'],
    played: '實戰',
    captures: '被吃的棋子',
    whiteCaptures: '白方吃掉的黑子',
    blackCaptures: '黑方吃掉的白子',
    grades: ['不精確', '錯著', '漏著'],
    blunder: '漏著。最佳是 h3-e3。',
    best: '最佳是 e8-a8。',
    flip: '翻開 b3',
    praise: ['妙著。棄子後，引擎確認無法收回。', '好棋。此局面唯一的好著。'],
  },
} as const;

const analysis = computeGameAnalysis({
  engineId: 'test',
  depth: 12,
  plies: [
    { ply: 0, cp: 250, mate: null, best: 'h3e3' },
    { ply: 1, cp: -300, mate: null, best: null },
  ],
});

function explorerPayload() {
  return {
    position: '',
    opening: null,
    total: 10003,
    moves: [
      { from: 'h3', to: 'e3', games: 2, redWins: 1, blackWins: 1, draws: 0, unknowns: 0 },
      { from: 'b3', to: 'e3', games: 1, redWins: 0, blackWins: 0, draws: 1, unknowns: 0 },
      { from: 'a4', to: 'a5', games: 10000, redWins: 0, blackWins: 0, draws: 0, unknowns: 10000 },
    ],
    topGames: ['1-0', '0-1', '1/2-1/2'].map((result, i) => ({
      id: `sample-${i}`,
      result,
      redRating: 2000,
      blackRating: 2100,
    })),
    build: { gameCount: 12345, maxPly: 40, sources: [], builtAt: '' },
  };
}

describe.each(['zh-Hans', 'zh-Hant'] as const)('remaining review widgets in %s', (locale) => {
  const copy = COPY[locale];
  beforeEach(() => {
    const stored = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        clear: () => stored.clear(),
      },
    });
    setStoredLocale(locale);
  });
  afterEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('localizes explorer headers, counts, result tooltips and top games', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(explorerPayload())),
    );
    const explorer = createOpeningExplorer();
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('i18n'));
    await vi.waitFor(() =>
      expect(explorer.el.querySelectorAll('.opening-explorer__row')).toHaveLength(3),
    );
    expect(explorer.el.getAttribute('aria-label')).toBe(copy.explorer);
    expect(explorer.el.querySelector('.opening-explorer__title')?.textContent).toBe(copy.explorer);
    expect(
      [...explorer.el.querySelectorAll('.opening-explorer__col')].map((el) => el.textContent),
    ).toEqual(copy.columns);
    expect(explorer.el.querySelector('.opening-explorer__corpus')?.textContent).toBe(copy.corpus);
    expect(explorer.el.querySelector<HTMLElement>('.opening-explorer__count')?.title).toBe(
      copy.count,
    );
    expect(explorer.el.querySelectorAll('.opening-explorer__count-games')[2]?.textContent).toBe(
      copy.compactCount,
    );
    expect(explorer.el.querySelector<HTMLElement>('.opening-explorer__bar--thin')?.title).toBe(
      copy.thin,
    );
    for (const [kind, title] of [
      ['red', copy.red],
      ['black', copy.black],
      ['draw', copy.draw],
    ]) {
      expect(
        explorer.el.querySelector<HTMLElement>(`.opening-explorer__bar-part--${kind}`)?.title,
      ).toBe(title);
    }
    expect(explorer.el.querySelector<HTMLElement>('.opening-explorer__bar--unknown')?.title).toBe(
      copy.unknown,
    );
    expect(explorer.el.querySelector('.opening-explorer__top-heading')?.textContent).toBe(copy.top);
    expect(
      [...explorer.el.querySelectorAll('.opening-explorer__top-result')].map(
        (el) => el.textContent,
      ),
    ).toEqual(copy.results);
    expect(explorer.el.querySelector('.opening-explorer__top-vs')?.textContent).toBe(copy.vs);
  });

  it('localizes loading, empty and unavailable explorer states', async () => {
    const explorer = createOpeningExplorer();
    expect(explorer.el.querySelector('.opening-explorer__status')?.textContent).toBe(copy.loading);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...explorerPayload(), moves: [] })),
    );
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('i18n'));
    await vi.waitFor(() => expect(explorer.el.textContent).toContain(copy.empty));
    explorer.setState(null);
    expect(explorer.el.textContent).toContain(copy.unavailable);
  });

  it('localizes comment accessibility, ranked candidates and functioning context menu items', async () => {
    const move = getStandardXiangqiLegalMoves(createInitialXiangqiState('i18n'))[0]!;
    const tree = createGameTree(xiangqiTreeAdapter, [move]);
    const path = [tree.root.children[0]!.id];
    const onPromote = vi.fn();
    const onDelete = vi.fn();
    const widget = createMoveTree(tree, { onJump: () => {}, onPromote, onDelete });
    widget.annotate(
      new Map([
        [
          pathKey(path),
          {
            commentMarker: true,
            candidates: [{ label: 'a1-a2', win: 51, played: true }],
          },
        ],
      ]),
    );
    document.body.append(widget.el);
    expect(
      widget.el.querySelector('.review-move-list__comment-marker')?.getAttribute('aria-label'),
    ).toBe(copy.comment);
    expect(widget.el.querySelector('.move-tree__candidate-played')?.textContent).toBe(copy.played);
    const button = widget.el.querySelector<HTMLButtonElement>('.move-tree__move')!;
    for (const [index, callback] of [onPromote, onDelete].entries()) {
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      // The menu installs its outside-click listener on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const items = [...document.querySelectorAll<HTMLButtonElement>('.move-tree__menu-item')];
      expect(items.map((item) => item.textContent)).toEqual(copy.menu);
      items[index]!.click();
      expect(callback).toHaveBeenCalledWith(path);
      expect(document.querySelector('.move-tree__menu')).toBeNull();
    }
  });

  it('localizes capture-strip captions in split and truth panes', () => {
    const pane = createPane('', 'truth', true, 'split');
    expect(pane.topCapturesEl.getAttribute('aria-label')).toBe(copy.captures);
    expect(pane.capturesEl.getAttribute('aria-label')).toBe(copy.captures);
    renderTruthCaptures(pane.capturesEl, { white: ['pawn'], black: ['knight'] });
    expect(
      pane.capturesEl.querySelector('.captures-truth-side-white')?.getAttribute('aria-label'),
    ).toBe(copy.whiteCaptures);
    expect(
      pane.capturesEl.querySelector('.captures-truth-side-black')?.getAttribute('aria-label'),
    ).toBe(copy.blackCaptures);
  });

  it('resolves advice, praise and flip text at render time after an English render', () => {
    const widget = createMoveAdvice();
    setStoredLocale('en');
    widget.update(1, analysis);
    expect(widget.el.textContent).toBe('Blunder. h3-e3 was best.');
    expect(ADVICE_LABEL.blunder).toBe('Blunder');
    expect(PRAISE_COMMENT.great).toContain('Great move.');
    setStoredLocale(locale);
    widget.update(1, analysis);
    expect(widget.el.textContent).toBe(copy.blunder);
    expect(Object.values(ADVICE_LABEL)).toEqual(copy.grades);
    expect(Object.values(PRAISE_COMMENT)).toEqual(copy.praise);
    expect(formatFlipVariantBestMove('b2b2')).toBe(copy.flip);
    const input = {
      analysis,
      quoteEvalBestMove: true,
      formatBestMove: (uci: string) => `${uci.slice(0, 2)}-${uci.slice(2)}`,
    };
    expect(analysisMarks(input).get(1)?.comment).toBe(copy.blunder);
    for (const [index, praise] of (['brilliant', 'great'] as const).entries()) {
      expect(
        analysisMarks({
          ...input,
          analysis: { ...analysis, moves: [{ ...analysis.moves[0]!, judgment: null, praise }] },
        }).get(1)?.comment,
      ).toBe(copy.praise[index]);
    }
  });

  it('localizes decision advice without quoting unranked or played alternatives', () => {
    const info: DecisionMoveInfo = {
      judgment: 'blunder',
      playedRank: 2,
      candidates: [
        { label: 'e8-a8', win: 80, rank: 1 },
        { label: 'a1-a2', win: 30, rank: 2, played: true },
      ],
    };
    expect(decisionBestQuote(info)).toBe(copy.best);
    const marks = analysisMarks({
      analysis,
      quoteEvalBestMove: false,
      formatBestMove: () => 'hidden',
      decisions: {
        byPly: new Map([[1, info]]),
        red: { reveals: 1, decisionAccuracy: 20 },
        black: { reveals: 0, decisionAccuracy: 100 },
      },
    });
    expect(marks.get(1)?.comment).toBe(`${copy.grades[2]}。${copy.best}`);
    expect(decisionBestQuote({ ...info, candidates: [{ label: 'a1-a2', win: 30, rank: 2 }] })).toBe(
      '',
    );
    expect(
      decisionBestQuote({ ...info, candidates: [{ label: 'a1-a2', win: 30, played: true }] }),
    ).toBe('');
  });
});
