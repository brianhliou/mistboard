// Generated, fictional local data. Never import player/game content from prod.
import {
  createXmjSetup,
  darkChessVariant,
  type GameEvent,
  maybeGameSpecForId,
  replayGameEvents,
  type XmjMove,
  xmjBotAction,
  xmjViewFor,
} from '@mistboard/game';
import { BANQI_ANALYSIS_DEPTH, BANQI_ANALYSIS_ENGINE_ID } from './banqi-analysis.js';
import { summarizeReplay } from './corpus-ingest.js';
import {
  CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH,
  CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID,
} from './crazyhouse-xiangqi-fsf-engine.js';
import { DARK_CHESS_ANALYSIS_DEPTH, DARK_CHESS_ANALYSIS_ENGINE_ID } from './dark-chess-analysis.js';
import { JIEQI_ANALYSIS_DEPTH, JIEQI_ANALYSIS_ENGINE_ID } from './jieqi-analysis.js';
import { JUNGLE_ANALYSIS_DEPTH, JUNGLE_ANALYSIS_ENGINE_ID } from './jungle-analysis.js';
import {
  JUNGLE_FLIP_ANALYSIS_DEPTH,
  JUNGLE_FLIP_ANALYSIS_ENGINE_ID,
} from './jungle-flip-analysis.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';
import type { GameParticipantColor, GameSummary } from './persistence-games.js';
import { playRandomGame, VARIANTS } from './variant-postgame-fixtures.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import { XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_ANALYSIS_REQUEST_DEPTH } from './xiangqi-analysis.js';
import { xiangqiMahjongTenant } from './xiangqi-mahjong-tenant.js';

export const QA_VOLUME_CORPUS = 'qa-volume-v1';
// Fill the actual homepage fetch windows: forum=8 (fitRowsToBody keeps 4+),
// studies=6 (five column rows / six stacked tiles). Games follow Brian's #713
// spec, not the size of a production database. News is committed announcements.
export const QA_VOLUME = { gamesPerVariant: 10, topics: 8, studies: 6, chatLines: 6 } as const;
export const QA_PLAYERS = [
  { id: 'qa-volume-cedar', handle: 'qa-cedar-cannon', name: 'Cedar Cannon' },
  { id: 'qa-volume-lantern', handle: 'qa-lantern-horse', name: 'Lantern Horse' },
  { id: 'qa-volume-pebble', handle: 'qa-pebble-rook', name: 'Pebble Rook' },
  { id: 'qa-volume-willow', handle: 'qa-willow-elephant', name: 'Willow Elephant' },
] as const;

export function assertLocalQaDatabase(value: string): void {
  const host = new URL(value).hostname;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error('QA volume seed requires a loopback database.');
  }
}

export function qaVolumeSpecIds(productIds: readonly string[]): string[] {
  return productIds.filter((id) => {
    const spec = maybeGameSpecForId(id);
    if (!spec) throw new Error(`Unknown QA product spec ${id}`);
    return spec.runtimeStatus === 'live' && spec.publicSurface !== 'hidden';
  });
}

function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function playQaXmjGame(seed: number, plyCap: number) {
  const tenant = xiangqiMahjongTenant;
  // Correspondence setup avoids real-time claim pauses in the offline harness.
  const setup = createXmjSetup(random(seed), { correspondence: true });
  let state = tenant.rules.createInitialState('xmj_qa', setup);
  const events: unknown[] = [
    { type: 'room-created', roomId: 'xmj_qa', gameSpecId: tenant.gameSpecId, at: 0, setup },
  ];
  let plies = 0;
  while (plies < plyCap && state.status.type === 'playing') {
    // Claims belong to the responder even though status.turn names the player
    // who will next discard. The player-view action list carries this rule.
    const moves = tenant.colors.flatMap((by) => {
      const action = xmjBotAction(xmjViewFor(state, by), by);
      return action ? [{ ...action, by, at: (plies + 1) * 3000 }] : [];
    });
    const move = moves[0] ?? tenant.rules.pendingAction?.(state)?.move;
    if (!move || !tenant.rules.isLegalMove(state, move))
      throw new Error('XMJ fixture has no legal action');
    state = tenant.rules.applyMove(state, move);
    events.push({ type: 'move-played', roomId: 'xmj_qa', at: move.at, color: move.by, move });
    plies++;
  }
  return { events, plies, finished: state.status.type === 'finished' };
}

