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
import {
  hasTrackedCorrespondenceStart,
  markCorrespondenceStartTracked,
  takeCorrespondenceStartSource,
  takeGameStartSource,
} from './game-start-source.js';
import type { Locale, LocaleResolution } from './i18n/locale.js';
import { inferredXiangqiPieceSet } from './xiangqi-appearance-storage.js';

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

/** time_class as the funnel reports it: the live classes plus 'correspondence'. */
export type AnalyticsTimeClass = TimeClass | 'correspondence';

/**
 * The time_class a game event carries. A correspondence game is 'correspondence',
 * never the live class its millisecond allowance happens to fall in: a 1-day
 * allowance is 86,400,000 ms, which the pace formula calls 'classical', so until
 * 2026-10-03 every correspondence start reported as a classical game and a
 * PostHog filter on time_class='correspondence' found nothing. Known either from
 * the room's time control (daysPerMove, the tenant stack) or its room mode (the
 * chess stack).
 */
export function analyticsTimeClass(
  timeControl: { initialMs: number; incrementMs: number; daysPerMove?: number } | null | undefined,
  options: { correspondence?: boolean } = {},
): AnalyticsTimeClass | null {
  if (options.correspondence || typeof timeControl?.daysPerMove === 'number') {
    return 'correspondence';
  }
  if (!timeControl) return null;
  return classifyTimeControl(timeControl.initialMs, timeControl.incrementMs);
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
  register?: (props: Record<string, unknown>) => void;
  setPersonProperties?: (props: Record<string, unknown>) => void;
  reset: () => void;
};

// A browser a stats-excluded account (the owner, test accounts) has signed in
// from is marked internal in PostHog two ways: the person gets
// $internal_or_test_user, which the project's default "Internal / Test users"
// cohort filters on (so dashboards drop it with no settings change), and every
// event carries is_internal for SQL. Events still arrive, so the owner's own
// errors keep reaching Error Tracking. The flag is ours, in localStorage,
// because posthog.reset() on sign-out starts a new anonymous person and wipes
// super properties, and the browser is still the owner's after signing out.
const INTERNAL_BROWSER_KEY = 'mistboard-internal-browser';

export function isInternalBrowser(): boolean {
  try {
    return window.localStorage.getItem(INTERNAL_BROWSER_KEY) === '1';
  } catch {
    return false;
  }
}

export function markInternalBrowser(): void {
  try {
    window.localStorage.setItem(INTERNAL_BROWSER_KEY, '1');
  } catch {
    // Storage blocked: tag this page load only.
  }
  enqueue((ph) => tagInternal(ph));
}

function tagInternal(ph: Pick<PostHogLike, 'register' | 'setPersonProperties'>): void {
  ph.register?.({ is_internal: true });
  ph.setPersonProperties?.({ $internal_or_test_user: true });
}

// Called on the live instance before its first event (main.ts) and after every
// reset, so a known internal browser never sends an untagged event.
export function applyInternalTag(ph: Pick<PostHogLike, 'register' | 'setPersonProperties'>): void {
  if (isInternalBrowser()) tagInternal(ph);
}

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

export type GameLifecycleStatusType = 'playing' | 'finished' | 'aborted';

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
        trackGameStarted(baseProps);
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

// A live game is opened once, so the first `playing` render on a page is its
// start. A correspondence game is reopened every day for weeks, and each visit
// is a fresh page whose first render is `playing` again: counted naively, one
// game would start thirty times. So a correspondence start fires once per game
// per browser (remembered by game id), and its entry source can come from the
// long-lived correspondence slot: the player who posted the seek arrives days
// later from an email, long after the ten-minute live source has expired.
function trackGameStarted(baseProps: Record<string, unknown>): void {
  if (baseProps.time_class !== 'correspondence') {
    track('game_started', { ...baseProps, entry_source: takeGameStartSource() });
    return;
  }
  const gameId = typeof baseProps.gameId === 'string' ? baseProps.gameId : null;
  if (gameId && hasTrackedCorrespondenceStart(gameId)) return;
  const liveSource = takeGameStartSource();
  const gameSpec = typeof baseProps.game_spec === 'string' ? baseProps.game_spec : null;
  const entrySource = liveSource !== 'none' ? liveSource : takeCorrespondenceStartSource(gameSpec);
  if (gameId) markCorrespondenceStartTracked(gameId);
  track('game_started', { ...baseProps, entry_source: entrySource });
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
  enqueue((ph) => {
    ph.reset();
    applyInternalTag(ph);
  });
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
    // The piece set this visitor is defaulted to (locale, then country), so
    // games started can be sliced by first-impression board without a
    // per-browser storage read.
    piece_set_default: inferredXiangqiPieceSet(resolution.locale),
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

// The xiangqi move-notation default (algebraic outside zh, Chinese inside) is
// an opinion, not a measurement; this is the one signal that can correct it.
// `from` is what the reader saw before clicking, default included, so a switch
// away from the default is countable.
export function trackNotationChanged(from: string, to: string, path: string): void {
  track('notation_changed', { from_notation: from, to_notation: to, path });
}

// Correspondence funnel (2026-10-02). game_started already fires when a
// correspondence room starts playing, but nothing recorded the two steps before
// it: a seek going up, and someone taking one. `surface` says which page did it
// (the /correspondence inbox, the homepage lobby, a profile challenge, or the
// /challenge accept page), which is the question behind making correspondence
// easier to find. Fired only on the server's 201, never on a re-post that
// returned an existing seek.
export type CorrespondenceSeekKind = 'public' | 'link' | 'direct';

export function trackCorrespondenceSeekPosted(props: {
  gameSpecId: string;
  daysPerMove: number;
  kind: CorrespondenceSeekKind;
  surface: 'correspondence' | 'lobby' | 'profile' | 'home-button';
}): void {
  track('correspondence_seek_posted', props);
}

export function trackCorrespondenceSeekAccepted(props: {
  gameSpecId: string;
  daysPerMove: number;
  surface: 'correspondence' | 'challenge' | 'home-button';
}): void {
  track('correspondence_seek_accepted', props);
}

// The homepage correspondence button (2026-10-03 jieqi test). `button_state` is
// what the visitor saw when they clicked: 'start' (the offer; every guest),
// 'your-move' or 'waiting'. A guest click leads to sign-up, and the quick pair
// then runs on return with `after_auth` true, so clicks -> accounts -> games is
// one funnel on these two events plus the server's signup_completed.
export type CorrespondenceButtonState = 'start' | 'your-move' | 'waiting';

export function trackCorrespondenceButtonClicked(props: {
  buttonState: CorrespondenceButtonState;
  signedIn: boolean;
  locale: Locale;
  gameSpecId: string;
  daysPerMove: number;
}): void {
  track('correspondence_button_clicked', {
    button_state: props.buttonState,
    signed_in: props.signedIn,
    locale: props.locale,
    game_spec: props.gameSpecId,
    days_per_move: props.daysPerMove,
  });
}

export function trackCorrespondenceQuickPair(props: {
  outcome: 'game' | 'seek-posted' | 'seek-existing' | 'error';
  afterAuth: boolean;
  locale: Locale;
  gameSpecId: string;
  daysPerMove: number;
  error?: string | null;
}): void {
  track('correspondence_quick_pair', {
    outcome: props.outcome,
    after_auth: props.afterAuth,
    locale: props.locale,
    game_spec: props.gameSpecId,
    days_per_move: props.daysPerMove,
    error: props.error ?? null,
  });
}
