import {
  type GameSpec,
  type GameSpecId,
  gameSpecForId,
  gameSpecForLegacyLiveRoom,
  maybeGameSpecForId,
  type TimeClass,
  timeClassForPace,
  type VariantId,
} from '@mistboard/game';
import type { Locale, LocaleResolution } from './i18n/locale.js';

export type GameSpecAnalyticsProps = {
  game_spec: GameSpec['id'];
  family: GameSpec['family'];
  setup: GameSpec['setup'];
  visibility: GameSpec['visibility'];
  rating_pool: GameSpec['ratingPoolBase'];
};

/**
 * Kept as a thin alias: this heuristic USED to live here as a fallback for
 * unofficial paces while the shared classifier did an exact preset lookup. The
 * shared one now runs the same formula for every pace, so the two can no longer
 * disagree. Call sites keep this name; new code can use timeClassFromTimeControl.
 */
export function classifyTimeControl(initialMs: number, incrementMs: number): TimeClass {
  return timeClassForPace(initialMs, incrementMs);
}

function analyticsPropsFromSpec(spec: GameSpec): GameSpecAnalyticsProps {
  return {
    game_spec: spec.id,
    family: spec.family,
    setup: spec.setup,
    visibility: spec.visibility,
    rating_pool: spec.ratingPoolBase,
  };
}

export function gameSpecAnalyticsProps(input: {
  variant?: VariantId | string | null;
}): GameSpecAnalyticsProps {
  return analyticsPropsFromSpec(gameSpecForLegacyLiveRoom(input));
}

// The legacy resolver only covers chess; this resolves any canonical
// game spec (e.g. Dark Xiangqi) so lobby analytics aren't mislabeled chess.
export function gameSpecAnalyticsPropsForId(gameSpecId: GameSpecId): GameSpecAnalyticsProps {
  return analyticsPropsFromSpec(gameSpecForId(gameSpecId));
}

// Same thing for callers holding a plain string, which is what the tenant live
// client gets from its route config. `gameSpecForId` THROWS on an unknown id
// because variant dispatch is fail-closed, and that is right for dispatch and
// wrong here: a measurement call must never be able to take down a live room.
// An unrecognised id yields null, and the caller emits the event without spec
// identity rather than not emitting it at all.
export function maybeGameSpecAnalyticsProps(
  gameSpecId: string | null | undefined,
): GameSpecAnalyticsProps | null {
  const spec = maybeGameSpecForId(gameSpecId);
  return spec ? analyticsPropsFromSpec(spec) : null;
}

export type RoomModeAnalyticsProps = {
  roomMode: 'pvp' | 'pve';
  pve: boolean;
  bot_name: string | null;
};

// `roomMode` has ridden on game_started since the funnel existed, but a
// dashboard tile cannot split human-vs-human from human-vs-bot without a
// boolean to filter on, and nothing ever named the bot. `bot_name` is the
// opponent seat's branded display name where the runtime carries one (the
// tenant stack); the chess stack has no seat names and reports null.
export function roomModeAnalyticsProps(
  roomMode: string | null | undefined,
  botName?: string | null,
): RoomModeAnalyticsProps {
  const pve = roomMode === 'pve';
  return { roomMode: pve ? 'pve' : 'pvp', pve, bot_name: pve ? (botName ?? null) : null };
}

// A path segment that carries a digit or an underscore is an id (room ids,
// game ids, short ids) unless it is a registered game spec (a spec id may
// carry a digit). Everything else is a route word and stays.
const ID_SEGMENT = /[\d_]/;

export function reviewRouteForAnalytics(pathname: string): string {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const normalized = segments.map((segment) =>
    maybeGameSpecForId(segment) || !ID_SEGMENT.test(segment) ? segment : ':id',
  );
  return `/${normalized.join('/')}`;
}

export type ReviewOpenedProps = Partial<GameSpecAnalyticsProps> & {
  review_surface: string;
  route: string;
  variant: string | null;
  has_analysis: boolean;
  page_class: string | null;
  referrer_kind: 'none' | 'same-site' | 'external';
};

// Every game review page builds its chrome from one scaffold, so one call site
// counts them all; the props are derived from the URL rather than threaded
// through eleven adapters. The route is id-stripped so it stays low-cardinality.
export function reviewOpenedProps(input: {
  pathname: string;
  referrer: string;
  origin: string;
  reviewSurface: string;
  hasAnalysis: boolean;
  pageClassName?: string | null;
}): ReviewOpenedProps {
  const segments = input.pathname.split('/').filter((segment) => segment.length > 0);
  const specSegment = segments.find((segment) => maybeGameSpecForId(segment) !== null) ?? null;
  const specProps = maybeGameSpecAnalyticsProps(specSegment);
  const referrerKind =
    input.referrer === ''
      ? 'none'
      : input.referrer.startsWith(input.origin)
        ? 'same-site'
        : 'external';
  return {
    review_surface: input.reviewSurface,
    route: reviewRouteForAnalytics(input.pathname),
    variant: specProps?.game_spec ?? null,
    ...(specProps ?? {}),
    has_analysis: input.hasAnalysis,
    page_class: input.pageClassName ?? null,
    referrer_kind: referrerKind,
  };
}

export type PuzzleAttemptOutcome = 'solved' | 'revealed' | 'abandoned';
export type PuzzleAttemptMode = 'session' | 'embed';