export type QaGame = {
  roomId: string;
  events: Array<{ type: string; at: number; roomId: string }>;
  summary: GameSummary;
};

export function buildQaGame(specId: string, index: number, now: number): QaGame {
  const seed = 713 + index * 31;
  const plyCap = 40 + index * 2;
  const startAt = now - (index + 1) * 60 * 60 * 1000;
  let summary: GameSummary;
  let colors: readonly GameParticipantColor[];
  let events: QaGame['events'];
  let roomId: string;
  if (specId === 'dark-chess') {
    roomId = `qa_volume_fog_${String(index).padStart(2, '0')}`;
    const tape: GameEvent[] = [
      { type: 'room-created', at: startAt, roomId, variant: 'dark-chess', gameSpecId: specId },
    ];
    const rng = random(seed);
    let state = darkChessVariant.createInitialState(roomId);
    for (let ply = 0; ply < plyCap && state.status.type === 'playing'; ply++) {
      const color = state.status.turn;
      const legal = darkChessVariant.getLegalMoves(state, color);
      if (!legal.length) throw new Error('Fog fixture has no legal move');
      const move = legal[Math.floor(rng() * legal.length)]!;
      state = darkChessVariant.applyMove(state, move);
      tape.push({ type: 'move-played', at: startAt + (ply + 1) * 3000, roomId, color, move });
    }
    if (state.status.type === 'playing') {
      tape.push({
        type: 'seat-resigned',
        at: startAt + (tape.length + 1) * 3000,
        roomId,
        color: state.status.turn,
      });
    }
    const replay = summarizeReplay(tape);
    if (!replay.finished || replayGameEvents(tape).state.status.type !== 'finished') {
      throw new Error('Fog fixture did not finish');
    }
    summary = {
      ...replay,
      startedAt: new Date(startAt),
      endedAt: new Date(tape.at(-1)!.at),
      whiteClient: null,
      blackClient: null,
      whiteName: null,
      blackName: null,
      corpusId: QA_VOLUME_CORPUS,
    };
    events = tape;
    colors = ['white', 'black'];
  } else {
    const spec = VARIANTS.find((entry) => entry.tenant.gameSpecId === specId);
    if (!spec && specId !== 'xiangqi-mahjong')
      throw new Error(`No QA legal-play generator for ${specId}`);
    const tenant = specId === 'xiangqi-mahjong' ? xiangqiMahjongTenant : spec!.tenant;
    roomId = `${tenant.roomIdPrefix}qa_volume_${String(index).padStart(2, '0')}`;
    const played =
      specId === 'xiangqi-mahjong'
        ? playQaXmjGame(seed, plyCap)
        : playRandomGame(spec!, seed, plyCap);
    // Rebase the generated tape, including XMJ's timestamp-bearing actions.
    events = (played.events as Array<QaGame['events'][number] & { move?: XmjMove }>).map(
      (event, i) => ({
        ...event,
        roomId,
        at: startAt + i * 3000,
        ...(event.move && 'at' in event.move
          ? { move: { ...event.move, at: startAt + i * 3000 } }
          : {}),
      }),
    );
    if (!played.finished) {
      const hydration = createTenantRuntimeRoomFromEvents(tenant, events as never[]);
      if (!hydration.ok) throw new Error(hydration.error);
      const status = hydration.room.projection.state.status;
      if (status.type !== 'playing') throw new Error(`${specId}: unexpected QA game status`);
      events.push({
        type: 'seat-resigned',
        at: startAt + events.length * 3000,
        roomId,
        ...{ color: status.turn },
      });
    }
    const hydration = createTenantRuntimeRoomFromEvents(tenant, events as never[]);
    if (!hydration.ok) throw new Error(hydration.error);
    if (hydration.room.projection.state.status.type !== 'finished')
      throw new Error(`${specId}: unfinished QA game`);
    summary =
      tenant.persistence.buildGameSummary?.(hydration.room) ??
      buildTenantGameSummary(tenant, hydration.room);
    if (summary.plyCount !== played.plies) throw new Error(`${specId}: replay dropped a move`);
    colors = tenant.colors;
  }
  const players = [
    QA_PLAYERS[index % QA_PLAYERS.length]!,
    QA_PLAYERS[(index + 1) % QA_PLAYERS.length]!,
  ];
  return {
    roomId,
    events,
    summary: {
      ...summary,
      mode: 'pvp',
      visibility: 'public',
      rated: false,
      corpusId: QA_VOLUME_CORPUS,
      whiteName: players[0]!.name,
      blackName: players[1]!.name,
      initialMs: 300000,
      incrementMs: 5000,
      participants: colors.map((color, i) => ({
        color,
        displayName: players[i]!.name,
        subjectType: 'user',
        subjectId: players[i]!.id,
        visibility: 'public',
      })),
    },
  };
}

