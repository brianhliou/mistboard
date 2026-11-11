import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountPreferencesChangedEvent,
  accountPreferencesStorageKey,
  defaultAccountPreferences,
  normalizeAccountPreferences,
  readAccountPreferences,
  replaceAccountPreferences,
  shouldShowClockTenths,
  writeAccountPreference,
} from './account-preferences.js';

describe('account preferences', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it('defaults to the behavior users had before preferences were configurable', () => {
    expect(readAccountPreferences()).toEqual(defaultAccountPreferences);
  });

  it('defaults inbox email on for absent and invalid values, independently of the bell', () => {
    expect(defaultAccountPreferences).toMatchObject({ inboxEmail: true, inboxBell: true });
    for (const value of [null, [], {}, { inboxEmail: 'false' }, { inboxEmail: 0 }]) {
      expect(normalizeAccountPreferences(value)).toMatchObject({ inboxEmail: true });
    }
    expect(normalizeAccountPreferences({ inboxEmail: false })).toMatchObject({
      inboxEmail: false,
      inboxBell: true,
    });
    expect(normalizeAccountPreferences({ inboxBell: false })).toMatchObject({
      inboxEmail: true,
      inboxBell: false,
    });
  });

  it('round-trips inbox email through local storage and account snapshots', () => {
    writeAccountPreference('inboxEmail', false);
    expect(
      JSON.parse(window.localStorage.getItem(accountPreferencesStorageKey) ?? '{}'),
    ).toMatchObject({ inboxEmail: false, inboxBell: true });
    expect(readAccountPreferences()).toMatchObject({ inboxEmail: false, inboxBell: true });
    expect(replaceAccountPreferences({ inboxEmail: true, inboxBell: false })).toMatchObject({
      inboxEmail: true,
      inboxBell: false,
    });
    expect(readAccountPreferences()).toMatchObject({ inboxEmail: true, inboxBell: false });
  });

  it('normalizes partial or invalid server values without weakening defaults', () => {
    expect(
      normalizeAccountPreferences({
        clockTenths: 'sometimes',
        premoves: false,
        confirmGameActions: 'no',
      }),
    ).toEqual({
      ...defaultAccountPreferences,
      premoves: false,
    });
  });

  it('writes one preference and announces the updated local cache', () => {
    const changed = vi.fn();
    window.addEventListener(accountPreferencesChangedEvent, changed, { once: true });

    expect(writeAccountPreference('premoves', false).premoves).toBe(false);
    expect(readAccountPreferences().premoves).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('replaces stale local values with the signed-in account snapshot', () => {
    writeAccountPreference('inboxBell', false);

    expect(replaceAccountPreferences({ correspondenceBell: false })).toEqual({
      ...defaultAccountPreferences,
      correspondenceBell: false,
    });
  });

  it('shows tenths according to the selected policy', () => {
    replaceAccountPreferences({ clockTenths: 'never' });
    expect(shouldShowClockTenths(2_000, true)).toBe(false);

    replaceAccountPreferences({ clockTenths: 'always' });
    expect(shouldShowClockTenths(60_000, false)).toBe(true);

    replaceAccountPreferences({ clockTenths: 'low-time' });
    expect(shouldShowClockTenths(9_999, true)).toBe(true);
    expect(shouldShowClockTenths(9_999, false)).toBe(false);
    expect(shouldShowClockTenths(10_000, true)).toBe(false);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
