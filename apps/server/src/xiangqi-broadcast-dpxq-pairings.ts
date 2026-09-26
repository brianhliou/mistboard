// dpxq round pages: every pairing of a round with its result, records or not.
//
// A tour's game list (movelist_<tour>.html) carries only the games whose moves
// someone uploaded. For the 2024 Asian individual championship that was 13 of
// the men's ~105 games (all China's players) and none of the women's, so a page
// built from it showed two boards a round and no standings worth the name. The
// round pages (round_<tour>.html for the latest round, round_<tour>_<n>.html
// for round n) list every table with both players, their federations and the
// result, and link the records that exist. This module reads them; the
// dpxq-tour provider merges them with the game list so every paired board
// exists, with its result, whether or not its moves are ever published.
//
// Only the individual layout (table#table_geren) is read. A team event's round
// page is laid out by match, and team events are already covered by their
// records; parsing a second layout would be a second, untested source of the
// same facts.

import {
  XIANGQI_BROADCAST_SCHEMA,
  type XiangqiBroadcastBoard,
  type XiangqiBroadcastGameKind,
  type XiangqiBroadcastResult,
} from '@mistboard/game';

const DPXQ_ORIGIN = 'http://www.dpxq.com';

/** round_<tour>.html is the latest round; round_<tour>_<n>.html is round n. */
export function roundPageUrl(tour: string, round?: number, origin = DPXQ_ORIGIN): string {
  return round === undefined
    ? `${origin}/hldcg/round_${tour}.html`
    : `${origin}/hldcg/round_${tour}_${round}.html`;
}

export type DpxqPairingSide = { name: string; federation?: string };

export type DpxqPairing = {
  roundNumber: number;
  /** 台次: the table, which is the board number on the page. */
  table: number;
  /**
   * Set only when the table played more than one game in the round (the 2024
   * final: 第1局 slow, 第2局 rapid). The page lists those games under an
   * aggregate row; the aggregate is not a game and is not returned.
   */
  game?: number;
  kind?: XiangqiBroadcastGameKind;
  /** The left player moves first (the records confirm it: 先手 on the left). */
  red: DpxqPairingSide;
  black: DpxqPairingSide;
  /** '*' until the page states a result. */
  result: XiangqiBroadcastResult;
  /** Game record ids (view_m_<id>) the row links, in page order. */
  recordIds: string[];
};

export type DpxqRoundPage = {
  /** The round this page shows (第07轮 in its title). */
  roundNumber: number;
  /** How many rounds the tour has paired so far (最新对阵(7)); falls back to
   *  this page's round. */
  roundCount: number;
  pairings: DpxqPairing[];
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/[\s　]+/g, ' ')
    .trim();
}

type Cell = { html: string; text: string };

/** A row's cells with colspans expanded, so every row lines up with the
 *  header: a multi-game row writes 第1局 across two columns, and without the
 *  expansion its players sit one column left of the header's 姓名. */
function rowCells(rowHtml: string): Cell[] {
  const cells: Cell[] = [];
  for (const match of rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const span = Number((match[1] ?? '').match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1);
    const cell = { html: match[2] ?? '', text: cellText(match[2] ?? '') };
    for (let i = 0; i < Math.max(1, Math.min(span, 20)); i += 1) cells.push(cell);
  }
  return cells;
}

/** 2 + 0 red won, 0 - 2 black won, 1 = 1 drawn; anything else is unplayed. */
export function resultFromDpxqScore(text: string): XiangqiBroadcastResult {
  const sign = text.match(/(?:^|\s)([+=-])(?:\s|$)/)?.[1];
  if (sign === '+') return '1-0';
  if (sign === '-') return '0-1';
  if (sign === '=') return '1/2-1/2';
  return '*';
}

function kindFrom(text: string): XiangqiBroadcastGameKind | undefined {
  // 超快棋 contains 快棋, so the longer name is tested first.
  if (text.includes('超快')) return 'blitz';
  if (text.includes('快')) return 'rapid';
  if (text.includes('慢')) return 'standard';
  return undefined;
}

type Columns = {
  table: number;
  redTeam: number;
  red: number;
  result: number;
  black: number;
  blackTeam: number;
  note: number;
  records: number;
};

function headerColumns(cells: Cell[]): Columns | null {
  const find = (label: string, from = 0) =>
    cells.findIndex((c, i) => i >= from && c.text === label);
  const red = find('姓名');
  const result = find('结果', red + 1);
  const black = find('姓名', result + 1);
  if (red < 0 || result < 0 || black < 0) return null;
  const teamBefore = cells
    .slice(0, red)
    .map((c) => c.text)
    .lastIndexOf('团体');
  const teamAfter = find('团体', black + 1);
  return {
    table: find('台次'),
    redTeam: teamBefore,
    red,
    result,
    black,
    blackTeam: teamAfter,
    note: find('备注', black + 1),
    records: find('棋谱', black + 1),
  };
}

function side(cells: Cell[], nameAt: number, teamAt: number): DpxqPairingSide | null {
  const name = cells[nameAt]?.text ?? '';
  if (!name || /轮空|bye/i.test(name)) return null;
  const federation = teamAt >= 0 ? cells[teamAt]?.text : undefined;
  return { name, ...(federation ? { federation } : {}) };
}

