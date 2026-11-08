import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const SCRIPT = new URL('./player-page-article.mjs', import.meta.url).pathname;

function build(frontMatter) {
  const dir = mkdtempSync(join(tmpdir(), 'player-page-article-'));
  try {
    const draft = join(dir, 'draft.md');
    writeFileSync(
      draft,
      `---\nslug: test-player\nexport: testPlayerArticle\ntitle: Test Player\nsummary: A test page.\naudience: Tests.\nstatus: published\n${frontMatter}\n---\n\nAn intro paragraph.\n\n## Games\n\nA body paragraph.\n`,
    );
    return spawnSync(process.execPath, [SCRIPT, draft], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the generated article carries the draft updateNote after updatedAt', () => {
  // Regenerating lai-ly-huynh.ts from its draft dropped the note, and the
  // article test fails an updated page without one.
  const result = build(
    'publishedAt: 2026-10-02\nupdatedAt: 2026-10-26\nupdateNote: Added a link to the "match" in the archive.',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    / {2}updatedAt: "2026-10-26",\n {2}updateNote: "Added a link to the \\"match\\" in the archive.",\n/,
  );
});

test('a draft updated after publication with no updateNote refuses to build', () => {
  const result = build('publishedAt: 2026-10-02\nupdatedAt: 2026-10-26');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /add an updateNote line/);
});

test('a draft never updated needs no updateNote', () => {
  const result = build('publishedAt: 2026-10-02');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /updateNote/);
});
