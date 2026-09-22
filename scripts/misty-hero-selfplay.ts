// Engine self-play for the public Misty engine repos' README hero animations.
//
//   npx tsx scripts/misty-hero-selfplay.ts --variant jungle --out tmp/hero/jungle.json
//
// Plays the SHIPPED bot against itself at its FULL node budget — the same budget the
// live site hands the bot (jungle-engine.ts / banqi-engine.ts / jungle-flip-engine.ts) —
// through the real rules kernel in @mistboard/game and the real redacted FEN encoders.
// The movetime cap is deliberately loosened to a number no search ever reaches, so the
// NODE budget is what binds: a hero clip should show the engine at the strength it is
// configured for, never a move truncated by a latency ceiling.
//
// Binaries come from the PUBLIC misty-* repos, which is what prod fetches from GitHub
// releases (railpack.json), so the game in the README is the engine in the README.
//
// Hidden-identity variants (banqi, jungle-flip) deal from a seeded RNG: `--seed N`
// selects the deal, `--games N` plays a run of consecutive seeds so a good clip can be
// picked. Jungle is perfect information with no deal, so one seed is one game.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyBanqiMove,
  applyJungleFlipMove,
  applyJungleMove,
  type BanqiGameState,
  banqiMoveToEngineUci,
  banqiStateToEngineFen,
  createBanqiDeal,
  createInitialBanqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  createJungleFlipDeal,
  engineUciToBanqiMove,
  engineUciToJungleFlipMove,
  engineUciToJungleMove,
  getJungleLegalMoves,
  type JungleFlipGameState,
  type JungleGameState,
  type JungleMove,
  jungleFlipRepSeedFens,
  jungleFlipStateToEngineFen,
  jungleMoveToEngineUci,
  jungleRepSeedFens,
  jungleStateToEngineFen,
} from '@mistboard/game';

// ── The three shipped bots, at the strength the live site configures ─────────

const HOME = process.env.HOME ?? '';

type VariantId = 'jungle' | 'jungle-flip' | 'banqi';

type EngineSpec = {
  /** Display name for the manifest (the binary self-reports the version). */
  label: string;
  /** Built from the public repo — the same source prod's release binaries come from. */
  bin: string;
  /** Node budget = the CPU-independent strength dial. Mirrors the server tier tables. */
  nodes: number;
  /** Where the server's node budget is defined, so the two can be diffed. */
  budgetSource: string;
};

const ENGINES: Record<VariantId, EngineSpec> = {
  jungle: {
    label: 'MistyJungle',
    bin: `${HOME}/projects/misty-jungle/target/release/jungle-engine`,
    // apps/server/src/jungle-engine.ts — misty-jungle-level-2, the one playable bot.
    nodes: 5_000_000,
    budgetSource: 'apps/server/src/jungle-engine.ts JUNGLE_RUST_TIERS',
  },
  banqi: {
    label: 'MistyBanqi',
    bin: `${HOME}/projects/misty-banqi/target/release/banqi-engine`,
    // apps/server/src/banqi-engine.ts — MISTY_BANQI, the single versioned bot.
    nodes: 3_500_000,
    budgetSource: 'apps/server/src/banqi-engine.ts MISTY_BANQI',
  },
  'jungle-flip': {
    label: 'MistyJungleFlip',
    bin: `${HOME}/projects/misty-flip-jungle/target/release/jungle-flip-engine`,
    // apps/server/src/jungle-flip-engine.ts — MISTY_JUNGLE_FLIP.
    nodes: 2_500_000,
    budgetSource: 'apps/server/src/jungle-flip-engine.ts MISTY_JUNGLE_FLIP',
  },
};

// High enough that the node budget always binds first. The live cap (4-8s) exists to
// bound request latency on a shared vCPU; an offline hero render has no such deadline,
// and a capped search plays BELOW the configured strength (see the truncation telemetry
// in banqi-engine.ts). Keeping the cap in the command keeps the dialect identical.
const UNCAPPED_MOVETIME_MS = 600_000;

// ── Minimal UCI round-trip (one process per move, as the server does) ────────

