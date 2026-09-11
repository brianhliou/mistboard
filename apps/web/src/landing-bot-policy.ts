import {
  BANQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  engineTimeControlPin,
  FORTRESS_XIANGQI_SPEC_ID,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  type TimeControlId,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { defaultTimePresetForSpec } from './variant-tenant/registry.js';

// One small merchandising policy shared by the Lobby rows and Quick Pairing's
// Computer chips. Room creation remains server-authoritative.

export type LandingBotGameSpecId =
  | typeof XIANGQI_SPEC_ID
  | typeof BANQI_SPEC_ID
  | typeof JIEQI_SPEC_ID
  | typeof FORTRESS_XIANGQI_SPEC_ID
  | typeof DUCK_XIANGQI_SPEC_ID
  | typeof DARK_XIANGQI_SPEC_ID
  | typeof DARK_CHESS_SPEC_ID
  | typeof JUNGLE_SPEC_ID
  | typeof JUNGLE_FLIP_SPEC_ID;

export type LandingBotOffer = {
  botId: string;
  botName: string;
  gameSpecId: LandingBotGameSpecId;
  timeControlId: TimeControlId;
};

const ROTATION_BUCKET_MS = 6 * 60 * 60 * 1_000;

export const LANDING_BOT_GAME_SPEC_IDS: readonly LandingBotGameSpecId[] = [
  XIANGQI_SPEC_ID,
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
];

// Each bucket shows these plus the two fixed heads (xiangqi, fog chess), and
// any two CONSECUTIVE buckets must cover the whole shelf, which is what stops a
// variant from disappearing for a whole day.
//
// These are five long rather than four because duck made the rotating pool
// seven, and seven cannot be covered by consecutive pairs of four-lineups: each
// cyclic pair would have to intersect in exactly one, forcing sum(C(k,2)) == 3
// while sum(k) == 12 over seven variants, which no assignment satisfies. An
// exhaustive search over 3- and 4-lineup cycles at both widths confirmed it:
// five is the narrowest that works, so the panel shows seven tiles, not six.
const ROTATING_LINEUPS: readonly (readonly LandingBotGameSpecId[])[] = [
  [
    BANQI_SPEC_ID,
    JIEQI_SPEC_ID,
    FORTRESS_XIANGQI_SPEC_ID,
    DUCK_XIANGQI_SPEC_ID,
    DARK_XIANGQI_SPEC_ID,
  ],
  [BANQI_SPEC_ID, JIEQI_SPEC_ID, FORTRESS_XIANGQI_SPEC_ID, JUNGLE_SPEC_ID, JUNGLE_FLIP_SPEC_ID],
  [BANQI_SPEC_ID, DUCK_XIANGQI_SPEC_ID, DARK_XIANGQI_SPEC_ID, JUNGLE_SPEC_ID, JUNGLE_FLIP_SPEC_ID],
];

// Xiangqi's Lobby block is a fixed difficulty ladder, not a rotation: the rungs
// never change, so a returning player can climb them ("beat Level 5, try Level
// 8") and the Rating column reads as one ascending gradient instead of three
// unrelated numbers. Keep this ascending; the rows render in this order.
// Pikafish is deliberately not a rung: it is the separate elite challenge in
// the setup dialog's engine list, not a step on the human ladder.
const XIANGQI_LADDER_LEVELS = [2, 5, 8] as const;

// Which level the "Computer" control hands a xiangqi player (#365). With the
// middle rung as the fixed default, 38% of started xiangqi games ever finished
// and the commonest ending sitewide was red resigning after four moves, so a
// device with no remembered xiangqi engine (no bot game started here) gets the
// bottom rung. A remembered Fairy-Stockfish level is kept, so a player climbs
// by choosing; a remembered non-ladder engine (Pikafish) means a returning
// player who is not a newcomer, who gets the middle rung. Quick Pairing's chip
// shows no name, so the control must still never rotate on its own.
export const XIANGQI_FIRST_GAME_LEVEL = 2;
const XIANGQI_RETURNING_LEVEL = 5;
const FORTRESS_XIANGQI_LEVEL = 4;
const DUCK_XIANGQI_LEVEL = 4;
const LADDER_BOT_ID_PREFIX = 'fairy-stockfish-level-';

export type LandingBotOfferContext = {
  /** The xiangqi engine this device last started a bot game against, if any. */
  rememberedXiangqiBotId?: string | null;
};

export function fairyStockfishLevel(botId: string | null | undefined): number | null {
  if (!botId?.startsWith(LADDER_BOT_ID_PREFIX)) return null;
  const level = Number.parseInt(botId.slice(LADDER_BOT_ID_PREFIX.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 8 ? level : null;
}

export function xiangqiPrimaryLevel(rememberedBotId: string | null | undefined): number {
  if (!rememberedBotId) return XIANGQI_FIRST_GAME_LEVEL;
  return fairyStockfishLevel(rememberedBotId) ?? XIANGQI_RETURNING_LEVEL;
}

export function landingBotRotationBucket(now: Date = new Date()): number {
  return Math.floor(now.getTime() / ROTATION_BUCKET_MS);
}

// Xiangqi and Fog Chess anchor every lineup. Four other slots rotate in paired
// families; any two consecutive buckets cover all eight live variants.
export function landingBotLineup(bucket: number): readonly LandingBotGameSpecId[] {
  const rotating = ROTATING_LINEUPS[positiveModulo(bucket, ROTATING_LINEUPS.length)]!;
  return [XIANGQI_SPEC_ID, DARK_CHESS_SPEC_ID, ...rotating];
}

// Which variants appear still rotates by bucket; WHICH OPPONENT a variant
// offers does not.
export function landingBotOffer(
  gameSpecId: string,
  context: LandingBotOfferContext = {},
): LandingBotOffer | null {
  if (!isLandingBotGameSpecId(gameSpecId)) return null;
  if (gameSpecId === XIANGQI_SPEC_ID) {
    return fsfOffer(gameSpecId, xiangqiPrimaryLevel(context.rememberedXiangqiBotId));
  }
  if (gameSpecId === FORTRESS_XIANGQI_SPEC_ID) return fsfOffer(gameSpecId, FORTRESS_XIANGQI_LEVEL);
  if (gameSpecId === DUCK_XIANGQI_SPEC_ID) return fsfOffer(gameSpecId, DUCK_XIANGQI_LEVEL);
  if (gameSpecId === JIEQI_SPEC_ID) {
    return {
      botId: 'pikafish',
      botName: 'Pikafish',
      gameSpecId,
      timeControlId: offerPace(gameSpecId),
    };
  }
  return { botId: 'misty', botName: 'Misty', gameSpecId, timeControlId: offerPace(gameSpecId) };
}

// The Lobby row and the Quick Pairing chip must advertise the clock the click
// will actually start, so this mirrors the picker's preselection exactly.
// Precedence, strongest first:
//   1. the engine pin — a HARD constraint: the fog engines lose on time at 3+2
//      (#283) and the create route rejects anything else;
//   2. the variant's own default — a preference, slower on the deliberate
//      variants because guests cannot finish a full-board game at 3+2;
//   3. the house pace, 3+2.
function offerPace(gameSpecId: LandingBotGameSpecId): TimeControlId {
  return engineTimeControlPin(gameSpecId)?.id ?? defaultTimePresetForSpec(gameSpecId);
}

// The Lobby carries the whole Xiangqi ladder at once, weakest rung first. Quick
// Pairing starts the level the device last chose (the bottom rung on a first
// visit), so "the computer" is always a step on this same ladder.
export function landingXiangqiBotOffers(): readonly LandingBotOffer[] {
  return XIANGQI_LADDER_LEVELS.map((level) => fsfOffer(XIANGQI_SPEC_ID, level));
}

function fsfOffer(gameSpecId: LandingBotGameSpecId, level: number): LandingBotOffer {
  return {
    botId: `fairy-stockfish-level-${level}`,
    botName: `Fairy-Stockfish Level ${level}`,
    gameSpecId,
    timeControlId: offerPace(gameSpecId),
  };
}

function isLandingBotGameSpecId(gameSpecId: string): gameSpecId is LandingBotGameSpecId {
  return (LANDING_BOT_GAME_SPEC_IDS as readonly string[]).includes(gameSpecId);
}

function positiveModulo(value: number, divisor: number): number {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}
