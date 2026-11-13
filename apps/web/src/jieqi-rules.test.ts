import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyJieqiMove,
  type JieqiGameState,
  type JieqiMove,
  parseJieqiFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { translateArticle } from './article-i18n.js';
import { articleProse } from './article-prose.js';
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
        'iframe[src*="/embed/study/4KNglJHs/olxXB9Ny"], [data-embed-path*="olxXB9Ny"]',
      ),
    ).not.toBeNull();
  });

  it('says only what the sample game shows, replayed from the study plan', () => {
    // The working directory is the workspace or the repo root, depending on how vitest ran.
    const planPath = ['../..', '.']
      .map((root) =>
        resolve(process.cwd(), root, 'scripts/variant-lab/rules-page-games/plans/jieqi.plan.json'),
      )
      .find((candidate) => existsSync(candidate));
    const plan = JSON.parse(readFileSync(planPath as string, 'utf8'));
    const chapter = plan.create.chapter;
    expect([chapter.tags.red, chapter.tags.black, chapter.tags.result]).toEqual([
      'jqe',
      expect.stringMatching(/^AB-JChess/),
      '0-1',
    ]);
    const parsed = parseJieqiFen(chapter.tree.rootFen, { gameId: 'jieqi-rules' });
    if (!parsed.ok) throw new Error(parsed.error);
    let state: JieqiGameState = parsed.state;
    const moves: string[] = [];
    for (let node = chapter.tree.root.children[0]; node; node = node.children[0]) {
      moves.push(node.uci);
    }
    expect(moves).toHaveLength(50);
    const reveals = new Map<string, string>();
    let redCapturesBy11 = 0;
    moves.forEach((token, index) => {
      const [, from, to] = token.match(/^([a-i]\d+)([a-i]\d+)$/)!;
      const mover = state.board[from as keyof typeof state.board]!;
      const target = state.board[to as keyof typeof state.board];
      state = applyJieqiMove(state, { from, to } as JieqiMove, {
        noCaptureClockLimit: Number.POSITIVE_INFINITY,
      });
      const move = Math.floor(index / 2) + 1;
      const landed = state.board[to as keyof typeof state.board]!;
      if (mover.faceDown) reveals.set(`${move}:${mover.color}`, landed.role);
      if (target && mover.color === 'red' && move <= 11) redCapturesBy11 += 1;
    });
    expect(redCapturesBy11).toBe(6);
    expect(reveals.get('11:black')).toBe('chariot');
    expect(reveals.get('13:black')).toBe('chariot');
    expect(moves[44]).toBe('f1e2');
    expect(reveals.get('23:red')).toBe('soldier');
    expect(state.status).toEqual({ type: 'finished', winner: 'black', reason: 'checkmate' });
    // Both slips on move 17 carry a mistake glyph (NAG 2).
    let node = chapter.tree.root;
    const glyphs: Record<number, number[]> = {};
    for (let ply = 1; node.children[0]; ply += 1) {
      node = node.children[0];
      glyphs[ply] = node.annotations?.glyphs ?? [];
    }
    expect(glyphs[33]).toEqual([2]);
    expect(glyphs[34]).toEqual([2]);
  });

  it('the study names no face-down piece the game did not turn over', () => {
    const planPath = ['../..', '.']
      .map((root) =>
        resolve(process.cwd(), root, 'scripts/variant-lab/rules-page-games/plans/jieqi.plan.json'),
      )
      .find((candidate) => existsSync(candidate));
    const plan = JSON.parse(readFileSync(planPath as string, 'utf8'));
    const tree = plan.create.chapter.tree;
    const parsed = parseJieqiFen(tree.rootFen, { gameId: 'jieqi-rules-hidden' });
    if (!parsed.ok) throw new Error(parsed.error);
    type Node = { uci: string; children: Node[] };
    const step = (state: JieqiGameState, uci: string) => {
      const [, from, to] = uci.match(/^([a-i]\d+)([a-i]\d+)$/)!;
      return {
        from: from as keyof typeof state.board,
        to: to as keyof typeof state.board,
        next: applyJieqiMove(state, { from, to } as JieqiMove, {
          noCaptureClockLimit: Number.POSITIVE_INFINITY,
        }),
      };
    };
    // Main line: every identity the root names is turned over in the game.
    const named = new Set(
      Object.entries(parsed.state.board)
        .filter(([, piece]) => piece?.faceDown && !piece.unknown)
        .map(([square]) => square),
    );
    const turned = new Set<string>();
    let state = parsed.state;
    for (let node: Node | undefined = tree.root.children[0]; node; node = node.children[0]) {
      const { from, next } = step(state, node.uci);
      if (state.board[from]?.faceDown) turned.add(from);
      state = next;
    }
    expect([...named].filter((square) => !turned.has(square))).toEqual([]);
    // Side lines: no move turns a piece over or takes a face-down one.
    const sideMoves: string[] = [];
    const walk = (node: Node, before: JieqiGameState, onSide: boolean) => {
      node.children.forEach((child, index) => {
        const side = onSide || index > 0;
        const { from, to, next } = step(before, child.uci);
        if (side && (before.board[from]?.faceDown || before.board[to]?.faceDown)) {
          sideMoves.push(child.uci);
        }
        if (side) expect(next).not.toBe(before);
        walk(child, next, side);
      });
    };
    walk(tree.root, parsed.state, false);
    expect(sideMoves).toEqual([]);
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
