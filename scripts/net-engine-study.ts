// Shared offline compiler and local creator for the net-versus-classical studies.
// The committed data is the source of truth. Every command checks today's rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyBanqiMove,
  applyThreeKingdomsBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  banqiStateToDealtFen,
  createInitialBanqiState,
  createThreeKingdomsBanqiStateFromSetup,
  parseBanqiFen,
  parseThreeKingdomsBanqiFen,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';

export type NetVariant = 'banqi' | 'three-kingdoms-banqi';
type State = BanqiGameState | ThreeKingdomsBanqiState;
export type DuelGame = {
  game_id: number;
  seed: number;
  a_seat: 0 | 1;
  deal: number[];
  moves: [number, number, number | null][];
  result: -1 | 0 | 1;
  winner: 0 | 1 | null;
  reason: string;
  capped: boolean;
  plies: number;
};
export type NetStudyGame = {
  gameId: number;
  seed: number;
  netSeat: 0 | 1;
  name: string;
  chapterId: string | null;
  rootFen: string;
  moves: string[];
  result: string;
  red: string;
  black: string;
  intro: string;
  notes: Record<string, string>;
  plies: number;
  captures: number;
  flips: number;
};
export type NetStudyData = {
  name: string;
  description: string;
  variant: NetVariant;
  netVersion: string;
  nodesPerMove: number;
  studyId: string | null;
  selectedGameId: number;
  embedPly: number;
  games: NetStudyGame[];
};
const ROLES: BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];
const NET = 'MistyBanqi (net)';
const CLASSICAL = 'MistyBanqi (classical)';
const config = (variant: NetVariant) =>
  variant === 'banqi'
    ? {
        slug: 'banqi-net',
        article: 'banqi',
        title: 'Banqi',
        version: '0.3.0',
        selected: 7,
        ply: 49,
      }
    : {
        slug: 'three-kingdoms-net',
        article: 'three-kingdoms-banqi',
        title: 'Three Kingdoms Banqi',
        version: '0.2.1',
        selected: 4,
        ply: 103,
      };

function apply(variant: NetVariant, state: State, token: string): State {
  if (!/^[a-i][1-5][a-i][1-5]$/.test(token)) throw new Error(`Invalid move ${token}`);
  const move = { from: token.slice(0, 2), to: token.slice(2) };
  return variant === 'banqi'
    ? applyBanqiMove(state as BanqiGameState, move as BanqiMove)
    : applyThreeKingdomsBanqiMove(state as ThreeKingdomsBanqiState, move as ThreeKingdomsBanqiMove);
}
function result(state: State): string {
  const end = state.status;
  return end.type !== 'finished'
    ? 'unfinished'
    : end.winner === null
      ? '1/2-1/2'
      : end.winner === 'red'
        ? '1-0'
        : '0-1';
}
export function replayNetGame(variant: NetVariant, game: NetStudyGame): State[] {
  const parsed =
    variant === 'banqi' ? parseBanqiFen(game.rootFen) : parseThreeKingdomsBanqiFen(game.rootFen);
  if (!parsed.ok || parsed.sampled)
    throw new Error(`Game ${game.gameId}: missing exact dealt root`);
  let state: State = parsed.state;
  const states = [state];
  for (const [i, token] of game.moves.entries()) {
    const next = apply(variant, state, token);
    if (next === state)
      throw new Error(`Game ${game.gameId}: ply ${i + 1} ${token} refused under current rules`);
    state = next;
    states.push(state);
  }
  if (result(state) !== game.result)
    throw new Error(`Game ${game.gameId}: replay ends ${result(state)}, recorded ${game.result}`);
  if (game.plies !== game.moves.length) throw new Error(`Game ${game.gameId}: wrong ply count`);
  return states;
}

