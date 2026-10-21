// DEV-only sound and lifecycle audition lab (/sound-lab). Three surfaces:
//   1. Sound board — every SoundKind, one click each, under the active set.
//   2. Lifecycle preview — the real start/finish controller and CSS paired with
//      the sound a player hears for that transition.
//   3. Playthrough — replays a bundled sample game through the REAL snapshot
//      sound pipeline (maybePlaySnapshotSound + the fog-sanitized policy),
//      from a chosen seat, so what you hear is exactly what a player hears.
//
// The set switcher writes the same localStorage preference the live
// controller watches, so switching mid-playthrough takes effect on the next
// sound. Volume comes from the normal settings panel.

import { darkChessVariant, type GameEvent, replayGameEvents } from '@mistboard/game';
import './live-lifecycle-effects.css';
import {
  createLiveLifecycleEffects,
  type LiveLifecycleSnapshot,
} from './live-lifecycle-effects.js';
import {
  initLiveSound,
  maybePlaySnapshotSound,
  playSound,
  resetLiveSoundState,
} from './live-sound.js';
import { liveState, type RoomMode, type SoundKind } from './live-state.js';
import { readStoredSoundSet, SOUND_SETS, storeSoundSet } from './sound-sets.js';

const KINDS: SoundKind[] = [
  'move',
  'capture',
  'captured',
  'cannon-capture',
  'blast',
  'castle',
  'king-capture',
  'king-fall',
  'win',
  'lose',
  'draw',
  'low-time',
  'game-start',
  'learn-take',
  'learn-failure',
  'level-start',
  'level-end',
  'stage-start',
  'stage-end',
];

// Curated from a density scan of public/replay-samples (2026-06-10): the
// default has 29 captures + 2 castles + a king-capture finish in 109 plies.
const SAMPLES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'i96-vs-default-0006-W-white', label: 'Dense: 29 captures, castles, king-capture end' },
  { id: 'bakeoff-g38-white-chall-white-43p', label: 'Short: 43 plies' },
  { id: 'i96-vs-default-0004-D-white', label: 'Draw ending' },
  { id: 'evmix-loss-g08-white-198p-long', label: 'Long: 198 plies' },
];

let stopCurrentRun: (() => void) | null = null;

export function mountSoundLab(root: HTMLElement): void {
  initLiveSound();
  root.replaceChildren();
  root.classList.add('landing-page');

  const main = document.createElement('main');
  main.className = 'site-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Sound lab (dev)';
  const hint = document.createElement('p');
  hint.textContent =
    'Uses the normal sound volume setting: if the site is muted, nothing plays here either.';
  hint.style.color = 'var(--site-muted)';

  main.append(
    heading,
    hint,
    buildSetPicker(),
    buildSoundBoard(),
    buildLifecyclePreview(),
    buildPlaythrough(),
  );
  root.append(main);
}

function buildSetPicker(): HTMLElement {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Sound set';
  section.append(title);
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '16px';
  row.style.flexWrap = 'wrap';
  const active = readStoredSoundSet();
  for (const set of SOUND_SETS) {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.gap = '6px';
    label.style.alignItems = 'center';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'sound-set';
    radio.value = set.id;
    radio.checked = set.id === active;
    radio.addEventListener('change', () => {
      if (radio.checked) storeSoundSet(set.id);
    });
    label.append(radio, document.createTextNode(set.label));
    row.append(label);
  }
  section.append(row);
  return section;
}

function buildSoundBoard(): HTMLElement {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Sound board';
  section.append(title);
  const grid = document.createElement('div');
  grid.style.display = 'flex';
  grid.style.gap = '8px';
  grid.style.flexWrap = 'wrap';
  for (const kind of KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'landing-cta-secondary';
    button.textContent = kind;
    button.addEventListener('click', () => playSound(kind));
    grid.append(button);
  }
  section.append(grid);
  return section;
}

type LifecyclePreview = {
  label: string;
  effect: 'start' | 'win' | 'loss' | 'draw' | 'neutral';
  sound: SoundKind | null;
};

const LIFECYCLE_PREVIEWS: readonly LifecyclePreview[] = [
  { label: 'Start', effect: 'start', sound: 'game-start' },
  { label: 'Win', effect: 'win', sound: 'win' },
  { label: 'Loss', effect: 'loss', sound: 'lose' },
  { label: 'Draw', effect: 'draw', sound: 'draw' },
  { label: 'Neutral finish', effect: 'neutral', sound: null },
];

function buildLifecyclePreview(): HTMLElement {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Game lifecycle';
  const blurb = document.createElement('p');
  blurb.textContent =
    'Uses the production board-frame effect and the corresponding live sound. Neutral finish is visual only.';
  blurb.style.color = 'var(--site-muted)';

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '8px';
  controls.style.flexWrap = 'wrap';

  const previewWrap = document.createElement('div');
  previewWrap.style.width = 'min(100%, 360px)';
  previewWrap.style.marginTop = '16px';
  const stage = buildLifecyclePreviewBoard();
  const effects = createLiveLifecycleEffects(stage);

  for (const preview of LIFECYCLE_PREVIEWS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'landing-cta-secondary';
    button.dataset.lifecyclePreview = preview.effect;
    button.textContent = preview.label;
    button.addEventListener('click', () => {
      runLifecyclePreview(effects, preview.effect);
      if (preview.sound) playSound(preview.sound);
    });
    controls.append(button);
  }

  previewWrap.append(stage);
  section.append(title, blurb, controls, previewWrap);
  return section;
}

