// The results table, generated from artifacts and never hand-copied.
//
// Every row names the rules hash and engine it was measured under. Rows whose
// rules differ from the rules given on the command line are marked STALE with
// the rules that changed and the widest blast radius among them, so after a
// design flip the table says which numbers survive (terminal: re-score from
// the logs) and which do not (movegen: replay).

import { writeFileSync } from 'node:fs';
import { readArtifacts } from '../artifacts.js';
import type { LabContext } from '../context.js';
import { locateBinary, sha256File } from '../engine.js';
import { diffRules, LAB_VERSION } from '../rules.js';
import { pct } from '../stats.js';
import type { Artifact } from '../types.js';
import type { AssertVariantResult } from './assert-variant.js';
import type { BestplayResult } from './bestplay.js';
import type { LadderResult } from './ladder.js';
import type { MatchResult } from './match.js';
import type { PerftGateResult } from './perft-gate.js';
import type { RandomplayResult } from './randomplay.js';

export type ReportArgs = { write?: string };

function headline(artifact: Artifact<unknown>): string {
  switch (artifact.command) {
    case 'assert-variant': {
      const r = artifact.result as AssertVariantResult;
      return r.ok
        ? `took, ${r.startMoves} start moves agree`
        : `DISAGREE (${r.onlyKernel.length}/${r.onlyEngine.length})`;
    }
    case 'perft-gate': {
      const r = artifact.result as PerftGateResult;
      return `${r.ok ? 'GREEN' : 'RED'}, depth ${r.depth}, ${r.setsChecked} sets, ${r.disagreements.length} disagree`;
    }
    case 'randomplay': {
      const r = artifact.result as RandomplayResult;
      return `red ${pct(r.redScore)}, median ${r.lengths.median} plies, ${r.games} games`;
    }
    case 'ladder': {
      const r = artifact.result as LadderResult;
      const elo = Number.isFinite(r.eloForBudget) ? `${Math.round(r.eloForBudget)}` : '>400';
      return `${r.hi}/${r.lo}: stronger ${pct(r.hiScore)}, ~${elo} Elo`;
    }
    case 'bestplay': {
      const r = artifact.result as BestplayResult;
      return r.games
        .map((g) => `${g.nodes}: ${g.winner ?? 'draw'} (${g.reason}, ${g.plies})`)
        .join('; ');
    }
    case 'match': {
      const r = artifact.result as MatchResult;
      return `engine ${r.engineWins}-${r.randomWins}-${r.undecided} at ${r.nodes} nodes`;
    }
    default:
      return '(unknown command)';
  }
}

export function report(ctx: LabContext, args: ReportArgs): string {
  const artifacts = readArtifacts(ctx.outDir, ctx.variant.id).sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : 1,
  );
  let currentBinary: string | null = null;
  try {
    currentBinary = sha256File(locateBinary(ctx.engineSpec.binary));
  } catch {
    currentBinary = null;
  }
  const currentRules = ctx.rules;

  const lines: string[] = [];
  lines.push(`# ${ctx.variant.title}: lab results`);
  lines.push('');
  lines.push(
    `Current rules: \`${JSON.stringify(currentRules)}\`. ${artifacts.length} artifact(s) under \`${ctx.outDir}\`.`,
  );
  lines.push('');
  lines.push('| when | command | result | rules | engine | status |');
  lines.push('|---|---|---|---|---|---|');
  for (const a of artifacts) {
    const { changed, blast } = diffRules(ctx.variant.ruleSchema, a.rules, currentRules);
    const engineTag = a.engine
      ? `${a.engine.idName} ${a.engine.binarySha256.slice(0, 8)}`
      : 'kernel only';
    const flags: string[] = [];
    if (changed.length) flags.push(`STALE rules (${changed.join(', ')}; ${blast})`);
    if (a.engine && currentBinary && a.engine.binarySha256 !== currentBinary)
      flags.push('STALE engine');
    if (a.lab !== LAB_VERSION) flags.push(`STALE lab (v${a.lab} vs v${LAB_VERSION})`);
    lines.push(
      `| ${a.startedAt.slice(0, 16).replace('T', ' ')} | ${a.command} | ${headline(a)} | ${a.rulesHash} | ${engineTag} | ${flags.join('; ') || 'current'} |`,
    );
  }
  if (artifacts.length === 0) lines.push('| - | - | no artifacts yet | - | - | - |');
  const text = `${lines.join('\n')}\n`;
  if (args.write) writeFileSync(args.write, text);
  process.stdout.write(text);
  return text;
}
