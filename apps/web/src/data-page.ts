import type { Locale } from './i18n/locale.js';
import { prerenderMount } from './prerender-copy.js';
// /data: monthly downloads of every finished game played on Mistboard
// (lichess's database.lichess.org). The listing comes from
// GET /api/data; each file is built on the server the first time anyone
// downloads it (apps/server/src/game-data-files.ts), so a file shows its game
// count from the start and its size and SHA-256 once it exists.
//
// Layout: the variant rail shared with /games and /games/search (chips on a
// phone), "All variants" first and the default; one compact table for the
// selected variant with a row per month; then the licence line. The notes on
// the files live on their own page, /data/about (mountDataAbout below). The
// selection lives in ?variant= so a link can be shared. Below the human games,
// the selected variant's engine games (#488: the site's bots playing each other
// on a schedule) get their own table of their own files. Imported engine
// matches still download from /api/data/collections/..., linked from their
// studies, but are not listed here.

import './current-games.css';
import './data-page.css';
import { BOT_OPPONENTS, botOpponentForBotId } from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, localizedHref } from './i18n/locale.js';
import { buildNav, buildNotice } from './site-shell.js';
import { buildUiIcon } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import { WATCH_CHANNEL_MINI_IDS } from './watch-channel-markers.js';

export type DataFileFormat = 'jsonl' | 'pgn';

export type DataFileEntry = {
  format: DataFileFormat;
  path: string;
  fileName: string;
  games: number;
  built: { bytes: number; sha256: string; builtAt: string } | null;
};

export type DataMonthVariant = { variant: string; games: number; files: DataFileEntry[] };
export type DataMonth = {
  month: string;
  games: number;
  /** The all-variants file of the month (JSONL). */
  files: DataFileEntry[];
  variants: DataMonthVariant[];
};

export type DataCollection = {
  id: string;
  event: string;
  credit: { work: string; authors: string[]; url?: string; permission?: boolean } | null;
  variant: string;
  games: number;
  firstStartedAt: string;
  lastEndedAt: string;
  files: DataFileEntry[];
};

export type DataListing = {
  license: string;
  schemaVersion: string;
  variants: string[];
  months: DataMonth[];
  /** The scheduled engine games' months, their own files. Absent from older responses. */
  engineMonths?: DataMonth[];
  collections: DataCollection[];
  bots?: Array<{ id: string; displayName: string; variants: string[] }>;
  botId?: string;
  /** Set when the listing covers every listed level of one opponent (?opponent=). */
  opponentId?: string;
  /** Every variant with downloads, games or not yet; the rail lists all of them. */
  offeredVariants?: string[];
  /** A variant whose games are all in the open month: the month its first file covers. */
  firstArchives?: Array<{ variant: string; month: string }>;
  /** Launched variants with no downloads, and why. */
  unavailableVariants?: Array<{ variant: string; reason: 'no-export' }>;
};

export const ALL_VARIANTS = 'all';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

