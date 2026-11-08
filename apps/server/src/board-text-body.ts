// Text equivalents of public boards (#959). No route or user-agent decisions
// live here: callers must use the public read and the crawler-copy wrapper.
import * as game from '@mistboard/game';
import { type BoardLocale, boardCopy } from './board-text-copy.js';
import { escapeHtml } from './crawler-html.js';
import { variantName } from './player-email.js';

export type BoardTextParams = {
  variant: string;
  players?: { red: string; black: string };
  heading?: string;
  event?: string | null;
  date?: string | null;
  result?: string | null;
  /** Stored study UCI (native, one-based ranks), not engine ICCS. */
  moves: readonly string[];
  /** Starting position. A dealt variant requires its pinned start. */
  fen?: string | null;
  locale: BoardLocale;
  /** Public authored study: its fog review explicitly offers the full board. */
  publicStudy?: boolean;
};

type Line = { labels: string[]; fen: string | null };
function replay<S, M>(
  initial: S,
  tokens: readonly string[],
  parse: (token: string) => M | null,
  apply: (state: S, move: M) => S,
  encode: (state: S) => string,
  label: (state: S, move: M, after: S) => string,
): Line {
  let state = initial;
  const labels: string[] = [];
  for (const token of tokens) {
    const move = parse(token);
    if (!move) break;
    const after = apply(state, move);
    if (after === state) break;
    labels.push(label(state, move, after));
    state = after;
  }
  return { labels, fen: encode(state) };
}

function start<S>(
  fen: string | null | undefined,
  parse: (fen: string) => { ok: true; state: S } | { ok: false },
  initial: () => S,
): S {
  if (!fen) return initial();
  const parsed = parse(fen);
  if (!parsed.ok) throw new Error('Invalid board start');
  return parsed.state;
}

/** Never serialize a supplied FEN verbatim: dealt FENs contain hidden identities. */
export function boardTextLine(params: BoardTextParams): Line {
  const { variant, moves, fen, locale } = params;
  const style: game.XiangqiNotationStyle =
    locale === 'en'
      ? 'algebraic'
      : locale === 'zh-Hant'
        ? 'chinese-traditional'
        : 'chinese-simplified';
  const coordinate = (_s: unknown, m: { from: string; to: string }) => `${m.from}-${m.to}`;
  try {
    switch (variant) {
      case 'xiangqi':
        return replay(
          start(fen, game.parseStandardXiangqiFen, () => game.createInitialXiangqiState('crawler')),
          moves,
          game.fsfUciToXiangqiSquares,
          game.applyXiangqiRecordMove,
          game.standardXiangqiFen,
          (s, m) => game.formatXiangqiMove(game.resumeAdjudicatedDraw(s), m, style),
        );
      case 'dark-xiangqi':
        if (!params.publicStudy) return { labels: [], fen: null };
        return replay(
          start(
            fen,
            (f) => game.parseStandardXiangqiFen(f, 'crawler', { allowExposedGeneral: true }),
            () => game.createInitialXiangqiState('crawler'),
          ),
          moves,
          game.fsfUciToXiangqiSquares,
          game.applyMove,
          game.standardXiangqiFen,
          coordinate,
        );
      case 'dark-chess':
        if (!params.publicStudy) return { labels: [], fen: null };
        return replay(
          start(fen, game.parseDarkChessFen, () =>
            game.darkChessVariant.createInitialState('crawler'),
          ),
          moves,
          chessMove,
          (s, m) => game.darkChessVariant.applyMove(s, m),
          game.darkChessFen,
          (s, m) => game.moveToAlgebraic(s, m),
        );
      case 'jungle':
        return replay(
          start(fen, game.parseJungleFen, () => game.createInitialJungleState('crawler')),
          moves,
          (t) => pair(t, game.ALL_JUNGLE_SQUARES),
          game.applyJungleMove,
          game.jungleStateToEngineFen,
          coordinate,
        );
      case 'jieqi': {
        if (!fen || fen.trim().split(/\s+/).length !== 6) return { labels: [], fen: null };
        return replay(
          start(fen, game.parseJieqiFen, () => {
            throw new Error('Missing deal');
          }),
          moves,
          game.fsfUciToXiangqiSquares,
          game.applyJieqiMove,
          (s) => game.jieqiStateToPikafishFen(s, { public: true }),
          (_s, m, after) => game.jieqiMoveLabel(m, game.getJieqiPublicView(after)),
        );
      }
      case 'banqi':
        if (!fen || fen.trim().split(/\s+/).length !== 6) return { labels: [], fen: null };
        return replay(
          start(fen, game.parseBanqiFen, () => {
            throw new Error('Missing deal');
          }),
          moves,
          (t) => pair(t, game.ALL_BANQI_SQUARES),
          (s, m) => game.applyBanqiMove(s, m, game.BANQI_STUDY_MOVE_OPTIONS),
          game.banqiStateToEngineFen,
          (s, m) => game.banqiMoveLabel(m, s.board[m.from]),
        );
      case 'jungle-flip':
        if (!fen || fen.trim().split(/\s+/).length !== 6) return { labels: [], fen: null };
        return replay(
          start(fen, game.parseJungleFlipFen, () => {
            throw new Error('Missing deal');
          }),
          moves,
          (t) => pair(t, game.ALL_JUNGLE_FLIP_SQUARES),
          game.applyJungleFlipMove,
          game.jungleFlipStateToEngineFen,
          (s, m) => game.jungleFlipMoveLabel(m, s.board[m.from]),
        );
      case 'three-kingdoms-banqi':
        if (!fen || fen.trim().split(/\s+/).length !== 6) return { labels: [], fen: null };
        return replay(
          start(fen, game.parseThreeKingdomsBanqiFen, () => {
            throw new Error('Missing deal');
          }),
          moves,
          (t) => pair(t, game.ALL_THREE_KINGDOMS_BANQI_SQUARES),
          game.applyThreeKingdomsBanqiMove,
          game.threeKingdomsBanqiStateToEngineFen,
          (s, m) => game.threeKingdomsBanqiMoveLabel(m, s.board[m.from]),
        );
      case 'fortress-xiangqi':
        return replay(
          start(fen, game.parseFortressXiangqiFen, () =>
            game.createInitialFortressXiangqiState('crawler'),
          ),
          moves,
          game.fsfUciToFortressXiangqiMove,
          game.applyFortressXiangqiMove,
          game.fortressXiangqiEngineFen,
          (_s, m) =>
            game.isFortressXiangqiDropMove(m)
              ? `${game.fortressXiangqiMoveToFsfUci(m).split('@')[0]}@${m.to}`
              : `${m.from}-${m.to}`,
        );
      case 'crazyhouse-xiangqi':
        return replay(
          start(fen, game.parseCrazyhouseXiangqiFen, () =>
            game.createInitialCrazyhouseXiangqiState('crawler'),
          ),
          moves,
          game.crazyhouseXiangqiMoveFromUci,
          game.applyCrazyhouseXiangqiMove,
          game.crazyhouseXiangqiFen,
          (_s, m) =>
            game.isCrazyhouseXiangqiDropMove(m)
              ? game.crazyhouseXiangqiMoveToUci(m)
              : `${m.from}-${m.to}`,
        );
      case 'duck-xiangqi':
        return replay(
          start(fen, game.parseDuckXiangqiFen, () => game.createInitialDuckXiangqiState('crawler')),
          moves,
          duckTurn,
          game.applyDuckXiangqiTurn,
          game.duckXiangqiFen,
          (_s, m) => (m.duckTo === null ? `${m.from}x${m.to}#` : `${m.from}-${m.to}@${m.duckTo}`),
        );
      case 'atomic-xiangqi':
        return replay(
          (fen
            ? game.atomicXiangqiStateFromFen(fen, 'crawler')
            : game.createInitialAtomicXiangqiState('crawler')) ??
            (() => {
              throw new Error('Invalid atomic start');
            })(),
          moves,
          game.fsfUciToXiangqiSquares,
          game.applyAtomicXiangqiMove,
          game.atomicXiangqiFen,
          (s, m) => game.formatAtomicXiangqiMove(s, m, style),
        );
      case 'chess':
        return replay(
          start(fen, game.parseStandardChessFen, () =>
            game.standardChessVariant.createInitialState('crawler'),
          ),
          moves,
          chessMove,
          (s, m) => game.standardChessVariant.applyMove(s, m),
          game.darkChessFen,
          (s, m) => game.standardChessSan(s, m),
        );
      case 'gomoku':
        return replay(
          start(fen, game.parseGomokuFen, () => game.createGomokuRoomState('crawler')),
          moves,
          game.parseGomokuMove,
          game.applyGomokuRoomMove,
          game.gomokuFen,
          (_s, m) => game.formatGomokuMove(m),
        );
      // Fog has seat-dependent visibility. A canonical state is never a public
      // projection; neither moves nor FEN may silently become public here.
      default:
        return { labels: [], fen: null };
    }
  } catch {
    return { labels: [], fen: null };
  }
}

