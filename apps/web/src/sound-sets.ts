// Sound-set registry: which audio source plays each SoundKind.
//
// 'wood' is the default: tactile recordings of pieces on a wooden board. 'mist'
// is Mistboard's own WebAudio-synthesized set with zero assets. The other file
// sets are lichess's AGPL sets (public/sound/<set>/, see CREDITS.md there). They
// cover the universal vocabulary, while the fog-native kinds keep per-kind tweaks (rate/gain)
// so 'captured' stays darker than 'capture' even when both use the same
// source file. A kind with no file entry falls back to the synthesized
// tones, so partial sets degrade to Mist rather than silence.
//
// The policy layer (live-sound.ts) never sees any of this: it picks a
// SoundKind from the player's view; the controller resolves kind -> source.

import type { SoundKind } from './live-state.js';

export type SoundSetId = 'mist' | 'wood' | 'futuristic' | 'nes' | 'piano' | 'sfx';

export const SOUND_SETS: ReadonlyArray<{ id: SoundSetId; label: string }> = [
  { id: 'wood', label: 'Wood' },
  { id: 'mist', label: 'Mist' },
  { id: 'piano', label: 'Piano' },
  { id: 'sfx', label: 'SFX' },
  { id: 'futuristic', label: 'Futuristic' },
  { id: 'nes', label: 'NES' },
];

export const DEFAULT_SOUND_SET: SoundSetId = 'wood';

// Synthesized sets carry no asset files: every SoundKind routes to the WebAudio
// tones in live-sound.ts. 'mist' is the only fully-synthesized set. ('wood' is a
// FILE set of real CC0 wood-board recordings plus wood-specific synthesized
// fallbacks while files load; kinds without either still fall back to Mist.)
const SYNTHESIZED_SETS: ReadonlySet<SoundSetId> = new Set<SoundSetId>(['mist']);

export function isSynthesizedSet(set: SoundSetId): boolean {
  return SYNTHESIZED_SETS.has(set);
}

const SOUND_SET_STORAGE_KEY = 'mistboard.soundSet';

export type SoundFileSpec = {
  file: string;
  // Playback-rate tweak: <1 darkens/pitches down. Lets one source file serve
  // two asymmetric kinds (capture vs captured).
  rate?: number;
  gain?: number;
  // Borrow the file from another set's folder (the wood draw, #530).
  fromSet?: SoundSetId;
};

// Wood draw candidates (#530): Kenney's pizzicato 12 (`draw.ogg`, the old
// draw) sat on top of pizzicato 01 (`loss.ogg`): spectrum correlation +0.92,
// so a draw read as a loss. Each candidate is built from audio already in the
// repo; /sound-lab plays them side by side. Correlation with loss.ogg, measured
// 2026-10-20 (spectrum / pitch class): piano +0.75 / -0.27, win slowed +0.92 /
// -0.03, board start +0.56 / +0.27 (percussive, so pitch class means little).
export const WOOD_DRAW_CANDIDATES: ReadonlyArray<{
  id: string;
  label: string;
  spec: SoundFileSpec;
}> = [
  {
    id: 'piano',
    label: "Piano set's Draw (two soft notes)",
    spec: { file: 'Draw.mp3', fromSet: 'piano', gain: 0.9 },
  },
  {
    id: 'win-slow',
    label: 'Wood win, slowed to 0.84',
    spec: { file: 'win.ogg', rate: 0.84 },
  },
  {
    id: 'board-start',
    label: 'Wood board start, a touch lower and louder',
    spec: { file: 'start.mp3', rate: 0.9, gain: 1.5 },
  },
  { id: 'old', label: 'Old draw (pizzicato 12)', spec: { file: 'draw.ogg' } },
];

// Provisional pick: the piano Draw, the most distinct from loss in both
// measures. Brian picks the keeper in /sound-lab.
const WOOD_DRAW = WOOD_DRAW_CANDIDATES[0].spec;