export async function mountDataPage(root: HTMLElement): Promise<void> {
  root.classList.add('landing-page', 'data-route');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section current-games-shell data-shell';

  const header = document.createElement('header');
  header.className = 'current-games-header';
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('data.heading');
  const subtitle = document.createElement('p');
  subtitle.className = 'current-games-subtitle';
  subtitle.textContent = t('data.subtitle');
  const countLine = document.createElement('p');
  countLine.className = 'current-games-count';
  const aboutLine = document.createElement('p');
  aboutLine.className = 'current-games-subtitle data-about-link';
  aboutLine.append(internalLink(t('data.aboutLink'), '/data/about'));
  header.append(heading, subtitle, aboutLine, countLine);

  const layout = document.createElement('div');
  layout.className = 'current-games-layout';
  const rail = document.createElement('nav');
  rail.className = 'current-games-rail';
  rail.setAttribute('aria-label', t('data.variantsLabel'));
  const mainCol = document.createElement('div');
  mainCol.className = 'data-main';
  const monthsHost = document.createElement('section');
  monthsHost.className = 'data-months';
  monthsHost.setAttribute('aria-live', 'polite');
  mainCol.append(monthsHost, buildCredit());
  layout.append(rail, mainCol);
  shell.append(header, layout);
  root.append(shell);

  let listing = await fetchListing();
  if (!root.isConnected) return;
  if (!listing) {
    monthsHost.replaceChildren(buildNotice(t('data.unavailable'), t('data.subtitle')));
    return;
  }

  // Opponent first, then (for a ladder) its level: "All levels" is the
  // server's union of every listed level (?opponent=), a level is one bot
  // (?bot=), as on /bots.
  const botFilter = document.createElement('div');
  botFilter.className = 'data-bot-filter';
  const botLabel = document.createElement('label');
  const botLabelText = document.createElement('span');
  botLabelText.textContent = t('data.botFilter');
  const botSelect = document.createElement('select');
  botSelect.setAttribute('aria-label', t('data.botFilter'));
  botLabel.append(botLabelText, botSelect);
  const levelSelect = document.createElement('select');
  levelSelect.className = 'data-level-select';
  levelSelect.setAttribute('aria-label', t('data.levelFilter'));
  botFilter.append(botLabel, levelSelect);
  header.append(botFilter);

  let variant = readVariant(listing);
  let requestSequence = 0;
  async function reloadListing(): Promise<void> {
    const sequence = ++requestSequence;
    const next = await fetchListing();
    if (sequence !== requestSequence || !root.isConnected) return;
    if (!next) {
      monthsHost.replaceChildren(buildNotice(t('data.unavailable'), t('data.subtitle')));
      return;
    }
    listing = next;
    variant = readVariant(listing);
    render();
  }
  function writeScope(scope: { bot?: string; opponent?: string }): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('bot');
    url.searchParams.delete('opponent');
    if (scope.opponent) url.searchParams.set('opponent', scope.opponent);
    else if (scope.bot) url.searchParams.set('bot', scope.bot);
    window.history.pushState(null, '', url);
    void reloadListing();
  }
  botSelect.addEventListener('change', () => {
    const choice = listing
      ? dataOpponents(listing).find((opponent) => opponent.key === botSelect.value)
      : null;
    if (!choice) return writeScope({});
    if (choice.levelled) writeScope({ opponent: choice.key });
    else writeScope({ bot: choice.members[0]!.botId });
  });
  levelSelect.addEventListener('change', () => {
    if (levelSelect.value) writeScope({ bot: levelSelect.value });
    else writeScope({ opponent: botSelect.value });
  });
  const render = (): void => {
    if (!listing) return;
    renderCount(countLine, listing);
    const opponents = dataOpponents(listing);
    const selection = selectedOpponent(listing, opponents);
    botSelect.replaceChildren(
      option('', t('data.allBots')),
      ...opponents.map((opponent) => option(opponent.key, opponent.name)),
    );
    botSelect.value = selection?.opponent.key ?? '';
    levelSelect.hidden = !selection?.opponent.levelled;
    if (selection?.opponent.levelled) {
      levelSelect.replaceChildren(
        option('', t('data.allLevels')),
        ...selection.opponent.members.map((member) =>
          option(member.botId, t('bots.levelName', { level: member.level ?? 0 })),
        ),
      );
      levelSelect.value = selection.botId ?? '';
    } else {
      levelSelect.replaceChildren();
    }
    botFilter.hidden = opponents.length === 0;

    renderRail(rail, listing, variant, (next) => {
      variant = next;
      writeVariant(next);
      render();
    });
    for (const link of rail.querySelectorAll<HTMLAnchorElement>('a')) {
      if (!listing.botId && !listing.opponentId) continue;
      const url = new URL(link.href);
      if (listing.opponentId) url.searchParams.set('opponent', listing.opponentId);
      else if (listing.botId) url.searchParams.set('bot', listing.botId);
      link.href = `${url.pathname}${url.search}`;
    }
    renderMonths(monthsHost, listing, variant, onDownload);
  };

  // A first download builds the file; read the listing again shortly after so
  // its size and checksum appear without a reload.
  let refreshTimer: number | null = null;
  function onDownload(): void {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = null;
      await reloadListing();
    }, 4000);
  }

  window.addEventListener('popstate', () => {
    if (!root.isConnected || !listing) return;
    void reloadListing();
  });
  render();
}