export function compileNetStudy(variant: NetVariant, records: DuelGame[]): NetStudyData {
  const c = config(variant);
  const games = records
    .map((g): NetStudyGame => {
      const width = variant === 'banqi' ? 8 : 9;
      const sq = (n: number) => `${'abcdefghi'[n % width]}${Math.floor(n / width) + 1}`;
      const deal: BanqiDeal = g.deal
        .filter((code) => code >= 0)
        .map((code) => {
          if (!Number.isInteger(code) || code > 13) throw new Error('Invalid role code');
          return { color: code < 7 ? 'red' : 'black', role: ROLES[code % 7] };
        });
      if (g.deal.length !== (variant === 'banqi' ? 32 : 45) || g.capped)
        throw new Error(`Game ${g.game_id}: invalid deal or capped game`);
      const start =
        variant === 'banqi'
          ? createInitialBanqiState(`net-${g.game_id}`, deal)
          : createThreeKingdomsBanqiStateFromSetup(`net-${g.game_id}`, { deal });
      const rootFen =
        variant === 'banqi'
          ? banqiStateToDealtFen(start as BanqiGameState)
          : threeKingdomsBanqiStateToDealtFen(start as ThreeKingdomsBanqiState);
      let state: State = start;
      let flips = 0;
      const moves: string[] = [];
      for (const [i, [from, to, reveal]] of g.moves.entries()) {
        if (![from, to].every((n) => Number.isInteger(n) && n >= 0 && n < g.deal.length))
          throw new Error('Invalid square');
        if (from === to) {
          if (reveal !== g.deal[from])
            throw new Error(`Game ${g.game_id}: reveal differs from deal`);
          flips++;
        } else if (reveal !== null) throw new Error('Unexpected reveal');
        const token = sq(from) + sq(to);
        const next = apply(variant, state, token);
        if (next === state)
          throw new Error(`Game ${g.game_id}: ply ${i + 1} ${token} refused under current rules`);
        state = next;
        moves.push(token);
      }
      const expected = g.winner === null ? '1/2-1/2' : g.winner === 0 ? '1-0' : '0-1';
      const netResult = g.winner === null ? 0 : g.winner === g.a_seat ? 1 : -1;
      if (result(state) !== expected || netResult !== g.result || moves.length !== g.plies)
        throw new Error(`Game ${g.game_id}: result mismatch`);
      const ending = state.status.type === 'finished' ? state.status.reason : 'unfinished';
      const reason =
        variant === 'banqi'
          ? (
              {
                no_moves: 'stalemate',
                elimination: 'stalemate',
                clock: 'no-progress',
                repetition: 'repetition',
              } as Record<string, string>
            )[g.reason]
          : (
              { Score: 'score', NoProgress: 'no-progress', NoLegalMove: 'no-legal-move' } as Record<
                string,
                string
              >
            )[g.reason];
      if (reason !== ending)
        throw new Error(`Game ${g.game_id}: ending ${ending} differs from ${g.reason}`);
      const winner = g.result === 1 ? 'The net' : 'The classical engine';
      const endingText =
        ending === 'stalemate' || ending === 'no-legal-move'
          ? 'the opponent had no legal move'
          : ending === 'score'
            ? 'it reached 100 points'
            : ending === 'no-progress'
              ? 'the no-progress limit was reached'
              : 'the position repeated three times';
      return {
        gameId: g.game_id,
        seed: g.seed,
        netSeat: g.a_seat,
        name: `Game ${g.game_id + 1}: ${g.result === 0 ? 'draw' : g.result === 1 ? 'net wins' : 'classical wins'}`,
        chapterId: null,
        rootFen,
        moves,
        result: expected,
        red: g.a_seat === 0 ? NET : CLASSICAL,
        black: g.a_seat === 1 ? NET : CLASSICAL,
        plies: moves.length,
        captures: state.captures.length,
        flips,
        notes: {},
        intro: `MistyBanqi ${c.version} net against classical, both at 200,000 nodes a move. The first flip bound ${state.firstColor} to the first seat. ${moves.length} plies, ${flips} flips, ${state.captures.length} captures. ${g.result === 0 ? 'Drawn' : `${winner} won`}: ${endingText}.`,
      };
    })
    .sort(
      (a, b) =>
        Number(a.result === '1/2-1/2') - Number(b.result === '1/2-1/2') ||
        a.plies - b.plies ||
        a.gameId - b.gameId,
    );
  const selected = games.find((g) => g.gameId === c.selected);
  if (!selected) throw new Error('Selected game is missing');
  selected.notes =
    variant === 'banqi'
      ? {
          '32': 'The net cannon on e2 jumps one piece to take the red advisor on g2.',
          '50': 'A net soldier takes the red general on e3. The lowest rank is the one piece that can capture a general.',
          '81': 'The classical cannon takes the black general on f4. The net keeps its lead and takes the last red piece at ply 130.',
        }
      : {
          '104': 'The classical general takes the red general on d2, reaching 90 points.',
          '105': 'The net horse recaptures the general on d2, reaching 95 points against 90.',
          '107': 'The net soldier takes the soldier on b4 for the last five points: 100 to 90.',
        };
  return {
    name: `${c.title}: net against classical`,
    description: `Twenty games at 200,000 nodes a move with the ${c.version} net against classical. Each chapter opens into its own deal and replays under current Mistboard rules.`,
    variant,
    netVersion: c.version,
    nodesPerMove: 200000,
    studyId: null,
    selectedGameId: c.selected,
    embedPly: c.ply,
    games,
  };
}