function buildLifecyclePreviewBoard(): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'board-stage';
  stage.dataset.lifecyclePreviewStage = '';
  stage.setAttribute('aria-label', 'Game lifecycle effect preview');

  const board = document.createElement('div');
  board.style.position = 'absolute';
  board.style.inset = '0';
  board.style.display = 'grid';
  board.style.gridTemplateColumns = 'repeat(8, 1fr)';
  board.style.overflow = 'hidden';
  board.style.borderRadius = 'var(--board-corner-radius)';
  board.style.boxShadow = '0 2px 8px var(--site-shadow)';
  for (let index = 0; index < 64; index += 1) {
    const square = document.createElement('span');
    const row = Math.floor(index / 8);
    square.style.background = (row + index) % 2 === 0 ? 'var(--board-light)' : 'var(--board-dark)';
    board.append(square);
  }
  stage.append(board);
  return stage;
}

function runLifecyclePreview(
  effects: ReturnType<typeof createLiveLifecycleEffects>,
  preview: LifecyclePreview['effect'],
): void {
  effects.reset();
  const gameId = `sound-lab-${preview}`;
  if (preview === 'start') {
    effects.update(lifecycleSnapshot({ gameId, moveNumber: 1 }));
    return;
  }

  const seated = preview !== 'neutral';
  const seat = seated ? 'red' : null;
  effects.update(lifecycleSnapshot({ gameId, moveNumber: 8, seated, seat }));
  effects.update(
    lifecycleSnapshot({
      gameId,
      status: 'finished',
      moveNumber: 8,
      seated,
      seat,
      winner:
        preview === 'draw'
          ? null
          : preview === 'win'
            ? 'red'
            : preview === 'loss'
              ? 'black'
              : 'red',
    }),
  );
}

function lifecycleSnapshot(overrides: Partial<LiveLifecycleSnapshot> = {}): LiveLifecycleSnapshot {
  return {
    gameId: 'sound-lab',
    status: 'playing',
    moveNumber: 1,
    ready: true,
    seated: true,
    isLive: true,
    seat: 'red',
    winner: null,
    ...overrides,
  };
}

function buildPlaythrough(): HTMLElement {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = 'Game playthrough';
  const blurb = document.createElement('p');
  blurb.textContent =
    'Replays a sample game through the real fog-sanitized sound pipeline from the chosen seat. ' +
    'Policy "pvp" hears what a live player hears; "eve" hears revealed-event sounds.';
  blurb.style.color = 'var(--site-muted)';
  section.append(title, blurb);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '12px';
  controls.style.flexWrap = 'wrap';
  controls.style.alignItems = 'center';

  const samplePicker = document.createElement('select');
  for (const sample of SAMPLES) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.label;
    samplePicker.append(option);
  }
  const seatPicker = buildSelect([
    ['white', 'Seat: white'],
    ['black', 'Seat: black'],
  ]);
  const modePicker = buildSelect([
    ['pvp', 'Policy: pvp (fog-sanitized)'],
    ['eve', 'Policy: eve (revealed)'],
  ]);
  const speedPicker = buildSelect([
    ['900', 'Speed: 1x'],
    ['450', 'Speed: 2x'],
    ['1800', 'Speed: 0.5x'],
  ]);

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'landing-cta-primary';
  playButton.textContent = 'Play';
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.className = 'landing-cta-secondary';
  stopButton.textContent = 'Stop';

  const status = document.createElement('p');
  status.style.fontVariantNumeric = 'tabular-nums';
  status.textContent = 'Idle.';

  playButton.addEventListener('click', () => {
    stopCurrentRun?.();
    void runPlaythrough({
      sampleId: samplePicker.value,
      seat: seatPicker.value as 'white' | 'black',
      mode: modePicker.value as RoomMode,
      stepMs: Number(speedPicker.value),
      status,
    });
  });
  stopButton.addEventListener('click', () => stopCurrentRun?.());

  controls.append(samplePicker, seatPicker, modePicker, speedPicker, playButton, stopButton);
  section.append(controls, status);
  return section;
}

function buildSelect(options: Array<[string, string]>): HTMLSelectElement {
  const select = document.createElement('select');
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

async function runPlaythrough(opts: {
  sampleId: string;
  seat: 'white' | 'black';
  mode: RoomMode;
  stepMs: number;
  status: HTMLElement;
}): Promise<void> {
  const resp = await fetch(`/replay-samples/${opts.sampleId}.jsonl`);
  if (!resp.ok) {
    opts.status.textContent = `Failed to load sample (${resp.status}).`;
    return;
  }
  const events = (await resp.text())
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GameEvent);

  // Snapshot boundaries: after each move, plus the final event (terminal).
  const cuts: number[] = [];
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.type === 'move-played') cuts.push(index + 1);
  }
  if (cuts[cuts.length - 1] !== events.length) cuts.push(events.length);

  liveState.seat = opts.seat;
  liveState.roomMode = opts.mode;
  resetLiveSoundState();

  let stopped = false;
  stopCurrentRun = () => {
    stopped = true;
    opts.status.textContent = 'Stopped.';
    stopCurrentRun = null;
  };

  for (let step = 0; step < cuts.length; step += 1) {
    if (stopped) return;
    const prefix = events.slice(0, cuts[step]);
    const view = darkChessVariant.getPlayerView(replayGameEvents(prefix).state, opts.seat);
    maybePlaySnapshotSound(prefix, view);
    opts.status.textContent = `Ply ${step + 1}/${cuts.length} — ${opts.sampleId}`;
    await sleep(opts.stepMs);
  }
  if (!stopped) {
    opts.status.textContent = `Done — ${opts.sampleId}.`;
    stopCurrentRun = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
