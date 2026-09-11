// Does the engine actually speak this variant? Identity, the variant-took
// proof, and the exact legal-move set at the start position against the
// kernel's. Run this before believing any number the engine produces.

import type { LabContext } from '../context.js';

export type AssertVariantResult = {
  idName: string;
  binaryPath: string;
  announcedStartFen: string | null;
  startMoves: number;
  onlyKernel: string[];
  onlyEngine: string[];
  ok: boolean;
};

export async function assertVariant(ctx: LabContext): Promise<AssertVariantResult> {
  const startedAt = new Date();
  const engine = await ctx.openEngine();
  try {
    const start = ctx.kernel.initial('assert');
    const kernelKeys = new Set<string>(
      ctx.kernel.legalMoves(start).map((m: unknown) => ctx.kernel.moveKey(m)),
    );
    const engineKeys = new Set<string>();
    for (const uci of await engine.legalMoves('startpos')) {
      const move = ctx.kernel.fromUci(start, uci);
      engineKeys.add(move ? ctx.kernel.moveKey(move) : `unparsed:${uci}`);
    }
    const onlyKernel = [...kernelKeys].filter((k) => !engineKeys.has(k)).sort();
    const onlyEngine = [...engineKeys].filter((k) => !kernelKeys.has(k)).sort();
    const result: AssertVariantResult = {
      idName: engine.identity!.idName,
      binaryPath: engine.binaryPath,
      announcedStartFen: engine.announcedStartFen,
      startMoves: kernelKeys.size,
      onlyKernel,
      onlyEngine,
      ok: onlyKernel.length === 0 && onlyEngine.length === 0,
    };
    const file = ctx.finish('assert-variant', {}, engine.identity, result, startedAt);
    console.log(`${ctx.variant.title} on ${result.idName}`);
    console.log(`  binary   ${result.binaryPath}`);
    console.log(
      `  variant  ${ctx.engineSpec.variant} took: ${result.startMoves} legal moves at the start`,
    );
    if (result.announcedStartFen) console.log(`  startpos ${result.announcedStartFen}`);
    if (result.ok) console.log('  start-position move sets agree');
    else {
      console.log(`  DISAGREE  only kernel: ${onlyKernel.join(' ') || '-'}`);
      console.log(`            only engine: ${onlyEngine.join(' ') || '-'}`);
    }
    console.log(`  artifact ${file}`);
    return result;
  } finally {
    await engine.close();
  }
}
