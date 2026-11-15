// The rules pages' sample games are studies built from the plans in
// scripts/variant-lab/rules-page-games/plans (jieqi's has its own test,
// jieqi-rules.test.ts). Each plan must replay on the site's kernel, end the way
// its tags say, and be the study its rules page embeds.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_JUNGLE_FLIP_SQUARES,
  applyCrazyhouseXiangqiMove,
  applyDuckXiangqiTurn,
  applyJungleFlipMove,
  applyJungleMove,
  applyStandardXiangqiMove,
  type CrazyhouseXiangqiGameState,
  crazyhouseXiangqiMoveFromUci,
  createInitialCrazyhouseXiangqiState,
  createInitialDuckXiangqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  createInitialStandardXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  engineUciToJungleMove,
  getJungleFlipLegalMoves,
  isCrazyhouseXiangqiLegalMove,
  isDuckXiangqiLegalTurn,
  isStandardXiangqiLegalMove,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleGameState,
  parseJungleFlipFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArticleBlock } from './articles/types.js';
import { buildArticlePage } from './articles.js';
import { articles } from './articles-data.js';
import { replayBanqiLine, replayBanqiLineFrom } from './banqi-replay-board.js';
import { mountEmbedStudy } from './embed/embed-study-page.js';
import type { StudyChapterPayload } from './study-chapter-spec.js';
import { threeKingdomsBanqiStudyLine } from './three-kingdoms-banqi-study-replay.js';

type Node = {
  uci: string;
  children: Node[];
  annotations?: { glyphs?: number[]; comments?: { text: string }[] };
};
type Plan = {
  create: {
    chapter: {
      name: string;
      variant: string;
      tags: Record<string, string>;
      tree: { rootFen: string; root: Node };
      scoreSeries: StudyChapterPayload['scoreSeries'];
    };
  };
};

