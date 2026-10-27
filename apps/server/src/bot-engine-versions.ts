// The engine build a public bot runs, as the /bots card and /bot/:id show it.
//
// Every value is read from the constant the server already pins that engine with
// (the `*_ENGINE_REF` short shas that key analysis caches and configHashes, the
// `*_ENGINE_VERSION` strings the binaries self-report, the Misty registry entry),
// so a bumped pin moves the page with it. The two values with no server constant
// of their own, mainline Pikafish and the stock Fairy-Stockfish release, are
// pinned to their pin files by bot-engine-versions.test.ts. An engine with no
// recorded version (the in-process xiangqi mahjong bot) returns null and the page
// shows nothing; a version is never guessed.

import { ATOMIC_XIANGQI_FSF_ENGINE_REF } from './atomic-xiangqi-fsf-engine.js';
import { BANQI_ENGINE_VERSION } from './banqi-engine.js';
import { DUCK_XIANGQI_FSF_ENGINE_REF } from './duck-xiangqi-fsf-engine.js';
import { loadEngine } from './engines/registry.js';
import {
  ABJCHESS_JIEQI_ENGINE_VERSION,
  JIEQI_ABJCHESS_ENGINE_ID,
  JIEQI_JQE_ENGINE_ID,
  JQE_JIEQI_ENGINE_VERSION,
  PIKAFISH_JIEQI_ENGINE_REF,
} from './jieqi-engine.js';
import { JUNGLE_RUST_ENGINE_VERSION } from './jungle-engine.js';
import { JUNGLE_FLIP_ENGINE_VERSION } from './jungle-flip-engine.js';
import { KATAGO_JUNGLE_ENGINE_ID, KATAGO_JUNGLE_ENGINE_VERSION } from './jungle-katago-engine.js';
import { XIANGQI_FSF_ENGINE_REF } from './xiangqi-fsf-engine.js';

// Mainline Pikafish's own name for the pikafish.ref commit (the ref file's comment
// quotes it; the binary prints it in `id name`). The test ties it to the ref.
export const PIKAFISH_XIANGQI_VERSION = 'dev-20260919-6a59ee2f';

// The page shows the commit alone, like the other engines' refs.
const PIKAFISH_XIANGQI_COMMIT = PIKAFISH_XIANGQI_VERSION.slice(
  PIKAFISH_XIANGQI_VERSION.lastIndexOf('-') + 1,
);

// The stock Fairy-Stockfish largeboard release behind Fortress and Crazyhouse
// Xiangqi (scripts/fetch-fairy-stockfish-largeboard.sh downloads tag fairy_sf_14).
export const FAIRY_STOCKFISH_RELEASE_VERSION = '14';

// "abj-0.2d-net-20261010" -> "0.2d": the AB-JChess release, as its author tags it.
function abJchessVersion(): string | null {
  return /^abj-(.+?)-net-/.exec(ABJCHESS_JIEQI_ENGINE_VERSION)?.[1] ?? null;
}

// "jqe-331a6e61-net-it014" -> "331a6e61 · it014": source commit and net, since
// either one changes its play.
function jqeVersion(): string | null {
  const match = /^jqe-([0-9a-f]+)-net-(.+)$/.exec(JQE_JIEQI_ENGINE_VERSION);
  return match ? `${match[1]} · ${match[2]}` : null;
}

// "animalchess2025-f7743af9-b10c384-20260228" -> "f7743af9 · b10c384": the
// KataGomo commit and Kouza's net.
function katagoVersion(): string | null {
  const match = /^[a-z0-9]+-([0-9a-f]{8})-(b\d+c\d+)-\d{8}$/.exec(KATAGO_JUNGLE_ENGINE_VERSION);
  return match ? `${match[1]} · ${match[2]}` : null;
}

// Misty's dark-chess and fog-xiangqi builds are registry entries carrying their
// own version ("Misty 1.6" is config.version '1.6').
function registryVersion(engineId: string): string | null {
  try {
    const { config } = loadEngine(engineId);
    return config.kind === 'python-subprocess' ? String(config.version) : null;
  } catch {
    return null;
  }
}

/** The version string for one engine id, or null when none is recorded. */
export function botEngineVersion(engineId: string): string | null {
  if (engineId.startsWith('pikafish-xiangqi-')) return PIKAFISH_XIANGQI_COMMIT;
  if (engineId.startsWith('pikafish-jieqi-')) return PIKAFISH_JIEQI_ENGINE_REF;
  if (engineId.startsWith('fairy-stockfish-xiangqi-')) return XIANGQI_FSF_ENGINE_REF;
  if (engineId.startsWith('fairy-stockfish-duck-xiangqi-')) return DUCK_XIANGQI_FSF_ENGINE_REF;
  if (engineId.startsWith('fairy-stockfish-atomic-xiangqi-')) return ATOMIC_XIANGQI_FSF_ENGINE_REF;
  if (
    engineId.startsWith('fairy-stockfish-fortress-xiangqi-') ||
    engineId.startsWith('fairy-stockfish-crazyhouse-xiangqi-')
  ) {
    return FAIRY_STOCKFISH_RELEASE_VERSION;
  }
  if (engineId === JIEQI_ABJCHESS_ENGINE_ID) return abJchessVersion();
  if (engineId === JIEQI_JQE_ENGINE_ID) return jqeVersion();
  if (engineId === KATAGO_JUNGLE_ENGINE_ID) return katagoVersion();
  if (engineId === 'misty-banqi') return BANQI_ENGINE_VERSION;
  if (engineId.startsWith('misty-jungle-flip')) return JUNGLE_FLIP_ENGINE_VERSION;
  if (engineId.startsWith('misty-jungle-level-')) return JUNGLE_RUST_ENGINE_VERSION;
  if (engineId.startsWith('python-')) return registryVersion(engineId);
  return null;
}
