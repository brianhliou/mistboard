import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { XiangqiMove } from './variants-xiangqi.js';
import { createInitialXiangqiState } from './variants-xiangqi.js';
import { importXiangqiGame } from './xiangqi-import.js';
import { formatXiangqiMoves } from './xiangqi-notation-format.js';
import {
  importXiangqiPaste,
  parseXiangqiPgn,
  writeXiangqiPgn,
  xiangqiPgnPlayers,
} from './xiangqi-pgn.js';
import { parseStandardXiangqiFen, standardXiangqiFen } from './xiangqi-position.js';

// The canonical anchor used across the import tests: 炮二平五 = C2.5 = h3->e3.
const OPENING = 'h3e3';

const continuedRecords = JSON.parse(
  readFileSync(
    new URL('../fixtures/xiangqi-notation/adjudicated-records.json', import.meta.url),
    'utf8',
  ),
) as {
  cases: { key: string; reason: string; iccs: string; plies: number; adjudicatedAt: number }[];
};

for (const record of continuedRecords.cases) {
  for (const style of ['coordinate', 'wxf', 'chinese-simplified'] as const) {
    test(`tagged PGN keeps the mainline and variation past ${record.reason} in ${style}`, () => {
      const imported = importXiangqiGame(record.iccs);
      assert.equal(imported.error, undefined);
      assert.equal(imported.moves.length, record.plies);
      const tokens = formatXiangqiMoves(imported.moves, style);
      // Both branches continue beyond the kernel's automatic draw.
      const prefix = tokens.slice(0, record.adjudicatedAt);
      const continuation = tokens.slice(record.adjudicatedAt);
      const text = `[Event "${record.key}"]\n\n${prefix.join(' ')} ${continuation[0]} (${continuation.join(' ')}) ${continuation.slice(1).join(' ')} *`;
      const [game] = parseXiangqiPgn(text);
      assert.ok(game);
      assert.equal(game.error, undefined);
      assert.equal(game.plyCount, record.plies);
      let branchPoint = game.children[0]!;
      for (let ply = 1; ply < record.adjudicatedAt; ply += 1) {
        branchPoint = branchPoint.children[0]!;
      }
      assert.equal(branchPoint.children.length, 2);
      for (let node of branchPoint.children) {
        const moves: XiangqiMove[] = [];
        while (node) {
          moves.push(node.move);
          node = node.children[0]!;
        }
        assert.deepEqual(moves, imported.moves.slice(record.adjudicatedAt));
      }
      const paste = importXiangqiPaste(text);
      assert.equal(paste.error, undefined);
      assert.equal(paste.source, 'pgn');
      assert.deepEqual(paste.moves, imported.moves);
    });
  }
}

test('reads tag pairs and the mainline out of a real PGN wrapper', () => {
  const [game] = parseXiangqiPgn(`[Event "Test Event"]
[Red "Xu Tengfei"]
[Black "Zhou Kaixin"]
[Result "1-0"]

1. h3e3 h8e8 2. h1g3 1-0
`);
  assert.ok(game);
  assert.equal(game.tags.Event, 'Test Event');
  assert.equal(game.tags.Red, 'Xu Tengfei');
  assert.equal(game.result, '1-0');
  assert.equal(game.error, undefined);
  assert.equal(game.plyCount, 3);
  assert.equal(game.children[0]?.move.from, 'h3');
  assert.equal(game.children[0]?.move.to, 'e3');
});

test('move numbers, comments, NAGs and suffix annotations do not reach the sniffer', () => {
  const [game] = parseXiangqiPgn(`1. h3e3 {Central Cannon.} h8e8! $10 2. h1g3?! *`);
  assert.ok(game);
  assert.equal(game.error, undefined);
  assert.equal(game.plyCount, 3);
  assert.equal(game.children[0]?.comment, 'Central Cannon.');
  const second = game.children[0]?.children[0];
  assert.deepEqual(second?.nags, [1, 10]);
  assert.deepEqual(second?.children[0]?.nags, [6]);
});

