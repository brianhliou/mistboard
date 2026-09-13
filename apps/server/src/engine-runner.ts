import { spawn } from 'node:child_process';
import {
  type Color,
  capturedRoleFor,
  clockRemainingMs,
  expireClock,
  type GameEvent,
  replayGameEvents,
  type VariantId,
  variantForId,
} from '@mistboard/game';
import type pg from 'pg';
import {
  type EngineGameTask,
  finishEngineGameTask,
  heartbeatEngineGameTask,
  reconcileExperimentJob,
} from './engine-experiments.js';
import { defaultStockfishPath, engineDir, enginePython, engineScript } from './engine-paths.js';
import {
  type EngineDefinition,
  type EngineMoveDecision,
  engineVersionDisplayName,
  loadEngine,
  upsertBuiltinEngineVersions,
} from './engine-registry.js';
import {
  clockStartedEvent,
  normalizeEngineTimeControl,
  roomTimeControlFromEngine,
  timeoutResult,
} from './engine-time-policy.js';
import { xiangqiEngineTierFor } from './xiangqi-engine-catalog.js';
import { playXiangqiEngineGame } from './xiangqi-engine-game.js';
import type { XiangqiEvent } from './xiangqi-runtime.js';

const HEARTBEAT_EVERY_PLIES = 8;

