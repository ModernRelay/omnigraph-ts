import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReleasePin, resolveServerPin } from './server-pin.js';

test('released server pins resolve to a tag and permit the release gate', () => {
  const pin = resolveServerPin({ serverVersion: '0.10.0' });
  assert.deepEqual(pin, { version: '0.10.0', ref: 'v0.10.0', sourcePinned: false });
  assert.doesNotThrow(() => assertReleasePin(pin));
});

test('an immutable source pin keeps the target version but blocks publishing', () => {
  const serverRef = 'd043cf148e37c4356deb497835db593a2c32d270';
  const pin = resolveServerPin({ serverVersion: '0.10.0', serverRef });
  assert.deepEqual(pin, { version: '0.10.0', ref: serverRef, sourcePinned: true });
  assert.throws(() => assertReleasePin(pin), /Cannot publish a source-pinned server candidate/);
});

test('mutable, abbreviated, empty, and malformed source pins fail closed', () => {
  for (const serverRef of ['main', 'v0.10.0', 'd043cf14', '', null, 42, 'a'.repeat(39), 'a'.repeat(41)]) {
    assert.throws(() => resolveServerPin({ serverVersion: '0.10.0', serverRef }), /full lowercase 40-character commit SHA/);
  }
});

test('server version is required even when a source ref is present', () => {
  for (const serverVersion of [undefined, null, '', 'main', '0.10', 10]) {
    assert.throws(() => resolveServerPin({ serverVersion, serverRef: 'a'.repeat(40) }), /semantic version/);
  }
  assert.equal(resolveServerPin({ serverVersion: '0.10.0-rc.1' }).ref, 'v0.10.0-rc.1');
});