function readArtifact<T>(name: string, kind: string): T {
  // The working directory is the workspace or the repo root, depending on how vitest ran.
  const path = ['../..', '.']
    .map((root) =>
      resolve(
        process.cwd(),
        root,
        `scripts/variant-lab/rules-page-games/plans/${name}.${kind}.json`,
      ),
    )
    .find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`no plan ${name}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const readPlan = (name: string): Plan => readArtifact(name, 'plan');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function mainLine(root: Node): Node[] {
  const out: Node[] = [];
  for (let node = root.children[0]; node; node = node.children[0]) out.push(node);
  return out;
}

/** Every sideline in the tree, as [plies before it, its moves]. */
function sidelines(root: Node): [number, string[]][] {
  const out: [number, string[]][] = [];
  mainLine({ uci: '', children: [root] } as Node).forEach((node, ply) => {
    for (const side of node.children.slice(1)) {
      const moves: string[] = [];
      for (let n: Node | undefined = side; n; n = n.children[0]) moves.push(n.uci);
      out.push([ply, moves]);
    }
  });
  return out;
}

function embedPaths(slug: string): string[] {
  const article = articles.find((a) => a.slug === slug);
  if (!article) throw new Error(`no article ${slug}`);
  const paths: string[] = [];
  const visit = (blocks: readonly ArticleBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'embed') paths.push(block.path);
    }
  };
  for (const section of article.sections) visit(section.blocks ?? []);
  return paths;
}

const xqMove = (t: string) => {
  const m = /^([a-i](?:10|\d))([a-i](?:10|\d))$/.exec(t);
  if (!m) throw new Error(`not a xiangqi move: ${t}`);
  return { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare };
};

describe('rules page sample games', () => {
  const banqiPreview = '/embed/study/LocalBq1/Chapter1';
  const kingdomsPreview = '/embed/study/LocalTk1/Chapter2';
  const previewEnv = () => {
    vi.stubEnv('VITE_BANQI_RULES_GAME', banqiPreview);
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_RULES_GAME', kingdomsPreview);
  };

  it('previews annotated Banqi with the recorded result and the existing companion links', () => {
    previewEnv();
    // Keep pages detached: attaching an iframe starts happy-dom navigation.
    const banqi = buildArticlePage('banqi');
    expect(banqi.querySelector('iframe')?.getAttribute('src')).toContain(banqiPreview);
    expect(banqi.textContent).toContain('Level 7 plays black');
    expect(banqi.textContent).toContain('Level 8 wins');
    expect(banqi.querySelector('a[href="/study/FsA5sowX"]')).not.toBeNull();
    expect(banqi.querySelector('a[href="/blog/banqi-statistics"]')).not.toBeNull();
    expect(embedPaths('banqi')).toContain('/embed/study/FsA5sowX/F8fezAhm');
  });

  it('previews annotated Three Kingdoms Banqi with the recorded result before Play', () => {
    previewEnv();
    const kingdoms = buildArticlePage('three-kingdoms-banqi');
    expect(kingdoms.querySelector('iframe')?.getAttribute('src')).toContain(kingdomsPreview);
    expect(kingdoms.textContent).toContain('Level 7 wins');
    expect(kingdoms.textContent).toContain('100');
    expect(kingdoms.textContent).toContain('45');
    const headings = [...kingdoms.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(headings.indexOf('An engine game')).toBe(headings.indexOf('Play on Mistboard') - 1);
    expect(embedPaths('three-kingdoms-banqi')).toEqual([]);
  });

  it('keeps preview IDs out of production and translated rules pages', () => {
    previewEnv();
    for (const lang of ['zh-Hans', 'zh-Hant'] as const) {
      expect(
        buildArticlePage('banqi', lang).querySelector('iframe')?.getAttribute('src'),
      ).toContain('/embed/study/FsA5sowX/F8fezAhm');
      expect(buildArticlePage('three-kingdoms-banqi', lang).querySelector('iframe')).toBeNull();
    }
    vi.stubEnv('DEV', false);
    expect(buildArticlePage('banqi').querySelector('iframe')?.getAttribute('src')).toContain(
      '/embed/study/FsA5sowX/F8fezAhm',
    );
    expect(buildArticlePage('three-kingdoms-banqi').querySelector('iframe')).toBeNull();
  });

  it.each(['', 'https://example.com/embed/study/one/two', '/embed/study/one/two?x=1'])(
    'leaves published content in place for an invalid local preview path: %s',
    (path) => {
      vi.stubEnv('VITE_BANQI_RULES_GAME', path);
      vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_RULES_GAME', path);
      expect(buildArticlePage('banqi').querySelector('iframe')?.getAttribute('src')).toContain(
        '/embed/study/FsA5sowX/F8fezAhm',
      );
      expect(buildArticlePage('three-kingdoms-banqi').querySelector('iframe')).toBeNull();
    },
  );

  for (const variant of ['banqi', 'three-kingdoms-banqi']) {
    it(`${variant}: renders the generated chart, move grades, notes and imported luck`, async () => {
      const source = readPlan(variant).create.chapter;
      const chapter: StudyChapterPayload = {
        ...source,
        id: 'chapter',
        root: source.tree,
        hasDecisions: true,
      };
      const luck = readArtifact<{ decisions: { ply: number }[] }>(variant, 'luck');
      const notes = readArtifact<{ comments: Record<string, string> }>(variant, 'notes');
      const fetcher = vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/decisions') ? luck : { study: { id: 'local' }, chapters: [chapter] },
        ),
      );
      vi.stubGlobal('fetch', fetcher);
      const root = document.createElement('div');
      await mountEmbedStudy(root, { studyId: 'local', chapterId: 'chapter' });
      expect(root.querySelector('.embed-note')).toBeNull();
      const chart = root.querySelector('.embed-score-chart');
      expect(chart).not.toBeNull();
      // The series is keyed by seat; Banqi's first flip bound the first seat to Black.
      expect(chart?.querySelector('.embed-score-chart__side')?.textContent).toBe(
        variant === 'banqi' ? 'Win chance for Black' : 'Win chance for Red',
      );
      expect(chart?.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(
        mainLine(source.tree.root).length + 1,
      );
      for (const text of Object.values(notes.comments)) expect(root.textContent).toContain(text);
      expect(root.querySelectorAll('.review-move-list__suffix')).toHaveLength(
        mainLine(source.tree.root).filter((node) => node.annotations?.glyphs?.length).length,
      );
      expect(root.querySelectorAll('.review-move-list__luck')).toHaveLength(luck.decisions.length);
      const flipPly = luck.decisions[0]!.ply;
      for (let ply = 0; ply < flipPly; ply++)
        root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')!.click();
      expect(chart?.getAttribute('data-ply')).toBe(String(flipPly));
      if (variant === 'banqi') expect(root.querySelector('.luck-mark')).not.toBeNull();
      root
        .querySelector<HTMLElement>('.review-move-list__luck')!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      await vi.waitFor(() => expect(document.querySelector('.luck-card--open')).not.toBeNull());
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/api/studies/local',
        '/api/studies/local/chapters/chapter/decisions',
      ]);
    });

    it(`${variant}: replays the recorded result and every sideline without predicting a flip`, () => {
      const source = readPlan(variant).create.chapter;
      expect(source.tags.result).toBe('0-1');
      const moves = mainLine(source.tree.root).map((node) => node.uci);
      let branchCount = 0;
      if (variant === 'banqi') {
        const line = replayBanqiLine({ rootFen: source.tree.rootFen, moves });
        expect(line.played).toHaveLength(206);
        expect(line.states.at(-1)?.status).toMatchObject({ type: 'finished', winner: 'black' });
        // Export tags name seats. The opening flip gives Level 7 black ink.
        expect(line.states.at(-1)?.firstColor).toBe('black');
        for (const [ply, side] of sidelines(source.tree.root)) {
          const replay = replayBanqiLineFrom(line.states[ply]!, side);
          expect(replay.played).toHaveLength(side.length);
          for (const [i, move] of replay.played.entries()) {
            expect(move.from).not.toBe(move.to);
            expect(replay.states[i]!.board[move.from]?.faceDown).not.toBe(true);
            expect(replay.states[i]!.board[move.to]?.faceDown).not.toBe(true);
          }
          branchCount++;
        }
      } else {
        const replay = threeKingdomsBanqiStudyLine({ id: 'chapter', root: source.tree });
        expect(replay.played).toHaveLength(78);
        expect(replay.views.at(-1)?.status).toMatchObject({ type: 'finished', winner: 'black' });
        expect(replay.views.at(-1)?.scores).toEqual({ red: 45, black: 100 });
        expect(
          Object.values(replay.views.at(-1)!.board).filter((tile) => tile?.faceDown),
        ).toHaveLength(7);
        for (const branch of replay.lines.values()) {
          for (const [i, move] of branch.played.entries()) {
            expect(move.from).not.toBe(move.to);
            expect(branch.views[i]!.board[move.from]?.faceDown).not.toBe(true);
            expect(branch.views[i]!.board[move.to]?.faceDown).not.toBe(true);
          }
          branchCount++;
        }
        // Check the whole public replay, including every branch view.
        const payload = JSON.parse(
          JSON.stringify({ ...replay, lines: [...replay.lines.values()] }),
        );
        expect(JSON.stringify(payload)).not.toMatch(/rootFen|deal|seed|capturedRole/);
        for (const line of [payload, ...payload.lines])
          for (const view of line.views)
            for (const tile of Object.values(view.board))
              if ((tile as { faceDown: boolean } | null)?.faceDown)
                expect(tile).toEqual({ faceDown: true });
      }
      expect(branchCount).toBeGreaterThan(0);
    });
  }

  it('xiangqi: the 1632 trap, legal from the start, Red mates on move 13', () => {
    const chapter = readPlan('xiangqi').create.chapter;
    expect(chapter.variant).toBe('xiangqi');
    expect(embedPaths('xiangqi')).toContain('/embed/study/FhTsmUme/Z9O7CHU2');
    let state: XiangqiGameState = createInitialStandardXiangqiState('rules-xiangqi');
    const line = mainLine(chapter.tree.root);
    expect(line).toHaveLength(25);
    for (const node of line) {
      expect(isStandardXiangqiLegalMove(state, xqMove(node.uci)), node.uci).toBe(true);
      state = applyStandardXiangqiMove(state, xqMove(node.uci));
    }
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red' });
    for (const [ply, moves] of sidelines(chapter.tree.root)) {
      let s: XiangqiGameState = createInitialStandardXiangqiState('rules-xiangqi-line');
      for (const node of line.slice(0, ply)) s = applyStandardXiangqiMove(s, xqMove(node.uci));
      for (const t of moves) {
        expect(isStandardXiangqiLegalMove(s, xqMove(t)), `line at ${ply}: ${t}`).toBe(true);
        s = applyStandardXiangqiMove(s, xqMove(t));
      }
    }
  });

  it('jungle-flip: game 6 replays on its deal, every tile is turned, no line turns one', () => {
    const chapter = readPlan('jungle-flip').create.chapter;
    expect(chapter.variant).toBe('jungle-flip');
    expect(embedPaths('jungle-flip')).toContain('/embed/study/7d1IkHPE/vUJ3Yodx');
    const parsed = parseJungleFlipFen(chapter.tree.rootFen, { gameId: 'rules-flip' } as never);
    if (!parsed.ok || parsed.sampled) throw new Error('the chapter needs its dealt root');
    const deal: JungleFlipDeal = ALL_JUNGLE_FLIP_SQUARES.map((sq) => {
      const p = parsed.state.board[sq]!;
      return { color: p.color, role: p.role };
    });
    const flipMove = (t: string): JungleFlipMove => ({
      from: t.slice(0, 2) as JungleFlipMove['from'],
      to: t.slice(2, 4) as JungleFlipMove['to'],
    });
    const play = (s: JungleFlipGameState, t: string): JungleFlipGameState => {
      const m = flipMove(t);
      const legal = getJungleFlipLegalMoves(s).some((x) => x.from === m.from && x.to === m.to);
      if (!legal) throw new Error(`illegal ${t}`);
      return applyJungleFlipMove(s, m);
    };
    // The stored root names every tile, so it may only name tiles the game turns over.
    const unturned = (moves: string[]): string[] => {
      const turned = new Set(
        moves.filter((t) => t.slice(0, 2) === t.slice(2, 4)).map((t) => t.slice(0, 2)),
      );
      return ALL_JUNGLE_FLIP_SQUARES.filter((sq) => !turned.has(sq));
    };
    const line = mainLine(chapter.tree.root).map((n) => n.uci);
    expect(line).toHaveLength(55);
    let state = createInitialJungleFlipState('rules-flip', deal);
    for (const t of line) state = play(state, t);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red' });
    expect(unturned(line)).toEqual([]);
    // Planted: cut before the last turn-over and the check must name the tile still down.
    expect(unturned(line.slice(0, 29))).toEqual(['b3']);
    for (const [ply, moves] of sidelines(chapter.tree.root)) {
      let s = createInitialJungleFlipState('rules-flip-line', deal);
      for (const t of line.slice(0, ply)) s = play(s, t);
      for (const t of moves) {
        expect(t.slice(0, 2) === t.slice(2, 4), `line at ${ply} turns ${t}`).toBe(false);
        s = play(s, t);
      }
    }
  });

  it('jungle: KataGo vs MistyJungle game 0, legal throughout, Red enters the den', () => {
    const chapter = readPlan('jungle').create.chapter;
    expect(chapter.variant).toBe('jungle');
    expect(embedPaths('jungle')).toContain('/embed/study/lVSs3WaU/9itqMaqN');
    const play = (s: JungleGameState, t: string): JungleGameState => {
      const m = engineUciToJungleMove(t);
      const next = m && applyJungleMove(s, m);
      if (!next) throw new Error(`illegal ${t}`);
      return next;
    };
    const line = mainLine(chapter.tree.root).map((n) => n.uci);
    expect(line).toHaveLength(93);
    let state = createInitialJungleState('rules-jungle');
    for (const t of line) state = play(state, t);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red' });
    const lines = sidelines(chapter.tree.root);
    expect(lines.map(([ply]) => ply)).toEqual([43, 45]);
    for (const [ply, moves] of lines) {
      let s = createInitialJungleState('rules-jungle-line');
      for (const t of line.slice(0, ply)) s = play(s, t);
      for (const t of moves) s = play(s, t);
    }
  });
  it('crazyhouse-xiangqi: Win 3 of the companion study, legal throughout, a soldier drop mates', () => {
    const chapter = readPlan('crazyhouse-xiangqi').create.chapter;
    expect(chapter.variant).toBe('crazyhouse-xiangqi');
    expect(embedPaths('crazyhouse-xiangqi')).toContain('/embed/study/NI4LXant/RyY4z1M3');
    const play = (s: CrazyhouseXiangqiGameState, t: string): CrazyhouseXiangqiGameState => {
      const m = crazyhouseXiangqiMoveFromUci(t);
      if (!m || s.status.type !== 'playing' || !isCrazyhouseXiangqiLegalMove(s, m))
        throw new Error(`illegal ${t}`);
      return applyCrazyhouseXiangqiMove(s, m);
    };
    const line = mainLine(chapter.tree.root).map((n) => n.uci);
    expect(line).toHaveLength(97);
    expect(line.at(-1)).toBe('P@e9');
    let state = createInitialCrazyhouseXiangqiState('rules-chx');
    for (const t of line) state = play(state, t);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'red' });
    const lines = sidelines(chapter.tree.root);
    expect(lines.length).toBeGreaterThan(0);
    for (const [ply, moves] of lines) {
      let s = createInitialCrazyhouseXiangqiState('rules-chx-line');
      for (const t of line.slice(0, ply)) s = play(s, t);
      for (const t of moves) s = play(s, t);
    }
  });

  it('duck-xiangqi: Game 1 of the companion study, legal throughout, Black takes the general', () => {
    const chapter = readPlan('duck-xiangqi').create.chapter;
    expect(chapter.variant).toBe('duck-xiangqi');
    expect(embedPaths('duck-xiangqi')).toContain('/embed/study/Hkwqd2kn/ZlZFbv0q');
    const play = (s: DuckXiangqiGameState, t: string): DuckXiangqiGameState => {
      const m = /^([a-i]\d+)([a-i]\d+)(?:@([a-i]\d+))?$/.exec(t);
      const turn = m && {
        from: m[1] as DuckXiangqiSquare,
        to: m[2] as DuckXiangqiSquare,
        duckTo: (m[3] as DuckXiangqiSquare | undefined) ?? null,
      };
      if (!turn || s.status.type !== 'playing' || !isDuckXiangqiLegalTurn(s, turn))
        throw new Error(`illegal ${t}`);
      return applyDuckXiangqiTurn(s, turn);
    };
    const line = mainLine(chapter.tree.root).map((n) => n.uci);
    expect(line).toHaveLength(120);
    let state = createInitialDuckXiangqiState('rules-duck');
    for (const t of line) state = play(state, t);
    expect(state.status).toMatchObject({ type: 'finished', winner: 'black' });
    // The game-ending capture is the win, never a judged move.
    expect(mainLine(chapter.tree.root).at(-1)?.annotations?.glyphs ?? []).toEqual([]);
    const lines = sidelines(chapter.tree.root);
    expect(lines.length).toBeGreaterThan(0);
    for (const [ply, moves] of lines) {
      let s = createInitialDuckXiangqiState('rules-duck-line');
      for (const t of line.slice(0, ply)) s = play(s, t);
      for (const t of moves) s = play(s, t);
    }
  });
});
