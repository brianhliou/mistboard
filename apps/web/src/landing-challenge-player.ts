import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import { startOptionButton } from './setup-panel-parts.js';

type ChallengePlayer = {
  handle: string;
  displayName: string;
  following: boolean;
  follower: boolean;
  online: boolean;
};

// Both relation lists are private, paginated APIs. A withheld handle cannot be
// challenged; never substitute a display name or an internal account id.
async function relationEntries(kind: 'following' | 'followers'): Promise<ChallengePlayer[]> {
  const players: ChallengePlayer[] = [];
  let offset = 0;
  while (true) {
    const response = await fetch(`/api/relations/${kind}?limit=50&offset=${offset}`);
    if (!response.ok) throw new Error('relations unavailable');
    const page = (await response.json()) as {
      entries?: { handle?: string | null; displayName?: string }[];
      total?: number;
    };
    if (!Array.isArray(page.entries)) throw new Error('invalid relations');
    for (const entry of page.entries) {
      if (!entry || typeof entry.handle !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(entry.handle))
        continue;
      players.push({
        handle: entry.handle,
        displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.handle,
        following: kind === 'following',
        follower: kind === 'followers',
        online: false,
      });
    }
    offset += page.entries.length;
    if (
      !page.entries.length ||
      typeof page.total !== 'number' ||
      !Number.isSafeInteger(page.total) ||
      offset >= page.total
    )
      break;
  }
  return players;
}

async function challengePlayers(): Promise<ChallengePlayer[]> {
  const [following, followers, onlineResponse] = await Promise.all([
    relationEntries('following'),
    relationEntries('followers'),
    fetch('/api/relations/online-following'),
  ]);
  if (!onlineResponse.ok) throw new Error('presence unavailable');
  const online = (await onlineResponse.json()) as { players?: { handle?: string }[] };
  if (!Array.isArray(online.players)) throw new Error('invalid presence');
  const onlineHandles = new Set(online.players.map((player) => player.handle?.toLowerCase()));
  const unique = new Map<string, ChallengePlayer>();
  for (const player of [...following, ...followers]) {
    const key = player.handle.toLowerCase();
    const previous = unique.get(key);
    unique.set(key, {
      ...player,
      following: player.following || previous?.following === true,
      follower: player.follower || previous?.follower === true,
      online: onlineHandles.has(key),
    });
  }
  return [...unique.values()].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.handle.localeCompare(b.handle),
  );
}

function playerContents(player: ChallengePlayer, locale: Locale): HTMLElement[] {
  const avatar = document.createElement('span');
  avatar.className = 'landing-player-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = Array.from(player.displayName.trim() || player.handle)[0]!.toUpperCase();
  if (player.online) {
    const dot = document.createElement('span');
    dot.className = 'landing-player-online-dot';
    avatar.append(dot);
  }
  const identity = document.createElement('span');
  identity.className = 'landing-player-identity';
  const name = document.createElement('span');
  name.className = 'landing-player-handle';
  name.textContent = `@${player.handle}`;
  const status = document.createElement('small');
  status.className = 'landing-player-status';
  status.textContent = t(
    player.online
      ? 'setup.playerOnline'
      : player.following && player.follower
        ? 'setup.playerMutual'
        : player.follower
          ? 'setup.playerFollowsYou'
          : 'setup.playerFollowing',
    {},
    locale,
  );
  identity.append(name, status);
  return [avatar, identity];
}

/** Send-to controls and their in-sheet list. Fetch on opening the list only;
 * switching pace never silently changes a selected player into a link seek. */
