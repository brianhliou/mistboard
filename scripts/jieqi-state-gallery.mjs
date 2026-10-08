#!/usr/bin/env node
// Jieqi live-state gallery (dev/test only).
//
// Puts LIVE jieqi rooms into chosen states and screenshots each from a seat, so
// a change to the live jieqi page can be judged before and after. Every state
// is its own room on the local dev pair: the script creates a PvP room over the
// public API, joins both seats over the normal WebSocket protocol, plays the
// state's scripted moves (scripts/lib/jieqi-state-gallery-lib.mjs), then opens
// the room page in headless Chromium holding ONE seat's token. The page and
// the numbers come only from that seat's normal PlayerView: nothing here reads
// the deal or another seat's view.
//
// Reproduce (from the worktree root; the seed pins the deal so the policy
// plies replay identically):
//
//   MISTBOARD_DEV_PORT_BASE=3150 MISTBOARD_DEV_JIEQI_DEAL_SEED=7 nohup npm run dev:memory > /tmp/jieqi-dev.log 2>&1 &
//   node scripts/jieqi-state-gallery.mjs --web http://localhost:3150 --out tmp/jieqi-state-gallery
//
// Then open <out>/index.html. <out>/manifest.json has every room URL with the
// shot seat's token (localStorage key mistboard.seatToken.<roomId>, value
// {"seat","token"}) to open a room by hand. Flags: --states a,c,f (subset),
// --no-shots (rooms and manifest only), --api (default: web port + 1).
//
// Safety: refuses any non-loopback --web/--api (fail closed), and the server
// honours MISTBOARD_DEV_JIEQI_DEAL_SEED only outside a production-like runtime
// (jieqiDealRng in apps/server/src/jieqi-tenant.ts). Rooms stay live after the
// run: (a) and (b) are still in the 30 s first-move window and abort soon
// after; the rest run on a 10+5 clock with the opponent's socket closed (PvP
// disconnect forfeit is off), so the seat to move flags in about ten minutes.

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';

import {
  expandMoves,
  GALLERY_STATES,
  OLD_POOL_NOTE,
  pickPolicyMove,
  pliesPlayed,
  renderGalleryHtml,
  resolveGalleryTargets,
  summarizeView,
  VIEWPORTS,
} from './lib/jieqi-state-gallery-lib.mjs';

const STEP_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const options = { states: null, shots: true, out: 'tmp/jieqi-state-gallery' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--web') options.web = next();
    else if (arg === '--api') options.api = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--states')
      options.states = next()
        .split(',')
        .map((s) => s.trim());
    else if (arg === '--no-shots') options.shots = false;
    else throw new Error(`unknown flag ${arg}`);
  }
  return options;
}

async function createRoom(targets) {
  const response = await fetch(`${targets.api}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameSpecId: 'jieqi',
      mode: 'pvp',
      preferredColor: 'red',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.roomId !== 'string') {
    throw new Error(`room create failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.roomId;
}

// One seat over the real protocol. Keeps the latest frame; waitFor resolves
// on the first frame (or the current one) that satisfies the predicate.
function connectSeat(targets, roomId) {
  const clientId = `gallery-${randomUUID()}`;
  const url = `${targets.ws}/?${new URLSearchParams({ room: roomId, client: clientId })}`;
  const socket = new WebSocket(url);
  const seat = { socket, frame: null, waiters: [] };
  socket.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!frame || !['hello', 'snapshot', 'event-appended'].includes(frame.type)) return;
    if (frame.type === 'hello' || frame.seatToken) seat.hello = seat.hello ?? frame;
    seat.frame = frame;
    seat.waiters = seat.waiters.filter((waiter) => !waiter(frame));
  });
  seat.waitFor = (predicate, label) =>
    new Promise((resolvePromise, reject) => {
      if (seat.frame && predicate(seat.frame)) return resolvePromise(seat.frame);
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        STEP_TIMEOUT_MS,
      );
      seat.waiters.push((frame) => {
        if (!predicate(frame)) return false;
        clearTimeout(timer);
        resolvePromise(frame);
        return true;
      });
    });
  seat.opened = new Promise((resolvePromise, reject) => {
    socket.once('open', resolvePromise);
    socket.once('error', reject);
  });
  return seat;
}

