/**
 * Generic live-room chrome for variant tenants hosted in the shared live shell:
 * two-seat clocks (pregame + armed + turn flash + 100ms tick), abort/forfeit
 * countdowns, the action-status notice, game controls (abort/resign with
 * confirm), and the room-action row (review / rematch / play-again / invite /
 * home). Extracted from the first web tenant room; strings and DOM structure
 * are behavior the room-chrome vitest suite pins.
 *
 * A chrome instance is created once per tenant module
 * (createTenantRoomChrome) and reads live values lazily through the
 * TenantChromeContext accessor functions, so the 100ms ticks always see
 * current state without a full re-render. Board rendering, move lists, replay
 * capture, and sounds stay tenant-owned.
 */

import '../game-shell.css';
import {
  readAccountPreferences,
  shouldShowClockTenths,
  shouldShowFinalClockTenths,
} from '../account-preferences.js';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { applyClockEmphasis, setClockFace } from '../clock-emphasis.js';
import { openConfirmDialog } from '../confirm-dialog.js';
import { type I18nKey, t } from '../i18n/catalog.js';
import { maybePlayLowTimeSound } from '../live-sound.js';
import type { LiveRefs } from '../live-state.js';
import { postGameActions, renderGameResult, resultScore } from '../postgame-panel.js';
import { type ProfileIdentity, playerNameEl, profileTargetFor } from '../profile-link.js';
import { createGameMetaCard, seatResultScores } from '../review/game-meta-card.js';
import { isLikelySignedIn } from '../signed-in-state.js';
import type { VariantMiniId } from '../variant-mini-boards.js';
import { localizedRulesHref } from '../variant-public-surfaces.js';
import { variantMiniIdForRawVariant } from '../variants.js';
import { formatClock, formatDayClock } from '../web-utils.js';
import { capitalize, noticeBody, noticeTitle, presenceDot } from './chrome-dom.js';

// Structural slice of a variant PlayerView the chrome reads (same status shape
// as the server-side TenantGameStatus).
export type TenantWebStatus<C extends string> =
  | { type: 'playing'; turn: C }
  | { type: 'finished'; winner: C | null; reason: string }
  | { type: 'aborted'; reason: string };

export type TenantWebView<C extends string> = {
  id: string;
  status: TenantWebStatus<C>;
  moveNumber: number;
};

import { clockRemainingMs, type TenantWebClock } from './clock-projection.js';

export type { TenantWebClock } from './clock-projection.js';

// Everything a tenant hands the chrome to SAY is a catalog key, never a
// string, so a tenant cannot put an English sentence in front of a zh visitor
// (#427: the room was English end to end because the contract took prose).
// Reason phrases are the in-sentence, lowercase 'result.*' words ("wins by
// {reason}"); seat labels are the shared setup.* colour and move-order words.
export type TenantReasonKey = Extract<I18nKey, `result.${string}`>;
export type TenantSeatKey = Extract<I18nKey, `setup.${string}` | `live.seat${string}`>;

export type WebVariantTenant<C extends string> = {
  // Variant name key ('variant.xiangqi.name').
  displayName: I18nKey;
  // No meta-card icon field: the chrome derives the variant marker from the
  // room's gameSpecId (variants.ts), the same lookup the picker, watch rail and
  // review page use. Tenants used to supply it, and a free-text glyph ('🦆',
  // '象') or a family marker ('xiangqi' on atomic) is what made the room the one
  // surface that showed a different icon.
  // Move order: [first mover, second mover]; also the board's default
  // top-to-bottom reading for a colors[0] viewer.
  colors: readonly C[];
  isColor(value: unknown): value is C;
  // Optional: may this seat act on this view, beyond "it is their turn"?
  //
  // The web mirror of the server's rules.seatMayAct, and it exists for the same
  // reason. Every variant here is strictly alternating, so the default is
  // status.turn === seat. Mahjong is not: a discard opens a window in which up
  // to three other seats may claim, and without this the claim buttons stay
  // dead for exactly the seats being asked to answer.
  //
  // The server decides what is actually legal; this only decides what the
  // client offers. A tenant that widens one without the other gets a button
  // that does nothing, or a legal action with no way to take it.
  seatMayAct?(view: unknown, seat: C): boolean;
  oppositeColor(color: C): C;
  enabled(): boolean;
  reviewUrl(roomId: string): string;
  // The wire's termination reason as an in-sentence phrase key. Total by
  // construction: a tenant's default branch returns 'result.gameRules'.
  reasonPhrase(reason: string): TenantReasonKey;
  // The rejected-room body. Default: 'live.roomNotActive' with the variant name.
  rejectedBody?: I18nKey;
  // The body for a visitor refused a seat at a live game whose class shows
  // spectators nothing until it ends (close reason LIVE_GAME_NO_SEAT_REASON).
  // Default: 'live.roomLiveGameSeatedOnly', which promises the full game at the
  // end; a tenant whose finished room does not reveal (mahjong: no truthView on
  // the server) overrides it with a line that makes no such promise.
  liveGameRejectedBody?: I18nKey;
  spectatorBody: I18nKey;
  selectInstruction: I18nKey;
  // Optional: how to label a seat's player. Default (chess/xiangqi/jieqi):
  // the seat's colour word (setup.red etc.), because the seat name IS the color. Banqi overrides — its seats are
  // first/second mover and the ink is bound by the opening flip, so the label is the bound
  // ink ("Red"/"Black") once flipped, else the move order ("First"/"Second"). The tenant
  // reads its own live view for this; the chrome passes only the seat.
  seatLabel?(seat: C): TenantSeatKey;
  // Optional companion to seatLabel: the INK a seat renders as, for the meta card's
  // player disc. Omit when the seat name IS the color (chess/xiangqi/jieqi)
  // and the chrome passes the seat straight through. Flip variants MUST implement it:
  // their seats are move-order slots and the ink binds on the opening flip, so a raw
  // seat paints the wrong disc for every game whose first flip turns up the opposite
  // color. Return null before the flip binds; the chrome renders a neutral disc rather
  // than guessing. Defined-but-null is meaningfully different from undefined here, so
  // the chrome tests for the method instead of using `?? seat` as a fallback.
  seatInk?(seat: C): string | null;
  // Optional: mark the side-to-move on the unarmed (pregame) clock rows, so the opening
  // "to move" is clear before the clock starts. Default off; banqi opts in because its
  // colors do not exist until the first flip, making the mover otherwise ambiguous.
  showPregameTurn?: boolean;
  // Optional: relabel the side-to-move chip ("to move") for a seat. Return null
  // for the default. Duck Xiangqi says "place duck" while a duck placement is
  // pending, so a two-action turn's second half reads in the same spot as the
  // first, with no extra element and nothing shifting.
  turnChipLabel?(seat: C): I18nKey | null;
};

