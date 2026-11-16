import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import type pg from 'pg';
import { banqiNetPath } from './banqi-engine.js';
import { type BotRatingStamp, loadBotRatingPins } from './bot-rating-provenance.js';
import type { EngineDefinition } from './engine-registry.js';
import { abJchessNetPath, jqeNetPath } from './jieqi-engine.js';
import { jungleFlipNetPath } from './jungle-flip-engine.js';
import { katagoJungleNetPath } from './jungle-katago-engine.js';
import { threeKingdomsBanqiNetPath } from './three-kingdoms-banqi-engine.js';
import { xiangqiFsfNetPath, xiangqiFsfPath } from './xiangqi-fsf-engine.js';
import { pikafishXiangqiNetPath, pikafishXiangqiPath } from './xiangqi-pikafish-paths.js';

export const ENGINE_GAME_STAMP_ARTIFACT = 'engine-rating-stamp';
export type EngineGameStamps = { white: BotRatingStamp; black: BotRatingStamp };

/** Same resolvers used by the worker's move providers; never the server's pins. */
function workerNetPath(engine: EngineDefinition): string | null {
  const config = engine.config;
  const required = (path: string | null) => {
    if (!path) throw new Error(`missing worker net for ${engine.id}`);
    return path;
  };
  switch (config.kind) {
    case 'pikafish-xiangqi':
      return pikafishXiangqiNetPath(pikafishXiangqiPath());
    case 'fairy-stockfish':
      return config.nnue ? xiangqiFsfNetPath(xiangqiFsfPath()) : null;
    case 'pikafish':
      return engine.engineId === 'ab-jchess'
        ? abJchessNetPath()
        : engine.engineId === 'jqe'
          ? jqeNetPath()
          : process.env.MISTBOARD_PIKAFISH_NET || null;
    case 'katago-gtp':
      return katagoJungleNetPath();
    case 'banqi-uci':
      return config.evaluation === 'nnue' ? required(banqiNetPath()) : null;
    case 'jungle-flip-uci':
      return config.evaluation === 'nnue' ? required(jungleFlipNetPath()) : null;
    case 'three-kingdoms-banqi-uci':
      return config.evaluation === 'nnue' ? required(threeKingdomsBanqiNetPath()) : null;
    case 'builtin':
    case 'python-subprocess':
    case 'ffq-banqi-uci':
    case 'jungle-uci':
      return null;
    default: {
      const exhaustive: never = config;
      throw new Error(`unhandled worker net policy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// A net is hashed once per worker process, keyed by size and mtime so a replaced
// file is re-hashed: games start every few minutes and some nets are large.
const netHashes = new Map<string, Promise<string>>();

function netSha256(path: string): Promise<string> {
  const { size, mtimeMs } = statSync(path);
  const key = `${path}\0${size}\0${mtimeMs}`;
  let pending = netHashes.get(key);
  if (!pending) {
    pending = (async () => {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return hash.digest('hex');
    })();
    pending.catch(() => netHashes.delete(key));
    netHashes.set(key, pending);
  }
  return pending;
}

/**
 * The stamp is provenance, never a precondition: a game whose stamp cannot be
 * read (missing recipe inputs, an unreadable net) still plays, unstamped, and
 * an unstamped game never counts toward an automatic rating refresh.
 */
export async function captureEngineGameStampsOrNull(
  white: EngineDefinition,
  black: EngineDefinition,
): Promise<EngineGameStamps | null> {
  try {
    return await captureEngineGameStamps(white, black);
  } catch (error) {
    console.warn(
      `[engine-runner] rating stamp unavailable for ${white.id} vs ${black.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function captureEngineGameStamps(
  white: EngineDefinition,
  black: EngineDefinition,
): Promise<EngineGameStamps> {
  // Evaluated here, on the machine executing the task, rather than at enqueue.
  const recipe = loadBotRatingPins([]).recipe;
  const stamp = async (engine: EngineDefinition): Promise<BotRatingStamp> => {
    const path = workerNetPath(engine);
    if (path === null) return { recipe, netSha256: null };
    return { recipe, netSha256: await netSha256(path) };
  };
  return { white: await stamp(white), black: await stamp(black) };
}

export async function recordEngineGameStamps(
  db: Pick<pg.Pool, 'query'>,
  gameId: string,
  stamps: EngineGameStamps,
): Promise<void> {
  // Explicit projection: no task config, opening seed, events, board or paths.
  const side = (stamp: BotRatingStamp): BotRatingStamp => ({
    recipe: stamp.recipe,
    netSha256: stamp.netSha256,
  });
  await db.query(
    `INSERT INTO game_debug_artifacts (game_id, artifact_type, storage, payload)
     VALUES ($1, $2, 'jsonb', $3)`,
    [gameId, ENGINE_GAME_STAMP_ARTIFACT, { white: side(stamps.white), black: side(stamps.black) }],
  );
}
