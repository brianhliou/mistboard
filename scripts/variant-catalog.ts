// Variant catalog generator — the single legible answer to "what variants exist
// and what is their status," derived from the registry so it cannot drift.
//
// Status columns (Surface / Runtime / Rated) are AUTHORITATIVE: read straight from
// packages/game/src/game-specs.ts. Content columns (Rules / Sample / PvE / Puzzles /
// Postgame / zh) are DETECTED by file convention (best-effort), so they answer
// "is this variant product-ready" at a glance without trusting tribal knowledge.
//
// Usage: npx tsx scripts/variant-catalog.ts [--out <file>]
// Output default: docs-private/VARIANTS.md

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalVariantOrderIndex, GAME_SPECS } from '@mistboard/game';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const SPEC_IDS = GAME_SPECS.map((s) => s.id);
// Longest id first so `jungle-flip` claims its files before `jungle`,
// `dark-xiangqi` before `xiangqi`, etc.
const IDS_BY_LEN = [...SPEC_IDS].sort((a, b) => b.length - a.length);
function attribute(filename: string): string | null {
  return IDS_BY_LEN.find((id) => filename.includes(id)) ?? null;
}
function listDir(rel: string, exts: string[]): string[] {
  const p = resolve(REPO, rel);
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((f) => exts.some((e) => f.endsWith(e)));
}

const webFiles = listDir('apps/web/src', ['.ts']);
const serverFiles = listDir('apps/server/src', ['.ts', '.ini']);
const gameFiles = listDir('packages/game/src', ['.ts']);
const labFiles = listDir('scripts/variant-lab', ['.ts', '.ini']);

function hasFileFor(files: string[], id: string, match: (f: string) => boolean): boolean {
  return files.some((f) => match(f) && attribute(f) === id);
}

