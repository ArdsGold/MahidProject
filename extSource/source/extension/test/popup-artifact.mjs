import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
const html = await readFile(new URL('../dist/popup/popup.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../dist/popup/popup.js', import.meta.url), 'utf8');
assert.match(html, /src="popup\.js"/);
assert.match(html, /href="popup\.css"/);
assert.doesNotMatch(html, /id="(?:.*recovery.*|fresh-homepage-button|inspect-dispatch-button|archive-stopped-button|auto-login|auto-register|auto-publish|ampblogs-preflight-button)"/);
assert.match(html, /Family 1\/2: AUTOFILL fills the current form only/);
for (const mode of ['status-rejected', 'status-hung', 'profile-rejected', 'profile-hung', 'no-profile', 'success', 'empty', 'rejected', 'blocked', 'action-hung', 'fill-only']) {
  const window = new Window({ url: 'chrome-extension://' + 'a'.repeat(32) + '/popup/popup.html' });
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
  if (mode.endsWith('-hung')) {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => schedule(callback, ms >= 5000 ? 1 : ms, ...args);
  }
  const saved = { id: 'preserved', stage: 'MANUAL_GATE', manual: ['Human input required'], autoLogin: false };
  const before = JSON.stringify(saved), starts = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  window.chrome = {
    runtime: { sendMessage: async message => {
      if (message.type === 'BA2_GET_PUBLICATION_TRACE') return { readOnly: false, build: 'fixture', steps: [] };
      if (message.type === 'BA2_GET_ACTIVE_PROFILE') {
        if (mode === 'profile-rejected') throw Error('Profile preview rejected');
        if (mode === 'profile-hung') return new Promise(() => {});
        return mode === 'no-profile' ? { ok: false } : { ok: true, profileName: 'Fixture profile' };
      }
      if (message.type === 'BA2_GET_LISTING_STATUS') {
        if (mode === 'status-rejected') throw Error('Saved status rejected');
        if (mode === 'status-hung') return new Promise(() => {});
        return saved;
      }
      assert.equal(message.type, 'BA2_START_LISTING_AUTOFILL');
      starts.push(message);
      if (mode === 'action-hung') return new Promise(() => {});
      await pending;
      if (mode === 'rejected') throw Error('transport lost');
      if (mode === 'empty') return undefined;
      if (mode === 'blocked') return { ok: false, error: 'Unresolved Login receipt. No replay.' };
      if (mode === 'no-profile') return { ok: false, error: 'Select an active MAHID business profile.' };
      if (mode === 'fill-only') return { ok: true, runId: 'preserved', message: 'Login fields filled only. Earlier registration remains unresolved.' };
      return { ok: true, runId: 'same-coordinator' };
    } },
    tabs: { query: async () => [{ id: 42, url: 'https://bloguetechno.com/login' }] },
    storage: { onChanged: { addListener: () => {} }, local: { set: () => assert.fail('Popup cannot mutate runs/receipts') } },
  };
  window.eval(script);
  await window.happyDOM.whenAsyncComplete();
  assert.equal(starts.length, 0, 'opening popup is not authorization');
  const button = window.document.getElementById('autofill-button');
  assert.equal(button.textContent, 'AUTOFILL');
  assert.equal(button.disabled, false, `${mode}: display reads cannot swallow AUTOFILL`);
  {
    button.click(); button.click();
    await Promise.resolve();
    assert.equal(starts.length, 1, 'one command while in flight');
    release();
    await window.happyDOM.whenAsyncComplete();
    assert.deepEqual(JSON.parse(JSON.stringify(starts)), [{ type: 'BA2_START_LISTING_AUTOFILL', continuous: true }]);
    assert.equal(button.textContent, 'AUTOFILL');
    if (['empty', 'rejected', 'action-hung'].includes(mode)) assert.match(window.document.getElementById('result').textContent, /acknowledgement|acknowledgement lost/i);
    if (mode === 'blocked') assert.match(window.document.getElementById('result').textContent, /Unresolved Login receipt/);
    if (mode === 'no-profile') assert.match(window.document.getElementById('result').textContent, /active MAHID business profile/);
    if (mode === 'fill-only') assert.match(window.document.getElementById('result').textContent, /filled only.*registration remains unresolved/);
    assert.equal(button.disabled, false, 'response/error/timeout restores button without automatic replay');
    // A new explicit click dispatches again; it must never be silently ignored
    // because a prior display read failed. The worker still owns all guards.
    button.click();
    await window.happyDOM.whenAsyncComplete();
    assert.equal(starts.length, 2, 'second explicit click acknowledged separately');
  }
  assert.equal(JSON.stringify(saved), before);
  await window.happyDOM.close();
}
console.log('One AUTOFILL popup passed: visible run authorization, no Prepare/Recovery/Inspect controls, no opening side effects, one in-flight dispatch, no lost-ack retry or storage mutation');
