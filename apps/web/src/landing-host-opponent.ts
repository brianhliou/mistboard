import {
  buildHostPhoto,
  HOST_NAME,
  type HostInfo,
  hostRefusalText,
} from './correspondence-host.js';
import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import { startOptionButton } from './setup-panel-parts.js';

export type LandingPlayWith = 'anyone' | 'host';

/** Whether the Play row shows: Online, by correspondence, the host offer on, and
 *  the viewer is not the host and shares at least one variant with him. */
export function landingHostRowVisible(state: {
  mode: string;
  timeMode: 'realtime' | 'correspondence';
  info: HostInfo | null;
  offeredSpecIds: readonly string[];
}): boolean {
  return (
    state.mode === 'lobby' &&
    state.timeMode === 'correspondence' &&
    state.info !== null &&
    state.info.isHost !== true &&
    state.offeredSpecIds.length > 0
  );
}

/** The Play row of Find opponent by correspondence: Anyone (an open seek) or the
 *  site's author, whose game starts at once on his fixed terms. */
export function buildLandingHostOpponent(options: {
  locale: Locale;
  initial?: LandingPlayWith;
  onChange(): void;
}) {
  const { locale } = options;
  let pick: LandingPlayWith = options.initial ?? 'anyone';
  let info: HostInfo | null = null;

  const section = document.createElement('div');
  section.className = 'landing-setup-section';
  section.hidden = true;
  section.style.display = 'none';
  const toggle = document.createElement('div');
  toggle.className = 'landing-start-options landing-host-opponent';
  toggle.setAttribute('role', 'radiogroup');
  toggle.setAttribute('aria-label', t('setup.playWith', {}, locale));
  const anyone = startOptionButton(t('setup.playAnyone', {}, locale), true);
  anyone.dataset.playWith = 'anyone';
  const host = startOptionButton(HOST_NAME, false);
  host.dataset.playWith = 'host';
  toggle.append(anyone, host);
  section.append(toggle);

  // A capped offer still shows the author, disabled, with the reason on the button.
  const refusal = (): string | null =>
    info && info.canPlay === false && info.isHost !== true ? (info.reason ?? 'host_full') : null;

  const renderHost = () => {
    const photo = buildHostPhoto(24, 'landing-host-opponent-photo');
    const text = document.createElement('span');
    text.className = 'landing-host-opponent-text';
    const name = document.createElement('span');
    name.className = 'landing-start-option-text';
    name.textContent = HOST_NAME;
    text.append(name);
    const reason = refusal();
    if (reason && info) {
      const hint = document.createElement('small');
      hint.className = 'landing-setup-option-hint';
      hint.textContent =
        reason === 'player_limit_reached'
          ? t('setup.hostPlayerLimitShort', { limit: info.limits.perPlayer }, locale)
          : t('setup.hostFullShort', {}, locale);
      text.append(hint);
      host.title = hostRefusalText(reason, info, undefined, locale);
    } else {
      host.removeAttribute('title');
    }
    host.replaceChildren(photo, text);
    host.disabled = reason !== null;
    host.classList.toggle('landing-host-opponent-capped', reason !== null);
  };

  const sync = () => {
    for (const [button, value] of [
      [anyone, 'anyone'],
      [host, 'host'],
    ] as const) {
      button.classList.toggle('selected', pick === value);
      button.setAttribute('aria-checked', String(pick === value));
    }
    options.onChange();
  };
  anyone.addEventListener('click', () => {
    if (pick === 'anyone') return;
    pick = 'anyone';
    sync();
  });
  host.addEventListener('click', () => {
    if (host.disabled || pick === 'host') return;
    pick = 'host';
    sync();
  });
  renderHost();

  return {
    section,
    /** The host offer once it loads; a capped offer falls back to Anyone. */
    setInfo(next: HostInfo | null) {
      info = next;
      if (refusal() !== null || !info) pick = 'anyone';
      renderHost();
      sync();
    },
    info: () => info,
    /** The author is picked and the offer can start a game. */
    hostPicked: () => pick === 'host' && info !== null && refusal() === null,
    summary: () => (pick === 'host' ? HOST_NAME : t('setup.playAnyone', {}, locale)),
  };
}
