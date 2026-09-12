// Sound subsystem for the live game UI. Extracted from live-render.ts.
//
// Owns the audio context, volume tracking, and the policy that decides which
// sound (move, capture, captured, king-capture, castle, win, lose) to play
// for a given event sequence. Live-render and replay-of-live consume this
// via the exported `sound` instance + `maybePlaySnapshotSound` and
// `soundForOwnMove` helpers.

import {
  type Board,
  type Color,
  type GameEvent,
  type Move,
  type PlayerView,
  replayGameEvents,
  type Square,
} from '@mistboard/game';
import { readAccountPreferences } from './account-preferences.js';
import {
  liveState,
  type RoomMode,
  type Seat,
  type SoundController,
  type SoundKind,
} from './live-state.js';
import {
  DEFAULT_SOUND_SET,
  isSynthesizedSet,
  readStoredSoundSet,
  type SoundSetId,
  soundFileFor,
  soundSetChangedEvent,
} from './sound-sets.js';
import { readEffectiveSoundVolume, soundSettingsChangedEvent } from './theme.js';
import { files, isColor } from './web-utils.js';

const SOUND_MASTER_GAIN = 7.5;
// Per-set output trim for file-backed sets. The lichess sets (futuristic/nes/
// piano/sfx) ship near-0dBFS mp3s that play 2-3x louder than the synthesized
// mist tones (peaks ~0.3-0.6), so they come down hard; the wood set is short
// real-board recordings closer to reference, so it needs less. Tunable per set
// after audition.
const FILE_SET_MASTER_GAIN: Partial<Record<SoundSetId, number>> = {
  wood: 0.8,
  futuristic: 0.4,
  nes: 0.4,
  piano: 0.4,
  sfx: 0.4,
};

let sound: SoundController | null = null;
let lastSoundEventCount: number | null = null;
let lastTerminalSound: string | null = null;
let lastSoundView: PlayerView | null = null;

export function initLiveSound(): void {
  if (sound) return;
  sound = createSoundController();
}

// Reset sound-state observers between live-room mounts so a re-entered room
// doesn't re-fire a "win" sound on the first snapshot.
export function resetLiveSoundState(): void {
  lastSoundEventCount = null;
  lastTerminalSound = null;
  lastSoundView = null;
}

export function playSound(kind: SoundKind): void {
  sound?.play(kind);
}

// Terminal sequencing, shared across game families. A king capture is its own
// fanfare for the winner (the submit-time arpeggio already played), so the win
// jingle is suppressed; for the loser it becomes a king-fall sting, then the
// defeat sound after a beat — capture-death should feel different from
// flag-fall. Pure; exported for tests and the family observers.
export function terminalSoundPlan(
  result: 'win' | 'lose' | 'draw',
  reason: string | null,
): Array<{ kind: SoundKind; delayMs: number }> {
  if (result === 'draw') return [{ kind: 'draw', delayMs: 0 }];
  const kingFell = reason === 'king-captured' || reason === 'general-captured';
  if (result === 'win') return kingFell ? [] : [{ kind: 'win', delayMs: 0 }];
  return kingFell
    ? [
        { kind: 'king-fall', delayMs: 0 },
        { kind: 'lose', delayMs: 550 },
      ]
    : [{ kind: 'lose', delayMs: 0 }];
}

export function playTerminalPlan(result: 'win' | 'lose' | 'draw', reason: string | null): void {
  for (const step of terminalSoundPlan(result, reason)) {
    if (step.delayMs > 0) {
      window.setTimeout(() => sound?.play(step.kind), step.delayMs);
    } else {
      sound?.play(step.kind);
    }
  }
}

// Low-time warning: once per game, when the seated player's clock first dips
// below the threshold during live play. Threshold scales with the time
// control (10% of initial), clamped to 10..30s. Keyed by game id so rematches
// re-arm and room remounts do not re-fire.
let lowTimeFiredGameId: string | null = null;

export function maybePlayLowTimeSound(
  gameId: string,
  remainingMs: number,
  initialMs: number | null,
): void {
  if (!readAccountPreferences().lowTimeSound) return;
  if (lowTimeFiredGameId === gameId) return;
  const threshold = Math.min(30_000, Math.max(10_000, (initialMs ?? 150_000) * 0.1));
  if (remainingMs <= 0 || remainingMs > threshold) return;
  lowTimeFiredGameId = gameId;
  sound?.play('low-time');
}

