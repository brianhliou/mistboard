// Dev-only engine-output inspector (/engine-review). Reuses the production
// replay board + fog view and hangs an engine-output panel off its onPlyChange
// hook (the same sibling-panel pattern as /deepdive, no replay.ts edits). The
// panel shows the eval and the FULL move ranking the engine produced for the
// review player's decision at each ply: every legal move with its action-value
// (rating) and strategy weight (policy %), best-first. The move actually played
// gets a neutral marker, no commentary.
//
// Data is a static fixture baked from the offline self-review spike in
// mistboard-engine (scripts/spike_selfreview_eval.py). DEV-only route, so the
// fixture + this module are tree-shaken out of the prod bundle.
import './engine-review.css';
import type { Color, GameEvent, Move, Square } from '@mistboard/game';
import DATA from './engine-review-data.json';
import { type GameMeta, mountReplay } from './replay.js';
import { buildNav } from './site-shell.js';

const ROOM_ID = 'engine-review-tier1-2';

type MoveRow = { uci: string; value: number; policy: number; played: boolean };
// One fogged square's marginal: most-likely hidden enemy occupant + probability.
type BeliefSquare = { sq: string; top: string; p_top: number; p_occ: number };
type Belief = {
  visible_count: number;
  belief_size: number;
  sampled_worlds: number;
  squares: BeliefSquare[];
};
type PlyRow = {
  ply: number;
  belief_size: number;
  n_roots: number;
  value_at_root: number;
  moves_rated: number;
  moves: MoveRow[];
  belief: Belief;
};

// python-chess symbols; opponent (black) hidden pieces are lowercase.
const GLYPH: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

const ROWS = DATA.rows as PlyRow[];
const ROWS_BY_PLY = new Map<number, PlyRow>(ROWS.map((r) => [r.ply, r]));
const META = DATA.meta as GameMeta;

function uciToMove(uci: string): Move {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}

function buildEvents(): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'room-created', at: 0, roomId: ROOM_ID, variant: 'dark-chess' },
  ];
  (DATA.uci as string[]).forEach((uci, i) => {
    events.push({
      type: 'move-played',
      at: i + 1,
      roomId: ROOM_ID,
      color: i % 2 === 0 ? 'white' : ('black' as Color),
      move: uciToMove(uci),
    });
  });
  return events;
}

function fmtVal(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

// Confidence = how much of the belief the solve actually covered. |P| <= n_roots
// means the full belief was enumerated (crisp); a tiny fraction means the eval is
// a sparse sample of a huge belief (treat as soft).
function confidenceText(r: PlyRow): string {
  if (r.belief_size <= r.n_roots) {
    return `|P|=${r.belief_size} · solved all (full belief)`;
  }
  const pct = (r.n_roots / r.belief_size) * 100;
  const shown = pct >= 0.1 ? pct.toFixed(1) : pct.toFixed(3);
  return `|P|=${r.belief_size.toLocaleString()} · solved ${r.n_roots} (${shown}%)`;
}

type BeliefBoard = { el: HTMLElement; render: (b: Belief) => void };

// Standalone ghost board: an 8x8 grid (White's orientation) showing, on each
// fogged square, the most-likely hidden enemy occupant as a glyph at
// opacity/heat proportional to P(occupied). Sharp at small |P|, hazy at large.
function buildBeliefBoard(): BeliefBoard {
  const el = document.createElement('div');
  el.className = 'engrev-bboard';
  const files = 'abcdefgh';
  const cells = new Map<string, { cell: HTMLElement; glyph: HTMLElement }>();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const name = `${files[c]}${8 - r}`;
      const cell = document.createElement('div');
      cell.className = `engrev-bcell ${(r + c) % 2 === 0 ? 'is-light' : 'is-dark'}`;
      const glyph = document.createElement('span');
      glyph.className = 'engrev-bglyph';
      cell.append(glyph);
      el.append(cell);
      cells.set(name, { cell, glyph });
    }
  }
  function render(b: Belief): void {
    for (const { cell, glyph } of cells.values()) {
      glyph.textContent = '';
      cell.classList.remove('has-ghost');
      cell.style.removeProperty('--heat');
      cell.removeAttribute('title');
    }
    for (const s of b.squares) {
      const c = cells.get(s.sq);
      if (!c) continue;
      c.glyph.textContent = GLYPH[s.top] ?? '?';
      c.glyph.style.opacity = (0.25 + 0.75 * s.p_occ).toFixed(2);
      c.cell.classList.add('has-ghost');
      c.cell.style.setProperty('--heat', s.p_occ.toFixed(3));
      c.cell.title = `${s.sq}: ${s.top} ${Math.round(s.p_occ * 100)}% (top ${Math.round(s.p_top * 100)}%)`;
    }
  }
  return { el, render };
}

type InspectorPanel = { el: HTMLElement; render: (ply: number) => void };

