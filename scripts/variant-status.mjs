#!/usr/bin/env node
// Which variants are LAUNCHED, which are flag-gated, which are only planned.
//
// Why this exists: that answer lived in four files that had to be joined by
// hand (spec runtimeStatus, the request gate, the tenant registry, the feature
// flags), so every session re-derived it — and got it wrong. Hand-maintained
// lists rot; docs-private/launch-state.md is superseded and still sitting
// there. This reads the code instead, so it cannot drift.
//
// Usage:
//   node scripts/variant-status.mjs            # table, code-derived
//   node scripts/variant-status.mjs --prod     # + live prod flags/engine pools
//   node scripts/variant-status.mjs --json
//
// Parsing is deliberately fail-loud: if a source file's shape changes, this
// throws rather than printing a confidently wrong table.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD_STATUS_URL = 'https://mistboard.com/api/server-status';
const PROD_BOTS_URL = 'https://mistboard.com/api/bots';

const SPECS = 'packages/game/src/game-specs.ts';
const GATE = 'apps/server/src/game-spec-request-gate.ts';
const REGISTRY = 'apps/web/src/variant-tenant/registry.ts';
const FLAGS = 'apps/server/src/feature-flags.ts';

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(
      `variant-status: ${message}\n` +
        'The source file shape changed. Fix the parser rather than trusting a partial read.',
    );
  }
}

/**
 * spec id -> { publicName, publicSurface, runtimeStatus }.
 *
 * GAME_SPECS mixes two id styles in one array — `id: DARK_CHESS_SPEC_ID` and
 * `id: 'dark-crazyhouse'`. Handle both. An earlier version of this parser read
 * only the const form, dropped 7 of 24 specs, and passed its own completeness
 * assert because that assert counted const-form lines too. The check below
 * counts every `id:` in the array body instead, so the parser is measured
 * against the file rather than against itself.
 */
function parseSpecs() {
  const text = read(SPECS);

  const consts = new Map(
    [...text.matchAll(/export const ([A-Z0-9_]+_SPEC_ID) = '([a-z0-9-]+)'/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  assert(consts.size > 0, `no *_SPEC_ID consts parsed from ${SPECS}`);

  const start = text.indexOf('export const GAME_SPECS');
  assert(start !== -1, `GAME_SPECS not found in ${SPECS}`);
  // Closes as `] as const;` today; tolerate a bare `];` too.
  const close = [text.indexOf('\n] as const', start), text.indexOf('\n];', start)]
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  assert(close !== undefined, `GAME_SPECS array is not closed in ${SPECS}`);
  const body = text.slice(start, close);

  const out = new Map();
  const token =
    /\bid:\s*(?:([A-Z0-9_]+_SPEC_ID)|'([a-z0-9-]+)')|\bpublicName:\s*'([^']+)'|\bpublicSurface:\s*'([a-z-]+)'|\bruntimeStatus:\s*'([a-z]+)'/g;
  let current = null;
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard /g regex iteration; exec() advances lastIndex so the assignment is the loop step.
  while ((match = token.exec(body)) !== null) {
    if (match[1] !== undefined || match[2] !== undefined) {
      let id = match[2];
      if (id === undefined) {
        id = consts.get(match[1]);
        assert(id !== undefined, `GAME_SPECS references unknown const ${match[1]}`);
      }
      current = { id, publicName: null, publicSurface: null, runtimeStatus: null };
      out.set(id, current);
    } else if (current) {
      if (match[3] !== undefined) current.publicName ??= match[3];
      else if (match[4] !== undefined) current.publicSurface ??= match[4];
      else if (match[5] !== undefined) current.runtimeStatus ??= match[5];
    }
  }

  const idCount = (body.match(/\bid:\s*(?:[A-Z0-9_]+_SPEC_ID|'[a-z0-9-]+')/g) ?? []).length;
  assert(
    out.size === idCount && idCount > 0,
    `parsed ${out.size} specs but GAME_SPECS has ${idCount} id: entries — parser is dropping some`,
  );
  const incomplete = [...out.values()].filter((s) => !s.runtimeStatus);
  assert(
    incomplete.length === 0,
    `specs missing runtimeStatus: ${incomplete.map((s) => s.id).join(', ')}`,
  );
  return out;
}

/** spec id -> { flagged: boolean } for everything in GATED_GAME_SPECS. */
function parseGate() {
  const text = read(GATE);
  const start = text.indexOf('const GATED_GAME_SPECS = {');
  assert(start !== -1, `GATED_GAME_SPECS not found in ${GATE}`);
  const end = text.indexOf('\n} as const', start);
  const body = text.slice(start, end === -1 ? text.length : end);

  const out = new Map();
  // Entries are `'dark-xiangqi': { … }` or bare `jieqi: { … }`.
  const entry = /(?:'([a-z0-9-]+)'|\b([a-z][a-zA-Z0-9]*)):\s*\{([^}]*)\}/g;
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard /g regex iteration; exec() advances lastIndex so the assignment is the loop step.
  while ((match = entry.exec(body)) !== null) {
    const id = match[1] ?? kebab(match[2]);
    out.set(id, { flagged: /\benabled:/.test(match[3]) });
  }
  assert(out.size > 0, `no gate entries parsed from ${GATE}`);
  return out;
}