export function buildLandingChallengePlayer(options: {
  locale: Locale;
  onChange(): void;
  onOpen(): void;
  onClose(): void;
}) {
  const { locale } = options;
  let sendTo: 'link' | 'player' = 'link';
  let selected: ChallengePlayer | null = null;
  let players: ChallengePlayer[] | null = null;
  let loading = false;
  const section = document.createElement('div');
  section.className = 'landing-setup-section';
  section.hidden = true;
  const toggle = document.createElement('div');
  toggle.className = 'landing-start-options';
  toggle.setAttribute('role', 'radiogroup');
  toggle.setAttribute('aria-label', t('setup.sendTo', {}, locale));
  const link = startOptionButton(t('setup.shareLink', {}, locale), true);
  const player = startOptionButton(t('setup.pickPlayer', {}, locale), false);
  link.dataset.sendTo = 'link';
  player.dataset.sendTo = 'player';
  toggle.append(link, player);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'landing-challenge-player-row';
  row.setAttribute('aria-haspopup', 'true');
  row.setAttribute('aria-controls', 'landing-challenge-player-picker');
  row.setAttribute('aria-expanded', 'false');
  const sync = () => {
    for (const [button, value] of [
      [link, 'link'],
      [player, 'player'],
    ] as const) {
      button.classList.toggle('selected', sendTo === value);
      button.setAttribute('aria-checked', String(sendTo === value));
    }
    row.hidden = sendTo !== 'player';
    const chevron = document.createElement('span');
    chevron.className = 'landing-variant-row-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.replaceChildren(
      ...(selected ? playerContents(selected, locale) : [t('setup.pickPlayer', {}, locale)]),
      chevron,
    );
    options.onChange();
  };
  link.addEventListener('click', () => {
    sendTo = 'link';
    sync();
  });
  player.addEventListener('click', () => {
    sendTo = 'player';
    sync();
  });
  section.append(toggle, row);

  const picker = document.createElement('div');
  picker.id = 'landing-challenge-player-picker';
  picker.className = 'landing-challenge-player-picker';
  picker.hidden = true;
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'landing-challenge-player-search';
  search.placeholder = t('setup.searchPlayers', {}, locale);
  search.setAttribute('aria-label', search.placeholder);
  const list = document.createElement('div');
  list.className = 'landing-challenge-player-list';
  const message = document.createElement('p');
  message.className = 'landing-challenge-player-message';
  message.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'landing-challenge-player-retry';
  retry.textContent = t('setup.tryAgain', {}, locale);
  retry.hidden = true;
  picker.append(search, message, list, retry);
  const filter = () => {
    const query = search.value.trim().replace(/^@/, '').toLocaleLowerCase();
    let count = 0;
    for (const button of list.querySelectorAll<HTMLButtonElement>('button')) {
      button.hidden = !button.dataset.search?.includes(query);
      if (!button.hidden) count++;
    }
    if (players?.length) {
      message.hidden = count > 0;
      message.textContent = t('setup.noPlayersFound', {}, locale);
    }
  };
  search.addEventListener('input', filter);
  const load = async () => {
    if (loading || players) return;
    loading = true;
    retry.hidden = true;
    message.hidden = false;
    message.textContent = t('play.checking', {}, locale);
    try {
      players = await challengePlayers();
      list.replaceChildren();
      for (const entry of players) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'landing-challenge-player-option';
        button.dataset.handle = entry.handle;
        button.dataset.search = `${entry.handle} ${entry.displayName}`.toLocaleLowerCase();
        button.append(...playerContents(entry, locale));
        button.addEventListener('click', () => {
          selected = entry;
          sync();
          options.onClose();
        });
        list.append(button);
      }
      message.textContent = t('setup.challengePlayersEmpty', {}, locale);
      message.hidden = players.length > 0;
      filter();
    } catch {
      message.textContent = t('setup.challengePlayersFailed', {}, locale);
      retry.hidden = false;
    } finally {
      loading = false;
    }
  };
  retry.addEventListener('click', () => void load());
  row.addEventListener('click', () => {
    options.onOpen();
    void load();
  });
  sync();
  return {
    section,
    picker,
    row,
    choosingPlayer: () => !section.hidden && sendTo === 'player',
    selectedHandle: () => selected?.handle,
    summary: () =>
      selected && sendTo === 'player'
        ? `@${selected.handle}`
        : t(sendTo === 'player' ? 'setup.pickPlayer' : 'setup.shareLink', {}, locale),
  };
}
