// Dev-only Fog-of-War "game deep-dive" reader (/deepdive). Reuses the real
// replay component (the watch/review board + fog triptych + move rail) and
// hangs a prose annotation panel off its onPlyChange hook. No edits to
// replay.ts: the panel is a sibling element updated per ply.
//
// The pilot game is bhliou vs Ukitza (1913), chess.com FoW 2026-06-14, the
// long-diagonal bishop snipe. Moves are synthesized into a GameEvent[] log
// (room-created + one move-played per ply) so the production reducer + renderer
// drive everything. This event builder is the seed of the chess.com-PGN
// importer the series needs.
import './deepdive.css';
import type { Color, GameEvent, Move, Square } from '@mistboard/game';
import { type GameMeta, mountReplay } from './replay.js';
import { buildNav } from './site-shell.js';

const ROOM_ID = 'deepdive-ukitza-1913';

// Standard-coordinate UCI move list (53 half-moves) for game 104457667.
const UCI = [
  'c2c4',
  'c7c5',
  'd1a4',
  'b8c6',
  'g1f3',
  'g8f6',
  'b1c3',
  'd7d6',
  'd2d3',
  'f6d7',
  'a4c2',
  'd7b6',
  'c1g5',
  'f7f6',
  'g5h4',
  'c8e6',
  'h4g3',
  'e6f7',
  'e2e3',
  'f7g6',
  'h2h3',
  'd8d7',
  'f1e2',
  'e8c8',
  'e1g1',
  'c8b8',
  'a1d1',
  'e7e5',
  'e3e4',
  'c6d4',
  'f3d4',
  'e5d4',
  'c3d5',
  'b6d5',
  'e4d5',
  'h7h6',
  'e2f3',
  'g6h7',
  'c2d2',
  'g7g5',
  'f1e1',
  'f8g7',
  'e1e2',
  'h8e8',
  'e2e8',
  'd8e8',
  'a2a3',
  'e8f8',
  'b2b4',
  'f8c8',
  'b4c5',
  'd6c5',
  'g3b8',
];

const META: GameMeta = {
  whiteName: 'bhliou',
  blackName: 'Ukitza (1913)',
  gameUrl: 'https://www.chess.com/variants/fog-of-war/game/104457667',
  modeLabel: 'Fog of War · 3+2',
  result: 'white-wins',
  termination: 'King captured',
  plyCount: UCI.length,
};

// Sporadic per-ply annotations (the 6 decisive beats). Keyed by ply = half-move
// index (1 = after White's 1st move). `watch` hints which board to read since
// the triptych shows all three.
const ANNOTATIONS: Record<number, { title: string; watch: string; body: string }> = {
  17: {
    title: 'The sniper parks',
    watch: 'full board',
    body: 'The bishop reaches g3 and never moves again. From here it stares down the long diagonal to b8. Nothing is open yet, but the line of fire is set.',
  },
  26: {
    title: 'The king commits',
    watch: "Black's view",
    body: "Black tucks the king to b8, already on the bishop's diagonal, with only the d6 pawn shielding it. In Black's view the g3 bishop is invisible, so the danger does not exist for him.",
  },
  49: {
    title: 'The break begins',
    watch: "White's view",
    body: 'White starts the break. b4 has one job: pull the d6 pawn off the diagonal.',
  },
  51: {
    title: 'The offer',
    watch: "White's view",
    body: 'bxc5 offers the trade. The natural recapture is with the d-pawn, which is exactly the point.',
  },
  52: {
    title: 'The fatal recapture',
    watch: 'White vs Black',
    body: "From Black's view this is an obvious recapture. On the truth board, d6 is gone and the g3 to b8 diagonal is wide open. The recapture removed the king's last shield.",
  },
  53: {
    title: 'The reveal',
    watch: "White's view",
    body: 'The line is clear, so the enemy king appears on b8 in White’s view. Bxb8 takes it. Black never saw the bishop that had been aimed at his king for eighteen moves.',
  },
};

const ANNOTATED_PLIES = Object.keys(ANNOTATIONS)
  .map(Number)
  .sort((a, b) => a - b);

function uciToMove(uci: string): Move {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}

function buildEvents(): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'room-created', at: 0, roomId: ROOM_ID, variant: 'dark-chess' },
  ];
  UCI.forEach((uci, i) => {
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

type AnnotationPanel = { el: HTMLElement; render: (ply: number) => void };

function moveLabel(ply: number): string {
  if (ply <= 0) return 'Start';
  const n = Math.ceil(ply / 2);
  return `${n}${ply % 2 ? '.' : '…'}`;
}

function annotatedHint(): string {
  return ANNOTATED_PLIES.map(moveLabel).join(' · ');
}

function buildAnnotationPanel(): AnnotationPanel {
  const el = document.createElement('section');
  el.className = 'deepdive-annot';
  const label = document.createElement('div');
  label.className = 'deepdive-annot-label';
  label.textContent = 'Annotation';
  const watch = document.createElement('div');
  watch.className = 'deepdive-annot-watch';
  const title = document.createElement('div');
  title.className = 'deepdive-annot-title';
  const body = document.createElement('div');
  body.className = 'deepdive-annot-body';
  el.append(label, watch, title, body);

  function render(ply: number): void {
    const note = ANNOTATIONS[ply];
    if (note) {
      el.classList.remove('is-empty');
      watch.textContent = `Watch: ${note.watch}`;
      title.textContent = note.title;
      body.textContent = note.body;
    } else {
      el.classList.add('is-empty');
      watch.textContent = '';
      title.textContent = '';
      body.textContent = `No note on ${moveLabel(ply)}. Annotated moves: ${annotatedHint()}.`;
    }
  }

  return { el, render };
}

export async function mountDeepDive(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('deepdive-page');
  document.title = 'Deep-dive · bhliou vs Ukitza (1913) · Mistboard';

  const shell = document.createElement('main');
  shell.className = 'deepdive-shell';
  const replayRoot = document.createElement('div');
  replayRoot.className = 'deepdive-replay';
  const annot = buildAnnotationPanel();
  shell.append(replayRoot, annot.el);
  root.append(buildNav(), shell);

  const events = buildEvents();
  const initialPly = 52; // open on the fatal recapture so the panel + reveal show

  await mountReplay(replayRoot, ROOM_ID, {
    autoplay: false,
    initialPly,
    onPlyChange: (ply) => annot.render(ply),
    showControls: true,
    controlsMode: 'panel',
    metadataMode: 'header',
    captureLayout: 'split',
    // Match the public review: keep each side's fog as it was; truth pane always
    // reveals; the only post-finish POV change is the king-capture attacker
    // becoming visible (what the loser actually saw).
    revealOnFinish: false,
    panes: 'all',
    loaderForId: async () => events,
    metadataByRoomId: { [ROOM_ID]: META },
  });

  annot.render(initialPly);
}
