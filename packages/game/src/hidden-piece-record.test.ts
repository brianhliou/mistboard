// The hidden-piece game record (#484): reveals in the moves, the deal optional,
// and a reference replayer that rebuilds a game from the record alone. Random
// games of all three variants are played through the real kernels, written out
// the way the export writes them, and replayed with and without the deal; both
// must land on the kernel's own final position, and a reveal that disagrees
// with the deal must be caught at its ply.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { banqiStateToDealtFen, banqiStateToEngineFen } from './banqi-fen.js';
import {
  banqiPlyReveal,
  banqiSquareToIcga,
  type HiddenPieceRecord,
  type HiddenPieceRecordPly,
  type HiddenPieceVariant,
  hiddenPiecePgnToken,
  hiddenPieceStartFen,
  icgaSquareToBanqi,
  jieqiPlyReveal,
  jungleFlipPlyReveal,
  parseHiddenPiecePgn,
  parseHiddenPiecePgnGames,
  parseHiddenPiecePgnToken,
  replayHiddenPieceRecord,
  writeHiddenPiecePgn,
} from './hidden-piece-record.js';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
} from './jieqi-fen.js';
import { jungleFlipStateToDealtFen, jungleFlipStateToEngineFen } from './jungle-flip-fen.js';
import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  type BanqiGameState,
  createBanqiDeal,
  createInitialBanqiState,
  getBanqiLegalMoves,
} from './variants-banqi.js';
import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  type JieqiGameState,
} from './variants-jieqi.js';
import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  createJungleFlipDeal,
  getJungleFlipLegalMoves,
  type JungleFlipGameState,
} from './variants-jungle-flip.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Played = {
  record: HiddenPieceRecord & { deal_fen: string };
  finalFen: string;
  finalDealtFen: string;
};

function ply(
  uci: string,
  reveal: {
    revealed: HiddenPieceRecordPly['revealed'];
    capturedHidden: HiddenPieceRecordPly['captured_hidden'];
  },
): HiddenPieceRecordPly {
  return {
    uci,
    ...(reveal.revealed ? { revealed: reveal.revealed } : {}),
    ...(reveal.capturedHidden ? { captured_hidden: reveal.capturedHidden } : {}),
  };
}

function playJieqi(seed: number, maxPlies: number): Played {
  const rng = mulberry32(seed);
  let state: JieqiGameState = createInitialJieqiState('g', createJieqiDeal(rng));
  const dealFen = jieqiStateToDealtFen(state);
  const plies: HiddenPieceRecordPly[] = [];
  while (state.status.type === 'playing' && plies.length < maxPlies) {
    const moves = getJieqiLegalMoves(state);
    const move = moves[Math.floor(rng() * moves.length)]!;
    plies.push(ply(jieqiMoveToPikafishUci(move), jieqiPlyReveal(state, move)));
    state = applyJieqiMove(state, move);
  }
  return {
    record: { variant: 'jieqi', deal_fen: dealFen, plies },
    finalFen: jieqiStateToPikafishFen(state),
    finalDealtFen: jieqiStateToDealtFen(state),
  };
}

function flipUci(move: { from: string; to: string }): string {
  return move.from === move.to ? `@${move.from}` : `${move.from}${move.to}`;
}

function playBanqi(seed: number, maxPlies: number): Played {
  const rng = mulberry32(seed);
  let state: BanqiGameState = createInitialBanqiState('g', createBanqiDeal(rng));
  const dealFen = banqiStateToDealtFen(state);
  const plies: HiddenPieceRecordPly[] = [];
  while (state.status.type === 'playing' && plies.length < maxPlies) {
    const moves = getBanqiLegalMoves(state);
    const move = moves[Math.floor(rng() * moves.length)]!;
    plies.push(ply(flipUci(move), banqiPlyReveal(state, move)));
    state = applyBanqiMove(state, move);
  }
  return {
    record: { variant: 'banqi', deal_fen: dealFen, plies },
    finalFen: banqiStateToEngineFen(state),
    finalDealtFen: banqiStateToDealtFen(state),
  };
}