// Game start: the moment the room flips from "waiting for opponent" (no clock
// yet) to a running game while you hold a seat. The joiner triggered the flip
// themselves; this is for the creator who has been waiting.
function isGameStartTransition(previous: PlayerView | null, next: PlayerView | null): boolean {
  if (!previous || !next) return false;
  if (!isColor(liveState.seat)) return false;
  return !previous.clock && !!next.clock && next.status.type === 'playing';
}

export function maybePlaySnapshotSound(nextEvents: GameEvent[], nextView: PlayerView | null): void {
  if (lastSoundEventCount === null) {
    lastSoundEventCount = nextEvents.length;
    lastTerminalSound = terminalSoundKey(nextEvents, nextView);
    lastSoundView = nextView;
    maybePlayInitialOpponentMove(nextEvents, nextView);
    return;
  }

  const terminal = terminalSoundKey(nextEvents, nextView);
  if (terminal && terminal !== lastTerminalSound) {
    lastTerminalSound = terminal;
    const result = terminal.startsWith('win')
      ? 'win'
      : terminal.startsWith('draw')
        ? 'draw'
        : 'lose';
    const reason = nextView?.status.type === 'finished' ? nextView.status.reason : null;
    playTerminalPlan(result, reason);
    lastSoundEventCount = nextEvents.length;
    lastSoundView = nextView;
    return;
  }

  if (isGameStartTransition(lastSoundView, nextView)) {
    sound?.play('game-start');
  } else if (shouldUseRevealedEventSounds(nextView)) {
    playRevealedEventSound(nextEvents);
  } else {
    playSanitizedOpponentSound(lastSoundView, nextView);
  }

  lastSoundEventCount = nextEvents.length;
  lastSoundView = nextView;
}

// PvE with the engine on White can reach the room before the page has an
// unlocked AudioContext. Sound the single opening move with playWhenUnlocked so
// browser autoplay policy does not swallow it. Live fog snapshots intentionally
// filter opponent move events, so the hidden-opening case is inferred from the
// black-to-move player view rather than from canonical event history.
function maybePlayInitialOpponentMove(events: GameEvent[], view: PlayerView | null): void {
  const kind = initialOpponentMoveSoundForSnapshot(
    events,
    view,
    liveState.seat,
    liveState.roomMode,
  );
  if (kind) sound?.playWhenUnlocked(kind);
}

export function initialOpponentMoveSoundForSnapshot(
  events: GameEvent[],
  view: PlayerView | null,
  seat: Seat,
  roomMode: RoomMode,
): SoundKind | null {
  if (!isColor(seat) || !view) return null;
  if (view.status.type !== 'playing' || view.status.turn !== seat) return null;
  let moveIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.type !== 'move-played') continue;
    if (moveIndex >= 0) return null; // more than one move -> not a fresh opening
    moveIndex = index;
  }
  if (moveIndex < 0) {
    return isHiddenPveOpeningReply(view, seat, roomMode) ? 'move' : null;
  }

  const moveEvent = events[moveIndex]!;
  if (moveEvent.type !== 'move-played' || moveEvent.color === seat) return null;
  return soundForMove(events.slice(0, moveIndex), moveEvent);
}

export function soundForOwnMove(view: PlayerView | null, move: Move): SoundKind {
  if (!view) return 'move';
  const piece = view.board[move.from];
  if (!piece) return 'move';
  if (isCastleMoveInView(view, move, piece.color)) return 'castle';

  const target = view.board[move.to];
  if (target && target.color !== piece.color) {
    return target.role === 'king' ? 'king-capture' : 'capture';
  }
  if (piece.role === 'pawn' && squareFileIndex(move.from) !== squareFileIndex(move.to))
    return 'capture';
  return 'move';
}

// Exposed for live-render's replay-of-live keyboard handler — it needs the
// same own-piece-count diff logic to pick 'captured' vs 'move' on a step.
export function ownPieceCount(view: PlayerView, color: Color): number {
  return Object.values(view.board).filter((piece) => piece?.color === color).length;
}