export function netChapter(variant: NetVariant, game: NetStudyGame) {
  type Node = { uci?: string; annotations?: object; children: Node[] };
  const root: Node = { annotations: { comments: [{ text: game.intro }] }, children: [] };
  let cursor = root;
  game.moves.forEach((uci, i) => {
    const note = game.notes[String(i + 1)];
    const node: Node = {
      uci,
      children: [],
      ...(note ? { annotations: { comments: [{ text: note }] } } : {}),
    };
    cursor.children.push(node);
    cursor = node;
  });
  return {
    name: game.name,
    variant,
    orientation: 'red',
    root: { version: 1, rootFen: game.rootFen, root },
    tags: {
      red: game.red,
      black: game.black,
      result: game.result,
      event: 'Net against classical, 200,000 nodes a move',
    },
  };
}

export async function runNetStudy(variant: NetVariant): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  if (args.includes('--apply')) throw new Error('This script never applies study:edit plans');
  const c = config(variant);
  const path = resolve(`scripts/data/${c.slug}-study.json`);
  if (flag('compile')) {
    const records = readFileSync(resolve(flag('compile')!), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as DuelGame);
    const data = compileNetStudy(variant, records);
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Compiled ${data.games.length} legally replayed chapters to ${path}`);
    return;
  }
  const data = JSON.parse(readFileSync(path, 'utf8')) as NetStudyData;
  for (const game of data.games) {
    replayNetGame(variant, game);
    console.log(`${game.name}: ${game.plies} plies, ${game.result}`);
  }
  if (flag('plan')) {
    const [first, ...rest] = data.games.map((g) => netChapter(variant, g));
    const { root, ...chapter } = first;
    writeFileSync(
      resolve(flag('plan')!),
      `${JSON.stringify({ create: { owner: 'mistboard', name: data.name, description: data.description, visibility: args.includes('--public') ? 'public' : 'unlisted', chapter: { ...chapter, tree: root } }, ops: rest.map(({ root, variant: _variant, ...ch }) => ({ op: 'add', ...ch, tree: root })) }, null, 2)}\n`,
    );
    return;
  }
  const base = flag('base') ?? 'https://mistboard.com';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
  let cookie = '';
  async function send(method: string, route: string, body?: unknown) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}`);
    return { json: await response.json(), headers: response.headers };
  }
  async function fill(id: string) {
    if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new Error('Invalid study id');
    const { json: study } = await send('GET', `/api/studies/${encodeURIComponent(id)}`);
    const ids = new Map<string, string>(
      study.chapters.map((ch: { name: string; id: string }) => [ch.name, ch.id]),
    );
    if (data.games.some((g) => !/^[A-Za-z0-9]{8}$/.test(ids.get(g.name) ?? '')))
      throw new Error('Study is missing expected chapters');
    console.log(`${base}/study/${id}`);
    if (local) return; // Local ids never replace the article's production placeholders.
    data.studyId = id;
    data.games.forEach((g) => {
      g.chapterId = ids.get(g.name)!;
    });
    const selected = data.games.find((g) => g.gameId === data.selectedGameId)!;
    const articlePath = resolve(`apps/web/src/articles/content/${c.article}.ts`);
    const original = readFileSync(articlePath, 'utf8');
    const previousId = /const NET_STUDY_ID = '([^']+)';/.exec(original)?.[1];
    const article = original
      .replace(/const NET_STUDY_ID = '[^']+';/, `const NET_STUDY_ID = '${id}';`)
      .replace(
        /const NET_CHAPTER_ID = '[^']+';/,
        `const NET_CHAPTER_ID = '${selected.chapterId}';`,
      );
    writeFileSync(articlePath, article);
    // The zh dictionaries key translated prose by its resolved text, so a study
    // link in a translated paragraph carries the old id in both key and value.
    if (previousId && previousId !== id) {
      const i18nPath = resolve('apps/web/src/article-i18n.ts');
      const i18n = readFileSync(i18nPath, 'utf8');
      writeFileSync(i18nPath, i18n.replaceAll(`/study/${previousId})`, `/study/${id})`));
    }
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  if (flag('fill')) {
    await fill(flag('fill')!);
    return;
  }
  if (!args.includes('--create')) {
    console.log(
      'Dry run. Use --plan <file>, --fill <id>, or --create --base http://localhost:<port> --dev-login <email>.',
    );
    return;
  }
  if (!local || !flag('dev-login'))
    throw new Error('--create requires a local base and --dev-login');
  const { json: login } = await send('POST', '/api/auth/email/start', { email: flag('dev-login') });
  if (!login.devCode) throw new Error('Dev login unavailable');
  const confirmed = await send('POST', '/api/auth/email/confirm', {
    loginId: login.loginId,
    code: login.devCode,
  });
  cookie = confirmed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Dev login returned no session');
  const [first, ...rest] = data.games;
  const { json: created } = await send('POST', '/api/studies', {
    name: data.name,
    description: data.description,
    visibility: 'unlisted',
    chapter: netChapter(variant, first),
  });
  const id: string = created.study?.id ?? created.id;
  for (const game of rest)
    await send('POST', `/api/studies/${id}/chapters`, netChapter(variant, game));
  await fill(id);
}