export type QaAnalysis = {
  engineId: string;
  depth: number;
  payload: StoredPlyEval[] | { plies: StoredPlyEval[]; seats: object };
};

// Deliberately synthetic chart data, ONLY for qa-volume-v1 rooms on localhost.
// Use current cache keys so GET analysis renders a chart without engine binaries.
export function qaGameAnalysis(game: QaGame): QaAnalysis | null {
  const keys = new Map<string, [string, number]>([
    ['xiangqi', [XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_ANALYSIS_REQUEST_DEPTH]],
    ['jieqi', [JIEQI_ANALYSIS_ENGINE_ID, JIEQI_ANALYSIS_DEPTH]],
    ['banqi', [BANQI_ANALYSIS_ENGINE_ID, BANQI_ANALYSIS_DEPTH]],
    ['jungle', [JUNGLE_ANALYSIS_ENGINE_ID, JUNGLE_ANALYSIS_DEPTH]],
    ['jungle-flip', [JUNGLE_FLIP_ANALYSIS_ENGINE_ID, JUNGLE_FLIP_ANALYSIS_DEPTH]],
    [
      'crazyhouse-xiangqi',
      [CRAZYHOUSE_XIANGQI_ANALYSIS_ENGINE_ID, CRAZYHOUSE_XIANGQI_ANALYSIS_DEPTH],
    ],
    ['dark-chess', [DARK_CHESS_ANALYSIS_ENGINE_ID, DARK_CHESS_ANALYSIS_DEPTH]],
  ]);
  const key = keys.get(game.summary.variant);
  if (!key) return null; // These other variants have no stored advantage chart.
  const plies = Array.from({ length: game.summary.plyCount + 1 }, (_, ply) => ({
    ply,
    cp: Math.round(180 * Math.sin(ply / 5) + ply * 3),
    mate: null,
    best: null,
  }));
  return {
    engineId: key[0],
    depth: key[1],
    payload: game.summary.variant === 'dark-chess' ? { plies, seats: {} } : plies,
  };
}

export const QA_TOPIC_TITLES = [
  'Which cannon opening are you practising this week?',
  'A close finish in our evening Banqi games',
  'How do you count the unrevealed pieces in Jieqi?',
  'Share a favourite Jungle river crossing',
  'Learning to coordinate the horses and rooks',
  'A small study group for new Xiangqi players',
  'When is it worth trading a cannon for a horse?',
  'Postgame notes from a friendly rematch',
];

export function qaStudyRoot(index: number): object {
  const lines = [
    ['b1c3', 'b10c8', 'h3e3', 'h8e8'],
    ['h1g3', 'h10g8', 'b3e3', 'b8e8'],
  ];
  const root: { children: object[] } = { children: [] };
  let node = root;
  for (const uci of lines[index % lines.length]!) {
    const next = { uci, children: [] as object[] };
    node.children.push(next);
    node = next;
  }
  return { version: 1, root };
}
