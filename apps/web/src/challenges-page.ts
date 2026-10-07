// /challenges (+ /zh-hans/challenges, /zh-hant/challenges): the engine-seat
// scoreboard, moved here from brianhliou.com/challenges/ on 2026-10-07. One row
// per game with a bot: who holds the seat and what takes it, the match rules,
// one line per won match, and one line per game on what has been tried. A
// scoreboard, not an ask list. Renders inside the shared /about rail + panel
// shell like /creators.
//
// The bots named here must match prod (`npm run variants -- --prod` and
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

export function mountChallenges(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'challenges-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('challenges', buildChallenges(locale), locale),
  );
}

type Part = string | Node;

type Seat = {
  gameKey: I18nKey;
  rulesHref: string;
  bot: (locale: Locale) => Part[];
  winsKey: I18nKey;
};

const MISTY_BANQI_REPO = 'https://github.com/brianhliou/misty-banqi';
const MISTY_JUNGLE_REPO = 'https://github.com/brianhliou/misty-jungle';
const MISTY_FLIP_JUNGLE_REPO = 'https://github.com/brianhliou/misty-flip-jungle';
const JIEQI_ATTEMPTS_POST = 'https://brianhliou.com/posts/jieqi-engine-attempts/';

export const CHALLENGE_SEATS: readonly Seat[] = [
  {
    gameKey: 'challenges.gameJieqi',
    rulesHref: '/rules/jieqi',
    bot: (locale) => [
      proseLink('AB-JChess', '/bot/ab-jchess'),
      t('challenges.jieqiBot', {}, locale),
    ],
    winsKey: 'challenges.jieqiWins',
  },
  {
    gameKey: 'challenges.gameBanqi',
    rulesHref: '/rules/banqi',
    bot: (locale) => [
      proseExternalLink('MistyBanqi', MISTY_BANQI_REPO),
      t('challenges.banqiBot', {}, locale),
    ],
    winsKey: 'challenges.banqiWins',
  },
  {
    gameKey: 'challenges.gameJungle',
    rulesHref: '/rules/jungle',
    bot: (locale) => [
      proseLink('KataGo-AnimalChess', '/bot/katago'),
      t('challenges.jungleBot', {}, locale),
      proseExternalLink('MistyJungle', MISTY_JUNGLE_REPO),
      t('challenges.jungleBotBelow', {}, locale),
    ],
    winsKey: 'challenges.jungleWins',
  },
  {
    gameKey: 'challenges.gameJungleFlip',
    rulesHref: '/rules/jungle-flip',
    bot: (locale) => [
      proseExternalLink('Misty', MISTY_FLIP_JUNGLE_REPO),
      t('challenges.jungleFlipBot', {}, locale),
    ],
    winsKey: 'challenges.jungleFlipWins',
  },
];

function strong(text: string): HTMLElement {
  const b = document.createElement('strong');
  b.textContent = text;
  return b;
}

function listItem(parts: Part[]): HTMLLIElement {
  const li = document.createElement('li');
  for (const part of parts)
    li.append(typeof part === 'string' ? document.createTextNode(part) : part);
  return li;
}

function list(items: Part[][]): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'challenges-list';
  ul.append(...items.map(listItem));
  return ul;
}

function cell(tag: 'th' | 'td', parts: Part[]): HTMLTableCellElement {
  const el = document.createElement(tag);
  for (const part of parts)
    el.append(typeof part === 'string' ? document.createTextNode(part) : part);
  return el;
}

function seatsTable(locale: Locale): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'challenges-table-wrap';
  const table = document.createElement('table');
  table.className = 'challenges-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const key of [
    'challenges.colGame',
    'challenges.colBot',
    'challenges.colWins',
  ] as const satisfies readonly I18nKey[]) {
    const th = cell('th', [t(key, {}, locale)]);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const seat of CHALLENGE_SEATS) {
    const row = document.createElement('tr');
    const game = cell('th', [
      proseLink(t(seat.gameKey, {}, locale), localizedHref(seat.rulesHref, locale)),
    ]);
    game.scope = 'row';
    row.append(game, cell('td', seat.bot(locale)), cell('td', [t(seat.winsKey, {}, locale)]));
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function resultLine(
  locale: Locale,
  textKey: I18nKey,
  writeUpHref: string,
  gamesHref: string,
): Part[] {
  return [
    t(textKey, {}, locale),
    t('challenges.parenOpen', {}, locale),
    proseLink(t('challenges.writeUpLink', {}, locale), localizedHref(writeUpHref, locale)),
    t('challenges.linkSeparator', {}, locale),
    proseLink(t('challenges.gamesLink', {}, locale), gamesHref),
    t('challenges.parenClose', {}, locale),
  ];
}

export function buildChallenges(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('challenges-section');
  section.append(
    proseHeading(t('challenges.heading', {}, locale)),
    proseParagraph([
      t('challenges.introPrefix', {}, locale),
      proseLink(t('challenges.introChangelogLink', {}, locale), '/changelog'),
      t('challenges.introSuffix', {}, locale),
    ]),

    proseSubheading(t('challenges.seatsHeading', {}, locale)),
    seatsTable(locale),

    proseSubheading(t('challenges.rulesHeading', {}, locale)),
    list([
      [t('challenges.ruleMatch', {}, locale)],
      [t('challenges.ruleScore', {}, locale)],
      [t('challenges.ruleRun', {}, locale)],
      [
        t('challenges.ruleSubmitPrefix', {}, locale),
        proseExternalLink(t('challenges.ruleSubmitIssueLink', {}, locale), `${GITHUB_URL}/issues`),
        t('challenges.ruleSubmitMiddle', {}, locale),
        proseLink(t('challenges.ruleSubmitContactLink', {}, locale), '/contact'),
        t('challenges.ruleSubmitSuffix', {}, locale),
      ],
    ]),

    proseSubheading(t('challenges.resultsHeading', {}, locale)),
    list([
      resultLine(locale, 'challenges.resultJieqi', '/blog/ab-jchess', '/data'),
      resultLine(locale, 'challenges.resultJungle', '/blog/katago-jungle', '/study/0t8xpyv6'),
    ]),

    proseSubheading(t('challenges.triedHeading', {}, locale)),
    list([
      [
        strong(t('challenges.gameJieqi', {}, locale)),
        t('challenges.leadSeparator', {}, locale),
        t('challenges.triedJieqi', {}, locale),
        t('challenges.parenOpen', {}, locale),
        proseExternalLink(t('challenges.triedJieqiLink', {}, locale), JIEQI_ATTEMPTS_POST),
        t('challenges.parenClose', {}, locale),
      ],
      [
        strong(t('challenges.gameBanqi', {}, locale)),
        t('challenges.leadSeparator', {}, locale),
        t('challenges.triedBanqi', {}, locale),
      ],
      [
        strong(t('challenges.gameJungle', {}, locale)),
        t('challenges.leadSeparator', {}, locale),
        t('challenges.triedJungle', {}, locale),
      ],
    ]),
  );
  return section;
}