function buildInspectorPanel(): InspectorPanel {
  const el = document.createElement('section');
  el.className = 'engrev-panel';

  const evalEl = document.createElement('div');
  evalEl.className = 'engrev-eval';
  const confEl = document.createElement('div');
  confEl.className = 'engrev-conf';

  const tabs = document.createElement('div');
  tabs.className = 'engrev-tabs';
  const tabMoves = document.createElement('button');
  tabMoves.type = 'button';
  tabMoves.className = 'engrev-tab is-active';
  tabMoves.textContent = 'Moves';
  const tabBelief = document.createElement('button');
  tabBelief.type = 'button';
  tabBelief.className = 'engrev-tab';
  tabBelief.textContent = 'Belief';
  tabs.append(tabMoves, tabBelief);

  // moves view
  const movesView = document.createElement('div');
  movesView.className = 'engrev-view';
  const listLabel = document.createElement('div');
  listLabel.className = 'engrev-list-label';
  const list = document.createElement('div');
  list.className = 'engrev-list';
  movesView.append(listLabel, list);

  // belief view
  const beliefView = document.createElement('div');
  beliefView.className = 'engrev-view is-hidden';
  const beliefCap = document.createElement('div');
  beliefCap.className = 'engrev-belief-cap';
  const board = buildBeliefBoard();
  beliefView.append(beliefCap, board.el);

  const empty = document.createElement('div');
  empty.className = 'engrev-empty';

  el.append(evalEl, confEl, tabs, movesView, beliefView, empty);

  let tab: 'moves' | 'belief' = 'moves';
  function applyTab(): void {
    tabMoves.classList.toggle('is-active', tab === 'moves');
    tabBelief.classList.toggle('is-active', tab === 'belief');
    movesView.classList.toggle('is-hidden', tab !== 'moves');
    beliefView.classList.toggle('is-hidden', tab !== 'belief');
  }
  tabMoves.addEventListener('click', () => {
    tab = 'moves';
    applyTab();
  });
  tabBelief.addEventListener('click', () => {
    tab = 'belief';
    applyTab();
  });

  function render(ply: number): void {
    const r = ROWS_BY_PLY.get(ply);
    if (!r) {
      el.classList.add('is-empty');
      evalEl.textContent = '';
      confEl.textContent = '';
      tabs.classList.add('is-hidden');
      movesView.classList.add('is-hidden');
      beliefView.classList.add('is-hidden');
      empty.textContent = `No ${DATA.color} decision at ply ${ply}. Decisions: ${ROWS.map((x) => x.ply).join(' · ')}.`;
      return;
    }
    el.classList.remove('is-empty');
    empty.textContent = '';
    tabs.classList.remove('is-hidden');
    evalEl.textContent = `eval ${fmtVal(r.value_at_root)}`;
    evalEl.dataset.sign = r.value_at_root >= 0 ? 'pos' : 'neg';
    confEl.textContent = confidenceText(r);

    // moves view
    listLabel.textContent = `${r.moves_rated} moves rated — value (rating) / policy %`;
    list.replaceChildren();
    for (const m of r.moves) {
      const row = document.createElement('div');
      row.className = 'engrev-move';
      if (m.played) row.classList.add('is-played');
      if (m.policy > 0) row.classList.add('is-policy');

      const uci = document.createElement('span');
      uci.className = 'engrev-uci';
      uci.textContent = m.uci;

      const bar = document.createElement('div');
      bar.className = 'engrev-bar';
      const fill = document.createElement('div');
      fill.className = 'engrev-fill';
      fill.style.width = `${((m.value + 1) / 2) * 100}%`;
      fill.dataset.sign = m.value >= 0 ? 'pos' : 'neg';
      bar.append(fill);

      const val = document.createElement('span');
      val.className = 'engrev-val';
      val.textContent = fmtVal(m.value);

      const pol = document.createElement('span');
      pol.className = 'engrev-pol';
      pol.textContent = m.policy > 0 ? `${Math.round(m.policy * 100)}%` : '·';

      const tag = document.createElement('span');
      tag.className = 'engrev-tag';
      tag.textContent = m.played ? 'played' : '';

      row.append(uci, bar, val, pol, tag);
      list.append(row);
    }

    // belief view
    beliefCap.textContent = `${r.belief.squares.length} squares with a possible hidden enemy · ${r.belief.sampled_worlds} of ${r.belief.belief_size.toLocaleString()} worlds`;
    board.render(r.belief);

    // restore the active view's visibility (a prior no-decision ply hides both)
    applyTab();
  }

  applyTab();
  return { el, render };
}

export async function mountEngineReview(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('engrev-page');
  document.title = 'Engine review · Mistboard';

  const shell = document.createElement('main');
  shell.className = 'engrev-shell';
  const replayRoot = document.createElement('div');
  replayRoot.className = 'engrev-replay';
  const panel = buildInspectorPanel();
  shell.append(replayRoot, panel.el);
  root.append(buildNav(), shell);

  const events = buildEvents();
  const initialPly = ROWS[2]?.ply ?? ROWS[0]?.ply ?? 0; // open mid-opening (ply 4)

  await mountReplay(replayRoot, ROOM_ID, {
    autoplay: false,
    initialPly,
    onPlyChange: (ply) => panel.render(ply),
    showControls: true,
    controlsMode: 'panel',
    metadataMode: 'full', // meta as a left-rail card, not a top strip
    captureLayout: 'split',
    revealOnFinish: false,
    panes: 'all', // triptych: White's view | truth | Black's view

    loaderForId: async () => events,
    metadataByRoomId: { [ROOM_ID]: META },
  });

  panel.render(initialPly);
}