function pair<S extends string>(token: string, squares: readonly S[]): { from: S; to: S } | null {
  const match = /^([a-z]\d+)([a-z]\d+)$/.exec(token);
  if (!match) return null;
  const from = squares.find((s) => s === match[1]);
  const to = squares.find((s) => s === match[2]);
  return from && to ? { from, to } : null;
}
function duckTurn(token: string): game.DuckXiangqiTurn | null {
  const [piece, duck] = token.split('@');
  const move = game.fsfUciToXiangqiSquares(piece!);
  if (!move || (duck !== undefined && !/^[a-i](?:[1-9]|10)$/.test(duck))) return null;
  return { ...move, duckTo: (duck ?? null) as game.DuckXiangqiSquare | null };
}
function chessMove(token: string): game.Move | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(token);
  if (!m) return null;
  const promotion = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const;
  return {
    from: m[1] as game.Square,
    to: m[2] as game.Square,
    ...(m[3] ? { promotion: promotion[m[3] as keyof typeof promotion] } : {}),
  };
}

export function boardTextParts(params: BoardTextParams): string {
  const { locale, players } = params;
  const facts = [
    players ? [boardCopy(locale, 'replay.red'), players.red] : null,
    players ? [boardCopy(locale, 'replay.black'), players.black] : null,
    params.event ? [boardCopy(locale, 'study.gameEvent'), params.event] : null,
    params.date ? [boardCopy(locale, 'study.gameDate'), params.date] : null,
    params.result ? [boardCopy(locale, 'study.gameResult'), params.result] : null,
  ].filter((f): f is string[] => f !== null);
  const line = boardTextLine(params);
  return (
    `<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k!)}</dt><dd>${escapeHtml(v!)}</dd>`).join('')}</dl>` +
    `<h2>${escapeHtml(boardCopy(locale, 'replay.moves'))}</h2><ol>${line.labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ol>` +
    (line.fen
      ? `<p>${boardCopy(locale, 'analysis.fen')}: <code>${escapeHtml(line.fen)}</code></p>`
      : '')
  );
}

export function boardTextBody(params: BoardTextParams): string {
  const heading =
    params.heading ??
    (params.players
      ? `${params.players.red} ${boardCopy(params.locale, 'study.gameVs')} ${params.players.black}`
      : variantName(params.variant, params.locale));
  return `<main><h1>${escapeHtml(heading)}</h1>${boardTextParts(params)}</main>`;
}