function createSoundController(): SoundController {
  let ctx: AudioContext | null = null;
  let unlocked = false;
  let volume = readEffectiveSoundVolume();
  let activeSet: SoundSetId = readStoredSoundSet();

  const ensureContext = (): AudioContext | null => {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    ctx ??= new AudioCtor();
    return ctx;
  };

  // Decoded file-set buffers, keyed by URL. A kind whose buffer hasn't
  // finished decoding falls back to the synthesized tones for that one play,
  // so switching sets never produces silence.
  const buffers = new Map<string, AudioBuffer | 'loading'>();

  const preloadActiveSet = (): void => {
    const audio = ensureContext();
    if (!audio || isSynthesizedSet(activeSet)) return;
    for (const kind of [
      'move',
      'capture',
      'captured',
      'castle',
      'king-capture',
      'win',
      'lose',
      'draw',
      'low-time',
      'game-start',
    ] as SoundKind[]) {
      const spec = soundFileFor(activeSet, kind);
      if (!spec || buffers.has(spec.file)) continue;
      buffers.set(spec.file, 'loading');
      void fetch(spec.file)
        .then((resp) =>
          resp.ok ? resp.arrayBuffer() : Promise.reject(new Error(`${resp.status}`)),
        )
        .then((data) => audio.decodeAudioData(data))
        .then((buffer) => buffers.set(spec.file, buffer))
        .catch(() => buffers.delete(spec.file));
    }
  };

  let pendingKind: SoundKind | null = null;

  const unlock = () => {
    const audio = ensureContext();
    if (!audio) return;
    unlocked = true;
    void audio.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (pendingKind) {
      const kind = pendingKind;
      pendingKind = null;
      controller.play(kind);
    }
  };

  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener(soundSettingsChangedEvent, () => {
    volume = readEffectiveSoundVolume();
  });
  window.addEventListener(soundSetChangedEvent, () => {
    activeSet = readStoredSoundSet();
    preloadActiveSet();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith('mistboard.sound')) {
      volume = readEffectiveSoundVolume();
      activeSet = readStoredSoundSet();
      preloadActiveSet();
    }
  });

  // Shared white-noise buffer for percussive (wood-clack) tones; built lazily
  // once per AudioContext and reused across every play.
  let noiseBuffer: AudioBuffer | null = null;
  const ensureNoiseBuffer = (audio: AudioContext): AudioBuffer => {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.floor(audio.sampleRate * 0.2);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  };

  const playTones = (audio: AudioContext, kind: SoundKind): void => {
    const now = audio.currentTime;
    for (const tone of tonesForSound(kind, activeSet)) {
      const start = now + tone.delay;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        tone.gain * volume * SOUND_MASTER_GAIN,
        start + (tone.attack ?? 0.012),
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      gain.connect(audio.destination);
      if (tone.noise) {
        // A bandpass-filtered noise burst centered at `frequency`: the sharp
        // "clack" transient of a wooden piece meeting a wooden board.
        const source = audio.createBufferSource();
        source.buffer = ensureNoiseBuffer(audio);
        const band = audio.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(tone.frequency, start);
        band.Q.value = tone.q ?? 1;
        source.connect(band).connect(gain);
        source.start(start);
        source.stop(start + tone.duration + 0.03);
      } else {
        const osc = audio.createOscillator();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.frequency, start);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + tone.duration + 0.03);
      }
    }
  };

  const controller: SoundController = {
    play(kind) {
      const audio = ensureContext();
      if (!audio || !unlocked) return;
      if (volume <= 0) return;
      void audio.resume();
      const spec = soundFileFor(activeSet, kind);
      const buffer = spec ? buffers.get(spec.file) : undefined;
      if (spec && buffer && buffer !== 'loading') {
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = spec.rate ?? 1;
        const gain = audio.createGain();
        gain.gain.value = volume * (spec.gain ?? 1) * (FILE_SET_MASTER_GAIN[activeSet] ?? 0.4);
        source.connect(gain).connect(audio.destination);
        source.start();
        return;
      }
      if (spec && buffer === undefined) preloadActiveSet();
      playTones(audio, kind);
    },
    playWhenUnlocked(kind) {
      if (unlocked) {
        controller.play(kind);
        return;
      }
      pendingKind = kind;
    },
  };

  // If the document already has sticky user activation — e.g. we SPA-navigated
  // into the room from a "Play" click in the same document — the AudioContext is
  // allowed to resume now. Unlock immediately so the engine's opening move is
  // audible without requiring a fresh in-room gesture. On a cold document load
  // (pasted URL / refresh) hasBeenActive is false, so we stay locked and the
  // first move stays deferred until the visitor interacts — the only behavior
  // browser autoplay policy permits there.
  if (navigator.userActivation?.hasBeenActive) {
    unlock();
  }

  preloadActiveSet();

  return controller;
}

