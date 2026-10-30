// The engines on Mistboard that other people wrote, one entry each. /thanks
// renders a row per entry: who made it, what it plays, and its games and rating
// summed over every bot it runs (read live from /api/bots). Adding an engine is
// one entry here, in order of games played. Licence lines stay on /source.

import type { I18nKey } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';

export type EngineAuthor = {
  /** Who: a person, a team, or "X by Y" when an engine has several parts. */
  name: I18nKey;
  href: string;
};

export type EngineCredit = {
  id: string;
  /** The engine's own name, untranslated. */
  engine: string;
  authors: readonly EngineAuthor[];
  /** What it does on Mistboard, one sentence. */
  body: I18nKey;
  /** The first is its main variant: its icon and the rating the row shows. */
  gameSpecIds: readonly string[];
  /** Every bot it runs; the first is the bot page the row links to. */
  botIds: readonly string[];
};

const levels = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

export const ENGINE_CREDITS: readonly EngineCredit[] = [
  {
    id: 'pikafish',
    engine: 'Pikafish',
    authors: [{ name: 'thanks.pikafishAuthors', href: 'https://www.pikafish.com/' }],
    body: 'thanks.pikafishBody',
    gameSpecIds: ['xiangqi', 'jieqi'],
    botIds: ['pikafish', ...levels('pikafish-level-', 7)],
  },
  {
    id: 'ab-jchess',
    engine: 'AB-JChess',
    authors: [{ name: 'thanks.abJchessAuthors', href: 'https://github.com/lxsgx23/AB-JChess' }],
    body: 'thanks.abJchessBody',
    gameSpecIds: ['jieqi'],
    botIds: ['ab-jchess'],
  },
  {
    id: 'fairy-stockfish',
    engine: 'Fairy-Stockfish',
    authors: [
      {
        name: 'thanks.fairyStockfishAuthors',
        href: 'https://github.com/fairy-stockfish/Fairy-Stockfish',
      },
    ],
    body: 'thanks.fairyStockfishBody',
    gameSpecIds: ['xiangqi', 'duck-xiangqi', 'crazyhouse-xiangqi'],
    botIds: levels('fairy-stockfish-level-', 8),
  },
  {
    id: 'katago-jungle',
    engine: 'KataGo',
    authors: [
      {
        name: 'thanks.katagomoAuthor',
        href: 'https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025',
      },
      { name: 'thanks.katagoAuthor', href: 'https://github.com/lightvector/KataGo' },
      { name: 'thanks.dandelionAuthor', href: 'https://github.com/lxsgx23/Dandelion-Chess' },
    ],
    body: 'thanks.katagoBody',
    gameSpecIds: ['jungle'],
    botIds: ['katago'],
  },
];

// Pikafish's code, home page and NNUE weights licence (no commercial use without
// permission), the last in the reader's language where pikafish.com has one.
// /source and /champions both credit them from here.
export const PIKAFISH_REPO_URL = 'https://github.com/official-pikafish/Pikafish';
export const PIKAFISH_SITE_URL = 'https://pikafish.com/';
const PIKAFISH_WEIGHTS_LICENSE_URLS: Record<Locale, string> = {
  en: 'https://www.pikafish.com/en/list.html',
  'zh-Hans': 'https://www.pikafish.com/list.html',
  'zh-Hant': 'https://www.pikafish.com/zh-hant/list.html',
};

export function pikafishWeightsLicenseUrl(locale: Locale): string {
  return PIKAFISH_WEIGHTS_LICENSE_URLS[locale];
}
