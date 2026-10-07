// /champions (+ /zh-hans/champions, /zh-hant/champions): one title per game
// with a bot. The holder is the bot you play on the site, credited by name; any
// engine can challenge for the title in a public match. Moved here from
// brianhliou.com/challenges/ on 2026-10-07 and renamed from "Engine
// challenges" the same day; /challenges 301s here (legacyPageRedirect).
// Renders inside the shared /about rail + panel shell like /creators.
//
// Layout (Brian, 2026-10-07: make it "more compelling… such that the people
// reading this actually care", and cover every game): titles won in a match
// are hero cards (crown, game marker, the match score as a stat with a
// win/draw/loss bar, quiet buttons); every other game with a bot sits in a
// quieter "Open titles" grid pointing at the challenge rules (#challenge).
// Motion only on hover: perpetual idle motion is banned on this site.
//
// The engines named here must match prod (`npm run variants -- --prod` and
// /api/bots); budgets are the serving configs in apps/server/src
// (jieqi-engine.ts, jungle-katago-engine.ts, jungle-engine.ts). TITLES is in
// CANONICAL_VARIANT_ORDER (champions-page.test.ts checks it against VARIANTS).

import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { buildNav, GITHUB_URL } from './site-shell.js';
import {
  proseExternalLink,
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import { buildUiIcon } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';

export function mountChampions(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'champions-route');
  root.append(buildNav(locale), buildStaticPageLayout('champions', buildChampions(locale), locale));
}

type Part = string | Node;

type TitleMatch = {
  writeUpHref: string;
  gamesHref: string;
};

// The match in which the reigning champion took the title, from its side.
type Reign = TitleMatch & {
  wins: number;
  draws: number;
  losses: number;
  tookKey: I18nKey;
  about: (locale: Locale) => Part[];
};

type Title = {
  gameId: VariantMiniId;
  nameKey: I18nKey;
  // The bot's name as the site shows it; `holderKey` where zh uses a
  // published translation (皮卡鱼 for Pikafish).
  holder: string;
  holderKey?: I18nKey;
  botHref: string;
  // Present once a challenger has taken the title; absent while it is open.
  reign?: Reign;
};

const MISTY_JUNGLE_REPO = 'https://github.com/brianhliou/misty-jungle';

const JIEQI_MATCH: TitleMatch = { writeUpHref: '/blog/ab-jchess', gamesHref: '/data' };
const JUNGLE_MATCH: TitleMatch = {
  writeUpHref: '/blog/katago-jungle',
  gamesHref: '/study/0t8xpyv6',
};

const MISTY = { holder: 'Misty', botHref: '/bot/misty' } as const;
const FAIRY_STOCKFISH_L8 = {
  holder: 'Fairy-Stockfish Level 8',
  holderKey: 'champions.engineFairyStockfish8',
  botHref: '/bot/fairy-stockfish-level-8',
} as const;