export type SoundTone = {
  delay: number;
  duration: number;
  frequency: number;
  gain: number;
  type: OscillatorType;
  // Envelope attack in seconds (default 0.012). A near-instant attack (~0.001)
  // gives a percussive click instead of a soft swell.
  attack?: number;
  // When true, play a bandpass-filtered white-noise burst centered at
  // `frequency` instead of an oscillator — the wood-clack transient. `type` is
  // ignored for a noise tone.
  noise?: boolean;
  // Bandpass Q for a noise tone (default 1). Lower = broader / woodier.
  q?: number;
};

export function tonesForSound(kind: SoundKind, set: SoundSetId = DEFAULT_SOUND_SET): SoundTone[] {
  if (set === 'wood') {
    const wood = woodTonesForSound(kind);
    if (wood) return wood;
    // Kinds the wood set doesn't override fall through to the Mist tones below.
  }
  if (kind === 'capture')
    return [{ delay: 0, duration: 0.11, frequency: 180, gain: 0.075, type: 'triangle' }];
  if (kind === 'captured')
    return [{ delay: 0, duration: 0.085, frequency: 130, gain: 0.04, type: 'sine' }];
  if (kind === 'king-capture') {
    return [
      { delay: 0, duration: 0.1, frequency: 523.25, gain: 0.065, type: 'triangle' },
      { delay: 0.07, duration: 0.12, frequency: 659.25, gain: 0.065, type: 'triangle' },
      { delay: 0.15, duration: 0.14, frequency: 783.99, gain: 0.065, type: 'triangle' },
      { delay: 0.24, duration: 0.28, frequency: 1046.5, gain: 0.075, type: 'triangle' },
    ];
  }
  if (kind === 'castle') {
    return [
      { delay: 0, duration: 0.1, frequency: 260, gain: 0.055, type: 'square' },
      { delay: 0.08, duration: 0.12, frequency: 390, gain: 0.05, type: 'square' },
    ];
  }
  if (kind === 'win') {
    return [
      {
        delay: 0,
        duration: 0.18,
        frequency: 392,
        gain: 0.062,
        type: 'sine',
        attack: 0.006,
      },
      {
        delay: 0.11,
        duration: 0.22,
        frequency: 493.88,
        gain: 0.064,
        type: 'sine',
        attack: 0.006,
      },
      {
        delay: 0.23,
        duration: 0.28,
        frequency: 587.33,
        gain: 0.066,
        type: 'sine',
        attack: 0.006,
      },
      {
        delay: 0.37,
        duration: 0.42,
        frequency: 783.99,
        gain: 0.06,
        type: 'sine',
        attack: 0.006,
      },
    ];
  }
  if (kind === 'lose') {
    return [
      {
        delay: 0,
        duration: 0.2,
        frequency: 329.63,
        gain: 0.06,
        type: 'triangle',
        attack: 0.006,
      },
      {
        delay: 0.16,
        duration: 0.28,
        frequency: 261.63,
        gain: 0.062,
        type: 'triangle',
        attack: 0.006,
      },
      {
        delay: 0.36,
        duration: 0.4,
        frequency: 220,
        gain: 0.064,
        type: 'triangle',
        attack: 0.006,
      },
    ];
  }
  if (kind === 'king-fall') {
    // The king-capture arpeggio inverted: a descending minor fall.
    return [
      { delay: 0, duration: 0.12, frequency: 659.25, gain: 0.06, type: 'triangle' },
      { delay: 0.08, duration: 0.13, frequency: 523.25, gain: 0.06, type: 'triangle' },
      { delay: 0.17, duration: 0.16, frequency: 392, gain: 0.06, type: 'triangle' },
      { delay: 0.27, duration: 0.26, frequency: 261.63, gain: 0.066, type: 'triangle' },
    ];
  }
  if (kind === 'cannon-capture') {
    // A short crack over a low boom: the slam-the-board cannon capture.
    return [
      { delay: 0, duration: 0.05, frequency: 220, gain: 0.07, type: 'square' },
      { delay: 0.02, duration: 0.24, frequency: 68, gain: 0.1, type: 'sine' },
    ];
  }
  if (kind === 'draw') {
    return [
      {
        delay: 0,
        duration: 0.18,
        frequency: 329.63,
        gain: 0.055,
        type: 'sine',
        attack: 0.006,
      },
      {
        delay: 0.15,
        duration: 0.24,
        frequency: 246.94,
        gain: 0.06,
        type: 'sine',
        attack: 0.006,
      },
      {
        delay: 0.36,
        duration: 0.3,
        frequency: 329.63,
        gain: 0.055,
        type: 'sine',
        attack: 0.006,
      },
    ];
  }
  if (kind === 'low-time') {
    return [
      { delay: 0, duration: 0.05, frequency: 880, gain: 0.05, type: 'square' },
      { delay: 0.09, duration: 0.05, frequency: 880, gain: 0.05, type: 'square' },
    ];
  }
  if (kind === 'game-start') {
    return [
      { delay: 0, duration: 0.1, frequency: 392, gain: 0.045, type: 'sine' },
      { delay: 0.09, duration: 0.16, frequency: 523.25, gain: 0.045, type: 'sine' },
    ];
  }
  if (kind === 'flip') {
    // A face-down tile turned over: a crisp click into a short woody body, the
    // banqi / jieqi signature.
    return [
      { delay: 0, duration: 0.04, frequency: 560, gain: 0.05, type: 'square' },
      { delay: 0.018, duration: 0.085, frequency: 320, gain: 0.05, type: 'triangle' },
    ];
  }
  if (kind === 'drop') {
    // A piece placed from hand: a soft tick into a low thud, distinct from the
    // slide of a board move (crazyhouse).
    return [
      { delay: 0, duration: 0.028, frequency: 300, gain: 0.035, type: 'triangle' },
      { delay: 0.01, duration: 0.13, frequency: 125, gain: 0.07, type: 'sine' },
    ];
  }
  if (kind === 'learn-take') {
    // Star/apple pickup: a bright two-note "bling", clearly not a capture.
    return [
      { delay: 0, duration: 0.07, frequency: 987.77, gain: 0.05, type: 'sine' },
      { delay: 0.055, duration: 0.14, frequency: 1318.51, gain: 0.045, type: 'sine' },
    ];
  }
  if (kind === 'learn-failure') {
    // A soft "not quite": gentle descending pair, far kinder than the ranked
    // 'lose' sting. Failing a lesson should invite a retry, not sting.
    return [
      { delay: 0, duration: 0.12, frequency: 329.63, gain: 0.032, type: 'sine' },
      { delay: 0.11, duration: 0.18, frequency: 277.18, gain: 0.03, type: 'sine' },
    ];
  }
  if (kind === 'puzzle-solved') {
    // A warm major resolution for a solved puzzle. The rising melody supplies
    // the affirmation; the quiet C-major bed under the final note gives it
    // body without turning the short trainer moment into a game-win fanfare.
    return [
      {
        delay: 0,
        duration: 0.18,
        frequency: 392,
        gain: 0.036,
        type: 'sine',
        attack: 0.008,
      },
      {
        delay: 0.1,
        duration: 0.22,
        frequency: 523.25,
        gain: 0.043,
        type: 'sine',
        attack: 0.008,
      },
      {
        delay: 0.21,
        duration: 0.26,
        frequency: 659.25,
        gain: 0.046,
        type: 'sine',
        attack: 0.008,
      },
      {
        delay: 0.34,
        duration: 0.5,
        frequency: 523.25,
        gain: 0.022,
        type: 'sine',
        attack: 0.012,
      },
      {
        delay: 0.34,
        duration: 0.5,
        frequency: 659.25,
        gain: 0.018,
        type: 'sine',
        attack: 0.012,
      },
      {
        delay: 0.34,
        duration: 0.5,
        frequency: 783.99,
        gain: 0.02,
        type: 'sine',
        attack: 0.012,
      },
      {
        delay: 0.36,
        duration: 0.54,
        frequency: 1046.5,
        gain: 0.04,
        type: 'sine',
        attack: 0.01,
      },
    ];
  }
  if (kind === 'level-start') {
    // A single soft ping when a lesson level mounts.
    return [{ delay: 0, duration: 0.12, frequency: 659.25, gain: 0.04, type: 'sine' }];
  }
  if (kind === 'level-end') {
    // Level solved: a light rising arpeggio, quicker and smaller than 'win'.
    return [
      { delay: 0, duration: 0.08, frequency: 523.25, gain: 0.045, type: 'triangle' },
      { delay: 0.07, duration: 0.1, frequency: 659.25, gain: 0.045, type: 'triangle' },
      { delay: 0.15, duration: 0.18, frequency: 783.99, gain: 0.05, type: 'triangle' },
    ];
  }
  if (kind === 'stage-start') {
    // Opening a new chapter: a warm three-note flourish.
    return [
      { delay: 0, duration: 0.1, frequency: 392, gain: 0.045, type: 'sine' },
      { delay: 0.09, duration: 0.12, frequency: 523.25, gain: 0.045, type: 'sine' },
      { delay: 0.19, duration: 0.2, frequency: 659.25, gain: 0.045, type: 'sine' },
    ];
  }
  if (kind === 'stage-end') {
    // Stage complete: a major run with a high sparkle on top, grander than
    // both 'win' and 'level-end'.
    return [
      { delay: 0, duration: 0.1, frequency: 392, gain: 0.05, type: 'triangle' },
      { delay: 0.09, duration: 0.1, frequency: 493.88, gain: 0.05, type: 'triangle' },
      { delay: 0.18, duration: 0.1, frequency: 587.33, gain: 0.05, type: 'triangle' },
      { delay: 0.27, duration: 0.32, frequency: 783.99, gain: 0.055, type: 'triangle' },
      { delay: 0.38, duration: 0.4, frequency: 1174.66, gain: 0.035, type: 'sine' },
    ];
  }
  return [{ delay: 0, duration: 0.09, frequency: 320, gain: 0.055, type: 'sine' }];
}

