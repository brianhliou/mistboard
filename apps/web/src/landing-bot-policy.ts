import {
  ATOMIC_XIANGQI_SPEC_ID,
  BANQI_SPEC_ID,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  defaultEngineTimeControl,
  FORTRESS_XIANGQI_SPEC_ID,
  isAllowedEngineTimeControl,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  TIME_CONTROLS,
  type TimeControlId,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';

// One small merchandising policy shared by the Lobby rows and Quick Pairing's
// Computer chips. Room creation remains server-authoritative.

export type LandingBotGameSpecId =
  | typeof XIANGQI_SPEC_ID
  | typeof BANQI_SPEC_ID
  | typeof JIEQI_SPEC_ID
  | typeof FORTRESS_XIANGQI_SPEC_ID
  | typeof DUCK_XIANGQI_SPEC_ID
  | typeof ATOMIC_XIANGQI_SPEC_ID
  | typeof CRAZYHOUSE_XIANGQI_SPEC_ID
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
  JIEQI_SPEC_ID,
  BANQI_SPEC_ID,
  ATOMIC_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
];

// Each bucket shows these plus the two fixed heads (xiangqi, fog chess), and
// any two CONSECUTIVE buckets must cover the whole shelf, which is what stops a
// variant from disappearing for a whole day.
//
// Five wide (seven tiles with the two heads). Crazyhouse made the rotating
// pool nine, and nine splits into two five-lineups that share one variant and
// together cover everything, so the cycle is two long: every pair of
// consecutive buckets is the whole shelf, and each variant is on the panel at
// least every other bucket. The shared one is jieqi, the most-played rotating
// variant (2026-09-17 read: 59% of counted human games). Three lineups of five
// cannot do better for nine without repeating one in all three, and a wider
// panel is a layout change.
const ROTATING_LINEUPS: readonly (readonly LandingBotGameSpecId[])[] = [
  [
    JIEQI_SPEC_ID,
    FORTRESS_XIANGQI_SPEC_ID,
    DUCK_XIANGQI_SPEC_ID,
    ATOMIC_XIANGQI_SPEC_ID,
    CRAZYHOUSE_XIANGQI_SPEC_ID,
  ],
  [BANQI_SPEC_ID, JIEQI_SPEC_ID, DARK_XIANGQI_SPEC_ID, JUNGLE_SPEC_ID, JUNGLE_FLIP_SPEC_ID],
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
const ATOMIC_XIANGQI_LEVEL = 4;
const CRAZYHOUSE_XIANGQI_LEVEL = 4;
// The jieqi ladder's middle rung (Pikafish Level 1..7, level 8 is Pikafish itself),
// the level every jieqi offer names and /bots marks "Start here".
export const JIEQI_FIRST_GAME_LEVEL = 4;
const JIEQI_LEVEL = JIEQI_FIRST_GAME_LEVEL;
const LADDER_BOT_ID_PREFIX = 'fairy-stockfish-level-';

// The Lobby rows rotate their rung and clock by bucket; Quick Pairing's chip
// does not (landingBotOffer), because the chip shows neither a name nor, for
// xiangqi, a level, so a rotating chip would move a player without telling them
// (#365). A row says both, so it can vary.
//
// Rungs stay within one step of the calibrated tier. Every rated ladder puts
// Level 4 at random+400 (fortress, duck, atomic 2026-09-15), so a bucket that
// showed Level 7 would be a worse first game than a stable Level 4; the band
// is variety for a returning player, not a re-tuning. The cycle is three so it
// never locks to the two-cycle variant lineup.
const LOBBY_LEVEL_OFFSETS = [0, -1, 1] as const;

// The per-variant PvE memory holds a bot id after a one-click start (bot-play.ts)
// and an engine id after a setup-dialog pick. The dialog lists engines, so a
// remembered jieqi bot is mapped back to its engine here; otherwise it misses the
// menu and a player who last played Pikafish reopens the dialog on Level 4. Same
// for the jungle top seat: its bot is 'katago', its engine 'katago-jungle'.
export function pveEngineIdForRememberedPick(gameSpecId: string, id: string): string {
  if (gameSpecId === JUNGLE_SPEC_ID) return id === 'katago' ? 'katago-jungle' : id;
  if (gameSpecId !== JIEQI_SPEC_ID) return id;
  if (id === 'pikafish') return 'pikafish-jieqi-strongest';
  if (id === 'ab-jchess') return 'ab-jchess-jieqi';
  const level = /^pikafish-level-(\d+)$/.exec(id)?.[1];
  return level ? `pikafish-jieqi-level-${level}` : id;
}

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

// Xiangqi and Fog Chess anchor every lineup. Five other slots rotate in paired
// families; any two consecutive buckets cover all nine rotating variants.
export function landingBotLineup(bucket: number): readonly LandingBotGameSpecId[] {
  const rotating = ROTATING_LINEUPS[positiveModulo(bucket, ROTATING_LINEUPS.length)]!;
  return [XIANGQI_SPEC_ID, DARK_CHESS_SPEC_ID, ...rotating];
}

// The canonical offer for a variant: which opponent the Quick Pairing chip
// starts. It does not rotate; the Lobby row's variation is layered on top of it
// by landingLobbyBotOffer.
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
  if (gameSpecId === ATOMIC_XIANGQI_SPEC_ID) return fsfOffer(gameSpecId, ATOMIC_XIANGQI_LEVEL);
  if (gameSpecId === CRAZYHOUSE_XIANGQI_SPEC_ID) {
    return fsfOffer(gameSpecId, CRAZYHOUSE_XIANGQI_LEVEL);
  }
  if (gameSpecId === JIEQI_SPEC_ID) {
    return {
      botId: `pikafish-level-${JIEQI_LEVEL}`,
      botName: `Pikafish Level ${JIEQI_LEVEL}`,
      gameSpecId,
      timeControlId: offerPace(gameSpecId),
    };
  }
  return { botId: 'misty', botName: 'Misty', gameSpecId, timeControlId: offerPace(gameSpecId) };
}

