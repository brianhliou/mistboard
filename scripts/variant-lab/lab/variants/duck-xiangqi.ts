// Duck Xiangqi as a lab variant.
//
// The second variant in the lab, and the one that proves the contract holds
// for something other than the control: two-part turns, a piece that is not
// in `board`, an engine notation that repeats the destination, a patched
// binary, and a FEN dialect that differs between kernel and engine. The
// kernel's decisions (D1-D9) are fixed in code, so the rule schema is empty;
// a flip there is a kernel change and a new binary, and the fingerprint will
// say so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  duckXiangqiDuckDestinations,
  duckXiangqiPlacement,
  getDuckXiangqiLegalPieceMoves,
  getDuckXiangqiLegalTurns,
  isDuckXiangqiLegalTurn,
  parseDuckXiangqiFen,
} from '@mistboard/game';
import { REPO_ROOT } from '../artifacts.js';
import { pick } from '../rng.js';
import type { LabKernel, LabVariant } from '../types.js';
import { xiangqiStatus } from './xiangqi.js';

const SQUARE = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

/**
 * FSF's walling notation is `<from><to>,<to><duckTo>`: the second token
 * repeats the piece destination before naming the duck square. Reading the
 * whole second token as the duck square is the obvious wrong guess.
 */
function turnToUci(turn: DuckXiangqiTurn): string {
  return `${turn.from}${turn.to}${turn.duckTo ? `,${turn.to}${turn.duckTo}` : ''}`;
}

function uciToTurn(state: DuckXiangqiGameState, uci: string): DuckXiangqiTurn | null {
  const [piece, wall] = uci.split(',');
  const m = SQUARE.exec(piece ?? '');
  if (!m) return null;
  const from = m[1] as DuckXiangqiSquare;
  const to = m[2] as DuckXiangqiSquare;
  const mover = state.status.type === 'playing' ? state.status.turn : 'red';
  const target = state.board[to];
  // Capturing the general ends the game with no duck placement (D4).
  if (target && target.role === 'general' && target.color !== mover)
    return { from, to, duckTo: null };
  const w = wall ? SQUARE.exec(wall) : null;
  return { from, to, duckTo: (w ? w[2] : null) as DuckXiangqiSquare | null };
}

/** The engine spells the duck as `*` inside the placement; the kernel keeps it in a seventh field. */
function engineFen(state: DuckXiangqiGameState): string {
  let placement = duckXiangqiPlacement(state.board);
  if (state.duck) {
    const file = state.duck.charCodeAt(0) - 97;
    const rank = Number(state.duck.slice(1));
    const rows = placement.split('/');
    const row = rows[10 - rank]!;
    // Expand digits, drop the duck in, re-compress.
    const cells = [...row].flatMap((ch) =>
      /\d/.test(ch) ? Array<string>(Number(ch)).fill('') : [ch],
    );
    cells[file] = '*';
    let out = '';
    let empty = 0;
    for (const cell of cells) {
      if (cell === '') {
        empty += 1;
        continue;
      }
      if (empty) {
        out += String(empty);
        empty = 0;
      }
      out += cell;
    }
    if (empty) out += String(empty);
    rows[10 - rank] = out;
    placement = rows.join('/');
  }
  const turn = state.status.type === 'playing' && state.status.turn === 'black' ? 'b' : 'w';
  return `${placement} ${turn} - - ${state.progressPlies} ${state.moveNumber}`;
}

/** Accept either spelling: `*` in the placement, or the kernel's seventh field. */
function parseEngineFen(fen: string, id: string): DuckXiangqiGameState | null {
  const fields = fen.trim().split(/\s+/);
  let placement = fields[0] ?? '';
  let duck: string = fields[6] ?? '-';
  if (placement.includes('*')) {
    const rows = placement.split('/');
    for (let i = 0; i < rows.length; i += 1) {
      const cells = [...rows[i]!].flatMap((ch) =>
        /\d/.test(ch) ? Array<string>(Number(ch)).fill('') : [ch],
      );
      const at = cells.indexOf('*');
      if (at < 0) continue;
      duck = `${String.fromCharCode(97 + at)}${10 - i}`;
      cells[at] = '';
      let out = '';
      let empty = 0;
      for (const cell of cells) {
        if (cell === '') {
          empty += 1;
          continue;
        }
        if (empty) {
          out += String(empty);
          empty = 0;
        }
        out += cell;
      }
      if (empty) out += String(empty);
      rows[i] = out;
    }
    placement = rows.join('/');
  }
  const kernelFen = [
    placement,
    fields[1] ?? 'w',
    '-',
    '-',
    fields[4] ?? '0',
    fields[5] ?? '1',
    duck,
  ].join(' ');
  const parsed = parseDuckXiangqiFen(kernelFen, id);
  return parsed.ok ? parsed.state : null;
}

