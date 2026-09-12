// Shared profile-surface primitives. Player (/@handle) and bot (/bot/:id)
// profiles use the same dashboard, overview, tabs, and game rows, with only
// subject-specific identity, actions, and content passed into the slots.
// Engine profiles also retain the shared legacy header and game-row primitives.
import { maybeGameSpecForId } from '@mistboard/game';
import {
  displayParticipantName,
  type FeaturedGame,
  type GameParticipant,
  matchupSeats,
  participantForColor,
} from './game-display.js';
import { timeControlLabelForGame } from './game-meta.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { participantProfileTarget, playerNameEl } from './profile-link.js';
import { attachBotCard } from './profile-summary-card.js';
import { renderVariantMarker } from './variant-markers.js';
import { webVariantTenantForRoomId, webVariantTenantForSpecId } from './variant-tenant/registry.js';
import { variantMiniIdForRawVariant } from './variants.js';

export function buildProfileDashboard(
  ratings: HTMLElement,
  overview: HTMLElement,
  tabs: HTMLElement,
): HTMLElement {
  const center = document.createElement('div');
  center.className = 'profile-center';
  center.append(overview, tabs);

  const body = document.createElement('div');
  body.className = 'profile-body';
  body.append(ratings, center);
  return body;
}

export function buildProfileOverviewShell(opts: {
  identity: HTMLElement;
  actions?: HTMLElement | null;
  primary: HTMLElement;
  side: HTMLElement;
}): HTMLElement {
  const card = document.createElement('section');
  card.className = 'profile-overview';

  const top = document.createElement('div');
  top.className = 'profile-overview-top';
  top.append(opts.identity);
  if (opts.actions) top.append(opts.actions);

  const body = document.createElement('div');
  body.className = 'profile-overview-body';
  body.append(opts.primary, opts.side);

  card.append(top, body);
  return card;
}

export type ProfileTab = {
  label: string;
  panel: HTMLElement;
  count?: number;
  onActivate?: () => void;
};

export function buildProfileTabsShell(tabs: ProfileTab[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-tabs';

  const tabList = document.createElement('div');
  tabList.className = 'profile-tab-list';
  tabList.setAttribute('role', 'tablist');

  const buttons: HTMLButtonElement[] = [];
  tabs.forEach((tab, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-tab';
    button.id = `${tab.panel.id}-tab`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', tab.panel.id);
    button.setAttribute('aria-selected', String(index === 0));
    button.textContent = tab.label;
    if (tab.count != null) {
      const badge = document.createElement('span');
      badge.className = 'profile-tab-count';
      badge.textContent = String(tab.count);
      button.append(document.createTextNode(' '), badge);
    }

    tab.panel.hidden = index !== 0;
    tab.panel.setAttribute('role', 'tabpanel');
    tab.panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => {
      tabs.forEach((candidate, candidateIndex) => {
        const selected = candidateIndex === index;
        buttons[candidateIndex]?.setAttribute('aria-selected', String(selected));
        candidate.panel.toggleAttribute('hidden', !selected);
      });
      tab.onActivate?.();
    });
    buttons.push(button);
  });

  tabList.append(...buttons);
  section.append(tabList, ...tabs.map((tab) => tab.panel));
  return section;
}

const GAME_VARIANT_LABEL_KEY: Record<string, I18nKey> = {
  fog: 'variant.darkChess.name',
  'dark-chess': 'variant.darkChess.name',
  'dark-draft960': 'variant.darkDraft960.name',
  'fog-draft960': 'variant.darkDraft960.name',
  draft960: 'variant.darkDraft960.name',
  'mini-xiangqi': 'variant.miniXiangqi.name',
  'dark-mini-xiangqi': 'variant.darkMiniXiangqi.name',
  'dark-xiangqi': 'variant.darkXiangqi.name',
  banqi: 'variant.banqi.name',
  jieqi: 'variant.jieqi.name',
};

