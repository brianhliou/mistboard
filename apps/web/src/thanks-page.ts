// /thanks: the people behind what Mistboard runs and shows (lichess's /thanks
// equivalent). /source owns licences and the full component list; this page
// thanks people by name, each linked to their own work. Engines render from
// engine-credits.ts as a row each with their games and rating here, read live
// from /api/bots; bots from community developers join the same list from there
// on their own. Players and feedback providers are named only after they say
// yes (Brian, 2026-10-17).

import { ENGINE_CREDITS, type EngineCredit } from './engine-credits.js';
import { variantDisplayLabel } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import {
  proseExternalLink,
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import './thanks-page.css';
import { renderVariantMarker } from './variant-markers.js';
import { variantMiniIdForRawVariant } from './variants.js';

type SourceCredit = { name: I18nKey; body: I18nKey; href: string };

const SOURCE_CREDITS: readonly SourceCredit[] = [
  { name: 'thanks.dpxqName', body: 'thanks.dpxqBody', href: 'https://www.dpxq.com/' },
  {
    name: 'thanks.xiangqiqipuName',
    body: 'thanks.xiangqiqipuBody',
    href: 'https://www.xiangqiqipu.com/',
  },
  { name: 'thanks.pressName', body: 'thanks.pressBody', href: '/players' },
  {
    name: 'thanks.elephantChessName',
    body: 'thanks.elephantChessBody',
    href: 'https://elephantchess.io/about/datasets',
  },
  { name: 'thanks.chessdbName', body: 'thanks.chessdbBody', href: 'https://www.chessdb.cn/' },
  { name: 'thanks.jimPngName', body: 'thanks.jimPngBody', href: 'https://www.xqinenglish.com/' },
];

// A /contact?about= link prefills the form for a visitor; crawlers are kept off
// it so they do not file the ?about= copy as another URL for /contact.
function nofollow(link: HTMLAnchorElement): HTMLAnchorElement {
  link.rel = 'nofollow';
  return link;
}

// Lichess closes the page: most of the site follows its design (Brian,
// 2026-10-17: "they basically inspire everything"), said once, not as a banner.
function lichessSection(locale: Locale): HTMLElement {
  const block = document.createElement('section');
  block.className = 'thanks-lichess';
  block.append(
    proseSubheading(t('thanks.lichessHeading', {}, locale)),
    proseParagraph([t('thanks.lichessLead', {}, locale), ' ', t('thanks.lichessTook', {}, locale)]),
    proseParagraph([
      proseExternalLink(t('thanks.lichessCloseLink', {}, locale), 'https://lichess.org/'),
      t('thanks.lichessCloseMiddle', {}, locale),
      proseExternalLink(
        t('thanks.lichessCloseBuildersLink', {}, locale),
        'https://github.com/lichess-org/lila/graphs/contributors',
      ),
      t('thanks.lichessCloseSuffix', {}, locale),
    ]),
  );
  return block;
}

/** The fields of an /api/bots entry this page reads. */
export type ThanksBot = {
  id: string;
  displayName: string;
  ownerType: 'system' | 'user';
  supportedGameSpecIds: readonly string[];
  gamesTotal: number;
  ratings?: ReadonlyArray<{ gameSpecId: string; rating: number }>;
};

export function mountThanks(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'thanks-route');
  const page = buildThanks(locale);
  root.append(buildNav(locale), buildStaticPageLayout('thanks', page, locale));
  void loadBots().then((bots) => fillEngineStats(page, bots, locale));
}

export function buildThanks(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('thanks-section');
  const engines = document.createElement('ol');
  engines.className = 'thanks-engines';
  engines.append(...ENGINE_CREDITS.map((credit) => engineRow(credit, locale)));
  section.append(
    proseHeading(t('thanks.heading', {}, locale)),
    proseParagraph([t('thanks.intro', {}, locale)]),

    proseSubheading(t('thanks.enginesHeading', {}, locale)),
    engines,
    proseParagraph([
      t('thanks.enginesAskPrefix', {}, locale),
      nofollow(proseLink(t('thanks.enginesAskLink', {}, locale), '/contact?about=/thanks')),
      t('thanks.enginesAskSuffix', {}, locale),
    ]),

    proseSubheading(t('thanks.sourcesHeading', {}, locale)),
    sourceList(locale),

    proseSubheading(t('thanks.playersHeading', {}, locale)),
    proseParagraph([t('thanks.playersBody', {}, locale)]),
    proseParagraph([
      t('thanks.playersAskPrefix', {}, locale),
      nofollow(proseLink(t('thanks.playersAskLink', {}, locale), '/contact?about=/thanks')),
      t('thanks.playersAskSuffix', {}, locale),
    ]),

    lichessSection(locale),

    proseParagraph([
      t('thanks.openSourcePrefix', {}, locale),
      proseLink(t('thanks.openSourceLink', {}, locale), '/source'),
      t('thanks.openSourceSuffix', {}, locale),
    ]),
  );
  return section;
}

/**
 * Fills each engine row's games and rating from the bot list, and appends a row
 * per community developer's bot. With no bot list (offline, an API error) the
 * rows keep their empty stats column and the page still reads.
 */
