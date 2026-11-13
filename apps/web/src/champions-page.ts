import { prerenderMount } from './prerender-copy.js';
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
// quieter "Open titles" grid with one button to the challenge rules (#challenge).
// Motion only on hover: perpetual idle motion is banned on this site.
//
// The engines named here must match prod (`npm run variants -- --prod` and
// /api/bots); budgets are the serving configs in apps/server/src
// (jieqi-engine.ts, jungle-katago-engine.ts, jungle-engine.ts). TITLES is in
// CANONICAL_VARIANT_ORDER (champions-page.test.ts checks it against VARIANTS).

import { isPublicGameSpec } from '@mistboard/game';
import { articleIsLive } from './articles/publish-time.js';
import {
  PIKAFISH_REPO_URL,
  RAPFI_BUILD_URL,
  RAPFI_REPO_URL,
  XIANGQI_CC0_NET_URL,
} from './engine-credits.js';
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

// Either link may be missing while it is unpublished, or absent when there is no
// public page or study for a match (AB-JChess-20261031's); the card and the history
// line show only the ones there are.
type TitleMatch = {
  writeUpHref?: string;
  gamesHref?: string;
};

// The match in which the reigning champion took the title, from its side.
type Reign = TitleMatch & {
  wins: number;
  draws: number;
  losses: number;
  tookKey: I18nKey;
  about: (locale: Locale) => Part[];
};

// One linked credit: an engine's code or the network it loads. `nameKey` where
// zh uses a published name (皮卡鱼); `href` may depend on the reader's language.
type Credit = {
  name: string;
  nameKey?: I18nKey;
  href: string | ((locale: Locale) => string);
};

// Who wrote what the holder runs, each linked to its source. `network` only for
// an engine that loads a separate net or weights file. URLs are the ones /source,
// /thanks and the bot pages already cite (engine-credits.ts, bots.ts botCredits).
type Credits = {
  code: readonly Credit[];
  network?: readonly Credit[];
};

type Title = {
  gameId: VariantMiniId;
  nameKey: I18nKey;
  // The bot's name as the site shows it; `holderKey` where zh uses a
  // published translation (皮卡鱼 for Pikafish).
  holder?: string;
  holderKey?: I18nKey;
  // The holder's bot page (/bot/<id>, keyed by the /api/bots id). The card's
  // name links there like a profile. Open titles may have no holder or bot page.
  botHref?: string;
  // The holder's id in the variant's computer setup (variant-tenant/registry.ts
  // engineOptions). "Play the champion" opens setup with it picked, through the
  // deep link landing-play.ts maybeOpenPlayDeepLink reads; the test checks setup
  // offers it, since setup ignores an id it does not offer.
  setupEngineId?: string;
  // Absent only where nothing public can be linked yet (Misty on Fog Xiangqi
  // and Xiangqi Mahjong; champions-page.test.ts names them).
  credits?: Credits;
  // Present once a challenger has taken the title; absent while it is open.
  reign?: Reign;
};

const JIEQI_MATCH: TitleMatch = { writeUpHref: '/blog/ab-jchess', gamesHref: '/data' };
// jqe took the jieqi title from AB-JChess 0.2d (mistboard-engine lab/jieqi-match,
// run jqe-vs-abj-0.2d, 2026-10-21) and held it until AB-JChess-20261031 took it back.
// The jqe write-up goes live on its own date (articles/publish-time.ts); before
// that the card links only the games and the bot. The test pins this date to
// the article's publishedAt.
export const JQE_WRITE_UP = { status: 'published', publishedAt: '2026-10-27' } as const;
const JQE_MATCH: TitleMatch = {
  ...(articleIsLive(JQE_WRITE_UP) ? { writeUpHref: '/blog/jqe' } : {}),
  gamesHref: '/study/3RQbr51i',
};
const JUNGLE_MATCH: TitleMatch = {
  writeUpHref: '/blog/katago-jungle',
  gamesHref: '/study/0t8xpyv6',
};