async function playState(targets, state) {
  const roomId = await createRoom(targets);
  const first = connectSeat(targets, roomId);
  await first.opened;
  await first.waitFor((f) => f.type === 'hello', 'first hello');
  const second = connectSeat(targets, roomId);
  await second.opened;
  await second.waitFor((f) => f.type === 'hello', 'second hello');
  const seats = {};
  for (const seat of [first, second]) {
    const { seat: color, seatToken } = seat.hello;
    if ((color !== 'red' && color !== 'black') || typeof seatToken !== 'string') {
      throw new Error(
        `seat assignment failed: ${JSON.stringify({ color, seatToken: !!seatToken })}`,
      );
    }
    seats[color] = { client: seat, token: seatToken };
  }
  if (!seats.red || !seats.black) throw new Error('both seats were not filled');

  const plies = expandMoves(state.moves);
  const played = [];
  for (const [index, ply] of plies.entries()) {
    const expected = index + 1;
    const mover = index % 2 === 0 ? 'red' : 'black';
    const own = await seats[mover].client.waitFor(
      (f) => f.state?.status?.type === 'playing' && pliesPlayed(f.state) === index,
      `${mover} to move at ply ${expected}`,
    );
    const move = ply === 'policy' ? pickPolicyMove(own.state) : ply;
    seats[mover].client.socket.send(JSON.stringify({ type: 'move', from: move.from, to: move.to }));
    for (const color of ['red', 'black']) {
      await seats[color].client.waitFor(
        (f) => f.state?.status?.type !== 'playing' || pliesPlayed(f.state) === expected,
        `${color} to see ply ${expected} (${move.from}-${move.to})`,
      );
    }
    played.push(`${move.from}-${move.to}`);
  }
  const view = seats[state.seat].client.frame.state;
  if (view.status?.type !== 'playing') {
    throw new Error(`state ${state.id} ended the game (${JSON.stringify(view.status)})`);
  }
  return { roomId, seats, played, view };
}

// Values off the rendered page: what the player is actually shown. Selectors
// are the room rail's (live-jieqi.ts renderJieqiMaterial, the shared move list).
function readPage() {
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const pieceLabels = [...document.querySelectorAll('.jieqi-live-board svg.jieqi-piece')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
  const board = { red: { hidden: 0, shown: 0 }, black: { hidden: 0, shown: 0 } };
  for (const label of pieceLabels) {
    const [color] = label.split(' ');
    if (!board[color]) continue;
    board[color][label.endsWith('hidden piece') ? 'hidden' : 'shown'] += 1;
  }
  const tray = (selector) =>
    [...document.querySelectorAll(`${selector} .review-capture-piece`)].map(
      (el) => el.getAttribute('aria-label') ?? '',
    );
  const pool = document.querySelector('.hidden-pool');
  return {
    board,
    capturesTop: tray('.captures-strip-top'),
    capturesBottom: tray('.captures-strip-bottom'),
    moveList: [...document.querySelectorAll('.xiangqi-move-row__move')].map(text).filter(Boolean),
    seats: [...document.querySelectorAll('.round-table__player')].map(text),
    hiddenPoolChildren: pool ? pool.children.length : null,
  };
}

async function shoot(browser, targets, outDir, state, result) {
  const shots = [];
  let readout = null;
  const token = result.seats[state.seat].token;
  for (const width of state.widths ?? ['desktop']) {
    const viewport = VIEWPORTS[width];
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: width === 'mobile' ? 2 : 1,
      isMobile: width === 'mobile',
      hasTouch: width === 'mobile',
    });
    await context.addInitScript(
      ({ roomId, seat, seatToken }) => {
        try {
          window.localStorage.setItem(
            `mistboard.seatToken.${roomId}`,
            JSON.stringify({ seat, token: seatToken }),
          );
        } catch {
          // storage blocked: the page joins as a spectator and the readout says so
        }
      },
      { roomId: result.roomId, seat: state.seat, seatToken: token },
    );
    const page = await context.newPage();
    await page.goto(`${targets.web}/room/${result.roomId}`);
    await page.locator('.jieqi-live-board svg.jieqi-piece').first().waitFor({
      state: 'visible',
      timeout: STEP_TIMEOUT_MS,
    });
    // Seated, not spectating: the bottom seat row reads "You".
    await page
      .locator('.round-table__player--bottom', { hasText: 'You' })
      .waitFor({ timeout: STEP_TIMEOUT_MS });
    await page.waitForTimeout(600);
    if (!readout) readout = await page.evaluate(readPage);
    const file = `state-${state.id}-${width}.png`;
    await page.screenshot({ path: resolve(outDir, file), fullPage: width === 'mobile' });
    shots.push({ width, file, viewport });
    await context.close();
  }
  return { shots, readout };
}

