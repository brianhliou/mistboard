// PGN for a broadcast game, for the creators who cover professional games in
// English (issue #454): a file their own tools open, with English names in the
// tags a xiangqi PGN reader expects (Red, Black, RedTeam, BlackTeam). Built in
// the browser from the moves the page already has; no new route.
//
// Movetext is WXF when the whole line replays under standard rules (WXF is
// relative to the position, so every label needs a sound replay), else ICCS
// coordinates, the same honesty rule as the server's exporters
// (apps/server/src/xiangqi-game-export.ts).

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  isStandardXiangqiLegalMove,
  writeXiangqiPgn,
  type XiangqiBroadcastPlayerTag,
  type XiangqiBroadcastResult,
  type XiangqiMove,
  type XiangqiPgnNode,
} from '@mistboard/game';

export type BroadcastPgnInput = {
  boardId: string;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
  moves: readonly XiangqiMove[];
  tour?: { name: string; nameEn?: string; location?: string } | null;
  round?: { name: string; nameEn?: string; startsAt?: string } | null;
  /** Page origin for the Source tag; mistboard.com when unset. */
  origin?: string;
};

function english(entity: { name: string; nameEn?: string }): string {
  return entity.nameEn?.trim() || entity.name;
}

function team(player: XiangqiBroadcastPlayerTag): string | undefined {
  return player.federationEn?.trim() || player.federation?.trim() || undefined;
}

function lineReplays(moves: readonly XiangqiMove[]): boolean {
  let state = createInitialXiangqiState('broadcast-pgn');
  for (const move of moves) {
    if (state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move)) return false;
    state = applyStandardXiangqiMove(state, move);
  }
  return true;
}

/** The PGN date, YYYY.MM.DD, of the day the event states (its own offset). */
function pgnDate(iso: string | undefined): string | undefined {
  const day = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return day ? `${day[1]}.${day[2]}.${day[3]}` : undefined;
}

export function broadcastGamePgn(input: BroadcastPgnInput): string {
  const tags: Record<string, string> = {};
  if (input.tour) tags.Event = english(input.tour);
  if (input.tour?.location) tags.Site = input.tour.location;
  const date = pgnDate(input.round?.startsAt);
  if (date) tags.Date = date;
  if (input.round) tags.Round = english(input.round);
  tags.Red = english(input.red);
  tags.Black = english(input.black);
  const redTeam = team(input.red);
  const blackTeam = team(input.black);
  if (redTeam) tags.RedTeam = redTeam;
  if (blackTeam) tags.BlackTeam = blackTeam;
  // The Chinese originals, for readers who search the source in Chinese.
  if (input.red.nameEn && input.red.nameEn !== input.red.name) tags.RedZh = input.red.name;
  if (input.black.nameEn && input.black.nameEn !== input.black.name) {
    tags.BlackZh = input.black.name;
  }
  tags.Source = `${input.origin ?? 'https://mistboard.com'}/broadcast/xiangqi/board/${encodeURIComponent(input.boardId)}`;

  const children: XiangqiPgnNode[] = [];
  let tail = children;
  for (const move of input.moves) {
    const node: XiangqiPgnNode = { move, token: `${move.from}-${move.to}`, nags: [], children: [] };
    tail.push(node);
    tail = node.children;
  }
  return writeXiangqiPgn(
    { tags, result: input.result, children },
    { style: lineReplays(input.moves) ? 'wxf' : 'iccs' },
  );
}

/** A file name a creator can keep: "Red vs Black.pgn", safe on every OS. */
export function broadcastPgnFileName(input: Pick<BroadcastPgnInput, 'red' | 'black'>): string {
  const name = `${english(input.red)} vs ${english(input.black)}`
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim();
  return `${name || 'game'}.pgn`;
}

/** A download href for the PGN text: a data URI, since one game is small. */
export function pgnDataHref(pgn: string): string {
  return `data:application/x-chess-pgn;charset=utf-8,${encodeURIComponent(pgn)}`;
}