async function fetchListing(): Promise<DataListing | null> {
  try {
    const params = new URLSearchParams(window.location.search);
    const opponentId = params.get('opponent');
    const botId = params.get('bot');
    const path = opponentId
      ? `/api/data?opponent=${encodeURIComponent(opponentId)}`
      : botId
        ? `/api/data?bot=${encodeURIComponent(botId)}`
        : '/api/data';
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as DataListing;
  } catch {
    return null;
  }
}

type RailListing = Pick<DataListing, 'variants' | 'offeredVariants' | 'unavailableVariants'>;

/** ?variant= when it names a variant on the rail; anything else is All, as on /games/search. */
export function readVariant(listing: RailListing, search = window.location.search): string {
  const raw = new URLSearchParams(search).get('variant');
  return raw && railVariants(listing).some((entry) => entry.variant === raw) ? raw : ALL_VARIANTS;
}

/** The rail after All: every offered variant (with games or not yet), then
 *  the launched variants that have no downloads, muted. */
export function railVariants(
  listing: RailListing,
): Array<{ variant: string; unavailable: boolean }> {
  return [
    ...(listing.offeredVariants ?? listing.variants).map((variant) => ({
      variant,
      unavailable: false,
    })),
    ...(listing.unavailableVariants ?? []).map(({ variant }) => ({ variant, unavailable: true })),
  ];
}

// ── Opponent selector ────────────────────────────────────────────────────────

export type DataOpponent = {
  key: string;
  name: string;
  levelled: boolean;
  members: Array<{ botId: string; level: number | null }>;
};

/** The selector's opponents: the bot-opponents map's (in its order) with the
 *  levels this listing has, then any listed bot outside the map. */
export function dataOpponents(listing: Pick<DataListing, 'bots'>): DataOpponent[] {
  const bots = listing.bots ?? [];
  const listed = new Map(bots.map((bot) => [bot.id, bot]));
  const opponents: DataOpponent[] = [];
  for (const opponent of BOT_OPPONENTS) {
    const members = opponent.members.filter((member) => listed.has(member.botId));
    if (members.length === 0) continue;
    opponents.push({
      key: opponent.id,
      name: members.length === 1 ? listed.get(members[0]!.botId)!.displayName : opponent.name,
      levelled: members.length > 1,
      members: members.map((member) => ({ botId: member.botId, level: member.level })),
    });
  }
  for (const bot of bots) {
    if (botOpponentForBotId(bot.id)) continue;
    opponents.push({
      key: bot.id,
      name: bot.displayName,
      levelled: false,
      members: [{ botId: bot.id, level: null }],
    });
  }
  return opponents;
}

/** Which opponent (and level) the listing is for: ?opponent= is all levels, a
 *  ?bot= (old ids included; the server answers with the current one) is its
 *  opponent at that level. */
export function selectedOpponent(
  listing: Pick<DataListing, 'botId' | 'opponentId'>,
  opponents: readonly DataOpponent[],
): { opponent: DataOpponent; botId: string | null } | null {
  if (listing.opponentId) {
    const opponent = opponents.find((entry) => entry.key === listing.opponentId);
    return opponent ? { opponent, botId: null } : null;
  }
  if (!listing.botId) return null;
  const key = botOpponentForBotId(listing.botId)?.opponent.id ?? listing.botId;
  const opponent = opponents.find((entry) => entry.key === key);
  if (!opponent) return null;
  return { opponent, botId: opponent.levelled ? listing.botId : null };
}

function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

function writeVariant(variant: string): void {
  const url = new URL(window.location.href);
  if (variant === ALL_VARIANTS) url.searchParams.delete('variant');
  else url.searchParams.set('variant', variant);
  window.history.pushState(null, '', url);
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatCount(value: number): string {
  return new Intl.NumberFormat(currentLocale()).format(value);
}

function gamesLabel(count: number): string {
  return count === 1
    ? t('data.gamesOne', { count: formatCount(count) })
    : t('data.gamesMany', { count: formatCount(count) });
}

export function formatMonth(month: string, locale: string = currentLocale()): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

export function formatBytes(bytes: number, locale: string = currentLocale()): string {
  const units: Array<[number, string]> = [
    [1024 ** 3, 'gigabyte'],
    [1024 ** 2, 'megabyte'],
    [1024, 'kilobyte'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: bytes / size < 10 ? 1 : 0,
      }).format(bytes / size);
    }
  }
  return `${new Intl.NumberFormat(locale).format(bytes)} B`;
}