export type TenantChromeContext<C extends string> = {
  // The room's game spec, for the meta card's rules link.
  gameSpecId?: string;
  // Live (never replay-scrubbed) view, or null before the first frame.
  view(): TenantWebView<C> | null;
  seat(): unknown;
  connectionState(): string;
  // Raw WebSocket close reason behind a 'rejected' state, or '' when the socket
  // never closed. The chrome distinguishes only the reasons that need their own
  // sentence; everything else falls back to the tenant's rejectedBody line.
  closeReason(): string;
  clock(): TenantWebClock<C> | null | undefined;
  timeControl():
    | { initialMs: number; incrementMs: number; daysPerMove?: number }
    | null
    | undefined;
  connectedSeats(): Partial<Record<C, boolean>>;
  // Who holds each seat (client id), empty for an unfilled seat.
  seats(): Partial<Record<C, string>>;
  // Server-resolved player names (account/bot/engine); guests absent, so
  // renderers fall back to "Guest" (or the seat label for an empty seat).
  seatDisplayNames(): Partial<Record<C, string>>;
  seatProfiles(): Partial<Record<C, ProfileIdentity>>;
  abortDeadline(): number | null;
  forfeitDeadline(): number | null;
  // 'pvp' or 'pve' as the tenant reports it. Tenant snapshots never say
  // 'correspondence' (every client narrows roomMode to pve/pvp), so a
  // correspondence room is read off timeControl().daysPerMove instead.
  roomMode(): string;
  room(): string;
  debugRequested(): boolean;
  isReplayLive(): boolean;
  // The viewer's bottom-of-board color (seat when seated, else perspective).
  orientation(): C;
  playAgainRequestBody(): Record<string, unknown>;
  // Post-game rematch block for a seated player, or null to fall back to
  // play-again. Tenant-owned because the shared control reads liveState.
  rematchControls(sendSocket: (payload: unknown) => boolean): HTMLElement | null;
  // The lobby paired this room (snapshot `lobbyMatch`): both players were already
  // waiting, so there is no invite link to share. An absent opponent is shown as
  // still connecting, and the server aborts if they never do.
  lobbyMatch(): boolean;
  // Whether the room is rated (snapshot `rated`); optional so a test ctx may omit it.
  rated?(): boolean;
  // Optional suffix on the meta panel's Variant row (e.g. a time-control
  // label: "Jieqi · 5+5").
  variantDetail?(): string | null;
};

// The instance API is fully variant-erased: every method reads through the
// tenant + context bound at creation.
export type TenantRoomChrome = {
  setRenderTarget(
    refs: LiveRefs,
    callbacks: { reconnectNow: () => void; sendSocket: (payload: unknown) => boolean },
  ): void;
  resetState(): void;
  resetHostPanels(): void;
  renderClocks(): void;
  tickClocks(): void;
  renderMeta(): void;
  renderRoomActions(): void;
  renderActionStatus(): void;
  renderGameControls(): void;
  // The overlay over an empty board: a spinner while the socket opens or
  // reconnects, a still label once the room has refused this connection.
  renderBoardStatus(): void;
  tickCountdowns(): void;
};

