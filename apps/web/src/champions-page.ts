// /champions (+ /zh-hans/champions, /zh-hant/champions): one reigning champion
// engine per game. The champion is the bot you play on the site, credited by
// name; any engine can challenge for the title in a public match. Moved here
// from brianhliou.com/challenges/ on 2026-10-07 and renamed from "Engine
// challenges" the same day; /challenges 301s here (legacyPageRedirect).
// Renders inside the shared /about rail + panel shell like /creators.
//
// The engines named here must match prod (`npm run variants -- --prod` and
// /api/bots); budgets are the serving configs in apps/server/src
// (jieqi-engine.ts, banqi-engine.ts, jungle-katago-engine.ts, jungle-engine.ts,
// jungle-flip-engine.ts).

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

type Champion = {
  gameId: 'jieqi' | 'banqi' | 'jungle' | 'jungle-flip';
  gameKey: I18nKey;
  rulesHref: string;
  holder: () => Node;
  // A house engine holds the title until a challenger takes it in a match.
  status: 'reigning' | 'open';
  about: (locale: Locale) => Part[];
  // How the reigning champion took the title; absent for an open title.
  won?: TitleMatch & { textKey: I18nKey };
};

const MISTY_BANQI_REPO = 'https://github.com/brianhliou/misty-banqi';
const MISTY_JUNGLE_REPO = 'https://github.com/brianhliou/misty-jungle';
const MISTY_FLIP_JUNGLE_REPO = 'https://github.com/brianhliou/misty-flip-jungle';

const JIEQI_MATCH: TitleMatch = { writeUpHref: '/blog/ab-jchess', gamesHref: '/data' };
const JUNGLE_MATCH: TitleMatch = {
  writeUpHref: '/blog/katago-jungle',
  gamesHref: '/study/0t8xpyv6',
};

export const CHAMPIONS: readonly Champion[] = [
  {
    gameId: 'jieqi',
    gameKey: 'champions.gameJieqi',
    rulesHref: '/rules/jieqi',
    holder: () => proseLink('AB-JChess', '/bot/ab-jchess'),
    status: 'reigning',
    about: (locale) => [t('champions.aboutJieqi', {}, locale)],
    won: { ...JIEQI_MATCH, textKey: 'champions.wonJieqi' },
  },
  {
    gameId: 'banqi',
    gameKey: 'champions.gameBanqi',
    rulesHref: '/rules/banqi',
    holder: () => proseExternalLink('MistyBanqi', MISTY_BANQI_REPO),
    status: 'open',
    about: (locale) => [t('champions.aboutBanqi', {}, locale)],
  },
  {
    gameId: 'jungle',
    gameKey: 'champions.gameJungle',
    rulesHref: '/rules/jungle',
    holder: () => proseLink('KataGo-AnimalChess', '/bot/katago'),
    status: 'reigning',
    about: (locale) => [
      t('champions.aboutJunglePrefix', {}, locale),
      proseExternalLink('MistyJungle', MISTY_JUNGLE_REPO),
      t('champions.aboutJungleSuffix', {}, locale),
    ],
    won: { ...JUNGLE_MATCH, textKey: 'champions.wonJungle' },
  },
  {
    gameId: 'jungle-flip',
    gameKey: 'champions.gameJungleFlip',
    rulesHref: '/rules/jungle-flip',
    holder: () => proseExternalLink('Misty', MISTY_FLIP_JUNGLE_REPO),
    status: 'open',
    about: (locale) => [t('champions.aboutJungleFlip', {}, locale)],
  },
];

// One line per title change, newest first.
export const TITLE_HISTORY: ReadonlyArray<TitleMatch & { textKey: I18nKey }> = [
  { ...JIEQI_MATCH, textKey: 'champions.historyJieqi' },
  { ...JUNGLE_MATCH, textKey: 'champions.historyJungle' },
];

function append(el: HTMLElement, parts: Part[]): HTMLElement {
  for (const part of parts)
    el.append(typeof part === 'string' ? document.createTextNode(part) : part);
  return el;
}

function list(items: Part[][]): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'champions-list';
  for (const parts of items) ul.append(append(document.createElement('li'), parts));
  return ul;
}

// "<text> (write-up, games)." Shared by the card and the history line.
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

function championCard(champion: Champion, locale: Locale): HTMLElement {
  const card = document.createElement('article');
  card.className = 'champions-card';
  card.dataset.game = champion.gameId;
  card.dataset.status = champion.status;

  const heading = document.createElement('h3');
  heading.append(
    proseLink(t(champion.gameKey, {}, locale), localizedHref(champion.rulesHref, locale)),
  );

  const holder = document.createElement('p');
  holder.className = 'champions-holder';
  append(
    holder,
    champion.status === 'reigning'
      ? [t('champions.reigningLabel', {}, locale), champion.holder()]
      : [
          t('champions.holderLabel', {}, locale),
          champion.holder(),
          t('champions.holderOpen', {}, locale),
        ],
  );

  card.append(heading, holder, proseParagraph(champion.about(locale)));
  if (champion.won) {
    card.append(proseParagraph(matchLine(locale, champion.won.textKey, champion.won)));
  }
  return card;
}

export function buildChampions(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('champions-section');
  const cards = document.createElement('div');
  cards.className = 'champions-cards';
  cards.append(...CHAMPIONS.map((champion) => championCard(champion, locale)));

  section.append(
    proseHeading(t('champions.heading', {}, locale)),
    proseParagraph([t('champions.intro', {}, locale)]),
    cards,

    proseSubheading(t('champions.historyHeading', {}, locale)),
    list(TITLE_HISTORY.map((entry) => matchLine(locale, entry.textKey, entry))),

    proseSubheading(t('champions.challengeHeading', {}, locale)),
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