// Header shell: eyebrow + heading + a dot-separated meta line. Callers build the
// subject-specific meta spans (handle/joined/role for a user, id/games for an
// engine); the shell joins them with ' · ' so the markup matches across pages.
// `titleLead` slots an element inside the h1 before the title text (the player
// profile uses it for the lichess-style presence dot).
export function buildProfileHeaderShell(opts: {
  eyebrow: string;
  title: string;
  titleLead?: HTMLElement;
  metaParts: HTMLElement[];
  stats?: HTMLElement;
  actions?: HTMLElement;
}): HTMLElement {
  const header = document.createElement('section');
  header.className = 'profile-header';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'account-eyebrow';
  eyebrow.textContent = opts.eyebrow;

  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  if (opts.titleLead) title.append(opts.titleLead);
  title.append(document.createTextNode(opts.title));

  header.append(eyebrow, title);

  if (opts.metaParts.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'account-copy profile-header-meta';
    opts.metaParts.forEach((part, index) => {
      if (index > 0) meta.append(document.createTextNode(' · '));
      meta.append(part);
    });
    header.append(meta);
  }

  if (opts.actions) header.append(opts.actions);
  if (opts.stats) header.append(opts.stats);

  return header;
}

// One finished-game row from the subject's perspective (game.playerColor is the
// subject's seat). Works for a human or an engine seat alike.
export function buildProfileGameRow(
  game: FeaturedGame,
  opts: { locale?: Locale; neutral?: boolean; timeOnly?: boolean } = {},
): HTMLElement {
  const locale = opts.locale ?? currentLocale();
  const neutral = opts.neutral === true;
  const item = document.createElement('li');
  // The row is a DIV with a stretched overlay link rather than one big <a>,
  // because the opponent name inside it is itself a link to their profile and
  // an <a> inside an <a> is invalid: browsers close the outer anchor early and
  // the rest of the row silently stops being clickable. The overlay carries the
  // href and the accessible name; everything else is inert content, except the
  // opponent link, which is lifted above it (see .profile-game-row-open CSS).
  const link = document.createElement('div');
  link.className = 'profile-game-row';
  const open = document.createElement('a');
  open.className = 'profile-game-row-open';
  open.href = profileGameHref(game);
  // The overlay carries no text of its own, so it needs an explicit accessible
  // name; before the split the row's own content supplied one.
  open.setAttribute('aria-label', t('profile.finishedGame', {}, locale));
  const tone = neutral ? 'neutral' : profileResultTone(game);
  link.classList.add(`profile-game-row-${tone}`);

  const outcome = document.createElement('span');
  outcome.className = `profile-game-outcome profile-game-outcome-${tone}`;
  outcome.textContent = neutral ? '★' : profileResultLabel(game, locale);

  const body = document.createElement('span');
  body.className = 'profile-game-body';

  const topLine = document.createElement('span');
  topLine.className = 'profile-game-topline';

  const opponent = document.createElement('span');
  opponent.className = 'profile-game-opponent';
  if (neutral) {
    // Neutral rows have no subject seat, so BOTH names are opponents and both
    // get linked; the ' vs ' between them stays plain text.
    const [first, second] = matchupSeats(game);
    opponent.append(
      matchupNameEl(game, first),
      document.createTextNode(' vs '),
      matchupNameEl(game, second),
    );
  } else {
    // "vs " stays plain text and only the NAME is the link, so the click target
    // is the thing it addresses. Building the two spans by hand rather than
    // through t() with an interpolated name keeps the name a separate node.
    const participant = profileOpponentParticipant(game);
    const nameEl = playerNameEl(
      profileOpponentName(game, locale),
      participantProfileTarget(participant),
      'profile-game-opponent-name',
    );
    if (participant?.subjectType === 'bot' && participant.subjectId) {
      attachBotCard(nameEl, participant.subjectId);
    }
    appendWithNameNode(
      opponent,
      (token) => t('profile.vsOpponent', { opponent: token }, locale),
      nameEl,
    );
  }

  // Date rides its own right-aligned column (lichess game-row style) instead of
  // sharing the top line with the opponent name.
  const date = document.createElement('span');
  date.className = 'profile-game-date';
  date.textContent = opts.timeOnly
    ? formatGameTime(game.endedAt, locale)
    : formatGameDate(game.endedAt, locale);

  topLine.append(opponent);

  // Only a head-to-head human (pvp) game can ever be rated; anything vs an
  // engine, EvE, or imported is casual by definition. Gate on mode first so a
  // stray rated=true on a non-pvp row (e.g. legacy games backfilled by the
  // rated migration's DEFAULT true) never mislabels it. For pvp, trust the flag.
  const isCasual = game.mode !== 'pvp' || game.rated === false;
  const details = document.createElement('span');
  details.className = 'profile-game-details';
  // The variant pill leads with the shared variant marker (aria-hidden; the pill
  // still carries the variant name in text right after it).
  const variantPill = buildGameDetail(profileGameSpecLabel(game, locale), 'profile-game-variant');
  const variantMiniId = variantMiniIdForRawVariant(game.variant);
  if (variantMiniId) {
    const thumb = document.createElement('span');
    thumb.className = 'profile-game-variant-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    thumb.innerHTML = renderVariantMarker(variantMiniId, { size: 18 });
    variantPill.prepend(thumb);
  }
  details.append(variantPill);
  if (!neutral)
    details.append(buildGameDetail(profileSideLabel(game, locale), 'profile-game-side'));
  // Only rated games get a badge; casual (the default, and every game while
  // rated is gated off) stays untagged so the feed isn't littered with "Casual".
  if (!isCasual) details.append(buildGameDetail(t('play.rated', {}, locale), 'profile-game-rated'));
  // Time control sits with the leading fixed-width pills (see CSS) when present;
  // clockless games (engine self-play) simply omit it.
  const timeControl = timeControlLabelForGame(game);
  if (timeControl) details.append(buildGameDetail(timeControl, 'profile-game-tc'));
  details.append(
    buildGameDetail(sourceLabelForMode(game.mode, locale)),
    buildGameDetail(t('watch.plyCount', { count: game.plyCount }, locale)),
  );

  body.append(topLine, details);
  // The overlay goes in FIRST so it sits under the row content in paint order;
  // the opponent link then only needs a z-index to come back out on top.
  link.append(open, outcome, body, date);
  item.append(link);
  return item;
}

