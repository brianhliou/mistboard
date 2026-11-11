import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import * as game from '@mistboard/game';
import { boardTextBody, boardTextLine } from './board-text-body.js';
import { BOARD_COPY, type BoardLocale } from './board-text-copy.js';

const params = {
  variant: 'xiangqi',
  players: { red: 'Red <name>', black: 'Black & name' },
  event: 'Cup',
  date: '2026-11-07',
  result: '1-0',
  moves: ['h3e3', 'h8e8'],
  locale: 'en' as const,
};

test('board text uses the site notation, facts, escaped heading and final FEN', () => {
  const body = boardTextBody(params);
  assert.match(body, /<h1>Red &lt;name&gt; vs Black &amp; name<\/h1>/);
  assert.match(body, /<dt>Event<\/dt><dd>Cup<\/dd>/);
  assert.match(body, /<ol><li>Che3<\/li><li>Che8<\/li><\/ol>/);
  assert.match(body, /<code>[^<]*c4[^<]*C4[^<]*<\/code>/);
  assert.match(boardTextBody({ ...params, locale: 'zh-Hans' }), /炮二平五/);
  assert.match(boardTextBody({ ...params, locale: 'zh-Hant', moves: ['h1g3'] }), /馬二進三/);
});

test('an empty game keeps its heading and opening FEN, with an empty move list', () => {
  const body = boardTextBody({ ...params, moves: [] });
  assert.match(body, /<h1>Red/);
  assert.match(body, /<ol><\/ol>/);
  assert.match(body, /<code>rnbakabnr/);
  assert.doesNotMatch(body, /undefined|NaN/);
});

test('a jieqi replay never exposes unrevealed pieces or the dealt FEN field', () => {
  const state = game.createInitialJieqiState(
    'test',
    game.createJieqiDeal(() => 0.5),
  );
  const a = state.board.a1!;
  const b = state.board.b1!;
  const other: game.JieqiGameState = { ...state, board: { ...state.board, a1: b, b1: a } };
  const render = (s: game.JieqiGameState) =>
    boardTextBody({
      ...params,
      variant: 'jieqi',
      moves: ['h3e3'],
      fen: game.jieqiStateToDealtFen(s),
    });
  assert.equal(
    render(state),
    render(other),
    'a planted hidden-identity change must not affect any HTML byte',
  );
  assert.match(render(state), /<li>h3-e3/);
  assert.match(render(state), /x/);
  assert.ok(!render(state).includes(game.jieqiStateToDealtFen(state)));
  // Check every still-covered location in a start position, not one substring.
  const output = boardTextLine({
    ...params,
    variant: 'jieqi',
    moves: [],
    fen: game.jieqiStateToDealtFen(state),
  }).fen!;
  const placement = output.split(' ')[0]!;
  assert.equal(
    (placement.match(/X/g) ?? []).length,
    Object.values(state.board).filter((p) => p?.color === 'red' && p.faceDown).length,
  );
  assert.equal(output.split(' ').length, 5);
  assert.deepEqual(
    boardTextLine({ ...params, variant: 'jieqi', fen: output }),
    { labels: [], fen: null },
    'a public FEN without a pinned deal cannot invent revealed identities',
  );
});

test('invalid starts, unknown variants and fog canonical states fail closed', () => {
  for (const variant of ['future-hidden-game', 'dark-xiangqi', 'dark-chess']) {
    assert.deepEqual(boardTextLine({ ...params, variant, fen: 'HIDDEN_PIECE_SENTINEL' }), {
      labels: [],
      fen: null,
    });
  }
  assert.deepEqual(boardTextLine({ ...params, fen: 'invalid' }), { labels: [], fen: null });
  assert.deepEqual(boardTextLine({ ...params, variant: 'jieqi' }), { labels: [], fen: null });
  assert.deepEqual(boardTextLine({ ...params, moves: ['not-a-move'] }).labels, []);
});

test('every mirrored server label is the actual catalog string in every locale', async () => {
  for (const locale of Object.keys(BOARD_COPY) as BoardLocale[]) {
    const catalog: Record<string, string> = {};
    for (const domain of ['community', 'review', 'play']) {
      const suffix = locale === 'en' ? '' : `.${locale.toLowerCase()}`;
      const file = resolve(
        import.meta.dirname,
        '../../web/src/i18n/catalogs',
        `${domain}${suffix}.ts`,
      );
      const module = await import(pathToFileURL(file).href);
      const prefix = locale === 'en' ? 'EN' : locale === 'zh-Hans' ? 'ZH_HANS' : 'ZH_HANT';
      Object.assign(catalog, module[`${prefix}_${domain.toUpperCase()}`]);
    }
    for (const [key, value] of Object.entries(BOARD_COPY[locale]))
      assert.equal(value, catalog[key], `${locale}: ${key}`);
  }
  const css = await readFile(resolve(import.meta.dirname, '../../web/src/app-base.css'), 'utf8');
  assert.match(css, /\.crawler-copy\s*\{\s*animation: crawler-copy-reveal 0s 4s both/);
});

test('each study board family replays its native move keys and emits its own position format', () => {
  for (const [variant, move] of [
    ['xiangqi', 'h3e3'],
    ['jungle', 'a1a2'],
    ['fortress-xiangqi', 'e1e2'],
    ['crazyhouse-xiangqi', 'h3e3'],
    ['atomic-xiangqi', 'h3e3'],
    ['duck-xiangqi', 'h3e3@h3'],
    ['chess', 'e2e4'],
    ['gomoku', 'h8'],
    ['dark-xiangqi', 'h3e3'],
    ['dark-chess', 'e2e4'],
  ]) {
    const line = boardTextLine({ ...params, variant: variant!, publicStudy: true, moves: [move!] });
    assert.equal(line.labels.length, 1, variant);
    assert.ok(line.fen, variant);
  }
  for (const variant of ['banqi', 'jieqi', 'jungle-flip', 'three-kingdoms-banqi']) {
    const fen = game.initialStartFen(variant, () => 0.5)!;
    const line = boardTextLine({
      ...params,
      variant,
      fen,
      moves: variant === 'jieqi' ? ['h3e3'] : ['a1a1'],
    });
    assert.equal(line.labels.length, 1, variant);
    assert.ok(line.fen, variant);
    assert.ok(!line.fen.includes(fen.split(' ')[5]!), `${variant}: no dealt-field identities`);
  }
});
