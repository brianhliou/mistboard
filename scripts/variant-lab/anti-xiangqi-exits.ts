// Anti xiangqi: sweep every exit of the compulsory-capture opening cascade
// with the engine, then back the results up the cascade.
//
//   npx tsx scripts/variant-lab/anti-xiangqi-exits.ts sweep --nodes 100000 --out <file.json> [--rules stall=fewerPieces]
//   npx tsx scripts/variant-lab/anti-xiangqi-exits.ts minimax <file.json>
//
// `sweep` enumerates the cascade from the array (a leaf is the first position
// where the mover has no capture, or a position where the cascade itself
// ended the game, as codrus's does when a general falls), keeps the half that starts 1. Cb3xb10
// (the other half is its mirror image), and plays one engine-v-engine game
// from each leaf with the kernel refereeing. Results are written after every
// game, so a killed run resumes where it stopped. `minimax` scores each leaf
// (extinction and stalemate as played; a stall as a draw, and separately as
// the fewer-pieces count) and reports the value of the cascade and the exits
// both sides can reach without either making a losing choice.
//
// This is the evidence behind the sheet's "one opening line" verdict, kept
// so a reader can rerun it: docs-private/variant-lab/anti-xiangqi/decisions.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleState,
} from '../../packages/game/src/xiangqi-rule-kernel.js';
import { contextForVariant } from './lab/context.js';
import { enginePolicy, playGame } from './lab/play.js';
import { parseRuleArgs, resolveRules } from './lab/rules.js';
import { antiXiangqiKernelConfig, antiXiangqiVariant } from './lab/variants/anti-xiangqi.js';

type Move = { from: string; to: string };
type Leaf = { line: Move[]; uci: string[]; plies: number };
type Row = {
  leaf: number;
  exitPly: number;
  opening: string;
  plies: number;
  afterExit: number;
  winner: 'red' | 'black' | null;
  reason: string;
  red: number;
  black: number;
  cls: string;
  /** The game in engine notation, opening included, so the record can be shown. */
  moves?: string[];
};
type Sweep = { nodes: number; rules: string[]; rows: Row[] };

/** Endings the rules decide, as opposed to stalls the referee adjudicates. */
const DECISIVE = new Set([
  'extinction',
  'stalemate',
  'checkmate',
  'bare-general',
  'general-lost',
  'general-captured',
]);

function classify(reason: string, winner: string | null, afterExit: number): string {
  if (DECISIVE.has(reason) && afterExit === 0) return 'decided inside the cascade';
  if (DECISIVE.has(reason)) return afterExit <= 40 ? 'forced dump' : 'fight to the end';
  return winner ? 'stall, on count' : 'stall, equal';
}

/** The kernel the tree is walked with: the same rules the games are refereed under. */
function kernelFor(rules: string[]) {
  return createXiangqiRuleKernel(
    antiXiangqiKernelConfig(resolveRules(antiXiangqiVariant.ruleSchema, parseRuleArgs(rules))),
  );
}

/** Every exit of the cascade whose first move is Cb3xb10. */
function exits(treeKernel: ReturnType<typeof kernelFor>): Leaf[] {
  const leaves: Leaf[] = [];
  const walk = (state: XiangqiRuleState, line: Move[]) => {
    const captures = treeKernel.legalMoves(state).filter((m) => state.board[m.to] !== undefined);
    if (captures.length === 0) {
      leaves.push({ line, uci: line.map((m) => `${m.from}${m.to}`), plies: line.length });
      return;
    }
    for (const move of captures) walk(treeKernel.apply(state, move), [...line, move]);
  };
  walk(treeKernel.initial('tree'), []);
  return leaves.filter((l) => l.uci[0] === 'b3b10');
}

async function sweep(nodes: number, out: string, rules: string[]) {
  const leaves = exits(kernelFor(rules));
  const done: Sweep = existsSync(out)
    ? (JSON.parse(readFileSync(out, 'utf8')) as Sweep)
    : { nodes, rules, rows: [] };
  if (done.nodes !== nodes) throw new Error(`${out} holds a ${done.nodes}-node sweep`);
  const ctx = contextForVariant(antiXiangqiVariant, { rules, seed: 1 });
  const engine = await ctx.openEngine();
  const rootFen = ctx.kernel.fen(ctx.kernel.initial('root'));
  const policy = enginePolicy(ctx.kernel, engine, nodes, rootFen, { fresh: true });
  try {
    for (let i = done.rows.length; i < leaves.length; i += 1) {
      const leaf = leaves[i]!;
      engine.newGame();
      const played = await playGame(
        ctx.kernel,
        { red: policy, black: policy },
        { plyCap: 400, opening: leaf.line, gameId: `exit-${i}` },
      );
      const placement = ctx.kernel.fen(played.finalState).split(' ')[0] ?? '';
      const red = (placement.match(/[A-Z]/g) ?? []).length;
      const black = (placement.match(/[a-z]/g) ?? []).length;
      const afterExit = played.plies - leaf.plies;
      const cls = classify(played.reason, played.winner, afterExit);
      done.rows.push({
        leaf: i,
        exitPly: leaf.plies,
        opening: leaf.uci.join(' '),
        plies: played.plies,
        afterExit,
        winner: played.winner,
        reason: played.reason,
        red,
        black,
        cls,
        moves: played.moves,
      });
      writeFileSync(out, JSON.stringify(done, null, 1));
      console.log(
        `${String(i + 1).padStart(3)}/${leaves.length} exit ${String(leaf.plies).padStart(2)} -> ${cls.padEnd(19)} ${played.winner ?? 'draw'} by ${played.reason} in ${played.plies} (${red} v ${black})`,
      );
    }
  } finally {
    await engine.close();
  }
}