export const TITLES: readonly Title[] = [
  {
    gameId: 'xiangqi',
    nameKey: 'variant.xiangqi.name',
    holder: 'Pikafish',
    holderKey: 'champions.enginePikafish',
    botHref: '/bot/pikafish',
  },
  {
    gameId: 'jieqi',
    nameKey: 'variant.jieqi.name',
    holder: 'AB-JChess',
    botHref: '/bot/ab-jchess',
    reign: {
      ...JIEQI_MATCH,
      // AB-JChess won 248, lost 136, drew 16 (the write-up; a 0.64 score).
      wins: 248,
      draws: 16,
      losses: 136,
      tookKey: 'champions.tookJieqi',
      about: (locale) => [t('champions.aboutJieqi', {}, locale)],
    },
  },
  { gameId: 'banqi', nameKey: 'variant.banqi.name', ...MISTY },
  { gameId: 'duck-xiangqi', nameKey: 'variant.duckXiangqi.name', ...FAIRY_STOCKFISH_L8 },
  {
    gameId: 'crazyhouse-xiangqi',
    nameKey: 'variant.crazyhouseXiangqi.name',
    ...FAIRY_STOCKFISH_L8,
  },
  { gameId: 'fortress-xiangqi', nameKey: 'variant.fortressXiangqi.name', ...FAIRY_STOCKFISH_L8 },
  { gameId: 'dark-xiangqi', nameKey: 'variant.darkXiangqi.name', ...MISTY },
  { gameId: 'dark-chess', nameKey: 'variant.darkChess.name', ...MISTY },
  {
    gameId: 'jungle',
    nameKey: 'variant.jungle.name',
    holder: 'KataGo-AnimalChess',
    botHref: '/bot/katago',
    reign: {
      ...JUNGLE_MATCH,
      wins: 82,
      draws: 118,
      losses: 0,
      tookKey: 'champions.tookJungle',
      about: (locale) => [
        t('champions.aboutJunglePrefix', {}, locale),
        proseExternalLink('MistyJungle', MISTY_JUNGLE_REPO),
        t('champions.aboutJungleSuffix', {}, locale),
      ],
    },
  },
  { gameId: 'jungle-flip', nameKey: 'variant.jungleFlip.name', ...MISTY },
];

export const CHAMPIONS = TITLES.filter((title) => title.reign);
export const OPEN_TITLES = TITLES.filter((title) => !title.reign);

