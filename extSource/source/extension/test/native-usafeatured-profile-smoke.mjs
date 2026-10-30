import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Synthetic form at the reported URL; never contacts USAFeatured or operator storage.
const beforeFix = process.argv.includes('--before-fix');
await mkdir('extension/test/.tmp', { recursive: true });
const dir = await mkdtemp(resolve('extension/test/.tmp/usafeatured-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const url = 'https://usafeatured.com/directory/profileupdate.aspx';
const profile = { id: 'usa-active', businessName: 'Active Plumbing Business', username: 'active-user',
  password: 'synthetic-profile-password', phone: '702-800-0506', email: 'fixture@example.test',
  country: 'United States', state: 'Nevada', stateCode: 'NV', city: 'Las Vegas', updatedAt: '2026-10-21' };
let nonGets = 0;
try {
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (route.request().url() !== url) return route.fulfill({ body: '' });
    return route.fulfill({ contentType: 'text/html', body: `<h1>Profile Update</h1><form method="post">
      <label>Organization<input name="organization"></label><label>Phone<input name="phone"></label>
      <label>Username<input name="username"></label><label>Email<input name="email" type="email"></label>
      <label>Country<select name="country"><option value="ca">Canada</option><option value="us">United States</option></select></label>
      <label>State<select name="state"><option value="">Select State</option></select></label>
      <label>City<select name="city"><option value="">Select City</option></select></label>
      <label>Password<input name="password" type="password" value="human-existing"></label>
      <label>Confirm Password<input name="confirm_password" type="password"></label>
      <input name="captcha" placeholder="CAPTCHA"><button type="submit">Update Profile</button></form>
      <script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};
      document.querySelector('[name=country]').onchange=()=>setTimeout(()=>{document.querySelector('[name=state]').innerHTML='<option value="">Select State</option><option value="nv-live">Nevada</option>';},150);
      document.querySelector('[name=state]').onchange=()=>setTimeout(()=>{document.querySelector('[name=city]').outerHTML='<select name="city"><option value="">Select City</option><option value="vegas-live">Las Vegas</option></select>';},150);
      </script>` });
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0];
  await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'fixture' } }), profile);
  await page.goto(url); await page.locator('#ba2-floating-autofill').waitFor();
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const oldRun = { id: 'existing-login-checkpoint', sourceUrl: url, domain: 'usafeatured.com', tabId,
    profileId: profile.id, stage: 'MANUAL_GATE', awaitingManualResume: true, awaitingManualLogin: true,
    ampBlogsAccountStatus: 'existing', accountStatus: 'existing', autoLogin: false, autoPublish: false,
    navigationCount: 0, steps: [], manual: ['SIGN IN / LOGIN'], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await worker.evaluate(async oldRun => chrome.storage.local.set({ 'ba2.listingRun': oldRun,
    'ba2.loginGuard:preserved': { state: 'uncertain' }, 'ba2.directory3.receipt:preserved': { outcome: 'keep' } }), oldRun);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const snapshot = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const fill = async () => {
    await page.bringToFront();
    return popup.evaluate(() => chrome.runtime.sendMessage({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: false, autoLogin: false, autoRegister: false }));
  };
  if (beforeFix) {
    await fill();
    const run = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']);
    assert.match(JSON.stringify(run.manual), /Login result is not recognized/);
    assert.equal(await page.locator('[name=organization]').inputValue(), '');
    assert.equal(await page.locator('[name=phone]').inputValue(), '');
    console.log('REPRODUCED: logged-in Profile Update fixture enters saved generic login checkpoint; exact reported message, no business fields filled.');
    await worker.evaluate(async tabId => chrome.tabs.sendMessage(tabId, { type: 'BA2_LISTING_AUTOFILL' }, { frameId: 0 }), tabId);
    assert.equal(await page.locator('[name=password]').inputValue(), profile.password);
    console.log('REPRODUCED safety requirement: direct generic mapper writes profile password on Profile Update; needs a page-scoped exclusion.');
  } else {
    for (const active of [profile, { ...profile, id: 'second-active', businessName: 'Different Active Business', phone: '555-0199', username: 'second-user' }]) {
      await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'fixture' } }), active);
      const current = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
      for (let repeat = 0; repeat < 2; repeat++) {
        const ack = await fill(); assert.equal(ack.ok, true, JSON.stringify(ack)); assert.match(ack.message, /filled only/);
        assert.equal(await page.locator('[name=organization]').inputValue(), active.businessName);
        assert.equal(await page.locator('[name=phone]').inputValue(), active.phone);
        assert.equal(await page.locator('[name=username]').inputValue(), active.username);
        assert.equal(await page.locator('[name=country]').inputValue(), 'us');
        assert.equal(await page.locator('[name=state]').inputValue(), 'nv-live');
        assert.equal(await page.locator('[name=city]').inputValue(), 'vegas-live');
        assert.equal(await page.locator('[name=password]').inputValue(), 'human-existing');
        assert.equal(await page.locator('[name=confirm_password]').inputValue(), '');
        assert.equal(await page.locator('[name=captcha]').inputValue(), '');
        assert.equal(await page.evaluate(() => window.submits), 0);
        assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), current);
      }
    }
    assert.ok(snapshot.includes('existing-login-checkpoint'));
    console.log('PASS USAFeatured route bypasses preserved login checkpoint; active profile switches, Organization/Phone/Username, dependent Country-State-City, repeat, empty/existing passwords untouched, no storage writes/submission.');
  }
  assert.equal(page.url(), url); assert.equal(nonGets, 0);
} finally { await context.close(); }
