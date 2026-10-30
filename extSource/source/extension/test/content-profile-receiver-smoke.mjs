import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

// Execute the actual built full content entry. Never send an action or attach
// operator Chrome. Check the status handler independently of observer recovery.
const script = await readFile(new URL('../dist/content/content.js', import.meta.url), 'utf8');
for (const mode of ['profile', 'no-profile', 'read-rejected', 'read-pending']) {
  const window = new Window({ url: 'https://bloguetechno.com/' });
  window.document.write('<a href="/login">Login</a><input name="untouched" value="original">');
  const saved = { id: 'preserved-failed-run', stage: 'ERROR', sourceUrl: window.location.href, autoLogin: true,
    autoPublish: false, steps: [], manual: [], error: 'Previous missing acknowledgement' };
  const snapshot = JSON.stringify(saved);
  const listeners = [], errors = [];
  window.addEventListener('unhandledrejection', event => { errors.push('unhandled read rejection'); event.preventDefault(); });
  window.chrome = {
    runtime: { id: 'a'.repeat(32), onMessage: { addListener: listener => listeners.push(listener), hasListener: listener => listeners.includes(listener) },
      sendMessage: () => assert.fail('Status read must not resume automation') },
    storage: { onChanged: { addListener: () => {} }, local: {
      get: async key => {
        if (key === 'ba2.activeProfile') {
          if (mode === 'read-rejected') throw Error('PRIVATE_STORAGE_ERROR_CANARY');
          if (mode === 'read-pending') return new Promise(() => {});
          return { [key]: mode === 'profile' ? { profile: { id: 'fixture-profile', businessName: 'Fixture business' } } : null };
        }
        return { [key]: key === 'ba2.listingRun' ? saved : undefined };
      },
      set: () => assert.fail('No status-read writes'), remove: () => assert.fail('No removals'), clear: () => assert.fail('No clearing'),
    } },
  };
  window.eval(script);
  window.eval(script);
  assert.equal(listeners.length, 2, 'reinjection retains one observer and one full receiver');
  await new Promise(resolve => setTimeout(resolve, 10));
  let reply, callbacks = 0, keptOpen = false;
  for (const listener of listeners) {
    const result = listener({ type: 'BA2_GET_ACTIVE_PROFILE' }, { id: 'a'.repeat(32) }, value => { reply = value; callbacks++; });
    keptOpen ||= result === true;
  }
  assert.equal(keptOpen, true, 'full status handler retains asynchronous response channel');
  await new Promise(resolve => setTimeout(resolve, 20));
  if (mode === 'read-pending') assert.equal(callbacks, 0, 'pending storage is distinct from absent receiver or invalid response');
  else {
    assert.equal(callbacks, 1, mode + ': one acknowledgement even when profile read rejects');
    assert.equal(typeof reply.ok, 'boolean');
    assert.equal(reply.ok, mode === 'profile');
    assert.doesNotMatch(JSON.stringify(reply), /PRIVATE_STORAGE_ERROR_CANARY/);
  }
  assert.deepEqual(errors, []);
  assert.equal(JSON.stringify(saved), snapshot);
  assert.equal(window.document.querySelector('input').value, 'original');
  await window.happyDOM.close();
}
console.log('Full built content profile status passed: registration, async channel, profile/absent/rejected/pending reads, sanitized one reply, no actions or saved-state changes');
