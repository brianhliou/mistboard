import { jungleStateToEngineFen, maybeGameSpecForId, standardXiangqiFen } from '@mistboard/game';
import { boardTextBody, boardTextParts } from './board-text-body.js';
import { BOARD_COPY, type BoardLocale, boardCopy, boardTimeClass } from './board-text-copy.js';
import { botPageMeta } from './bot-page-meta.js';
import { escapeHtml } from './crawler-html.js';
import { crosstableReviewUrl } from './crosstable-review-url.js';
import * as persistence from './persistence.js';
import type { BotProfilePage } from './persistence-bots.js';
import type { ProfileGameRecord } from './persistence-games.js';
import type { HistoricalXiangqiGameInput } from './persistence-historical-xiangqi.js';
import { getHistoricalXiangqiPuzzleSourceGame } from './persistence-historical-xiangqi.js';
import { variantName } from './player-email.js';
import { puzzleDetailSourceFields, type SourceGameLoader } from './puzzle-setup-move.js';
import { botPlayOptions } from './routes/bots.js';
import type { PublicPuzzle } from './routes/puzzles.js';

function isPublicVariant(id: string): boolean {
  const spec = maybeGameSpecForId(id);
  return !!spec && spec.publicSurface !== 'hidden' && spec.runtimeStatus !== 'retired';
}

export function boardLocale(search = ''): BoardLocale {
  const lang = new URLSearchParams(search).get('lang')?.toLowerCase();
  return lang === 'zh-hans' ? 'zh-Hans' : lang === 'zh-hant' ? 'zh-Hant' : 'en';
}

export async function historicalBoardPage(
  path: string,
  locale: BoardLocale,
  lookup: (
    id: string,
  ) => Promise<HistoricalXiangqiGameInput | null> = persistence.getHistoricalXiangqiGame,
) {
  const match = /^\/historical-xiangqi\/game\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    const game = await lookup(id);
    if (!game || game.visibility === 'private') return { noindex: true };
    const red = game.redNameRaw || boardCopy(locale, 'replay.red');
    const black = game.blackNameRaw || boardCopy(locale, 'replay.black');
    const heading = `${red} ${boardCopy(locale, 'study.gameVs')} ${black}`;
    const context = [game.eventName, game.playedOn?.slice(0, 4)].filter(Boolean).join(' ');
    const title = `${heading}${context ? `, ${context}` : ''} | Mistboard`;
    return {
      noindex: game.visibility !== 'public',
      meta: {
        title,
        description: [heading, game.eventName, game.playedOn, game.result]
          .filter(Boolean)
          .join(' · '),
        urlPath: `/historical-xiangqi/game/${encodeURIComponent(id)}`,
        imagePath: undefined,
      },
      body: boardTextBody({
        variant: 'xiangqi',
        players: { red, black },
        event: game.eventName,
        date: game.playedOn,
        result: game.result,
        moves: game.moves.map((m) => `${m.from}${m.to}`),
        locale,
      }),
    };
  } catch {
    return { noindex: true };
  }
}

export function puzzleHeading(puzzle: PublicPuzzle, locale: BoardLocale): string {
  const goal = boardCopy(
    locale,
    puzzle.goal.type === 'checkmate'
      ? 'puzzle.mateIn'
      : puzzle.goal.type === 'win'
        ? 'puzzle.winIn'
        : 'puzzle.winning',
  ).replace('{count}', String(Math.ceil(puzzle.solution.length / 2)));
  return `${variantName(puzzle.variant, locale)} · ${boardCopy(locale, 'puzzle.label').trim()} · ${goal}`;
}

export async function puzzleBoardBody(
  puzzle: PublicPuzzle,
  heading: string,
  locale: BoardLocale,
  sourceLookup: SourceGameLoader | null = persistence.isInitialized()
    ? getHistoricalXiangqiPuzzleSourceGame
    : null,
): Promise<string> {
  const fen =
    puzzle.variant === 'xiangqi'
      ? standardXiangqiFen(puzzle.initial)
      : jungleStateToEngineFen(puzzle.initial);
  const side =
    puzzle.initial.status.type === 'playing'
      ? boardCopy(locale, puzzle.initial.status.turn === 'red' ? 'replay.red' : 'replay.black')
      : '';
  const themeLabels = puzzle.themes.flatMap((theme) => {
    const key = `puzzle.tagName.${theme}`;
    return key in BOARD_COPY[locale] ? [BOARD_COPY[locale][key as keyof typeof BOARD_COPY.en]] : [];
  });
  const source =
    puzzle.variant === 'xiangqi'
      ? (await puzzleDetailSourceFields(puzzle, sourceLookup)).sourceGame
      : undefined;
  let sourceHtml = '';
  if (source && !source.online) {
    const red = locale === 'en' ? (source.redNameEn ?? source.redName) : source.redName;
    const black = locale === 'en' ? (source.blackNameEn ?? source.blackName) : source.blackName;
    const label = [
      red && black ? `${red} ${boardCopy(locale, 'study.gameVs')} ${black}` : null,
      locale === 'en' ? (source.eventEn ?? source.event) : source.event,
      source.playedOn,
      source.result,
    ]
      .filter(Boolean)
      .join(' · ');
    sourceHtml = `<p>${boardCopy(locale, 'study.gameSource')}: ${source.hosted ? `<a href="/historical-xiangqi/game/${encodeURIComponent(source.gameId)}">${escapeHtml(label)}</a>` : escapeHtml(label)}</p>`;
  }
  return (
    `<main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(boardCopy(locale, 'puzzle.toMove').replace('{color}', side))}</p>` +
    `<p>${escapeHtml(boardCopy(locale, 'puzzle.findBestMove'))}</p><p>${boardCopy(locale, 'puzzle.themeField')}: ${escapeHtml(themeLabels.join(', '))}</p>${sourceHtml}` +
    `<p>${boardCopy(locale, 'analysis.fen')}: <code>${escapeHtml(fen)}</code></p>` +
    `<details><summary>${boardCopy(locale, 'puzzle.solution')}</summary>${boardTextParts({ variant: puzzle.variant, moves: puzzle.solution.map((m) => `${m.from}${m.to}`), fen, locale })}</details></main>`
  );
}