export function createTenantRoomChrome<C extends string>(
  tenant: WebVariantTenant<C>,
  ctx: TenantChromeContext<C>,
): TenantRoomChrome {
  let refs: LiveRefs | null = null;
  let sendSocket: (payload: unknown) => boolean = () => false;
  let reconnectNow: () => void = () => {};
  let playAgainStatus: 'idle' | 'creating' | 'failed' = 'idle';
  // Previous active clock color across full clock renders, used to flash the
  // seated player's clock on the turn flip (mirrors the chess clock).
  let lastActiveClockColor: C | null = null;

  function seatColor(): C | null {
    const seat = ctx.seat();
    return tenant.isColor(seat) ? seat : null;
  }

  // A seat's display label: the tenant's ink-aware override (banqi) or the seat name.
  function seatName(color: C): string {
    const key = tenant.seatLabel?.(color) ?? SEAT_WORD_KEYS[color];
    return key ? t(key) : capitalize(color);
  }

  function variantName(): string {
    return t(tenant.displayName);
  }

  function reasonText(reason: string): string {
    return t(tenant.reasonPhrase(reason));
  }

  // A seat's player name for chrome rows: the server-resolved name (account,
  // bot, engine) when known; "You" for the viewer's own anonymous seat
  // (matching the legacy chess clock); "Guest" for anyone else's anonymous
  // seat, the word /games and /watch already use for the same person, so a
  // spectator no longer reads "Red" in the room and "Guest" on the tile; and
  // the seat label only while the seat is empty.
  function playerName(color: C): string {
    const serverName = ctx.seatDisplayNames()[color];
    if (serverName) return serverName;
    if (color === ctx.seat()) return t('live.you');
    return ctx.seats()[color] ? t('watch.guest') : seatName(color);
  }

  function setRenderTarget(
    nextRefs: LiveRefs,
    callbacks: { reconnectNow: () => void; sendSocket: (payload: unknown) => boolean },
  ): void {
    refs = nextRefs;
    sendSocket = callbacks.sendSocket;
    reconnectNow = callbacks.reconnectNow;
  }

  function resetState(): void {
    playAgainStatus = 'idle';
    lastActiveClockColor = null;
  }

  // Hide/clear the chess-only panels of the shared live shell so a tenant room
  // never shows stale host chrome.
  function resetHostPanels(): void {
    if (!refs) return;
    refs.devViewsSection.hidden = true;
    refs.gameControlsSection.hidden = true;
    refs.promotion.hidden = true;
    refs.boardPaused.hidden = true;
    refs.capturesBottom.replaceChildren();
    refs.capturesTop.replaceChildren();
    refs.hiddenPool.replaceChildren();
    refs.clockTop.replaceChildren();
    refs.clockBottom.replaceChildren();
    refs.playerTop.replaceChildren();
    refs.playerBottom.replaceChildren();
    refs.clockNote.hidden = true;
  }

  // Renders the seat player rows (top/bottom of the boxed table, lichess round
  // anatomy) plus the two-seat clock in the shared clock slots. Top is the
  // opponent (relative to the viewer's orientation), bottom is the viewer.
  // Untimed games still get player rows, just no clocks.
  /**
   * Which of the two player panels a seat's line belongs in.
   *
   * With two seats it is move order: first mover on top. With four it cannot
   * be, because three of them would stack into the bottom box alongside the
   * viewer. Above two seats the rule becomes the one a player already expects
   * from the board: you are at the bottom, everybody else is above you.
   */
  function panelFor(color: unknown, index: number): 'top' | 'bottom' {
    if (tenant.colors.length <= 2) return index === 0 ? 'top' : 'bottom';
    return color === ctx.seat() ? 'bottom' : 'top';
  }

  function renderClocks(): void {
    if (!refs) return;
    refs.clockTop.replaceChildren();
    refs.clockBottom.replaceChildren();
    refs.playerTop.replaceChildren();
    refs.playerBottom.replaceChildren();
    refs.clockNote.hidden = true;
    refs.clockNote.textContent = '';

    const timeControl = ctx.timeControl();
    const clock = ctx.clock();
    const view = ctx.view();
    const orientation = ctx.orientation();
    // The seats to render, bottom-most last.
    //
    // This was literally `[oppositeColor(orientation), orientation]`, a
    // two-seat list by construction: at a table of four it named two of the
    // four players and silently dropped the rest. Built from the tenant's own
    // seats it is the same pair for every two-seat variant and the whole table
    // for mahjong.
    const colors: C[] =
      tenant.colors.length <= 2
        ? [tenant.oppositeColor(orientation), orientation]
        : [...tenant.colors.filter((color) => color !== orientation), orientation];
    // A finished game's clock is stopped (no active side, not running) but its
    // times are final, not pregame: render them as real clocks, not dimmed.
    const ended = view?.status.type === 'finished' || view?.status.type === 'aborted';
    const armed = !!clock && (clock.activeColor !== null || clock.runningSince !== null || ended);

    if (!timeControl || !clock || !armed) {
      // Side to move before the clock arms (opt-in; clarifies the opener when seat names
      // aren't colors, e.g. banqi pre-flip).
      const pregameTurn =
        tenant.showPregameTurn && view?.status.type === 'playing' ? view.status.turn : null;
      colors.forEach((color, index) => {
        const isTurn = color === pregameTurn;
        const playerLine = document.createElement('span');
        playerLine.className = isTurn ? 'clock-player-line active' : 'clock-player-line';
        const serverName = ctx.seatDisplayNames()[color];
        // Same seat identity as the armed branch below: the dot and the 'You'
        // fallback belong to the seat, not to the clock. Before this a room read
        // "Black", dot-less, until the clock armed and the same row became "You"
        // with a dot, mid-game.
        playerLine.append(presenceDot(ctx.connectedSeats()[color] ?? false));
        // The seat label is a placeholder for an unnamed seat, so only a
        // server-supplied name carries the seat's profile link.
        playerLine.append(
          playerNameEl(
            playerName(color),
            serverName ? profileTargetFor(ctx.seatProfiles()[color]) : null,
            'clock-name',
          ),
        );
        if (isTurn) {
          const toMove = document.createElement('span');
          toMove.className = 'clock-to-move';
          const chipLabel = tenant.turnChipLabel?.(color) ?? null;
          toMove.textContent = t(chipLabel ?? 'live.toMove');
          if (chipLabel) toMove.dataset.turnLabel = chipLabel;
          toMove.setAttribute('aria-hidden', 'false');
          playerLine.append(toMove);
        }
        (panelFor(color, index) === 'top' ? refs!.playerTop : refs!.playerBottom).append(
          playerLine,
        );
        if (!timeControl) return;
        const row = document.createElement('div');
        row.className = isTurn ? 'pregame active' : 'pregame';
        row.dataset.color = color;
        const time = document.createElement('strong');
        setClockFace(time, formatClock(clock ? clock.remainingMs[color] : timeControl.initialMs));
        row.append(time);
        (index === 0 ? refs!.clockTop : refs!.clockBottom).append(row);
      });
      // No pregame "clock starts after the opening moves" note (Brian,
      // 2026-10-02): the header already names the time control, and the
      // unarmed clocks say the rest.
      refs.clockNote.textContent = '';
      refs.clockNote.hidden = true;
      lastActiveClockColor = null;
      return;
    }

    const displayAt = ctx.isReplayLive() ? Date.now() : (clock.runningSince ?? Date.now());
    const playing = view?.status.type === 'playing';
    const activeColor = playing ? clock.activeColor : null;
    const humanColor = seatColor();
    // Flash fires once on the turn flip into the seated player's clock; skip the
    // first armed render so the initial activation does not flash.
    const flashThisRender =
      playing &&
      humanColor !== null &&
      activeColor === humanColor &&
      lastActiveClockColor !== null &&
      lastActiveClockColor !== humanColor;
    colors.forEach((color, index) => {
      const isActive = activeColor === color;
      const row = document.createElement('div');
      row.dataset.color = color;
      row.className = isActive
        ? flashThisRender
          ? 'clock-time-row active just-activated'
          : 'clock-time-row active'
        : 'clock-time-row';
      const playerLine = document.createElement('span');
      playerLine.className = isActive ? 'clock-player-line active' : 'clock-player-line';
      playerLine.append(presenceDot(ctx.connectedSeats()[color] ?? false));
      // playerName falls back to 'You' / the seat label when the server has no
      // name for the seat; those name nobody, so they stay plain text.
      playerLine.append(
        playerNameEl(
          playerName(color),
          ctx.seatDisplayNames()[color] ? profileTargetFor(ctx.seatProfiles()[color]) : null,
          'clock-name',
        ),
      );
      const toMove = document.createElement('span');
      toMove.className = 'clock-to-move';
      const chipLabel = tenant.turnChipLabel?.(color) ?? null;
      toMove.textContent = t(chipLabel ?? 'live.toMove');
      if (chipLabel) toMove.dataset.turnLabel = chipLabel;
      toMove.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      playerLine.append(toMove);
      const time = document.createElement('strong');
      const remainingMs = clockRemainingMs(clock, color, displayAt);
      // A finished game's final times keep their tenths (lichess), which is
      // also what tells a 0:00 flag from a mate with 0.4 s left.
      setClockFace(
        time,
        formatClock(
          remainingMs,
          ended ? shouldShowFinalClockTenths() : shouldShowClockTenths(remainingMs, isActive),
        ),
      );
      row.append(time);
      applyClockEmphasis(row, remainingMs, timeControl.initialMs);
      const panel = panelFor(color, index);
      (panel === 'top' ? refs!.playerTop : refs!.playerBottom).append(playerLine);
      (panel === 'top' ? refs!.clockTop : refs!.clockBottom).append(row);
    });
    lastActiveClockColor = activeColor;
  }

  // Lightweight per-tick refresh (100ms). Updates only the time text and
  // low-time emphasis on existing rows; falls back to a full clock render if
  // the rows have not been built yet.
  function tickClocks(): void {
    if (!refs) return;
    const clock = ctx.clock();
    const view = ctx.view();
    if (!clock || !ctx.timeControl() || view?.status.type !== 'playing') return;
    if (clock.activeColor === null && clock.runningSince === null) return;
    if (refs.clockTop.children.length === 0 || refs.clockBottom.children.length === 0) {
      renderClocks();
      return;
    }
    const displayAt = ctx.isReplayLive() ? Date.now() : (clock.runningSince ?? Date.now());
    const seatedColor = ctx.isReplayLive() ? seatColor() : null;
    const rows = [...Array.from(refs.clockTop.children), ...Array.from(refs.clockBottom.children)];
    for (const row of rows as HTMLDivElement[]) {
      const color = row.dataset.color;
      if (!tenant.isColor(color)) continue;
      const isActive = clock.activeColor === color;
      const remainingMs = clockRemainingMs(clock, color, displayAt);
      if (color === seatedColor && view) {
        maybePlayLowTimeSound(view.id, remainingMs, ctx.timeControl()?.initialMs ?? null);
      }
      const strong = row.querySelector('strong');
      if (strong) {
        setClockFace(
          strong,
          formatClock(remainingMs, shouldShowClockTenths(remainingMs, isActive)),
        );
      }
      applyClockEmphasis(row, remainingMs, ctx.timeControl()?.initialMs ?? null);
    }
  }

  // "checkmate • Red is victorious": the meta card's status line, and the
  // result block's summary at the end of the move list.
  function finishedStatusLine(
    status: Extract<TenantWebView<C>['status'], { type: 'finished' }>,
  ): string {
    return status.winner
      ? t('result.colorVictorious', {
          reason: reasonText(status.reason),
          color: seatName(status.winner),
        })
      : t('result.drawByReason', { reason: reasonText(status.reason) });
  }

  // The result at the end of the move list (postgame-panel.ts); null clears it.
  function renderResult(view: TenantWebView<C> | null): void {
    if (!refs) return;
    const status = view?.status;
    if (status?.type === 'finished') {
      const winnerIndex = status.winner ? tenant.colors.indexOf(status.winner) : null;
      renderGameResult(refs.actionSection, {
        score: tenant.colors.length === 2 ? resultScore(winnerIndex) : null,
        summary: capitalize(finishedStatusLine(status)),
      });
    } else if (status?.type === 'aborted') {
      renderGameResult(refs.actionSection, { score: null, summary: t('live.statusGameAborted') });
    } else {
      renderGameResult(refs.actionSection, null);
    }
  }

  // Lichess-style meta card: time control + mode headline, variant name, the
  // two seats as player rows (the viewer reads as "You"), and a stateful
  // bottom line (waiting / playing / result).
  function renderMeta(): void {
    if (!refs) return;
    const seat = seatColor();
    const detail = ctx.variantDetail?.() ?? null;
    const view = ctx.view();
    const status = view?.status ?? null;
    const tc = ctx.timeControl();
    // A correspondence room names its allowance; "1440+0" read as a broken clock.
    const days = tc?.daysPerMove;
    const tcLabel = !tc
      ? null
      : typeof days === 'number' && days > 0
        ? days === 1
          ? t('live.oneDayShort')
          : t('live.daysShort', { count: days })
        : `${Math.max(1, Math.round(tc.initialMs / 60_000))}+${Math.round(tc.incrementMs / 1_000)}`;

    let subline: string | null = null;
    let statusLine: string | null = null;
    if (status?.type === 'finished') {
      statusLine = finishedStatusLine(status);
    } else if (status?.type === 'aborted') {
      statusLine = t('live.statusGameAborted');
    } else if (status?.type === 'playing') {
      subline = waitingForOpponent()
        ? t('live.statusWaitingForOpponent')
        : t('live.playingRightNow');
    }

    // The status line above names the winning COLOUR; these score the ROWS, so a
    // finished game says who won without a hop back to the discs. Scored on the
    // seats (status.winner is a seat), which is also what tenant.colors holds.
    const scores = seatResultScores(
      status?.type === 'finished' ? (status.winner ? `${status.winner}-wins` : 'draw') : null,
      tenant.colors,
    );

    const card = createGameMetaCard({
      markerId: roomMarkerId(ctx.gameSpecId),
      // A guest refused a rated seat never receives a snapshot, so the refusal
      // itself is what says the room is rated.
      headline: [
        tcLabel,
        ctx.rated?.() || ctx.closeReason() === 'rated requires account'
          ? t('live.modeRated')
          : t('live.modeCasual'),
      ],
      variantName: detail ? `${variantName()} · ${detail}` : variantName(),
      variantHref: localizedRulesHref(ctx.gameSpecId),
      variantHrefNewTab: true,
      subline,
      players: tenant.colors.map((color, index) => {
        const serverName = ctx.seatDisplayNames()[color];
        return {
          score: scores[index] ?? null,
          // The disc wants the INK, not the seat. When a server display name exists it
          // replaces the ink-aware seatLabel below, so the disc is the ONLY colour cue
          // left on the row — a raw seat here is silently wrong for half of all flip
          // games rather than merely inconsistent.
          color: tenant.seatInk ? tenant.seatInk(color) : color,
          // Same rule as the clock rows: only a server-supplied name links.
          profile: serverName ? profileTargetFor(ctx.seatProfiles()[color]) : null,
          name:
            serverName ??
            (color === seat
              ? t('live.youAre', { color: seatName(color) })
              : ctx.seats()[color]
                ? t('live.guestAre', { color: seatName(color) })
                : seatName(color)),
        };
      }),
      status: statusLine,
    });
    refs.gameInfo.replaceChildren(card.el);
    if (ctx.debugRequested()) {
      refs.roomMeta.textContent = `${variantName()}${seat ? ` · Playing as ${seatName(seat)}` : ''}`;
    }
  }

  // A days-per-move room. Read off the time control the server sends with every
  // snapshot: the tenants' roomMode never says 'correspondence', so the branch
  // that keyed on it was dead in every real room (2026-10-06, a jieqi
  // correspondence game showed the invite and an 86390s countdown).
  function isCorrespondence(): boolean {
    const days = ctx.timeControl()?.daysPerMove;
    return ctx.roomMode() === 'correspondence' || (typeof days === 'number' && days > 0);
  }

  // The pregame opponent seat for a seated viewer, or null when there is no
  // pregame to wait through (not playing, past the first full move, socket
  // down, spectator).
  function pregameOpponent(): C | null {
    const view = ctx.view();
    if (view?.status.type !== 'playing' || view.moveNumber >= 2) return null;
    if (ctx.connectionState() !== 'connected') return null;
    const seat = seatColor();
    return seat === null ? null : tenant.oppositeColor(seat);
  }

  // The invite window: the opponent's seat is UNCLAIMED in a room the viewer
  // shares by link (a friend room, rated or casual). Keyed on the seat, never
  // on the occupant's connection: an opponent who holds the seat (a
  // correspondence player between moves, a friend whose tab dropped, an
  // engine) is not someone to invite. A lobby room has no link to share.
  // Correspondence seeks seat both accounts at accept, so their rooms never
  // open it.
  function inviteWindowOpen(): boolean {
    const opponent = pregameOpponent();
    if (opponent === null || ctx.lobbyMatch()) return false;
    return !ctx.seats()[opponent];
  }

  // A lobby room whose paired opponent has not connected yet: the no-show
  // window (LOBBY_NO_SHOW_ABORT_MS), shown as "waiting", never as an invite.
  function lobbyOpponentMissing(): boolean {
    const opponent = pregameOpponent();
    if (opponent === null || !ctx.lobbyMatch()) return false;
    return ctx.connectedSeats()[opponent] !== true;
  }

  function waitingForOpponent(): boolean {
    return inviteWindowOpen() || lobbyOpponentMissing();
  }

  function renderRoomActions(): void {
    if (!refs) return;
    refs.roomActions.replaceChildren();
    const row = document.createElement('div');
    row.className = 'room-actions-row';
    const view = ctx.view();

    if (view?.status.type === 'finished') {
      // Rematch / New opponent / Review game (postgame-panel.ts). Only a seated
      // player gets the first two: a spectator used to be offered "Play again",
      // which opened a game of their own from someone else's room. Tenants have
      // no mutual PvP rematch yet (rematchControls defaults to null), so a
      // seated PvP player gets New opponent and Review.
      const seated = seatColor() !== null;
      const mode = ctx.roomMode();
      const rematch = !seated
        ? null
        : mode === 'pvp'
          ? ctx.rematchControls(sendSocket)
          : mode === 'pve'
            ? playAgainButton()
            : null;
      refs.roomActions.append(
        postGameActions({
          variant: tenantSpecId(),
          mode,
          seated,
          rematch,
          reviewHref: tenant.reviewUrl(ctx.room()),
        }),
      );
      return;
    }
    // Aborted games offer NO play-again: an instant new room after an abort
    // creates a fresh solo room where the mover can play before the opponent
    // joins. No Home button either (lichess parity): the site nav is the way
    // out, and the empty host collapses its row.
    if (view?.status.type === 'aborted') return;
    // The invite link only while the opponent's seat is unclaimed in a room
    // shared by link: never in a lobby room, a bot game (the engine holds its
    // seat) or a correspondence game (both accounts seated at accept), and not
    // once both seats are taken, where the button used to sit in the column
    // for the whole game (Brian's playtest, 2026-10-02).
    if (!inviteWindowOpen()) return;

    row.append(copyInviteButton());
    refs.roomActions.append(row);
  }

  // The chrome is variant-erased, so the spec id comes off the play-again body
  // the tenant already builds (tenants key it 'gameSpecId'; the chess-shell
  // shape uses 'variant'). Unknown shapes yield undefined, which fails closed
  // into no invite button.
  function tenantSpecId(): string | undefined {
    const body = ctx.playAgainRequestBody();
    if (typeof body.gameSpecId === 'string') return body.gameSpecId;
    if (typeof body.variant === 'string') return body.variant;
    return undefined;
  }

  function copyInviteButton(): HTMLButtonElement {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'primary';
    copy.textContent = t('live.copyInvite');
    copy.addEventListener('click', () => {
      navigator.clipboard
        ?.writeText(window.location.href)
        .then(() => {
          copy.textContent = t('live.linkCopied');
          setTimeout(() => {
            copy.textContent = t('live.copyInvite');
          }, 2000);
        })
        .catch(() => {});
    });
    return copy;
  }

  function playAgainButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = playAgainStatus === 'failed' ? 'danger' : 'primary';
    button.disabled = playAgainStatus === 'creating';
    button.textContent =
      playAgainStatus === 'creating'
        ? t('setup.creating')
        : playAgainStatus === 'failed'
          ? t('live.tryPlayAgain')
          : t('live.rematch');
    button.addEventListener('click', () => {
      void createPlayAgainRoom();
    });
    return button;
  }

  // A bot rematch swaps sides (lichess): the seat opposite this game's. The
  // tenants used to send 'random' (xiangqi, fortress, atomic, duck, crazyhouse,
  // dark xiangqi), so a rematch kept the player's colour half the time; only
  // banqi and jungle alternated, each in its own body. Seat names are the
  // preferredColor tokens for every two-seat tenant (red/black), and on the
  // flip variants they are move order, so this alternates who opens. A table
  // of four (mahjong) keeps the tenant's own body.
  function playAgainBody(): Record<string, unknown> {
    const body = ctx.playAgainRequestBody();
    const seat = seatColor();
    if (seat === null || tenant.colors.length !== 2) return body;
    return { ...body, preferredColor: tenant.oppositeColor(seat) };
  }

  async function createPlayAgainRoom(): Promise<void> {
    playAgainStatus = 'creating';
    renderRoomActions();
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(playAgainBody()),
      });
      if (!response.ok) throw new Error(`play-again failed: ${response.status}`);
      const data = (await response.json()) as { url?: string };
      if (!data.url) throw new Error('play-again did not return a URL');
      window.location.assign(data.url);
    } catch (err) {
      console.warn(err);
      playAgainStatus = 'failed';
      renderRoomActions();
    }
  }

  function renderActionStatus(): void {
    if (!refs) return;
    refs.actionStatus.replaceChildren();
    refs.actionSection.hidden = false;
    const view = ctx.view();
    renderResult(view);
    // During normal connected play, hide the turn notice — the board, clocks,
    // and turn flash already convey whose move it is. Scrubbing the move list
    // stays hidden too: the notice used to appear for a scrubbed replay
    // ("Viewing replay"), which inserted a 70px row into the rail on every
    // step back and pushed the whole table around (2026-09-20). The scrubbed
    // state is carried by the replay controls (the "Last move" button lights
    // up) and by the board itself (a click on it jumps back to live), neither
    // of which changes the layout. The invite window ("Invite opponent") still
    // shows, and a spectator or a finished room keeps the notice as before.
    if (
      view?.status.type === 'playing' &&
      seatColor() !== null &&
      ctx.connectionState() === 'connected' &&
      !waitingForOpponent()
    ) {
      refs.actionSection.hidden = true;
      return;
    }
    // Scrubbed off live, as anyone: the lit jump-to-latest arrow marks it.
    if (!ctx.isReplayLive() && ctx.connectionState() === 'connected') {
      refs.actionSection.hidden = true;
      return;
    }
    // A finished or aborted game says so in the result block at the end of the
    // move list; the notice would repeat it between the list and the actions.
    // Scrubbing a finished game shows no "Viewing replay" notice either: there
    // is no move to make, and the lit jump-to-latest arrow marks the state.
    // A dropped socket does not bring it back: the game is over, the result
    // is on screen, and the socket reconnects on its own. Only a refused or
    // moved session still warrants the notice.
    if (
      (view?.status.type === 'finished' || view?.status.type === 'aborted') &&
      ctx.connectionState() !== 'rejected' &&
      ctx.connectionState() !== 'displaced'
    ) {
      refs.actionSection.hidden = true;
      return;
    }
    const notice = document.createElement('div');

    if (!tenant.enabled()) {
      notice.className = 'action-notice danger';
      notice.append(
        noticeTitle(t('live.roomDisabledTitle', { variant: variantName() })),
        noticeBody(t('live.roomDisabledBody')),
      );
      refs.actionStatus.append(notice);
      return;
    }

    notice.className = `action-notice ${actionTone(view)}`;
    notice.append(noticeTitle(actionTitle(view)), noticeBody(actionBody(view)));
    // An account-gated seat (rated, correspondence): the guest gets a way in.
    // The login href carries this room as the auth referrer, so signing in
    // brings them straight back here and the reconnect seats them.
    if (ctx.connectionState() === 'rejected' && accountGatedRejection()) {
      const signIn = document.createElement('a');
      signIn.href = loginHrefForCurrentPage();
      signIn.textContent = t('live.signInTakeSeat');
      notice.append(signIn);
    }
    // A signed-out visitor may be one of the two players on another device;
    // signing in reclaims an account seat and lands back on this room.
    if (liveGameRejection() && !isLikelySignedIn()) {
      const signIn = document.createElement('a');
      signIn.href = loginHrefForCurrentPage();
      signIn.textContent = t('live.signInIfPlayer');
      notice.append(signIn);
    }
    if (ctx.connectionState() === 'disconnected' || ctx.connectionState() === 'reconnecting') {
      const reconnect = document.createElement('button');
      reconnect.type = 'button';
      reconnect.textContent = t('live.reconnectNow');
      reconnect.addEventListener('click', () => reconnectNow());
      notice.append(reconnect);
    }
    refs.actionStatus.append(notice);
  }

  function actionTone(view: TenantWebView<C> | null): 'danger' | 'default' | 'pending' | 'success' {
    // Not an error: the room is fine, the game is simply not public yet.
    if (liveGameRejection()) return 'default';
    if (ctx.connectionState() === 'rejected' || ctx.connectionState() === 'displaced') {
      return 'danger';
    }
    if (!view || ctx.connectionState() !== 'connected') return 'pending';
    if (!ctx.isReplayLive()) return 'default';
    if (view.status.type === 'playing' && ctx.seat() === view.status.turn) return 'success';
    return 'default';
  }

  // Seat refusals that a sign-in fixes (seat-session.ts); the same pair the
  // Fog Chess room answers with a sign-in link (live-status rejectedSignInHref).
  function accountGatedRejection(): 'rated' | 'correspondence' | null {
    if (ctx.closeReason() === 'rated requires account') return 'rated';
    if (ctx.closeReason() === 'correspondence requires account') return 'correspondence';
    return null;
  }

  // A full room whose class hides the board from spectators until the game
  // ends (fog, concealed hands), refused while live (server variant-tenant/ws.ts).
  function liveGameRejection(): boolean {
    return ctx.connectionState() === 'rejected' && ctx.closeReason() === LIVE_GAME_NO_SEAT_REASON;
  }

  function actionTitle(view: TenantWebView<C> | null): string {
    if (ctx.connectionState() === 'rejected') {
      const gated = accountGatedRejection();
      if (gated === 'rated') return t('live.titleRatedGame');
      if (gated === 'correspondence') return t('correspondence.heading');
      if (liveGameRejection()) return t('live.titleGameInProgress');
      return ctx.closeReason() === 'play disabled'
        ? t('live.titlePlayingOff')
        : t('live.titleRoomUnavailable');
    }
    if (ctx.connectionState() === 'displaced') return t('live.statusSessionMoved');
    if (!view) return t('live.statusConnecting');
    if (!ctx.isReplayLive()) return t('live.titleViewingReplay');
    if (lobbyOpponentMissing()) return t('live.statusWaitingForOpponent');
    if (inviteWindowOpen()) return t('live.titleInviteOpponent');
    if (view.status.type === 'finished') return t('live.titleGameFinished');
    if (view.status.type === 'aborted') return t('live.statusGameAborted');
    if (ctx.seat() === view.status.turn) return t('live.statusYourMove');
    return t('puzzle.toMove', { color: seatName(view.status.turn) });
  }

  function actionBody(view: TenantWebView<C> | null): string {
    if (ctx.connectionState() === 'rejected') {
      // The per-account play lock is not a property of the room, so the tenant's
      // "this room is not active" line would send the player off to create
      // another invite that will be refused the same way. Nor is an account
      // gate: the room is fine, the guest just needs to sign in.
      const gated = accountGatedRejection();
      if (gated === 'rated') return t('live.rejectedRatedAccount');
      if (gated === 'correspondence') return t('live.rejectedCorrespondenceAccount');
      if (liveGameRejection())
        return t(tenant.liveGameRejectedBody ?? 'live.roomLiveGameSeatedOnly');
      return ctx.closeReason() === 'play disabled'
        ? t('live.roomPlayDisabled')
        : t(tenant.rejectedBody ?? 'live.roomNotActive', { variant: variantName() });
    }
    if (ctx.connectionState() === 'displaced') return t('live.roomDisplaced');
    if (!view) return t('live.roomOpeningSocket');
    if (!ctx.isReplayLive()) return t('live.roomReturnToLatest');
    if (lobbyOpponentMissing()) return t('live.roomWaitingOpponentConnect');
    if (inviteWindowOpen()) return t('live.roomInviteBody');
    if (view.status.type === 'finished') {
      const reason = reasonText(view.status.reason);
      return view.status.winner
        ? t('result.colorWinsBy', { color: seatName(view.status.winner), reason })
        : t('result.drawBy', { reason });
    }
    if (view.status.type === 'aborted') {
      return t('live.roomAbortedBody');
    }
    if (ctx.seat() === 'spectator') return t(tenant.spectatorBody);
    if (ctx.seat() === view.status.turn) return t(tenant.selectInstruction);
    return t('live.roomWaitingOpponent');
  }

  function renderGameControls(): void {
    if (!refs) return;
    refs.gameControls.replaceChildren();
    refs.gameControlsSection.hidden = true;
    const view = ctx.view();
    if (view?.status.type !== 'playing' || seatColor() === null) return;

    const children: HTMLElement[] = [];
    const isSideToMove = view.status.turn === ctx.seat();

    if (view.moveNumber < 2) {
      // The abort countdown shows to both seats (timing only, no board state) so
      // the waiting side understands the pause; only the side to move gets the
      // button.
      if (ctx.abortDeadline() !== null) {
        const countdown = document.createElement('span');
        countdown.className = 'abort-countdown';
        countdown.dataset.abortCountdown = '';
        countdown.textContent = abortCountdownText(isSideToMove);
        children.push(countdown);
      }
      if (isSideToMove) {
        const abort = document.createElement('button');
        abort.type = 'button';
        abort.className = 'danger';
        abort.textContent = t('live.abort');
        abort.addEventListener('click', () => {
          if (!readAccountPreferences().confirmGameActions) {
            sendSocket({ type: 'abort' });
            return;
          }
          openConfirmDialog({
            title: t('live.abortTitle'),
            body: t('live.abortRoomBody'),
            confirmLabel: t('live.abort'),
            cancelLabel: t('setup.cancel'),
            confirmTone: 'danger',
            onConfirm: () => sendSocket({ type: 'abort' }),
          });
        });
        children.push(abort);
      }
      refs.gameControls.replaceChildren(...children);
      refs.gameControlsSection.hidden = children.length === 0;
      return;
    }

    // Post-move-1: only the present winning seat receives forfeitDeadline, so
    // this banner always reads from the beneficiary's point of view.
    if (ctx.forfeitDeadline() !== null) {
      const banner = document.createElement('span');
      banner.className = 'forfeit-countdown';
      banner.dataset.forfeitCountdown = '';
      banner.textContent = forfeitCountdownText();
      children.push(banner);
    }
    const resign = document.createElement('button');
    resign.type = 'button';
    resign.className = 'danger';
    resign.textContent = t('live.resign');
    resign.addEventListener('click', () => {
      if (!readAccountPreferences().confirmGameActions) {
        sendSocket({ type: 'resign' });
        return;
      }
      openConfirmDialog({
        title: t('live.resignTitle'),
        body: t('live.resignBody'),
        confirmLabel: t('live.resign'),
        cancelLabel: t('setup.cancel'),
        confirmTone: 'danger',
        onConfirm: () => sendSocket({ type: 'resign' }),
      });
    });
    children.push(resign);
    refs.gameControls.replaceChildren(...children);
    refs.gameControlsSection.hidden = false;
  }

  // Driven by the 100ms tick loop so the abort/forfeit countdowns advance
  // without a full re-render. Only touches existing text; renderGameControls
  // owns creation.
  function tickCountdowns(): void {
    if (!refs) return;
    const view = ctx.view();
    const abortEl = refs.gameControls.querySelector<HTMLElement>('[data-abort-countdown]');
    if (abortEl && view?.status.type === 'playing' && view.moveNumber < 2) {
      abortEl.textContent = abortCountdownText(view.status.turn === ctx.seat());
    }
    const forfeitEl = refs.gameControls.querySelector<HTMLElement>('[data-forfeit-countdown]');
    if (forfeitEl && ctx.forfeitDeadline() !== null) {
      forfeitEl.textContent = forfeitCountdownText();
    }
  }

  function abortCountdownText(isSideToMove: boolean): string {
    const deadline = ctx.abortDeadline();
    const remaining = deadline === null ? 0 : deadline - Date.now();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    // In a lobby room the deadline running while the opponent is away is the
    // no-show window: nobody owes a move yet, they have not arrived.
    if (lobbyOpponentMissing()) {
      return t('live.opponentNotConnectedAbortingIn', { seconds });
    }
    // A correspondence window is the day allowance: "86390s" read as noise.
    // The rule matches the copy: an unmade first move in it aborts the game
    // (pregame-timeout, sweepTenantRoomDeadline), it is not a loss.
    if (isCorrespondence()) {
      // Non-breaking: the narrow table column split "23h / 59m" across lines.
      const time = formatDayClock(remaining).replaceAll(' ', ' ');
      return isSideToMove
        ? t('live.makeFirstMoveAbortingInTime', { time })
        : t('live.waitingFirstMoveAbortingInTime', { time });
    }
    return isSideToMove
      ? t('live.makeFirstMoveAbortingIn', { seconds })
      : t('live.waitingFirstMoveAbortingIn', { seconds });
  }

  function forfeitCountdownText(): string {
    const deadline = ctx.forfeitDeadline();
    const remaining = deadline === null ? 0 : deadline - Date.now();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    return t('live.opponentLeftWinIn', { seconds });
  }

  // The layout ships the overlay as a spinner labelled "Connecting". A refused
  // or moved session is terminal (the socket never reopens), so it gets a still
  // label naming the state instead of a spinner that turns forever.
  function renderBoardStatus(): void {
    if (!refs) return;
    const view = ctx.view();
    refs.boardStatus.hidden = view !== null;
    if (view !== null) return;
    const state = ctx.connectionState();
    const terminal = state === 'rejected' || state === 'displaced';
    let label: string;
    if (terminal) label = actionTitle(view);
    else if (state === 'disconnected' || state === 'reconnecting') {
      label = t('live.statusReconnecting');
    } else label = t('live.statusConnecting');
    // A live game refused to a non-player is not an error; every other refusal
    // keeps the danger tone the chess room uses.
    refs.boardStatus.dataset.tone = terminal && !liveGameRejection() ? 'danger' : 'pending';
    const labelEl = refs.boardStatus.querySelector<HTMLElement>('[data-board-status-label]');
    if (labelEl) labelEl.textContent = label;
    const spinner = refs.boardStatus.querySelector<HTMLElement>('[data-board-status-spinner]');
    if (spinner) spinner.hidden = terminal;
  }

  return {
    setRenderTarget,
    resetState,
    resetHostPanels,
    renderClocks,
    tickClocks,
    renderMeta,
    renderRoomActions,
    renderActionStatus,
    renderGameControls,
    renderBoardStatus,
    tickCountdowns,
  };
}