function playJungleFlip(seed: number, maxPlies: number): Played {
  const rng = mulberry32(seed);
  let state: JungleFlipGameState = createInitialJungleFlipState('g', createJungleFlipDeal(rng));
  const dealFen = jungleFlipStateToDealtFen(state);
  const plies: HiddenPieceRecordPly[] = [];
  while (state.status.type === 'playing' && plies.length < maxPlies) {
    const moves = getJungleFlipLegalMoves(state);
    const move = moves[Math.floor(rng() * moves.length)]!;
    plies.push(ply(flipUci(move), jungleFlipPlyReveal(state, move)));
    state = applyJungleFlipMove(state, move);
  }
  return {
    record: { variant: 'jungle-flip', deal_fen: dealFen, plies },
    finalFen: jungleFlipStateToEngineFen(state),
    finalDealtFen: jungleFlipStateToDealtFen(state),
  };
}

const PLAYERS: Record<HiddenPieceVariant, (seed: number, maxPlies: number) => Played> = {
  jieqi: playJieqi,
  banqi: playBanqi,
  'jungle-flip': playJungleFlip,
};

for (const [variant, play] of Object.entries(PLAYERS)) {
  test(`${variant}: a random game replays from its moves alone and from its deal, to the kernel's final position`, () => {
    let hiddenCaptures = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const played = play(seed, 300);
      hiddenCaptures += played.record.plies.filter((p) => p.captured_hidden).length;
      const withDeal = replayHiddenPieceRecord(played.record);
      assert.ok(withDeal.ok, `seed ${seed}: ${JSON.stringify(withDeal)}`);
      assert.equal(withDeal.finalFen, played.finalFen, `seed ${seed}`);
      assert.equal(withDeal.finalDealtFen, played.finalDealtFen, `seed ${seed}`);

      const { deal_fen: _deal, ...movesOnly } = played.record;
      const alone = replayHiddenPieceRecord(movesOnly);
      assert.ok(alone.ok, `seed ${seed}: ${JSON.stringify(alone)}`);
      assert.equal(alone.finalFen, played.finalFen, `seed ${seed}`);
      assert.equal(alone.finalDealtFen, null, 'no deal, so nothing face-down is named');
      assert.deepEqual(alone.status, withDeal.status, `seed ${seed}`);
    }
    // Only jieqi can capture a face-down piece; its games here do, so the
    // captured identity is exercised too.
    if (variant === 'jieqi') assert.ok(hiddenCaptures > 0);
    else assert.equal(hiddenCaptures, 0);
  });

  test(`${variant}: the PGN round-trips to the same record and replays the same`, () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const played = play(seed, 300);
      const text = writeHiddenPiecePgn({
        variant: variant as HiddenPieceVariant,
        tags: { Event: 'Test', Variant: variant },
        result: '*',
        dealFen: played.record.deal_fen,
        plies: played.record.plies,
      });
      assert.match(text, /\[SetUp "1"\]/);
      assert.ok(text.includes(`[FEN "${hiddenPieceStartFen(variant as HiddenPieceVariant)}"]`));
      assert.ok(text.includes(`[DealFEN "${played.record.deal_fen}"]`));
      const parsed = parseHiddenPiecePgn(text);
      assert.ok(parsed.ok, JSON.stringify(parsed));
      assert.deepEqual(parsed.record, played.record);
      const replayed = replayHiddenPieceRecord(parsed.record);
      assert.ok(replayed.ok);
      assert.equal(replayed.finalFen, played.finalFen);

      // Without the deal the tag is simply absent and the moves still replay.
      const bare = writeHiddenPiecePgn({
        variant: variant as HiddenPieceVariant,
        tags: { Variant: variant },
        result: '*',
        dealFen: null,
        plies: played.record.plies,
      });
      assert.ok(!bare.includes('DealFEN'));
      const bareParsed = parseHiddenPiecePgn(bare);
      assert.ok(bareParsed.ok);
      assert.equal(bareParsed.record.deal_fen, undefined);
      const bareReplay = replayHiddenPieceRecord(bareParsed.record);
      assert.ok(bareReplay.ok);
      assert.equal(bareReplay.finalFen, played.finalFen);
    }
  });

  test(`${variant}: a reveal that disagrees with the deal fails at its ply`, () => {
    const played = play(7, 300);
    const index = played.record.plies.findIndex((p) => p.revealed);
    assert.ok(index >= 0);
    const original = played.record.plies[index]!.revealed!;
    // Another identity of the same colour that the deal holds face down too.
    const other = played.record.plies.find(
      (p) => p.revealed && p.revealed.color === original.color && p.revealed.role !== original.role,
    )?.revealed;
    assert.ok(other, 'the game reveals two different roles of one colour');
    const tampered = played.record.plies.map((p, i) =>
      i === index ? { ...p, revealed: other } : p,
    );
    const result = replayHiddenPieceRecord({ ...played.record, plies: tampered });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.ply, index + 1);
      assert.match(result.error, /the deal has/);
    }
  });
}

