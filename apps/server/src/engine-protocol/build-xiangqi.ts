/**
 * Full Dark Xiangqi engine request builder: the 9x10 sibling of the chess and
 * DMX builders.
 *
 * The engine gets exactly the bot seat's view, the same one the human wire
 * carries (`getDarkXiangqiClientView`): cannon screens and blocked horse-legs /
 * elephant-eyes go out COLOR-ONLY in `shrouded`, every other visible occupied
 * square with its full identity, off-vision squares not at all (#420).
 *
 * The engine must run with `FOW_XIANGQI_SHROUD_BLOCKERS=1`: an engine that still
 * expects full identity on those squares rejects every world and its belief
 * empties (the bot then forfeits). `MISTBOARD_XIANGQI_SHROUD_BLOCKERS=0` is the
 * rollback lever: it restores the legacy request, which names the shrouded
 * pieces to the engine, for an engine still running with its flag off.
 */

import {
  applyMove as applyXiangqiMove,
  type Color,
  createInitialXiangqiState,
  DARK_XIANGQI_SPEC_ID,
  type EngineClock,
  type EngineObservation,
  type EngineTurnRequest,
  getPlayerView as getXiangqiPlayerView,
  type Move,
  type SquareIndex,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
  type XiangqiVisibleBoardEntry,
  coordOf as xiangqiCoordOf,
} from '@mistboard/game';
import type { DarkXiangqiEvent } from '../dark-xiangqi-runtime.js';
import { buildSessionId, deriveEngineSeed } from './build.js';

/**
 * Whether to redact cannon-screen / horse-leg / elephant-eye identity to
 * color-only for the engine (matching the human view). On unless explicitly
 * turned off; see the module header for the engine flag it pairs with.
 */
function shroudBlockersEnabled(): boolean {
  const v = process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS;
  if (v === undefined || v === '') return true;
  return v !== '0' && v !== 'false' && v !== 'False';
}

const ROLE_TO_LETTER: Record<XiangqiPieceRole, 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P'> = {
  general: 'K',
  advisor: 'A',
  elephant: 'B',
  horse: 'N',
  chariot: 'R',
  cannon: 'C',
  soldier: 'P',
};

function toProtocolColor(c: XiangqiColor): Color {
  return c === 'red' ? 'white' : 'black';
}

function xiangqiSquareIndex(sq: XiangqiSquare): SquareIndex {
  const { file, rank } = xiangqiCoordOf(sq);
  return (rank - 1) * 9 + file;
}

function maskHex(mask: bigint): string {
  return `0x${mask.toString(16).padStart(23, '0')}`;
}

function ownSquaresOf(state: XiangqiGameState, color: XiangqiColor): XiangqiSquare[] {
  return (Object.entries(state.board) as Array<[XiangqiSquare, { color: XiangqiColor }]>)
    .filter(([, piece]) => piece?.color === color)
    .map(([sq]) => sq);
}

