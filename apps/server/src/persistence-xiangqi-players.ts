// Player pages, derived: a player is a name the broadcast archive has seen in
// an A-level event, and a page exists because games exist
// (docs-private/players/players-surface-spec.md). No registry to maintain.
//
// Identity is the source's own spelling of the name (`red->>'name'`), the
// same key broadcast standings use: `nameEn` is a cached romanisation and two
// boards can carry it differently. The federation is NOT part of the key:
// dpxq writes the province in a cup (浙江 尹昇) and the club in the league
// (浙江民泰银行象棋队 尹昇), and keying on it split every league player in two
// on the first live read (2026-09-21). Two people with one name is the rarer
// case and is what `XIANGQI_PLAYER_ALIASES` below is for: it maps
// `name|federation` to a distinct key when the data has to be split by hand.
//
// Only finished boards count (`result <> '*'`): a live board is a game in
// progress, and a scheduled one is not a game.
import type { XiangqiBroadcastResult } from '@mistboard/game';
import { CXA_LISTED_PLAYERS, type CxaListedPlayer } from './cxa-listed-players.js';
import { getPool } from './persistence-db.js';
import { xiangqiBroadcastTourLevel } from './xiangqi-broadcast-levels.js';
import {
  romanizeXiangqiPlayerName,
  translateXiangqiRoundLabel,
} from './xiangqi-broadcast-translate.js';

export type XiangqiPlayerEventRecord = {
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  level: 'A' | 'B' | 'C' | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** First and last round start in this event, ISO dates, when the rounds carry one. */
  firstPlayedOn: string | null;
  lastPlayedOn: string | null;
};

export type XiangqiPlayerRecord = {
  /** URL slug, from the romanised name; a collision takes the federation. */
  slug: string;
  name: string;
  nameEn: string | null;
  federation: string | null;
  federationEn: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Events, most recent first. */
  events: XiangqiPlayerEventRecord[];
  firstPlayedOn: string | null;
  lastPlayedOn: string | null;
  /** On a CXA list with no game in the archive: the page is the list's facts
   *  and an empty games state. Absent on every player with games. */
  cxaOnly?: true;
};

export type XiangqiPlayerBoardRecord = {
  boardId: string;
  tourSlug: string;
  tourName: string;
  tourNameEn: string | null;
  roundId: string;
  roundName: string;
  /** Translated when the page reads it, not from the round row's cached
   *  nameEn, so a glossary change shows without a re-import. */
  roundNameEn?: string | null;
  playedOn: string | null;
  colour: 'red' | 'black';
  opponent: { name: string; nameEn: string | null; slug: string | null };
  result: XiangqiBroadcastResult;
  /** From this player's seat: 'win' | 'draw' | 'loss'. */
  outcome: 'win' | 'draw' | 'loss';
  plyCount: number;
  sourceUrl: string | null;
  /** The opening as the source classifies it, ECCO code first ("C70 五七炮对屏风马"),
   *  or null when the source names none. */
  opening: string | null;
};

/**
 * Hand-kept splits and merges the data cannot make. A value that differs from
 * the name splits: `'张伟|广东': '张伟 (广东)'` makes the Guangdong 张伟 a second
 * player. A value equal to another name merges a variant spelling into it.
 * Empty until a case turns up; the field exists so the first case has a home.
 */
export const XIANGQI_PLAYER_ALIASES: Readonly<Record<string, string>> = {};

type SideRow = {
  name: string;
  name_en: string | null;
  federation: string | null;
  federation_en: string | null;
  tour_slug: string;
  tour_name: string;
  tour_name_en: string | null;
  games: string;
  wins: string;
  draws: string;
  losses: string;
  first_played: Date | null;
  last_played: Date | null;
};

// Both seats of every finished board as one row each, with the outcome from
// that seat. `sides` is the only place the red/black asymmetry lives.
const SIDES_CTE = `
  WITH sides AS (
    SELECT boards.id AS board_id, boards.tour_slug, boards.round_id, boards.result,
           boards.ply_count, boards.source_url,
           boards.payload->'details'->>'opening' AS opening,
           boards.red AS me, boards.black AS them, 'red' AS colour,
           CASE boards.result WHEN '1-0' THEN 'win' WHEN '0-1' THEN 'loss' ELSE 'draw' END AS outcome
    FROM xiangqi_broadcast_boards boards
    WHERE boards.result <> '*'
    UNION ALL
    SELECT boards.id, boards.tour_slug, boards.round_id, boards.result,
           boards.ply_count, boards.source_url,
           boards.payload->'details'->>'opening',
           boards.black, boards.red, 'black',
           CASE boards.result WHEN '0-1' THEN 'win' WHEN '1-0' THEN 'loss' ELSE 'draw' END
    FROM xiangqi_broadcast_boards boards
    WHERE boards.result <> '*'
  )`;

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function playerKey(name: string, federation: string | null): string {
  return XIANGQI_PLAYER_ALIASES[`${name}|${federation ?? ''}`] ?? name;
}

