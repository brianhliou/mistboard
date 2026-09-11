/**
 * Generic live-room chrome for variant tenants hosted in the shared live shell:
 * two-seat clocks (pregame + armed + turn flash + 100ms tick), abort/forfeit
 * countdowns, the action-status notice, game controls (abort/resign with
 * confirm), and the room-action row (review / rematch / play-again / invite /
 * home). Extracted from the Dark Mini Xiangqi room (the web reference tenant);
 * strings and DOM structure are behavior the DMX vitest suite pins.
 *
 * A chrome instance is created once per tenant module
 * (createTenantRoomChrome) and reads live values lazily through the
 * TenantChromeContext accessor functions, so the 100ms ticks always see
 * current state without a full re-render. Board rendering, move lists, replay
 * capture, and sounds stay tenant-owned.
 */

import '../game-shell.css';
import { readAccountPreferences, shouldShowClockTenths } from '../account-preferences.js';
import { openConfirmDialog } from '../confirm-dialog.js';
import { maybePlayLowTimeSound } from '../live-sound.js';
import type { LiveRefs } from '../live-state.js';
import { postGameInviteButton } from '../postgame-invite.js';
import { type ProfileIdentity, playerNameEl, profileTargetFor } from '../profile-link.js';
import { createGameMetaCard, seatResultScores } from '../review/game-meta-card.js';
import type { VariantMiniId } from '../variant-mini-boards.js';
import { formatClock } from '../web-utils.js';
import { capitalize, noticeBody, noticeTitle, presenceDot, roomLink } from './chrome-dom.js';

// Structural slice of a variant PlayerView the chrome reads (same status shape
// as the server-side TenantGameStatus).
export type TenantWebStatus<C extends string> =
  | { type: 'setup' }
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

export type WebVariantTenant<C extends string> = {
  displayName: string;
  // Meta-card icon: the finalized variant marker, the same icon language the
  // picker, watch rail, puzzles, profile, and the review page's meta card use.
  // Set it on every tenant — the room is the one surface where a game's identity
  // matters most, and a family glyph reads as "some xiangqi" where the marker
  // reads as the exact variant.
  metaMarkerId?: VariantMiniId;
  // Fallback icon glyph, family-canonical (象 xiangqi, 虎 jungle, ☗ shogi,
  // ♔ chess), for tenants with no marker. Omitting both renders no icon box.
  metaGlyph?: string;
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
  reasonPhrase(reason: string): string;
  disabledTitle: string;
  disabledBody: string;
  rejectedBody: string;
  spectatorBody: string;
  selectInstruction: string;
  // Optional: how to label a seat's player. Default (chess/xiangqi/jieqi/crossroads):
  // capitalize(seat), because the seat name IS the color. Banqi overrides — its seats are
  // first/second mover and the ink is bound by the opening flip, so the label is the bound
  // ink ("Red"/"Black") once flipped, else the move order ("First"/"Second"). The tenant
  // reads its own live view for this; the chrome passes only the seat.
  seatLabel?(seat: C): string;
  // Optional companion to seatLabel: the INK a seat renders as, for the meta card's
  // player disc. Omit when the seat name IS the color (chess/xiangqi/jieqi/crossroads)
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
};