function factsFor(state, result, readout) {
  const summary = summarizeView(result.view, state.seat);
  const other = state.seat === 'red' ? 'black' : 'red';
  const known = (roles) => roles.filter((r) => r !== '?');
  const facts = [
    `Server view for ${state.seat}: ${summary.plies} plies played, ${summary.turn} to move. Board: ${state.seat} ${summary.board[state.seat].faceDown} face-down / ${summary.board[state.seat].revealed} face-up; ${other} ${summary.board[other].faceDown} face-down / ${summary.board[other].revealed} face-up.`,
    `${state.seat} has lost: ${summary.lost[state.seat].join(', ') || 'nothing'} (${known(summary.lost[state.seat]).length} identified). ${other} has lost: ${summary.lost[other].join(', ') || 'nothing'} (${known(summary.lost[other]).length} identified).`,
  ];
  if (readout) {
    const b = readout.board;
    facts.push(
      `Page board: red ${b.red.hidden} face-down / ${b.red.shown} face-up; black ${b.black.hidden} face-down / ${b.black.shown} face-up. Top tray (taken by the opponent): [${readout.capturesTop.join(', ') || 'empty'}]. Bottom tray (taken by you): [${readout.capturesBottom.join(', ') || 'empty'}].`,
      `Page move list: [${readout.moveList.join(' ') || 'empty'}]. Face-down pool panel: ${readout.hiddenPoolChildren ? `${readout.hiddenPoolChildren} rows` : 'empty'}.`,
    );
  }
  return facts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = resolveGalleryTargets({ web: options.web, api: options.api });
  const states = options.states
    ? GALLERY_STATES.filter((state) => options.states.includes(state.id))
    : GALLERY_STATES;
  if (states.length === 0) throw new Error('no states selected');
  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });

  let browser = null;
  if (options.shots) {
    const { launchChromium } = await import('./lib/launch-browser.mjs');
    browser = await launchChromium();
  }
  const entries = [];
  const manifest = [];
  try {
    for (const state of states) {
      const result = await playState(targets, state);
      // Hand the chosen seat to the browser: close the script's socket for it.
      // The other seat stays connected while the page is shot.
      result.seats[state.seat].client.socket.close();
      const shot = browser
        ? await shoot(browser, targets, outDir, state, result)
        : { shots: [], readout: null };
      result.seats[state.seat === 'red' ? 'black' : 'red'].client.socket.close();
      const entry = {
        id: state.id,
        title: state.title,
        scenario: state.scenario,
        reading: state.reading,
        seat: state.seat,
        moveText: result.played.join(' '),
        shots: shot.shots,
        facts: factsFor(state, result, shot.readout),
        readout: shot.readout,
        summary: summarizeView(result.view, state.seat),
      };
      entries.push(entry);
      manifest.push({
        id: state.id,
        roomId: result.roomId,
        url: `${targets.web}/room/${result.roomId}`,
        seat: state.seat,
        seatToken: result.seats[state.seat].token,
        played: result.played,
      });
      console.log(
        `state ${state.id}: ${targets.web}/room/${result.roomId} (${result.played.length} plies)`,
      );
    }
  } finally {
    await browser?.close();
  }
  const command = `node scripts/jieqi-state-gallery.mjs --web ${targets.web} --out ${options.out}${options.states ? ` --states ${options.states.join(',')}` : ''}`;
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    `${JSON.stringify({ entries, rooms: manifest }, null, 2)}\n`,
  );
  if (options.shots) {
    writeFileSync(
      resolve(outDir, 'index.html'),
      renderGalleryHtml({
        entries,
        command,
        generatedAt: new Date().toISOString(),
        note: OLD_POOL_NOTE,
      }),
    );
    console.log(`gallery: ${resolve(outDir, 'index.html')}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
