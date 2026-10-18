// /lag: "Is Mistboard lagging?", lichess's /lag equivalent. Measures two values
// live from the browser by polling /api/ping: the server's event-loop lag (its
// own `lagMs`, the SERVER readout) and the network round trip minus that
// processing time (the NETWORK readout). No sockets — the same cheap probe the
// account dropdown's connection footer uses. Renders inside the shared /about
// rail + panel shell.

import './lag-page.css';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import { proseHeading, proseParagraph, proseSection, proseSubheading } from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';

type PingResponse = { now: number; lagMs: number };

const POLL_INTERVAL_MS = 1200;
const SAMPLE_WINDOW = 10;
// Rolling-average thresholds (ms) for the verdict + bar colour.
const SERVER_SLOW_MS = 80;
const NETWORK_SLOW_MS = 250;
// Full-scale of the meter bars.
const METER_MAX_MS = 500;

type LagView = {
  section: HTMLElement;
  answer: HTMLElement;
  serverValue: HTMLElement;
  serverFill: HTMLElement;
  networkValue: HTMLElement;
  networkFill: HTMLElement;
};

export function mountLag(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'lag-route');
  const view = buildLag(locale);
  root.append(buildNav(locale), buildStaticPageLayout('lag', view.section, locale));
  startMeasuring(view, locale);
}

function buildLag(locale: Locale = currentLocale()): LagView {
  const section = proseSection('lag-section');

  const answer = document.createElement('p');
  answer.className = 'lag-answer';
  answer.setAttribute('aria-live', 'polite');
  answer.textContent = t('lag.answerMeasuring', {}, locale);

  const server = buildMeterBlock(
    t('lag.serverHeading', {}, locale),
    t('lag.serverExplain', {}, locale),
  );
  const network = buildMeterBlock(
    t('lag.networkHeading', {}, locale),
    t('lag.networkExplain', {}, locale),
  );

  section.append(
    proseHeading(t('lag.heading', {}, locale)),
    answer,
    proseParagraph([t('lag.longAnswer', {}, locale)]),
    server.block,
    network.block,
  );

  return {
    section,
    answer,
    serverValue: server.value,
    serverFill: server.fill,
    networkValue: network.value,
    networkFill: network.fill,
  };
}

function buildMeterBlock(
  title: string,
  explain: string,
): { block: HTMLElement; value: HTMLElement; fill: HTMLElement } {
  const block = document.createElement('section');
  block.className = 'lag-meter-block';

  const meter = document.createElement('div');
  meter.className = 'lag-meter';
  const fill = document.createElement('div');
  fill.className = 'lag-meter-fill';
  meter.append(fill);

  const value = document.createElement('div');
  value.className = 'lag-value';
  value.textContent = '—';

  const row = document.createElement('div');
  row.className = 'lag-meter-row';
  row.append(meter, value);

  block.append(proseSubheading(title), row, proseParagraph([explain]));
  return { block, value, fill };
}

function startMeasuring(view: LagView, locale: Locale): void {
  const serverSamples: number[] = [];
  const networkSamples: number[] = [];
  let stopped = false;

  const tick = async (): Promise<void> => {
    // The SPA detaches this subtree on navigation; stop polling once it is gone.
    if (stopped || !view.section.isConnected) {
      stopped = true;
      return;
    }
    try {
      const start = performance.now();
      const resp = await fetch('/api/ping', { cache: 'no-store' });
      const roundTrip = performance.now() - start;
      if (!resp.ok) throw new Error(`ping failed: ${resp.status}`);
      const data = (await resp.json()) as PingResponse;
      const server = Math.max(0, data.lagMs);
      const network = Math.max(0, roundTrip - server);
      pushSample(serverSamples, server);
      pushSample(networkSamples, network);
      renderReadout(view, average(serverSamples), average(networkSamples), locale);
    } catch {
      renderUnavailable(view, locale);
    }
    if (!stopped && view.section.isConnected) {
      window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }
  };

  void tick();
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_WINDOW) samples.shift();
}

function average(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function renderReadout(view: LagView, server: number, network: number, locale: Locale): void {
  view.serverValue.textContent = formatMs(server, locale);
  view.networkValue.textContent = formatMs(network, locale);
  setMeter(view.serverFill, server, SERVER_SLOW_MS);
  setMeter(view.networkFill, network, NETWORK_SLOW_MS);

  const answerKey =
    server > SERVER_SLOW_MS
      ? 'lag.answerServerBad'
      : network > NETWORK_SLOW_MS
        ? 'lag.answerNetworkBad'
        : 'lag.answerGood';
  view.answer.textContent = t(answerKey, {}, locale);
  view.answer.className = `lag-answer ${answerKey === 'lag.answerGood' ? 'good' : 'bad'}`;
}

function renderUnavailable(view: LagView, locale: Locale): void {
  view.answer.textContent = t('lag.unavailable', {}, locale);
  view.answer.className = 'lag-answer bad';
  view.serverValue.textContent = '—';
  view.networkValue.textContent = '—';
}

function setMeter(fill: HTMLElement, value: number, slowThreshold: number): void {
  const fraction = Math.min(1, value / METER_MAX_MS);
  fill.style.width = `${(fraction * 100).toFixed(1)}%`;
  const status = value >= slowThreshold ? 'bad' : value >= slowThreshold / 2 ? 'ok' : 'good';
  fill.className = `lag-meter-fill ${status}`;
}

function formatMs(value: number, locale: Locale): string {
  return `${Math.round(value)} ${t('lag.unit', {}, locale)}`;
}
