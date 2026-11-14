#!/usr/bin/env node
// Reference client: whole-game JSON snapshots over fetch, no database access.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createInitialXiangqiState,
  formatXiangqiMoves,
  importXiangqiGame,
  importXiangqiPaste,
  parseStandardXiangqiFen,
  positionRepetitionKey,
} from '@mistboard/game';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// Messages the simulator writes itself. None carries the token or a server body,
// so the command line prints them; anything else stays a generic line.
class SimError extends Error {}
export async function runBroadcastPushSim(argv, deps = {}) {
  const { values: v } = parseArgs({
    args: argv,
    options: Object.fromEntries(
      [
        'url',
        'token-file',
        'pgn',
        'moves',
        'round',
        'board',
        'notation',
        'red',
        'black',
        'interval-ms',
      ].map((key) => [key, { type: 'string' }]),
    ),
  });
  if (!v['token-file'] || Boolean(v.pgn) === Boolean(v.moves))
    throw new SimError('Supply --token-file and exactly one of --pgn or --moves.');
  const interval = Number(v['interval-ms'] ?? 2000);
  const board = Number(v.board ?? 1);
  const round = /^\d+$/.test(v.round ?? '1') ? Number(v.round ?? 1) : v.round;
  if (
    !Number.isFinite(interval) ||
    interval < 0 ||
    !Number.isSafeInteger(board) ||
    board < 1 ||
    (typeof round === 'number' && (!Number.isSafeInteger(round) || round < 1)) ||
    round === ''
  )
    throw new SimError('Invalid interval, round or board.');
  const formats = { iccs: 'uci-0indexed', wxf: 'wxf', chinese: 'chinese' };
  if (v.notation && !Object.hasOwn(formats, v.notation)) throw new SimError('Invalid notation.');
  const input = v.pgn ? await readFile(v.pgn, 'utf8') : v.moves;
  const parsed =
    v.moves && v.notation
      ? { ...importXiangqiGame(input, { format: formats[v.notation] }), tags: {} }
      : importXiangqiPaste(input);
  const fen = parsed.startFen ? parseStandardXiangqiFen(parsed.startFen) : null;
  const start = parsed.initialState ?? (fen?.ok ? fen.state : undefined);
  if (
    parsed.error ||
    !parsed.moves.length ||
    (parsed.startFen && !fen?.ok) ||
    (start &&
      positionRepetitionKey(start) !== positionRepetitionKey(createInitialXiangqiState('push-sim')))
  )
    throw new SimError(
      `The input must be a readable game from the standard opening${parsed.error ? `: ${parsed.error}` : '.'}`,
    );
  if (parsed.moves.length > 1000) throw new SimError('The game exceeds 1,000 plies.');
  const red = v.red ?? parsed.tags.Red ?? parsed.tags.White;
  const black = v.black ?? parsed.tags.Black;
  if (!red || !black) throw new SimError('Supply --red and --black or PGN player tags.');
  const notation = v.notation ?? 'iccs';
  const moves = formatXiangqiMoves(
    parsed.moves,
    notation === 'chinese' ? 'chinese-simplified' : notation,
  );
  const token = (await readFile(v['token-file'], 'utf8')).trim();
  if (!/^mbpush_[A-Za-z0-9_-]{43}$/.test(token)) throw new SimError('Invalid token file.');
  const url = new URL('/api/xiangqi/broadcast-push', v.url ?? 'http://localhost:3001');
  const log = deps.log ?? console.log;
  const wait = deps.sleep ?? sleep;
  const request = deps.fetch ?? fetch;
  let seq = 0;
  async function post(count, finished) {
    const body = {
      round,
      board,
      red: { name: red },
      black: { name: black },
      notation,
      moves: moves.slice(0, count),
      status: finished ? 'finished' : 'live',
      ...(finished ? { result: parsed.result } : {}),
      ...(parsed.tags.TimeControl ? { timeControl: parsed.tags.TimeControl } : {}),
      seq: ++seq,
    };
    // Keep a retry's sequence stable. Never display a raw server body or error:
    // a reverse proxy or network exception could echo Authorization.
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await request(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {}
      if (response?.ok) {
        let result;
        try {
          result = await response.json();
        } catch {
          throw new SimError('Push returned an invalid response.');
        }
        if (
          result.ok !== true ||
          !result.game ||
          typeof result.changed !== 'boolean' ||
          !Number.isSafeInteger(result.game.plies)
        )
          throw new SimError('Push returned an invalid response.');
        log(`${response.status} changed=${result.changed} plies=${result.game.plies}`);
        return;
      }
      log(`${response?.status ?? 'network'} changed=- plies=${count}`);
      if (response && response.status < 500 && response.status !== 429) {
        // Only the API's own short error code and ply are shown, never the body.
        let detail = '';
        try {
          const failure = await response.json();
          if (typeof failure?.error === 'string' && /^[a-z_]{1,40}$/.test(failure.error))
            detail = ` ${failure.error}${Number.isSafeInteger(failure.ply) ? ` at ply ${failure.ply}` : ''}`;
        } catch {}
        throw new SimError(`Push failed: HTTP ${response.status}${detail}.`);
      }
      if (attempt >= 5) throw new SimError('Push retries exhausted.');
      const retryAfter = Number(response?.headers.get('Retry-After'));
      await wait(
        response?.status === 429 && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(500 * 2 ** attempt, 30_000),
      );
    }
  }
  for (let count = 1; count <= moves.length; count++) {
    if (count > 1) await wait(interval);
    await post(count, false);
  }
  // Unknown/live PGN results remain live; the API requires a real result for
  // finished. A final snapshot still advances seq for every input.
  await wait(interval);
  await post(moves.length, ['1-0', '0-1', '1/2-1/2'].includes(parsed.result));
  return { plies: moves.length, result: parsed.result ?? '*' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBroadcastPushSim(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof SimError
        ? `Broadcast push simulator failed: ${error.message}`
        : 'Broadcast push simulator failed. Check the input file, the token file path and the server URL.',
    );
    process.exitCode = 1;
  });
}