function formatName(format: DataFileFormat): string {
  return format === 'pgn' ? 'PGN' : 'JSONL';
}

/** "2026-10" for the month in progress (UTC), the one not offered yet. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Header and rail ──────────────────────────────────────────────────────────

function isScoped(listing: DataListing): boolean {
  return Boolean(listing.botId || listing.opponentId);
}

function headlineMonths(listing: DataListing): DataMonth[] {
  return isScoped(listing) ? [...listing.months, ...(listing.engineMonths ?? [])] : listing.months;
}

function renderCount(el: HTMLElement, listing: DataListing): void {
  const counted = headlineMonths(listing);
  const games = counted.reduce((sum, month) => sum + month.games, 0);
  const months = new Set(counted.map((month) => month.month)).size;
  el.textContent = t(months === 1 ? 'data.countOneMonth' : 'data.countManyMonths', {
    games: gamesLabel(games),
    months: formatCount(months),
  });
}

function variantTotals(listing: DataListing): Map<string, number> {
  const totals = new Map<string, number>();
  for (const month of headlineMonths(listing)) {
    for (const row of month.variants)
      totals.set(row.variant, (totals.get(row.variant) ?? 0) + row.games);
  }
  return totals;
}

function renderRail(
  rail: HTMLElement,
  listing: DataListing,
  active: string,
  select: (variant: string) => void,
): void {
  rail.replaceChildren();
  const totals = variantTotals(listing);
  const all = railLink(
    ALL_VARIANTS,
    t('data.allVariants'),
    [...totals.values()].reduce((a, b) => a + b, 0),
  );
  all
    .querySelector('.current-games-rail-thumb')
    ?.append(buildUiIcon('featured-channel', 'current-games-rail-crown'));
  const links = [all];
  for (const { variant, unavailable } of railVariants(listing)) {
    const link = railLink(
      variant,
      variantDisplayLabel(variant),
      unavailable ? null : (totals.get(variant) ?? 0),
    );
    if (unavailable) link.classList.add('is-quiet', 'is-unavailable');
    const thumb = link.querySelector<HTMLElement>('.current-games-rail-thumb');
    const miniId = WATCH_CHANNEL_MINI_IDS[variant];
    if (thumb && miniId) {
      thumb.classList.add('notranslate');
      thumb.setAttribute('translate', 'no');
      thumb.innerHTML = renderVariantMarker(miniId, { size: 112 });
    }
    links.push(link);
  }
  for (const link of links) {
    const id = link.dataset.variant!;
    if (id === active) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (id !== active) select(id);
    });
  }
  rail.append(...links);
}

function railLink(variant: string, label: string, count: number | null): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'current-games-rail-link';
  link.dataset.variant = variant;
  link.href = variant === ALL_VARIANTS ? '/data' : `/data?variant=${encodeURIComponent(variant)}`;
  const text = document.createElement('span');
  text.className = 'current-games-rail-text';
  const name = document.createElement('span');
  name.className = 'current-games-rail-name';
  name.textContent = label;
  const countEl = document.createElement('span');
  countEl.className = 'current-games-rail-count';
  countEl.textContent = count === null ? '' : formatCount(count);
  text.append(name, countEl);
  const thumb = document.createElement('span');
  thumb.className = 'current-games-rail-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  link.append(text, thumb);
  return link;
}

// ── Tables ───────────────────────────────────────────────────────────────────

function sectionHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement('h2');
  heading.className = 'data-section-heading';
  heading.textContent = text;
  return heading;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'data-muted data-note';
  p.textContent = text;
  return p;
}

/** The month rows of the selected variant, newest first: the human games'
 *  files, or with `engine` the engine games' own. */
