#!/usr/bin/env node
// Generate an offline study:edit create plan. This never connects to a database.
//   node scripts/gomoku-openings-study-plan.mjs --out /tmp/gomoku-openings-plan.json
// Review it separately with: npm run study:edit -- --plan <file> (no --apply).
//
// Chapter-count audit: persistence-studies.ts (createStudy/addChapter),
// routes/studies.ts and study-edit-cli.ts impose no chapter-count cap. The
// MAX_CHAPTERS = 1000 in study-page-body.ts only bounds crawler-visible names.
// All 247 openings therefore belong in one study, preserving the pool order;
// no split by stone count is necessary.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { tsImport } from 'tsx/esm/api';

const { createInitialGomokuState, gomokuFen } = await tsImport(
  '../packages/game/src/variants-gomoku.ts',
  import.meta.url,
);

export function buildGomokuOpeningsPlan(pool) {
  if (!pool.openings.length) throw new Error('The Gomoku openings pool is empty');
  if (pool.screening.scorePerspective !== 'side-to-move') {
    throw new Error(`Unsupported screening perspective: ${pool.screening.scorePerspective}`);
  }
  const chapters = pool.openings.map((opening) => {
    const classic = opening.classicId ? ` · ${opening.classicId.replaceAll('-', ' ')}` : '';
    const side = opening.turn === 'black' ? 'Black' : 'White';
    return {
      name: `${opening.id}${classic}`,
      tree: {
        version: 1,
        rootFen: gomokuFen(createInitialGomokuState(opening)),
        root: {
          annotations: {
            comments: [
              {
                text:
                  `${side} to move. Screening winrate: ` +
                  `${(opening.screening.winrate * 100).toFixed(2)}% ` +
                  `(side-to-move perspective: ${side}).`,
              },
            ],
          },
          children: [],
        },
      },
    };
  });
  const [first, ...rest] = chapters;
  return {
    create: {
      owner: 'mistboard',
      name: 'Gomoku: every dealt opening',
      visibility: 'unlisted',
      chapter: { ...first, variant: 'gomoku' },
    },
    ops: rest.map((chapter) => ({ op: 'add', ...chapter })),
  };
}

function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    throw new Error('Usage: node scripts/gomoku-openings-study-plan.mjs --out <plan.json>');
  }
  const pool = JSON.parse(
    readFileSync(new URL('../packages/game/src/gomoku-openings.json', import.meta.url), 'utf8'),
  );
  const plan = buildGomokuOpeningsPlan(pool);
  const path = resolve(values.out);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`${pool.openings.length} chapters in 1 study (no server chapter-count cap).`);
  console.log(`Plan: ${path}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
