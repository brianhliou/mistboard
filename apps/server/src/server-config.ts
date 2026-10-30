import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDatabaseRequired,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from './server-policy.js';

export type ServerRuntimeConfig = {
  abortPolicySweepMs: number;
  annotationsFile: string;
  databaseRequired: boolean;
  databaseUrl: string | undefined;
  defaultRoomRegion: string;
  drainWindowDefaultMs: number;
  drainWindowMaxMs: number;
  guestPrestartAbortMs: number;
  host: string | undefined;
  liveEngineTimeoutMs: number;
  orphanThresholdMs: number;
  pauseGraceMs: number;
  port: number;
  publicHost: string;
  pveEngineMoveDelayMs: number;
  seatVacateGraceMs: number;
  shutdownGraceMs: number;
  stalePausedSweepMs: number;
  stalePauseMs: number;
  staticDir: string;
  wsMaxPayloadBytes: number;
  wsMessageLimit: number;
  wsMessageWindowMs: number;
};

export const serverConfig = loadServerRuntimeConfig();

export function loadServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ServerRuntimeConfig {
  return {
    abortPolicySweepMs: parsePositiveInteger(env.MISTBOARD_ABORT_POLICY_SWEEP_MS) ?? 60_000,
    annotationsFile: resolveAnnotationsFile(env),
    databaseRequired: isDatabaseRequired(env),
    databaseUrl: env.DATABASE_URL,
    defaultRoomRegion: normalizeRoomRegion(
      env.MISTBOARD_ROOM_REGION ??
        env.RAILWAY_DEPLOYMENT_REGION ??
        env.RAILWAY_REGION ??
        env.FLY_REGION ??
        'global',
    ),
    drainWindowDefaultMs:
      parsePositiveInteger(env.MISTBOARD_DRAIN_WINDOW_DEFAULT_MS) ?? 15 * 60 * 1000,
    drainWindowMaxMs: parsePositiveInteger(env.MISTBOARD_DRAIN_WINDOW_MAX_MS) ?? 60 * 60 * 1000,
    guestPrestartAbortMs:
      parseNonNegativeInteger(env.MISTBOARD_GUEST_PRESTART_ABORT_MS) ?? 15 * 60 * 1000,
    host: env.HOST?.trim() || undefined,
    liveEngineTimeoutMs: parsePositiveInteger(env.MISTBOARD_LIVE_ENGINE_TIMEOUT_MS) ?? 3_000,
    orphanThresholdMs: parsePositiveInteger(env.MISTBOARD_ORPHAN_THRESHOLD_MS) ?? 300_000,
    pauseGraceMs: parsePositiveInteger(env.MISTBOARD_RESUME_GRACE_MS) ?? 90_000,
    port: parsePositiveInteger(env.PORT) ?? 3001,
    publicHost: env.MISTBOARD_HOST ?? 'https://mistboard.com',
    pveEngineMoveDelayMs: parsePositiveInteger(env.MISTBOARD_PVE_ENGINE_DELAY_MS) ?? 650,
    seatVacateGraceMs: parsePositiveInteger(env.MISTBOARD_SEAT_VACATE_GRACE_MS) ?? 20_000,
    shutdownGraceMs: parsePositiveInteger(env.MISTBOARD_SHUTDOWN_GRACE_MS) ?? 10_000,
    stalePausedSweepMs: parsePositiveInteger(env.MISTBOARD_STALE_PAUSED_SWEEP_MS) ?? 15 * 60 * 1000,
    stalePauseMs: (parsePositiveInteger(env.MISTBOARD_STALE_PAUSE_HOURS) ?? 24) * 60 * 60 * 1000,
    staticDir: resolveStaticDir(env),
    wsMaxPayloadBytes: parsePositiveInteger(env.MISTBOARD_WS_MAX_PAYLOAD_BYTES) ?? 8_192,
    wsMessageLimit: parsePositiveInteger(env.MISTBOARD_WS_MESSAGE_LIMIT) ?? 40,
    wsMessageWindowMs: parsePositiveInteger(env.MISTBOARD_WS_MESSAGE_WINDOW_MS) ?? 10_000,
  };
}

export function normalizeRoomRegion(value: string | undefined): string {
  if (!value) return 'global';
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(normalized) ? normalized : 'global';
}

function resolveStaticDir(env: NodeJS.ProcessEnv): string {
  if (env.STATIC_DIR) return resolve(env.STATIC_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/server-config.js -> ../../web/dist; src/server-config.ts (tsx dev) -> same path
  return resolve(here, '..', '..', 'web', 'dist');
}

function resolveAnnotationsFile(env: NodeJS.ProcessEnv): string {
  if (env.MISTBOARD_ANNOTATIONS_FILE) return resolve(env.MISTBOARD_ANNOTATIONS_FILE);
  return resolveRepoPath('research', 'python-fow-lab', 'feedback', 'annotations.jsonl');
}

function resolveRepoPath(...parts: string[]): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', ...parts);
}