export function monthRows(
  listing: DataListing,
  variant: string,
  games: 'human' | 'engine' = 'human',
): Array<{ month: string; games: number; files: DataFileEntry[] }> {
  const months = games === 'engine' ? (listing.engineMonths ?? []) : listing.months;
  if (variant === ALL_VARIANTS) {
    return months.map((month) => ({
      month: month.month,
      games: month.games,
      files: month.files,
    }));
  }
  const rows: Array<{ month: string; games: number; files: DataFileEntry[] }> = [];
  for (const month of months) {
    const row = month.variants.find((entry) => entry.variant === variant);
    if (row) rows.push({ month: month.month, games: row.games, files: row.files });
  }
  return rows;
}

function dataTable(firstColumn: I18nKey): {
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const table = document.createElement('table');
  table.className = 'data-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const columns: Array<[I18nKey, string]> = [
    [firstColumn, 'data-col-name'],
    ['data.colGames', 'data-col-games'],
    ['data.colDownload', 'data-col-download'],
    ['data.colHash', 'data-col-hash'],
  ];
  for (const [key, className] of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = className;
    th.textContent = t(key);
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  table.append(head, body);
  return { table, body };
}

function tableRow(
  name: Node[],
  games: number,
  files: DataFileEntry[],
  onDownload: () => void,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  const nameCell = document.createElement('th');
  nameCell.scope = 'row';
  nameCell.className = 'data-col-name';
  nameCell.append(...name);
  const gamesCell = document.createElement('td');
  gamesCell.className = 'data-col-games';
  gamesCell.textContent = formatCount(games);
  gamesCell.setAttribute('data-label', gamesLabel(games));
  const downloadCell = document.createElement('td');
  downloadCell.className = 'data-col-download';
  const buttons = document.createElement('div');
  buttons.className = 'data-downloads';
  for (const file of files) buttons.append(downloadLink(file, onDownload));
  downloadCell.append(buttons);
  const hashCell = document.createElement('td');
  hashCell.className = 'data-col-hash';
  // An unbuilt file has no size or checksum yet: say so rather than show a
  // blank, and never make one up.
  const built = files.filter((file) => file.built);
  if (built.length === 0) {
    hashCell.textContent = t('data.notBuilt');
    hashCell.classList.add('is-pending');
  } else {
    for (const file of files) {
      hashCell.append(
        file.built ? hashLine(file, files.length > 1) : pendingLine(file, files.length > 1),
      );
    }
  }
  row.append(nameCell, gamesCell, downloadCell, hashCell);
  return row;
}

function downloadLink(file: DataFileEntry, onDownload: () => void): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'data-download';
  link.href = file.path;
  link.setAttribute('download', file.fileName);
  link.setAttribute(
    'aria-label',
    t('data.downloadLabel', { format: formatName(file.format), file: file.fileName }),
  );
  const format = document.createElement('span');
  format.className = 'data-download-format';
  format.textContent = formatName(file.format);
  link.append(format);
  if (file.built) {
    const size = document.createElement('span');
    size.className = 'data-download-size';
    size.textContent = formatBytes(file.built.bytes);
    link.append(size);
  } else {
    link.addEventListener('click', onDownload);
  }
  return link;
}

// One small button per built file: the hash's first characters, copying the
// whole hash. With two files on a row the format names which is which.
function hashLine(file: DataFileEntry, labelled: boolean): HTMLElement {
  const sha = file.built!.sha256;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'data-hash';
  button.title = sha;
  button.setAttribute('aria-label', t('data.copyHash', { format: formatName(file.format) }));
  if (labelled) {
    const label = document.createElement('span');
    label.className = 'data-hash-format';
    label.textContent = formatName(file.format);
    button.append(label);
  }
  const code = document.createElement('code');
  code.textContent = sha.slice(0, 7);
  const status = document.createElement('span');
  status.className = 'data-hash-copy';
  status.textContent = t('data.copy');
  button.append(code, status);
  wireCopy(button, status, sha);
  return button;
}

function pendingLine(file: DataFileEntry, labelled: boolean): HTMLElement {
  const line = document.createElement('span');
  line.className = 'data-hash-pending';
  line.textContent = labelled
    ? t('data.notBuiltFormat', { format: formatName(file.format) })
    : t('data.notBuilt');
  return line;
}

function copyButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'data-copy';
  button.textContent = t('data.copy');
  button.setAttribute('aria-label', label);
  wireCopy(button, button, text);
  return button;
}

