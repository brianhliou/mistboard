// Unlisted admin engine tracker (/engines). A roster of every engine version
// that has played, with its win/loss/draw record across completed engine-vs-
// engine games. Admin-gated by /api/admin/engines (open in local dev). No nav
// entry. The per-engine profile (/engine/:id) is a planned follow-up; rows are
// not linked yet.
import './engines.css';
import { variantDisplayLabel } from './game-display.js';
import { buildNav } from './site-shell.js';

type ModeRecord = { games: number; wins: number; losses: number; draws: number };

type EngineRow = {
  engineId: string;
  name: string | null;
  botName: string | null;
  variants: string[];
  pve: ModeRecord;
  eve: ModeRecord;
  pveInferred: boolean;
  totalGames: number;
  lastPlayedAt: string | null;
};

// The name a player would recognise: the bot that fronts the engine (Pikafish,
// Fairy-Stockfish Level 8), else the registry name, else the raw id. The raw id
// stays on the row underneath, since it is what every ops command takes.
export function engineRowTitle(engine: Pick<EngineRow, 'engineId' | 'name' | 'botName'>): string {
  return engine.botName ?? engine.name ?? engine.engineId;
}

// One label per variant the engine has played, most games first. An engine id
// plays one variant, so this is almost always one word; the pre-tenant builtins
// (random-legal, capture-seeker) span the chess stack and list them all.
export function engineVariantsLabel(variants: string[]): string {
  return variants.map((variant) => variantDisplayLabel(variant)).join(', ');
}

class AdminRequiredError extends Error {}

export async function mountEngines(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('engines-page');

  const shell = document.createElement('main');
  shell.className = 'site-section engines-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Engines';

  const sub = document.createElement('p');
  sub.className = 'engines-sub';
  sub.textContent =
    'Internal · admin only. Per engine: record vs humans (PvE) and vs other engines (EvE, ladders and bake-offs) across completed games. A ≈ record was attributed by bot and variant, because those seats predate the engine id on the row.';

  const body = document.createElement('section');
  body.className = 'engines-body';
  body.append(statusLine('Loading…'));

  shell.append(heading, sub, body);
  root.append(buildNav(), shell);

  let engines: EngineRow[];
  try {
    engines = await fetchEngines();
  } catch (err) {
    body.replaceChildren(
      statusLine(err instanceof AdminRequiredError ? err.message : 'Could not load engines.'),
    );
    return;
  }
  if (engines.length === 0) {
    body.replaceChildren(statusLine('No engine games recorded yet.'));
    return;
  }
  body.replaceChildren(buildTable(engines));
}

async function fetchEngines(): Promise<EngineRow[]> {
  const resp = await fetch('/api/admin/engines', { headers: { accept: 'application/json' } });
  if (resp.status === 403) {
    throw new AdminRequiredError('Admin access required. Sign in with an admin account.');
  }
  if (!resp.ok) throw new Error(`engines_query_failed_${resp.status}`);
  const data = (await resp.json()) as { engines: EngineRow[] };
  return data.engines;
}

function buildTable(engines: EngineRow[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'engines-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of [
    '#',
    'Engine',
    'Variant',
    'vs Humans',
    'vs Engines',
    'Games',
    'Last played',
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  engines.forEach((engine, index) => {
    const tr = document.createElement('tr');

    const rank = cell(String(index + 1));
    rank.classList.add('engines-rank');

    const name = document.createElement('td');
    name.className = 'engines-name';
    const nameLink = document.createElement('a');
    nameLink.className = 'engines-name-link';
    nameLink.href = `/engine/${encodeURIComponent(engine.engineId)}`;
    const title = engineRowTitle(engine);
    nameLink.textContent = title;
    name.append(nameLink);
    if (title !== engine.engineId) {
      const id = document.createElement('span');
      id.className = 'engines-id';
      id.textContent = engine.engineId;
      name.append(id);
    }

    const pve = recordCell(engine.pve);
    if (engine.pveInferred && engine.pve.games > 0) {
      pve.textContent = `${pve.textContent} ≈`;
      pve.title =
        'Some of these games were attributed by bot and variant; the seat did not record its engine.';
    }

    tr.append(
      rank,
      name,
      cell(engineVariantsLabel(engine.variants)),
      pve,
      recordCell(engine.eve),
      cell(String(engine.totalGames)),
      cell(formatDate(engine.lastPlayedAt)),
    );
    tbody.append(tr);
  });
  table.append(tbody);
  // Seven columns do not fit a phone: unwrapped, this table pushed the whole page
  // 54px wider than the viewport. Give it its own scroller so the page itself
  // never scrolls sideways.
  const scroller = document.createElement('div');
  scroller.className = 'engines-table-scroll';
  scroller.append(table);
  return scroller;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// A win-loss-draw cell, or an em-free dash when the engine has no games in that mode.
function recordCell(record: ModeRecord): HTMLTableCellElement {
  if (record.games === 0) {
    const td = cell('-');
    td.classList.add('engines-empty');
    return td;
  }
  return cell(`${record.wins}–${record.losses}–${record.draws}`);
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'engines-status';
  p.textContent = text;
  return p;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