// The 'wood' set: wooden pieces clacked on a wooden board (xiangqi feel).
// Each tactile kind is a sharp bandpass-noise "clack" transient over a short
// low triangle "body" (the board's resonance). Terminal cues use their own
// rising, falling, or balanced knock patterns instead of borrowing Mist.
function woodTonesForSound(kind: SoundKind): SoundTone[] | null {
  switch (kind) {
    case 'move':
      return [
        {
          delay: 0,
          duration: 0.03,
          frequency: 2200,
          gain: 0.09,
          type: 'sine',
          noise: true,
          q: 0.6,
          attack: 0.001,
        },
        { delay: 0, duration: 0.07, frequency: 230, gain: 0.05, type: 'triangle', attack: 0.002 },
      ];
    case 'capture':
      return [
        {
          delay: 0,
          duration: 0.035,
          frequency: 1900,
          gain: 0.11,
          type: 'sine',
          noise: true,
          q: 0.5,
          attack: 0.001,
        },
        { delay: 0, duration: 0.09, frequency: 200, gain: 0.07, type: 'triangle', attack: 0.002 },
      ];
    case 'captured':
      // Done to you: lower and softer than a capture you make.
      return [
        {
          delay: 0,
          duration: 0.03,
          frequency: 1500,
          gain: 0.075,
          type: 'sine',
          noise: true,
          q: 0.5,
          attack: 0.001,
        },
        { delay: 0, duration: 0.1, frequency: 165, gain: 0.055, type: 'triangle', attack: 0.003 },
      ];
    case 'cannon-capture':
      // The xiangqi cannon slam: a hard crack over a deep board boom.
      return [
        {
          delay: 0,
          duration: 0.04,
          frequency: 2400,
          gain: 0.12,
          type: 'sine',
          noise: true,
          q: 0.5,
          attack: 0.001,
        },
        { delay: 0, duration: 0.22, frequency: 72, gain: 0.09, type: 'sine', attack: 0.002 },
      ];
    case 'castle':
      // Two clacks: the king, then the rook settling beside it.
      return [
        {
          delay: 0,
          duration: 0.028,
          frequency: 2000,
          gain: 0.07,
          type: 'sine',
          noise: true,
          q: 0.7,
          attack: 0.001,
        },
        { delay: 0, duration: 0.06, frequency: 220, gain: 0.045, type: 'triangle', attack: 0.002 },
        {
          delay: 0.12,
          duration: 0.028,
          frequency: 2000,
          gain: 0.06,
          type: 'sine',
          noise: true,
          q: 0.7,
          attack: 0.001,
        },
        {
          delay: 0.12,
          duration: 0.06,
          frequency: 210,
          gain: 0.04,
          type: 'triangle',
          attack: 0.002,
        },
      ];
    case 'drop':
      // A piece placed from hand: a firm, slightly deeper wood tap.
      return [
        {
          delay: 0,
          duration: 0.03,
          frequency: 1700,
          gain: 0.08,
          type: 'sine',
          noise: true,
          q: 0.6,
          attack: 0.001,
        },
        { delay: 0, duration: 0.09, frequency: 175, gain: 0.06, type: 'triangle', attack: 0.002 },
      ];
    case 'flip':
      // A face-down tile turned over: a crisp tick into a short woody body.
      return [
        {
          delay: 0,
          duration: 0.025,
          frequency: 2600,
          gain: 0.075,
          type: 'sine',
          noise: true,
          q: 0.8,
          attack: 0.001,
        },
        {
          delay: 0.015,
          duration: 0.06,
          frequency: 300,
          gain: 0.045,
          type: 'triangle',
          attack: 0.002,
        },
      ];
    case 'game-start':
      // Two settling taps as the pieces take the board.
      return [
        {
          delay: 0,
          duration: 0.03,
          frequency: 1600,
          gain: 0.06,
          type: 'sine',
          noise: true,
          q: 0.7,
          attack: 0.001,
        },
        {
          delay: 0.11,
          duration: 0.03,
          frequency: 2100,
          gain: 0.06,
          type: 'sine',
          noise: true,
          q: 0.7,
          attack: 0.001,
        },
      ];
    case 'win':
      // Four increasingly bright knocks: tactile and clearly celebratory.
      return [
        ...woodHit(0, 1650, 220, 0.075, 0.05),
        ...woodHit(0.12, 1900, 277.18, 0.08, 0.053),
        ...woodHit(0.24, 2200, 329.63, 0.085, 0.056),
        ...woodHit(0.37, 2600, 440, 0.095, 0.06, 0.24),
      ];
    case 'lose':
      // Three descending, heavier board knocks: unmistakable but not punitive.
      return [
        ...woodHit(0, 1500, 180, 0.08, 0.058, 0.14),
        ...woodHit(0.18, 1100, 135, 0.085, 0.065, 0.23),
        ...woodHit(0.39, 800, 90, 0.075, 0.07, 0.34),
      ];
    case 'draw':
      // Two equal knocks with the same body: balanced and unresolved.
      return [
        ...woodHit(0, 1750, 200, 0.08, 0.055, 0.16),
        ...woodHit(0.22, 1750, 200, 0.08, 0.055, 0.24),
      ];
    default:
      return null;
  }
}