test('a variation becomes a sibling of the move it replaces, not a continuation', () => {
  const [game] = parseXiangqiPgn('1. h3e3 h8e8 (1... b10c8 2. h1g3) 2. h1g3 *');
  assert.ok(game);
  assert.equal(game.error, undefined);
  const afterFirst = game.children[0];
  // Mainline reply plus one alternative, both branching from the same position.
  assert.equal(afterFirst?.children.length, 2);
  assert.equal(afterFirst?.children[0]?.token, 'h8e8');
  assert.equal(afterFirst?.children[1]?.token, 'b10c8');
  // The variation carries its own continuation.
  assert.equal(afterFirst?.children[1]?.children[0]?.token, 'h1g3');
});

test('nested variations resolve against their own branch point', () => {
  const [game] = parseXiangqiPgn('1. h3e3 h8e8 (1... b10c8 (1... b8c8) 2. h1g3) *');
  assert.ok(game);
  assert.equal(game.error, undefined);
  const alternatives = game.children[0]?.children ?? [];
  assert.deepEqual(
    alternatives.map((node) => node.token),
    ['h8e8', 'b10c8', 'b8c8'],
  );
});

test('the wrapper is notation-agnostic: WXF and Chinese movetext both read', () => {
  const [wxf] = parseXiangqiPgn('[Event "WXF"]\n\n1. C2.5 C8.5 2. H2+3 *');
  assert.equal(wxf?.format, 'wxf');
  assert.equal(wxf?.children[0]?.move.from, 'h3');
  assert.equal(wxf?.children[0]?.move.to, 'e3');

  const [chinese] = parseXiangqiPgn('[Event "CN"]\n\n1. 炮二平五 炮8平5 2. 马二进三 *');
  assert.equal(chinese?.format, 'chinese');
  assert.equal(chinese?.children[0]?.move.from, 'h3');
  assert.equal(chinese?.children[0]?.move.to, 'e3');
});

test('splits a multi-game file at the tag block that follows movetext', () => {
  const games = parseXiangqiPgn(`[Event "One"]
[Result "1-0"]

1. h3e3 h8e8 1-0

[Event "Two"]
[Result "0-1"]

1. b1c3 b10c8 0-1
`);
  assert.equal(games.length, 2);
  assert.equal(games[0]?.tags.Event, 'One');
  assert.equal(games[0]?.result, '1-0');
  assert.equal(games[1]?.tags.Event, 'Two');
  assert.equal(games[1]?.result, '0-1');
  assert.equal(games[1]?.children[0]?.token, 'b1c3');
});

test('a [FEN] tag starts the replay from that position', () => {
  const fen = standardXiangqiFen(createInitialXiangqiState('t'));
  const [game] = parseXiangqiPgn(`[FEN "${fen}"]\n\n1. ${OPENING} *`);
  assert.equal(game?.error, undefined);
  assert.equal(game?.plyCount, 1);

  const [broken] = parseXiangqiPgn('[FEN "not-a-fen"]\n\n1. h3e3 *');
  assert.match(broken?.error ?? '', /\[FEN\] tag/);
  assert.equal(broken?.plyCount, 0);
});

test('a position-only chapter is a success, not a parse failure', () => {
  const [game] = parseXiangqiPgn(
    '[Event "Endgame"]\n[FEN "3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1"]\n\n*',
  );
  assert.ok(game);
  assert.equal(game.error, undefined);
  assert.equal(game.plyCount, 0);
  assert.equal(game.children.length, 0);
});

test('one illegal variation costs that branch, not the rest of the game', () => {
  const [game] = parseXiangqiPgn('1. h3e3 h8e8 (1... a1a2) 2. h1g3 *');
  assert.ok(game);
  // The mainline survives in full...
  assert.equal(game.plyCount, 3);
  // ...and the bad branch is dropped with a reason the UI can show.
  assert.equal(game.children[0]?.children.length, 1);
  assert.match(game.error ?? '', /a1a2/);
});