// One event per terminal outcome, mirroring the server-side quality session's
// first terminal outcome so the two counts reconcile. `clean` is a solve with
// no wrong move, hint or reveal before it: a failed-then-solved puzzle still
// counts for a streak, but it is not the same difficulty signal.
export function puzzleAttemptedProps(input: {
  puzzleId: string;
  variant: string;
  themes?: readonly string[];
  rated: boolean;
  mode: PuzzleAttemptMode;
  outcome: PuzzleAttemptOutcome;
  clean: boolean;
}): Record<string, unknown> {
  return {
    puzzle_id: input.puzzleId,
    variant: input.variant,
    ...(maybeGameSpecAnalyticsProps(input.variant) ?? {}),
    themes: [...(input.themes ?? [])],
    rated: input.rated,
    mode: input.mode,
    outcome: input.outcome,
    clean: input.clean,
  };
}

type PostHogLike = {
  capture: (name: string, props?: Record<string, unknown>) => void;
  captureException?: (error: unknown, props?: Record<string, unknown>) => void;
  identify: (distinctId: string, props?: Record<string, unknown>) => void;
  reset: () => void;
};

let posthogInstance: PostHogLike | null = null;
// Actions queued before posthog-js finishes its async import (see main.ts).
// Closures keep capture/identify/reset uniform so ordering is preserved.
const pending: Array<(ph: PostHogLike) => void> = [];

function enqueue(action: (ph: PostHogLike) => void): void {
  if (posthogInstance) {
    action(posthogInstance);
  } else if (import.meta.env.PROD) {
    pending.push(action);
  }
}

export function setPostHogInstance(instance: PostHogLike): void {
  posthogInstance = instance;
  while (pending.length > 0) {
    pending.shift()!(instance);
  }
}

export function track(name: string, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.log('[track]', name, props ?? {});
  }
  enqueue((ph) => ph.capture(name, props));
}

// Report a CAUGHT error to PostHog Error Tracking. posthog's automatic
// capture_exceptions only sees UNHANDLED errors/promise rejections, so any error
// we swallow into a friendly UI panel is invisible to monitoring unless we report
// it here. Groups in Error Tracking the same as an unhandled throw (and rides the
// same before_send filter). No-op in DEV; queues until posthog loads in PROD.
export function captureException(error: unknown, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.error('[captureException]', error, props ?? {});
    return;
  }
  enqueue((ph) => {
    if (ph.captureException) {
      ph.captureException(error, props);
    } else {
      ph.capture('$exception', {
        ...props,
        $exception_message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export type GameLifecycleStatusType = 'pregame' | 'playing' | 'finished' | 'aborted';

export type GameFinishedOutcome = {
  winner: string | null;
  reason: string;
  moveNumber: number;
};

export type GameLifecycleTracker = {
  // Call on every render with the current game status. Emits `game_started` on
  // the first transition into `playing` and `game_finished` on entering
  // `finished`. Repeated calls with the same status are no-ops, so it is safe to
  // drive from a render loop. `baseProps` should carry game-spec/time-control
  // identity (see gameSpecAnalyticsProps) so the funnel is sliceable by variant.
  update: (
    input: {
      statusType: GameLifecycleStatusType;
      baseProps: Record<string, unknown>;
      outcome?: GameFinishedOutcome | null;
    } | null,
  ) => void;
  reset: () => void;
};

// One implementation of the start/finish funnel, shared by every live runtime
// (chess + the tenant clients) so the event schema can't drift between parallel
// stacks. Each caller holds its own instance — state is per-tracker, never
// global, so two runtimes can't bleed transitions into each other.
export function createGameLifecycleTracker(): GameLifecycleTracker {
  let lastStatusType: GameLifecycleStatusType | null = null;
  let playingSinceMs: number | null = null;
  return {
    reset() {
      lastStatusType = null;
      playingSinceMs = null;
    },
    update(input) {
      if (!input) return;
      const { statusType, baseProps } = input;
      if (statusType === lastStatusType) return;
      if (statusType === 'playing' && lastStatusType !== 'playing') {
        playingSinceMs = Date.now();
        track('game_started', baseProps);
      }
      if (statusType === 'finished' && input.outcome) {
        track('game_finished', {
          ...baseProps,
          winner: input.outcome.winner,
          reason: input.outcome.reason,
          moveNumber: input.outcome.moveNumber,
          durationMs: playingSinceMs !== null ? Date.now() - playingSinceMs : null,
        });
        playingSinceMs = null;
      }
      lastStatusType = statusType;
    },
  };
}

// Tie subsequent events to a known account. Idempotent: safe to call on every
// signed-in page load. The distinctId is the canonical users.id so PostHog
// persons line up with DB accounts.
export function identify(distinctId: string, props?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.log('[identify]', distinctId, props ?? {});
  }
  enqueue((ph) => ph.identify(distinctId, props));
}

// Clear the identified person on logout so the next anonymous session isn't
// merged into the prior account.
export function resetIdentity(): void {
  if (import.meta.env.DEV) {
    console.log('[reset]');
  }
  enqueue((ph) => ph.reset());
}

// Which locale the app actually rendered in, and which input decided it. The
// site had no record of this: every event carried the visitor's browser language
// (an input) and none carried the locale served (the output), so "is automatic
// language selection working" was unanswerable.
//
// `source` is what makes it answerable. A person resolving 'browser' and later
// resolving 'stored' at a different locale overrode our guess, which is the
// signal that the detection is wrong for them.
export function trackLocaleResolved(resolution: LocaleResolution): void {
  track('locale_resolved', {
    locale: resolution.locale,
    locale_source: resolution.source,
    browser_tag: resolution.browserTag,
  });
}

// The explicit override, captured directly rather than inferred. This fires
// immediately before a navigation, so it can be lost in flight; the
// 'stored'-sourced locale_resolved on the very next page load is the durable
// record of the same switch. Treat this event as the convenience signal and
// locale_resolved as the source of truth.
export function trackLocaleChanged(from: Locale, to: Locale): void {
  track('locale_changed', { from_locale: from, to_locale: to });
}