function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Spec ids that have a registered variant tenant, plus the engines defined. */
function parseRegistry() {
  const text = read(REGISTRY);
  const importBlock = text.slice(text.indexOf('import {'), text.indexOf('} from'));
  const tenants = new Set(
    [...importBlock.matchAll(/([A-Z0-9_]+)_SPEC_ID/g)].map((m) => kebabConst(m[1])),
  );
  assert(tenants.size > 0, `no *_SPEC_ID imports parsed from ${REGISTRY}`);

  // Read each engine as (id, gameSpecId). Two things an earlier version got
  // wrong, both of which printed 'no bot' for a variant that has one:
  //   - engine ids carry dots ('python-v2-v1.6'), so the charclass needs one;
  //   - an engine id does NOT reliably embed the spec it serves. Misty DXQ is
  //     'python-fdx-v1.1' and serves 'dark-xiangqi'. Only the explicit
  //     gameSpecId field connects them.
  // \bid: cannot match inside 'engineId'/'gameSpecId' (preceding word char, and
  // those spell it 'Id'), so this stays limited to the entry's own id field.
  const hits = [...text.matchAll(/\bid:\s*'([a-z0-9.-]+)'/g)];
  const bots = hits.map((m, i) => {
    const entry = text.slice(m.index, hits[i + 1]?.index ?? text.length);
    const spec = /\bgameSpecId:\s*'([a-z0-9-]+)'/.exec(entry);
    return { id: m[1], gameSpecId: spec?.[1] ?? null };
  });
  return { tenants, bots };
}

function kebabConst(s) {
  return s.toLowerCase().replace(/_/g, '-');
}