/** Only finished public summaries; never replay events or the canonical board. */
export function publicGamesTable(games: readonly ProfileGameRecord[], locale: BoardLocale): string {
  const rows = games
    .filter((g) => g.visibility === 'public' && g.endedAt && isPublicVariant(g.variant))
    .map((g) => {
      const href = crosstableReviewUrl(g.roomId, g.variant);
      const names = `${escapeHtml(g.whiteName ?? '')} ${boardCopy(locale, 'study.gameVs')} ${escapeHtml(g.blackName ?? '')}`;
      const pairing = href ? `<a href="${escapeHtml(href)}">${names}</a>` : names;
      return `<tr><td>${escapeHtml(g.endedAt.toISOString().slice(0, 10))}</td><td>${pairing}</td><td>${escapeHtml(variantName(g.variant, locale))}</td><td>${escapeHtml(g.result)}</td></tr>`;
    });
  return rows.length
    ? `<table><thead><tr><th>${boardCopy(locale, 'study.gameDate')}</th><th>${boardCopy(locale, 'profile.games')}</th><th>${boardCopy(locale, 'bots.variants')}</th><th>${boardCopy(locale, 'study.gameResult')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '';
}

export function profileBoardBody(
  profile: persistence.UserProfile,
  facts: readonly string[],
  locale: BoardLocale,
): string {
  return `<main><h1>${escapeHtml(profile.user.displayName)} (@${escapeHtml(profile.user.handle)})</h1><p>${boardCopy(locale, 'profile.playerProfile')}</p><h2>${boardCopy(locale, 'profile.ratings')}</h2><ul>${facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul><h2>${boardCopy(locale, 'profile.games')}</h2>${publicGamesTable(profile.games, locale)}</main>`;
}

export async function botBoardPage(
  path: string,
  locale: BoardLocale,
  lookup: (id: string) => Promise<BotProfilePage | null> = persistence.getPublicBotProfile,
) {
  const match = /^\/bot\/([a-z0-9-]+)\/?$/.exec(path);
  if (!match) return null;
  const bot = await lookup(match[1]!).catch(() => null);
  if (bot?.visibility !== 'public' || !botPlayOptions(bot).some((o) => o.playable))
    return { noindex: true };
  const variants = bot.supportedGameSpecIds.filter((id) => isPublicVariant(id));
  const rows = variants.map((id) => {
    const record = bot.recordsByGameSpecId[id];
    const rating = bot.ratings
      .filter((r) => r.gameSpecId === id)
      .map((r) => `${boardTimeClass(r.timeClass, locale)} ${r.rating}${r.provisional ? '?' : ''}`)
      .join(', ');
    return `<li>${escapeHtml(variantName(id, locale))}<dl><dt>${boardCopy(locale, 'bots.ratings')}</dt><dd>${escapeHtml(rating || boardCopy(locale, 'bots.noPublishedRating'))}</dd>${record ? `<dt>${boardCopy(locale, 'bots.gamesHere')}</dt><dd>${record.games}</dd><dt>${boardCopy(locale, 'bots.recordHere')}</dt><dd>${record.wins}-${record.losses}-${record.draws}</dd>` : ''}</dl></li>`;
  });
  return {
    noindex: false,
    meta: {
      ...(await botPageMeta(path.replace(/\/+$/, ''), async () => bot))!,
      ...(locale === 'en'
        ? {}
        : {
            title: boardCopy(locale, 'bots.profileTitle').replace('{name}', bot.displayName),
            description: publicBotBio(bot, locale),
          }),
    },
    body: `<main><h1>${escapeHtml(bot.displayName)}</h1><p>${boardCopy(locale, bot.ownerType === 'system' ? 'bots.firstPartyBadge' : 'bots.communityBadge')}</p><p>${escapeHtml(publicBotBio(bot, locale))}</p><h2>${boardCopy(locale, 'bots.variants')}</h2><ul>${rows.join('')}</ul><h2>${boardCopy(locale, 'bots.recentGames')}</h2>${publicGamesTable(bot.games, locale)}</main>`,
  };
}

function publicBotBio(bot: BotProfilePage, locale: BoardLocale): string {
  if (bot.ownerType !== 'system') return bot.bio;
  const rung = /^(fairy-stockfish|pikafish)-level-(\d+)$/.exec(bot.id);
  if (rung)
    return boardCopy(
      locale,
      rung[1] === 'pikafish' ? 'bots.pikafishLevelBio' : 'bots.fairyStockfishLevelBio',
    ).replace('{level}', rung[2]!);
  const keys = {
    pikafish: 'bots.pikafishBio',
    'ab-jchess': 'bots.abJchessBio',
    jqe: 'bots.jqeBio',
    katago: 'bots.katagoBio',
    misty: 'bots.mistyBio',
    'general-blunder': 'bots.generalBlunderBio',
  } as const;
  const key = keys[bot.id as keyof typeof keys];
  return key ? boardCopy(locale, key) : bot.bio;
}