function uciBestmove(bin: string, commands: readonly string[]): Promise<string | null> {
  return new Promise((resolveMove, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      run();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${bin} timed out`))),
      UNCAPPED_MOVETIME_MS + 30_000,
    );
    child.on('error', (err) => finish(() => reject(err)));
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('bestmove')) {
          const token = line.split(/\s+/)[1];
          finish(() => resolveMove(!token || token === '(none)' ? null : token));
          return;
        }
        nl = buf.indexOf('\n');
      }
    });
    child.on('close', () => finish(() => resolveMove(null)));
    child.stdin.write(`${commands.join('\n')}\n`);
  });
}

function goCommand(nodes: number): string {
  return `go nodes ${nodes} movetime ${UNCAPPED_MOVETIME_MS}`;
}

/** Side-to-move-POV score of a position, from the engine's `info score cp` line. */
function uciScore(bin: string, commands: readonly string[]): Promise<number | null> {
  return new Promise((resolveScore, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    let score: number | null = null;
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      run();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${bin} timed out`))),
      UNCAPPED_MOVETIME_MS + 30_000,
    );
    child.on('error', (err) => finish(() => reject(err)));
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const cp = /\bscore cp (-?\d+)/.exec(line);
        if (cp) score = Number(cp[1]);
        if (line.startsWith('bestmove')) {
          finish(() => resolveScore(score));
          return;
        }
        nl = buf.indexOf('\n');
      }
    });
    child.on('close', () => finish(() => resolveScore(score)));
    child.stdin.write(`${commands.join('\n')}\n`);
  });
}

// ── Seeded deals ─────────────────────────────────────────────────────────────

/** mulberry32 — a small deterministic PRNG so a seed reproduces a deal exactly. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Per-variant self-play loops ──────────────────────────────────────────────

export type SelfPlayGame = {
  variant: VariantId;
  engine: string;
  nodes: number;
  seed: number;
  /** Space-separated platform move tokens (from+to), replayable through the kernel. */
  moves: string;
  plies: number;
  /** Kernel terminal status, verbatim. */
  status: unknown;
  /** For hidden-identity variants: the deal, so a replay reproduces every reveal. */
  deal?: Array<{ color: string; role: string }>;
  /** Jungle only: how many opening plies were drawn from the engine's own top-K. */
  openingPlies?: number;
  openingTopK?: number;
  /** Jungle only: per-seat node budgets, equal for true self-play. */
  nodesRed?: number;
  nodesBlack?: number;
};

/**
 * Pick an opening move by ranking every legal root move with a FULL-budget search of the
 * position it leads to, then choosing uniformly among the top `topK`.
 *
 * Jungle is perfect information and the binary is deterministic, so symmetric self-play at
 * one budget has exactly ONE game — and at 5M nodes that game is a 100-ply, zero-capture
 * no-progress draw. Diversity has to come from the opening, and the honest way to get it is
 * to let the engine rank the candidates and choose among the ones IT rates near-best, at
 * the same budget it plays the rest of the game with. Every opening move is still a move
 * the engine endorses; only the tie-break is seeded.
 *
 * The engine scores from the side-to-move's POV, and the position we hand it is the one
 * AFTER our candidate move, so the mover's value is the negation.
 */
async function pickJungleOpeningMove(
  spec: EngineSpec,
  state: JungleGameState,
  history: readonly JungleGameState[],
  topK: number,
  rng: () => number,
  nodes: number,
): Promise<JungleMove | null> {
  const candidates = getJungleLegalMoves(state);
  if (candidates.length === 0) return null;
  const scored: Array<{ move: JungleMove; value: number }> = [];
  for (const move of candidates) {
    const child = applyJungleMove(state, move);
    if (child === state) continue;
    const reps = jungleRepSeedFens([...history, child]);
    const position =
      reps.length > 0
        ? `position fen ${jungleStateToEngineFen(child)} reps ${reps.join(';')}`
        : `position fen ${jungleStateToEngineFen(child)}`;
    const score = await uciScore(spec.bin, [
      'uci',
      'ucinewgame',
      'isready',
      position,
      goCommand(nodes),
    ]);
    scored.push({ move, value: score === null ? Number.NEGATIVE_INFINITY : -score });
  }
  scored.sort((a, b) => b.value - a.value);
  const pool = scored.slice(0, Math.max(1, topK));
  const choice = pool[Math.floor(rng() * pool.length)]!;
  process.stderr.write(
    `    opening pool: ${pool.map((c) => `${jungleMoveToEngineUci(c.move)}=${c.value}`).join(' ')}\n`,
  );
  return choice.move;
}

