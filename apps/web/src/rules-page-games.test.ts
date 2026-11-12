// The rules pages' sample games are studies built from the plans in
// scripts/variant-lab/rules-page-games/plans (jieqi's has its own test,
// jieqi-rules.test.ts). Each plan must replay on the site's kernel, end the way
// its tags say, and be the study its rules page embeds.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyStandardXiangqiMove,
  createInitialStandardXiangqiState,
  isStandardXiangqiLegalMove,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import type { ArticleBlock } from './articles/types.js';
import { articles } from './articles-data.js';

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
    };
  };
};

function readPlan(name: string): Plan {
  // The working directory is the workspace or the repo root, depending on how vitest ran.
  const path = ['../..', '.']
    .map((root) =>
      resolve(process.cwd(), root, `scripts/variant-lab/rules-page-games/plans/${name}.plan.json`),
    )
    .find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`no plan ${name}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Plan;
}

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
  it('xiangqi: the 1632 trap, legal from the start, Red mates on move 13', () => {
    const chapter = readPlan('xiangqi').create.chapter;
    expect(chapter.variant).toBe('xiangqi');
    expect(embedPaths('xiangqi')).toContain('/embed/study/lZQBORsn/nP95SV4C');
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
});