export async function runRandomLegalEngineGame(
  pool: pg.Pool,
  task: EngineGameTask,
): Promise<{ gameId: string; plyCount: number; status: 'completed' | 'aborted' }> {
  if (!task.claimToken) throw new Error(`task ${task.id} has no claim token`);

  const runnerStartedAt = Date.now();
  const isXiangqi = task.config.variant === 'xiangqi';
  const gameId = task.gameId ?? (isXiangqi ? `xq_eve_${task.id}` : `eve_${task.id}`);
  const startedAt = new Date();
  const whiteEngine = loadEngine(
    task.whiteEngineId ?? engineIdFromConfig(task.config, 'white_engine_id'),
  );
  const blackEngine = loadEngine(
    task.blackEngineId ?? engineIdFromConfig(task.config, 'black_engine_id'),
  );
  await upsertBuiltinEngineVersions(pool, [whiteEngine.id, blackEngine.id]);

  if (isXiangqi) {
    return runXiangqiEngineGame(
      pool,
      task,
      gameId,
      startedAt,
      whiteEngine,
      blackEngine,
      runnerStartedAt,
    );
  }

  const variant = variantFromTask(task);

  if (requiresPythonGameRunner(whiteEngine, blackEngine)) {
    return runPythonSubprocessEngineGame(
      pool,
      task,
      gameId,
      variant,
      startedAt,
      whiteEngine,
      blackEngine,
    );
  }

  await createRunningGame(pool, task, gameId, variant, startedAt, whiteEngine, blackEngine);

  const timeControl = normalizeEngineTimeControl(task.timeControl);
  const roomTimeControl = roomTimeControlFromEngine(timeControl);
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: startedAt.getTime(),
      roomId: gameId,
      variant,
      ...(roomTimeControl ? { timeControl: roomTimeControl } : {}),
    },
    {
      type: 'seat-assigned',
      at: startedAt.getTime(),
      roomId: gameId,
      clientId: 'engine:white',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: startedAt.getTime(),
      roomId: gameId,
      clientId: 'engine:black',
      seat: 'black',
    },
  ];
  const clockEvent = clockStartedEvent(gameId, startedAt.getTime(), timeControl);
  if (clockEvent) events.push(clockEvent);

  for (let seq = 0; seq < events.length; seq++) {
    await appendEvent(pool, gameId, seq, events[seq]!);
  }

  let projection = replayGameEvents(events);
  let seed = seedFromTask(task);
  const maxPlies = maxPliesFromTask(task);
  let totalThinkTimeMs = 0;

  while (projection.state.status.type === 'playing') {
    const color = projection.state.status.turn;
    const moves = variantForId(variant).getLegalMoves(projection.state, color);
    const ply = moveCount(events);
    if (moves.length === 0) {
      await abortGame(pool, task, gameId, ply, 'no-legal-moves');
      await recordRuntimeSummary(pool, task, gameId, {
        runner: 'typescript-in-process',
        status: 'aborted',
        termination: 'no-legal-moves',
        plyCount: ply,
        wallMs: Date.now() - runnerStartedAt,
        totalThinkTimeMs,
        whiteEngineId: whiteEngine.id,
        blackEngineId: blackEngine.id,
      });
      return { gameId, plyCount: ply, status: 'aborted' };
    }

    if (ply >= maxPlies) {
      await completeTruncatedGame(pool, task, gameId, ply);
      await recordRuntimeSummary(pool, task, gameId, {
        runner: 'typescript-in-process',
        status: 'completed',
        termination: 'truncated',
        plyCount: ply,
        wallMs: Date.now() - runnerStartedAt,
        totalThinkTimeMs,
        whiteEngineId: whiteEngine.id,
        blackEngineId: blackEngine.id,
      });
      return { gameId, plyCount: ply, status: 'completed' };
    }

    const engine = color === 'white' ? whiteEngine : blackEngine;
    if (!engine.chooseMove)
      throw new Error(`engine ${engine.id} does not support in-process move selection`);
    const clock = projection.state.clock;
    const remainingMs = clock ? clockRemainingMs(clock, color, latestEventAt(events)) : undefined;
    const decision = engine.chooseMove({
      baseThinkTimeMs: 650,
      clockRemainingMs: remainingMs,
      state: projection.state,
      color,
      incrementMs: clock?.incrementMs,
      legalMoves: moves,
      seed,
      ply,
    });
    const move = decision.move;
    seed = nextSeed(seed);
    const previousEventAt = events[events.length - 1]?.at ?? startedAt.getTime();
    const thinkTimeMs = Math.max(0, Math.round(decision.thinkTimeMs ?? 0));
    totalThinkTimeMs += thinkTimeMs;
    const eventAt = previousEventAt + Math.max(1, thinkTimeMs);
    if (remainingMs !== undefined && thinkTimeMs > remainingMs) {
      const expiredClock = expireClock(clock, eventAt, color);
      if (expiredClock) {
        await appendEvent(pool, gameId, events.length, {
          type: 'clock-expired',
          at: eventAt,
          roomId: gameId,
          color,
          clock: expiredClock,
        });
      }
      await completeTimeoutGame(pool, task, gameId, ply, color);
      await recordRuntimeSummary(pool, task, gameId, {
        runner: 'typescript-in-process',
        status: 'completed',
        termination: 'timeout',
        plyCount: ply,
        wallMs: Date.now() - runnerStartedAt,
        totalThinkTimeMs,
        whiteEngineId: whiteEngine.id,
        blackEngineId: blackEngine.id,
      });
      return { gameId, plyCount: ply, status: 'completed' };
    }
    const captured = capturedRoleFor(projection.state, move);
    const event: GameEvent = {
      type: 'move-played',
      at: eventAt,
      roomId: gameId,
      color,
      move,
      ...(captured ? { capturedRole: captured } : {}),
      ...(decision.thinkTimeMs !== undefined ? { thinkTimeMs } : {}),
    };
    await appendEvent(pool, gameId, events.length, event);
    await recordMoveDecision(pool, task, gameId, ply, color, engine, decision);
    events.push(event);
    if (moveCount(events) % HEARTBEAT_EVERY_PLIES === 0) {
      await heartbeatEngineGameTask(pool, task.id, task.claimToken);
    }
    projection = replayGameEvents(events);
  }

  const status = projection.state.status;
  if (status.type !== 'finished') {
    const ply = moveCount(events);
    await completeTruncatedGame(pool, task, gameId, ply);
    await recordRuntimeSummary(pool, task, gameId, {
      runner: 'typescript-in-process',
      status: 'completed',
      termination: 'truncated',
      plyCount: ply,
      wallMs: Date.now() - runnerStartedAt,
      totalThinkTimeMs,
      whiteEngineId: whiteEngine.id,
      blackEngineId: blackEngine.id,
    });
    return { gameId, plyCount: ply, status: 'completed' };
  }

  const result =
    status.winner === 'white' ? 'white-wins' : status.winner === 'black' ? 'black-wins' : 'draw';
  const termination = status.reason;
  const plyCount = events.filter((event) => event.type === 'move-played').length;

  await pool.query(
    `UPDATE games
     SET status = 'completed',
         result = $2,
         termination = $3,
         ply_count = $4,
         ended_at = $5,
         aborted_reason = NULL
     WHERE room_id = $1`,
    [gameId, result, termination, plyCount, new Date()],
  );
  await finishEngineGameTask(pool, task.id, task.claimToken, 'completed');
  await reconcileExperimentJob(pool, task.jobId);
  await recordRuntimeSummary(pool, task, gameId, {
    runner: 'typescript-in-process',
    status: 'completed',
    termination,
    plyCount,
    wallMs: Date.now() - runnerStartedAt,
    totalThinkTimeMs,
    whiteEngineId: whiteEngine.id,
    blackEngineId: blackEngine.id,
  });

  return { gameId, plyCount, status: 'completed' };
}