function randomTurn(state: DuckXiangqiGameState, rng: () => number): DuckXiangqiTurn | null {
  // Uniform over piece moves, then uniform over duck placements, not over the
  // ~2,554 whole turns: the cross product per ply would dominate a 3,000-game
  // control, and the scheme is the same for both sides so it cannot bias one.
  const moves = getDuckXiangqiLegalPieceMoves(state);
  const mover = state.status.type === 'playing' ? state.status.turn : 'red';
  const order = [...moves];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const move of order) {
    const target = state.board[move.to];
    if (target && target.role === 'general' && target.color !== mover)
      return { ...move, duckTo: null };
    const dests = duckXiangqiDuckDestinations(state.board, state.duck, move.from, move.to);
    const duckTo = pick(dests, rng);
    if (duckTo) return { ...move, duckTo };
  }
  return null;
}

export const duckXiangqiVariant: LabVariant<DuckXiangqiGameState, DuckXiangqiTurn> = {
  id: 'duck-xiangqi',
  title: 'Duck Xiangqi',
  ruleSchema: {},
  // The kernel collapses a general-capturing turn to one node (the game ends,
  // the duck never moves); FSF enumerates a duck placement for it anyway. A
  // perft count past a capturable general therefore differs by convention,
  // not by legality. Move sets compare through `fromUci`, which folds the
  // engine's placements back onto the single kernel turn.
  perftCountsComparable: false,
  create() {
    const kernel: LabKernel<DuckXiangqiGameState, DuckXiangqiTurn> = {
      initial: (id) => createInitialDuckXiangqiState(id),
      status: (state) => xiangqiStatus(state.status),
      legalMoves: (state) => getDuckXiangqiLegalTurns(state),
      apply: (state, turn) => applyDuckXiangqiTurn(state, turn),
      isLegal: (state, turn) => isDuckXiangqiLegalTurn(state, turn),
      randomMove: randomTurn,
      moveKey: turnToUci,
      toUci: turnToUci,
      fromUci: uciToTurn,
      fen: engineFen,
      parseFen: parseEngineFen,
      ply: (state) => state.moveNumber - 1,
    };
    return {
      kernel,
      engine: {
        variant: 'duckxiangqi',
        // The server's own stanza, read rather than copied: one source.
        ini: readFileSync(join(REPO_ROOT, 'apps', 'server', 'src', 'duck-xiangqi.ini'), 'utf8'),
        binary: {
          env: 'MISTBOARD_FSF_DUCK_PATH',
          fallbacks: [join(REPO_ROOT, 'bin', 'fairy-stockfish-duck-xiangqi')],
          label: 'patched Fairy-Stockfish for Duck Xiangqi (see fairy-stockfish-duck-xiangqi.ref)',
        },
      },
    };
  },
  discriminatingPositions: [
    {
      name: 'facing binds the general',
      why: 'D5: stepping onto the open file would leave the generals facing, so the kernel removes the step. Perft from the start array never reaches a facing situation. An engine without royalty (stock FSF on this stanza) allows it.',
      fen: '3k5/9/9/9/9/9/P8/9/9/*3K4 w - - 0 1',
    },
    {
      name: 'pinned duck',
      why: 'D5a: the duck is the only thing between the generals, so it may only move along the open segment of the file. An engine that checks facing once per turn, or never, lets it leave.',
      fen: '3k5/9/9/3*5/9/9/P8/9/9/3K5 w - - 0 1',
    },
    {
      name: 'general attacked, no check',
      why: 'D4: the mover may ignore an attack on its own general; a self-check filter would remove moves here.',
      fen: '3k5/9/9/9/9/3P5/9/1*7/9/r2K4R w - - 0 1',
    },
  ],
};
