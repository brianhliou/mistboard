// Names on the broadcast pages, in the reader's language.
//
// Ingestion keeps a source's own name (Chinese for a Chinese event) and caches
// an English form (nameEn) beside it, on tours, players, teams and matches. A
// page shows the one its locale reads and never both: an English reader of the
// league saw 张彬 under Zhang Bin, a Chinese reader saw Zhang Bin over 张彬.
// The other form is a tooltip at most (otherName).
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';

type Named = { name: string; nameEn?: string | null };

function english(entity: Named): string | undefined {
  return entity.nameEn?.trim() || undefined;
}

/** The name the locale reads: English for `en`, the source's own otherwise. */
export function localName(entity: Named, locale: Locale = currentLocale()): string {
  const name = locale === 'en' ? (english(entity) ?? entity.name) : entity.name;
  return localRoundName(name, locale);
}

/** The form the page does not show, for a tooltip; null when there is only one. */
export function otherName(entity: Named, locale: Locale = currentLocale()): string | null {
  const en = english(entity);
  if (!en || en === entity.name) return null;
  return locale === 'en' ? entity.name : en;
}

export function localFederation(
  player: { federation?: string; federationEn?: string },
  locale: Locale = currentLocale(),
): string | undefined {
  const en = player.federationEn?.trim();
  const own = player.federation?.trim();
  return (locale === 'en' ? en || own : own || en) || undefined;
}

// Rounds are stored as "Round 9" whatever the source's language.
const ROUND = /^Round (\d+)$/;

export function localRoundName(name: string, locale: Locale = currentLocale()): string {
  const match = ROUND.exec(name.trim());
  return match ? t('broadcast.roundNumber', { n: Number(match[1]) }, locale) : name;
}

/** "3 rounds", "3 轮": Chinese has no plural, so only English reads the One key. */
export function countText(
  count: number,
  key: 'broadcast.roundCount' | 'broadcast.boardCount' | 'broadcast.gameCount',
  locale: Locale = currentLocale(),
): string {
  return t(count === 1 ? `${key}One` : key, { count }, locale);
}

// Chinese xiangqi writes titles in Chinese: 特大 (特级大师) for GM, 大师 for the
// CXA's national master. A WXF title borrows the same words. An unknown feed
// tag shows as stored.
const TITLES: Record<string, [hans: string, hant: string]> = {
  GM: ['特大', '特大'],
  IM: ['国际大师', '國際大師'],
  NM: ['大师', '大師'],
};

export function localTitle(title: string, locale: Locale = currentLocale()): string {
  if (locale === 'en') return title;
  const zh = TITLES[title.trim()];
  return zh ? zh[locale === 'zh-Hant' ? 1 : 0] : title;
}

// Tour locations are stored in English; calendar rows from dpxq carry its own
// Chinese place line (a city, often a hotel or venue in it). These are the
// places events have been held. An unlisted place shows as stored, except
// that English never shows a Chinese place it cannot name.
const PLACES: Record<string, [hans: string, hant: string]> = {
  Changchun: ['长春', '長春'],
  Hangzhou: ['杭州', '杭州'],
  Liaocheng: ['聊城', '聊城'],
  Houston: ['休斯敦', '休士頓'],
  'Monterey Park, California': ['加州蒙特利公园', '加州蒙特利公園'],
  Philippines: ['菲律宾', '菲律賓'],
  Shanghai: ['上海', '上海'],
  Singapore: ['新加坡', '新加坡'],
  Suifenhe: ['绥芬河', '綏芬河'],
  Zhangjiakou: ['张家口', '張家口'],
  'Đà Nẵng, Vietnam': ['越南岘港', '越南峴港'],
};

export function localPlace(
  location: string | undefined,
  locale: Locale = currentLocale(),
): string | undefined {
  if (!location) return undefined;
  if (/\p{Script=Han}/u.test(location)) {
    if (locale !== 'en') return location;
    return englishPlaceIn(location);
  }
  if (locale === 'en') return location;
  const zh = PLACES[location.trim()];
  return zh ? zh[locale === 'zh-Hant' ? 1 : 0] : location;
}

// The English name of the listed place a Chinese place line names: 上海南翔温德姆酒店
// -> Shanghai, 吉林长春 -> Changchun. The longest match wins.
function englishPlaceIn(location: string): string | undefined {
  let best: [en: string, length: number] | undefined;
  for (const [en, names] of Object.entries(PLACES)) {
    for (const zh of names) {
      if (location.includes(zh) && (!best || zh.length > best[1])) best = [en, zh.length];
    }
  }
  return best?.[0];
}