type V = 'red' | 'black' | 'draw';

function minimax(file: string) {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Sweep;
  const treeKernel = kernelFor(data.rules ?? []);
  const score = (v: V, mover: 'red' | 'black') => (v === mover ? 2 : v === 'draw' ? 1 : 0);
  for (const scoring of ['stall is a draw', 'stall goes to fewer pieces'] as const) {
    const leafValue = new Map<string, V>();
    for (const r of data.rows) {
      const decisive = DECISIVE.has(r.reason);
      const value: V = decisive
        ? (r.winner as V)
        : scoring === 'stall is a draw'
          ? 'draw'
          : r.red < r.black
            ? 'red'
            : r.black < r.red
              ? 'black'
              : 'draw';
      leafValue.set(r.opening, value);
    }
    const value = (state: XiangqiRuleState, line: string[]): V => {
      const captures = treeKernel.legalMoves(state).filter((m) => state.board[m.to] !== undefined);
      if (captures.length === 0) {
        const v = leafValue.get(line.join(' '));
        if (!v) throw new Error(`no row for ${line.join(' ')}; the sweep is incomplete`);
        return v;
      }
      const mover = (state.status as { turn: 'red' | 'black' }).turn;
      let best: V | null = null;
      for (const m of captures) {
        const v = value(treeKernel.apply(state, m), [...line, `${m.from}${m.to}`]);
        if (best === null || score(v, mover) > score(best, mover)) best = v;
      }
      return best as V;
    };
    const reached: string[] = [];
    const optimal = (state: XiangqiRuleState, line: string[]) => {
      const captures = treeKernel.legalMoves(state).filter((m) => state.board[m.to] !== undefined);
      if (captures.length === 0) {
        reached.push(line.join(' '));
        return;
      }
      const mover = (state.status as { turn: 'red' | 'black' }).turn;
      const options = captures.map((m) => ({
        m,
        v: value(treeKernel.apply(state, m), [...line, `${m.from}${m.to}`]),
      }));
      const best = Math.max(...options.map((o) => score(o.v, mover)));
      for (const o of options) {
        if (score(o.v, mover) === best)
          optimal(treeKernel.apply(state, o.m), [...line, `${o.m.from}${o.m.to}`]);
      }
    };
    const start = treeKernel.initial('root');
    const first = treeKernel.legalMoves(start).find((m) => m.from === 'b3');
    if (!first) throw new Error('no Cb3xb10 at the start');
    const after = treeKernel.apply(start, first);
    const classes: Record<string, number> = {};
    for (const r of data.rows) {
      const c = classify(r.reason, r.winner, r.afterExit);
      classes[c] = (classes[c] ?? 0) + 1;
    }
    console.log(
      `\n== ${scoring} (leaves from the ${data.nodes}-node sweep, ${data.rows.length} rows: ${JSON.stringify(classes)})`,
    );
    console.log(`   value of the cascade after 1. Cb3xb10: ${value(after, ['b3b10'])}`);
    optimal(after, ['b3b10']);
    console.log(`   exits reachable when neither side makes a losing choice: ${reached.length}`);
    for (const l of reached) {
      const r = data.rows.find((x) => x.opening === l);
      console.log(
        `     ${l}  ->  ${leafValue.get(l)} (${r?.reason} in ${r?.plies}, ${r?.red} v ${r?.black})`,
      );
    }
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      nodes: { type: 'string', default: '100000' },
      out: { type: 'string' },
      rules: { type: 'string', multiple: true, default: [] },
    },
  });
  const command = positionals[0];
  if (command === 'sweep') {
    if (!values.out) throw new Error('--out <file.json> is required');
    await sweep(Number(values.nodes), values.out, values.rules ?? []);
  } else if (command === 'minimax') {
    const file = positionals[1];
    if (!file) throw new Error('minimax <file.json>');
    minimax(file);
  } else {
    throw new Error('usage: sweep --nodes N --out file.json [--rules k=v] | minimax file.json');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