test('unreadable movetext reports rather than throwing', () => {
  const [game] = parseXiangqiPgn('[Event "Junk"]\n\n1. zz99 qq11 *');
  assert.ok(game);
  assert.equal(game.format, null);
  assert.ok(game.error);
});

// --- writing ------------------------------------------------------------------

test('a game round-trips through write then read', () => {
  const source = `[Event "Round Trip"]
[Red "A"]
[Black "B"]
[Result "1-0"]

1. h3e3 {opening} h8e8! (1... b10c8 2. h1g3) 2. h1g3 $14 1-0
`;
  const [read] = parseXiangqiPgn(source);
  assert.ok(read);
  assert.equal(read.error, undefined);

  const written = writeXiangqiPgn({
    tags: read.tags,
    result: read.result,
    ...(read.comment ? { comment: read.comment } : {}),
    children: read.children,
  });
  const [again] = parseXiangqiPgn(written);
  assert.ok(again);
  assert.equal(again.error, undefined, written);
  assert.equal(again.tags.Event, 'Round Trip');
  assert.equal(again.result, '1-0');
  assert.equal(again.plyCount, read.plyCount);
  assert.equal(again.children[0]?.comment, 'opening');
  // The written tokens carry the coordinate style's dash (h8-e8); what has to
  // survive the trip is the MOVES and the branch shape, not the spelling.
  const replies = again.children[0]?.children ?? [];
  assert.deepEqual(
    replies.map((node) => `${node.move.from}${node.move.to}`),
    ['h8e8', 'b10c8'],
  );
  assert.deepEqual(replies[0]?.nags, [1]);
  assert.deepEqual(replies[0]?.children[0]?.nags, [14]);
});

test('writes the seven-tag roster even when the caller supplies none', () => {
  const [read] = parseXiangqiPgn('1. h3e3 *');
  const written = writeXiangqiPgn({ children: read?.children ?? [] });
  for (const tag of ['Event', 'Site', 'Date', 'Round', 'Red', 'Black', 'Result']) {
    assert.match(written, new RegExp(`\\[${tag} "`), `missing ${tag}`);
  }
  assert.match(written, /\[Date "\?\?\?\?\.\?\?\.\?\?"\]/);
});

test('a custom start position writes SetUp + FEN and round-trips', () => {
  const fen = '3k5/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1';
  const parsed = parseStandardXiangqiFen(fen, 'test');
  assert.ok(parsed.ok);
  const written = writeXiangqiPgn({ children: [], initialState: parsed.state });
  assert.match(written, /\[SetUp "1"\]/);
  const [again] = parseXiangqiPgn(written);
  assert.equal(again?.error, undefined);
});

test('writes WXF movetext when asked, and that still reads back', () => {
  const [read] = parseXiangqiPgn('1. h3e3 h8e8 *');
  const written = writeXiangqiPgn({ children: read?.children ?? [] }, { style: 'wxf' });
  assert.match(written, /C2\.5/);
  const [again] = parseXiangqiPgn(written);
  assert.equal(again?.format, 'wxf');
  assert.equal(again?.children[0]?.move.from, 'h3');
});

test('xiangqiPgnPlayers accepts the White spelling chess tools emit', () => {
  assert.deepEqual(xiangqiPgnPlayers({ White: 'Hu Ronghua', Black: 'Yang Guanlin' }), {
    red: 'Hu Ronghua',
    black: 'Yang Guanlin',
  });
  assert.deepEqual(xiangqiPgnPlayers({ Red: 'A', White: 'B', Black: 'C' }).red, 'A');
});

test('a "?" placeholder is an absent name, not a player called "?"', () => {
  // Our own exporter writes the mandatory tags as "?" when it has no value, so
  // this is what a re-imported export looks like.
  assert.deepEqual(xiangqiPgnPlayers({ Red: '?', Black: '?', Event: 'Study: Chapter 1' }), {
    red: null,
    black: null,
  });
  assert.equal(xiangqiPgnPlayers({ White: '?', Black: 'Yang Guanlin' }).black, 'Yang Guanlin');
});