async function runXiangqiEngineGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  startedAt: Date,
  redEngine: EngineDefinition,
  blackEngine: EngineDefinition,
  runnerStartedAt: number,
): Promise<{ gameId: string; plyCount: number; status: 'completed' | 'aborted' }> {
  if (
    xiangqiEngineTierFor(redEngine.id) === null ||
    xiangqiEngineTierFor(blackEngine.id) === null
  ) {
    throw new Error('xiangqi Eve tasks require two registered standard-Xiangqi profiles');
  }
  await createRunningXiangqiGame(pool, task, gameId, startedAt, redEngine, blackEngine);
  const result = await playXiangqiEngineGame({
    roomId: gameId,
    redEngineId: redEngine.id,
    blackEngineId: blackEngine.id,
    maxPlies: maxPliesFromTask(task),
    openingPolicy: task.openingPolicy,
    startedAt: startedAt.getTime(),
    onEvent: async (event, seq) => {
      await appendEvent(pool, gameId, seq, event);
      if (event.type === 'move-played' && (seq - 2) % HEARTBEAT_EVERY_PLIES === 0) {
        await heartbeatEngineGameTask(pool, task.id, task.claimToken!);
      }
    },
  });

  if (result.status === 'aborted') {
    await abortGame(pool, task, gameId, result.plyCount, 'engine-failure');
  } else {
    await pool.query(
      `UPDATE games
       SET status = 'completed', result = $2, termination = $3, ply_count = $4,
           ended_at = $5, aborted_reason = NULL
       WHERE room_id = $1`,
      [gameId, result.result, result.termination, result.plyCount, new Date()],
    );
    await finishEngineGameTask(pool, task.id, task.claimToken!, 'completed');
    await reconcileExperimentJob(pool, task.jobId);
  }
  await recordRuntimeSummary(pool, task, gameId, {
    runner: 'xiangqi-uci',
    status: result.status,
    termination: result.termination,
    plyCount: result.plyCount,
    wallMs: Date.now() - runnerStartedAt,
    totalThinkTimeMs: result.totalThinkTimeMs,
    whiteEngineId: redEngine.id,
    blackEngineId: blackEngine.id,
  });
  return { gameId, plyCount: result.plyCount, status: result.status };
}

async function runPythonSubprocessEngineGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  variant: VariantId,
  startedAt: Date,
  whiteEngine: EngineDefinition,
  blackEngine: EngineDefinition,
): Promise<{ gameId: string; plyCount: number; status: 'completed' | 'aborted' }> {
  const runnerStartedAt = Date.now();
  await createRunningGame(pool, task, gameId, variant, startedAt, whiteEngine, blackEngine);

  const timeControl = normalizeEngineTimeControl(task.timeControl);
  const roomTimeControl = roomTimeControlFromEngine(timeControl);
  const baseEvents: GameEvent[] = [
    {
      type: 'room-created',
      at: startedAt.getTime(),
      roomId: gameId,
      variant,
      ...(roomTimeControl ? { timeControl: roomTimeControl } : {}),
    },
    {
      type: 'seat-assigned',
      at: startedAt.getTime(),
      roomId: gameId,
      clientId: 'engine:white',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: startedAt.getTime(),
      roomId: gameId,
      clientId: 'engine:black',
      seat: 'black',
    },
  ];
  const clockEvent = clockStartedEvent(gameId, startedAt.getTime(), timeControl);
  if (clockEvent) baseEvents.push(clockEvent);
  for (let seq = 0; seq < baseEvents.length; seq++) {
    await appendEvent(pool, gameId, seq, baseEvents[seq]!);
  }

  const result = await runPythonGameProcess({
    roomId: gameId,
    seed: task.seed,
    maxPlies: maxPliesFromTask(task),
    timeControl: task.timeControl,
    openingPolicy: task.openingPolicy,
    white: { id: whiteEngine.id },
    black: { id: blackEngine.id },
  });

  const moveEvents = sanitizePythonMoveEvents(result.events, gameId, startedAt.getTime());
  for (let index = 0; index < moveEvents.length; index++) {
    await appendEvent(pool, gameId, baseEvents.length + index, moveEvents[index]!);
    if ((index + 1) % HEARTBEAT_EVERY_PLIES === 0) {
      await heartbeatEngineGameTask(pool, task.id, task.claimToken!);
    }
  }

  const projection = replayGameEvents([...baseEvents, ...moveEvents]);
  const plyCount = moveEvents.length;

  const status = projection.state.status;
  const resultLabel =
    status.type === 'finished'
      ? status.winner === 'white'
        ? 'white-wins'
        : status.winner === 'black'
          ? 'black-wins'
          : 'draw'
      : result.winner === 'white'
        ? 'white-wins'
        : result.winner === 'black'
          ? 'black-wins'
          : 'draw';
  const termination =
    result.endReason === 'clock-expired'
      ? 'timeout'
      : result.endReason === 'truncated'
        ? 'truncated'
        : result.endReason === 'no-legal-moves'
          ? 'draw'
          : status.type === 'finished'
            ? status.reason
            : result.endReason;

  await pool.query(
    `UPDATE games
     SET status = 'completed',
         result = $2,
         termination = $3,
         ply_count = $4,
         ended_at = $5,
         aborted_reason = NULL
     WHERE room_id = $1`,
    [gameId, resultLabel, termination, plyCount, new Date()],
  );
  await finishEngineGameTask(pool, task.id, task.claimToken!, 'completed');
  await reconcileExperimentJob(pool, task.jobId);
  await recordPythonGameSummary(pool, task, gameId, result);
  await recordRuntimeSummary(pool, task, gameId, {
    runner: 'python-subprocess',
    status: 'completed',
    termination,
    plyCount,
    wallMs: Date.now() - runnerStartedAt,
    totalThinkTimeMs: moveEvents.reduce(
      (total, event) => total + (event.type === 'move-played' ? (event.thinkTimeMs ?? 0) : 0),
      0,
    ),
    whiteEngineId: whiteEngine.id,
    blackEngineId: blackEngine.id,
  });

  return { gameId, plyCount, status: 'completed' };
}

async function createRunningGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  variant: VariantId,
  startedAt: Date,
  whiteEngine: EngineDefinition,
  blackEngine: EngineDefinition,
): Promise<void> {
  const roomTimeControl = roomTimeControlFromEngine(normalizeEngineTimeControl(task.timeControl));
  await pool.query(
    `INSERT INTO games
       (room_id, variant, result, termination, ply_count, started_at, ended_at,
        white_client, black_client, white_name, black_name, corpus_id,
        mode, status, review_status, initial_ms, increment_ms)
     VALUES ($1, $2, NULL, NULL, 0, $3, NULL,
        'engine:white', 'engine:black', $4, $5, NULL,
        'eve', 'running', 'unreviewed', $6, $7)
     ON CONFLICT (room_id) DO NOTHING`,
    [
      gameId,
      variant,
      startedAt,
      whiteEngine.id,
      blackEngine.id,
      roomTimeControl?.initialMs ?? null,
      roomTimeControl?.incrementMs ?? null,
    ],
  );

  await upsertEngineGameParticipants(pool, gameId, whiteEngine, blackEngine);

  await pool.query(
    `UPDATE engine_game_tasks
     SET game_id = $2
     WHERE id = $1
       AND game_id IS NULL`,
    [task.id, gameId],
  );

  await pool.query(
    `INSERT INTO eve_games
       (game_id, job_id, task_id, game_index, worker_id,
        white_engine_id, black_engine_id,
        white_config_hash, black_config_hash,
        white_play_signature, black_play_signature,
        time_control, opening_policy, seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (game_id) DO NOTHING`,
    [
      gameId,
      task.jobId,
      task.id,
      task.gameIndex,
      task.workerId,
      whiteEngine.id,
      blackEngine.id,
      whiteEngine.configHash,
      blackEngine.configHash,
      whiteEngine.playSignature,
      blackEngine.playSignature,
      task.timeControl,
      task.openingPolicy,
      task.seed,
    ],
  );
  await upsertEngineGameParticipants(pool, gameId, whiteEngine, blackEngine);

  await pool.query(
    `UPDATE eve_jobs
     SET status = 'running',
         started_at = COALESCE(started_at, now())
     WHERE id = $1
       AND status = 'queued'`,
    [task.jobId],
  );
}