function articleStatus(id: string): 'published' | 'draft' | 'outline' | 'missing' {
  const p = resolve(REPO, 'apps/web/src/articles/content', `${id}.ts`);
  if (!existsSync(p)) return 'missing';
  const m = /status:\s*['"](published|draft|outline)['"]/.exec(readFileSync(p, 'utf8'));
  return (m?.[1] as 'published' | 'draft' | 'outline') ?? 'draft';
}

type Row = {
  id: string;
  name: string;
  family: string;
  surface: string;
  runtime: string;
  rated: boolean;
  rules: 'published' | 'draft' | 'outline' | 'missing';
  sample: boolean;
  engine: 'fsf' | 'ts' | 'none';
  puzzles: boolean;
  postgame: boolean;
};

function buildRow(spec: (typeof GAME_SPECS)[number]): Row {
  const id = spec.id;
  const ini = hasFileFor(serverFiles, id, (f) => f.endsWith('.ini'));
  const engineTs = hasFileFor(serverFiles, id, (f) => /engine/.test(f));
  return {
    id,
    name: spec.publicName,
    family: spec.family,
    surface: spec.publicSurface,
    runtime: spec.runtimeStatus,
    rated: spec.rated === true,
    rules: articleStatus(id),
    sample: hasFileFor([...webFiles, ...labFiles], id, (f) => f.includes('sample-game')),
    engine: ini ? 'fsf' : engineTs ? 'ts' : 'none',
    puzzles: hasFileFor(gameFiles, id, (f) => f.startsWith('puzzles-') && !f.includes('.test')),
    postgame: hasFileFor(webFiles, id, (f) => f.includes('postgame')),
  };
}

const RULES_MARK = {
  published: '✅ pub',
  draft: '✎ draft',
  outline: '○ outline',
  missing: '— none',
};
const ENGINE_MARK = { fsf: 'FSF', ts: '● ts', none: '—' };
const yn = (b: boolean) => (b ? '●' : '—');

function main(): void {
  const rows = GAME_SPECS.map(buildRow).sort(
    (a, b) =>
      canonicalVariantOrderIndex(a.id as never) - canonicalVariantOrderIndex(b.id as never) ||
      a.id.localeCompare(b.id),
  );

  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const live = count((r) => r.runtime === 'live');
  const devSpike = count((r) => r.runtime === 'dev-spike');
  const future = count((r) => r.runtime === 'future');
  const rated = count((r) => r.rated);
  const listedLive = rows.filter((r) => r.runtime !== 'future' && r.surface !== 'hidden');
  const rulesGap = listedLive.filter((r) => r.rules !== 'published');

  const tableRows = rows
    .map(
      (r) =>
        `| ${r.name} <br>\`${r.id}\` | ${r.family} | ${r.surface} | ${r.runtime} | ${
          r.rated ? '●' : '—'
        } | ${RULES_MARK[r.rules]} | ${yn(r.sample)} | ${ENGINE_MARK[r.engine]} | ${yn(
          r.puzzles,
        )} | ${yn(r.postgame)} |`,
    )
    .join('\n');

  const md = `# Mistboard variant catalog

> **Generated file — do not edit by hand.** Regenerate with \`npx tsx scripts/variant-catalog.ts\`.
> Derived from \`packages/game/src/game-specs.ts\` (the registry). The **Surface / Runtime /
> Rated** columns are authoritative from the registry; the content columns (**Rules /
> Sample / PvE / Puzzles / Postgame**) are detected by file convention (best-effort).
> (zh coverage is not a column: it is globally enforced for every published article by
> \`apps/web/src/article-i18n.coverage.test.ts\`, so "published rules" already implies "translated".)

## Summary

- **${rows.length} specs** — ${live} live, ${devSpike} dev-spike, ${future} future (placeholder, no implementation).
- **${rated} rated pools** (light up when \`MISTBOARD_RATED_ENABLED\` is on).
- **${listedLive.length} listed-live specs**; of those, **${rulesGap.length}** lack a published rules article.

## Catalog

Ordered by \`CANONICAL_VARIANT_ORDER\` (display order); future placeholders sort last.

| Variant | Family | Surface | Runtime | Rated | Rules | Sample | PvE | Puzzles | Postgame |
|---|---|---|---|:-:|---|:-:|:-:|:-:|:-:|
${tableRows}

## Worth attention

- **Dev-spike (wired, hidden):** ${
    rows
      .filter((r) => r.runtime === 'dev-spike')
      .map((r) => `\`${r.id}\``)
      .join(', ') || 'none'
  }
- **Future placeholders (taxonomy only, no tenant/engine/client):** ${
    rows
      .filter((r) => r.runtime === 'future')
      .map((r) => `\`${r.id}\``)
      .join(', ') || 'none'
  }
- **Listed-live but rules not published:** ${
    rulesGap.map((r) => `\`${r.id}\` (${r.rules})`).join(', ') ||
    'none — all listed variants have published rules'
  }

## Legend

- **Surface** (\`publicSurface\`): \`hidden\` · \`beta\` · \`casual\` · \`rated\` — controls discoverability rails/tiles.
- **Runtime** (\`runtimeStatus\`): \`live\` · \`dev-spike\` (fully wired, hidden) · \`future\` (taxonomy placeholder).
- **Rated**: ● = has an active rating pool (\`rated: true\`).
- **Rules**: ✅ published · ✎ draft · ○ outline · — no \`articles/content/<id>.ts\`.
- **Sample / Puzzles / Postgame**: ● detected by file convention.
- **PvE**: \`FSF\` = Fairy-Stockfish \`.ini\` · \`● ts\` = a server engine module · — none detected (fog variants serve via the Obscuro worker, not detected here).
`;

  const outPath = resolve(arg('out', resolve(REPO, 'docs-private', 'VARIANTS.md')));
  writeFileSync(outPath, md);
  console.log(`wrote ${outPath}`);
  console.log(
    `\n${rows.length} specs | ${live} live, ${devSpike} dev-spike, ${future} future | ${rated} rated | ${rulesGap.length} listed-live rules gaps`,
  );
  if (rulesGap.length)
    console.log(`rules gaps: ${rulesGap.map((r) => `${r.id}(${r.rules})`).join(', ')}`);
}

main();