// One mapping for all file sets — every set ships the same eight files.
const FILE_BY_KIND: Partial<Record<SoundKind, SoundFileSpec>> = {
  move: { file: 'Move.mp3' },
  capture: { file: 'Capture.mp3' },
  // Losing a piece is the alarm bell of dark chess: same source as capture,
  // pitched down and slightly quieter so it reads as "done to you".
  captured: { file: 'Capture.mp3', rate: 0.72, gain: 0.85 },
  castle: { file: 'Move.mp3' },
  'king-capture': { file: 'Explosion.mp3' },
  // The loser's side of a king capture: same source, dragged down so it
  // lands as a blow rather than a blast.
  'king-fall': { file: 'Explosion.mp3', rate: 0.62, gain: 0.9 },
  // Atomic's ordinary capture, heard by both sides: the same source as the
  // general's fall, a little lower than the king capture so the terminal one
  // still stands out above the game's dozen blasts.
  blast: { file: 'Explosion.mp3', rate: 0.84, gain: 0.95 },
  win: { file: 'Victory.mp3' },
  lose: { file: 'Defeat.mp3' },
  draw: { file: 'Draw.mp3' },
  'low-time': { file: 'LowTime.mp3' },
  'game-start': { file: 'GenericNotify.mp3' },
  // 'cannon-capture' deliberately has no file mapping: the synth boom is the
  // identity sound in every set (file sets fall back to it by design).
};

// The 'wood' set is real CC0 recordings of pieces on a wooden board (el_boss's
// "Chess Puzzle Blitz SFX", freesound.org pack 30764, CC0 — see public/sound/
// CREDITS.md). Four source files serve the tactile kinds. The terminal cues are
// a matched CC0 pizzicato family; live-sound.ts provides percussive fallbacks
// during loading.
const WOOD_FILE_BY_KIND: Partial<Record<SoundKind, SoundFileSpec>> = {
  move: { file: 'move.mp3' },
  capture: { file: 'capture.mp3' },
  // Losing a piece: the same capture, dragged down so it reads as done-to-you.
  captured: { file: 'capture.mp3', rate: 0.82, gain: 0.9 },
  castle: { file: 'slide.mp3' },
  drop: { file: 'move.mp3' },
  flip: { file: 'move.mp3' },
  // The cannon slam: the capture, pitched down for extra weight.
  'cannon-capture': { file: 'capture.mp3', rate: 0.85, gain: 1.1 },
  // No explosion was ever recorded on a wooden board: the capture dragged
  // down further still, the heaviest thing the set can say.
  blast: { file: 'capture.mp3', rate: 0.62, gain: 1.2 },
  'game-start': { file: 'start.mp3' },
  win: { file: 'win.ogg' },
  lose: { file: 'loss.ogg' },
  draw: WOOD_DRAW,
};

export function soundFileFor(set: SoundSetId, kind: SoundKind): SoundFileSpec | null {
  if (isSynthesizedSet(set)) return null;
  const spec = (set === 'wood' ? WOOD_FILE_BY_KIND : FILE_BY_KIND)[kind];
  return spec ? soundFileUrl(set, spec) : null;
}

export function soundFileUrl(set: SoundSetId, spec: SoundFileSpec): SoundFileSpec {
  return { ...spec, file: `/sound/${spec.fromSet ?? set}/${spec.file}` };
}

export function readStoredSoundSet(): SoundSetId {
  try {
    const value = window.localStorage.getItem(SOUND_SET_STORAGE_KEY);
    if (value && SOUND_SETS.some((set) => set.id === value)) return value as SoundSetId;
  } catch {
    // storage unavailable -> default
  }
  return DEFAULT_SOUND_SET;
}

export function storeSoundSet(set: SoundSetId): void {
  try {
    window.localStorage.setItem(SOUND_SET_STORAGE_KEY, set);
  } catch {
    // storage unavailable -> ignore
  }
  window.dispatchEvent(new Event(soundSetChangedEvent));
}

export const soundSetChangedEvent = 'mistboard:sound-set-changed';
