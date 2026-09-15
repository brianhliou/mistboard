import {
  type EngineTaskTimeControl,
  parseEngineTimeControl,
  timeControlBucket,
  timeControlLabel,
} from './engine-time-policy.js';
import { EVE_VARIANT_IDS } from './variant-eve-registry.js';

export type TournamentPairing = {
  blackEngineId: string;
  gameIndex: number;
  pairId: string;
  pairIndex: number;
  openingIndex: number;
  repeatIndex: number;
  whiteEngineId: string;
};

export type TournamentPlanInput = {
  engines: string[];
  gamesPerPair: number;
};

// 'dark-chess' runs the python-worker / in-process runners; everything else is
// a tenant variant with an EvE adapter (variant-eve-registry.ts).
export type TournamentVariant = 'dark-chess' | (string & {});

export type TournamentCliConfig = {
  artifactPolicy: Record<string, unknown>;
  createdBy: string;
  engines: string[];
  gamesPerPair: number;
  maxPlies: number;
  openingPolicy: Record<string, unknown>;
  priority: number;
  providers: string[];
  rated: boolean;
  ratingAnchorEngineId: string;
  ratingMinAnchorGames: number;
  seed: string;
  timeControl: EngineTaskTimeControl;
  tournamentId: string;
  variant: TournamentVariant;
};

export function createRoundRobinPairings(input: TournamentPlanInput): TournamentPairing[] {
  const engines = uniqueNonEmpty(input.engines);
  if (engines.length < 2) throw new Error('at least two engines are required');
  if (!Number.isInteger(input.gamesPerPair) || input.gamesPerPair <= 0) {
    throw new Error('gamesPerPair must be a positive integer');
  }

  const pairings: TournamentPairing[] = [];
  let gameIndex = 0;
  let pairIndex = 0;
  for (let left = 0; left < engines.length; left++) {
    for (let right = left + 1; right < engines.length; right++) {
      const a = engines[left]!;
      const b = engines[right]!;
      const pairId = `${slugEngineId(a)}-vs-${slugEngineId(b)}`;
      for (let repeatIndex = 0; repeatIndex < input.gamesPerPair; repeatIndex++) {
        const swap = repeatIndex % 2 === 1;
        pairings.push({
          blackEngineId: swap ? a : b,
          gameIndex,
          pairId,
          pairIndex,
          openingIndex: Math.floor(repeatIndex / 2),
          repeatIndex,
          whiteEngineId: swap ? b : a,
        });
        gameIndex += 1;
      }
      pairIndex += 1;
    }
  }
  return pairings;
}