const PIKAFISH_CODE: Credit = {
  name: 'Pikafish',
  nameKey: 'champions.enginePikafish',
  href: PIKAFISH_REPO_URL,
};
// The CC0 Fairy-Stockfish xiangqi net prod pins for Pikafish
// (scripts/engine-assets.sh), credited like /source does.
const PIKAFISH_NET: Credit = {
  name: 'Pikafish NNUE',
  nameKey: 'champions.netPikafish',
  href: XIANGQI_CC0_NET_URL,
};

const MISTY = { holder: 'Misty', botHref: '/bot/misty' } as const;
// Misty is ours: a Misty card credits the public repo for that variant's engine,
// the one its article already links (banqi-engine, misty for Fog Chess,
// flip-jungle-skill-ceiling). Misty loads no separate net, so code only.
const mistyRepo = (repo: string): Credits => ({
  code: [{ name: repo, href: `https://github.com/brianhliou/${repo}` }],
});
// Duck and Crazyhouse Xiangqi run with NNUE off (duck-xiangqi-fsf-engine.ts,
// crazyhouse-xiangqi-fsf-engine.ts): code only.
const FAIRY_STOCKFISH_L8 = {
  holder: 'Fairy-Stockfish Level 8',
  holderKey: 'champions.engineFairyStockfish8',
  botHref: '/bot/fairy-stockfish-level-8',
  credits: {
    code: [{ name: 'Fairy-Stockfish', href: 'https://github.com/fairy-stockfish/Fairy-Stockfish' }],
  },
} as const satisfies Partial<Title>;

// AB-JChess-20261031 took the jieqi title back from jqe (mistboard-engine
// lab/jieqi-match/jqe-vs-abj-20261031, commit c01c608, 2026-10-31): 600 games at 4 s
// and 4 threads, 306-67-227 (a 0.566 score). The write-up (blog/ab-jchess-vs-jqe)
// goes live on its own date, as the jqe one did; the test pins this date to the
// article's publishedAt and status. The match's study (SwSUugEY) is linked from the post.
export const AB_JCHESS_2026_WRITE_UP = { status: 'published', publishedAt: '2026-11-04' } as const;
const AB_JCHESS_2026_MATCH: TitleMatch = articleIsLive(AB_JCHESS_2026_WRITE_UP)
  ? { writeUpHref: '/blog/ab-jchess-vs-jqe' }
  : {};
const JIEQI_AB_JCHESS_20261031: Title = {
  gameId: 'jieqi',
  nameKey: 'variant.jieqi.name',
  holder: 'AB-JChess',
  botHref: '/bot/ab-jchess',
  setupEngineId: 'ab-jchess-jieqi',
  // Built on jqe's MIT code. The net (abjchess-20261030.nnue) ships in the authors'
  // AB-JChess-20261031 release (scripts/fetch-abjchess-net.sh), never re-hosted.
  credits: {
    code: [{ name: 'AB-JChess', href: 'https://github.com/lxsgx23/AB-JChess' }],
    network: [
      {
        name: 'abjchess-20261030.nnue',
        href: 'https://github.com/lxsgx23/AB-JChess/releases/tag/AB-JChess-20261031',
      },
    ],
  },
  reign: {
    wins: 306,
    draws: 67,
    losses: 227,
    tookKey: 'champions.tookAbJchess2',
    about: (locale) => [t('champions.aboutAbJchess2', {}, locale)],
    ...AB_JCHESS_2026_MATCH,
  },
};

// No title match has been played. Rapfi is credited as the available engine,
// without asserting a holder or publishing the locally bundled network URL.
export const GOMOKU_OPEN_TITLE: Title = {
  gameId: 'gomoku',
  nameKey: 'variant.gomoku.name',
  setupEngineId: 'rapfi-level-8',
  credits: {
    code: [
      { name: 'Rapfi', href: RAPFI_REPO_URL },
      { name: 'Rapfi WASM', href: RAPFI_BUILD_URL },
    ],
  },
};

