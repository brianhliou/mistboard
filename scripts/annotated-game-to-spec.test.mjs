import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./annotated-game-to-spec.mjs', import.meta.url).pathname;
function convert(game, engine) {
  const dir = mkdtempSync(join(tmpdir(), 'annotated-meta-'));
  try {
    const path = join(dir, 'annot.json');
    writeFileSync(
      path,
      JSON.stringify({
        game: { red: 'Red', black: 'Black', event: 'Synthetic', result: '*', ...game },
        rows: [{ uci: 'h2e2' }, { uci: 'h9g7' }],
        ...(engine ? { engine } : {}),
      }),
    );
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('annotation conversion preserves only explicitly recorded metadata and exact approved source', () => {
  const spec = convert({
    date: '2026-09-17 13:00',
    round: '7 <final>',
    timeControl: '40分＋20秒',
    sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_143947.html',
    unexpected: 'never copied',
  });
  assert.deepEqual(spec.metadata, {
    date: '2026-09-17 13:00',
    round: '7 <final>',
    timeControl: '40分＋20秒',
    source: { label: 'DPXQ', url: 'http://www.dpxq.com/hldcg/search/view_m_143947.html' },
  });
  assert.ok(!JSON.stringify(spec).includes('unexpected'));
});
test('unknown time control is absent; guessed events and arbitrary source links are never promoted', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://www.dpxq.com.evil.test/hldcg/search/view_m_143947.html',
    'https://www.dpxq.com/hldcg/search/view_m_143947.html?next=evil',
    'https://user@www.dpxq.com/hldcg/search/view_m_143947.html',
  ]) {
    const spec = convert({
      event: '40 minute final',
      sourceUrl: url,
      timerule: '',
      round: 'bad\nround',
    });
    assert.deepEqual(spec.metadata, {});
  }
});

test('explicit unknown source timeControl clears a legacy timerule rather than implying a clock', () => {
  const spec = convert({ timeControl: null, timerule: '5分＋3秒' });
  assert.equal(spec.metadata.timeControl, undefined);
});

test('annotation conversion preserves a positive integer node budget without inventing one', () => {
  assert.equal(convert({}, { nodes: 10_000_000 }).analysisNodes, 10_000_000);
  assert.equal(convert({}, { nodes: 1_000_000 }).analysisNodes, 1_000_000);
  for (const nodes of [undefined, null, 0, -1, 1.5, '10000000'])
    assert.equal(convert({}, { nodes }).analysisNodes, undefined);
});