// One seat of a neutral row's "A vs B" pairing, linked when that seat has a
// page. Mirrors matchupLabel's halves, so the rendered text stays identical to
// the string it replaced.
function matchupNameEl(game: FeaturedGame, seat: GameParticipant['color']): HTMLElement {
  const participant = participantForColor(game, seat);
  const el = playerNameEl(
    displayParticipantName(game, seat),
    participantProfileTarget(participant),
    'profile-game-opponent-name',
  );
  if (participant?.subjectType === 'bot' && participant.subjectId) {
    attachBotCard(el, participant.subjectId);
  }
  return el;
}

// A sentinel no display name can contain, used to find where a translated
// template puts its name placeholder.
const NAME_SLOT = '\u0000';

/**
 * Render a translated one-placeholder template with a real ELEMENT in the
 * placeholder's position, so the name can be a link while the words around it
 * stay localized and in the locale's own order ('vs {opponent}' in English,
 * '对 {opponent}' in Chinese).
 *
 * `render` is the t() call with the placeholder left as the caller's token, so
 * this helper never has to reach into the catalog. If the template drops the
 * placeholder entirely, the node is appended bare rather than lost.
 */
function appendWithNameNode(
  host: HTMLElement,
  render: (token: string) => string,
  node: HTMLElement,
): void {
  const template = render(NAME_SLOT);
  const at = template.indexOf(NAME_SLOT);
  if (at < 0) {
    host.append(node);
    return;
  }
  const before = template.slice(0, at);
  const after = template.slice(at + NAME_SLOT.length);
  if (before) host.append(document.createTextNode(before));
  host.append(node);
  if (after) host.append(document.createTextNode(after));
}

function buildGameDetail(label: string, extraClass?: string): HTMLElement {
  const pill = document.createElement('span');
  pill.className = extraClass ? `profile-game-detail ${extraClass}` : 'profile-game-detail';
  pill.textContent = label;
  return pill;
}

function profileOpponentName(game: FeaturedGame, locale: Locale): string {
  const color = game.playerColor ?? 'white';
  return localizedSeatName(displayParticipantName(game, opponentColor(game, color)), locale);
}