function woodHit(
  delay: number,
  noiseFrequency: number,
  bodyFrequency: number,
  noiseGain: number,
  bodyGain: number,
  bodyDuration = 0.11,
): SoundTone[] {
  return [
    {
      delay,
      duration: 0.03,
      frequency: noiseFrequency,
      gain: noiseGain,
      type: 'sine',
      noise: true,
      q: 0.65,
      attack: 0.001,
    },
    {
      delay,
      duration: bodyDuration,
      frequency: bodyFrequency,
      gain: bodyGain,
      type: 'triangle',
      attack: 0.002,
    },
  ];
}

function shouldUseRevealedEventSounds(nextView: PlayerView | null): boolean {
  return liveState.roomMode === 'eve' || nextView?.status.type === 'finished';
}

function playRevealedEventSound(nextEvents: GameEvent[]): void {
  if (nextEvents.length <= (lastSoundEventCount ?? 0)) return;

  let latestMoveIndex = -1;
  for (let index = nextEvents.length - 1; index >= (lastSoundEventCount ?? 0); index -= 1) {
    if (nextEvents[index]?.type === 'move-played') {
      latestMoveIndex = index;
      break;
    }
  }
  if (latestMoveIndex >= 0) {
    const moveEvent = nextEvents[latestMoveIndex]!;
    if (moveEvent.type === 'move-played') {
      sound?.play(soundForMove(nextEvents.slice(0, latestMoveIndex), moveEvent));
    }
  }
}

