export const accountPreferencesStorageKey = 'mistboard.accountPreferences.v1';
export const accountPreferencesChangedEvent = 'mistboard:account-preferences-change';

export type ClockTenthsPreference = 'never' | 'low-time' | 'always';

export type AccountPreferences = {
  clockTenths: ClockTenthsPreference;
  lowTimeSound: boolean;
  premoves: boolean;
  confirmGameActions: boolean;
  inboxBell: boolean;
  correspondenceBell: boolean;
  followersBell: boolean;
  forumBell: boolean;
  challengesBell: boolean;
  correspondenceDeadlineEmail: boolean;
  correspondenceStartEmail: boolean;
  forumAutoTranslate: boolean;
};

export const defaultAccountPreferences: AccountPreferences = {
  clockTenths: 'low-time',
  lowTimeSound: true,
  premoves: true,
  confirmGameActions: true,
  inboxBell: true,
  correspondenceBell: true,
  followersBell: true,
  forumBell: true,
  challengesBell: true,
  correspondenceDeadlineEmail: true,
  correspondenceStartEmail: true,
  forumAutoTranslate: true,
};

let currentPreferences: AccountPreferences | null = null;
let currentStorage: Storage | null = null;

export type AccountPreferenceId = keyof AccountPreferences;
export type AccountPreferenceValue<Id extends AccountPreferenceId = AccountPreferenceId> =
  AccountPreferences[Id];

export function readAccountPreferences(storage?: Storage): AccountPreferences {
  const target = storage ?? browserStorage();
  const parsed = readStoredPreferences(target);
  if (parsed === null && target === currentStorage && currentPreferences) {
    return { ...currentPreferences };
  }
  currentPreferences = normalizeAccountPreferences(parsed);
  currentStorage = target;
  return { ...currentPreferences };
}

export function replaceAccountPreferences(
  preferences: Partial<AccountPreferences> | null | undefined,
  storage?: Storage,
): AccountPreferences {
  const normalized = normalizeAccountPreferences(preferences);
  storeAndNotify(normalized, storage ?? browserStorage());
  return normalized;
}

export function writeAccountPreference<Id extends AccountPreferenceId>(
  id: Id,
  value: AccountPreferenceValue<Id>,
  storage?: Storage,
): AccountPreferences {
  const preferences = readAccountPreferences(storage);
  preferences[id] = value;
  storeAndNotify(preferences, storage ?? browserStorage());
  return preferences;
}

export function normalizeAccountPreferences(value: unknown): AccountPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultAccountPreferences };
  }
  const parsed = value as Record<string, unknown>;
  return {
    clockTenths: isClockTenthsPreference(parsed.clockTenths)
      ? parsed.clockTenths
      : defaultAccountPreferences.clockTenths,
    lowTimeSound: booleanOrDefault(parsed.lowTimeSound, defaultAccountPreferences.lowTimeSound),
    premoves: booleanOrDefault(parsed.premoves, defaultAccountPreferences.premoves),
    confirmGameActions: booleanOrDefault(
      parsed.confirmGameActions,
      defaultAccountPreferences.confirmGameActions,
    ),
    inboxBell: booleanOrDefault(parsed.inboxBell, defaultAccountPreferences.inboxBell),
    correspondenceBell: booleanOrDefault(
      parsed.correspondenceBell,
      defaultAccountPreferences.correspondenceBell,
    ),
    followersBell: booleanOrDefault(parsed.followersBell, defaultAccountPreferences.followersBell),
    forumBell: booleanOrDefault(parsed.forumBell, defaultAccountPreferences.forumBell),
    challengesBell: booleanOrDefault(
      parsed.challengesBell,
      defaultAccountPreferences.challengesBell,
    ),
    correspondenceStartEmail: booleanOrDefault(
      parsed.correspondenceStartEmail,
      defaultAccountPreferences.correspondenceStartEmail,
    ),
    correspondenceDeadlineEmail: booleanOrDefault(
      parsed.correspondenceDeadlineEmail,
      defaultAccountPreferences.correspondenceDeadlineEmail,
    ),
    forumAutoTranslate: booleanOrDefault(
      parsed.forumAutoTranslate,
      defaultAccountPreferences.forumAutoTranslate,
    ),
  };
}

export function isClockTenthsPreference(value: unknown): value is ClockTenthsPreference {
  return value === 'never' || value === 'low-time' || value === 'always';
}

export function shouldShowClockTenths(remainingMs: number, active: boolean): boolean {
  const preference = readAccountPreferences().clockTenths;
  if (preference === 'always') return true;
  if (preference === 'never') return false;
  return active && remainingMs < 10_000;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredPreferences(storage: Storage | null): unknown {
  try {
    const raw = storage?.getItem(accountPreferencesStorageKey);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function storeAndNotify(preferences: AccountPreferences, storage: Storage | null): void {
  currentPreferences = { ...preferences };
  currentStorage = storage;
  try {
    storage?.setItem(accountPreferencesStorageKey, JSON.stringify(preferences));
  } catch {
    // Runtime settings still apply for this document when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(accountPreferencesChangedEvent, { detail: preferences }));
}
