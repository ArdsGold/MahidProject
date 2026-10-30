import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../dist/content/dashboard-assets.js', import.meta.url), 'utf8');
const listeners = [];
let reads = 0;
let closes = 0;
let stored = { profileId: 'fixture-profile', kind: 'logo', assetId: 'fixture-asset', blob: new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' }) };
const window = {};
window.top = window;
const context = vm.createContext({ window, location: { origin: 'http://localhost:3000' }, Blob,
  chrome: { runtime: { onMessage: { addListener: listener => listeners.push(listener), hasListener: listener => listeners.includes(listener) } } },
  indexedDB: { open: (name, version) => {
    assert.equal(name, 'backlink-autofill-assets');
    assert.equal(version, 1);
    const request = { result: { close: () => { closes += 1; }, transaction: (store, mode) => {
      assert.equal(store, 'profile-assets');
      assert.equal(mode, 'readonly');
      return { objectStore: () => ({ get: key => {
        assert.equal(key, `${stored?.kind || 'logo'}:fixture-asset`);
        reads += 1;
        const read = { result: stored };
        queueMicrotask(() => read.onsuccess());
        return read;
      } }) };
    } } };
    queueMicrotask(() => request.onsuccess());
    return request;
  } },
});
vm.runInContext(script, context);
vm.runInContext(script, context);
assert.equal(listeners.length, 1, 'reinjection must not duplicate the receiver');
const send = message => new Promise(resolve => {
  const keptOpen = listeners[0](message, {}, response => resolve(JSON.parse(JSON.stringify(response))));
  assert.equal(keptOpen, true, 'asynchronous IndexedDB read must keep Chrome response channel open');
});
for (const kind of ['logo', 'brochure']) {
  stored = { ...stored, kind };
  const result = await send({ type: kind === 'logo' ? 'BA2_GET_PROFILE_LOGO' : 'BA2_GET_PROFILE_BROCHURE', profileId: 'fixture-profile', assetId: 'fixture-asset', fileName: 'fixture.bin' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [0, 128, 255], 'asset bytes must survive Chrome JSON message serialization');
  assert.equal(result.size, 3);
}
stored = { ...stored, kind: 'logo', profileId: 'different-profile' };
assert.equal((await send({ type: 'BA2_GET_PROFILE_LOGO', profileId: 'fixture-profile', assetId: 'fixture-asset' })).ok, false, 'wrong owner must stay blocked');
assert.equal(closes, reads);
const readsBefore = reads;
assert.equal(listeners[0]({ type: 'BA2_BLOG_PUBLISH_ONCE' }, {}, () => assert.fail('asset reader must ignore automation')), undefined);
assert.equal(reads, readsBefore);
context.location.origin = 'https://onesmablog.com';
assert.equal(listeners[0]({ type: 'BA2_GET_PROFILE_LOGO' }, {}, () => assert.fail('asset reader must ignore foreign origins')), undefined);
console.log('Dashboard receiver fixtures passed: idempotent install, readonly owned assets, JSON byte roundtrip, channel lifetime, origin/automation isolation');
