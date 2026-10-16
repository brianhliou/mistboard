import { postThroughRestart } from './room-create-retry.js';

export type DarkXiangqiRoomTimeControl = {
  initialMs: number;
  incrementMs: number;
};

const DEFAULT_DARK_XIANGQI_TIME_CONTROL: DarkXiangqiRoomTimeControl = {
  initialMs: 180_000,
  incrementMs: 2_000,
};

export async function createDarkXiangqiPlayAgainRoom(
  options: { timeControl?: DarkXiangqiRoomTimeControl | null } = {},
): Promise<string> {
  const timeControl =
    options.timeControl === null
      ? null
      : (options.timeControl ?? DEFAULT_DARK_XIANGQI_TIME_CONTROL);
  const response = await postThroughRestart('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'pvp',
      gameSpecId: 'dark-xiangqi',
      preferredColor: 'random',
      ...(timeControl ? { timeControl } : {}),
    }),
  });
  if (!response.ok) throw new Error(`room creation failed: ${response.status}`);
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error('room creation response missing url');
  return data.url;
}

export function darkXiangqiTimeControlFromEvents(
  events: readonly unknown[],
): DarkXiangqiRoomTimeControl | null {
  const roomCreated = events.find(isDarkXiangqiRoomCreatedWithTimeControl);
  return roomCreated?.timeControl ?? null;
}

function isDarkXiangqiRoomCreatedWithTimeControl(
  value: unknown,
): value is { type: 'room-created'; timeControl: DarkXiangqiRoomTimeControl } {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as { timeControl?: unknown; type?: unknown };
  if (event.type !== 'room-created') return false;
  return isDarkXiangqiTimeControl(event.timeControl);
}

export function isDarkXiangqiTimeControl(value: unknown): value is DarkXiangqiRoomTimeControl {
  if (typeof value !== 'object' || value === null) return false;
  const timeControl = value as Partial<DarkXiangqiRoomTimeControl>;
  return (
    typeof timeControl.initialMs === 'number' &&
    Number.isInteger(timeControl.initialMs) &&
    typeof timeControl.incrementMs === 'number' &&
    Number.isInteger(timeControl.incrementMs)
  );
}
