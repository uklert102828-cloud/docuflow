import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionToken, passwordMatches, readSessionToken } from '../server/security.js';

test('session token is signed and expires after seven days', () => {
  const now = Date.now();
  const token = createSessionToken('secret', 'browser-1', now);
  assert.equal(readSessionToken(token, 'secret', now + 1000).sid, 'browser-1');
  assert.equal(readSessionToken(`${token}x`, 'secret', now), null);
  assert.equal(readSessionToken(token, 'wrong-secret', now), null);
  assert.equal(readSessionToken(token, 'secret', now + 8 * 24 * 60 * 60 * 1000), null);
});

test('password comparison rejects empty and mismatched input', () => {
  assert.equal(passwordMatches('team-pass', 'team-pass'), true);
  assert.equal(passwordMatches('team', 'team-pass'), false);
  assert.equal(passwordMatches('', ''), false);
});