// One line per title change, newest first.
export const TITLE_HISTORY: ReadonlyArray<TitleMatch & { textKey: I18nKey }> = [
  { ...JIEQI_MATCH, textKey: 'champions.historyJieqi' },
  { ...JUNGLE_MATCH, textKey: 'champions.historyJungle' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parts: Part[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const part of parts)
    node.append(typeof part === 'string' ? document.createTextNode(part) : part);
  return node;
}

function list(items: Part[][]): HTMLUListElement {
  const ul = el('ul', 'champions-list');
  for (const parts of items) ul.append(el('li', '', parts));
  return ul;
}

function marker(gameId: VariantMiniId, size: number): HTMLElement {
  const wrap = el('span', 'champions-marker');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = renderVariantMarker(gameId, { size, label: '' });
  return wrap;
}

function holderName(title: Title, locale: Locale): string {
  return title.holderKey ? t(title.holderKey, {}, locale) : title.holder;
}

function button(label: string, href: string): HTMLAnchorElement {
  const a = proseLink(label, href);
  a.className = 'champions-btn';
  return a;
}

// "<text> (write-up, games)." for the history list.
function matchLine(locale: Locale, textKey: I18nKey, match: TitleMatch): Part[] {
  return [
    t(textKey, {}, locale),
    t('champions.parenOpen', {}, locale),
    proseLink(t('champions.writeUpLink', {}, locale), localizedHref(match.writeUpHref, locale)),
    t('champions.linkSeparator', {}, locale),
    proseLink(t('champions.gamesLink', {}, locale), match.gamesHref),
    t('champions.parenClose', {}, locale),
  ];
}

function scoreBlock(reign: Reign, locale: Locale): HTMLElement {
  const score = el('div', 'champions-score');
  const stats = el('dl', 'champions-stats');
  const rows: Array<[keyof Pick<Reign, 'wins' | 'draws' | 'losses'>, I18nKey]> = [
    ['wins', 'champions.statWins'],
    ['draws', 'champions.statDraws'],
    ['losses', 'champions.statLosses'],
  ];
  const bar = el('div', 'champions-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    t('champions.barLabel', { wins: reign.wins, draws: reign.draws, losses: reign.losses }, locale),
  );
  for (const [field, labelKey] of rows) {
    const stat = el('div', `champions-stat champions-stat-${field}`, [
      el('dt', '', [t(labelKey, {}, locale)]),
      el('dd', '', [String(reign[field])]),
    ]);
    stats.append(stat);
    if (reign[field] > 0) {
      const segment = el('span', `champions-bar-${field}`);
      segment.style.flexGrow = String(reign[field]);
      bar.append(segment);
    }
  }
  score.append(stats, bar);
  return score;
}

function heroCard(title: Title, reign: Reign, locale: Locale): HTMLElement {
  const card = el('article', 'champions-hero');
  card.dataset.game = title.gameId;

  const crown = el('span', 'champions-crown', [
    buildUiIcon('title-champion'),
    t('champions.championBadge', {}, locale),
  ]);
  const head = el('div', 'champions-hero-head', [
    marker(title.gameId, 44),
    el('div', 'champions-hero-titles', [
      el('div', 'champions-hero-eyebrow', [
        el('p', 'champions-hero-game', [t(title.nameKey, {}, locale)]),
        crown,
      ]),
      el('h3', 'champions-hero-name', [holderName(title, locale)]),
    ]),
  ]);

  const actions = el('div', 'champions-actions', [
    button(t('champions.readMatch', {}, locale), localizedHref(reign.writeUpHref, locale)),
    button(t('champions.seeGames', {}, locale), reign.gamesHref),
    button(t('champions.playChampion', {}, locale), title.botHref),
  ]);

  card.append(
    head,
    scoreBlock(reign, locale),
    el('p', 'champions-took', [t(reign.tookKey, {}, locale)]),
    el('p', 'champions-about', reign.about(locale)),
    actions,
  );
  return card;
}

function openCard(title: Title, locale: Locale): HTMLElement {
  const card = el('article', 'champions-open');
  card.dataset.game = title.gameId;
  const holder = proseLink(holderName(title, locale), title.botHref);
  holder.className = 'champions-open-holder-link';
  card.append(
    el('div', 'champions-open-head', [
      marker(title.gameId, 26),
      el('h3', 'champions-open-game', [t(title.nameKey, {}, locale)]),
    ]),
    el('p', 'champions-open-holder', [
      el('span', 'champions-open-label', [t('champions.heldBy', {}, locale)]),
      holder,
    ]),
    el('span', 'champions-open-badge', [t('champions.openBadge', {}, locale)]),
    button(t('champions.challengeCta', {}, locale), '#challenge'),
  );
  return card;
}

export function buildChampions(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('champions-section');

  const heroes = el('div', 'champions-heroes');
  for (const title of CHAMPIONS) {
    if (title.reign) heroes.append(heroCard(title, title.reign, locale));
  }
  const open = el('div', 'champions-open-grid');
  open.append(...OPEN_TITLES.map((title) => openCard(title, locale)));

  const challengeHeading = proseSubheading(t('champions.challengeHeading', {}, locale));
  challengeHeading.id = 'challenge';

  section.append(
    proseHeading(t('champions.heading', {}, locale)),
    proseParagraph([t('champions.intro', {}, locale)]),
    heroes,

    proseSubheading(t('champions.openHeading', {}, locale)),
    proseParagraph([t('champions.openIntro', {}, locale)]),
    open,

    proseSubheading(t('champions.historyHeading', {}, locale)),
    list(TITLE_HISTORY.map((entry) => matchLine(locale, entry.textKey, entry))),

    challengeHeading,
    list([
      [t('champions.ruleMatch', {}, locale)],
      [t('champions.ruleScore', {}, locale)],
      [t('champions.ruleRun', {}, locale)],
      [
        t('champions.ruleSubmitPrefix', {}, locale),
        proseExternalLink(t('champions.ruleSubmitIssueLink', {}, locale), `${GITHUB_URL}/issues`),
        t('champions.ruleSubmitMiddle', {}, locale),
        proseLink(t('champions.ruleSubmitContactLink', {}, locale), '/contact'),
        t('champions.ruleSubmitSuffix', {}, locale),
      ],
    ]),
  );
  return section;
}
