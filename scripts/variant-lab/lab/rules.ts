// Rules records: parsing `--rules key=value`, resolving defaults against a
// schema, and hashing the result so every artifact can say which ruleset
// produced it.

import { createHash } from 'node:crypto';
import type { BlastRadius, RuleSchema, RulesRecord, RuleValue } from './types.js';

/** The lab's own version; bump when a change alters what an artifact means. */
export const LAB_VERSION = '1';

function parseRuleValue(raw: string): RuleValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/** `["a=1", "b=x,c=true"]` → `{a: 1, b: "x", c: true}`. */
export function parseRuleArgs(args: readonly string[]): RulesRecord {
  const out: Record<string, RuleValue> = {};
  for (const arg of args) {
    for (const pair of arg.split(',')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) throw new Error(`rule must be key=value, got "${trimmed}"`);
      out[trimmed.slice(0, eq)] = parseRuleValue(trimmed.slice(eq + 1));
    }
  }
  return out;
}

/**
 * Fill defaults and reject anything the schema does not know. An unknown key
 * is an error rather than a warning: a misspelled rule that silently falls
 * back to its default is exactly the flip-that-did-not-happen this exists to
 * prevent.
 */
export function resolveRules(schema: RuleSchema, given: RulesRecord): RulesRecord {
  const out: Record<string, RuleValue> = {};
  for (const [key, spec] of Object.entries(schema)) out[key] = spec.default;
  for (const [key, value] of Object.entries(given)) {
    const spec = schema[key];
    if (!spec)
      throw new Error(`unknown rule "${key}"; known: ${Object.keys(schema).join(', ') || 'none'}`);
    if (!spec.options.includes(value)) {
      throw new Error(
        `rule "${key}" cannot be ${JSON.stringify(value)}; options: ${spec.options.join(' | ')}`,
      );
    }
    out[key] = value;
  }
  return out;
}

/** Canonical JSON: keys sorted, so `{a,b}` and `{b,a}` hash alike. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function rulesHash(variantId: string, rules: RulesRecord): string {
  return shortHash(canonicalJson({ variant: variantId, rules }));
}

/**
 * Which rules differ between two records, with the widest blast radius among
 * them. This is what the report uses to say "these rows are stale, and a
 * flip of `X` means replaying everything" versus "re-score from the logs".
 */
export function diffRules(
  schema: RuleSchema,
  a: RulesRecord,
  b: RulesRecord,
): { changed: string[]; blast: BlastRadius | null } {
  const changed: string[] = [];
  let blast: BlastRadius | null = null;
  const rank: Record<BlastRadius, number> = { cosmetic: 0, terminal: 1, movegen: 2 };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === b[key]) continue;
    changed.push(key);
    const spec = schema[key];
    const radius = spec?.blast ?? 'movegen';
    if (blast === null || rank[radius] > rank[blast]) blast = radius;
  }
  return { changed: changed.sort(), blast };
}
