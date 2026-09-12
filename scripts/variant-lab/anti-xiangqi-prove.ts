// Anti xiangqi: turn the engine's "forced dump" verdicts into proofs.
//
//   npx tsx scripts/variant-lab/anti-xiangqi-prove.ts --sweep <exits.json> --out <proofs.json>
//        [--budget 200000] [--depth 60] [--only <leaf,leaf,...>] [--rules k=v ...]
//
// `--rules` replaces the sweep file's rules for the proof (the 100k sweep was
// refereed under stall=fewerPieces; the stock claim is proved with no rules,
// where a stall is a draw and so a refutation).
//
// For every exit whose sweep game ended by extinction, run a proof-number
// search from the exit position with the winner as the attacker: the
// attacker needs one winning move at each of its turns, the defender must
// lose with every reply. The kernel is the only rules source; a proof is a
// tree of kernel-legal moves ending in kernel-adjudicated wins, so it holds
// independently of the engine that suggested it. Terminal values follow the
// sweep's own rules (from the file): under stock rules a stall is a draw and
// therefore a refutation.
//
// Three outcomes per exit. `proven`: a proof tree exists within the depth
// bound. `refuted`: the defender has a line the attacker cannot beat, with
// no depth cutoff on the refuting side (so the engine verdict was wrong).
// `unknown`: the node budget ran out, or every refutation leaned on a node at
// the depth bound. A proof never leans on a cutoff (a cutoff counts as a
// loss for the attacker), so `proven` is safe in the paper sense.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { XiangqiMove } from '../../packages/game/src/variants-xiangqi.js';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleState,
} from '../../packages/game/src/xiangqi-rule-kernel.js';
import { parseRuleArgs, resolveRules } from './lab/rules.js';
import { antiXiangqiKernelConfig, antiXiangqiVariant } from './lab/variants/anti-xiangqi.js';

type Color = 'red' | 'black';
type Row = {
  leaf: number;
  exitPly: number;
  opening: string;
  winner: Color | null;
  reason: string;
  plies: number;
};
type Sweep = { nodes: number; rules: string[]; rows: Row[] };

const INF = Number.POSITIVE_INFINITY;

type Node = {
  move: XiangqiMove | null;
  pn: number;
  dn: number;
  children: Node[] | null;
  /** True when this node's value came from the depth bound, not the rules. */
  cutoff: boolean;
};

type Outcome = {
  leaf: number;
  exitPly: number;
  opening: string;
  attacker: Color;
  result: 'proven' | 'refuted' | 'unknown';
  why: string;
  nodes: number;
  proofSize?: number;
  /** The proof's principal line, attacker moves and one defender reply each. */
  line?: string[];
  /**
   * The whole proof as a certificate, rooted at the exit position: `toMove`
   * says who moves there; `children` holds the one proving move when it is
   * the attacker, or every legal reply when it is the defender, each with
   * its subtree. A reader can replay it with any rules implementation.
   */
  proof?: Certificate;
};

type ProofTree = { move: string; replies?: ProofTree[] };
type Certificate = { toMove: 'attacker' | 'defender'; children: ProofTree[] };

function uci(m: XiangqiMove): string {
  return `${m.from}${m.to}`;
}

