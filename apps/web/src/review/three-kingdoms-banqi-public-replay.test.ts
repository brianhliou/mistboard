import { readFileSync } from 'node:fs';
import { banqiPieceLetter } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { createGameTree } from './game-tree.js';
import { mountStudyReview } from './study-review.js';
import * as adapters from './three-kingdoms-banqi-tree-adapter.js';
import { deserializeTree, type SerializedTree, serializeTree } from './tree-serialize.js';

const fixture = JSON.parse(
  readFileSync('../../packages/game/fixtures/three-kingdoms-banqi-78.json', 'utf8'),
);
const tokens: string[] = fixture.plies.map(
  (ply: { uci: string; revealed?: Parameters<typeof banqiPieceLetter>[0] }) =>
    ply.revealed ? `${ply.uci}:${banqiPieceLetter(ply.revealed)}` : ply.uci,
);
const replay = 'three-kingdoms-banqi-public-v1' as const;

function recordedTree(): SerializedTree {
  const root: SerializedTree['root'] = { children: [] };
  let node = root;
  for (const uci of tokens) {
    const child = { uci, children: [] };
    node.children.push(child);
    node = child;
  }
  return { version: 1, replay, root };
}

describe('public Three Kingdoms study replay', () => {
  it('round-trips the complete chapter with outcomes only on its recorded flip nodes', () => {
    expect(typeof adapters.makeThreeKingdomsBanqiReplayTreeAdapter).toBe('function');
    const adapter = adapters.makeThreeKingdomsBanqiReplayTreeAdapter();
    const input = recordedTree();
    const tree = deserializeTree(adapter, input);
    expect(tree.mainlinePath()).toHaveLength(78);
    expect(tree.nodeAt(tree.last())?.truth.status).toEqual({
      type: 'finished',
      winner: 'black',
      reason: 'score',
    });
    const chapter = {
      id: 'recorded',
      variant: 'three-kingdoms-banqi',
      root: serializeTree(tree, adapter, { replay }),
    };
    expect(JSON.parse(JSON.stringify(chapter))).toEqual({
      id: 'recorded',
      variant: 'three-kingdoms-banqi',
      root: input,
    });
    expect(JSON.stringify(chapter)).not.toMatch(/rootFen|deal|seed|board|"role"|"color"/);
    for (const node of [
      tree.root,
      ...tree.mainlinePath().map((_, i, path) => tree.nodeAt(path.slice(0, i + 1))!),
    ]) {
      for (const tile of Object.values(node.truth.board)) {
        if (tile?.faceDown) expect(tile).toEqual({ faceDown: true });
      }
    }
    // A branch never borrows the recorded outcome from some later flip.
    expect(tree.addMove([], { from: 'a1', to: 'a1' })).toBeNull();
    const empty = createGameTree(adapter);
    expect(empty.root.truth.board.a1).toEqual({ faceDown: true });
  });

  it('rejects inconsistent outcomes instead of changing the deal to fit them', () => {
    expect(typeof adapters.makeThreeKingdomsBanqiReplayTreeAdapter).toBe('function');
    const adapter = adapters.makeThreeKingdomsBanqiReplayTreeAdapter();
    const tree = deserializeTree(adapter, {
      version: 1,
      replay,
      root: { children: [{ uci: '@a1:G', children: [{ uci: '@b1:G', children: [] }] }] },
    });
    expect(tree.mainlinePath()).toHaveLength(1);
    expect(tree.root.truth.board.a1).toEqual({ faceDown: true });
  });

  it('mounts the stored chapter through the study dispatch and preserves its marker on save', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = await mountStudyReview('three-kingdoms-banqi', host, {
      initialTree: recordedTree(),
      title: 'Recorded game',
      ariaLabel: 'Review',
      summary: '',
    });
    expect(handle.serialize()).toEqual(recordedTree());
    expect(host.textContent).toContain('f4(A)');
    handle.destroy();
    host.remove();
  });
});