export function soundForMove(
  beforeEvents: GameEvent[],
  event: Extract<GameEvent, { type: 'move-played' }>,
): SoundKind {
  const before = replayGameEvents(beforeEvents).state;
  if (isCastleMoveOnBoard(before.board, event.move, event.color)) return 'castle';
  const captured = before.board[event.move.to];
  if (!captured) return 'move';
  if (captured.color === event.color) return 'move';
  if (liveState.seat !== 'spectator' && captured.color === liveState.seat) return 'captured';
  if (captured.role === 'king') return 'king-capture';
  return 'capture';
}

function playSanitizedOpponentSound(
  previousView: PlayerView | null,
  nextView: PlayerView | null,
): void {
  if (!isColor(liveState.seat) || !previousView || !nextView) return;
  if (previousView.status.type !== 'playing') return;
  if (previousView.status.turn === liveState.seat) return;
  if (nextView.status.type === 'playing' && nextView.status.turn !== liveState.seat) return;

  const kind =
    ownPieceCount(nextView, liveState.seat) < ownPieceCount(previousView, liveState.seat)
      ? 'captured'
      : 'move';
  if (
    shouldDeferHiddenPveOpeningSound(previousView, nextView, liveState.seat, liveState.roomMode)
  ) {
    sound?.playWhenUnlocked(kind);
    return;
  }
  sound?.play(kind);
}