async function createRunningXiangqiGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  startedAt: Date,
  redEngine: EngineDefinition,
  blackEngine: EngineDefinition,
): Promise<void> {
  const roomTimeControl = roomTimeControlFromEngine(normalizeEngineTimeControl(task.timeControl));
  await pool.query(
    `INSERT INTO games
       (room_id, variant, result, termination, ply_count, started_at, ended_at,
        white_client, black_client, white_name, black_name, corpus_id,
        mode, status, review_status, initial_ms, increment_ms)
     VALUES ($1, 'xiangqi', NULL, NULL, 0, $2, NULL,
        $3, $4, $5, $6, NULL, 'eve', 'running', 'unreviewed', $7, $8)
     ON CONFLICT (room_id) DO NOTHING`,
    [
      gameId,
      startedAt,
      redEngine.id,
      blackEngine.id,
      redEngine.name,
      blackEngine.name,
      roomTimeControl?.initialMs ?? null,
      roomTimeControl?.incrementMs ?? null,
    ],
  );
  await upsertEngineGameParticipants(pool, gameId, redEngine, blackEngine, ['red', 'black']);
  await pool.query(`UPDATE engine_game_tasks SET game_id = $2 WHERE id = $1 AND game_id IS NULL`, [
    task.id,
    gameId,
  ]);
  await pool.query(
    `INSERT INTO eve_games
       (game_id, job_id, task_id, game_index, worker_id,
        white_engine_id, black_engine_id,
        white_config_hash, black_config_hash,
        white_play_signature, black_play_signature,
        time_control, opening_policy, seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (game_id) DO NOTHING`,
    [
      gameId,
      task.jobId,
      task.id,
      task.gameIndex,
      task.workerId,
      redEngine.id,
      blackEngine.id,
      redEngine.configHash,
      blackEngine.configHash,
      redEngine.playSignature,
      blackEngine.playSignature,
      task.timeControl,
      task.openingPolicy,
      task.seed,
    ],
  );
  await pool.query(
    `UPDATE eve_jobs
     SET status = 'running', started_at = COALESCE(started_at, now())
     WHERE id = $1 AND status = 'queued'`,
    [task.jobId],
  );
}

async function upsertEngineGameParticipants(
  pool: pg.Pool,
  gameId: string,
  whiteEngine: EngineDefinition,
  blackEngine: EngineDefinition,
  colors: readonly ['white' | 'red', 'black'] = ['white', 'black'],
): Promise<void> {
  for (const [color, engine] of [
    [colors[0], whiteEngine],
    [colors[1], blackEngine],
  ] as const) {
    await pool.query(
      `INSERT INTO game_participants
         (game_id, color, subject_type, subject_id, display_name, visibility)
       VALUES ($1, $2, 'engine-version', $3, $4, 'public')
       ON CONFLICT (game_id, color) DO UPDATE SET
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         display_name = EXCLUDED.display_name,
         visibility = EXCLUDED.visibility`,
      [gameId, color, engine.id, engineVersionDisplayName(engine.id)],
    );
  }
}

async function appendEvent(
  pool: pg.Pool,
  gameId: string,
  seq: number,
  event: GameEvent | XiangqiEvent,
): Promise<void> {
  await pool.query(
    `INSERT INTO events (room_id, seq, type, payload)
     VALUES ($1, $2, $3, $4)`,
    [gameId, seq, event.type, event],
  );
}

