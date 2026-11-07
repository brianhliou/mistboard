// The parts of dpxq-archive-harvest.mjs that read input and touch no network or
// build output: argument parsing and the three row sources (search rows, a
// tour's game list, --ids). Split out so they can be tested without dpxq or a
// built apps/server (scripts/dpxq-harvest-args.test.mjs).

export const DEFAULT_LIBRARY = '大师对局'; // the master-games library

export function parseArgs(argv) {
  const args = {
    red: '',
    black: '',
    player: '',
    event: '',
    date: '',
    library: DEFAULT_LIBRARY,
    pages: 1,
    out: null,
    json: false,
    limit: 0,
    tour: '',
    ids: [],
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--red':
        args.red = value ?? '';
        i += 1;
        break;
      case '--black':
        args.black = value ?? '';
        i += 1;
        break;
      case '--player':
        args.player = value ?? '';
        i += 1;
        break;
      case '--event':
        args.event = value ?? '';
        i += 1;
        break;
      case '--date':
        args.date = value ?? '';
        i += 1;
        break;
      case '--library':
        args.library = value ?? DEFAULT_LIBRARY;
        i += 1;
        break;
      case '--pages':
        args.pages = Math.max(1, Number(value) || 1);
        i += 1;
        break;
      case '--limit':
        args.limit = Math.max(0, Number(value) || 0);
        i += 1;
        break;
      case '--out':
        args.out = value ?? null;
        i += 1;
        break;
      case '--json':
        args.json = true;
        break;
      case '--tour':
        args.tour = value ?? '';
        i += 1;
        break;
      case '--ids':
        args.ids = String(value ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        i += 1;
        break;
      default:
        if (flag.startsWith('--')) throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

/** True when the args name something narrower than the whole archive. */
export function hasTarget(args) {
  return Boolean(
    args.player ||
      args.red ||
      args.black ||
      args.event ||
      args.date ||
      args.tour ||
      args.ids.length,
  );
}

/** How a run finds its rows: --ids wins over --tour, which wins over search
 *  (whose --player then means both seats, as two queries). */
export function harvestMode(args) {
  if (args.ids.length) return 'ids';
  if (args.tour) return 'tour';
  return 'search';
}

const ROW_RE = /view\('owner=(\w+)&id=(\d+)#f=0'\)"\s*>([^<]+)<\/a>/g;
const LOGIN_WALL_RE = /请先登[陆录]/;

/** search.asp's answer since October 2026 when it wants a login: the wall
 *  text and no rows. */
export function isLoginWall(html) {
  return LOGIN_WALL_RE.test(html) && parseRows(html).length === 0;
}

export function parseRows(html) {
  const rows = [];
  for (const match of html.matchAll(ROW_RE)) {
    rows.push({ owner: match[1], id: match[2], title: match[3].trim() });
  }
  return rows;
}

// A tour's game list: one <tr> per game, linking view_<owner>_<id>.html. Keep
// the rows that name the player (both seats); a match row and its per-game rows
// link the same ids, so ids are de-duplicated by the caller.
export function parseTourRows(html, player) {
  const rows = [];
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cell = match[1];
    if (player && !cell.includes(player)) continue;
    const title = cell
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const link of cell.matchAll(/view_(\w+?)_(\d+)\.html/g)) {
      rows.push({ owner: link[1], id: link[2], title });
    }
  }
  return rows;
}

export function idRows(ids) {
  return ids.map((key) => {
    const match = key.match(/^(?:(\w+?)_)?(\d+)$/);
    if (!match) throw new Error(`bad id: ${key} (want m_123456)`);
    return { owner: match[1] ?? 'm', id: match[2], title: key };
  });
}
