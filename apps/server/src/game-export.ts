import { algebraicMoveLabels, type Color, type GameEvent, type Move } from '@mistboard/game';
import {
  DEFAULT_SITE_HOST,
  escapePgnHeader,
  LICENSE,
  normalizeJsonResult,
  type PublicationTimeControl,
  pgnDate,
  pgnEventName,
  pgnResult,
  pgnStandardTermination,
  SCHEMA_VERSION,
  SITE_NAME,
  timeControlFromSummary,
} from './game-export-shared.js';
import type { GameParticipant, RecentEveGameRecord } from './persistence.js';

// Chess-family (Fog Chess) exporters: SAN via the chess move labeler, players
// keyed white/black, reviewed at the legacy /game/:id. Variant tenants export
// through game-export-tenant.ts; the vocabulary both share lives in
// game-export-shared.ts and is re-exported here for existing importers.
export { DEFAULT_SITE_HOST, LICENSE, SCHEMA_VERSION, SITE_NAME } from './game-export-shared.js';

export type PublicationPly = {
  ply: number;
  mover: Color;
  uci: string;
  san: string;
  white_clock_ms_after: number | null;
  black_clock_ms_after: number | null;
};

export type GamePublication = {
  schema_version: string;
  game_id: string;
  source: {
    name: string;
    url: string;
    game_url: string;
  };
  variant: string;
  mode: string;
  time_control: PublicationTimeControl;
  players: {
    white: { handle: string | null };
    black: { handle: string | null };
  };
  started_at: string;
  ended_at: string;
  result: string;
  termination: string;
  ply_count: number;
  license: string;
  plies: PublicationPly[];
};

function participantByColor(
  summary: RecentEveGameRecord,
  color: Color,
): GameParticipant | undefined {
  return summary.participants.find((p) => p.color === color);
}

// games.white_name / games.black_name are written as null at room creation and
// never backfilled for live games; the actual display name lives in
// game_participants.display_name. Prefer that, then fall back.
function displayNameForColor(summary: RecentEveGameRecord, color: Color): string | null {
  const participantName = participantByColor(summary, color)?.displayName ?? null;
  if (participantName) return participantName;
  return color === 'white' ? summary.whiteName : summary.blackName;
}

function moveToUci(move: Move): string {
  const promo = move.promotion
    ? ({ queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[move.promotion] ?? '')
    : '';
  return `${move.from}${move.to}${promo}`;
}

function plyListFromEvents(events: GameEvent[], roomId: string): PublicationPly[] {
  const labels = algebraicMoveLabels(events, roomId);
  const plies: PublicationPly[] = [];
  let plyIndex = 0;
  for (const [index, event] of events.entries()) {
    if (event.type !== 'move-played') continue;
    plyIndex += 1;
    plies.push({
      ply: plyIndex,
      mover: event.color,
      uci: moveToUci(event.move),
      san: labels.get(index + 1) ?? '',
      white_clock_ms_after: event.clock?.remainingMs.white ?? null,
      black_clock_ms_after: event.clock?.remainingMs.black ?? null,
    });
  }
  return plies;
}

export function buildGamePublicationJson(
  summary: RecentEveGameRecord,
  events: GameEvent[],
): GamePublication {
  return {
    schema_version: SCHEMA_VERSION,
    game_id: summary.roomId,
    source: {
      name: SITE_NAME,
      url: DEFAULT_SITE_HOST,
      game_url: `${DEFAULT_SITE_HOST}/game/${summary.roomId}`,
    },
    variant: summary.variant,
    mode: summary.mode,
    time_control: timeControlFromSummary(summary),
    players: {
      white: { handle: displayNameForColor(summary, 'white') },
      black: { handle: displayNameForColor(summary, 'black') },
    },
    started_at: summary.startedAt.toISOString(),
    ended_at: summary.endedAt.toISOString(),
    result: normalizeJsonResult(summary.result),
    termination: summary.termination,
    ply_count: summary.plyCount,
    license: LICENSE,
    plies: plyListFromEvents(events, summary.roomId),
  };
}

function pgnVariantName(variant: string): string {
  if (variant === 'dark-chess') return 'Fog Chess';
  return variant;
}

function buildPgnHeaders(summary: RecentEveGameRecord, siteOrigin: string): string[] {
  const tc = timeControlFromSummary(summary);
  const termination = summary.termination ?? '';
  const headers: Array<[string, string]> = [
    ['Event', pgnEventName(summary.mode)],
    ['Site', `${siteOrigin}/game/${summary.roomId}`],
    ['Date', pgnDate(summary)],
    ['Round', '-'],
    ['White', displayNameForColor(summary, 'white') ?? '?'],
    ['Black', displayNameForColor(summary, 'black') ?? '?'],
    ['Result', pgnResult(summary.result)],
    ['Variant', pgnVariantName(summary.variant)],
    ['MistboardVariant', summary.variant],
    ['TimeControl', tc.label],
    ['Termination', pgnStandardTermination(termination)],
    ['MistboardTermination', termination],
    ['License', LICENSE],
    ['MistboardSchema', SCHEMA_VERSION],
  ];
  return headers.map(([k, v]) => `[${k} "${escapePgnHeader(String(v))}"]`);
}

export function buildGamePgn(
  summary: RecentEveGameRecord,
  events: GameEvent[],
  siteOrigin: string = DEFAULT_SITE_HOST,
): string {
  const labels = algebraicMoveLabels(events, summary.roomId);
  const tokens: string[] = [];
  let ply = 0;
  for (const [index, event] of events.entries()) {
    if (event.type !== 'move-played') continue;
    ply += 1;
    const san = labels.get(index + 1) ?? '';
    if (ply % 2 === 1) {
      tokens.push(`${Math.ceil(ply / 2)}. ${san}`);
    } else {
      tokens.push(san);
    }
  }
  const headers = buildPgnHeaders(summary, siteOrigin);
  const result = pgnResult(summary.result);
  const moveText = tokens.length > 0 ? `${tokens.join(' ')} ${result}` : result;
  return `${headers.join('\n')}\n\n${moveText}\n`;
}