// The tenant WebSocket's close reason for a visitor with no seat at a live game
// whose class shows spectators nothing while it is played. Mirrors
// TENANT_LIVE_GAME_NO_SEAT_REASON in apps/server/src/variant-tenant/ws.ts.
export const LIVE_GAME_NO_SEAT_REASON = 'live game, no seat';

// Default seat labels when a tenant has no seatLabel hook: the seat name IS
// the colour (xiangqi, jieqi, fortress, duck, atomic, fog xiangqi) or the
// mahjong wind. An unmapped seat falls back to the capitalized token.
const SEAT_WORD_KEYS: Readonly<Record<string, I18nKey>> = {
  red: 'setup.red',
  black: 'setup.black',
  white: 'setup.white',
  blue: 'setup.blue',
  first: 'setup.first',
  second: 'setup.second',
  east: 'live.seatEast',
  south: 'live.seatSouth',
  west: 'live.seatWest',
  north: 'live.seatNorth',
};

/** The meta card's variant marker for a room's game spec (legacy aliases
 *  resolve through their canonical spec). Undefined for a spec that is never
 *  shown as a variant (mahjong): no icon box, never a stand-in glyph. */
export function roomMarkerId(gameSpecId: string | undefined): VariantMiniId | undefined {
  return (gameSpecId && variantMiniIdForRawVariant(gameSpecId)) || undefined;
}
