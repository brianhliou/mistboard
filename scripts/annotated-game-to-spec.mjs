#!/usr/bin/env node
// Turn `annotate-game.mjs --json` output into the `xq-replay` spec an article
// embeds.
//
//   node scripts/annotated-game-to-spec.mjs /tmp/ann-zwt.json \
//     --name 赖理兄=Lại Lý Huynh --name 郑惟桐=Zheng Weitong \
//     --event "2015 14th World Xiangqi Championship"
//
// Sides and result come from the SOURCE and cannot be passed in. An earlier
// version took --red/--black/--result, and the first game through it went in
// backwards: dpxq titles read "A 负 B", where A is Red and 负 means A LOST, so
// the winner is the second name. The board rendered the wrong player on the
// wrong colour with the wrong result and looked completely normal. --name only
// renames whoever the source already says is on a side.
//
// The champions article got its specs through a study, because its games were
// already chapters there. These games are not, and creating fifteen chapters to
// convert them straight back out would be ceremony: the analysis output already
// holds everything the spec needs.
//
// Notation, and the reason this is worth saying out loud: the mainline and the
// engine's line are BOTH ICCS with ranks 0-9, and so is the `pv` the analyser
// emits, so nothing here converts coordinates. That is the same convention the
// board renderer and Pikafish use, and the opposite of what the repo's
// uciToIccs helper assumes; a rank shifted by one produces a spec that looks
// entirely normal and replays as nonsense.

import { readFileSync, writeFileSync } from 'node:fs';
import { replayMetadataFromGame } from '../apps/web/src/xiangqi-replay-metadata.js';
import {
  ARBITER_ADJUDICATED_DRAWS,
  applyMove,
  createInitialXiangqiState,
} from '../packages/game/dist/variants-xiangqi.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
if (!file) {
  console.error(
    'usage: annotated-game-to-spec.mjs <annotated.json> --red X --black Y --event Z --result R',
  );
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const rows = data.rows ?? [];
const game = data.game ?? {};

/** Eval AFTER the played move, Red POV, the way the article's notes read it. */
function evalText(row) {
  if (row.mate != null) return `#${row.mate}`;
  if (row.cp == null) return '';
  const pawns = row.cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

const byPly = {};
for (const row of rows) {
  if (!row.symbol || !row.judgment) continue;
  const line = (row.pv ?? []).join(' ');
  const evaluation = evalText(row);
  // Same sentence the champions article carries, so the two read as one voice.
  const note =
    `${row.judgment}: ${row.lost?.toFixed(1)} win% given up` +
    (evaluation ? `, eval ${evaluation} after` : '') +
    '. The engine wanted the line in the sibling branch.';
  byPly[String(row.ply)] = {
    glyph: row.symbol,
    note,
    ...(line ? { line } : {}),
  };
}

// "越南 赖理兄" -> "赖理兄": the federation prefix is the source's, not a name.
function rename(raw) {
  const names = args.reduce((map, a, i) => {
    if (a !== '--name') return map;
    const [zh, en] = (args[i + 1] ?? '').split('=');
    if (zh && en) map.set(zh, en);
    return map;
  }, new Map());
  for (const [zh, en] of names) if ((raw ?? '').includes(zh)) return en;
  return (raw ?? '').split(/\s+/).at(-1) ?? '';
}

const iccs = rows.map((r) => r.uci).join(' ');
const spec = {
  iccs,
  red: rename(game.red),
  black: rename(game.black),
  event: argOf('event', game.event ?? ''),
  resultText: game.result ?? '',
  metadata: replayMetadataFromGame(game),
  // No `engine` field: the boards stopped carrying an engine credit line when
  // it turned out to be the same sentence fifteen times down one page.
  annotations: { byPly },
};

// Pre-flight: replay the spec the way the ARTICLE will, which is not the way the
// harvester verified it. The harvester uses the broadcast converter; the widget
// uses this kernel. Both are honest and they disagree, so the one that decides
// has to be the one that renders. A record that stops early here produces a
// board whose later positions are frozen and whose engine lines silently vanish.
function replayCheck(iccsLine) {
  const conv = (sq) => `${sq[0]}${Number(sq[1]) + 1}`;
  const toMove = (t) => ({ from: conv(t.slice(0, 2)), to: conv(t.slice(2, 4)) });
  const moves = iccsLine.trim().split(/\s+/).filter(Boolean);
  let state = createInitialXiangqiState('spec-check');
  let resumed = 0;
  for (const [index, token] of moves.entries()) {
    if (state.status.type === 'finished' && ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)) {
      state = { ...state, status: { type: 'playing', turn: index % 2 === 0 ? 'red' : 'black' } };
      resumed += 1;
    }
    const next = applyMove(state, toMove(token));
    if (next === state) return { ok: false, at: index + 1, of: moves.length, status: state.status };
    state = next;
  }
  return { ok: true, of: moves.length, resumed };
}

const check = replayCheck(iccs);
if (!check.ok) {
  console.error(
    `this record does not replay under the article's rules: stops at ply ${check.at} of ` +
      `${check.of} (${JSON.stringify(check.status)}). The board would freeze there and its ` +
      'engine lines would be dropped. Pick another game.',
  );
  process.exit(1);
}

const out = argOf('out');
const text = `${JSON.stringify(spec, null, 2)}\n`;
if (out) {
  writeFileSync(out, text);
  console.error(
    `${rows.length} plies, ${Object.keys(byPly).length} judged, ` +
      `${Object.values(byPly).filter((a) => a.line).length} with a line -> ${out}`,
  );
} else {
  process.stdout.write(text);
}
