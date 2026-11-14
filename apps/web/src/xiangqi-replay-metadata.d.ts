export type XiangqiReplayMetadata = {
  /** Exactly recorded source values; absence means unknown, never inferred. */
  date?: string;
  round?: string;
  timeControl?: string;
  source?: { label: 'DPXQ'; url: string };
};
export function replaySourceUrl(value: unknown): string | null;
export function normalizeReplayMetadata(value: unknown): XiangqiReplayMetadata;
export function replayMetadataFromGame(game: unknown): XiangqiReplayMetadata;