/**
 * Read one round page. Returns null for a page with no individual pairings
 * table (a team event, or a tour that has paired nothing yet: dpxq serves
 * "第00轮" with no table then).
 */
export function parseDpxqRoundPage(html: string): DpxqRoundPage | null {
  const tableStart = html.search(/<table[^>]*id\s*=\s*["']?table_geren/i);
  if (tableStart < 0) return null;
  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd < 0 ? undefined : tableEnd);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const roundNumber = Number(title.match(/第\s*0*(\d+)\s*轮/)?.[1]);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) return null;
  const stated = Number(html.match(/最新对阵<\/a>\s*\(\s*(\d+)\s*\)/)?.[1]);
  const roundCount = Number.isInteger(stated) && stated >= roundNumber ? stated : roundNumber;

  let columns: Columns | null = null;
  const pairings: DpxqPairing[] = [];
  // The main row of the table currently being read, so the games listed
  // under an aggregate row inherit its table number and replace it.
  let lastMain: { pairing: DpxqPairing; index: number } | null = null;

  for (const row of table.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attrs = row[1] ?? '';
    const cells = rowCells(row[2] ?? '');
    if (/class\s*=\s*["']?th/i.test(attrs)) {
      columns = headerColumns(cells);
      continue;
    }
    if (!columns) continue;
    const resultCell = cells[columns.result];
    if (!resultCell || cells.length <= columns.black) continue;
    const red = side(cells, columns.red, columns.redTeam);
    const black = side(cells, columns.black, columns.blackTeam);
    const recordIds = [
      ...(cells[columns.records]?.html ?? row[2] ?? '').matchAll(/view_m_(\d+)\.html/gi),
    ].map((m) => m[1]!);
    const tableCell = cells[columns.table]?.text ?? '';
    const tableNumber = Number(tableCell);

    // A game played at a table that played more than one this round: its
    // label (第1局, 快2局) sits where the pairing number and score are.
    const label = cells.find((c) => /局/.test(c.text))?.text;
    const isSubGame = /duojun/i.test(attrs) || (!tableCell && label !== undefined);
    if (isSubGame) {
      if (!lastMain || !red || !black) continue;
      // The aggregate row is not a game: drop it once its first game shows up.
      if (pairings[lastMain.index] === lastMain.pairing) pairings.splice(lastMain.index, 1);
      const game = Number(label?.match(/(\d+)\s*局/)?.[1]);
      const kindText = cells
        .slice(columns.blackTeam + 1)
        .map((c) => c.text)
        .join(' ');
      const kind = kindFrom(kindText) ?? (label?.startsWith('快') ? 'rapid' : undefined);
      pairings.push({
        roundNumber,
        table: lastMain.pairing.table,
        ...(Number.isInteger(game) && game > 0 ? { game } : {}),
        ...(kind ? { kind } : {}),
        red,
        black,
        result: resultFromDpxqScore(resultCell.text),
        recordIds: [...new Set(recordIds)],
      });
      continue;
    }

    if (!Number.isInteger(tableNumber) || tableNumber < 1) continue;
    if (!red || !black) {
      lastMain = null;
      continue;
    }
    const pairing: DpxqPairing = {
      roundNumber,
      table: tableNumber,
      red,
      black,
      result: resultFromDpxqScore(resultCell.text),
      recordIds: [...new Set(recordIds)],
    };
    pairings.push(pairing);
    lastMain = { pairing, index: pairings.length - 1 };
  }

  return { roundNumber, roundCount, pairings };
}

/** `r07t01`, `r07t01g2`: unique within a tour, which the store requires of a
 *  source board id, and stable across polls because the page's round and
 *  table are. */
export function pairingSourceBoardId(pairing: {
  roundNumber: number;
  table: number;
  game?: number;
}): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `r${pad(pairing.roundNumber)}t${pad(pairing.table)}${pairing.game ? `g${pairing.game}` : ''}`;
}

/** A pairing board with no moves: the result, or `scheduled` until there is one. */
export function dpxqPairingBoard(input: {
  tourSlug: string;
  roundId: string;
  pairing: DpxqPairing;
  sourceUrl: string;
}): XiangqiBroadcastBoard {
  const { pairing } = input;
  const sourceBoardId = pairingSourceBoardId(pairing);
  return {
    schema: XIANGQI_BROADCAST_SCHEMA,
    id: `${input.tourSlug}-${input.roundId}-${sourceBoardId}`,
    tourSlug: input.tourSlug,
    roundId: input.roundId,
    sourceBoardId,
    boardNumber: pairing.table,
    red: { ...pairing.red },
    black: { ...pairing.black },
    status: pairing.result === '*' ? 'scheduled' : 'complete',
    result: pairing.result,
    moves: [],
    sourceUrl: input.sourceUrl,
    details: {
      table: pairing.table,
      ...(pairing.game ? { game: pairing.game } : {}),
      ...(pairing.kind ? { kind: pairing.kind } : {}),
    },
  };
}
