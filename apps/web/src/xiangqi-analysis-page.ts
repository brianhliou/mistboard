// Entry page for the standalone /analysis/xiangqi route. Lichess-shaped: opens the
// interactive board at the START POSITION by default (empty tree — play moves and
// branch straight away). A shareable ?moves= link seeds the board from an imported
// game (the parser auto-detects coordinate, 0-indexed UCI/ICCS/UCCI, WXF, and
// Chinese notation); ?fen= seeds a hand-set position (a composition), with any
// ?moves= then read as coordinate moves from that position.

import { parseStandardXiangqiFen } from '@mistboard/game';
import { importXiangqiGame } from './review/xiangqi-import.js';
import { parseXiangqiCoordinateMoves } from './review/xiangqi-review-model.js';
import { mountXiangqiAnalysis } from './xiangqi-analysis.js';

export function mountXiangqiAnalysisPage(root: HTMLElement, picker?: HTMLElement): void {
  root.classList.add('landing-page');
  const params = new URLSearchParams(window.location.search);
  const fenRaw = params.get('fen');
  // An invalid FEN degrades to the standard start (same posture as a bad
  // ?moves= seed) — the paste path surfaces errors, the link path stays lenient.
  const fenParsed = fenRaw ? parseStandardXiangqiFen(fenRaw) : null;
  const startState = fenParsed?.ok ? fenParsed.state : undefined;
  const raw = params.get('moves');
  // Seed from a shared link if present (a parse error degrades to the legal
  // prefix, or an empty start board); otherwise open the empty board. The
  // multi-format sniffer is anchored at the standard start, so a custom
  // position reads its moves as plain coordinates and lets the replay truncate.
  const moves = raw
    ? startState
      ? parseXiangqiCoordinateMoves(raw).moves
      : importXiangqiGame(raw).moves
    : [];
  // ?ply=0 opens on the line's root instead of its last move: a problem link
  // (the /x/ short links) must not open on its own solution. Only 0 is read;
  // the address bar mirrors the line up to the current move, not a ply.
  mountXiangqiAnalysis(root, moves, {
    title: 'Xiangqi analysis',
    picker,
    startState,
    initialPosition: params.get('ply') === '0' ? 'start' : undefined,
  });
}