export type TenantChromeContext<C extends string> = {
  // Live (never replay-scrubbed) view, or null before the first frame.
  view(): TenantWebView<C> | null;
  seat(): unknown;
  connectionState(): string;
  // Raw WebSocket close reason behind a 'rejected' state, or '' when the socket
  // never closed. The chrome distinguishes only the reasons that need their own
  // sentence; everything else falls back to the tenant's rejectedBody line.
  closeReason(): string;
  clock(): TenantWebClock<C> | null | undefined;
  timeControl(): { initialMs: number; incrementMs: number } | null | undefined;
  connectedSeats(): Partial<Record<C, boolean>>;
  // Server-resolved player names (account/bot/engine); guests absent, so
  // renderers fall back to the seat label.
  seatDisplayNames(): Partial<Record<C, string>>;
  seatProfiles(): Partial<Record<C, ProfileIdentity>>;
  abortDeadline(): number | null;
  forfeitDeadline(): number | null;
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
  // Optional suffix on the meta panel's Variant row (e.g. a time-control
  // label: "Crossroads Chess · 5+5").
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
    return tenant.seatLabel?.(color) ?? capitalize(color);
  }

  // A seat's player name for chrome rows: the server-resolved name (account,
  // bot, engine) when known, else the seat label ("You" for the viewer's own
  // anonymous seat, matching the legacy chess clock).
  function playerName(color: C): string {
    const serverName = ctx.seatDisplayNames()[color];
    if (serverName) return serverName;
    return color === ctx.seat() ? 'You' : seatName(color);
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
    refs.offerSection.hidden = true;
    refs.selectionSection.hidden = true;
    refs.devViewsSection.hidden = true;
    refs.gameControlsSection.hidden = true;
    refs.draftPicker.hidden = true;
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
    const colors: C[] = [tenant.oppositeColor(orientation), orientation];
    const armed = !!clock && (clock.activeColor !== null || clock.runningSince !== null);

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
          toMove.textContent = 'to move';
          toMove.setAttribute('aria-hidden', 'false');
          playerLine.append(toMove);
        }
        (index === 0 ? refs!.playerTop : refs!.playerBottom).append(playerLine);
        if (!timeControl) return;
        const row = document.createElement('div');
        row.className = isTurn ? 'pregame active' : 'pregame';
        row.dataset.color = color;
        const time = document.createElement('strong');
        time.textContent = formatClock(clock ? clock.remainingMs[color] : timeControl.initialMs);
        row.append(time);
        (index === 0 ? refs!.clockTop : refs!.clockBottom).append(row);
      });
      if (timeControl) {
        const incrementSec = Math.round(timeControl.incrementMs / 1000);
        const tcLabel =
          incrementSec > 0
            ? `${formatClock(timeControl.initialMs)}+${incrementSec}`
            : formatClock(timeControl.initialMs);
        // Only show the "clock starts after the opening moves" hint while the game
        // is actually pregame — not once it's finished/aborted (the clock just sits
        // unarmed at the final times, and the hint would be stale).
        const ended = view?.status.type === 'finished' || view?.status.type === 'aborted';
        refs.clockNote.textContent = ended
          ? ''
          : `${tcLabel} · clock starts after the opening moves`;
        refs.clockNote.hidden = ended;
      }
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
      toMove.textContent = 'to move';
      toMove.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      playerLine.append(toMove);
      const time = document.createElement('strong');
      const remainingMs = clockRemainingMs(clock, color, displayAt);
      time.textContent = formatClock(remainingMs, shouldShowClockTenths(remainingMs, isActive));
      row.append(time);
      (index === 0 ? refs!.playerTop : refs!.playerBottom).append(playerLine);
      (index === 0 ? refs!.clockTop : refs!.clockBottom).append(row);
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
        strong.textContent = formatClock(remainingMs, shouldShowClockTenths(remainingMs, isActive));
      }
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
    const tcLabel = tc
      ? `${Math.max(1, Math.round(tc.initialMs / 60_000))}+${Math.round(tc.incrementMs / 1_000)}`
      : null;

    let subline: string | null = null;
    let statusLine: string | null = null;
    if (status?.type === 'finished') {
      statusLine = status.winner
        ? `${tenant.reasonPhrase(status.reason)} • ${seatName(status.winner)} is victorious`
        : `Draw • ${tenant.reasonPhrase(status.reason)}`;
    } else if (status?.type === 'aborted') {
      statusLine = 'Game aborted';
    } else if (status?.type === 'playing') {
      subline = waitingForOpponent() ? 'Waiting for opponent' : 'Playing right now';
    }

    // The status line above names the winning COLOUR; these score the ROWS, so a
    // finished game says who won without a hop back to the discs. Scored on the
    // seats (status.winner is a seat), which is also what tenant.colors holds.
    const scores = seatResultScores(
      status?.type === 'finished' ? (status.winner ? `${status.winner}-wins` : 'draw') : null,
      tenant.colors,
    );

    const card = createGameMetaCard({
      markerId: tenant.metaMarkerId,
      glyph: tenant.metaGlyph,
      headline: [tcLabel, 'Casual'],
      variantName: detail ? `${tenant.displayName} · ${detail}` : tenant.displayName,
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
          name: serverName ?? (color === seat ? `You (${seatName(color)})` : seatName(color)),
        };
      }),
      status: statusLine,
    });
    refs.gameInfo.replaceChildren(card.el);
    if (ctx.debugRequested()) {
      refs.roomMeta.textContent = `${tenant.displayName}${seat ? ` · Playing as ${seatName(seat)}` : ''}`;
    }
  }

  // PvP invite window: the viewer is seated, the game has not really started
  // (no completed first full move), and the opponent's seat has no live
  // connection. Engine seats are reported connected by the server, so PvE
  // rooms never read as waiting.
  function waitingForOpponent(): boolean {
    const view = ctx.view();
    if (view?.status.type !== 'playing' || view.moveNumber >= 2) return false;
    if (ctx.connectionState() !== 'connected') return false;
    const seat = seatColor();
    if (seat === null) return false;
    return ctx.connectedSeats()[tenant.oppositeColor(seat)] !== true;
  }

  function renderRoomActions(): void {
    if (!refs) return;
    refs.roomActions.replaceChildren();
    const row = document.createElement('div');
    row.className = 'room-actions-row';
    const view = ctx.view();

    if (view?.status.type === 'finished' || view?.status.type === 'aborted') {
      // Only finished games have a postgame review (the endpoint 404s otherwise).
      if (view.status.type === 'finished') {
        const review = roomLink('Review game', tenant.reviewUrl(ctx.room()));
        review.className = 'primary';
        row.append(review);
      }
      // Finished PvP games offer a mutual-confirm rematch with colors swapped;
      // PvE and non-seated finished games get an instant new room. Aborted games
      // offer NO play-again — an instant new room after an abort creates a fresh
      // solo room where the mover can play before the opponent joins.
      if (view.status.type === 'finished' && ctx.roomMode() === 'pvp') {
        const rematch = ctx.rematchControls(sendSocket);
        if (rematch) row.append(rematch);
        else row.append(playAgainButton());
      } else if (view.status.type === 'finished') {
        row.append(playAgainButton());
      }
      // A rematch or another bot game reuses the opponent you already had; this
      // is the only post-game action that produces a new human one.
      if (view.status.type === 'finished') {
        const invite = postGameInviteButton(tenantSpecId());
        if (invite) row.append(invite);
      }
      // No Home button (lichess parity): the site nav is the way out of the
      // room. An aborted room can end up with no actions at all — leave the
      // host empty so the wrapper row collapses instead of appending an empty
      // button row.
      if (row.childElementCount > 0) refs.roomActions.append(row);
      return;
    }

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
    if (waitingForOpponent()) copy.className = 'primary';
    copy.textContent = 'Copy invite';
    copy.addEventListener('click', () => {
      navigator.clipboard
        ?.writeText(window.location.href)
        .then(() => {
          copy.textContent = 'Link copied!';
          setTimeout(() => {
            copy.textContent = 'Copy invite';
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
        ? 'Creating'
        : playAgainStatus === 'failed'
          ? 'Try play again'
          : 'Play again';
    button.addEventListener('click', () => {
      void createPlayAgainRoom();
    });
    return button;
  }

  async function createPlayAgainRoom(): Promise<void> {
    playAgainStatus = 'creating';
    renderRoomActions();
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ctx.playAgainRequestBody()),
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
    // During normal connected play, hide the turn notice — the board, clocks,
    // and turn flash already convey whose move it is. Keep it for a scrubbed
    // replay ("Viewing replay") and the invite window ("Invite opponent").
    if (
      view?.status.type === 'playing' &&
      seatColor() !== null &&
      ctx.connectionState() === 'connected' &&
      ctx.isReplayLive() &&
      !waitingForOpponent()
    ) {
      refs.actionSection.hidden = true;
      return;
    }
    const notice = document.createElement('div');

    if (!tenant.enabled()) {
      notice.className = 'action-notice danger';
      notice.append(noticeTitle(tenant.disabledTitle), noticeBody(tenant.disabledBody));
      refs.actionStatus.append(notice);
      return;
    }

    notice.className = `action-notice ${actionTone(view)}`;
    notice.append(noticeTitle(actionTitle(view)), noticeBody(actionBody(view)));
    if (ctx.connectionState() === 'disconnected' || ctx.connectionState() === 'reconnecting') {
      const reconnect = document.createElement('button');
      reconnect.type = 'button';
      reconnect.textContent = 'Reconnect now';
      reconnect.addEventListener('click', () => reconnectNow());
      notice.append(reconnect);
    }
    refs.actionStatus.append(notice);
  }

  function actionTone(view: TenantWebView<C> | null): 'danger' | 'default' | 'pending' | 'success' {
    if (ctx.connectionState() === 'rejected' || ctx.connectionState() === 'displaced') {
      return 'danger';
    }
    if (!view || ctx.connectionState() !== 'connected') return 'pending';
    if (!ctx.isReplayLive()) return 'default';
    if (view.status.type === 'playing' && ctx.seat() === view.status.turn) return 'success';
    return 'default';
  }

  function actionTitle(view: TenantWebView<C> | null): string {
    if (ctx.connectionState() === 'rejected') {
      return ctx.closeReason() === 'play disabled' ? 'Playing is off' : 'Room unavailable';
    }
    if (ctx.connectionState() === 'displaced') return 'Session moved';
    if (!view) return 'Connecting';
    if (!ctx.isReplayLive()) return 'Viewing replay';
    if (waitingForOpponent()) return 'Invite opponent';
    if (view.status.type === 'finished') return 'Game finished';
    if (view.status.type === 'aborted') return 'Game aborted';
    if (view.status.type === 'setup') return 'Formation setup';
    if (ctx.seat() === view.status.turn) return 'Your move';
    return `${seatName(view.status.turn)} to move`;
  }

  function actionBody(view: TenantWebView<C> | null): string {
    if (ctx.connectionState() === 'rejected') {
      // The per-account play lock is not a property of the room, so the tenant's
      // "this room is not active" line would send the player off to create
      // another invite that will be refused the same way.
      return ctx.closeReason() === 'play disabled'
        ? 'This account cannot play games. Sign in with your playing account.'
        : tenant.rejectedBody;
    }
    if (ctx.connectionState() === 'displaced') return 'Another tab reclaimed this seat.';
    if (!view) return 'Opening the room socket.';
    if (!ctx.isReplayLive()) return 'Return to latest before making a move.';
    if (waitingForOpponent()) return 'Copy the invite link and send it to your opponent.';
    if (view.status.type === 'finished') {
      const reason = tenant.reasonPhrase(view.status.reason);
      return view.status.winner
        ? `${seatName(view.status.winner)} wins by ${reason}.`
        : `Draw by ${reason}.`;
    }
    if (view.status.type === 'aborted') {
      return 'This game ended before both sides completed their first move.';
    }
    if (view.status.type === 'setup') return 'Waiting for both formations.';
    if (ctx.seat() === 'spectator') return tenant.spectatorBody;
    if (ctx.seat() === view.status.turn) return tenant.selectInstruction;
    return 'Waiting for the opponent.';
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
        abort.textContent = 'Abort';
        abort.addEventListener('click', () => {
          if (!readAccountPreferences().confirmGameActions) {
            sendSocket({ type: 'abort' });
            return;
          }
          openConfirmDialog({
            title: 'Abort this game?',
            body: 'This ends the room without recording a result.',
            confirmLabel: 'Abort',
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
    resign.textContent = 'Resign';
    resign.addEventListener('click', () => {
      if (!readAccountPreferences().confirmGameActions) {
        sendSocket({ type: 'resign' });
        return;
      }
      openConfirmDialog({
        title: 'Resign this game?',
        body: 'Your opponent wins. This cannot be undone.',
        confirmLabel: 'Resign',
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
    return isSideToMove
      ? `Make your first move, aborting in ${seconds}s`
      : `Waiting for first move, aborting in ${seconds}s`;
  }

  function forfeitCountdownText(): string {
    const deadline = ctx.forfeitDeadline();
    const remaining = deadline === null ? 0 : deadline - Date.now();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    return `Opponent left, you win in ${seconds}s`;
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
    tickCountdowns,
  };
}
