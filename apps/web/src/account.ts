// Account auth + settings UI. Extracted from landing.ts.
//
// Owns the /account, /account/settings page mounts and the form builders:
// signed-in account card, login form (email + magic code), account settings
// (display name / handle / email), and the auth-tabs (Sign in / Register).
//
// Shared shell helpers live in site-shell.ts so account pages do not depend on
// landing.ts.

import './account-profile.css';
import { setAccountNavUser } from './account-nav.js';
import {
  type AccountPreferenceId,
  type AccountPreferences,
  normalizeAccountPreferences,
  replaceAccountPreferences,
} from './account-preferences.js';
import { identify, resetIdentity } from './analytics.js';
import { requestedAuthReferrer } from './auth-redirect.js';
import {
  DISPLAY_PREFERENCE_DEFINITIONS,
  type DisplayPreferenceId,
  type DisplayPreferenceValue,
  isBooleanDisplayPreference,
  readDisplayPreferences,
  writeDisplayPreference,
} from './display-preferences.js';
import { buildFlairIcon, FLAIR_KEYS, flairLabel } from './flair.js';
import { t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';
import { refreshNotifications } from './notification-nav.js';
import { type AuthUser, buildLoadingState, buildNav, fetchCurrentUser } from './site-shell.js';
import { setBoardCoordinatesPreference } from './theme.js';

type AccountSettingsSection =
  | 'profile'
  | 'display'
  | 'clock'
  | 'behavior'
  | 'privacy'
  | 'notifications'
  | 'username'
  | 'account'
  | 'security'
  | 'close';

const accountSettingsSectionGroups: readonly (readonly AccountSettingsSection[])[] = [
  ['profile'],
  ['display', 'clock', 'behavior', 'privacy', 'notifications'],
  ['username', 'account', 'security'],
  ['close'],
];

const accountSettingsSections = accountSettingsSectionGroups.flat();

const implementedDisplayPreferenceIds = new Set<DisplayPreferenceId>([
  'pieceAnimation',
  'playerFlairs',
  'boardCoordinates',
]);
const pieceAnimationSaveQueues = new WeakMap<AuthUser, Promise<void>>();

// ── Page mounts ──────────────────────────────────────────────────────────────

export async function mountAccount(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'account-route');
  root.append(buildNav(locale), buildLoadingState(t('account.loading', {}, locale)));

  const shell = document.createElement('main');
  shell.className = 'account-shell';
  root.replaceChildren(buildNav(locale), shell);

  const current = await fetchCurrentUser().catch((err) => {
    console.warn(err);
    return null;
  });
  if (current) {
    window.location.replace(localizedHref('/account/settings', locale));
    return;
  }
  renderAccountShell(shell, current, currentAccountTab(), locale);
}

export async function mountAccountSettings(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  const section = accountSettingsSectionFromPath();
  root.replaceChildren();
  root.classList.add('landing-page', 'account-route');

  const shell = document.createElement('main');
  shell.className = 'account-shell account-settings-shell';
  root.replaceChildren(buildNav(locale), shell);

  const current = await fetchCurrentUser().catch((err) => {
    console.warn(err);
    return null;
  });
  renderAccountSettingsShell(shell, current, section, locale);
}

// ── Shell renderers ──────────────────────────────────────────────────────────

function renderAccountShell(
  shell: HTMLElement,
  user: AuthUser | null,
  tab: 'login' | 'register' = 'login',
  locale: Locale = currentLocale(),
): void {
  shell.replaceChildren(
    user
      ? buildSignedInAccount(
          user,
          () => renderAccountShell(shell, null, currentAccountTab(), locale),
          locale,
        )
      : buildLoginForm(
          tab,
          (next) => renderAccountShell(shell, next, currentAccountTab(), locale),
          locale,
          { redirectOnSuccess: true },
        ),
  );
}

function renderAccountSettingsShell(
  shell: HTMLElement,
  user: AuthUser | null,
  section: AccountSettingsSection,
  locale: Locale = currentLocale(),
): void {
  document
    .querySelector('.account-route')
    ?.classList.toggle('account-settings-auth-route', user === null);
  shell.classList.toggle('account-settings-shell', user !== null);
  shell.replaceChildren(
    user
      ? buildAccountSettingsPage(user, section, locale)
      : buildLoginForm(
          'login',
          (next) => renderAccountSettingsShell(shell, next, section, locale),
          locale,
          { redirectOnSuccess: false },
        ),
  );
}

// ── Signed-in account card ───────────────────────────────────────────────────

function buildSignedInAccount(
  user: AuthUser,
  onLogout: () => void,
  locale: Locale = currentLocale(),
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'account-panel';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'account-eyebrow';
  eyebrow.textContent = t('account.signedIn', {}, locale);

  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = `@${user.handle}`;

  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const profile = document.createElement('a');
  profile.className = 'landing-setup-start';
  profile.href = `/@/${encodeURIComponent(user.handle)}`;
  profile.textContent = t('account.viewProfile', {}, locale);

  const settings = document.createElement('a');
  settings.className = 'landing-setup-back';
  settings.href = localizedHref('/account/settings', locale);
  settings.textContent = t('account.settings', {}, locale);

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'landing-setup-back';
  logout.textContent = t('account.logOut', {}, locale);
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    await fetch('/api/auth/logout', { method: 'POST' });
    resetIdentity();
    setAccountNavUser(null);
    onLogout();
  });

  actions.append(profile, settings, logout);

  // Follow/block lists are self-only surfaces; they render here (and nowhere
  // public) and hydrate after the card paints.
  const relations = document.createElement('div');
  relations.className = 'account-relations';
  void populateRelations(relations, locale);

  panel.append(eyebrow, title, actions, relations);
  return panel;
}

// ── Following / blocked lists ────────────────────────────────────────────────

type RelationEntry = { handle: string; displayName: string; createdAt: string };

async function populateRelations(container: HTMLElement, locale: Locale): Promise<void> {
  const [following, blocked] = await Promise.all([
    fetchRelationEntries('following'),
    fetchRelationEntries('blocks'),
  ]);
  container.replaceChildren();
  // Load failures leave the card unchanged rather than showing an error row:
  // the lists are secondary account furniture, not the page's job.
  if (following === null && blocked === null) return;

  container.append(
    buildRelationGroup(
      t('account.following', {}, locale),
      following ?? [],
      'follow',
      t('account.followingEmpty', {}, locale),
      locale,
    ),
  );
  // An empty blocked list is noise for most players; only render it when
  // there is something to manage.
  if (blocked && blocked.length > 0) {
    container.append(
      buildRelationGroup(t('account.blocked', {}, locale), blocked, 'block', '', locale),
    );
  }
}