export const TITLES: readonly Title[] = [
  {
    gameId: 'xiangqi',
    nameKey: 'variant.xiangqi.name',
    holder: 'Pikafish',
    holderKey: 'champions.enginePikafish',
    botHref: '/bot/pikafish',
    credits: { code: [PIKAFISH_CODE], network: [PIKAFISH_NET] },
    // Title match xq-title-pikafish-vs-fsf-2026-11-11 on prod's engine queue: 40 games,
    // colours alternated, level 8 against Fairy-Stockfish level 8, 24.5/40.
    reign: {
      wins: 15,
      draws: 19,
      losses: 6,
      tookKey: 'champions.tookPikafish',
      gamesHref: '/study/Tf6bUHnC',
      about: (locale) => [t('champions.aboutPikafish', {}, locale)],
    },
  },
  JIEQI_AB_JCHESS_20261031,
  { gameId: 'banqi', nameKey: 'variant.banqi.name', ...MISTY, credits: mistyRepo('misty-banqi') },
  { gameId: 'duck-xiangqi', nameKey: 'variant.duckXiangqi.name', ...FAIRY_STOCKFISH_L8 },
  {
    gameId: 'crazyhouse-xiangqi',
    nameKey: 'variant.crazyhouseXiangqi.name',
    ...FAIRY_STOCKFISH_L8,
  },
  // The public misty repo is the Fog Chess engine only; the Fog Xiangqi
  // sibling is not published (articles/content/misty.ts), so no credit here.
  { gameId: 'dark-xiangqi', nameKey: 'variant.darkXiangqi.name', ...MISTY },
  {
    gameId: 'dark-chess',
    nameKey: 'variant.darkChess.name',
    ...MISTY,
    credits: mistyRepo('misty'),
  },
  {
    gameId: 'jungle',
    nameKey: 'variant.jungle.name',
    holder: 'KataGo-AnimalChess',
    botHref: '/bot/katago',
    setupEngineId: 'katago-jungle',
    // KataGomo is built on KataGo; the net is Kouza's, shipped in Dandelion 4
    // (scripts/fetch-katago-jungle-net.sh). Same three links as /bot/katago.
    credits: {
      code: [
        { name: 'KataGomo', href: 'https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025' },
        { name: 'KataGo', href: 'https://github.com/lightvector/KataGo' },
      ],
      network: [{ name: 'Dandelion 4', href: 'https://github.com/lxsgx23/Dandelion-Chess' }],
    },
    reign: {
      ...JUNGLE_MATCH,
      wins: 82,
      draws: 118,
      losses: 0,
      tookKey: 'champions.tookJungle',
      about: (locale) => [t('champions.aboutJungle', {}, locale)],
    },
  },
  {
    gameId: 'jungle-flip',
    nameKey: 'variant.jungleFlip.name',
    ...MISTY,
    credits: mistyRepo('misty-flip-jungle'),
  },
  // No public repo yet (#725).
  {
    gameId: 'xiangqi-mahjong',
    nameKey: 'variant.xiangqiMahjong.name',
    ...MISTY,
    credits: mistyRepo('misty-xiangqi-mahjong'),
  },
  ...(isPublicGameSpec('gomoku') ? [GOMOKU_OPEN_TITLE] : []),
];

export const CHAMPIONS = TITLES.filter((title) => title.reign);
export const OPEN_TITLES = TITLES.filter((title) => !title.reign);

// One line per title change, newest first.
export const TITLE_HISTORY: ReadonlyArray<TitleMatch & { textKey: I18nKey }> = [
  { ...AB_JCHESS_2026_MATCH, textKey: 'champions.historyAbJchess2' },
  { ...JQE_MATCH, textKey: 'champions.historyJqe' },
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
  return title.holderKey ? t(title.holderKey, {}, locale) : (title.holder ?? '');
}