// Clipboard access can be denied; say so rather than doing nothing.
function wireCopy(button: HTMLButtonElement, status: HTMLElement, text: string): void {
  button.addEventListener('click', () => {
    const done = (key: I18nKey) => {
      status.textContent = t(key);
      window.setTimeout(() => {
        status.textContent = t('data.copy');
      }, 1600);
    };
    if (!navigator.clipboard) return done('data.copyFailed');
    navigator.clipboard.writeText(text).then(
      () => done('data.copied'),
      () => done('data.copyFailed'),
    );
  });
}

function monthName(month: string): Node[] {
  const span = document.createElement('span');
  span.className = 'data-row-title';
  span.textContent = formatMonth(month);
  return [span];
}

function renderMonths(
  host: HTMLElement,
  listing: DataListing,
  variant: string,
  onDownload: () => void,
): void {
  const label = variant === ALL_VARIANTS ? t('data.allVariants') : variantDisplayLabel(variant);
  host.replaceChildren(sectionHeading(label));
  const unavailable = listing.unavailableVariants?.find((entry) => entry.variant === variant);
  if (unavailable) {
    host.append(note(t('data.unavailableNone', { variant: label })), searchLink(listing, variant));
    return;
  }
  if (variant === ALL_VARIANTS) host.append(note(t('data.allVariantsNote')));
  const rows = monthRows(listing, variant);
  const engineRows = monthRows(listing, variant, 'engine');
  if (rows.length === 0) {
    const first = listing.firstArchives?.find((entry) => entry.variant === variant);
    if (first && engineRows.length === 0) {
      host.append(
        note(
          t('data.firstArchive', {
            variant: label,
            month: formatMonth(first.month),
            date: formatDay(monthAfter(first.month)),
          }),
        ),
      );
    } else if (!isScoped(listing) || engineRows.length === 0) {
      host.append(note(t('data.noMonths')));
    }
  } else {
    const { table, body } = dataTable('data.colMonth');
    for (const row of rows)
      body.append(tableRow(monthName(row.month), row.games, row.files, onDownload));
    host.append(table);
  }
  // Each unbuilt file says in its own row when its size and checksum come.
  host.append(
    note(t('data.currentMonthNote', { month: formatMonth(currentMonthKey()) })),
    searchLink(listing, variant),
  );
  // The engine games, only where there are some: their own heading, note and
  // table, after everything about the human files.
  if (engineRows.length > 0) {
    const { table, body } = dataTable('data.colMonth');
    table.classList.add('data-table-engine');
    for (const row of engineRows)
      body.append(tableRow(monthName(row.month), row.games, row.files, onDownload));
    host.append(sectionHeading(t('data.engineHeading')), note(t('data.engineNote')), table);
  }
}

/** The same games one at a time on /games/search, with the filters both pages
 *  share (variant, games played here). A bot or level filter has no search
 *  equivalent, so a scoped listing gets no link rather than a wider one. */
export function searchHref(listing: DataListing, variant: string): string | null {
  if (isScoped(listing)) return null;
  const params = new URLSearchParams();
  if (variant !== ALL_VARIANTS) params.set('variant', variant);
  params.set('source', 'mistboard');
  return `/games/search?${params.toString()}`;
}

function searchLink(listing: DataListing, variant: string): Node {
  const href = searchHref(listing, variant);
  if (!href) return document.createTextNode('');
  const p = document.createElement('p');
  p.className = 'data-muted data-note data-search-link';
  p.append(internalLink(t('data.searchLink'), href));
  return p;
}

/** "2026-12" for "2026-11". */
export function monthAfter(month: string): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}

function formatDay(month: string, locale: string = currentLocale()): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

// ── Licence credit and About the data ────────────────────────────────────────

function paragraph(...parts: Array<string | Node>): HTMLParagraphElement {
  const p = document.createElement('p');
  p.append(...parts);
  return p;
}

function internalLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = localizedHref(href);
  a.textContent = text;
  return a;
}

function externalLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  a.target = '_blank';
  a.textContent = text;
  return a;
}

