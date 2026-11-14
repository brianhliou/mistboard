import type { RatingVariant } from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import './champion-crowns.css';

/** Web mirror of the public server Champion, without account identifiers. */
export type Championship = {
  readonly variant: RatingVariant;
  readonly timeClass: 'bullet' | 'blitz' | 'rapid' | 'correspondence';
};

export const CHAMPION_CROWN_IMAGE = '/champion-crown.png';
export const CHAMPION_CROWN_PLACEHOLDER = '◇';

export const RATING_VARIANT_LABEL_KEY: Record<RatingVariant, I18nKey> = {
  fog: 'variant.darkChess.name',
  dark_xiangqi: 'variant.darkXiangqi.name',
  jieqi: 'variant.jieqi.name',
  banqi: 'variant.banqi.name',
  three_kingdoms_banqi: 'variant.threeKingdomsBanqi.name',
  jungle: 'variant.jungle.name',
  jungle_flip: 'variant.jungleFlip.name',
  fortress_xiangqi: 'variant.fortressXiangqi.name',
  duck_xiangqi: 'variant.duckXiangqi.name',
  atomic_xiangqi: 'variant.atomicXiangqi.name',
  crazyhouse_xiangqi: 'variant.crazyhouseXiangqi.name',
  xiangqi: 'variant.xiangqi.name',
  // Rated, but allowlisted: the server keeps this pool off every profile, and
  // its VARIANTS entry stays out of PROFILE_VARIANT_ORDER until the spec is public.
  xiangqi_mahjong: 'variant.xiangqiMahjong.name',
  gomoku: 'variant.gomoku.name',
};

const PACE_LABEL_KEY: Record<Championship['timeClass'], I18nKey> = {
  bullet: 'live.timeClassBullet',
  blitz: 'live.timeClassBlitz',
  rapid: 'live.timeClassRapid',
  correspondence: 'setup.correspondence',
};

export function championLabel(
  championship: Championship,
  locale: Locale = currentLocale(),
): string {
  const pace = t(PACE_LABEL_KEY[championship.timeClass], {}, locale);
  return t(
    'profile.championLabel',
    {
      variant: t(RATING_VARIANT_LABEL_KEY[championship.variant], {}, locale),
      pace: locale === 'en' ? pace.toLowerCase() : pace,
    },
    locale,
  );
}

/** Every held title in one string, for the single crown beside a name. */
export function championsLabel(
  championships: readonly Championship[],
  locale: Locale = currentLocale(),
): string {
  const separator = locale === 'en' ? ', ' : '、';
  return championships.map((championship) => championLabel(championship, locale)).join(separator);
}

function buildChampionCrown(label: string, size: 16 | 20): HTMLImageElement {
  const icon = document.createElement('img');
  icon.className = 'champion-crown';
  icon.src = CHAMPION_CROWN_IMAGE;
  icon.width = size;
  icon.height = size;
  icon.alt = label;
  icon.title = label;
  icon.setAttribute('aria-label', label);
  icon.addEventListener(
    'error',
    () => {
      const fallback = document.createElement('span');
      fallback.className = 'champion-crown champion-crown--placeholder';
      fallback.style.width = `${size}px`;
      fallback.style.height = `${size}px`;
      fallback.title = label;
      fallback.setAttribute('role', 'img');
      fallback.setAttribute('aria-label', label);
      fallback.textContent = CHAMPION_CROWN_PLACEHOLDER;
      icon.replaceWith(fallback);
    },
    { once: true },
  );
  return icon;
}

export function buildChampionCrowns(
  championships: readonly Championship[] | null | undefined,
  { size = 20, locale = currentLocale() }: { size?: 16 | 20; locale?: Locale } = {},
): HTMLElement | null {
  if (!championships?.length) return null;
  const crowns = document.createElement('span');
  crowns.className = 'champion-crowns';
  // One crown however many ladders the player leads; the label lists them all.
  crowns.append(buildChampionCrown(championsLabel(championships, locale), size));
  return crowns;
}

/** Profiles spell out every held ladder; compact name surfaces use icons. */
export function buildProfileChampionships(
  championships: readonly Championship[] | null | undefined,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  if (!championships?.length) return null;
  const list = document.createElement('ul');
  list.className = 'profile-championships';
  for (const championship of championships) {
    const item = document.createElement('li');
    item.className = 'profile-championship';
    const text = document.createElement('span');
    const label = championLabel(championship, locale);
    text.textContent = label;
    item.append(buildChampionCrown(label, 20), text);
    list.append(item);
  }
  return list;
}
