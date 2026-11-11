import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiGameState,
  type JieqiMove,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { translateArticle } from './article-i18n.js';
import { articleProse } from './article-prose.js';
import matchRecord from './articles/content/ab-jchess-vs-jqe-match.json' with { type: 'json' };
import { jieqiArticle } from './articles/content/jieqi.js';
import { buildArticlePage } from './articles.js';
import { renderArticlePageShellForPrerender } from './pages-static.js';

describe('English Jieqi rules review', () => {
  it('keeps the rules reference and the sample game, without a walkthrough or tips', () => {
    const page = buildArticlePage('jieqi');
    for (const id of ['captured-dark-pieces', 'check-checkmate-and-draws', 'a-sample-game']) {
      expect(page.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(page.querySelector('#how-to-play-your-first-game')).toBeNull();
    expect(page.querySelector('#tips-for-playing-well')).toBeNull();
    expect(
      page.querySelector(
        'iframe[src*="/embed/study/SwSUugEY/SDQPHsxM"], [data-embed-path*="SDQPHsxM"]',
      ),
    ).not.toBeNull();
  });

  it('says only what the sample game shows, replayed from the match record', () => {
    const game = matchRecord.games.find((entry) => entry.key === 'run2:104')!;
    expect([game.red, game.black, game.winner, game.moveCount]).toEqual([
      expect.stringMatching(/^AB-JChess/),
      'jqe',
      'black',
      30,
    ]);
    let state: JieqiGameState = createInitialJieqiState('jieqi-rules', game.deal as never, {
      repetition: true,
    });
    const reveals = new Map<string, string>();
    const captures = new Map<string, string>();
    (game.moves as string).split(' ').forEach((token, index) => {
      const [, from, to] = token.match(/^([a-i]\d+)([a-i]\d+)$/)!;
      const mover = state.board[from as keyof typeof state.board]!;
      const target = state.board[to as keyof typeof state.board];
      state = applyJieqiMove(state, { from, to } as JieqiMove, {
        noCaptureClockLimit: Number.POSITIVE_INFINITY,
      });
      const landed = state.board[to as keyof typeof state.board]!;
      if (mover.faceDown) reveals.set(`${Math.floor(index / 2) + 1}:${to}`, landed.role);
      if (target && !target.faceDown) {
        captures.set(`${Math.floor(index / 2) + 1}:${to}`, `${mover.role}x${target.role}`);
      }
    });
    expect(reveals.get('2:i6')).toBe('advisor');
    expect(captures.get('10:g4')).toBe('advisorxelephant');
    expect(reveals.get('3:e6')).toBe('advisor');
    expect(reveals.get('20:c5')).toBe('chariot');
    expect(captures.get('20:c5')).toBe('cannonxchariot');
    expect(reveals.get('25:d1')).toBe('soldier');
    expect((game.moves as string).split(' ')).toContain('a1d1');
    expect(state.board.d2).toMatchObject({ color: 'red', role: 'general' });
    expect(state.board.d3).toMatchObject({ color: 'black', role: 'advisor' });
    expect(state.status).toEqual({ type: 'finished', winner: 'black', reason: 'checkmate' });
  });

  it('ends with one row of two buttons and points to the drawn piece moves', () => {
    const page = buildArticlePage('jieqi');
    const rows = page.querySelectorAll('.article-cta-row');
    const closing = rows[rows.length - 1]!;
    expect(closing.classList.contains('article-cta-row-single-row')).toBe(true);
    expect(closing.querySelectorAll('.article-cta')).toHaveLength(2);
    expect(page.querySelector('a[href="/rules/xiangqi#the-pieces"]')).not.toBeNull();
    expect(page.textContent).not.toContain('Move and capture');
  });

  it('keeps new English prose free of em dashes, Chinese terms and chess-piece substitutes', () => {
    for (const { path, text } of articleProse(jieqiArticle)) {
      expect(text, path).not.toMatch(/[\u2014\p{Script=Han}]/u);
      expect(text, path).not.toMatch(/\b(king|rook|knight|pawn|squares?)\b/i);
    }
  });

  for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
    it(`${lang}: leaves no English prose string untranslated`, () => {
      const translated = translateArticle(jieqiArticle, lang);
      const english = new Set(articleProse(jieqiArticle).map(({ text }) => text));
      const untranslated = articleProse(translated).filter(({ text }) => english.has(text));
      expect(untranslated).toEqual([]);
      expect(translated.updateNote).not.toBe(jieqiArticle.updateNote);
    });
  }

  it('can measure the English rules shell without starting a server', async () => {
    const html = await renderArticlePageShellForPrerender('jieqi');
    expect(html).toContain('Captured dark pieces');
  });
});