export function parseTournamentArgs(
  values: string[],
  env: NodeJS.ProcessEnv = process.env,
): TournamentCliConfig {
  const args = parseArgs(values);
  const engines = csv(args.engines ?? env.ENGINE_TOURNAMENT_ENGINES ?? '')
    .concat(args.engine ?? [])
    .filter(Boolean);
  if (engines.length < 2)
    throw new Error('provide at least two engines with --engines a,b or repeated --engine');

  const gamesPerPair = positiveInteger(
    args.gamesPerPair ?? env.ENGINE_TOURNAMENT_GAMES_PER_PAIR,
    2,
  );
  const variant = tournamentVariant(args.variant ?? env.ENGINE_TOURNAMENT_VARIANT);
  // Tenant-variant ladders (xiangqi, fortress, duck, ...) are rated clockless:
  // every rung is node-anchored, so pace is not part of its strength.
  const clockless = isTenantEveVariant(variant);
  const maxPlies = positiveInteger(args.maxPlies ?? env.ENGINE_MAX_PLIES, 160);
  const providers = csv(args.providers ?? env.ENGINE_PROVIDERS ?? 'local,railway');
  const timeControl = parseEngineTimeControl(
    args.timeControl ?? env.ENGINE_TIME_CONTROL ?? (clockless ? 'none' : 'standard'),
  );
  if (clockless && timeControl.kind !== 'none') {
    throw new Error(`${variant} calibration currently requires --time-control none`);
  }
  const openingPolicy = openingPolicyFrom(args.opening ?? env.ENGINE_OPENING_POLICY);
  if (openingPolicy.kind !== 'standard' && gamesPerPair % 2 !== 0) {
    throw new Error('paired opening tournaments require an even --games-per-pair');
  }
  const rated = booleanFlag(args.rated ?? env.ENGINE_RATED, false);
  const ratingAnchorEngineId =
    args.ratingAnchor ??
    env.ENGINE_RATING_ANCHOR ??
    (clockless ? engines[0]! : 'python-random-legal');
  const ratingMinAnchorGames = positiveInteger(
    args.ratingMinAnchorGames ?? env.ENGINE_RATING_MIN_ANCHOR_GAMES,
    8,
  );
  const tournamentId =
    args.tournamentId ??
    env.ENGINE_TOURNAMENT_ID ??
    `tournament-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  return {
    artifactPolicy:
      args.artifacts === 'none'
        ? {}
        : { move_choices: args.artifacts ?? env.ENGINE_ARTIFACTS ?? 'all', runtime_summary: 'all' },
    createdBy: args.createdBy ?? env.ENGINE_CREATED_BY ?? 'engine-tournament-cli',
    engines: uniqueNonEmpty(engines),
    gamesPerPair,
    maxPlies,
    openingPolicy,
    priority: integer(args.priority ?? env.ENGINE_PRIORITY, 0),
    providers,
    rated,
    ratingAnchorEngineId,
    ratingMinAnchorGames,
    seed: args.seed ?? env.ENGINE_SEED ?? Date.now().toString(),
    timeControl,
    tournamentId,
    variant,
  };
}

export function nextTournamentSeed(baseSeed: string, gameIndex: number): string {
  try {
    return (BigInt(baseSeed) + BigInt(gameIndex)).toString();
  } catch {
    return `${baseSeed}-${gameIndex}`;
  }
}

export function pairingOpeningPolicy(
  openingPolicy: Record<string, unknown>,
  baseSeed: string,
  pairing: Pick<TournamentPairing, 'openingIndex' | 'pairIndex'>,
): Record<string, unknown> {
  if (openingPolicy.kind === 'standard') return openingPolicy;
  // Each engine pair owns a disjoint opening stream; the two color-swapped
  // games at openingIndex N receive the same seed and therefore the same line.
  const streamIndex = pairing.pairIndex * 1_000_000 + pairing.openingIndex;
  return { ...openingPolicy, seed: nextTournamentSeed(baseSeed, streamIndex) };
}

export function tournamentJobConfig(
  config: TournamentCliConfig,
  targetGames: number,
): Record<string, unknown> {
  return {
    tournament: {
      id: config.tournamentId,
      format: 'round-robin',
      engines: config.engines,
      games_per_pair: config.gamesPerPair,
      color_policy: 'alternate-by-repeat',
    },
    sample: { target_games: targetGames },
    time_control: {
      ...config.timeControl,
      label: timeControlLabel(config.timeControl),
      bucket: timeControlBucket(config.timeControl),
    },
    opening_policy: config.openingPolicy,
    artifact_policy: config.artifactPolicy,
    rating_policy: {
      rated: config.rated,
      method: 'anchor-relative-smoothed-logit-v1',
      anchor_engine_id: config.ratingAnchorEngineId,
      min_anchor_games: config.ratingMinAnchorGames,
      excluded_terminations: ['truncated'],
      pool: {
        variant: config.variant,
        time_control_bucket: timeControlBucket(config.timeControl),
      },
    },
    review_policy: { enqueue_engine_lab: true, initial_review_status: 'unreviewed' },
  };
}

type RawArgs = {
  artifacts?: string;
  createdBy?: string;
  engine?: string[];
  engines?: string;
  gamesPerPair?: string;
  maxPlies?: string;
  opening?: string;
  priority?: string;
  rated?: string;
  ratingAnchor?: string;
  ratingMinAnchorGames?: string;
  providers?: string;
  seed?: string;
  timeControl?: string;
  tournamentId?: string;
  variant?: string;
};

function parseArgs(values: string[]): RawArgs {
  const parsed: RawArgs = {};
  for (let index = 0; index < values.length; index++) {
    const arg = values[index]!;
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (
      rawKey === 'rated' &&
      inlineValue === undefined &&
      (values[index + 1] === undefined || values[index + 1]!.startsWith('--'))
    ) {
      parsed.rated = 'true';
      continue;
    }
    const value = inlineValue ?? values[++index];
    if (!value) throw new Error(`missing value for --${rawKey}`);
    switch (rawKey) {
      case 'artifact':
      case 'artifacts':
        parsed.artifacts = value;
        break;
      case 'created-by':
        parsed.createdBy = value;
        break;
      case 'engine':
        parsed.engine = [...(parsed.engine ?? []), value];
        break;
      case 'engines':
        parsed.engines = value;
        break;
      case 'games-per-pair':
        parsed.gamesPerPair = value;
        break;
      case 'max-plies':
        parsed.maxPlies = value;
        break;
      case 'opening':
        parsed.opening = value;
        break;
      case 'priority':
        parsed.priority = value;
        break;
      case 'rated':
        parsed.rated = value;
        break;
      case 'rating-anchor':
        parsed.ratingAnchor = value;
        break;
      case 'rating-min-anchor-games':
        parsed.ratingMinAnchorGames = value;
        break;
      case 'providers':
        parsed.providers = value;
        break;
      case 'seed':
        parsed.seed = value;
        break;
      case 'time-control':
        parsed.timeControl = value;
        break;
      case 'tournament-id':
        parsed.tournamentId = value;
        break;
      case 'variant':
        parsed.variant = value;
        break;
      default:
        throw new Error(`unknown argument --${rawKey}`);
    }
  }
  return parsed;
}

function openingPolicyFrom(value: string | undefined): Record<string, unknown> {
  if (!value || value === 'standard') return { kind: 'standard' };
  const randomPrefix = 'random-first-';
  if (value.startsWith(randomPrefix)) {
    const n = positiveInteger(value.slice(randomPrefix.length), 0);
    return { kind: 'random_first_n_plies', n };
  }
  throw new Error(`invalid opening policy ${value}; expected standard or random-first-N`);
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`invalid boolean value ${value}`);
}

function tournamentVariant(value: string | undefined): TournamentVariant {
  const variant = value ?? 'dark-chess';
  if (variant === 'dark-chess' || isTenantEveVariant(variant)) return variant;
  throw new Error(
    `invalid tournament variant ${variant}; expected dark-chess or one of ${EVE_VARIANT_IDS.join(', ')}`,
  );
}

function isTenantEveVariant(variant: string): boolean {
  return EVE_VARIANT_IDS.includes(variant);
}

function slugEngineId(engineId: string): string {
  return (
    engineId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'engine'
  );
}
