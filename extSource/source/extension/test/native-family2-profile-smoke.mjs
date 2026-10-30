import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

await mkdir('extension/test/.tmp', { recursive: true });
const path = await mkdtemp(resolve('extension/test/.tmp/family2-profile-'));
const context = await chromium.launchPersistentContext(path, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const profile = { id: 'active-business', businessName: 'Active Business', username: 'correct-user', phone: '+1 312 555 0123',
  email: 'fixture@example.test', country: 'United States', state: 'Illinois', stateCode: 'IL', city: 'Chicago',
  updatedAt: '2026-10-20', logoAsset: { id: 'active-logo', fileName: 'active-business.png', mimeType: 'image/png', size: 68 } };
const payload = { profile, syncedAt: 'fixture', source: 'local-storage' };
let nonGets = 0, unexpected = 0;
const html = `<form method="post" onsubmit="window.submits++;return false">
  <label>Username<input name="username"></label>
  <label for="user_name">Phone</label><input id="user_name" type="text">
  <label>State<select name="state"><option value="ny">New York</option><option value="il">Illinois</option></select></label>
  <label>City<select name="city"><option value="stale">Chicago</option></select></label>
  <div>Your Photo<input name="photo" type="file" accept="image/*"></div>
  <div>Your Logo<input name="logo" type="file" accept="image/*"></div>
  <label><input name="terms" type="checkbox">Terms</label><input name="captcha" placeholder="CAPTCHA">
  <button type="submit">Update Profile</button></form>
  <script>window.submits=0;window.stateChanges=0;
  document.querySelector('[name=state]').addEventListener('change',()=>{
    window.stateChanges++;
    setTimeout(()=>{document.querySelector('[name=city]').outerHTML='<select name="city" disabled><option>Loading</option></select>';},120);
    setTimeout(()=>{document.querySelector('[name=city]').outerHTML='<select name="city"><option value="">Select City</option><option value="fresh-chicago">Chicago</option></select>';},300);
  });</script>`;
try {
  await context.addInitScript(payload => { if (location.origin === 'http://localhost:3000') localStorage.setItem('ba2.activeProfile', JSON.stringify(payload)); }, payload);
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (route.request().url() === 'http://localhost:3000/fixture') return route.fulfill({ contentType: 'text/html', body: '<p>Disposable dashboard asset store</p>' });
    if (route.request().url().startsWith('https://businessizze.com/profile')) return route.fulfill({ contentType: 'text/html', body: html });
    if (route.request().resourceType() !== 'document') return route.fulfill({ body: '' });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending;
  const dashboard = context.pages()[0]; await dashboard.goto('http://localhost:3000/fixture');
  await dashboard.evaluate(async ({ profile, png }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('backlink-autofill-assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('profile-assets'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    await new Promise((resolve, reject) => { const t = db.transaction('profile-assets', 'readwrite');
      for (const [assetId, profileId, data] of [['active-logo', profile.id, png], ['inactive-logo', 'inactive-business', btoa('wrong-logo')]]) {
        t.objectStore('profile-assets').put({ profileId, kind: 'logo', assetId, blob: new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }) }, `logo:${assetId}`);
      } t.oncomplete = resolve; t.onerror = reject;
    }); db.close();
  }, { profile, png });
  await worker.evaluate(async () => chrome.storage.local.set({ 'ba2.listingRun': { id: 'old-run', sourceUrl: 'https://businessizze.com/profile', stage: 'MANUAL_GATE', tabId: 999, autoPublish: true, submissionAttempted: true, steps: [], manual: [] }, 'ba2.publicationGuard:old': { outcome: 'uncertain' } }));
  const page = await context.newPage(); await page.goto('https://businessizze.com/profile');
  await page.locator('#ba2-floating-autofill').waitFor(); await page.waitForTimeout(2100);
  const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const autofill = async (success = true) => {
    await page.bringToFront();
    await popup.evaluate(() => document.getElementById('autofill-button').click());
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled && document.getElementById('result').textContent.trim());
    const result = await popup.locator('#result').textContent();
    if (success) assert.match(result, /filled only/, result);
    return result;
  };
  const verify = async () => {
    assert.equal(await page.locator('[name=username]').inputValue(), profile.username);
    assert.equal(await page.locator('#user_name').inputValue(), profile.phone);
    assert.equal(await page.locator('[name=state]').inputValue(), 'il');
    assert.equal(await page.locator('[name=city]').inputValue(), 'fresh-chicago');
    assert.deepEqual(await page.locator('[name=logo]').evaluate(async e => ({ name: e.files[0]?.name, bytes: e.files[0] && Array.from(new Uint8Array(await e.files[0].arrayBuffer())) })), { name: profile.logoAsset.fileName, bytes: Array.from(Buffer.from(png, 'base64')) });
    assert.equal(await page.locator('[name=photo]').evaluate(e => e.files.length), 0);
    assert.equal(await page.locator('[name=terms]').isChecked(), false);
    assert.equal(await page.locator('[name=captcha]').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => [window.submits, window.stateChanges]), [0, 1]);
    assert.equal(page.url(), 'https://businessizze.com/profile');
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
  };
  await autofill(); await page.waitForTimeout(500); await verify();
  await autofill(); await page.waitForTimeout(500); await verify();
  await page.reload(); await page.locator('#ba2-floating-autofill').waitFor(); await autofill(); await verify();
  console.log('PASS active-profile original logo bytes, separate Photo, Phone/Username, delayed replaced City without Country, repeat/refresh, zero Update Profile/Terms/CAPTCHA/history mutation');

  // No fallback into Photo or an unrelated upload when Logo is absent/ambiguous.
  await page.locator('[name=logo]').evaluate(e => e.parentElement.remove());
  await autofill(); assert.equal(await page.locator('[name=photo]').evaluate(e => e.files.length), 0);
  assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
  console.log('PASS photo-only form stays untouched');

  // Country -> State -> City also waits for live replacement and never replays the parent changes.
  await page.reload();
  await page.evaluate(() => {
    const country = document.createElement('label'); country.innerHTML = 'Country<select name="country"><option value="ca">Canada</option><option value="us">United States</option></select>';
    document.querySelector('form').prepend(country);
    window.countryChanges = 0;
    country.querySelector('select').addEventListener('change', () => { window.countryChanges++;
      setTimeout(() => { document.querySelector('[name=state]').innerHTML = '<option value="">Loading</option>'; }, 120);
      setTimeout(() => { document.querySelector('[name=state]').innerHTML = '<option value="">Select State</option><option value="il">Illinois</option>'; }, 300);
    });
  });
  await autofill(); await page.waitForTimeout(500); await verify();
  assert.equal(await page.evaluate(() => window.countryChanges), 1);
  console.log('PASS Country -> State -> City delayed cascade');

  await page.reload();
  await page.evaluate(() => { document.querySelector('[name=state]').value = 'il'; document.querySelector('[name=city]').innerHTML = '<option value="">Select City</option>'; });
  await autofill(); await verify();
  console.log('PASS preselected State still loads missing City options');

  await page.reload();
  await page.locator('[name=state]').evaluate(e => e.closest('label').remove());
  await page.locator('[name=city]').evaluate(e => { e.innerHTML = '<option value="">Select City</option><option value="city-only">Chicago</option>'; });
  await autofill(); assert.equal(await page.locator('[name=city]').inputValue(), 'city-only');
  assert.equal(await page.evaluate(() => window.submits), 0);
  console.log('PASS independent City select preserved');

  // Missing Blob reports failure and never substitutes the inactive profile logo.
  await dashboard.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('backlink-autofill-assets', 1); r.onsuccess = () => resolve(r.result); }); await new Promise(resolve => { const t = db.transaction('profile-assets', 'readwrite'); t.objectStore('profile-assets').delete('logo:active-logo'); t.oncomplete = resolve; }); db.close(); });
  await page.reload();
  const missing = await autofill(false); assert.match(missing, /Blob|asset|Logo/i);
  assert.equal(await page.locator('[name=logo]').evaluate(e => e.files.length), 0);
  assert.equal(await page.locator('[name=photo]').evaluate(e => e.files.length), 0);
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
  assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  console.log('PASS missing active Blob fails clearly, inactive asset not substituted; zero non-GET/unexpected HTTP');

  // Changing the dashboard's active profile changes both credential/phone values and the selected asset.
  const nextProfile = { ...profile, id: 'inactive-business', username: 'new-active-user', phone: '555-0199', updatedAt: '2026-10-21', logoAsset: { ...profile.logoAsset, id: 'inactive-logo', fileName: 'new-active.png' } };
  await dashboard.evaluate(payload => localStorage.setItem('ba2.activeProfile', JSON.stringify(payload)), { ...payload, profile: nextProfile });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await worker.evaluate(async () => (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile']?.profile.id === 'inactive-business')) break;
    await page.waitForTimeout(100);
  }
  await page.reload(); await autofill();
  assert.equal(await page.locator('[name=username]').inputValue(), nextProfile.username);
  assert.equal(await page.locator('#user_name').inputValue(), nextProfile.phone);
  assert.deepEqual(await page.locator('[name=logo]').evaluate(async e => [e.files[0]?.name, await e.files[0]?.text()]), ['new-active.png', 'wrong-logo']);
  assert.equal(await page.locator('[name=photo]').evaluate(e => e.files.length), 0);
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  console.log('PASS switching ACTIVE profile selects its own logo and fields');
} finally { await context.close(); }
