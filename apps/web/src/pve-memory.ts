// The engine a device last started a bot game against, per variant. Written by
// every one-click bot start (Lobby row, Quick Pairing chip) and by the setup
// dialog, read by the landing bot policy so a returning player gets the level
// they last chose while a first-time visitor gets the bottom rung (#365).
//
// Shares the setup dialog's `mistboard:setup:pve` record and touches only its
// `engineIdByGameSpec` map, so the dialog's own memory (pace, colour, rated) is
// neither interpreted nor dropped here.
const PVE_PREFERENCE_STORAGE_KEY = 'mistboard:setup:pve';

type PveRecord = Record<string, unknown> & { engineIdByGameSpec?: unknown };

function readRecord(): PveRecord {
  try {
    const raw = window.localStorage.getItem(PVE_PREFERENCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PveRecord)
      : {};
  } catch {
    return {};
  }
}

function engineMap(record: PveRecord): Record<string, unknown> {
  const map = record.engineIdByGameSpec;
  return map && typeof map === 'object' && !Array.isArray(map)
    ? (map as Record<string, unknown>)
    : {};
}

export function rememberedPveEngine(gameSpecId: string): string | null {
  const id = engineMap(readRecord())[gameSpecId];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function rememberPveEngine(gameSpecId: string, engineId: string): void {
  const record = readRecord();
  const next = { ...record, engineIdByGameSpec: { ...engineMap(record), [gameSpecId]: engineId } };
  try {
    window.localStorage.setItem(PVE_PREFERENCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be disabled; the next visit simply starts on the first-game rung again.
  }
}

// The last bot game this device started, whichever path started it: the home
// panel, a one-click bot start, the setup dialog, or a finished room's play
// again. The home panel's "Play again" row reads it. It used to keep its own
// record written only by its own Play button, so a game started anywhere else
// left the row naming an older one.
const LAST_BOT_GAME_STORAGE_KEY = 'mistboard:last-bot-game';

export type LastBotGame = {
  gameSpecId: string;
  /** A bot id or an engine id; the panel resolves either to its ladder rung. */
  botId: string;
  timeControl?: { initialMs: number; incrementMs: number };
};

function isTimeControl(value: unknown): value is { initialMs: number; incrementMs: number } {
  const tc = value as { initialMs?: unknown; incrementMs?: unknown } | null;
  return (
    !!tc &&
    typeof tc === 'object' &&
    typeof tc.initialMs === 'number' &&
    typeof tc.incrementMs === 'number'
  );
}

export function lastBotGame(): LastBotGame | null {
  try {
    const raw = window.localStorage.getItem(LAST_BOT_GAME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBotGame> | null;
    if (!parsed || typeof parsed.gameSpecId !== 'string' || typeof parsed.botId !== 'string') {
      return null;
    }
    return {
      gameSpecId: parsed.gameSpecId,
      botId: parsed.botId,
      ...(isTimeControl(parsed.timeControl)
        ? {
            timeControl: {
              initialMs: parsed.timeControl.initialMs,
              incrementMs: parsed.timeControl.incrementMs,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Record a room-create body after the server took it. Anything that is not a
 *  bot game naming its variant and bot is ignored, so every create path can
 *  pass its body through without deciding first. */
export function rememberBotRoomRequest(body: Record<string, unknown>): void {
  if (body.mode !== 'pve') return;
  const gameSpecId = typeof body.gameSpecId === 'string' ? body.gameSpecId : body.variant;
  const botId = typeof body.botId === 'string' ? body.botId : body.engineId;
  if (typeof gameSpecId !== 'string' || typeof botId !== 'string' || !botId) return;
  const record: LastBotGame = {
    gameSpecId,
    botId,
    ...(isTimeControl(body.timeControl)
      ? {
          timeControl: {
            initialMs: body.timeControl.initialMs,
            incrementMs: body.timeControl.incrementMs,
          },
        }
      : {}),
  };
  try {
    window.localStorage.setItem(LAST_BOT_GAME_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage may be disabled; the home panel then shows no Play again row.
  }
}