export function shouldDeferHiddenPveOpeningSound(
  previousView: PlayerView | null,
  nextView: PlayerView | null,
  seat: Seat,
  roomMode: RoomMode,
): boolean {
  if (roomMode !== 'pve' || seat !== 'black') return false;
  if (!previousView || !nextView) return false;
  if (previousView.variant !== 'dark-chess' || nextView.variant !== 'dark-chess') return false;
  if (previousView.moveNumber !== 1 || nextView.moveNumber !== 1) return false;
  if (previousView.status.type !== 'playing' || nextView.status.type !== 'playing') return false;
  return previousView.status.turn === 'white' && nextView.status.turn === 'black';
}

function isHiddenPveOpeningReply(view: PlayerView, seat: Seat, roomMode: RoomMode): boolean {
  if (roomMode !== 'pve' || seat !== 'black') return false;
  if (view.variant !== 'dark-chess') return false;
  if (view.status.type !== 'playing') return false;
  return view.status.turn === 'black' && view.moveNumber === 1;
}

function isCastleMoveInView(view: PlayerView, move: Move, color: Color): boolean {
  return isCastleMoveOnBoard(view.board, move, color);
}

function isCastleMoveOnBoard(board: Board, move: Move, color: Color): boolean {
  const piece = board[move.from];
  if (piece?.role !== 'king' || piece.color !== color) return false;
  const target = board[move.to];
  if (target?.role === 'rook' && target.color === color) return true;
  return (
    rankOf(move.from) === rankOf(move.to) &&
    Math.abs(squareFileIndex(move.to) - squareFileIndex(move.from)) > 1 &&
    (move.to[0] === 'c' || move.to[0] === 'g')
  );
}

function terminalSoundKey(nextEvents: GameEvent[], nextView: PlayerView | null): string | null {
  const status = nextView?.status ?? replayGameEvents(nextEvents).state.status;
  if (status.type !== 'finished' || liveState.seat === 'spectator') return null;
  if (status.winner === null) return `draw:${nextEvents.length}`;
  return status.winner === liveState.seat
    ? `win:${nextEvents.length}`
    : `lose:${nextEvents.length}`;
}

function squareFileIndex(square: Square): number {
  return files.indexOf(square[0] as (typeof files)[number]);
}

function rankOf(square: Square): string {
  return square[1] ?? '';
}
