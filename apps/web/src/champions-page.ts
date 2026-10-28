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

import { articleIsLive } from './articles/publish-time.js';
import { PIKAFISH_REPO_URL, pikafishWeightsLicenseUrl } from './engine-credits.js';
import { jqeEnabled } from './feature-flags.js';
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

// Either link may be missing while it is unpublished (jqe's write-up is the
// 2026-11-03 article); the card and the history line show only the ones there are.
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
  holder: string;
  holderKey?: I18nKey;
  // The holder's bot page (/bot/<id>, keyed by the /api/bots id). The card's
  // name links there like a profile. Every holder here has one on prod.
  botHref: string;
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
// run jqe-vs-abj-0.2d, 2026-10-21). It reigns only once jqe is the bot you play,
// so the swap rides VITE_JQE_ENABLED with the jieqi picker.
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
// The official net prod pins (scripts/engine-assets.sh), credited through
// pikafish.com's weights page like /source does.
const PIKAFISH_NET: Credit = {
  name: 'Pikafish NNUE',
  nameKey: 'champions.netPikafish',
  href: pikafishWeightsLicenseUrl,
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

const JIEQI_AB_JCHESS: Title = {
  gameId: 'jieqi',
  nameKey: 'variant.jieqi.name',
  holder: 'AB-JChess',
  botHref: '/bot/ab-jchess',
  setupEngineId: 'ab-jchess-jieqi',
  // A Pikafish fork. The net (abjchess-20261010.nnue) ships in the authors' v0.2d
  // release (scripts/fetch-abjchess-net.sh); its training code is the link the
  // AB-JChess article gives.
  credits: {
    code: [{ name: 'AB-JChess', href: 'https://github.com/lxsgx23/AB-JChess' }, PIKAFISH_CODE],
    network: [
      {
        name: 'AB-JChess NNUE',
        href: 'https://github.com/lxsgx23/AB-JChess/tree/main/abjchess-nnue-pytorch',
      },
    ],
  },
  reign: {
    ...JIEQI_MATCH,
    // AB-JChess won 248, lost 136, drew 16 (the write-up; a 0.64 score).
    wins: 248,
    draws: 16,
    losses: 136,
    tookKey: 'champions.tookJieqi',
    about: (locale) => [t('champions.aboutJieqi', {}, locale)],
  },
};

const JIEQI_JQE: Title = {
  gameId: 'jieqi',
  nameKey: 'variant.jieqi.name',
  holder: 'jqe',
  botHref: '/bot/jqe',
  // Offered in setup only in a VITE_JQE_ENABLED build, the same flag that
  // makes jqe the holder (registry.ts jieqiEngineOptions).
  setupEngineId: 'jqe-jieqi',
  // The net (engine/nets/it014.jqn) lives in the engine's own repository
  // (scripts/engine-assets.sh), so both rows link there.
  credits: {
    code: [{ name: 'jqe', href: 'https://github.com/devinokeefe/jieqi' }],
    network: [{ name: 'it014.jqn', href: 'https://github.com/devinokeefe/jieqi' }],
  },
  reign: {
    ...JQE_MATCH,
    // jqe won 171, lost 114, drew 15 over 150 paired deals (a 0.595 score).
    wins: 171,
    draws: 15,
    losses: 114,
    tookKey: 'champions.tookJqe',
    about: (locale) => [t('champions.aboutJqe', {}, locale)],
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
  },
  jqeEnabled() ? JIEQI_JQE : JIEQI_AB_JCHESS,
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
  { gameId: 'xiangqi-mahjong', nameKey: 'variant.xiangqiMahjong.name', ...MISTY },
];

export const CHAMPIONS = TITLES.filter((title) => title.reign);
export const OPEN_TITLES = TITLES.filter((title) => !title.reign);

// One line per title change, newest first.
export const TITLE_HISTORY: ReadonlyArray<TitleMatch & { textKey: I18nKey }> = [
  ...(jqeEnabled() ? [{ ...JQE_MATCH, textKey: 'champions.historyJqe' as const }] : []),
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
  const profileLink = proseLink(holderName(title, locale), title.botHref);
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
    ...(title.credits ? [creditList(title.credits, locale)] : []),
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
