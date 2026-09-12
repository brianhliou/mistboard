// Random self-play fixture generator for every variant tenant.
//
// For each tenant we drive random *legal* self-play using the tenant's OWN
// rules (createSetup / createInitialState / applyMove) plus a per-variant legal
// move enumerator from @mistboard/game, and emit a minimal tenant event log
// (room-created + move-played, natural termination) as committed JSONL. These
// double as postgame-review sample data (feed the dev /postgame-sheet via
// seed-variant-fixtures.ts) and as deterministic multi-variant test fixtures.
//
//   tsx src/generate-variant-fixtures.ts [--seed 1] [--max-plies 400] [--out <dir>]
//
// Deterministic: same seed -> byte-identical output. No network, no DB.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  createBanqiDeal,
  createJieqiDeal,
  createJungleFlipDeal,
  getBanqiLegalMoves,
  getDuckXiangqiLegalTurns,
  getFortressXiangqiLegalMoves,
  getJieqiLegalMoves,
  getJungleFlipLegalMoves,
  getJungleLegalMoves,
  getKriegspielOfferedMoves,
  getLegalCrazyhouseDrops,
  getLegalCrazyhouseMoves,
  getStandardXiangqiLegalMoves,
  getLegalMoves as getXiangqiLegalMoves,
} from '@mistboard/game';

import { banqiTenant } from './banqi-tenant.js';
import { darkCrazyhouseTenant } from './dark-crazyhouse-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { kriegspielTenant } from './kriegspiel-tenant.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// This is a cross-variant harness: each tenant has its own concrete
// Color/Move/State types, so it drives them through `any`.
// biome-ignore lint/suspicious/noExplicitAny: cross-variant harness, see above.
type AnyTenant = any;
// biome-ignore lint/suspicious/noExplicitAny: variant state is opaque to the harness.
type AnyState = any;
// biome-ignore lint/suspicious/noExplicitAny: variant move is opaque to the harness.
type AnyMove = any;

type Enumerate = (state: AnyState) => AnyMove[];

type VariantSpec = {
  tenant: AnyTenant;
  enumerate: Enumerate;
  // Deterministic per-game setup from the harness's seeded RNG. Required for
  // tenants whose rules.createSetup mints a server-secret deal with a crypto RNG
  // (jieqi/banqi/jungle-flip): calling the deal builder with our
  // seeded RNG instead keeps the committed fixtures reproducible. Omit for
  // tenants with a fixed starting position.
  makeSetup?: (rng: () => number) => unknown;
};

// A tenant is driven entirely through its own rules; the only per-variant wiring
// is the legal-move enumerator (the tenant contract only exposes isLegalMove).
// Perfect-info tenants use the "Open" enumerator; fog tenants use the base one
// (both operate on the canonical truth state the server owns).
const VARIANTS: VariantSpec[] = [
  { tenant: jungleTenant, enumerate: (s) => getJungleLegalMoves(s) },
  {
    tenant: jungleFlipTenant,
    enumerate: (s) => getJungleFlipLegalMoves(s),
    makeSetup: (rng) => createJungleFlipDeal(rng),
  },
  {
    tenant: jieqiTenant,
    enumerate: (s) => getJieqiLegalMoves(s),
    makeSetup: (rng) => createJieqiDeal(rng),
  },
  {
    tenant: banqiTenant,
    enumerate: (s) => getBanqiLegalMoves(s),
    makeSetup: (rng) => createBanqiDeal(rng),
  },
  { tenant: fortressXiangqiTenant, enumerate: (s) => getFortressXiangqiLegalMoves(s) },
  // A duck turn is the cross product of ~44 piece moves and ~80 duck squares, so
  // the enumerator returns thousands of turns per ply. That is the shape the
  // harness's uniform pick wants: a duck placement is half the decision, and
  // picking the piece move first would bias the fixture toward tidy duck play.
  { tenant: duckXiangqiTenant, enumerate: (s) => getDuckXiangqiLegalTurns(s) },
  { tenant: xiangqiTenant, enumerate: (s) => getStandardXiangqiLegalMoves(s) },
  {
    tenant: darkCrazyhouseTenant,
    enumerate: (s) => [...getLegalCrazyhouseMoves(s), ...getLegalCrazyhouseDrops(s, s.status.turn)],
  },
  { tenant: kriegspielTenant, enumerate: (s) => getKriegspielOfferedMoves(s, s.status.turn) },
  { tenant: darkXiangqiTenant, enumerate: (s) => getXiangqiLegalMoves(s) },
];

