// The fidelity gate: does the engine's ruleset equal the kernel's?
//
// Three instruments, because each sees what the others cannot:
//
//  1. perft from the start array, to `--depth`. One number that subsumes every
//     rule the first plies touch. It cannot reach a rule that only binds later
//     (facing, stalemate), and a convention difference in how a terminal move
//     is counted shows up here as a false disagreement, which is why an
//     adapter can mark its counts non-comparable.
//  2. the variant's discriminating positions, each compared as an exact
//     legal-move SET, so a failure names the moves the two sides disagree on.
//  3. a differential over positions reached by random play (`--positions`),
//     the instrument that found every real duck bug: rules bind in positions
//     nobody thought to write down.

import type { LabContext } from '../context.js';
import type { LabEngine } from '../engine.js';
import { randomPolicy } from '../play.js';
import { mulberry32 } from '../rng.js';

export type SetDisagreement = {
  name: string;
  fen: string;
  onlyKernel: string[];
  onlyEngine: string[];
};
export type PerftRow = { name: string; fen: string; depth: number; kernel: number; engine: number };

export type PerftGateResult = {
  depth: number;
  perft: PerftRow[];
  countsComparable: boolean;
  setsChecked: number;
  disagreements: SetDisagreement[];
  unparseable: string[];
  ok: boolean;
};

export type PerftGateArgs = { depth: number; positions: number; games: number };

// biome-ignore lint/suspicious/noExplicitAny: generic over the adapter's types
function kernelPerft(kernel: LabContext['kernel'], state: any, depth: number): number {
  const moves = kernel.legalMoves(state);
  if (depth <= 1) return moves.length;
  let total = 0;
  for (const move of moves) total += kernelPerft(kernel, kernel.apply(state, move), depth - 1);
  return total;
}

async function compareSets(
  ctx: LabContext,
  engine: LabEngine,
  name: string,
  // biome-ignore lint/suspicious/noExplicitAny: generic over the adapter's types
  state: any,
  root: string,
): Promise<SetDisagreement | null> {
  const kernelKeys = new Set<string>(
    ctx.kernel.legalMoves(state).map((m: unknown) => ctx.kernel.moveKey(m)),
  );
  const engineKeys = new Set<string>();
  for (const uci of await engine.legalMoves(root)) {
    const move = ctx.kernel.fromUci(state, uci);
    engineKeys.add(move ? ctx.kernel.moveKey(move) : `unparsed:${uci}`);
  }
  const onlyKernel = [...kernelKeys].filter((k) => !engineKeys.has(k)).sort();
  const onlyEngine = [...engineKeys].filter((k) => !kernelKeys.has(k)).sort();
  if (onlyKernel.length === 0 && onlyEngine.length === 0) return null;
  return { name, fen: ctx.kernel.fen(state), onlyKernel, onlyEngine };
}

export async function perftGate(ctx: LabContext, args: PerftGateArgs): Promise<PerftGateResult> {
  const startedAt = new Date();
  const engine = await ctx.openEngine();
  const countsComparable = ctx.variant.perftCountsComparable ?? true;
  try {
    const perft: PerftRow[] = [];
    const disagreements: SetDisagreement[] = [];
    const unparseable: string[] = [];
    let setsChecked = 0;

    const start = ctx.kernel.initial('gate');
    for (let depth = 1; depth <= args.depth; depth += 1) {
      perft.push({
        name: 'start',
        fen: ctx.kernel.fen(start),
        depth,
        kernel: kernelPerft(ctx.kernel, start, depth),
        engine: await engine.perft(
          'startpos',
          depth,
          Math.max(ctx.engineOptions.timeoutMs ?? 60_000, 600_000),
        ),
      });
    }
    const startDisagreement = await compareSets(ctx, engine, 'start', start, 'startpos');
    setsChecked += 1;
    if (startDisagreement) disagreements.push(startDisagreement);

    for (const position of ctx.variant.discriminatingPositions) {
      const state = ctx.kernel.parseFen(position.fen, `gate-${position.name}`);
      if (!state) {
        unparseable.push(`${position.name}: ${position.fen}`);
        continue;
      }
      const root = ctx.kernel.fen(state);
      for (let depth = 1; depth <= args.depth; depth += 1) {
        perft.push({
          name: position.name,
          fen: root,
          depth,
          kernel: kernelPerft(ctx.kernel, state, depth),
          engine: await engine.perft(root, depth),
        });
      }
      const disagreement = await compareSets(ctx, engine, position.name, state, root);
      setsChecked += 1;
      if (disagreement) disagreements.push(disagreement);
    }

    // Differential over real play. Positions are sampled sparsely across many
    // games so they do not all come from one line.
    const rng = mulberry32(ctx.seed);
    const random = randomPolicy(ctx.kernel, rng);
    let sampled = 0;
    for (let game = 0; game < args.games && sampled < args.positions; game += 1) {
      let state = ctx.kernel.initial(`gate-walk-${game}`);
      const history: string[] = [];
      for (let ply = 0; ply < ctx.plyCap && sampled < args.positions; ply += 1) {
        if (ctx.kernel.status(state).type !== 'playing') break;
        if (rng() < args.positions / Math.max(1, args.games * 60)) {
          const disagreement = await compareSets(
            ctx,
            engine,
            `walk g${game} p${ply}`,
            state,
            ctx.kernel.fen(state),
          );
          setsChecked += 1;
          sampled += 1;
          if (disagreement) disagreements.push(disagreement);
        }
        const move = await random(state, history);
        if (move === null) break;
        history.push(ctx.kernel.toUci(move));
        state = ctx.kernel.apply(state, move);
      }
    }

    const countsOk = perft.every((row) => row.kernel === row.engine);
    const result: PerftGateResult = {
      depth: args.depth,
      perft,
      countsComparable,
      setsChecked,
      disagreements,
      unparseable,
      ok: disagreements.length === 0 && unparseable.length === 0 && (countsOk || !countsComparable),
    };
    const file = ctx.finish('perft-gate', { ...args }, engine.identity, result, startedAt);

    console.log(`${ctx.variant.title}: perft gate ${result.ok ? 'GREEN' : 'RED'}`);
    for (const row of perft) {
      const mark = row.kernel === row.engine ? 'ok ' : countsComparable ? 'BAD' : '~  ';
      console.log(
        `  ${mark} perft(${row.depth}) ${row.name.padEnd(28)} kernel ${row.kernel}  engine ${row.engine}`,
      );
    }
    if (!countsComparable)
      console.log('  (~ counts are not comparable for this variant by declaration; sets are)');
    console.log(`  move sets checked: ${setsChecked}, disagreements: ${disagreements.length}`);
    for (const d of disagreements) {
      console.log(
        `  DISAGREE ${d.name}\n    fen ${d.fen}\n    only kernel: ${d.onlyKernel.join(' ') || '-'}\n    only engine: ${d.onlyEngine.join(' ') || '-'}`,
      );
    }
    for (const u of unparseable) console.log(`  UNPARSEABLE ${u}`);
    console.log(`  artifact ${file}`);
    return result;
  } finally {
    await engine.close();
  }
}