/** Always visible: the licence in one line and the credit to copy. */
function buildCredit(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'data-license';
  section.append(
    paragraph(
      t('data.licensePrefix'),
      externalLink(t('privacy.ccByLink'), CC_BY_URL),
      t('data.licenseSuffix'),
    ),
  );
  section.append(citeBlock());
  return section;
}

function citeBlock(): HTMLElement {
  const cite = document.createElement('div');
  cite.className = 'data-cite';
  const text = document.createElement('span');
  text.textContent = t('data.citation');
  cite.append(text, copyButton(t('data.citation'), t('data.copyCitation')));
  return cite;
}

const FIELD_ROWS: ReadonlyArray<[string, I18nKey]> = [
  ['game_id, source.game_url', 'data.fieldGame'],
  ['variant, mode', 'data.fieldVariant'],
  ['players', 'data.fieldPlayers'],
  ['time_control', 'data.fieldTimeControl'],
  ['started_at, ended_at', 'data.fieldTimes'],
  ['result, termination', 'data.fieldResult'],
  ['plies', 'data.fieldPlies'],
  ['first_mover_ink', 'data.fieldInk'],
  ['deal_fen', 'data.fieldDeal'],
  ['origin', 'data.fieldOrigin'],
];

function aboutSection(heading: I18nKey, ...children: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'data-about-section';
  const h = document.createElement('h2');
  h.className = 'data-section-heading';
  h.textContent = t(heading);
  section.append(h, ...children);
  return section;
}

function fieldTable(): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'data-fields';
  const body = document.createElement('tbody');
  for (const [field, key] of FIELD_ROWS) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    const code = document.createElement('code');
    code.textContent = field;
    name.append(code);
    const meaning = document.createElement('td');
    meaning.textContent = t(key);
    row.append(name, meaning);
    body.append(row);
  }
  table.append(body);
  return table;
}

/** /data/about: what is in the files, the licence, what is left out, how
 *  hidden pieces appear, and how files are built. Same shell as /data. */
export function mountDataAbout(root: HTMLElement): void {
  root.classList.add('landing-page', 'data-route');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section current-games-shell data-shell data-about-page';
  const header = document.createElement('header');
  header.className = 'current-games-header';
  const back = document.createElement('p');
  back.className = 'data-back';
  back.append(internalLink(t('data.backToData'), '/data'));
  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('data.aboutHeading');
  const subtitle = document.createElement('p');
  subtitle.className = 'current-games-subtitle';
  subtitle.textContent = t('data.aboutSubtitle');
  header.append(back, heading, subtitle);

  const body = document.createElement('div');
  body.className = 'data-main data-about';
  body.append(
    aboutSection(
      'data.formatsHeading',
      paragraph(t('data.formatJsonl')),
      fieldTable(),
      paragraph(t('data.formatMoves')),
      paragraph(t('data.formatPgn')),
    ),
    aboutSection(
      'data.licenseHeading',
      paragraph(
        t('data.licensePrefix'),
        externalLink(t('privacy.ccByLink'), CC_BY_URL),
        t('data.licenseSuffix'),
      ),
      citeBlock(),
      paragraph(t('data.licenseBody')),
    ),
    aboutSection(
      'data.includedHeading',
      paragraph(t('data.included')),
      paragraph(t('data.botFilterNote')),
      paragraph(t('data.excluded')),
    ),
    aboutSection(
      'data.hiddenHeading',
      paragraph(t('data.hiddenFog')),
      paragraph(t('data.hiddenFlip')),
      paragraph(t('data.hiddenReveal')),
      paragraph(t('data.hiddenBanqi')),
      paragraph(t('data.hiddenBanqiLetters')),
      paragraph(t('data.hiddenDeal')),
      paragraph(t('data.hiddenNeverRevealed')),
      paragraph(t('data.hiddenReplayer')),
    ),
    aboutSection('data.engineHeading', paragraph(t('data.engineAbout'))),
    aboutSection(
      'data.filesHeading',
      paragraph(t('data.filesBuilt')),
      paragraph(t('data.filesHosting')),
    ),
  );
  shell.append(header, body);
  root.append(shell);
}

export function renderDataAboutShellForPrerender(locale: Locale): Promise<string> {
  return prerenderMount(locale, mountDataAbout);
}
