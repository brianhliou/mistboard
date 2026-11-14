import assert from 'node:assert/strict';
import test from 'node:test';
import { articleLineAssessment } from './article-line-assessment.mjs';

test('root assessments retain the published boundaries in Red POV', () => {
  for (const [cp, expected] of [
    [0, '='],
    [29, '='],
    [30, '⩲'],
    [-30, '⩱'],
    [89, '⩲'],
    [90, '±'],
    [-90, '∓'],
    [249, '±'],
    [250, '+−'],
    [-250, '−+'],
  ]) {
    assert.equal(articleLineAssessment({ cp, mate: null }), expected);
  }
});
test('forced mates take precedence; missing scores do not invent an assessment', () => {
  assert.equal(articleLineAssessment({ cp: 0, mate: 3 }), '+−');
  assert.equal(articleLineAssessment({ cp: 0, mate: -3 }), '−+');
  assert.equal(articleLineAssessment({ cp: null, mate: null }), null);
  assert.equal(articleLineAssessment({ cp: null, mate: 0 }), null);
});