async function playJungle(
  spec: EngineSpec,
  maxPlies: number,
  opening: { plies: number; topK: number; rng: () => number },
  // Per-seat node budgets. Equal by default (true self-play); `--nodes-black` drops the
  // second seat to another rung when a decisive game is wanted and the symmetric one draws.
  budgets: { red: number; black: number } = { red: spec.nodes, black: spec.nodes },
): Promise<SelfPlayGame> {
  let state = createInitialJungleState('hero');
  const history: JungleGameState[] = [state];
  const moves: string[] = [];
  while (state.status.type === 'playing' && moves.length < maxPlies) {
    const nodes = moves.length % 2 === 0 ? budgets.red : budgets.black;
    if (moves.length < opening.plies) {
      const move = await pickJungleOpeningMove(
        spec,
        state,
        history,
        opening.topK,
        opening.rng,
        nodes,
      );
      if (!move) break;
      state = applyJungleMove(state, move);
      history.push(state);
      moves.push(jungleMoveToEngineUci(move));
      process.stderr.write(`  ply ${moves.length}: ${jungleMoveToEngineUci(move)} (opening)\n`);
      continue;
    }
    const reps = jungleRepSeedFens(history);
    const position =
      reps.length > 0
        ? `position fen ${jungleStateToEngineFen(state)} reps ${reps.join(';')}`
        : `position fen ${jungleStateToEngineFen(state)}`;
    const best = await uciBestmove(spec.bin, [
      'uci',
      'ucinewgame',
      'isready',
      position,
      goCommand(nodes),
    ]);
    const move = engineUciToJungleMove(best);
    if (!move) break;
    const next = applyJungleMove(state, move);
    if (next === state) throw new Error(`jungle: engine returned an illegal move ${best}`);
    state = next;
    history.push(state);
    moves.push(jungleMoveToEngineUci(move));
    process.stderr.write(`  ply ${moves.length}: ${best}\n`);
  }
  return {
    variant: 'jungle',
    engine: spec.label,
    nodes: spec.nodes,
    seed: 0,
    moves: moves.join(' '),
    plies: moves.length,
    status: state.status,
    openingPlies: opening.plies,
    openingTopK: opening.topK,
    nodesRed: budgets.red,
    nodesBlack: budgets.black,
  };
}

async function playBanqi(spec: EngineSpec, seed: number, maxPlies: number): Promise<SelfPlayGame> {
  const deal = createBanqiDeal(seededRng(seed));
  let state = createInitialBanqiState(`hero-${seed}`, deal);
  const history: BanqiGameState[] = [state];
  const uciMoves: string[] = [];
  const moves: string[] = [];
  while (state.status.type === 'playing' && moves.length < maxPlies) {
    // The engine's repetition window: the FEN at the last irreversible move (flip or
    // capture) plus the quiet plies since. Mirrors banqiEngineRepWindow in
    // apps/server/src/server-banqi-engine.ts, which reads the same clock.
    const k = Math.min(state.noProgressClock, uciMoves.length);
    const start = history[history.length - 1 - k]!;
    const window = uciMoves.slice(uciMoves.length - k);
    const position =
      window.length > 0
        ? `position fen ${banqiStateToEngineFen(start)} moves ${window.join(' ')}`
        : `position fen ${banqiStateToEngineFen(state)}`;
    const best = await uciBestmove(spec.bin, [
      'uci',
      'ucinewgame',
      'isready',
      position,
      goCommand(spec.nodes),
    ]);
    const move = best ? engineUciToBanqiMove(best) : null;
    if (!move) break;
    const next = applyBanqiMove(state, move);
    if (next === state) throw new Error(`banqi: engine returned an illegal move ${best}`);
    state = next;
    history.push(state);
    uciMoves.push(banqiMoveToEngineUci(move));
    moves.push(`${move.from}${move.to}`);
    process.stderr.write(`  ply ${moves.length}: ${best}\n`);
  }
  return {
    variant: 'banqi',
    engine: spec.label,
    nodes: spec.nodes,
    seed,
    moves: moves.join(' '),
    plies: moves.length,
    status: state.status,
    deal: deal.map((p) => ({ color: p.color, role: p.role })),
  };
}