async function completeTruncatedGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  plyCount: number,
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET status = 'completed',
         result = 'draw',
         termination = 'truncated',
         ply_count = $2,
         ended_at = $3,
         aborted_reason = NULL
     WHERE room_id = $1`,
    [gameId, plyCount, new Date()],
  );
  await finishEngineGameTask(pool, task.id, task.claimToken!, 'completed');
  await reconcileExperimentJob(pool, task.jobId);
}

async function completeTimeoutGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  plyCount: number,
  timedOutColor: Color,
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET status = 'completed',
         result = $2,
         termination = 'timeout',
         ply_count = $3,
         ended_at = $4,
         aborted_reason = NULL
     WHERE room_id = $1`,
    [gameId, timeoutResult(timedOutColor), plyCount, new Date()],
  );
  await finishEngineGameTask(pool, task.id, task.claimToken!, 'completed');
  await reconcileExperimentJob(pool, task.jobId);
}

async function abortGame(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  plyCount: number,
  termination: 'engine-failure' | 'no-legal-moves' | 'truncated' | 'worker-aborted',
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET status = 'aborted',
         result = NULL,
         termination = $2,
         ply_count = $3,
         ended_at = $4,
         aborted_reason = $2
     WHERE room_id = $1`,
    [gameId, termination, plyCount, new Date()],
  );
  await finishEngineGameTask(pool, task.id, task.claimToken!, 'aborted', termination);
  await reconcileExperimentJob(pool, task.jobId);
}

function variantFromTask(task: EngineGameTask): VariantId {
  const id = task.config.variant;
  if (id === 'dark-chess' || id === 'chess') return id;
  throw new Error(`unknown engine task variant: ${JSON.stringify(id)}`);
}

function maxPliesFromTask(task: EngineGameTask): number {
  const value = task.config.max_plies;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 160;
}

function engineIdFromConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' ? value : null;
}

function requiresPythonGameRunner(
  whiteEngine: EngineDefinition,
  blackEngine: EngineDefinition,
): boolean {
  return isPythonEngine(whiteEngine) || isPythonEngine(blackEngine);
}

function isPythonEngine(engine: EngineDefinition): boolean {
  return engine.config.kind === 'python-subprocess';
}

type PythonGameRequest = {
  roomId: string;
  seed: string;
  maxPlies: number;
  timeControl: Record<string, unknown>;
  openingPolicy: Record<string, unknown>;
  white: { id: string };
  black: { id: string };
};

type PythonGameResult = {
  roomId: string;
  plies: number;
  winner: 'white' | 'black' | null;
  endReason: 'king-captured' | 'truncated' | 'draw' | 'no-legal-moves' | 'clock-expired';
  truncated: boolean;
  events: unknown[];
  engines?: unknown;
};

async function runPythonGameProcess(request: PythonGameRequest): Promise<PythonGameResult> {
  const python = enginePython();
  const script = process.env.PYTHON_ENGINE_RUNNER ?? engineScript('eve_game_runner.py');
  const stockfishPath =
    process.env.PYTHON_ENGINE_STOCKFISH_PATH ??
    process.env.STOCKFISH_PATH ??
    defaultStockfishPath();
  const payload = stockfishPath ? { ...request, stockfishPath } : request;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [script], {
      cwd: engineDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stderrText = Buffer.concat(stderr).toString('utf8').trim();
      const stdoutText = Buffer.concat(stdout).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(`python engine runner exited ${code}: ${stderrText || stdoutText}`));
        return;
      }
      try {
        resolvePromise(parsePythonGameResult(JSON.parse(stdoutText)));
      } catch (err) {
        reject(new Error(`invalid python engine runner output: ${(err as Error).message}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

// defaultStockfishPath now lives in engine-paths (one definition, three callers).

function parsePythonGameResult(value: unknown): PythonGameResult {
  if (!isObject(value)) throw new Error('top-level response is not an object');
  if (typeof value.roomId !== 'string') throw new Error('missing roomId');
  if (!Array.isArray(value.events)) throw new Error('missing events');
  if (
    !['king-captured', 'truncated', 'draw', 'no-legal-moves', 'clock-expired'].includes(
      String(value.endReason),
    )
  ) {
    throw new Error(`unsupported endReason ${String(value.endReason)}`);
  }
  return value as PythonGameResult;
}

function sanitizePythonMoveEvents(
  events: unknown[],
  gameId: string,
  startedAt: number,
): GameEvent[] {
  const result: GameEvent[] = [];
  let previousEventAt = startedAt;
  for (const event of events) {
    if (!isObject(event) || event.type !== 'move-played') continue;
    const move = event.move;
    if (!isObject(move)) throw new Error('python move-played event is missing move');
    if (event.color !== 'white' && event.color !== 'black')
      throw new Error('python move-played event has invalid color');
    if (typeof move.from !== 'string' || typeof move.to !== 'string') {
      throw new Error('python move-played event has invalid move squares');
    }
    const thinkTimeMs =
      typeof event.thinkTimeMs === 'number' && Number.isFinite(event.thinkTimeMs)
        ? Math.max(0, Math.round(event.thinkTimeMs))
        : typeof event.compute_ms === 'number' && Number.isFinite(event.compute_ms)
          ? Math.max(0, Math.round(event.compute_ms))
          : 1;
    previousEventAt += Math.max(1, thinkTimeMs);
    result.push({
      type: 'move-played',
      at: previousEventAt,
      roomId: gameId,
      color: event.color,
      move: {
        from: move.from,
        to: move.to,
        ...(typeof move.promotion === 'string' ? { promotion: move.promotion } : {}),
      },
      thinkTimeMs,
    } as GameEvent);
  }
  return result;
}

async function recordPythonGameSummary(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  result: PythonGameResult,
): Promise<void> {
  if (!shouldRecordMoveChoices(task)) return;
  await pool.query(
    `INSERT INTO game_debug_artifacts
       (game_id, ply, engine_color, artifact_type, storage, payload)
     VALUES ($1, 0, NULL, 'python-engine-game-summary', 'jsonb', $2)`,
    [
      gameId,
      {
        end_reason: result.endReason,
        winner: result.winner,
        plies: result.plies,
        engines: result.engines ?? null,
      },
    ],
  );
}

type RuntimeSummaryInput = {
  blackEngineId: string;
  plyCount: number;
  runner: 'typescript-in-process' | 'python-subprocess' | 'xiangqi-uci';
  status: 'completed' | 'aborted';
  termination: string;
  totalThinkTimeMs: number;
  wallMs: number;
  whiteEngineId: string;
};

async function recordRuntimeSummary(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  input: RuntimeSummaryInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO game_debug_artifacts
       (game_id, ply, engine_color, artifact_type, storage, payload)
     VALUES ($1, NULL, NULL, 'engine-runtime-summary', 'jsonb', $2)`,
    [
      gameId,
      {
        black_engine_id: input.blackEngineId,
        job_id: task.jobId,
        ply_count: input.plyCount,
        runner: input.runner,
        status: input.status,
        task_id: task.id,
        termination: input.termination,
        time_control: task.timeControl,
        total_think_time_ms: input.totalThinkTimeMs,
        avg_think_time_ms: input.plyCount > 0 ? input.totalThinkTimeMs / input.plyCount : 0,
        wall_ms: input.wallMs,
        plies_per_second: input.wallMs > 0 ? input.plyCount / (input.wallMs / 1000) : null,
        white_engine_id: input.whiteEngineId,
        worker_id: task.workerId,
      },
    ],
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function recordMoveDecision(
  pool: pg.Pool,
  task: EngineGameTask,
  gameId: string,
  ply: number,
  color: Color,
  engine: EngineDefinition,
  decision: EngineMoveDecision,
): Promise<void> {
  if (!shouldRecordMoveChoices(task)) return;
  await pool.query(
    `INSERT INTO game_debug_artifacts
       (game_id, ply, engine_color, artifact_type, storage, payload)
     VALUES ($1, $2, $3, 'engine-move-choice', 'jsonb', $4)`,
    [
      gameId,
      ply,
      color,
      {
        engine_id: engine.id,
        play_signature: engine.playSignature,
        selected_move: decision.move,
        scored_moves: decision.scores,
        think_time_ms: decision.thinkTimeMs,
      },
    ],
  );
}

function shouldRecordMoveChoices(task: EngineGameTask): boolean {
  return (
    task.artifactPolicy.move_choices === 'all' || task.artifactPolicy.engine_move_choices === 'all'
  );
}

function moveCount(events: GameEvent[]): number {
  return events.filter((event) => event.type === 'move-played').length;
}

function latestEventAt(events: GameEvent[]): number {
  return events[events.length - 1]?.at ?? Date.now();
}

function seedFromTask(task: EngineGameTask): bigint {
  try {
    return BigInt(task.seed);
  } catch {
    return 1n;
  }
}

function nextSeed(seed: bigint): bigint {
  return (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 63n) - 1n);
}
