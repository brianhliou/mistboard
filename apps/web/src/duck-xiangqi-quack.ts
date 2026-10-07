/**
 * The Duck Xiangqi quack: a short sound when a duck is placed, by either seat.
 *
 * Duck-only on purpose. It is not a `SoundKind`: the sound packs are a set of
 * board sounds (move, capture, check...) that every variant shares, and a quack
 * belongs to one piece of one variant. It plays on top of the pack's own move
 * sound, a beat later, and obeys the same volume and mute setting.
 *
 * SWAPPING THE SOUND is a one-line change: point `DUCK_QUACK_FILE` at a file
 * under `public/sound/` (and credit it in `public/sound/CREDITS.md`). Until a
 * file is set, or while it is still decoding, the synthesized quack below plays.
 */
import { readEffectiveSoundVolume } from './theme.js';

/** A recorded quack, e.g. '/sound/duck/quack.mp3'. Null: the synthesized one. */
export const DUCK_QUACK_FILE: string | null = null;

/** Seconds after the move sound, so the two read as "piece, then duck". */
const QUACK_DELAY_S = 0.08;

/** Own turn: quack when the turn placed a duck (a general capture places none). */
export function quackForOwnTurn(turn: { duckTo: string | null }): boolean {
  return turn.duckTo !== null;
}

/** Opponent's turn, from the room frame: a move by the other seat that placed a duck. */
export function quackForFrameEvent(event: unknown, seat: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; color?: unknown; move?: { duckTo?: unknown } };
  return e.type === 'move-played' && e.color !== seat && typeof e.move?.duckTo === 'string';
}

// ── Synthesis ────────────────────────────────────────────────────────────────
// Mistboard's own WebAudio synthesis, no external asset (same provenance as the
// "Mist" set in live-sound.ts). A nasal quack is a buzzy source (sawtooth)
// through two vocal-tract formants, with a pitch that kicks up and then falls.

export function renderSynthQuack(audio: BaseAudioContext, at: number, level: number): void {
  const out = audio.createGain();
  out.gain.value = level;
  out.connect(audio.destination);

  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(1, at + 0.012);
  env.gain.setValueAtTime(1, at + 0.07);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);

  const osc = audio.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(430, at);
  osc.frequency.linearRampToValueAtTime(560, at + 0.035);
  osc.frequency.exponentialRampToValueAtTime(330, at + 0.2);

  // A little throat flutter, so it reads as an animal rather than a buzzer.
  const lfo = audio.createOscillator();
  lfo.frequency.value = 38;
  const lfoDepth = audio.createGain();
  lfoDepth.gain.value = 18;
  lfo.connect(lfoDepth).connect(osc.frequency);

  const f1 = audio.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 1150;
  f1.Q.value = 5;
  const f2 = audio.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 2600;
  f2.Q.value = 6;
  const f2gain = audio.createGain();
  f2gain.gain.value = 0.55;

  osc.connect(f1).connect(env);
  osc.connect(f2).connect(f2gain).connect(env);
  env.connect(out);

  osc.start(at);
  lfo.start(at);
  osc.stop(at + 0.24);
  lfo.stop(at + 0.24);
}

// ── Playback ─────────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let fileBuffer: AudioBuffer | 'loading' | 'failed' | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

function loadFile(audio: AudioContext, file: string): void {
  if (fileBuffer !== null) return;
  fileBuffer = 'loading';
  void fetch(file)
    .then((resp) => (resp.ok ? resp.arrayBuffer() : Promise.reject(new Error(`${resp.status}`))))
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      fileBuffer = buffer;
    })
    .catch(() => {
      fileBuffer = 'failed';
    });
}

/**
 * Play one quack. Returns whether it played: silent when the site's sound is
 * muted or at zero volume, or when the browser has no WebAudio.
 */
export function playDuckQuack(): boolean {
  const volume = readEffectiveSoundVolume();
  if (volume <= 0) return false;
  const audio = ensureContext();
  if (!audio) return false;
  void audio.resume();
  const at = audio.currentTime + QUACK_DELAY_S;
  if (DUCK_QUACK_FILE) {
    loadFile(audio, DUCK_QUACK_FILE);
    if (fileBuffer instanceof AudioBuffer) {
      const source = audio.createBufferSource();
      source.buffer = fileBuffer;
      const gain = audio.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(audio.destination);
      source.start(at);
      return true;
    }
  }
  renderSynthQuack(audio, at, 1.2 * volume);
  return true;
}