async function playJungleFlip(
  spec: EngineSpec,
  seed: number,
  maxPlies: number,
): Promise<SelfPlayGame> {
  const deal = createJungleFlipDeal(seededRng(seed));
  let state = createInitialJungleFlipState(`hero-${seed}`, deal);
  const history: JungleFlipGameState[] = [state];
  const moves: string[] = [];
  while (state.status.type === 'playing' && moves.length < maxPlies) {
    const reps = jungleFlipRepSeedFens(history);
    const position =
      reps.length > 0
        ? `position fen ${jungleFlipStateToEngineFen(state)} reps ${reps.join(';')}`
        : `position fen ${jungleFlipStateToEngineFen(state)}`;
    const best = await uciBestmove(spec.bin, [
      'uci',
      'ucinewgame',
      'isready',
      position,
      goCommand(spec.nodes),
    ]);
    const move = best ? engineUciToJungleFlipMove(best) : null;
    if (!move) break;
    const next = applyJungleFlipMove(state, move);
    if (next === state) throw new Error(`jungle-flip: engine returned an illegal move ${best}`);
    state = next;
    history.push(state);
    // PLATFORM squares (rank 1..4), not the engine's 0-indexed UCI: the move list is
    // replayed through the kernel by the frame renderer, not fed back to the engine.
    moves.push(`${move.from}${move.to}`);
    process.stderr.write(`  ply ${moves.length}: ${best}\n`);
  }
  return {
    variant: 'jungle-flip',
    engine: spec.label,
    nodes: spec.nodes,
    seed,
    moves: moves.join(' '),
    plies: moves.length,
    status: state.status,
    deal: deal.map((p) => ({ color: p.color, role: p.role })),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const variant = (arg('--variant') ?? '') as VariantId;
  const shipped = ENGINES[variant];
  if (!shipped) {
    console.error(
      'usage: --variant jungle|jungle-flip|banqi --out <file.json> [--seed N] [--games N] [--max-plies N] [--nodes N]',
    );
    process.exit(1);
  }
  // `--nodes N` plays above (or below) the shipped budget: a companion study
  // wants the engine at its best, not at the strength a first-timer faces.
  // The output records the budget it actually used, and budgetSource says so.
  const nodesOverride = arg('--nodes') ? Number(arg('--nodes')) : null;
  const spec: EngineSpec =
    nodesOverride === null
      ? shipped
      : {
          ...shipped,
          nodes: nodesOverride,
          budgetSource: `--nodes ${nodesOverride} (shipped: ${shipped.nodes}, ${shipped.budgetSource})`,
        };
  if (!existsSync(spec.bin)) {
    console.error(`${spec.label} binary not built: ${spec.bin}`);
    process.exit(1);
  }
  const out = arg('--out') ?? `tmp/hero/${variant}.json`;
  const seed = Number(arg('--seed') ?? 1);
  const games = Number(arg('--games') ?? 1);
  const maxPlies = Number(arg('--max-plies') ?? 200);
  // Jungle only: without an opening pool, deterministic symmetric self-play has one game.
  const openingPlies = Number(arg('--opening-plies') ?? 0);
  const openingTopK = Number(arg('--opening-topk') ?? 3);
  // Jungle only: per-seat budgets, equal unless overridden.
  const nodesRed = Number(arg('--nodes-red') ?? spec.nodes);
  const nodesBlack = Number(arg('--nodes-black') ?? spec.nodes);

  const played: SelfPlayGame[] = [];
  for (let i = 0; i < games; i += 1) {
    const s = seed + i;
    process.stderr.write(`${spec.label} self-play, ${spec.nodes} nodes, seed ${s}\n`);
    const game =
      variant === 'jungle'
        ? await playJungle(
            spec,
            maxPlies,
            { plies: openingPlies, topK: openingTopK, rng: seededRng(s) },
            { red: nodesRed, black: nodesBlack },
          )
        : variant === 'banqi'
          ? await playBanqi(spec, s, maxPlies)
          : await playJungleFlip(spec, s, maxPlies);
    if (variant === 'jungle') game.seed = s;
    process.stderr.write(`  -> ${game.plies} plies, ${JSON.stringify(game.status)}\n`);
    played.push(game);
  }

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    resolve(out),
    `${JSON.stringify({ engine: spec.label, budgetSource: spec.budgetSource, games: played }, null, 2)}\n`,
  );
  process.stderr.write(`wrote ${out}\n`);
}

await main();