/** `Yin Sheng` -> `yin-sheng`; a name with no romanisation falls back to the
 *  source spelling, which URL-encodes but reads as itself. */
export function playerSlugBase(nameEn: string | null, name: string): string {
  const base = (nameEn ?? name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'player';
}

/**
 * Every player with at least one finished game in an A-level event, with
 * their record over ALL events (the gate is on who gets a page, not on which
 * games count once they have one), then every CXA-listed player the gate left
 * out (#458). Sorted by games desc, then name.
 */
export async function listXiangqiPlayers(): Promise<XiangqiPlayerRecord[]> {
  const { rows } = await getPool().query<SideRow>(
    `${SIDES_CTE}
     SELECT sides.me->>'name' AS name,
            MAX(sides.me->>'nameEn') AS name_en,
            sides.me->>'federation' AS federation,
            MAX(sides.me->>'federationEn') AS federation_en,
            sides.tour_slug,
            tours.name AS tour_name,
            tours.payload->>'nameEn' AS tour_name_en,
            COUNT(*)::text AS games,
            COUNT(*) FILTER (WHERE sides.outcome = 'win')::text AS wins,
            COUNT(*) FILTER (WHERE sides.outcome = 'draw')::text AS draws,
            COUNT(*) FILTER (WHERE sides.outcome = 'loss')::text AS losses,
            MIN(rounds.starts_at) AS first_played,
            MAX(rounds.starts_at) AS last_played
     FROM sides
     JOIN xiangqi_broadcast_tours tours ON tours.slug = sides.tour_slug
     JOIN xiangqi_broadcast_rounds rounds ON rounds.id = sides.round_id
     WHERE sides.me->>'name' IS NOT NULL
     GROUP BY sides.me->>'name', sides.me->>'federation', sides.tour_slug, tours.name, tours.payload->>'nameEn'`,
  );
  return foldPlayers(rows, CXA_LISTED_PLAYERS);
}

/** `listed`: the players on the CXA lists the site carries, who get a page
 *  whether or not the archive gates them in. */
export function foldPlayers(
  rows: readonly SideRow[],
  listed: readonly CxaListedPlayer[] = [],
): XiangqiPlayerRecord[] {
  const byKey = new Map<string, XiangqiPlayerRecord>();
  const latestFederation = new Map<
    XiangqiPlayerRecord,
    { on: string; federation: string | null; federationEn: string | null }
  >();
  for (const row of rows) {
    const key = playerKey(row.name, row.federation);
    let player = byKey.get(key);
    if (!player) {
      player = {
        slug: '',
        name: row.name,
        nameEn: row.name_en,
        federation: row.federation,
        federationEn: row.federation_en,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        events: [],
        firstPlayedOn: null,
        lastPlayedOn: null,
      };
      byKey.set(key, player);
    }
    const event: XiangqiPlayerEventRecord = {
      tourSlug: row.tour_slug,
      tourName: row.tour_name,
      tourNameEn: row.tour_name_en,
      level: xiangqiBroadcastTourLevel(row.tour_slug),
      games: Number(row.games),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
      firstPlayedOn: isoDate(row.first_played),
      lastPlayedOn: isoDate(row.last_played),
    };
    player.events.push(event);
    const seen = latestFederation.get(player);
    const on = event.lastPlayedOn ?? '';
    if (!seen || on > seen.on) {
      latestFederation.set(player, {
        on,
        federation: row.federation,
        federationEn: row.federation_en,
      });
    }
    player.games += event.games;
    player.wins += event.wins;
    player.draws += event.draws;
    player.losses += event.losses;
    if (
      event.firstPlayedOn &&
      (!player.firstPlayedOn || event.firstPlayedOn < player.firstPlayedOn)
    ) {
      player.firstPlayedOn = event.firstPlayedOn;
    }
    if (event.lastPlayedOn && (!player.lastPlayedOn || event.lastPlayedOn > player.lastPlayedOn)) {
      player.lastPlayedOn = event.lastPlayedOn;
    }
  }

  // The coverage gate: a page needs one finished game in an A-level event.
  const players = [...byKey.values()].filter((p) => p.events.some((e) => e.level === 'A'));

  // Slugs: the romanised name, and the federation when two players share it.
  const bySlug = new Map<string, XiangqiPlayerRecord[]>();
  for (const p of players) {
    const base = playerSlugBase(p.nameEn, p.name);
    bySlug.set(base, [...(bySlug.get(base) ?? []), p]);
  }
  for (const [base, group] of bySlug) {
    if (group.length === 1) {
      group[0]!.slug = base;
      continue;
    }
    for (const p of group) {
      const fed = playerSlugBase(p.federationEn, p.federation ?? '');
      p.slug = fed && fed !== 'player' ? `${base}-${fed}` : base;
    }
  }

  // CXA-listed players past the gate (#458): a page for everyone on a list the
  // site carries. One with games only below A level keeps those games; one with
  // none gets a page of the list's facts, named by the romaniser ingestion uses,
  // so the slug is the one their first game would give them. Their slugs are
  // assigned after the gated players' and never take one those hold, so
  // listing them cannot move an existing page; a collision takes the list's
  // group, then a number.
  const taken = new Set(players.map((p) => p.slug));
  const gatedNames = new Set(players.map((p) => p.name));
  const ungated = new Map<string, XiangqiPlayerRecord>();
  for (const p of byKey.values()) {
    if (!gatedNames.has(p.name) && !ungated.has(p.name)) ungated.set(p.name, p);
  }
  const lateEntries = [...listed]
    .filter((entry) => !gatedNames.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of lateEntries) {
    if (players.some((p) => p.name === entry.name)) continue;
    const p: XiangqiPlayerRecord = ungated.get(entry.name) ?? {
      slug: '',
      name: entry.name,
      nameEn: romanizeXiangqiPlayerName(entry.name) ?? null,
      federation: null,
      federationEn: null,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      events: [],
      firstPlayedOn: null,
      lastPlayedOn: null,
      cxaOnly: true,
    };
    const base = playerSlugBase(p.nameEn, p.name);
    let slug = taken.has(base) ? `${base}-${entry.group}` : base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    p.slug = slug;
    players.push(p);
  }

  for (const p of players) {
    p.events.sort((a, b) => (b.lastPlayedOn ?? '').localeCompare(a.lastPlayedOn ?? ''));
    // The federation shown is the most recent event's: a cup writes the
    // province, the league the club, and the club is the more specific.
    const latest = latestFederation.get(p);
    if (latest) {
      p.federation = latest.federation;
      p.federationEn = latest.federationEn;
    }
  }
  players.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, 'zh'));
  return players;
}

