// PING / SERVER latency footer for the account dropdown (lichess pattern). The
// site WebSocket is per-room, so this drives off a tiny GET /api/ping instead:
// the client times the round trip for PING and reads the server's event-loop
// lag for SERVER. Polled only while the dropdown is open (start/stop), so an
// idle tab does no background work.
//
// The ping goes to the host a game socket would use, not the page's origin.
// In prod the page is served through Cloudflare, which can route a visitor
// through a distant edge (Seattle landing in Boston), while games connect to
// socket.mistboard.com directly; timing the page's origin overstated in-game
// latency by 150-470ms in most cities (probed 2026-10-12). Hosts are tried in
// the socket's own order, so a browser that cannot reach the socket host
// (China) falls back to the page's origin, as its games do.

import { t } from './i18n/catalog.js';
import { resolveWebSocketBaseUrls, SOCKET_HOST_SESSION_KEY } from './live-state.js';

export type ConnectionStatus = {
  element: HTMLElement;
  start(): void;
  stop(): void;
};

const POLL_INTERVAL_MS = 2500;
// Shorter than the poll so a host that hangs (blocked rather than refused)
// fails over before the next poll starts.
const PING_TIMEOUT_MS = 2000;
const PING_PATH = '/api/ping';

// The ping URL for each socket base, in the socket's order. A base on the
// page's own host becomes the relative path (same-origin); any other becomes
// an absolute http(s) URL on that host.
export function pingUrlsForSocketBases(bases: string[], pageHost: string): string[] {
  const urls: string[] = [];
  for (const base of bases) {
    let url = PING_PATH;
    try {
      const parsed = new URL(base);
      if (parsed.host !== pageHost) {
        const protocol =
          parsed.protocol === 'wss:' || parsed.protocol === 'https:' ? 'https:' : 'http:';
        url = `${protocol}//${parsed.host}${PING_PATH}`;
      }
    } catch {
      // An unparseable base: the page's origin is the safe reading.
    }
    if (!urls.includes(url)) urls.push(url);
  }
  return urls.length > 0 ? urls : [PING_PATH];
}

// Dev has no separate socket host the browser may read from (the Vite origin
// proxies /api), so it stays same-origin.
export function resolvePingUrls(): string[] {
  if (import.meta.env.DEV) return [PING_PATH];
  return pingUrlsForSocketBases(resolveWebSocketBaseUrls(), window.location.host);
}

function socketSessionOnFallback(): boolean {
  try {
    return window.sessionStorage.getItem(SOCKET_HOST_SESSION_KEY) === 'fallback';
  } catch {
    return false;
  }
}

type PingSample = { rttMs: number; lagMs: number | null };

async function pingOnce(url: string): Promise<PingSample> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const startedAt = performance.now();
    // A simple GET with no custom headers, so a cross-origin ping needs no
    // preflight; no cookies, since the endpoint needs none.
    const resp = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    const rttMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (!resp.ok) throw new Error(`ping ${resp.status}`);
    const data = (await resp.json()) as { lagMs?: number };
    return { rttMs, lagMs: typeof data.lagMs === 'number' ? data.lagMs : null };
  } finally {
    window.clearTimeout(timer);
  }
}

export function createConnectionStatus(): ConnectionStatus {
  const element = document.createElement('div');
  element.className = 'account-nav-status';
  element.setAttribute('aria-label', t('connection.status'));

  const rows = document.createElement('div');
  rows.className = 'account-nav-status-rows';
  const ping = createStatusRow(t('connection.ping'));
  const server = createStatusRow(t('connection.server'));
  rows.append(ping.row, server.row);

  const bars = document.createElement('div');
  bars.className = 'account-nav-status-bars';
  bars.setAttribute('aria-hidden', 'true');
  const barEls: HTMLSpanElement[] = [];
  for (let i = 0; i < 4; i += 1) {
    const bar = document.createElement('span');
    bar.className = 'account-nav-status-bar';
    bars.append(bar);
    barEls.push(bar);
  }

  element.append(rows, bars);

  let timer: number | null = null;
  // Bumped on every stop() and at the start of each measure() so a slow response
  // that resolves after the menu closed (or a newer probe started) is ignored.
  let generation = 0;
  let urls: string[] = [PING_PATH];
  // Which of `urls` the footer is timing. Reset on each open; a failure moves
  // it to the next host for the rest of that open.
  let hostIndex = 0;
  // Hosts pinged since this open. The first request to a host pays DNS, TCP
  // and TLS (or a re-dial after the dropdown sat closed), which a game socket
  // pays once, so that sample is dropped.
  const warmed = new Set<string>();

  function render(rttMs: number | null, lagMs: number | null): void {
    ping.value.textContent = rttMs === null ? '–' : String(rttMs);
    server.value.textContent = lagMs === null ? '–' : String(lagMs);
    const lit = rttMs === null ? 0 : barsForRtt(rttMs);
    const warn = rttMs !== null && rttMs >= 300;
    barEls.forEach((bar, index) => {
      const on = index < lit;
      bar.classList.toggle('lit', on && !warn);
      bar.classList.toggle('warn', on && warn);
    });
  }

  async function measure(): Promise<void> {
    generation += 1;
    const id = generation;
    for (;;) {
      const index = hostIndex;
      const url = urls[index] ?? PING_PATH;
      try {
        let sample = await pingOnce(url);
        if (!warmed.has(url)) {
          warmed.add(url);
          if (id !== generation) return;
          sample = await pingOnce(url);
        }
        if (id !== generation) return;
        render(sample.rttMs, sample.lagMs);
        return;
      } catch {
        // Fail over even if this probe is stale, so the next one starts on a
        // host that answers; only a current probe retries or paints.
        if (hostIndex === index && index < urls.length - 1) {
          hostIndex = index + 1;
          if (id === generation) continue;
        }
        if (id !== generation) return;
        render(null, null);
        return;
      }
    }
  }

  return {
    element,
    start(): void {
      if (timer !== null) return;
      urls = resolvePingUrls();
      warmed.clear();
      hostIndex = urls.length > 1 && socketSessionOnFallback() ? urls.length - 1 : 0;
      void measure();
      timer = window.setInterval(() => void measure(), POLL_INTERVAL_MS);
    },
    stop(): void {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      // Invalidate any in-flight probe so it can't paint after close.
      generation += 1;
    },
  };
}

function createStatusRow(label: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'account-nav-status-row';
  const name = document.createElement('span');
  name.className = 'account-nav-status-label';
  name.textContent = label;
  const value = document.createElement('b');
  value.className = 'account-nav-status-value';
  value.textContent = '–';
  const unit = document.createElement('span');
  unit.className = 'account-nav-status-unit';
  unit.textContent = t('connection.ms');
  row.append(name, value, unit);
  return { row, value };
}

function barsForRtt(rttMs: number): number {
  if (rttMs < 80) return 4;
  if (rttMs < 150) return 3;
  if (rttMs < 300) return 2;
  return 1;
}
