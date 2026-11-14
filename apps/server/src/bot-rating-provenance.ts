import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RAPFI_LEVELS } from '@mistboard/game';
import type pg from 'pg';
import { knownEngineIds, loadEngine } from './engine-registry.js';
import { firstPartyBotEngineFor } from './first-party-bots.js';

export type BotRatingStamp = { recipe: string; netSha256: string | null };
export type BotRatingPins = { recipe: string; nets: Readonly<Record<string, string | null>> };
export type BotRatingProvenanceSnapshot = {
  botId: string;
  gameSpecId: string;
  timeClass: string;
  engineId: string;
  sourceRef: string | null;
};
export type StaleBotRating = Omit<BotRatingProvenanceSnapshot, 'sourceRef'> & {
  measured: BotRatingStamp | null;
  current: BotRatingStamp | null;
};

const ROOT = new URL('../../../', import.meta.url);
const RECIPE = /^engines-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Reads only committed build recipes, never environment files or credentials. */
export function loadBotRatingPins(engineIds: Iterable<string>): BotRatingPins {
  const recipe = execFileSync(
    'sh',
    [fileURLToPath(new URL('scripts/engine-assets.sh', ROOT)), 'tag'],
    {
      encoding: 'utf8',
    },
  ).trim();
  if (!RECIPE.test(recipe)) throw new Error('invalid engine-assets recipe tag');
  const files = new Map<string, string>();
  const read = (path: string): string => {
    if (!files.has(path)) files.set(path, readFileSync(new URL(path, ROOT), 'utf8'));
    return files.get(path)!;
  };
  const sha = (path: string, field: string): string => {
    const value = read(path).match(new RegExp(`^${field}=([0-9a-f]{64})$`, 'm'))?.[1];
    if (!value) throw new Error(`missing net checksum: ${path} ${field}`);
    return value;
  };
  const privateNet = (name: string): string => {
    const block = read('scripts/fetch-private-net.sh').split(`  ${name})\n`)[1]?.split(';;')[0];
    const value = block?.match(/^\s*sha=([0-9a-f]{64})$/m)?.[1];
    if (!value) throw new Error(`missing private net checksum: ${name}`);
    return value;
  };
  const nets: Record<string, string | null> = {};
  const known = new Set<string>(knownEngineIds());
  for (const id of new Set(engineIds)) {
    if (RAPFI_LEVELS.some(({ level }) => id === `rapfi-level-${level}`)) {
      const value = read('scripts/rapfi-assets.mjs').match(
        /'mix9svqfreestyle_bsmix\.bin\.lz4',\s*\d+,\s*\d+,\s*'([0-9a-f]{64})'/,
      )?.[1];
      if (!value) throw new Error('missing Rapfi freestyle net checksum');
      nets[id] = value;
      continue;
    }
    if (id === 'misty-xiangqi-mahjong') {
      nets[id] = null; // In-process tile bot, no external weights.
      continue;
    }
    // Community engines have no local pin. Missing current provenance is stale,
    // never silently equivalent to a known classical engine.
    if (!known.has(id)) continue;
    const engine = loadEngine(id);
    const config = engine.config;
    switch (config.kind) {
      case 'pikafish-xiangqi':
        nets[id] = sha('scripts/engine-assets.sh', 'PIKAFISH_NET_SHA256');
        break;
      case 'fairy-stockfish':
        nets[id] = config.nnue ? sha('scripts/fetch-fsf-xiangqi-net.sh', 'net_sha') : null;
        break;
      case 'pikafish':
        nets[id] =
          engine.engineId === 'ab-jchess'
            ? sha('scripts/fetch-abjchess-net.sh', 'net_sha')
            : engine.engineId === 'jqe'
              ? sha('scripts/engine-assets.sh', 'JQE_NET_SHA256')
              : null; // PikaJieQi's pinned build uses classical evaluation.
        break;
      case 'katago-gtp':
        nets[id] = sha('scripts/fetch-katago-jungle-net.sh', 'net_sha');
        break;
      case 'banqi-uci':
        nets[id] = config.evaluation === 'nnue' ? privateNet('banqi-net') : null;
        break;
      case 'jungle-flip-uci':
        nets[id] = config.evaluation === 'nnue' ? privateNet('jungle-flip-net') : null;
        break;
      case 'three-kingdoms-banqi-uci':
        nets[id] = config.evaluation === 'nnue' ? privateNet('three-kingdoms-banqi-net') : null;
        break;
      case 'builtin':
      case 'python-subprocess':
      case 'ffq-banqi-uci':
      case 'jungle-uci':
        nets[id] = null;
        break;
      default: {
        const exhaustive: never = config;
        throw new Error(`unhandled bot rating net policy: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return { recipe, nets };
}

/** A shared reference keeps --source-ref promotion of a whole import intact. */
export function stampBotRatingSourceRef(sourceRef: string, pins: BotRatingPins): string {
  if (sourceRef.split(';').some((part) => /^(recipe|netSha256\.[^=]+)=/.test(part))) {
    throw new Error('source-ref contains reserved engine stamp fields');
  }
  if (!RECIPE.test(pins.recipe)) throw new Error('invalid bot rating recipe stamp');
  return [
    sourceRef,
    `recipe=${pins.recipe}`,
    ...Object.entries(pins.nets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, hash]) => {
        if (hash !== null && !SHA256.test(hash))
          throw new Error(`invalid bot rating net checksum: ${id}`);
        return `netSha256.${encodeURIComponent(id)}=${hash ?? 'none'}`;
      }),
  ].join(';');
}

export function readBotRatingStamp(
  sourceRef: string | null,
  engineId: string,
): BotRatingStamp | null {
  const fields = (sourceRef ?? '').split(';');
  const values = (key: string) =>
    fields.filter((part) => part.startsWith(`${key}=`)).map((part) => part.slice(key.length + 1));
  const recipes = values('recipe');
  const hashes = values(`netSha256.${encodeURIComponent(engineId)}`);
  if (recipes.length !== 1 || !RECIPE.test(recipes[0]!) || hashes.length !== 1) return null;
  const hash = hashes[0]!;
  if (hash !== 'none' && !SHA256.test(hash)) return null;
  return { recipe: recipes[0]!, netSha256: hash === 'none' ? null : hash };
}

export function findStaleBotRatings(
  snapshots: readonly BotRatingProvenanceSnapshot[],
  pins: BotRatingPins,
): StaleBotRating[] {
  return snapshots.flatMap(({ sourceRef, ...snapshot }) => {
    const measured = readBotRatingStamp(sourceRef, snapshot.engineId);
    const current = Object.hasOwn(pins.nets, snapshot.engineId)
      ? { recipe: pins.recipe, netSha256: pins.nets[snapshot.engineId]! }
      : null;
    return measured &&
      current &&
      measured.recipe === current.recipe &&
      measured.netSha256 === current.netSha256
      ? []
      : [{ ...snapshot, measured, current }];
  });
}

export async function collectStaleBotRatings(
  db: Pick<pg.Pool, 'query'>,
): Promise<StaleBotRating[]> {
  const { rows } = await db.query<{
    bot_id: string;
    active_engine_id: string;
    game_spec_id: string;
    time_class: string;
    source_ref: string | null;
  }>(`SELECT DISTINCT ON (s.bot_id, s.game_spec_id, s.time_class)
            s.bot_id, b.active_engine_id, s.game_spec_id, s.time_class, s.source_ref
       FROM bot_rating_snapshots s
       JOIN bot_profiles b ON b.id = s.bot_id
      WHERE s.published = true AND b.visibility = 'public'
        AND s.game_spec_id = ANY(b.supported_game_spec_ids)
      ORDER BY s.bot_id, s.game_spec_id, s.time_class,
               s.published_at DESC NULLS LAST, s.created_at DESC, s.id DESC`);
  const snapshots = rows.map((row) => ({
    botId: row.bot_id,
    gameSpecId: row.game_spec_id,
    timeClass: row.time_class,
    engineId: firstPartyBotEngineFor(row.bot_id, row.game_spec_id) ?? row.active_engine_id,
    sourceRef: row.source_ref,
  }));
  return snapshots.length === 0
    ? []
    : findStaleBotRatings(snapshots, loadBotRatingPins(snapshots.map((row) => row.engineId)));
}

export function staleBotRatingKey(rating: StaleBotRating): string {
  return [
    rating.botId,
    rating.gameSpecId,
    rating.timeClass,
    rating.engineId,
    rating.current?.recipe ?? 'unknown',
    rating.current?.netSha256 ?? 'none',
  ].join(':');
}

export function staleBotRatingLabel(rating: StaleBotRating): string {
  return `${rating.botId} (${rating.gameSpecId}, ${rating.timeClass}): rating measured on an older build${rating.measured ? '' : ' (missing build/net stamp)'}`;
}