async function fetchRelationEntries(kind: 'following' | 'blocks'): Promise<RelationEntry[] | null> {
  try {
    const resp = await fetch(`/api/relations/${kind}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { entries: RelationEntry[] };
    return data.entries;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

function buildRelationGroup(
  heading: string,
  entries: RelationEntry[],
  kind: 'follow' | 'block',
  emptyCopy: string,
  locale: Locale,
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'account-relations-group';

  const title = document.createElement('h2');
  title.className = 'account-relations-heading';
  title.textContent = heading;
  group.append(title);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'account-copy';
    empty.textContent = emptyCopy;
    group.append(empty);
    return group;
  }

  const list = document.createElement('ul');
  list.className = 'account-relations-list';
  for (const entry of entries) {
    list.append(buildRelationRow(entry, kind, locale));
  }
  group.append(list);
  return group;
}

function buildRelationRow(
  entry: RelationEntry,
  kind: 'follow' | 'block',
  locale: Locale,
): HTMLElement {
  const item = document.createElement('li');
  item.className = 'account-relations-row';

  const link = document.createElement('a');
  link.href = `/@/${encodeURIComponent(entry.handle)}`;
  link.className = 'account-relations-handle';
  link.textContent = `@${entry.handle}`;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'account-relations-remove';
  remove.textContent =
    kind === 'follow' ? t('profile.unfollow', {}, locale) : t('profile.unblock', {}, locale);
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      const resp = await fetch(`/api/users/${encodeURIComponent(entry.handle)}/${kind}`, {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error(`relation delete failed: ${resp.status}`);
      item.remove();
    } catch (err) {
      console.warn(err);
      remove.disabled = false;
    }
  });

  item.append(link, remove);
  return item;
}

// ── Account settings form ────────────────────────────────────────────────────

function buildAccountSettingsPage(
  user: AuthUser,
  section: AccountSettingsSection,
  locale: Locale = currentLocale(),
): DocumentFragment {
  replaceAccountPreferences(user.accountPreferences);
  const fragment = document.createDocumentFragment();
  fragment.append(
    buildAccountSettingsRail(section, locale),
    buildAccountSettingsSection(user, section, locale),
  );
  return fragment;
}

function buildAccountSettingsRail(
  active: AccountSettingsSection,
  locale: Locale = currentLocale(),
): HTMLElement {
  const rail = document.createElement('nav');
  rail.className = 'account-settings-rail';
  rail.setAttribute('aria-label', t('account.settingsNav', {}, locale));

  accountSettingsSectionGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      const separator = document.createElement('div');
      separator.className = 'account-settings-rail-separator';
      separator.setAttribute('role', 'separator');
      rail.append(separator);
    }
    for (const section of group) {
      const link = document.createElement('a');
      link.href = accountSettingsSectionHref(section, locale);
      link.className = 'account-settings-rail-link';
      link.textContent = accountSettingsSectionLabel(section, locale);
      if (section === active) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      rail.append(link);
    }
  });
  return rail;
}

function buildAccountSettingsSection(
  user: AuthUser,
  section: AccountSettingsSection,
  locale: Locale = currentLocale(),
): HTMLElement {
  if (section === 'profile') return buildPublicProfileSettings(user, locale);
  if (section === 'display') return buildDisplaySettings(user, locale);
  if (section === 'clock') return buildClockSettings(user, locale);
  if (section === 'behavior') return buildGameBehaviorSettings(user, locale);
  if (section === 'privacy') return buildPrivacySettings(user, locale);
  if (section === 'notifications') return buildNotificationSettings(user, locale);
  if (section === 'username') return buildUsernameSettings(user, locale);
  if (section === 'account') return buildAccountAccessSettings(user, locale);
  if (section === 'security') return buildSecuritySettings(locale);
  if (section === 'close') return buildCloseAccountSettings(user, locale);
  return buildDisplaySettings(user, locale);
}

function buildPublicProfileSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'profile',
    t('account.settingsEditProfile', {}, locale),
    t('account.publicProfileOptional', {}, locale),
  );
  const form = document.createElement('form');
  form.className = 'account-settings-form account-public-profile-form';

  const bio = labeledTextarea(
    t('account.biography', {}, locale),
    'bio',
    user.bio,
    t('account.biographyPlaceholder', {}, locale),
    5,
  );
  bio.input.maxLength = 500;
  bio.help.textContent = t('account.biographyHelp', {}, locale);

  const location = labeledInput(
    t('account.location', {}, locale),
    'location',
    user.location,
    t('account.locationPlaceholder', {}, locale),
  );
  location.input.maxLength = 80;

  const links = labeledTextarea(
    t('account.publicLinks', {}, locale),
    'profileLinks',
    user.profileLinks.join('\n'),
    'https://example.com',
    4,
  );
  links.input.maxLength = 1504;
  links.help.textContent = t('account.publicLinksHelp', {}, locale);

  const flair = buildFlairPicker(user.flair ?? null, locale);

  const status = document.createElement('p');
  status.className = 'account-status';
  status.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'account-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'landing-setup-start';
  save.textContent = t('account.save', {}, locale);
  const profile = document.createElement('a');
  profile.className = 'landing-setup-back';
  profile.href = `/@/${encodeURIComponent(user.handle)}`;
  profile.textContent = t('account.viewProfile', {}, locale);
  actions.append(save, profile);

  form.append(bio.wrap, location.wrap, links.wrap, flair.wrap, actions, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const profileLinks = links.input.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (profileLinks.length > 5) {
      status.textContent = t('account.invalidPublicProfile', {}, locale);
      return;
    }
    save.disabled = true;
    try {
      const resp = await fetch('/api/account/public-profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bio: bio.input.value,
          location: location.input.value,
          profileLinks,
          flair: flair.value(),
        }),
      });
      const data = (await resp.json()) as { user?: AuthUser; error?: string };
      if (!resp.ok || !data.user) throw new Error(t('account.invalidPublicProfile', {}, locale));
      user.bio = data.user.bio;
      user.location = data.user.location;
      user.profileLinks = data.user.profileLinks;
      user.flair = data.user.flair ?? null;
      bio.input.value = user.bio;
      location.input.value = user.location;
      links.input.value = user.profileLinks.join('\n');
      flair.setValue(user.flair);
      status.textContent = t('account.publicProfileSaved', {}, locale);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : t('account.saveFailed', {}, locale);
    } finally {
      save.disabled = false;
    }
  });

  panel.append(form);
  return panel;
}

// A radio grid rather than a <select>: flair is chosen by how it looks, and a
// dropdown of two dozen names shows the reader none of them. "No flair" is the
// first option so clearing is as easy as picking.
function buildFlairPicker(
  current: string | null,
  locale: Locale,
): { wrap: HTMLElement; value: () => string | null; setValue: (next: string | null) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'account-field account-flair-field';

  const group = document.createElement('fieldset');
  group.className = 'account-flair-group';
  const legend = document.createElement('legend');
  legend.textContent = t('account.flair', {}, locale);
  group.append(legend);

  const options = document.createElement('div');
  options.className = 'account-flair-options';

  const inputs: HTMLInputElement[] = [];
  const addOption = (key: string | null, label: string, icon: HTMLElement | null) => {
    const item = document.createElement('label');
    item.className = 'account-flair-option';
    item.title = label;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'flair';
    input.value = key ?? '';
    input.checked = key === current;
    inputs.push(input);

    const face = document.createElement('span');
    face.className = 'account-flair-face';
    if (icon) face.append(icon);
    else face.textContent = '\u2014';

    // The visible label is the icon; the accessible name is the flair's name,
    // so the radio group reads as a list of flair names rather than of blanks.
    const name = document.createElement('span');
    name.className = 'account-flair-name';
    name.textContent = label;

    item.append(input, face, name);
    options.append(item);
  };

  addOption(null, t('account.flairNone', {}, locale), null);
  for (const key of FLAIR_KEYS) {
    addOption(key, flairLabel(key, locale), buildFlairIcon(key, { labelled: false, locale }));
  }

  group.append(options);

  const help = document.createElement('p');
  help.className = 'account-field-help';
  help.textContent = t('account.flairHelp', {}, locale);

  wrap.append(group, help);

  return {
    wrap,
    value: () => inputs.find((input) => input.checked)?.value || null,
    setValue: (next) => {
      for (const input of inputs) input.checked = (input.value || null) === next;
    },
  };
}

function buildSettingsPanel(
  section: AccountSettingsSection,
  titleText: string,
  copyText: string,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'account-panel account-settings-panel';

  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = titleText;

  const copy = document.createElement('p');
  copy.className = 'account-copy';
  copy.textContent = copyText;

  panel.dataset.settingsSection = section;
  panel.append(title);
  if (copyText) panel.append(copy);
  return panel;
}

function buildUsernameSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'username',
    t('account.settingsUsername', {}, locale),
    t('account.settingsUsernameCopy', {}, locale),
  );

  const form = document.createElement('form');
  form.className = 'account-settings-form';

  const handle = labeledInput(
    t('account.username', {}, locale),
    'handle',
    user.handle,
    'brianhliou',
  );
  handle.input.maxLength = 24;
  handle.input.pattern = '[a-zA-Z0-9][a-zA-Z0-9_-]{1,22}[a-zA-Z0-9]';
  handle.input.required = true;
  handle.help.textContent = handleHelpText(user, locale);

  const status = document.createElement('p');
  status.className = 'account-status';
  status.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'landing-setup-start';
  save.textContent = t('account.save', {}, locale);

  const profile = document.createElement('a');
  profile.className = 'landing-setup-back';
  profile.href = `/@/${encodeURIComponent(user.handle)}`;
  profile.textContent = t('account.viewProfile', {}, locale);

  actions.append(save, profile);
  form.append(handle.wrap, actions, status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const resp = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handle: handle.input.value,
        }),
      });
      const data = (await resp.json()) as { user?: AuthUser; error?: string; availableAt?: string };
      if (!resp.ok || !data.user) {
        throw new Error(accountSettingsErrorMessage(data.error, data.availableAt, locale));
      }
      handle.input.value = data.user.handle;
      handle.help.textContent = handleHelpText(data.user, locale);
      profile.href = `/@/${encodeURIComponent(data.user.handle)}`;
      status.textContent = t('account.usernameSaved', {}, locale);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : t('account.saveFailed', {}, locale);
    } finally {
      save.disabled = false;
    }
  });

  panel.append(form);
  return panel;
}

function buildDisplaySettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel('display', t('account.settingsDisplay', {}, locale), '');
  let preferences = readDisplayPreferences();
  const accountPieceAnimation = user.displayPreferences.pieceAnimation;
  if (accountPieceAnimation && accountPieceAnimation !== preferences.pieceAnimation) {
    preferences = writeDisplayPreference('pieceAnimation', accountPieceAnimation);
  } else if (!accountPieceAnimation) {
    queuePieceAnimationPreferenceSave(user, preferences.pieceAnimation);
  }
  const list = document.createElement('div');
  list.className = 'account-display-settings';
  for (const definition of DISPLAY_PREFERENCE_DEFINITIONS) {
    // Only expose preferences that already affect a game surface. The remaining
    // definitions stay available for incremental wiring without presenting
    // controls that merely write inert localStorage values.
    if (!implementedDisplayPreferenceIds.has(definition.id)) continue;
    if (isBooleanDisplayPreference(definition)) {
      list.append(buildBooleanDisplayPreference(definition.id, preferences[definition.id], locale));
      continue;
    }
    list.append(
      buildSelectDisplayPreference(
        definition.id,
        definition.options,
        preferences[definition.id],
        locale,
        definition.id === 'pieceAnimation'
          ? (next, group, row) => {
              const pieceAnimation = next as DisplayPreferenceValue<'pieceAnimation'>;
              writeDisplayPreference('pieceAnimation', pieceAnimation);
              queuePieceAnimationPreferenceSave(user, pieceAnimation, group, row, locale);
            }
          : undefined,
      ),
    );
  }
  list.append(
    buildBooleanAccountPreference(
      user,
      'forumAutoTranslate',
      t('account.forumAutoTranslate', {}, locale),
      t('account.forumAutoTranslateHelp', {}, locale),
      locale,
    ),
  );
  panel.append(list);
  return panel;
}

function buildClockSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel('clock', t('account.settingsClock', {}, locale), '');
  const list = document.createElement('div');
  list.className = 'account-display-settings';
  list.append(
    buildAccountPreferenceOptions(
      user,
      'clockTenths',
      t('account.clockTenths', {}, locale),
      '',
      [
        { value: 'never', label: t('account.clockTenthsNever', {}, locale) },
        { value: 'low-time', label: t('account.clockTenthsLowTime', {}, locale) },
        { value: 'always', label: t('account.clockTenthsAlways', {}, locale) },
      ],
      locale,
    ),
    buildBooleanAccountPreference(
      user,
      'lowTimeSound',
      t('account.lowTimeSound', {}, locale),
      t('account.lowTimeSoundHelp', {}, locale),
      locale,
    ),
  );
  panel.append(list);
  return panel;
}

function buildGameBehaviorSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel('behavior', t('account.settingsGameBehavior', {}, locale), '');
  const list = document.createElement('div');
  list.className = 'account-display-settings';
  list.append(
    buildBooleanAccountPreference(
      user,
      'premoves',
      t('account.premoves', {}, locale),
      t('account.premovesHelp', {}, locale),
      locale,
    ),
    buildBooleanAccountPreference(
      user,
      'confirmGameActions',
      t('account.confirmGameActions', {}, locale),
      t('account.confirmGameActionsHelp', {}, locale),
      locale,
    ),
  );
  panel.append(list);
  return panel;
}

function buildBooleanAccountPreference(
  user: AuthUser,
  id: Extract<
    AccountPreferenceId,
    'lowTimeSound' | 'premoves' | 'confirmGameActions' | 'forumAutoTranslate'
  >,
  title: string,
  help: string,
  locale: Locale,
): HTMLElement {
  return buildAccountPreferenceOptions(
    user,
    id,
    title,
    help,
    [
      { value: true, label: t('account.optionYes', {}, locale) },
      { value: false, label: t('account.optionNo', {}, locale) },
    ],
    locale,
  );
}

function buildAccountPreferenceOptions<Id extends AccountPreferenceId>(
  user: AuthUser,
  id: Id,
  title: string,
  help: string,
  options: ReadonlyArray<{ value: AccountPreferences[Id]; label: string }>,
  locale: Locale,
): HTMLElement {
  const row = preferenceRow(title, help);
  const preferences = normalizeAccountPreferences(user.accountPreferences);
  const group = buildSegmentedPreference(
    id,
    options.map((option) => ({ value: String(option.value), label: option.label })),
    String(preferences[id]),
    (next) => {
      const option = options.find((candidate) => String(candidate.value) === next);
      if (option) void saveAccountPreference(user, id, option.value, group, row, locale);
    },
  );
  const helpNode = row.querySelector('.account-preference-help');
  row.insertBefore(group, helpNode);
  return row;
}

function buildNotificationSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'notifications',
    t('account.settingsNotifications', {}, locale),
    '',
  );
  const table = document.createElement('table');
  table.className = 'account-notification-settings';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.append(
    notificationHeading(''),
    notificationHeading(t('account.notificationBell', {}, locale)),
    notificationHeading(t('account.notificationEmail', {}, locale)),
  );
  head.append(headRow);
  const body = document.createElement('tbody');
  body.append(
    buildNotificationPreferenceRow(
      user,
      t('account.notificationDirectMessages', {}, locale),
      'inboxBell',
      null,
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationCorrespondenceTurn', {}, locale),
      'correspondenceBell',
      null,
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationChallenges', {}, locale),
      'challengesBell',
      null,
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationForum', {}, locale),
      'forumBell',
      null,
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationFollowers', {}, locale),
      'followersBell',
      null,
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationCorrespondenceStart', {}, locale),
      null,
      'correspondenceStartEmail',
      locale,
    ),
    buildNotificationPreferenceRow(
      user,
      t('account.notificationCorrespondenceDeadline', {}, locale),
      null,
      'correspondenceDeadlineEmail',
      locale,
    ),
  );
  table.append(head, body);
  panel.append(table);
  return panel;
}

function notificationHeading(text: string): HTMLTableCellElement {
  const heading = document.createElement('th');
  heading.scope = 'col';
  heading.textContent = text;
  return heading;
}

type BellPreferenceId =
  | 'inboxBell'
  | 'correspondenceBell'
  | 'challengesBell'
  | 'forumBell'
  | 'followersBell';
type EmailPreferenceId = 'correspondenceDeadlineEmail' | 'correspondenceStartEmail';
const BELL_PREFERENCE_IDS = new Set<string>([
  'inboxBell',
  'correspondenceBell',
  'challengesBell',
  'forumBell',
  'followersBell',
]);

function buildNotificationPreferenceRow(
  user: AuthUser,
  labelText: string,
  bell: BellPreferenceId | null,
  email: EmailPreferenceId | null,
  locale: Locale,
): HTMLTableRowElement {
  const row = document.createElement('tr');
  const label = document.createElement('th');
  label.scope = 'row';
  label.textContent = labelText;
  row.append(
    label,
    notificationPreferenceCell(user, bell, labelText, locale),
    notificationPreferenceCell(user, email, labelText, locale),
  );
  return row;
}

function notificationPreferenceCell(
  user: AuthUser,
  id: BellPreferenceId | EmailPreferenceId | null,
  labelText: string,
  locale: Locale,
): HTMLTableCellElement {
  const cell = document.createElement('td');
  if (!id) {
    cell.className = 'account-notification-unavailable';
    cell.textContent = '–';
    return cell;
  }
  const control = document.createElement('label');
  control.className = 'account-preference-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = id;
  input.checked = normalizeAccountPreferences(user.accountPreferences)[id];
  const channel = BELL_PREFERENCE_IDS.has(id) ? 'notificationBell' : 'notificationEmail';
  input.setAttribute('aria-label', `${labelText}: ${t(`account.${channel}`, {}, locale)}`);
  const track = document.createElement('span');
  track.className = 'account-preference-switch-track';
  control.append(input, track);
  input.addEventListener('change', () => {
    void saveAccountPreference(user, id, input.checked, control, cell, locale);
  });
  cell.append(control);
  return cell;
}

async function saveAccountPreference<Id extends AccountPreferenceId>(
  user: AuthUser,
  id: Id,
  value: AccountPreferences[Id],
  group: HTMLElement,
  statusHost: HTMLElement,
  locale: Locale,
): Promise<void> {
  const previous = normalizeAccountPreferences(user.accountPreferences)[id];
  setPreferenceGroupDisabled(group, true);
  try {
    const resp = await fetch('/api/account/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [id]: value }),
    });
    if (!resp.ok) throw new Error(`account preference save failed: ${resp.status}`);
    const data = (await resp.json()) as { user: AuthUser };
    const next = normalizeAccountPreferences(data.user.accountPreferences);
    user.accountPreferences = next;
    replaceAccountPreferences(next);
    setDisplayPreferenceStatus(statusHost, t('account.preferenceSaved', {}, locale));
    if (BELL_PREFERENCE_IDS.has(id)) void refreshNotifications();
  } catch (err) {
    console.warn(err);
    restorePreferenceGroup(group, previous);
    setDisplayPreferenceStatus(statusHost, t('account.saveFailed', {}, locale));
  } finally {
    setPreferenceGroupDisabled(group, false);
  }
}

function restorePreferenceGroup(group: HTMLElement, previous: string | boolean): void {
  for (const input of group.querySelectorAll<HTMLInputElement>('input')) {
    input.checked =
      input.type === 'checkbox' ? Boolean(previous) : input.value === String(previous);
  }
}

function buildBooleanDisplayPreference(
  id: DisplayPreferenceId,
  value: boolean,
  locale: Locale,
): HTMLElement {
  const row = displayPreferenceRow(id, locale);
  const label = document.createElement('label');
  label.className = 'account-preference-switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = id;
  input.checked = value;
  input.addEventListener('change', () => {
    // Board coordinates change the board's geometry, so they go through the
    // theme setter: it persists, stamps the root attribute CSS reads for the
    // matching aspect ratio, and fires the event boards re-render on. Writing
    // the preference alone would leave every mounted board stale until reload.
    if (id === 'boardCoordinates') {
      setBoardCoordinatesPreference(input.checked);
      return;
    }
    writeDisplayPreference(id, input.checked as DisplayPreferenceValue<typeof id>);
  });

  const trackEl = document.createElement('span');
  trackEl.className = 'account-preference-switch-track';
  label.append(input, trackEl);
  row.append(label);
  return row;
}

function buildSelectDisplayPreference(
  id: DisplayPreferenceId,
  options: readonly string[],
  value: string,
  locale: Locale,
  onChange?: (value: string, group: HTMLElement, row: HTMLElement) => void,
): HTMLElement {
  const row = displayPreferenceRow(id, locale);
  const group = buildSegmentedPreference(
    id,
    options.map((optionValue) => ({
      value: optionValue,
      label: displayPreferenceOptionLabel(id, optionValue, locale),
    })),
    value,
    (next) => {
      if (onChange) onChange(next, group, row);
      else writeDisplayPreference(id, next as DisplayPreferenceValue<typeof id>);
    },
  );
  row.append(group);
  return row;
}

function queuePieceAnimationPreferenceSave(
  user: AuthUser,
  pieceAnimation: NonNullable<AuthUser['displayPreferences']['pieceAnimation']>,
  group?: HTMLElement,
  row?: HTMLElement,
  locale: Locale = currentLocale(),
): void {
  if (group) setPreferenceGroupDisabled(group, true);
  const queued = (pieceAnimationSaveQueues.get(user) ?? Promise.resolve()).then(() =>
    savePieceAnimationPreference(user, pieceAnimation, row, locale),
  );
  pieceAnimationSaveQueues.set(
    user,
    queued.finally(() => {
      if (group) setPreferenceGroupDisabled(group, false);
    }),
  );
}

async function savePieceAnimationPreference(
  user: AuthUser,
  pieceAnimation: NonNullable<AuthUser['displayPreferences']['pieceAnimation']>,
  row: HTMLElement | undefined,
  locale: Locale,
): Promise<void> {
  try {
    const resp = await fetch('/api/account/display-preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pieceAnimation }),
    });
    if (!resp.ok) throw new Error(`display preference save failed: ${resp.status}`);
    const data = (await resp.json()) as { user: AuthUser };
    user.displayPreferences = data.user.displayPreferences;
    setDisplayPreferenceStatus(row, t('account.displayPreferenceSaved', {}, locale));
  } catch (err) {
    console.warn(err);
    setDisplayPreferenceStatus(row, t('account.displayPreferenceSaveFailed', {}, locale));
  }
}

function setDisplayPreferenceStatus(row: HTMLElement | undefined, text: string): void {
  if (!row) return;
  let status = row.querySelector<HTMLElement>('.account-preference-help');
  if (!status) {
    status = document.createElement('span');
    status.className = 'account-preference-help';
    status.setAttribute('aria-live', 'polite');
    row.append(status);
  }
  status.textContent = text;
}

function buildSegmentedPreference(
  name: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'account-preference-options';
  group.setAttribute('role', 'radiogroup');

  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'account-preference-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener('change', () => {
      if (input.checked) onChange(option.value);
    });

    const text = document.createElement('span');
    text.textContent = option.label;
    label.append(input, text);
    group.append(label);
  }

  return group;
}

function displayPreferenceRow(id: DisplayPreferenceId, locale: Locale): HTMLElement {
  return preferenceRow(displayPreferenceLabel(id, locale), displayPreferenceHelp(id, locale));
}

function preferenceRow(titleText: string, helpText = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'account-preference-row';
  const copy = document.createElement('div');
  copy.className = 'account-preference-copy';

  const title = document.createElement('span');
  title.className = 'account-preference-title';
  title.textContent = titleText;
  copy.append(title);
  row.append(copy);

  if (helpText) {
    const help = document.createElement('span');
    help.className = 'account-preference-help';
    help.textContent = helpText;
    row.append(help);
  }

  return row;
}

function buildPrivacySettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel('privacy', t('account.settingsPrivacy', {}, locale), '');
  const form = document.createElement('form');
  form.className = 'account-settings-form';
  form.append(buildDmPolicyControl(user, locale));
  panel.append(form);
  return panel;
}

function buildAccountAccessSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'account',
    t('account.settingsAccount', {}, locale),
    t('account.settingsAccountCopy', {}, locale),
  );
  const list = document.createElement('dl');
  list.className = 'account-settings-summary';
  const emailSummary = summaryRow(t('account.email', {}, locale), user.email);
  list.append(
    emailSummary,
    summaryRow(
      t('account.emailStatus', {}, locale),
      user.emailVerified
        ? t('account.emailVerified', {}, locale)
        : t('account.emailUnverified', {}, locale),
    ),
  );

  const form = document.createElement('form');
  form.className = 'account-settings-form account-email-change-form';
  const newEmail = labeledInput(
    t('account.newEmail', {}, locale),
    'email',
    '',
    t('account.emailAddress', {}, locale),
  );
  newEmail.input.type = 'email';
  newEmail.input.autocomplete = 'email';
  newEmail.input.required = true;
  newEmail.help.textContent = t('account.emailChangeHelp', {}, locale);

  const code = labeledInput(
    t('account.emailChangeCode', {}, locale),
    'code',
    '',
    t('account.emailChangeCode', {}, locale),
  );
  code.input.inputMode = 'numeric';
  code.input.autocomplete = 'one-time-code';
  code.wrap.hidden = true;

  const status = document.createElement('p');
  status.className = 'account-status';
  status.setAttribute('aria-live', 'polite');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'landing-setup-start';
  submit.textContent = t('account.sendVerificationCode', {}, locale);

  let changeId: string | null = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      if (!changeId) {
        const resp = await fetch('/api/account/email/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: newEmail.input.value }),
        });
        const data = (await resp.json()) as {
          changeId?: string;
          devCode?: string;
          error?: string;
        };
        if (!resp.ok || !data.changeId)
          throw new Error(emailChangeErrorMessage(data.error, locale));
        changeId = data.changeId;
        newEmail.input.disabled = true;
        code.wrap.hidden = false;
        code.input.required = true;
        if (data.devCode) code.input.value = data.devCode;
        submit.textContent = t('account.confirmEmailChange', {}, locale);
        status.textContent = data.devCode
          ? t('account.devCodeFilled', {}, locale)
          : t('account.emailChangeCheck', {}, locale);
        code.input.focus();
      } else {
        const resp = await fetch('/api/account/email/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ changeId, code: code.input.value }),
        });
        const data = (await resp.json()) as { user?: AuthUser; error?: string };
        if (!resp.ok || !data.user) throw new Error(emailChangeErrorMessage(data.error, locale));
        user.email = data.user.email;
        user.emailVerified = data.user.emailVerified;
        const emailValue = emailSummary.querySelector('dd');
        if (emailValue) emailValue.textContent = user.email;
        changeId = null;
        newEmail.input.disabled = false;
        newEmail.input.value = '';
        code.input.value = '';
        code.input.required = false;
        code.wrap.hidden = true;
        submit.textContent = t('account.sendVerificationCode', {}, locale);
        status.textContent = t('account.emailChanged', {}, locale);
      }
    } catch (err) {
      status.textContent =
        err instanceof Error ? err.message : t('account.emailChangeFailed', {}, locale);
    } finally {
      submit.disabled = false;
    }
  });

  form.append(newEmail.wrap, code.wrap, submit, status);
  panel.append(list, form);
  return panel;
}

function emailChangeErrorMessage(error: string | undefined, locale: Locale): string {
  if (error === 'invalid_email') return t('account.invalidEmail', {}, locale);
  if (error === 'email_unchanged') return t('account.emailUnchanged', {}, locale);
  if (error === 'email_taken') return t('account.emailTaken', {}, locale);
  if (error === 'invalid_email_change_code') {
    return t('account.invalidEmailChangeCode', {}, locale);
  }
  if (error === 'rate_limited') return t('account.tooManyAttempts', {}, locale);
  return t('account.emailChangeFailed', {}, locale);
}

type AccountSessionView = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
};

function buildSecuritySettings(locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'security',
    t('account.settingsSecurity', {}, locale),
    t('account.securityCopy', {}, locale),
  );
  const content = document.createElement('div');
  content.className = 'account-session-settings';
  content.textContent = t('account.sessionsLoading', {}, locale);
  panel.append(content);
  void loadAccountSessions(content, locale);
  return panel;
}

async function loadAccountSessions(content: HTMLElement, locale: Locale): Promise<void> {
  try {
    const resp = await fetch('/api/account/sessions');
    const data = (await resp.json()) as { sessions?: AccountSessionView[] };
    if (!resp.ok || !data.sessions) throw new Error(`session load failed: ${resp.status}`);
    renderAccountSessions(content, data.sessions, locale);
  } catch (err) {
    console.warn(err);
    content.textContent = t('account.sessionsLoadFailed', {}, locale);
  }
}

function renderAccountSessions(
  content: HTMLElement,
  sessions: AccountSessionView[],
  locale: Locale,
): void {
  const list = document.createElement('ul');
  list.className = 'account-session-list';
  const status = document.createElement('p');
  status.className = 'account-status';
  status.setAttribute('aria-live', 'polite');

  for (const session of sessions) {
    const item = document.createElement('li');
    item.className = 'account-session-row';
    item.dataset.sessionId = session.id;

    const details = document.createElement('div');
    details.className = 'account-session-details';
    const device = document.createElement('strong');
    device.textContent = accountSessionDeviceLabel(session.userAgent, locale);
    const activity = document.createElement('span');
    activity.textContent = t(
      'account.sessionLastActive',
      { date: formatAccountSessionDate(session.lastSeenAt, locale) },
      locale,
    );
    const created = document.createElement('span');
    created.textContent = t(
      'account.sessionCreated',
      { date: formatAccountSessionDate(session.createdAt, locale) },
      locale,
    );
    details.append(device, activity, created);

    if (session.current) {
      const current = document.createElement('span');
      current.className = 'account-session-current';
      current.textContent = t('account.currentSession', {}, locale);
      item.append(details, current);
    } else {
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'landing-setup-back account-session-revoke';
      revoke.textContent = t('account.revokeSession', {}, locale);
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          const resp = await fetch(`/api/account/sessions/${encodeURIComponent(session.id)}`, {
            method: 'DELETE',
          });
          if (!resp.ok) throw new Error(`session revoke failed: ${resp.status}`);
          item.remove();
          status.textContent = t('account.sessionRevoked', {}, locale);
          updateRevokeOtherSessionsButton(content);
        } catch (err) {
          console.warn(err);
          revoke.disabled = false;
          status.textContent = t('account.sessionRevokeFailed', {}, locale);
        }
      });
      item.append(details, revoke);
    }
    list.append(item);
  }

  const revokeOthers = document.createElement('button');
  revokeOthers.type = 'button';
  revokeOthers.className = 'landing-setup-back account-session-revoke-others';
  revokeOthers.textContent = t('account.revokeOtherSessions', {}, locale);
  revokeOthers.addEventListener('click', async () => {
    revokeOthers.disabled = true;
    try {
      const resp = await fetch('/api/account/sessions', { method: 'DELETE' });
      if (!resp.ok) throw new Error(`other sessions revoke failed: ${resp.status}`);
      for (const row of list.querySelectorAll<HTMLElement>('.account-session-row')) {
        if (!row.querySelector('.account-session-current')) row.remove();
      }
      status.textContent = t('account.otherSessionsRevoked', {}, locale);
      updateRevokeOtherSessionsButton(content);
    } catch (err) {
      console.warn(err);
      revokeOthers.disabled = false;
      status.textContent = t('account.sessionRevokeFailed', {}, locale);
    }
  });

  content.replaceChildren(list, revokeOthers, status);
  updateRevokeOtherSessionsButton(content);
}

function updateRevokeOtherSessionsButton(content: HTMLElement): void {
  const hasOtherSessions = [...content.querySelectorAll('.account-session-row')].some(
    (row) => !row.querySelector('.account-session-current'),
  );
  const button = content.querySelector<HTMLButtonElement>('.account-session-revoke-others');
  if (button) button.hidden = !hasOtherSessions;
}

function accountSessionDeviceLabel(userAgent: string | null, locale: Locale): string {
  if (!userAgent) return t('account.unknownDevice', {}, locale);
  const browser = userAgent.includes('Firefox/')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Edge'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : null;
  const device = /iPhone|iPad/.test(userAgent)
    ? 'iPhone or iPad'
    : userAgent.includes('Android')
      ? 'Android'
      : userAgent.includes('Windows')
        ? 'Windows'
        : userAgent.includes('Mac OS X')
          ? 'Mac'
          : userAgent.includes('Linux')
            ? 'Linux'
            : null;
  if (browser && device) return `${browser} · ${device}`;
  return browser ?? device ?? t('account.unknownDevice', {}, locale);
}

function formatAccountSessionDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function buildCloseAccountSettings(user: AuthUser, locale: Locale = currentLocale()): HTMLElement {
  const panel = buildSettingsPanel(
    'close',
    t('account.settingsCloseAccount', {}, locale),
    t('account.closeAccountCopy', {}, locale),
  );
  const consequences = document.createElement('ul');
  consequences.className = 'account-close-consequences';
  for (const key of [
    'account.closeRemovesIdentity',
    'account.closePreservesHistory',
    'account.closeRevokesSessions',
  ] as const) {
    const item = document.createElement('li');
    item.textContent = t(key, {}, locale);
    consequences.append(item);
  }

  const form = document.createElement('form');
  form.className = 'account-settings-form account-close-form';
  const acknowledgement = document.createElement('label');
  acknowledgement.className = 'account-close-acknowledgement';
  const acknowledgeInput = document.createElement('input');
  acknowledgeInput.type = 'checkbox';
  acknowledgeInput.required = true;
  const acknowledgeText = document.createElement('span');
  acknowledgeText.textContent = t('account.closeAcknowledge', {}, locale);
  acknowledgement.append(acknowledgeInput, acknowledgeText);

  const code = labeledInput(
    t('account.closeAccountCode', {}, locale),
    'code',
    '',
    t('account.closeAccountCode', {}, locale),
  );
  code.input.inputMode = 'numeric';
  code.input.autocomplete = 'one-time-code';
  code.wrap.hidden = true;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'account-danger-button';
  submit.textContent = t('account.sendClosureCode', {}, locale);

  const status = document.createElement('p');
  status.className = 'account-status';
  status.setAttribute('aria-live', 'polite');

  let closureId: string | null = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      if (!closureId) {
        const resp = await fetch('/api/account/closure/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const data = (await resp.json()) as {
          closureId?: string;
          devCode?: string;
          error?: string;
        };
        if (!resp.ok || !data.closureId) {
          throw new Error(accountClosureErrorMessage(data.error, locale));
        }
        closureId = data.closureId;
        acknowledgeInput.disabled = true;
        code.wrap.hidden = false;
        code.input.required = true;
        if (data.devCode) code.input.value = data.devCode;
        submit.textContent = t('account.confirmAccountClosure', {}, locale);
        status.textContent = data.devCode
          ? t('account.devCodeFilled', {}, locale)
          : t('account.closeAccountCheckEmail', { email: user.email }, locale);
        code.input.focus();
      } else {
        const resp = await fetch('/api/account/closure/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ closureId, code: code.input.value }),
        });
        const data = (await resp.json()) as { closed?: boolean; error?: string };
        if (!resp.ok || !data.closed) {
          throw new Error(accountClosureErrorMessage(data.error, locale));
        }
        resetIdentity();
        setAccountNavUser(null);
        const complete = document.createElement('p');
        complete.className = 'account-close-complete';
        complete.textContent = t('account.accountClosed', {}, locale);
        const home = document.createElement('a');
        home.className = 'landing-setup-back';
        home.href = localizedHref('/', locale);
        home.textContent = t('account.returnHome', {}, locale);
        form.replaceChildren(complete, home);
      }
    } catch (err) {
      status.textContent =
        err instanceof Error ? err.message : t('account.closeAccountFailed', {}, locale);
    } finally {
      submit.disabled = false;
    }
  });

  form.append(acknowledgement, code.wrap, submit, status);
  panel.append(consequences, form);
  return panel;
}

function accountClosureErrorMessage(error: string | undefined, locale: Locale): string {
  if (error === 'active_subscription') return t('account.closeActiveSubscription', {}, locale);
  if (error === 'invalid_account_closure_code') {
    return t('account.invalidClosureCode', {}, locale);
  }
  if (error === 'rate_limited') return t('account.tooManyAttempts', {}, locale);
  return t('account.closeAccountFailed', {}, locale);
}

// DM policy select: saves immediately on change via the preferences PATCH
// (independent of the profile form's save button, like the locale picker).
// Replies in existing threads always deliver; the policy gates new threads.
function buildDmPolicyControl(user: AuthUser, locale: Locale): HTMLElement {
  const row = preferenceRow(
    t('account.dmPolicyLabel', {}, locale),
    t('account.dmPolicyHelp', {}, locale),
  );

  const options = [
    { value: 'never', label: t('account.dmPolicyNever', {}, locale) },
    { value: 'friends', label: t('account.dmPolicyFriends', {}, locale) },
    { value: 'always', label: t('account.dmPolicyAlways', {}, locale) },
  ];
  const group = buildSegmentedPreference('dmPolicy', options, user.dmPolicy, (next) => {
    void saveDmPolicy(next as AuthUser['dmPolicy']);
  });
  const help = row.querySelector<HTMLElement>('.account-preference-help');

  async function saveDmPolicy(next: AuthUser['dmPolicy']): Promise<void> {
    const previous = user.dmPolicy;
    setPreferenceGroupDisabled(group, true);
    try {
      const resp = await fetch('/api/account/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dmPolicy: next }),
      });
      if (!resp.ok) throw new Error(`dm policy save failed: ${resp.status}`);
      const data = (await resp.json()) as { user: AuthUser };
      user.dmPolicy = data.user.dmPolicy;
      if (help) help.textContent = t('account.dmPolicySaved', {}, locale);
    } catch (err) {
      console.warn(err);
      for (const input of group.querySelectorAll<HTMLInputElement>('input')) {
        input.checked = input.value === previous;
      }
      if (help) help.textContent = t('account.saveFailed', {}, locale);
    } finally {
      setPreferenceGroupDisabled(group, false);
    }
  }

  const helpNode = row.querySelector('.account-preference-help');
  row.insertBefore(group, helpNode);
  return row;
}

function setPreferenceGroupDisabled(group: HTMLElement, disabled: boolean): void {
  for (const input of group.querySelectorAll<HTMLInputElement>('input')) input.disabled = disabled;
}

function summaryRow(labelText: string, valueText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'account-settings-summary-row';
  const dt = document.createElement('dt');
  dt.textContent = labelText;
  const dd = document.createElement('dd');
  dd.textContent = valueText;
  row.append(dt, dd);
  return row;
}

function accountSettingsSectionFromPath(
  pathname = window.location.pathname,
): AccountSettingsSection {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const raw =
    normalized === '/account/settings'
      ? 'profile'
      : normalized.match(/^\/account\/settings\/([^/]+)$/)?.[1];
  if (raw === 'messaging') return 'privacy';
  return isAccountSettingsSection(raw) ? raw : 'profile';
}

function isAccountSettingsSection(value: string | undefined): value is AccountSettingsSection {
  return accountSettingsSections.includes(value as AccountSettingsSection);
}

function accountSettingsSectionHref(
  section: AccountSettingsSection,
  locale: Locale = currentLocale(),
): string {
  const path = section === 'profile' ? '/account/settings' : `/account/settings/${section}`;
  return localizedHref(path, locale);
}

function accountSettingsSectionLabel(
  section: AccountSettingsSection,
  locale: Locale = currentLocale(),
): string {
  const keyBySection = {
    profile: 'account.settingsEditProfile',
    display: 'account.settingsDisplay',
    clock: 'account.settingsClock',
    behavior: 'account.settingsGameBehavior',
    privacy: 'account.settingsPrivacy',
    notifications: 'account.settingsNotifications',
    username: 'account.settingsUsername',
    account: 'account.settingsAccount',
    security: 'account.settingsSecurity',
    close: 'account.settingsCloseAccount',
  } as const;
  return t(keyBySection[section], {}, locale);
}

function displayPreferenceLabel(id: DisplayPreferenceId, locale: Locale): string {
  const keyByPreference = {
    pieceAnimation: 'account.displayPieceAnimation',
    materialDifference: 'account.displayMaterialDifference',
    boardHighlights: 'account.displayBoardHighlights',
    pieceDestinations: 'account.displayPieceDestinations',
    boardCoordinates: 'account.displayBoardCoordinates',
    moveListWhilePlaying: 'account.displayMoveListWhilePlaying',
    moveNotation: 'account.displayMoveNotation',
    zenMode: 'account.displayZenMode',
    boardResizeHandle: 'account.displayBoardResizeHandle',
    playerRatings: 'account.displayPlayerRatings',
    playerFlairs: 'account.displayPlayerFlairs',
  } as const;
  return t(keyByPreference[id], {}, locale);
}

function displayPreferenceHelp(id: DisplayPreferenceId, locale: Locale): string {
  if (id === 'playerRatings') return t('account.displayPlayerRatingsHelp', {}, locale);
  return '';
}

function displayPreferenceOptionLabel(
  id: DisplayPreferenceId,
  value: string,
  locale: Locale,
): string {
  const keys = {
    pieceAnimation: {
      none: 'account.displayOption.pieceAnimation.none',
      fast: 'account.displayOption.pieceAnimation.fast',
      normal: 'account.displayOption.pieceAnimation.normal',
      slow: 'account.displayOption.pieceAnimation.slow',
    },
    moveNotation: {
      symbols: 'account.displayOption.moveNotation.symbols',
      letters: 'account.displayOption.moveNotation.letters',
      coordinates: 'account.displayOption.moveNotation.coordinates',
    },
  } as const;
  if (id !== 'pieceAnimation' && id !== 'moveNotation') {
    return value;
  }
  const key = keys[id][value as keyof (typeof keys)[typeof id]];
  return key ? t(key, {}, locale) : value;
}

function labeledInput(
  labelText: string,
  name: string,
  value: string,
  placeholder: string,
): { help: HTMLSpanElement; input: HTMLInputElement; wrap: HTMLLabelElement } {
  const wrap = document.createElement('label');
  wrap.className = 'account-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.value = value;
  input.placeholder = placeholder;
  const help = document.createElement('span');
  help.className = 'account-field-help';
  wrap.append(label, input, help);
  return { help, input, wrap };
}

function labeledTextarea(
  labelText: string,
  name: string,
  value: string,
  placeholder: string,
  rows: number,
): { help: HTMLSpanElement; input: HTMLTextAreaElement; wrap: HTMLLabelElement } {
  const wrap = document.createElement('label');
  wrap.className = 'account-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('textarea');
  input.name = name;
  input.value = value;
  input.placeholder = placeholder;
  input.rows = rows;
  const help = document.createElement('span');
  help.className = 'account-field-help';
  wrap.append(label, input, help);
  return { wrap, input, help };
}

function accountSettingsErrorMessage(
  error: string | undefined,
  availableAt: string | undefined,
  locale: Locale = currentLocale(),
): string {
  if (error === 'invalid_handle') return t('account.invalidHandle', {}, locale);
  if (error === 'handle_taken') return t('account.handleTaken', {}, locale);
  if (error === 'handle_change_cooldown') {
    const date = availableAt ? new Date(availableAt) : null;
    return date && Number.isFinite(date.getTime())
      ? t('account.handleCooldownDate', { date: formatAccountDate(date, locale) }, locale)
      : t('account.handleCooldownUnknown', {}, locale);
  }
  if (error === 'not_signed_in') return t('account.notSignedInEdit', {}, locale);
  return t('account.saveFailed', {}, locale);
}

function handleHelpText(user: AuthUser, locale: Locale = currentLocale()): string {
  if (!user.handleChangedAt) {
    return t('account.handleHelpFirst', {}, locale);
  }
  const nextChangeAt = new Date(
    new Date(user.handleChangedAt).getTime() + 30 * 24 * 60 * 60 * 1000,
  );
  if (!Number.isFinite(nextChangeAt.getTime())) {
    return t('account.handleHelpLater', {}, locale);
  }
  return t('account.handleHelpNext', { date: formatAccountDate(nextChangeAt, locale) }, locale);
}

function formatAccountDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(LOCALE_META[locale].dateLocale);
}

// ── Login / register form ────────────────────────────────────────────────────

function buildLoginForm(
  tab: 'login' | 'register' = 'login',
  onAuth: (user: AuthUser) => void = () => undefined,
  locale: Locale = currentLocale(),
  options: { redirectOnSuccess: boolean } = { redirectOnSuccess: true },
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'account-panel account-auth-panel';
  panel.dataset.entryPoint = tab;

  const eyebrow = document.createElement('span');
  eyebrow.className = 'account-eyebrow';
  eyebrow.textContent = t('account.account', {}, locale);

  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = t('account.continueTitle', {}, locale);

  const copy = document.createElement('p');
  copy.className = 'account-copy';
  copy.textContent = t('account.continueCopy', {}, locale);

  const form = document.createElement('form');
  form.className = 'account-form';

  const emailField = document.createElement('label');
  emailField.className = 'account-auth-field';
  const emailLabel = document.createElement('span');
  emailLabel.className = 'account-auth-field-label';
  emailLabel.textContent = t('account.emailAddress', {}, locale);
  const email = document.createElement('input');
  email.type = 'email';
  email.name = 'email';
  email.autocomplete = 'email';
  email.placeholder = t('account.emailAddress', {}, locale);
  email.setAttribute('aria-describedby', 'account-auth-email-help');
  email.required = true;
  const emailHelp = document.createElement('span');
  emailHelp.id = 'account-auth-email-help';
  emailHelp.className = 'account-auth-field-help';
  emailHelp.textContent = t('account.emailCodeHelp', {}, locale);
  emailField.append(emailLabel, email, emailHelp);

  const emailStage = document.createElement('div');
  emailStage.className = 'account-auth-stage account-auth-email-stage';
  const newAccountNotice = document.createElement('p');
  newAccountNotice.className = 'account-auth-new-account';
  newAccountNotice.textContent = t('account.newAccountNotice', {}, locale);
  emailStage.append(emailField, newAccountNotice);

  const codeField = document.createElement('label');
  codeField.className = 'account-auth-field';
  const codeLabel = document.createElement('span');
  codeLabel.className = 'account-auth-field-label';
  codeLabel.textContent = t('account.loginCode', {}, locale);
  const code = document.createElement('input');
  code.type = 'text';
  code.name = 'code';
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.placeholder = t('account.loginCode', {}, locale);
  code.maxLength = 8;
  code.pattern = '[0-9]{8}';
  code.setAttribute('aria-describedby', 'account-auth-status');
  codeField.append(codeLabel, code);

  const codeStage = document.createElement('div');
  codeStage.className = 'account-auth-stage account-auth-code-stage';
  codeStage.hidden = true;
  const codePrompt = document.createElement('p');
  codePrompt.className = 'account-auth-code-prompt';
  const codeTiming = document.createElement('p');
  codeTiming.className = 'account-auth-code-timing';
  const codeActions = document.createElement('div');
  codeActions.className = 'account-auth-code-actions';
  const resendCode = document.createElement('button');
  resendCode.type = 'button';
  resendCode.className = 'account-auth-reset account-auth-resend';
  const changeEmail = document.createElement('button');
  changeEmail.type = 'button';
  changeEmail.className = 'account-auth-reset';
  changeEmail.textContent = t('account.useDifferentEmail', {}, locale);
  codeActions.append(resendCode, changeEmail);
  codeStage.append(codePrompt, codeField, codeTiming, codeActions);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'landing-setup-start';
  submit.textContent = t('account.sendCode', {}, locale);
  submit.setAttribute('aria-describedby', 'account-auth-status');

  const status = document.createElement('p');
  status.id = 'account-auth-status';
  status.className = 'account-status';
  status.hidden = true;
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('role', 'status');

  let loginId: string | null = null;
  let expiresAt = 0;
  let resendAvailableAt = 0;
  let countdownTimer: number | null = null;
  let authBusy = false;

  const clearCountdown = (): void => {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    countdownTimer = null;
  };

  const showStatus = (message: string, state: 'error' | 'success'): void => {
    status.textContent = message;
    status.hidden = false;
    status.dataset.state = state;
  };

  const hideStatus = (): void => {
    status.hidden = true;
    status.textContent = '';
    status.removeAttribute('data-state');
  };

  const updateCountdown = (): void => {
    const now = Date.now();
    const expiresIn = Math.max(0, expiresAt - now);
    const resendIn = Math.max(0, resendAvailableAt - now);
    codeTiming.textContent =
      expiresIn > 0
        ? t('account.codeExpiresIn', { time: formatAuthCountdown(expiresIn) }, locale)
        : t('account.codeExpired', {}, locale);
    codeTiming.dataset.state = expiresIn > 0 ? 'active' : 'expired';
    submit.disabled = authBusy || expiresIn <= 0;
    resendCode.disabled = authBusy || resendIn > 0;
    changeEmail.disabled = authBusy;
    resendCode.textContent =
      resendIn > 0
        ? t('account.resendIn', { time: formatAuthCountdown(resendIn) }, locale)
        : t('account.resendCode', {}, locale);
    if (expiresIn <= 0 && resendIn <= 0) clearCountdown();
  };

  const startCountdown = (): void => {
    clearCountdown();
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1_000);
  };

  const resetToEmail = (): void => {
    clearCountdown();
    loginId = null;
    expiresAt = 0;
    resendAvailableAt = 0;
    authBusy = false;
    email.readOnly = false;
    email.removeAttribute('aria-invalid');
    code.value = '';
    code.required = false;
    code.removeAttribute('aria-invalid');
    emailStage.hidden = false;
    codeStage.hidden = true;
    hideStatus();
    submit.disabled = false;
    changeEmail.disabled = false;
    submit.textContent = t('account.sendCode', {}, locale);
    email.focus();
  };

  changeEmail.addEventListener('click', () => {
    resetToEmail();
  });

  const requestCode = async (isResend: boolean): Promise<void> => {
    if (authBusy) return;
    authBusy = true;
    submit.disabled = true;
    resendCode.disabled = true;
    changeEmail.disabled = true;
    hideStatus();
    email.removeAttribute('aria-invalid');
    code.removeAttribute('aria-invalid');
    submit.textContent = t('account.sendCodeBusy', {}, locale);
    if (isResend) resendCode.textContent = t('account.sendCodeBusy', {}, locale);
    try {
      const { data, resp } = await fetchAuthJson<{
        devCode?: string;
        email?: string;
        error?: string;
        expiresAt?: string;
        loginId?: string;
        resendAvailableAt?: string;
      }>('/api/auth/email/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.value }),
      });
      if (!resp.ok || !data.loginId || !data.expiresAt || !data.resendAvailableAt) {
        throw new Error(data.error ?? `start failed: ${resp.status}`);
      }
      loginId = data.loginId;
      expiresAt = Date.parse(data.expiresAt);
      resendAvailableAt = Date.parse(data.resendAvailableAt);
      if (!Number.isFinite(expiresAt) || !Number.isFinite(resendAvailableAt)) {
        throw new Error('auth_bad_response');
      }
      email.readOnly = true;
      emailStage.hidden = true;
      codeStage.hidden = false;
      code.required = true;
      codePrompt.textContent = t('account.codePrompt', { email: email.value }, locale);
      code.value = data.devCode ?? '';
      submit.textContent = t('account.confirm', {}, locale);
      if (data.devCode) showStatus(t('account.devCodeFilled', {}, locale), 'success');
      else if (isResend) showStatus(t('account.codeResent', {}, locale), 'success');
      startCountdown();
      code.focus();
      code.select();
    } catch (err) {
      showStatus(
        err instanceof Error
          ? authErrorMessage(err.message, locale)
          : t('account.signInFailed', {}, locale),
        'error',
      );
      if (!loginId) email.setAttribute('aria-invalid', 'true');
      submit.disabled = false;
      submit.textContent = loginId
        ? t('account.confirm', {}, locale)
        : t('account.sendCode', {}, locale);
      if (loginId) updateCountdown();
    } finally {
      authBusy = false;
      if (loginId) updateCountdown();
      else submit.disabled = false;
    }
  };

  resendCode.addEventListener('click', () => {
    void requestCode(true);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!loginId) {
      await requestCode(false);
      return;
    }
    if (expiresAt <= Date.now()) {
      showStatus(t('account.codeExpired', {}, locale), 'error');
      code.setAttribute('aria-invalid', 'true');
      return;
    }
    if (authBusy) return;
    authBusy = true;
    submit.disabled = true;
    changeEmail.disabled = true;
    hideStatus();
    email.removeAttribute('aria-invalid');
    code.removeAttribute('aria-invalid');
    submit.textContent = t('account.confirmBusy', {}, locale);
    try {
      const { data, resp } = await fetchAuthJson<{
        user?: AuthUser;
        isNewUser?: boolean;
        error?: string;
      }>('/api/auth/email/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginId, code: code.value }),
      });
      if (!resp.ok || !data.user) throw new Error(data.error ?? `confirm failed: ${resp.status}`);
      clearCountdown();
      // Identify immediately; the shared account-nav cache is updated below,
      // so there may be no full page reload before the next pageview.
      identify(data.user.id, {
        handle: data.user.handle,
        account_role: data.user.accountRole,
        email_verified: data.user.emailVerified,
      });
      // signup_completed is fired by the server on account creation (it
      // reaches PostHog even when the browser blocks analytics); firing it
      // here too would double-count the unblocked signups.
      setAccountNavUser(data.user);
      if (options.redirectOnSuccess) {
        window.location.href = requestedAuthReferrer() ?? localizedHref('/', locale);
        return;
      }
      onAuth(data.user);
    } catch (err) {
      showStatus(
        err instanceof Error
          ? authErrorMessage(err.message, locale)
          : t('account.signInFailed', {}, locale),
        'error',
      );
      code.setAttribute('aria-invalid', 'true');
    } finally {
      authBusy = false;
      submit.textContent = t('account.confirm', {}, locale);
      updateCountdown();
    }
  });

  form.append(emailStage, codeStage, submit, status);

  // Verification can create an account from either historical entry point, so
  // expectations and legal assent must be visible in both cases.
  const principles = document.createElement('details');
  principles.className = 'account-auth-principles';
  principles.open = tab === 'register';
  const principlesSummary = document.createElement('summary');
  principlesSummary.textContent = t('account.principlesSummary', {}, locale);
  const principlesBody = document.createElement('div');
  principlesBody.className = 'account-auth-principles-body';
  const principlesTitle = document.createElement('h2');
  principlesTitle.textContent = t('account.registerPrinciplesTitle', {}, locale);
  const principlesList = document.createElement('ul');
  for (const key of [
    'account.registerFairPlay',
    'account.registerRespect',
    'account.registerOneAccount',
  ] as const) {
    const item = document.createElement('li');
    item.textContent = t(key, {}, locale);
    principlesList.append(item);
  }
  principlesBody.append(principlesTitle, principlesList);
  principles.append(principlesSummary, principlesBody);

  const legal = document.createElement('p');
  legal.className = 'account-legal';
  const termsLink = document.createElement('a');
  termsLink.href = localizedHref('/terms', locale);
  termsLink.textContent = t('footer.terms', {}, locale);
  const privacyLink = document.createElement('a');
  privacyLink.href = localizedHref('/privacy', locale);
  privacyLink.textContent = t('footer.privacy', {}, locale);
  legal.append(
    t('account.legalPrefix', {}, locale),
    termsLink,
    t('account.legalAnd', {}, locale),
    privacyLink,
    t('account.legalSuffix', {}, locale),
  );
  form.append(principles, legal);

  panel.append(eyebrow, title, copy, form);
  return panel;
}

function formatAuthCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

async function fetchAuthJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ data: T; resp: Response }> {
  let resp: Response;
  try {
    resp = await fetch(input, init);
  } catch {
    throw new Error('auth_request_failed');
  }
  try {
    return { data: (await resp.json()) as T, resp };
  } catch {
    throw new Error(resp.ok ? 'auth_bad_response' : `auth_http_${resp.status}`);
  }
}

function authErrorMessage(value: string, locale: Locale = currentLocale()): string {
  if (value === 'auth_request_failed') return t('account.authRequestFailed', {}, locale);
  if (value === 'auth_bad_response') return t('account.authBadResponse', {}, locale);
  if (value.startsWith('auth_http_')) return t('account.authHttpFailed', {}, locale);
  if (value === 'email_delivery_not_configured') return t('account.emailNotConfigured', {}, locale);
  if (value === 'email_delivery_failed') return t('account.emailDeliveryFailed', {}, locale);
  if (value === 'persistence_disabled') return t('account.persistenceDisabled', {}, locale);
  if (value === 'invalid_login_code') return t('account.invalidLoginCode', {}, locale);
  if (value === 'rate_limited') return t('account.tooManyAttempts', {}, locale);
  if (value === 'invalid_email') return t('account.invalidEmail', {}, locale);
  if (value === 'account_closed') return t('account.accountAlreadyClosed', {}, locale);
  return t('account.signInFailed', {}, locale);
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function currentAccountTab(): 'login' | 'register' {
  const params = new URLSearchParams(window.location.search);
  return params.get('tab') === 'register' ? 'register' : 'login';
}