// "Code  A, B" and "Network  C" rows, each name linked to its source.
function creditList(credits: Credits, locale: Locale): HTMLElement {
  const listEl = el('dl', 'champions-credits');
  const rows: Array<[I18nKey, readonly Credit[] | undefined]> = [
    ['champions.creditCode', credits.code],
    ['champions.creditNetwork', credits.network],
  ];
  for (const [labelKey, entries] of rows) {
    if (!entries || entries.length === 0) continue;
    const links: Part[] = [];
    for (const credit of entries) {
      if (links.length > 0) links.push(t('champions.linkSeparator', {}, locale));
      const name = credit.nameKey ? t(credit.nameKey, {}, locale) : credit.name;
      const href = typeof credit.href === 'string' ? credit.href : credit.href(locale);
      links.push(proseExternalLink(name, href));
    }
    listEl.append(
      el('div', 'champions-credit', [el('dt', '', [t(labelKey, {}, locale)]), el('dd', '', links)]),
    );
  }
  return listEl;
}

// Computer setup on the holder's variant with the holder picked.
function playHref(title: Title, locale: Locale): string {
  const params = new URLSearchParams({ play: 'computer', gameSpecId: title.gameId });
  if (title.setupEngineId) params.set('engineId', title.setupEngineId);
  return localizedHref(`/?${params}`, locale);
}

function button(label: string, href: string): HTMLAnchorElement {
  const a = proseLink(label, href);
  a.className = 'champions-btn';
  return a;
}

// "<text> (write-up, games)." for the history list, with only the links that exist.
function matchLine(locale: Locale, textKey: I18nKey, match: TitleMatch): Part[] {
  const links: Part[] = [];
  if (match.writeUpHref) {
    links.push(
      proseLink(t('champions.writeUpLink', {}, locale), localizedHref(match.writeUpHref, locale)),
    );
  }
  if (match.gamesHref) {
    if (links.length > 0) links.push(t('champions.linkSeparator', {}, locale));
    links.push(proseLink(t('champions.gamesLink', {}, locale), match.gamesHref));
  }
  if (links.length === 0) return [t(textKey, {}, locale), t('champions.lineEnd', {}, locale)];
  return [
    t(textKey, {}, locale),
    t('champions.parenOpen', {}, locale),
    ...links,
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

  // The name links to the holder's bot page, like a profile.
  const profileLink = proseLink(holderName(title, locale), title.botHref ?? '#challenge');
  profileLink.className = 'champions-hero-name-link';

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
      el('h3', 'champions-hero-name', [profileLink]),
    ]),
  ]);

  const actions = el('div', 'champions-actions', [
    ...(reign.writeUpHref
      ? [button(t('champions.readMatch', {}, locale), localizedHref(reign.writeUpHref, locale))]
      : []),
    ...(reign.gamesHref ? [button(t('champions.seeGames', {}, locale), reign.gamesHref)] : []),
    button(t('champions.playChampion', {}, locale), playHref(title, locale)),
  ]);

  card.append(
    head,
    scoreBlock(reign, locale),
    el('p', 'champions-took', [t(reign.tookKey, {}, locale)]),
    el('p', 'champions-about', reign.about(locale)),
    ...(title.credits ? [creditList(title.credits, locale)] : []),
    actions,
  );
  return card;
}

function openCard(title: Title, locale: Locale): HTMLElement {
  const card = el('article', 'champions-open');
  card.dataset.game = title.gameId;
  const holder = proseLink(holderName(title, locale), title.botHref ?? '#challenge');
  holder.className = 'champions-open-holder-link';
  card.append(
    el('div', 'champions-open-head', [
      marker(title.gameId, 26),
      el('h3', 'champions-open-game', [t(title.nameKey, {}, locale)]),
    ]),
    ...(title.holder
      ? [
          el('p', 'champions-open-holder', [
            el('span', 'champions-open-label', [t('champions.heldBy', {}, locale)]),
            holder,
          ]),
        ]
      : []),
    ...(title.credits ? [creditList(title.credits, locale)] : []),
    el('span', 'champions-open-badge', [t('champions.openBadge', {}, locale)]),
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

export function renderChampionsShellForPrerender(locale: Locale): Promise<string> {
  return prerenderMount(locale, mountChampions);
}