export function fillEngineStats(
  page: HTMLElement,
  bots: readonly ThanksBot[],
  locale: Locale,
): void {
  const list = page.querySelector<HTMLOListElement>('.thanks-engines');
  if (!list || bots.length === 0) return;
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  for (const credit of ENGINE_CREDITS) {
    const row = list.querySelector<HTMLElement>(`[data-engine="${credit.id}"]`);
    const own = credit.botIds.flatMap((id) => byId.get(id) ?? []);
    if (row && own.length > 0) setStats(row, own, credit.gameSpecIds[0]!, locale);
  }
  for (const bot of bots.filter((b) => b.ownerType === 'user')) {
    const main = bot.supportedGameSpecIds[0];
    if (!main) continue;
    const row = rowShell(main, `community-${bot.id}`);
    row
      .querySelector('.thanks-engine-main')!
      .append(
        rowTitle(bot.displayName, `/bot/${encodeURIComponent(bot.id)}`),
        rowLine('thanks-engine-body', t('thanks.communityBotBy', {}, locale)),
        variantList(bot.supportedGameSpecIds),
      );
    setStats(row, [bot], main, locale);
    list.append(row);
  }
}

async function loadBots(): Promise<ThanksBot[]> {
  try {
    const resp = await fetch('/api/bots', { headers: { accept: 'application/json' } });
    if (!resp.ok) return [];
    const body = (await resp.json()) as { bots?: ThanksBot[] };
    return body.bots ?? [];
  } catch {
    return [];
  }
}

function engineRow(credit: EngineCredit, locale: Locale): HTMLElement {
  const row = rowShell(credit.gameSpecIds[0]!, credit.id);
  const by = document.createElement('p');
  by.className = 'thanks-engine-by';
  credit.authors.forEach((author, index) => {
    if (index > 0) by.append(' · ');
    by.append(proseExternalLink(t(author.name, {}, locale), author.href));
  });
  row
    .querySelector('.thanks-engine-main')!
    .append(
      rowTitle(credit.engine, `/bot/${encodeURIComponent(credit.botIds[0]!)}`),
      by,
      rowLine('thanks-engine-body', t(credit.body, {}, locale)),
      variantList(credit.gameSpecIds),
    );
  return row;
}

function rowShell(mainGameSpecId: string, id: string): HTMLElement {
  const row = document.createElement('li');
  row.className = 'thanks-engine';
  row.dataset.engine = id;
  const mark = document.createElement('div');
  mark.className = 'thanks-engine-mark';
  const miniId = variantMiniIdForRawVariant(mainGameSpecId);
  if (miniId) mark.innerHTML = renderVariantMarker(miniId, { size: 40, label: '' });
  mark.setAttribute('aria-hidden', 'true');
  const main = document.createElement('div');
  main.className = 'thanks-engine-main';
  const stats = document.createElement('dl');
  stats.className = 'thanks-engine-stats';
  row.append(mark, main, stats);
  return row;
}

function setStats(
  row: HTMLElement,
  bots: readonly ThanksBot[],
  mainGameSpecId: string,
  locale: Locale,
): void {
  const games = bots.reduce((sum, bot) => sum + bot.gamesTotal, 0);
  const ratings = bots.flatMap((bot) =>
    (bot.ratings ?? []).filter((r) => r.gameSpecId === mainGameSpecId).map((r) => r.rating),
  );
  const number = new Intl.NumberFormat(locale);
  const variant = variantDisplayLabel(mainGameSpecId);
  const stats = row.querySelector('.thanks-engine-stats')!;
  stats.replaceChildren(
    stat('games', number.format(games), t('thanks.statGames', {}, locale)),
    ratings.length > 0
      ? stat(
          'rating',
          // Ratings print bare, the way rating lists write them: 2334.
          String(Math.max(...ratings)),
          t('thanks.statRating', { variant }, locale),
        )
      : stat('rating', '', t('thanks.statUnrated', {}, locale)),
  );
}

function stat(kind: string, value: string, label: string): HTMLElement {
  const group = document.createElement('div');
  group.className = `thanks-engine-stat thanks-engine-stat-${kind}`;
  const dd = document.createElement('dd');
  dd.textContent = value;
  const dt = document.createElement('dt');
  dt.textContent = label;
  // dt after dd in the markup reads as "1,865 games on Mistboard".
  group.append(dd, dt);
  return group;
}

function rowTitle(label: string, href: string): HTMLElement {
  const heading = document.createElement('h3');
  heading.className = 'thanks-engine-name';
  heading.append(proseLink(label, href));
  return heading;
}

function rowLine(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function variantList(gameSpecIds: readonly string[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'thanks-engine-variants';
  for (const id of gameSpecIds) {
    const item = document.createElement('li');
    const miniId = variantMiniIdForRawVariant(id);
    if (miniId) item.innerHTML = renderVariantMarker(miniId, { size: 16, label: '' });
    item.append(variantDisplayLabel(id));
    list.append(item);
  }
  return list;
}

function sourceList(locale: Locale): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'thanks-credits';
  for (const credit of SOURCE_CREDITS) {
    const item = document.createElement('li');
    const name = credit.href.startsWith('/')
      ? proseLink(t(credit.name, {}, locale), credit.href)
      : proseExternalLink(t(credit.name, {}, locale), credit.href);
    name.classList.add('thanks-credit-name');
    const body = document.createElement('span');
    body.className = 'thanks-credit-body';
    body.textContent = t(credit.body, {}, locale);
    item.append(name, body);
    list.append(item);
  }
  return list;
}