function prove(
  kernel: ReturnType<typeof createXiangqiRuleKernel>,
  root: XiangqiRuleState,
  attacker: Color,
  budget: number,
  maxDepth: number,
): {
  result: Outcome['result'];
  why: string;
  nodes: number;
  proofSize: number;
  line: string[];
  proof?: Certificate;
} {
  const rootNode: Node = { move: null, pn: 1, dn: 1, children: null, cutoff: false };
  let nodes = 0;
  // A cascade can end the game by itself (codrus: a general falls inside it).
  if (root.status.type === 'finished') {
    return root.status.winner === attacker
      ? { result: 'proven', why: 'decided inside the cascade', nodes: 0, proofSize: 0, line: [] }
      : { result: 'refuted', why: 'already lost at the exit', nodes: 0, proofSize: 0, line: [] };
  }

  const terminalValue = (
    state: XiangqiRuleState,
    depth: number,
  ): { pn: number; dn: number; cutoff: boolean } | null => {
    if (state.status.type === 'finished') {
      return state.status.winner === attacker
        ? { pn: 0, dn: INF, cutoff: false }
        : { pn: INF, dn: 0, cutoff: false };
    }
    if (depth >= maxDepth) return { pn: INF, dn: 0, cutoff: true };
    return null;
  };

  const expand = (node: Node, state: XiangqiRuleState, depth: number) => {
    const moves = kernel.legalMoves(state);
    node.children = moves.map((m) => {
      const after = kernel.apply(state, m);
      const v = terminalValue(after, depth + 1);
      nodes += 1;
      return v
        ? { move: m, pn: v.pn, dn: v.dn, children: null, cutoff: v.cutoff }
        : { move: m, pn: 1, dn: 1, children: null, cutoff: false };
    });
  };

  const update = (node: Node, attackerToMove: boolean) => {
    const kids = node.children ?? [];
    if (attackerToMove) {
      node.pn = Math.min(...kids.map((k) => k.pn));
      node.dn = kids.reduce((a, k) => a + k.dn, 0);
      // A disproof at an OR node leans on every child; a cutoff anywhere taints it.
      node.cutoff = node.dn === 0 && kids.some((k) => k.cutoff);
    } else {
      node.pn = kids.reduce((a, k) => a + k.pn, 0);
      node.dn = Math.min(...kids.map((k) => k.dn));
      // A disproof at an AND node is one refuting child; taint follows the chosen one.
      const refuting = kids.find((k) => k.dn === 0);
      node.cutoff = node.dn === 0 && refuting !== undefined && refuting.cutoff;
    }
    if (kids.length === 0) {
      // No legal move: the kernel would have finished the game, so this is unreachable.
      node.pn = INF;
      node.dn = 0;
    }
  };

  while (rootNode.pn !== 0 && rootNode.dn !== 0 && nodes < budget) {
    // Select the most-proving node, carrying the state down the path.
    const path: { node: Node; attackerToMove: boolean }[] = [];
    let node = rootNode;
    let state = root;
    let attackerToMove = (state.status as { turn: Color }).turn === attacker;
    let depth = 0;
    while (node.children !== null) {
      path.push({ node, attackerToMove });
      const kids = node.children;
      let best = kids[0]!;
      if (attackerToMove) {
        for (const k of kids) if (k.pn < best.pn) best = k;
      } else {
        for (const k of kids) if (k.dn < best.dn) best = k;
      }
      node = best;
      state = kernel.apply(state, best.move!);
      attackerToMove = !attackerToMove;
      depth += 1;
    }
    path.push({ node, attackerToMove });
    expand(node, state, depth);
    for (let i = path.length - 1; i >= 0; i -= 1) update(path[i]!.node, path[i]!.attackerToMove);
  }

  const line: string[] = [];
  let proofSize = 0;
  if (rootNode.pn === 0) {
    // Count the proof tree and read off its principal line.
    const count = (node: Node, attackerToMove: boolean): number => {
      if (!node.children) return 1;
      if (attackerToMove) {
        const k = node.children.find((c) => c.pn === 0)!;
        return 1 + count(k, false);
      }
      return 1 + node.children.reduce((a, c) => a + count(c, true), 0);
    };
    proofSize = count(rootNode, (root.status as { turn: Color }).turn === attacker);
    let node = rootNode;
    let attackerToMove = (root.status as { turn: Color }).turn === attacker;
    while (node.children) {
      const next = attackerToMove
        ? node.children.find((c) => c.pn === 0)!
        : node.children.reduce((a, c) => (c.pn >= a.pn ? c : a), node.children[0]!);
      line.push(uci(next.move!));
      node = next;
      attackerToMove = !attackerToMove;
    }
    const certificate = (n: Node, attackerToMove: boolean): ProofTree[] => {
      if (!n.children) return [];
      if (attackerToMove) {
        const k = n.children.find((c) => c.pn === 0)!;
        return [{ move: uci(k.move!), replies: certificate(k, false) }];
      }
      return n.children.map((c) => ({ move: uci(c.move!), replies: certificate(c, true) }));
    };
    const rootAttacker = (root.status as { turn: Color }).turn === attacker;
    const proof: Certificate = {
      toMove: rootAttacker ? 'attacker' : 'defender',
      children: certificate(rootNode, rootAttacker),
    };
    return {
      result: 'proven',
      why: `proof tree of ${proofSize} nodes`,
      nodes,
      proofSize,
      line,
      proof,
    };
  }
  if (rootNode.dn === 0) {
    return rootNode.cutoff
      ? {
          result: 'unknown',
          why: `every refutation reaches the ${maxDepth}-ply bound`,
          nodes,
          proofSize: 0,
          line,
        }
      : {
          result: 'refuted',
          why: 'the defender has a line the attacker cannot beat',
          nodes,
          proofSize: 0,
          line,
        };
  }
  return {
    result: 'unknown',
    why: `budget of ${budget} nodes exhausted (pn ${rootNode.pn}, dn ${rootNode.dn})`,
    nodes,
    proofSize: 0,
    line,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      sweep: { type: 'string' },
      out: { type: 'string' },
      budget: { type: 'string', default: '200000' },
      depth: { type: 'string', default: '60' },
      only: { type: 'string' },
      rules: { type: 'string', multiple: true },
    },
  });
  if (!values.sweep || !values.out) throw new Error('--sweep <exits.json> --out <proofs.json>');
  const sweep = JSON.parse(readFileSync(values.sweep, 'utf8')) as Sweep;
  const ruleArgs = values.rules && values.rules.length > 0 ? values.rules : (sweep.rules ?? []);
  const rules = resolveRules(antiXiangqiVariant.ruleSchema, parseRuleArgs(ruleArgs));
  const kernel = createXiangqiRuleKernel(antiXiangqiKernelConfig(rules));
  const budget = Number(values.budget);
  const maxDepth = Number(values.depth);
  const only = values.only ? new Set(values.only.split(',').map(Number)) : null;
  const outcomes: Outcome[] = [];
  const dumps = sweep.rows.filter(
    (r) =>
      r.winner !== null &&
      (r.reason === 'extinction' ||
        r.reason === 'stalemate' ||
        r.reason === 'general-lost' ||
        r.reason === 'bare-general' ||
        r.reason === 'checkmate') &&
      (only === null || only.has(r.leaf)),
  );
  console.log(
    `${dumps.length} decisive exits to prove, budget ${budget} nodes, depth ${maxDepth} plies, rules ${JSON.stringify(rules)}`,
  );
  for (const row of dumps) {
    let state = kernel.initial(`exit-${row.leaf}`);
    for (const m of row.opening.split(' ')) {
      const move = kernel.fromUci(state, m);
      if (!move) throw new Error(`bad opening move ${m} for leaf ${row.leaf}`);
      state = kernel.apply(state, move);
    }
    const started = Date.now();
    const r = prove(kernel, state, row.winner as Color, budget, maxDepth);
    outcomes.push({
      leaf: row.leaf,
      exitPly: row.exitPly,
      opening: row.opening,
      attacker: row.winner as Color,
      result: r.result,
      why: r.why,
      nodes: r.nodes,
      proofSize: r.proofSize || undefined,
      line: r.line.length ? r.line : undefined,
      proof: r.proof,
    });
    writeFileSync(
      values.out,
      JSON.stringify({ sweep: values.sweep, rules: ruleArgs, budget, maxDepth, outcomes }, null, 1),
    );
    console.log(
      `leaf ${String(row.leaf).padStart(3)} exit ${String(row.exitPly).padStart(2)} ${row.winner} to win: ${r.result.padEnd(8)} ${r.why} (${r.nodes} nodes, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  }
  const tally: Record<string, number> = {};
  for (const o of outcomes) tally[o.result] = (tally[o.result] ?? 0) + 1;
  console.log(`done: ${JSON.stringify(tally)}`);
}

main();