// Deterministic committed fixtures: a fixed base epoch keeps startedAt/endedAt
// sane in the postgame UI without depending on wall-clock at generation time.
const BASE_AT = Date.UTC(2026, 0, 1, 0, 0, 0);
const MOVE_INTERVAL_MS = 3000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type PlayResult = {
  events: unknown[];
  plies: number;
  status: string;
  finished: boolean;
};

function playRandomGame(spec: VariantSpec, seed: number, plyCap: number): PlayResult {
  const { tenant, enumerate } = spec;
  const rng = mulberry32(seed);
  const roomId = `${tenant.roomIdPrefix}sample_${String(seed).padStart(4, '0')}`;

  // A tenant with hidden setup MUST supply a seeded makeSetup, otherwise its
  // rules.createSetup would mint a crypto-random deal and the fixture would not
  // be reproducible. Fail loudly rather than emit a non-deterministic fixture.
  if (tenant.rules.createSetup && !spec.makeSetup) {
    throw new Error(`${tenant.gameSpecId}: tenant has createSetup but no seeded makeSetup`);
  }
  const setup = spec.makeSetup ? spec.makeSetup(rng) : undefined;
  let state: AnyState = tenant.rules.createInitialState(roomId, setup);

  const events: unknown[] = [
    {
      type: 'room-created',
      at: BASE_AT,
      roomId,
      gameSpecId: tenant.gameSpecId,
      ...(setup === undefined ? {} : { setup }),
    },
  ];

  let plies = 0;
  while (state.status.type === 'playing') {
    if (plies >= plyCap) break;
    const legals = enumerate(state);
    if (legals.length === 0) break; // defensive: rules should have marked terminal
    const move = legals[Math.floor(rng() * legals.length)];
    const color = state.status.turn;
    state = tenant.rules.applyMove(state, move);
    plies += 1;
    events.push({
      type: 'move-played',
      at: BASE_AT + plies * MOVE_INTERVAL_MS,
      roomId,
      color,
      move,
    });
  }

  const finished = state.status.type === 'finished';
  const status = finished
    ? `${state.status.winner ?? 'draw'} / ${state.status.reason}`
    : `unfinished (${state.status.type})`;
  return { events, plies, status, finished };
}

// Try successive seeds until we land a naturally-terminating game (random play
// almost always terminates; this just skips the rare ply-cap truncation so the
// fixture is a clean finished game the postgame page can render).
function findFinishedGame(
  spec: VariantSpec,
  baseSeed: number,
  plyCap: number,
): { result: PlayResult; seed: number } {
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = baseSeed + attempt * 101;
    const result = playRandomGame(spec, seed, plyCap);
    if (result.finished && result.plies >= 2) return { result, seed };
  }
  // Fall back to the base seed's game even if truncated, so every variant emits.
  return { result: playRandomGame(spec, baseSeed, plyCap), seed: baseSeed };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '7' },
      'max-plies': { type: 'string', default: '400' },
      out: { type: 'string', default: 'fixtures/variant-postgame' },
    },
  });
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const baseSeed = Number.parseInt(values.seed, 10);
  const plyCap = Number.parseInt(values['max-plies'], 10);
  const outDir = resolve(repoRoot, 'apps/server', values.out);
  await mkdir(outDir, { recursive: true });

  console.log(`generating ${VARIANTS.length} variant fixtures -> ${relative(repoRoot, outDir)}`);
  let failures = 0;
  for (const spec of VARIANTS) {
    const gameSpecId = spec.tenant.gameSpecId as string;
    const { result, seed } = findFinishedGame(spec, baseSeed, plyCap);

    // Self-verify: the emitted log must replay back through the tenant to the
    // same terminal state. Catches a wrong enumerator / illegal move immediately.
    const hydration = createTenantRuntimeRoomFromEvents(spec.tenant, result.events as never[]);
    const replayOk =
      hydration.ok &&
      (!result.finished || hydration.room.projection.state.status.type === 'finished');

    const filePath = join(outDir, `${gameSpecId}.jsonl`);
    await writeFile(filePath, `${result.events.map((e) => JSON.stringify(e)).join('\n')}\n`);

    const flag = result.finished && replayOk ? 'ok' : 'WARN';
    if (flag === 'WARN') failures += 1;
    console.log(
      `  ${flag.padEnd(4)} ${gameSpecId.padEnd(22)} seed=${seed} plies=${result.plies} ${result.status}` +
        (hydration.ok ? '' : ` [replay: ${hydration.error}]`),
    );
  }
  if (failures > 0) {
    console.error(`\n${failures} variant(s) did not produce a clean finished+replayable game.`);
    process.exit(1);
  }
  console.log('\nall variants generated + self-verified.');
}

void main();