test('a reveal that names nothing, or a piece not left face down, is refused without a deal', () => {
  const played = playJieqi(3, 60);
  const index = played.record.plies.findIndex((p) => p.revealed);
  const stripped = played.record.plies.map((p, i) => {
    if (i !== index) return p;
    const { revealed: _r, ...rest } = p;
    return rest;
  });
  const result = replayHiddenPieceRecord({ variant: 'jieqi', plies: stripped });
  assert.deepEqual(result, {
    ok: false,
    ply: index + 1,
    error: 'turns a piece over and names nothing',
  });

  // Six red soldiers cannot come out of a five-soldier set.
  const soldiers: HiddenPieceRecordPly[] = [
    { uci: 'a3a4', revealed: { color: 'red', role: 'soldier' } },
    { uci: 'a6a5', revealed: { color: 'black', role: 'soldier' } },
    { uci: 'c3c4', revealed: { color: 'red', role: 'soldier' } },
    { uci: 'c6c5', revealed: { color: 'black', role: 'soldier' } },
    { uci: 'e3e4', revealed: { color: 'red', role: 'soldier' } },
    { uci: 'e6e5', revealed: { color: 'black', role: 'soldier' } },
    { uci: 'g3g4', revealed: { color: 'red', role: 'soldier' } },
    { uci: 'g6g5', revealed: { color: 'black', role: 'soldier' } },
    { uci: 'i3i4', revealed: { color: 'red', role: 'soldier' } },
    { uci: 'i6i5', revealed: { color: 'black', role: 'soldier' } },
    { uci: 'b2b3', revealed: { color: 'red', role: 'soldier' } },
  ];
  const six = replayHiddenPieceRecord({ variant: 'jieqi', plies: soldiers });
  assert.equal(six.ok, false);
  if (!six.ok) {
    assert.equal(six.ply, 11);
    assert.match(six.error, /no face-down red soldier is left/);
  }
});

test('banqi squares map onto ICGA by swapping file and rank', () => {
  assert.equal(banqiSquareToIcga('a1'), 'a1');
  assert.equal(banqiSquareToIcga('h1'), 'a8');
  assert.equal(banqiSquareToIcga('a4'), 'd1');
  assert.equal(banqiSquareToIcga('h4'), 'd8');
  assert.equal(banqiSquareToIcga('c2'), 'b3');
  for (const square of ALL_BANQI_SQUARES) {
    assert.equal(icgaSquareToBanqi(banqiSquareToIcga(square)), square);
  }
  assert.equal(icgaSquareToBanqi('e1'), null);
  assert.equal(icgaSquareToBanqi('a9'), null);
});