/** Flag function name -> env var, from feature-flags.ts. */
function parseFlags() {
  const text = read(FLAGS);
  const out = new Map();
  const fn = /export function (\w+)\(\): boolean \{\s*return process\.env\.(\w+)/g;
  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard /g regex iteration; exec() advances lastIndex so the assignment is the loop step.
  while ((match = fn.exec(text)) !== null) out.set(match[1], match[2]);
  assert(out.size > 0, `no feature flags parsed from ${FLAGS}`);
  return out;
}

function classify({ runtimeStatus, publicSurface, gate, registered }) {
  if (runtimeStatus === 'retired') return 'retired';
  if (runtimeStatus === 'future') return 'planned';
  if (!gate) return 'chess-stack'; // excluded from the gate union
  if (!gate.flagged) return 'not-integrated';
  if (!registered) return 'flagged-no-tenant';
  return publicSurface === 'hidden' ? 'built-hidden' : 'flag-gated';
}

const LEGEND = {
  'flag-gated': "built + registered + publicSurface 'casual'; live iff its env flag is on",
  'built-hidden': "built + registered but publicSurface 'hidden' — not offered publicly",
  'flagged-no-tenant': 'has a launch flag but no tenant — would 501',
  'not-integrated': 'reserved in the gate, never built; every request 501s',
  planned: "runtimeStatus 'future' — an id only",
  retired:
    "runtimeStatus 'retired' — refused by the gate, no tenant, code being removed (#396). Hidden unless --all",
  'chess-stack': 'legacy chess path, outside the tenant registry',
};

async function fetchProd() {
  try {
    const res = await fetch(PROD_STATUS_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    const flags = Object.fromEntries(
      Object.entries(body).filter(([k, v]) => k.endsWith('Enabled') && typeof v === 'boolean'),
    );
    const pools = (body.enginePools?.pools ?? []).map((p) => p.name);
    return { flags, pools, revision: body.build?.revision?.slice(0, 8) ?? null };
  } catch (err) {
    return { error: err.message };
  }
}

// Which specs prod will actually seat a bot for. The registry cannot answer
// this: an engine is offered either through PROD_PLAYABLE_ENGINE_IDS (the legacy
// chess picker) or as a tenant route default, and the second is invisible to a
// static read of the file. /api/bots is the only honest source.
async function fetchProdBots() {
  try {
    const res = await fetch(PROD_BOTS_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.bots ?? []);
    const playable = new Map();
    for (const bot of list) {
      for (const opt of bot.playOptions ?? []) {
        if (!opt.playable || !opt.gameSpecId) continue;
        const who = playable.get(opt.gameSpecId) ?? new Set();
        who.add(bot.displayName ?? bot.id);
        playable.set(opt.gameSpecId, who);
      }
    }
    return { playable };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantProd = args.includes('--prod');
  const asJson = args.includes('--json');
  // Retired specs are not variants to anyone; they are listed only on request
  // so a session sizing the launched set never counts them.
  const wantAll = args.includes('--all');

  const specs = parseSpecs();
  const gate = parseGate();
  const { tenants, bots } = parseRegistry();
  const flags = parseFlags();
  const prod = wantProd ? await fetchProd() : null;
  const prodBots = wantProd ? await fetchProdBots() : null;

  // An explicit gameSpecId wins. Otherwise fall back to the LONGEST spec id the
  // engine id contains: 'mini-xiangqi' must beat 'xiangqi' for
  // `fairy-stockfish-mini-xiangqi-strong`, or xiangqi absorbs every other
  // variant's engines.
  const specIds = [...specs.keys()].sort((a, b) => b.length - a.length);
  const botCount = new Map();
  for (const bot of bots) {
    const declared = bot.gameSpecId && specs.has(bot.gameSpecId) ? bot.gameSpecId : null;
    const owner = declared ?? specIds.find((id) => `-${bot.id}-`.includes(`-${id}-`));
    if (owner) botCount.set(owner, (botCount.get(owner) ?? 0) + 1);
  }

  const rows = [...specs.values()]
    .map((spec) => {
      const registered = tenants.has(spec.id);
      const status = classify({ ...spec, gate: gate.get(spec.id), registered });
      const pve = prodBots?.playable?.get(spec.id);
      return {
        ...spec,
        status,
        registered,
        bots: botCount.get(spec.id) ?? 0,
        prodPve: pve ? [...pve] : [],
      };
    })
    .filter((row) => wantAll || row.status !== 'retired')
    .sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id));

  if (asJson) {
    console.log(JSON.stringify({ rows, flags: [...flags.values()], prod }, null, 2));
    return;
  }

  const width = Math.max(...rows.map((r) => r.id.length));
  let last = null;
  for (const row of rows) {
    if (row.status !== last) {
      console.log(`\n${row.status.toUpperCase()} — ${LEGEND[row.status] ?? ''}`);
      last = row.status;
    }
    // This counts entries in the WEB TENANT registry only. It structurally cannot
    // see the chess-stack path (dark-chess, dark-draft960) or a server-side route
    // default like Misty DXQ on dark-xiangqi, so a blank here is 'none in the
    // tenant registry', never 'no bot'. --prod is the only honest answer.
    const tenantBots = row.bots > 0 ? `${row.bots} tenant bot${row.bots === 1 ? '' : 's'}` : '';
    const pve = wantProd
      ? (row.prodPve.length === 0
          ? '—'
          : row.prodPve.length > 2
            ? `pve: ${row.prodPve.length} bots`
            : `pve: ${row.prodPve.join('/')}`
        ).padEnd(14)
      : '';
    const name = row.publicName ? ` — ${row.publicName}` : '';
    console.log(
      `  ${row.id.padEnd(width)}  ${row.registered ? 'tenant' : '      '}  ${tenantBots.padEnd(14)}${pve}${name}`,
    );
  }

  const retiredCount = [...specs.values()].filter((s) => s.runtimeStatus === 'retired').length;
  console.log(
    `\n${rows.length} specs · ${flags.size} feature flags` +
      (wantAll || retiredCount === 0 ? '' : ` · ${retiredCount} retired hidden (--all to list)`),
  );
  console.log('Flags default to OFF and are set per environment, so "flag-gated" is not "live".');
  console.log(
    'The tenant-bot count reads apps/web/src/variant-tenant/registry.ts only. It cannot\n' +
      'see the chess-stack path or a server-side route default, so a blank column is not\n' +
      '"no bot". Run with --prod for the pve column, which reads /api/bots and is the\n' +
      'only source that knows what a player is actually offered.',
  );

  if (prod) {
    console.log('\nPROD (mistboard.com/api/server-status)');
    if (prod.error) {
      console.log(`  unreachable: ${prod.error}`);
    } else {
      console.log(`  build ${prod.revision}`);
      for (const [k, v] of Object.entries(prod.flags)) console.log(`  ${k}: ${v}`);
      console.log(`  engine pools: ${prod.pools.join(', ') || 'none'}`);
      if (prodBots?.error) {
        console.log(
          `  /api/bots unreachable: ${prodBots.error} — the pve column is blank, not false`,
        );
      }
      console.log(
        '  NOTE: only flags this endpoint chooses to expose appear here. An absent\n' +
          '  flag is unknown, not false — check the lobby or the deploy env.',
      );
    }
  }
}

await main();
