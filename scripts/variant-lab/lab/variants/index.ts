// Every variant the lab can measure, discovered from this directory.
//
// A new variant is one file here named `<id>.ts` that exports a `LabVariant`
// (any export name; the first export with an `id` and a `create` is taken).
// Nothing else changes, so sessions working on different variants in
// different worktrees never edit the same file.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnyLabVariant } from '../types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function isLabVariant(value: unknown): value is AnyLabVariant {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyLabVariant).id === 'string' &&
    typeof (value as AnyLabVariant).create === 'function'
  );
}

export function labVariantIds(): string[] {
  return readdirSync(HERE)
    .filter((f) => /^[a-z0-9-]+\.ts$/.test(f) && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

export async function findLabVariant(id: string): Promise<AnyLabVariant> {
  if (!/^[a-z0-9-]+$/.test(id) || !labVariantIds().includes(id)) {
    throw new Error(`unknown lab variant "${id}"; known: ${labVariantIds().join(', ')}`);
  }
  const mod = (await import(join(HERE, `${id}.js`))) as Record<string, unknown>;
  const found = Object.values(mod).find(isLabVariant);
  if (!found) throw new Error(`variants/${id}.ts exports no LabVariant`);
  if (found.id !== id) {
    throw new Error(
      `variants/${id}.ts exports a variant whose id is "${found.id}"; file and id must match`,
    );
  }
  return found;
}

export async function listLabVariants(): Promise<AnyLabVariant[]> {
  return Promise.all(labVariantIds().map((id) => findLabVariant(id)));
}