// The Lobby row and the Quick Pairing chip must advertise the clock the click
// will actually start, so this mirrors the picker's preselection exactly: the
// shared bot default, 10+5 in every variant (defaultEngineTimeControl). It
// clears the fog engines' increment floor (#283), and guests could not finish
// a full-board game at 3+2.
function offerPace(gameSpecId: LandingBotGameSpecId): TimeControlId {
  return defaultEngineTimeControl(gameSpecId).id;
}

export type LandingLobbyBotOfferContext = {
  bucket: number;
  /** The paces this variant's PvE picker offers, in ladder order. The row must
   *  never advertise a clock the picker (and so the create route) would not
   *  start; the caller owns that set. */
  allowedPaces: readonly TimeControlId[];
};

// The Lobby row for a variant in one bucket. Same opponent family as the
// canonical offer, with the rung and the clock rotated:
//   - a Fairy-Stockfish rung moves within LOBBY_LEVEL_OFFSETS of its tier;
//     Misty and Pikafish have no rungs and stay put;
//   - the clock walks the variant's allowed paces AT OR SLOWER THAN the bot
//     default. Never faster: the default is the pace a first game is dropped
//     into (bot games moved to 10+5 because guests flagged a third of their
//     xiangqi and jieqi games at 3+2), so a rotation below it would
//     re-introduce the flagging the default was set to stop. With 10+5 the
//     slowest rung, every row advertises 10+5 today.
// Rung and clock advance on different strides, so a variant with three of
// each shows every pairing over nine buckets instead of the same three.
export function landingLobbyBotOffer(
  gameSpecId: string,
  context: LandingLobbyBotOfferContext,
): LandingBotOffer | null {
  const base = landingBotOffer(gameSpecId);
  if (!base) return null;
  // Phase by shelf position so the rows sharing a bucket do not all sit on the
  // same offset and the same clock.
  const phase = LANDING_BOT_GAME_SPEC_IDS.indexOf(base.gameSpecId);
  const level = fairyStockfishLevel(base.botId);
  const rung =
    level === null
      ? null
      : clampLevel(
          level +
            LOBBY_LEVEL_OFFSETS[
              positiveModulo(context.bucket + phase, LOBBY_LEVEL_OFFSETS.length)
            ]!,
        );
  const paces = lobbyPaces(base.gameSpecId, context.allowedPaces);
  const paceStride = Math.floor(context.bucket / LOBBY_LEVEL_OFFSETS.length);
  const timeControlId =
    paces[positiveModulo(paceStride + phase, paces.length)] ?? base.timeControlId;
  return rung === null
    ? { ...base, timeControlId }
    : { ...fsfOffer(base.gameSpecId, rung), timeControlId };
}

