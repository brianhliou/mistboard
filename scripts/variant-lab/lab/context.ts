// What every command needs: the variant bound to its rules, the engine
// description, where artifacts go, and the seed. Built once by the CLI and
// handed to the command.

import { resolve } from 'node:path';
import { defaultOutDir, makeHeader, writeArtifact } from './artifacts.js';
import { type EngineOptions, LabEngine } from './engine.js';
import { parseRuleArgs, resolveRules } from './rules.js';
import type {
  AnyLabVariant,
  EngineIdentity,
  LabEngineSpec,
  LabKernel,
  RulesRecord,
  RuleValue,
} from './types.js';
import { findLabVariant } from './variants/index.js';

export type LabContext = {
  variant: AnyLabVariant;
  rules: RulesRecord;
  // biome-ignore lint/suspicious/noExplicitAny: commands are generic over the adapter's types
  kernel: LabKernel<any, any>;
  engineSpec: LabEngineSpec;
  outDir: string;
  seed: number;
  engineOptions: EngineOptions;
  plyCap: number;
  /** Opens the engine and proves the variant took at the start position. */
  openEngine(): Promise<LabEngine>;
  /** Writes the artifact for a finished command and returns its path. */
  finish<T>(
    command: string,
    args: Record<string, RuleValue>,
    engine: EngineIdentity | null,
    result: T,
    startedAt: Date,
  ): string;
};

export type ContextInput = {
  variant: string;
  rules?: readonly string[];
  out?: string;
  seed?: number;
  threads?: number;
  hashMb?: number;
  timeoutMs?: number;
  plyCap?: number;
};

export function buildContext(input: ContextInput): LabContext {
  const variant = findLabVariant(input.variant);
  const rules = resolveRules(variant.ruleSchema, parseRuleArgs(input.rules ?? []));
  const { kernel, engine: engineSpec } = variant.create(rules);
  const outDir = input.out ? resolve(input.out) : defaultOutDir();
  const seed = input.seed ?? 1;
  const engineOptions: EngineOptions = {
    threads: input.threads ?? 1,
    hashMb: input.hashMb ?? 64,
    timeoutMs: input.timeoutMs ?? 60_000,
  };
  return {
    variant,
    rules,
    kernel,
    engineSpec,
    outDir,
    seed,
    engineOptions,
    plyCap: input.plyCap ?? 400,
    async openEngine() {
      const engine = new LabEngine(engineSpec, engineOptions);
      await engine.open(kernel.legalMoves(kernel.initial('start')).length);
      return engine;
    },
    finish(command, args, engine, result, startedAt) {
      const header = makeHeader({
        command,
        variant: variant.id,
        rules,
        engine,
        args,
        seed,
        startedAt,
      });
      return writeArtifact(outDir, header, result);
    },
  };
}
