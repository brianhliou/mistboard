export const displayPreferenceStorageKey = 'mistboard.displayPreferences.v1';

export const DISPLAY_PREFERENCE_DEFINITIONS = [
  {
    id: 'pieceAnimation',
    kind: 'select',
    defaultValue: 'normal',
    options: ['none', 'fast', 'normal', 'slow'],
  },
  { id: 'materialDifference', kind: 'boolean', defaultValue: true },
  { id: 'boardHighlights', kind: 'boolean', defaultValue: true },
  { id: 'pieceDestinations', kind: 'boolean', defaultValue: true },
  // On/off, not lichess's four modes. Their pieces sit INSIDE squares and leave
  // corner room, so 'inside' costs them nothing; ours sit ON intersections and
  // overhang the margin, so the only workable placement is the reserved gutter.
  // With the gutter always reserved, an 'outside' mode would just draw a smaller
  // board in the same space.
  { id: 'boardCoordinates', kind: 'boolean', defaultValue: false },
  { id: 'moveListWhilePlaying', kind: 'boolean', defaultValue: true },
  {
    id: 'moveNotation',
    kind: 'select',
    defaultValue: 'symbols',
    options: ['symbols', 'letters', 'coordinates'],
  },
  { id: 'zenMode', kind: 'boolean', defaultValue: false },
  { id: 'boardResizeHandle', kind: 'boolean', defaultValue: true },
  { id: 'playerRatings', kind: 'boolean', defaultValue: true },
  { id: 'playerFlairs', kind: 'boolean', defaultValue: true },
] as const;

type DisplayPreferenceDefinition = (typeof DISPLAY_PREFERENCE_DEFINITIONS)[number];
export type DisplayPreferenceId = DisplayPreferenceDefinition['id'];
export type DisplayPreferenceKind = DisplayPreferenceDefinition['kind'];

type BooleanPreferenceDefinition = Extract<DisplayPreferenceDefinition, { kind: 'boolean' }>;
type SelectPreferenceDefinition = Extract<DisplayPreferenceDefinition, { kind: 'select' }>;

type PreferenceValueForDefinition<Definition> = Definition extends { kind: 'boolean' }
  ? boolean
  : Definition extends { options: readonly (infer Value)[] }
    ? Value
    : never;

export type DisplayPreferenceValue<Id extends DisplayPreferenceId = DisplayPreferenceId> =
  PreferenceValueForDefinition<Extract<DisplayPreferenceDefinition, { id: Id }>>;

export type DisplayPreferences = {
  [Definition in DisplayPreferenceDefinition as Definition['id']]: PreferenceValueForDefinition<Definition>;
};

export function readDisplayPreferences(storage: Storage = window.localStorage): DisplayPreferences {
  const parsed = readStoredPreferences(storage);
  return DISPLAY_PREFERENCE_DEFINITIONS.reduce(
    (preferences, definition) => {
      preferences[definition.id] = readPreferenceValue(definition, parsed) as never;
      return preferences;
    },
    { ...defaultDisplayPreferences } as DisplayPreferences,
  );
}

export function writeDisplayPreference<Id extends DisplayPreferenceId>(
  id: Id,
  value: DisplayPreferenceValue<Id>,
  storage: Storage = window.localStorage,
): DisplayPreferences {
  const preferences = readDisplayPreferences(storage);
  (preferences[id] as DisplayPreferenceValue<Id>) = value;
  storage.setItem(displayPreferenceStorageKey, JSON.stringify(preferences));
  window.dispatchEvent(
    new CustomEvent('mistboard:display-preferences-change', { detail: preferences }),
  );
  return preferences;
}

const defaultDisplayPreferences = DISPLAY_PREFERENCE_DEFINITIONS.reduce(
  (preferences, definition) => {
    preferences[definition.id] = definition.defaultValue as never;
    return preferences;
  },
  {} as DisplayPreferences,
);

function readStoredPreferences(storage: Storage): Record<string, unknown> {
  try {
    const raw = storage.getItem(displayPreferenceStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readPreferenceValue(
  definition: DisplayPreferenceDefinition,
  parsed: Record<string, unknown>,
): DisplayPreferenceDefinition['defaultValue'] {
  const value = parsed[definition.id];
  if (definition.kind === 'boolean') {
    return typeof value === 'boolean' ? value : definition.defaultValue;
  }
  return isSelectPreferenceValue(definition, value) ? value : definition.defaultValue;
}

function isSelectPreferenceValue(
  definition: SelectPreferenceDefinition,
  value: unknown,
): value is SelectPreferenceDefinition['defaultValue'] {
  return typeof value === 'string' && definition.options.includes(value as never);
}

export function isBooleanDisplayPreference(
  definition: DisplayPreferenceDefinition,
): definition is BooleanPreferenceDefinition {
  return definition.kind === 'boolean';
}

// Grid boards (chess, jungle, shogi geometry) draw their labels
// INSIDE the edge squares, so unlike the xiangqi family they reserve no gutter
// and nothing resizes when the preference flips. They all read it through here
// so the site-wide toggle cannot silently miss a board again: it reached four
// xiangqi-shaped boards and no others until 2026-08-27 (#308).
export function boardCoordinatesEnabled(): boolean {
  return readDisplayPreferences().boardCoordinates;
}