function lobbyPaces(
  gameSpecId: LandingBotGameSpecId,
  allowedPaces: readonly TimeControlId[],
): readonly TimeControlId[] {
  const botDefault = offerPace(gameSpecId);
  const floor = TIME_CONTROLS.findIndex((tc) => tc.id === botDefault);
  const slowEnough = TIME_CONTROLS.filter(
    (tc, index) =>
      index >= floor && allowedPaces.includes(tc.id) && isAllowedEngineTimeControl(gameSpecId, tc),
  ).map((tc) => tc.id);
  return slowEnough.length > 0 ? slowEnough : [botDefault];
}

function clampLevel(level: number): number {
  return Math.min(8, Math.max(1, level));
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

// ── The homepage play panel's level stepper ──
// Every public bot a variant can be played against, weakest first, so the
// stepper walks the real ladder: xiangqi's Fairy-Stockfish Levels 1-8 then
// full-strength Pikafish; jieqi's Pikafish Levels 1-8 (Level 8 is the
// `pikafish` bot, the strongest Pikafish setting), then AB-JChess; the other
// Fairy-Stockfish variants Levels 1-8; jungle Misty then KataGo; the other
// house-built variants a single Misty (no stepper). Mirrors the server roster in
// apps/server/src/first-party-bots.ts; a rung the server cannot serve fails the
// room create, so landing-bot-policy.test.ts pins the ids.
export type LandingBotRung = {
  botId: string;
  /** Ladder level when the rung is a numbered level; null for a named bot. */
  level: number | null;
  /** Display name for a named rung (Pikafish, AB-JChess, Misty). */
  name: string;
  /** The engine family behind the rung, shown under the level. */
  engine: 'Fairy-Stockfish' | 'Pikafish' | 'AB-JChess' | 'KataGo' | 'Misty';
  /** The trained net it evaluates with, shown as a tag under the name. NNUE:
   *  xiangqi Fairy-Stockfish Level 8 (the official xiangqi net), xiangqi
   *  Pikafish and AB-JChess; the jieqi Pikafish levels run classical, its jieqi
   *  branch has never had weights. KataGo plays a ResNet under MCTS, which is a
   *  neural net but not an NNUE, so it gets the general tag. */
  net: 'nnue' | 'neural' | null;
  /** The engine needs a binary and net the server box may lack (KataGo), so the
   *  rung is offered only where GET /api/bots reports it playable. */
  gated?: boolean;
};

const FSF_LADDER_SPECS: readonly LandingBotGameSpecId[] = [
  XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  ATOMIC_XIANGQI_SPEC_ID,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
];
const JIEQI_LADDER_TOP_LEVEL = 7;

const NO_PLAYABLE_BOTS: ReadonlySet<string> = new Set();

// `playable` is the set of bot ids the server says it can seat for this variant
// (playableBotIdsBySpec over GET /api/bots). Only gated rungs consult it; until
// the roster arrives, or where the box lacks the engine, a gated rung is left
// off and the ladder is what every box can serve.
export function landingBotLadder(
  gameSpecId: string,
  playable: ReadonlySet<string> = NO_PLAYABLE_BOTS,
): readonly LandingBotRung[] {
  if (!isLandingBotGameSpecId(gameSpecId)) return [];
  if (FSF_LADDER_SPECS.includes(gameSpecId)) {
    const levels: LandingBotRung[] = Array.from({ length: 8 }, (_, i) => ({
      botId: `${LADDER_BOT_ID_PREFIX}${i + 1}`,
      level: i + 1,
      name: `Fairy-Stockfish Level ${i + 1}`,
      engine: 'Fairy-Stockfish',
      net: gameSpecId === XIANGQI_SPEC_ID && i + 1 === 8 ? 'nnue' : null,
    }));
    if (gameSpecId === XIANGQI_SPEC_ID) {
      levels.push({
        botId: 'pikafish',
        level: null,
        name: 'Pikafish',
        engine: 'Pikafish',
        net: 'nnue',
      });
    }
    return levels;
  }
  if (gameSpecId === JIEQI_SPEC_ID) {
    return [
      ...Array.from({ length: JIEQI_LADDER_TOP_LEVEL }, (_, i) => ({
        botId: `pikafish-level-${i + 1}`,
        level: i + 1,
        name: `Pikafish Level ${i + 1}`,
        engine: 'Pikafish' as const,
        net: null,
      })),
      // The jieqi ladder's top numbered rung is the `pikafish` bot itself
      // (pikafish-jieqi-strongest on the server), shown as Level 8.
      {
        botId: 'pikafish',
        level: JIEQI_LADDER_TOP_LEVEL + 1,
        name: 'Pikafish Level 8',
        engine: 'Pikafish',
        net: null,
      },
      { botId: 'ab-jchess', level: null, name: 'AB-JChess', engine: 'AB-JChess', net: 'nnue' },
    ];
  }
  const misty: LandingBotRung = {
    botId: 'misty',
    level: null,
    name: 'Misty',
    engine: 'Misty',
    net: null,
  };
  if (gameSpecId === JUNGLE_SPEC_ID) {
    // Misty stays the starter (the canonical offer); KataGo (#434) is the
    // stronger rung above it. Its net is a ResNet, not an NNUE (see net).
    const katago: LandingBotRung = {
      botId: 'katago',
      level: null,
      name: 'KataGo',
      engine: 'KataGo',
      net: 'neural',
      gated: true,
    };
    return [misty, katago].filter((rung) => !rung.gated || playable.has(rung.botId));
  }
  return [misty];
}

// Minimal slice of GET /api/bots: each bot's per-variant play options.
export type LandingBotRosterPlayOptions = {
  id: string;
  playOptions?: readonly { gameSpecId: string; playable: boolean }[];
};

/** Bot ids the server can seat, per variant, from the GET /api/bots roster. */
export function playableBotIdsBySpec(
  bots: readonly LandingBotRosterPlayOptions[],
): Map<string, ReadonlySet<string>> {
  const bySpec = new Map<string, Set<string>>();
  for (const bot of bots) {
    for (const option of bot.playOptions ?? []) {
      if (!option.playable) continue;
      let ids = bySpec.get(option.gameSpecId);
      if (!ids) {
        ids = new Set();
        bySpec.set(option.gameSpecId, ids);
      }
      ids.add(bot.id);
    }
  }
  return bySpec;
}

// The rung a remembered pick lands on: a bot id from a one-click start, or the
// engine id the setup dialog stored for jieqi or jungle (pveEngineIdForRememberedPick's
// inverse). Anything unrecognised returns -1 and the caller uses its default.
export function landingBotLadderIndex(
  ladder: readonly LandingBotRung[],
  remembered: string | null | undefined,
): number {
  if (!remembered) return -1;
  const direct = ladder.findIndex((rung) => rung.botId === remembered);
  if (direct >= 0) return direct;
  const jieqiLevel = /^pikafish-jieqi-level-(\d+)$/.exec(remembered)?.[1];
  const botId = jieqiLevel
    ? `pikafish-level-${jieqiLevel}`
    : remembered === 'pikafish-jieqi-strongest'
      ? 'pikafish'
      : remembered === 'ab-jchess-jieqi'
        ? 'ab-jchess'
        : remembered === 'katago-jungle'
          ? 'katago'
          : null;
  return botId ? ladder.findIndex((rung) => rung.botId === botId) : -1;
}