test('move tokens: ICGA for banqi, uci plus the reveal suffix for jieqi and Flip Jungle', () => {
  const cases: Array<[HiddenPieceVariant, HiddenPieceRecordPly, string]> = [
    ['banqi', { uci: '@h4', revealed: { color: 'red', role: 'soldier' } }, 'd8=P'],
    ['banqi', { uci: '@c2', revealed: { color: 'black', role: 'advisor' } }, 'b3=g'],
    ['banqi', { uci: 'e2h2' }, 'b5-b8'],
    ['jieqi', { uci: 'h2e2' }, 'h2e2'],
    ['jieqi', { uci: 'e3e4', revealed: { color: 'red', role: 'chariot' } }, 'e3e4=R'],
    [
      'jieqi',
      {
        uci: 'b2b9',
        revealed: { color: 'red', role: 'cannon' },
        captured_hidden: { color: 'black', role: 'horse' },
      },
      'b2b9=Cx=n',
    ],
    ['jieqi', { uci: 'b7b0', captured_hidden: { color: 'red', role: 'elephant' } }, 'b7b0x=B'],
    ['jungle-flip', { uci: '@c3', revealed: { color: 'black', role: 'elephant' } }, '@c3=e'],
    ['jungle-flip', { uci: 'c3c4' }, 'c3c4'],
  ];
  for (const [variant, record, token] of cases) {
    assert.equal(hiddenPiecePgnToken(variant, record), token, token);
    assert.deepEqual(parseHiddenPiecePgnToken(variant, token), record, token);
  }
  assert.equal(parseHiddenPiecePgnToken('banqi', 'd8=Z'), null);
  assert.equal(parseHiddenPiecePgnToken('jieqi', 'e3e4=R='), null);
  // The ICGA paper's own parenthesised spelling is not this format's.
  assert.equal(parseHiddenPiecePgnToken('banqi', 'd8(P)'), null);
});

test('a multi-game PGN file splits into its games', () => {
  const games = [1, 2, 3].map((seed) => playBanqi(seed, 40));
  const text = games
    .map((played) =>
      writeHiddenPiecePgn({
        variant: 'banqi',
        tags: { MistboardVariant: 'banqi' },
        result: '*',
        dealFen: played.record.deal_fen,
        plies: played.record.plies,
      }),
    )
    .join('\n');
  const parsed = parseHiddenPiecePgnGames(text);
  assert.equal(parsed.length, 3);
  parsed.forEach((game, index) => {
    assert.ok(game.ok);
    assert.deepEqual(game.record, games[index]!.record);
  });
});

// A strict PGN tokenizer, after the PGN standard (section 7): `(` and `)` are
// self-delimiting tokens that open and close a variation, and a symbol token
// runs over letters, digits and `_+#=:-/`. Our `@` (Flip Jungle's flip) is
// accepted as a symbol character here, as lichess's variant readers do.
function strictPgnTokens(movetext: string): string[] {
  const tokens: string[] = [];
  const re = /\s+|\{[^}]*\}|[()]|\d+\.+|[A-Za-z0-9_+#=:\-/@]+|\*|./g;
  for (const m of movetext.matchAll(re)) {
    if (/^\s+$/.test(m[0]) || m[0].startsWith('{')) continue;
    tokens.push(m[0]);
  }
  return tokens;
}

test('every generated PGN tokenizes into whole move tokens, with no ( or ) in its movetext', () => {
  for (const [variant, play] of Object.entries(PLAYERS)) {
    for (let seed = 1; seed <= 5; seed += 1) {
      const played = play(seed, 300);
      const text = writeHiddenPiecePgn({
        variant: variant as HiddenPieceVariant,
        tags: { MistboardVariant: variant },
        result: '*',
        dealFen: played.record.deal_fen,
        plies: played.record.plies,
      });
      const movetext = text.split('\n\n')[1]!;
      assert.equal(/[()]/.test(movetext), false, `${variant} seed ${seed}`);
      const moves = strictPgnTokens(movetext).filter(
        (token) => !/^\d+\.+$/.test(token) && token !== '*',
      );
      // One token per ply, each exactly the writer's token for that ply, so a
      // reader that knows nothing of reveals still keeps each reveal in its move.
      assert.deepEqual(
        moves,
        played.record.plies.map((ply) => hiddenPiecePgnToken(variant as HiddenPieceVariant, ply)),
        `${variant} seed ${seed}`,
      );
    }
  }
});