export function buildXiangqiObservationForPly(args: {
  prevState: XiangqiGameState | null;
  nextState: XiangqiGameState;
  move: XiangqiMove | null;
  perspective: XiangqiColor;
  ply: number;
}): EngineObservation {
  const { prevState, nextState, move, perspective, ply } = args;
  const mover = prevState?.status.type === 'playing' ? prevState.status.turn : null;
  const kind: EngineObservation['kind'] = !mover
    ? 'initial'
    : mover === perspective
      ? 'own_move'
      : 'opp_move';

  const view = getXiangqiPlayerView(nextState, perspective);
  let visibility_mask = 0n;
  for (const sq of view.visibleSquares) {
    visibility_mask |= 1n << BigInt(xiangqiSquareIndex(sq));
  }

  const visible_pieces: EngineObservation['visible_pieces'] = [];
  const shrouded: Array<[SquareIndex, Color]> = [];
  if (shroudBlockersEnabled()) {
    // Route shrouded blocker/screen squares to COLOR-ONLY; everything else keeps
    // full identity. Iterates the player-view board (which carries the same
    // per-square `shrouded` flag the human wire uses), so engine == human view.
    for (const [sq, entry] of Object.entries(view.board) as Array<
      [XiangqiSquare, XiangqiVisibleBoardEntry]
    >) {
      if (!entry) continue;
      const idx = xiangqiSquareIndex(sq);
      if (entry.shrouded) {
        shrouded.push([idx, toProtocolColor(entry.piece.color)]);
      } else {
        visible_pieces.push([
          idx,
          { type: ROLE_TO_LETTER[entry.piece.role], color: toProtocolColor(entry.piece.color) },
        ]);
      }
    }
  } else {
    // Legacy (rollback only): every visible occupied square fully identified,
    // shrouded ones included. Leaks blocker identity to the engine (#420).
    for (const sq of view.visibleSquares) {
      const piece = nextState.board[sq];
      if (!piece) continue;
      visible_pieces.push([
        xiangqiSquareIndex(sq),
        { type: ROLE_TO_LETTER[piece.role], color: toProtocolColor(piece.color) },
      ]);
    }
  }
  visible_pieces.sort((a, b) => a[0] - b[0]);
  shrouded.sort((a, b) => a[0] - b[0]);

  let own_capture_square: SquareIndex | null = null;
  let opp_capture_landing_square: SquareIndex | null = null;
  if (prevState) {
    const nextOwn = new Set(ownSquaresOf(nextState, perspective));
    const vacated = ownSquaresOf(prevState, perspective).find((sq) => !nextOwn.has(sq));
    if (vacated !== undefined) {
      own_capture_square = xiangqiSquareIndex(vacated);
      const landed = nextState.board[vacated];
      if (landed && landed.color !== perspective) {
        opp_capture_landing_square = own_capture_square;
      }
    }
  }

  const game_over =
    nextState.status.type === 'finished'
      ? {
          winner: nextState.status.winner ? toProtocolColor(nextState.status.winner) : null,
          reason: nextState.status.reason,
        }
      : null;

  const obs: EngineObservation = {
    ply,
    kind,
    own_move: kind === 'own_move' && move ? (move as unknown as Move) : null,
    visibility_mask: maskHex(visibility_mask),
    visible_pieces,
    own_capture_square,
    opp_capture_landing_square,
    game_over,
  };
  // Emit shrouded only when non-empty, so the legacy request stays byte-identical.
  if (shrouded.length > 0) obs.shrouded = shrouded;
  return obs;
}

export function buildXiangqiObservationTranscript(args: {
  gameId: string;
  events: DarkXiangqiEvent[];
  perspective: XiangqiColor;
}): EngineObservation[] {
  let state = createInitialXiangqiState(args.gameId);
  const transcript: EngineObservation[] = [
    buildXiangqiObservationForPly({
      prevState: null,
      nextState: state,
      move: null,
      perspective: args.perspective,
      ply: 0,
    }),
  ];
  let ply = 0;
  for (const ev of args.events) {
    if (ev.type !== 'move-played') continue;
    const prevState = state;
    state = applyXiangqiMove(state, ev.move);
    ply += 1;
    transcript.push(
      buildXiangqiObservationForPly({
        prevState,
        nextState: state,
        move: ev.move,
        perspective: args.perspective,
        ply,
      }),
    );
  }
  return transcript;
}

export function buildXiangqiEngineTurnRequest(args: {
  gameId: string;
  engineId: string;
  engineSecret: string;
  engineColor: XiangqiColor;
  state: XiangqiGameState;
  events: DarkXiangqiEvent[];
  ply: number;
  clockRemainingMs: number | null;
  incrementMs: number;
}): EngineTurnRequest {
  const protocolColor = toProtocolColor(args.engineColor);
  const sessionId = buildSessionId({
    gameId: args.gameId,
    engineId: args.engineId,
    color: protocolColor,
  });
  const engineSeed = deriveEngineSeed({
    engineSecret: args.engineSecret,
    gameId: args.gameId,
    engineId: args.engineId,
    color: protocolColor,
    ply: args.ply,
  });
  const observationTranscript = buildXiangqiObservationTranscript({
    gameId: args.gameId,
    events: args.events,
    perspective: args.engineColor,
  });
  const legalMoves = getXiangqiPlayerView(args.state, args.engineColor)
    .legalMoves as unknown as Move[];
  const clock: EngineClock = {
    remaining_ms: args.clockRemainingMs,
    increment_ms: args.incrementMs,
  };
  return {
    protocolVersion: '1',
    gameId: args.gameId,
    engineId: args.engineId,
    gameSpecId: DARK_XIANGQI_SPEC_ID,
    sessionId,
    color: protocolColor,
    ply: args.ply,
    engineSeed,
    clock,
    legalMoves,
    observationTranscript,
  };
}
