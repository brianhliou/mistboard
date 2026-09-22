import assert from 'node:assert/strict';
import test from 'node:test';
import { INDEXNOW_KEY, indexNowKeyPath, isIndexNowKeyRequest } from './indexnow.js';

test('IndexNow key is 32 lowercase hex characters, as the protocol requires', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
});

test('the key file is served at /<key>.txt and nowhere else', () => {
  assert.equal(indexNowKeyPath(), `/${INDEXNOW_KEY}.txt`);
  assert.equal(isIndexNowKeyRequest(`/${INDEXNOW_KEY}.txt`), true);
  assert.equal(isIndexNowKeyRequest(`/${INDEXNOW_KEY}`), false);
  assert.equal(isIndexNowKeyRequest('/robots.txt'), false);
});