function profileOpponentParticipant(game: FeaturedGame): GameParticipant | null {
  const color = game.playerColor ?? 'white';
  return participantForColor(game, opponentColor(game, color));
}

function profileSideLabel(game: FeaturedGame, locale: Locale): string {
  if (game.playerColor === 'red') return t('setup.red', {}, locale);
  if (game.playerColor === 'black') return t('setup.black', {}, locale);
  return t('setup.white', {}, locale);
}

export function profileGameSpecLabel(game: FeaturedGame, locale: Locale): string {
  // Legacy/alias variant strings the canonical spec map doesn't resolve, plus the
  // 'Dark Chess' casing this pill uses (the dark-chess spec publicName is the
  // lowercase 'Fog Chess'). Everything else derives from the canonical spec so a
  // new variant (banqi, jieqi, ...) is labelled without editing here.
  const key = GAME_VARIANT_LABEL_KEY[game.variant];
  if (key) return t(key, {}, locale);
  return maybeGameSpecForId(game.variant)?.publicName ?? t('variant.darkChess.name', {}, locale);
}

function profileResultLabel(game: FeaturedGame, locale: Locale): string {
  const tone = profileResultTone(game);
  if (tone === 'win') return t('result.win', {}, locale);
  if (tone === 'loss') return t('result.loss', {}, locale);
  return t('result.draw', {}, locale);
}

export function profileResultTone(game: FeaturedGame): 'win' | 'loss' | 'draw' {
  if (game.result === 'draw') return 'draw';
  if (game.playerColor === 'red') return game.result === 'red-wins' ? 'win' : 'loss';
  if (game.playerColor === 'black') return game.result === 'black-wins' ? 'win' : 'loss';
  return game.result === 'white-wins' ? 'win' : 'loss';
}

function formatGameDate(value: string | undefined, locale: Locale): string {
  if (!value) return t('profile.finishedGame', {}, locale);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('profile.finishedGame', {}, locale);
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// Time-only label for the date-grouped activity feed, where the day header
// already carries the date.
function formatGameTime(value: string | undefined, locale: Locale): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, { timeStyle: 'short' }).format(
    date,
  );
}

function sourceLabelForMode(mode: FeaturedGame['mode'], locale: Locale): string {
  if (mode === 'eve') return t('watch.engineVsEngine', {}, locale);
  if (mode === 'pve') return t('watch.humanVsEngine', {}, locale);
  if (mode === 'pvp') return t('watch.humanVsHuman', {}, locale);
  if (mode === 'imported') return t('profile.importedGame', {}, locale);
  if (mode === 'manual') return t('profile.manualGame', {}, locale);
  return t('profile.darkChessGame', {}, locale);
}

function localizedSeatName(name: string, locale: Locale): string {
  if (name === 'Red') return t('setup.red', {}, locale);
  if (name === 'White') return t('setup.white', {}, locale);
  if (name === 'Black') return t('setup.black', {}, locale);
  return name;
}

function opponentColor(
  game: FeaturedGame,
  color: FeaturedGame['playerColor'],
): 'white' | 'black' | 'red' {
  const [first, second] = matchupSeats(game);
  return color === first ? second : first;
}

// Every variant tenant owns its own postgame surface (<gameRouteBase>/:roomId)
// backed by a per-variant replay endpoint. Routing a non-chess game to the
// dark-chess /game/:id surface 403s: that loader hits /api/games/:id/events,
// whose chess-family reducer throws on a non-chess event log. So resolve the
// tenant from the registry (room-id prefix first, spec id as a fallback for
// legacy aliases) instead of a hand-maintained switch that silently drifts as
// variants ship. Tenants without their own postgame (dark-chess correspondence)
// and plain dark chess carry no gameRouteBase and fall through to /game/:id.
function profileGameHref(game: FeaturedGame): string {
  const tenant = webVariantTenantForRoomId(game.roomId) ?? webVariantTenantForSpecId(game.variant);
  if (tenant?.gameRouteBase) {
    return `${tenant.gameRouteBase}/${encodeURIComponent(game.roomId)}`;
  }
  return `/game/${encodeURIComponent(game.roomId)}`;
}