export async function getXiangqiPlayer(slug: string): Promise<XiangqiPlayerRecord | null> {
  const players = await listXiangqiPlayers();
  return players.find((p) => p.slug === slug) ?? null;
}

/** Every finished board this player sat at, newest first. */
export async function listXiangqiPlayerBoards(
  player: Pick<XiangqiPlayerRecord, 'name'>,
  slugOf: (name: string, federation: string | null) => string | null,
): Promise<XiangqiPlayerBoardRecord[]> {
  const { rows } = await getPool().query<{
    board_id: string;
    tour_slug: string;
    tour_name: string;
    tour_name_en: string | null;
    round_id: string;
    round_name: string;
    starts_at: Date | null;
    colour: 'red' | 'black';
    them: { name?: string; nameEn?: string; federation?: string };
    result: XiangqiBroadcastResult;
    outcome: 'win' | 'draw' | 'loss';
    ply_count: number;
    source_url: string | null;
    opening: string | null;
  }>(
    `${SIDES_CTE}
     SELECT sides.board_id, sides.tour_slug, tours.name AS tour_name,
            tours.payload->>'nameEn' AS tour_name_en,
            sides.round_id, rounds.name AS round_name, rounds.starts_at,
            sides.colour, sides.them, sides.result, sides.outcome,
            sides.ply_count, sides.source_url, sides.opening
     FROM sides
     JOIN xiangqi_broadcast_tours tours ON tours.slug = sides.tour_slug
     JOIN xiangqi_broadcast_rounds rounds ON rounds.id = sides.round_id
     WHERE sides.me->>'name' = $1
     ORDER BY rounds.starts_at DESC NULLS LAST, sides.board_id DESC`,
    [player.name],
  );
  return rows.map((row) => ({
    boardId: row.board_id,
    tourSlug: row.tour_slug,
    tourName: row.tour_name,
    tourNameEn: row.tour_name_en,
    roundId: row.round_id,
    roundName: row.round_name,
    roundNameEn: translateXiangqiRoundLabel(row.round_name) ?? null,
    playedOn: isoDate(row.starts_at),
    colour: row.colour,
    opponent: {
      name: row.them.name ?? '',
      nameEn: row.them.nameEn ?? null,
      slug: slugOf(row.them.name ?? '', row.them.federation ?? null),
    },
    result: row.result,
    outcome: row.outcome,
    plyCount: row.ply_count,
    sourceUrl: row.source_url,
    opening: row.opening?.trim() || null,
  }));
}
