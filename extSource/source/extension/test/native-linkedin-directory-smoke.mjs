import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Real MV3 transport, synthetic active profiles and intercepted HTML only.
await mkdir('extension/test/.tmp', { recursive: true });
const directory = await mkdtemp(resolve('extension/test/.tmp/linkedin-native-'));
const context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const url = 'http://linkedin-directory.com/submit.php';
let nonGets = 0, unexpected = 0;
try {
  const latestDropdown = process.argv.includes('--latest-dropdown');
  const captured = await readFile('extension/test/family3/fixtures/linkedin-directory.html', 'utf8');
  const fixture = latestDropdown ? captured.replace(/(<select\b[^>]*name=["']?CATEGORY_ID["']?[^>]*>)[\s\S]*?(<\/select>)/i,
    '$1<option value="0">--- Select One ---</option><option value="346">Home Improvement</option><option value="84">Construction and Maintenance</option><option value="337">Domestic Services</option>$2') : captured;
  const instrumentation = `<script>
    window.humanEvents=0;window.submits=0;window.fieldEvents=0;
    document.querySelector('.g-recaptcha').innerHTML='<button type="button">CAPTCHA TRAP</button><textarea hidden name="g-recaptcha-response">human-token-unchanged</textarea><iframe title="reCAPTCHA" srcdoc="Human challenge"></iframe>';
    document.querySelector('[name=CATEGORY_ID]').value='${latestDropdown ? '84' : '37'}';
    for(const type of ['click','focus','focusin','input','change','blur','pointerdown','mousedown'])document.addEventListener(type,event=>{
      if(event.target.closest?.('.g-recaptcha,[name=submit]'))window.humanEvents++;
      if(event.target.matches?.('[name=TITLE],[name=URL],[name=DESCRIPTION],[name=OWNER_NAME],[name=OWNER_EMAIL]'))window.fieldEvents++;
    },true);
    document.addEventListener('submit',event=>{event.preventDefault();window.submits++});
    for(const method of ['submit','requestSubmit'])document.querySelector('form')[method]=()=>{window.submits++};
  </script>`;
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (route.request().url() === url) return route.fulfill({ contentType: 'text/html', body: fixture + instrumentation });
    if (route.request().resourceType() !== 'document') return route.fulfill({ body: '' });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0];
  const base = { id: 'smiley-fixture', businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: latestDropdown ? 'waste management' : 'Plumbing Services',
    services: ['Events'], website: 'https://example.test', contactName: 'Synthetic Owner', email: 'owner@example.test', description: 'Synthetic plumbing description. No live submission.', updatedAt: '2026-10-20' };
  const receipt = { outcome: 'uncertain', claimed: true, runId: 'historical' };
  await worker.evaluate(async ({ profile, receipt }) => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'test' }, 'ba2.directory3.receipt:historical': receipt }), { profile: base, receipt });
  await page.goto(url); await page.locator('#ba2-floating-autofill').waitFor();
  const button = page.locator('#ba2-floating-autofill button');
  async function autofill() {
    await button.click();
    await page.waitForFunction(() => !document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('button').disabled);
    const saved = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(saved['ba2.listingRun'].stage, 'MANUAL_GATE');
    assert.deepEqual(saved['ba2.directory3.receipt:historical'], receipt);
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => window.humanEvents), 0);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(await page.locator('[name=g-recaptcha-response]').inputValue(), 'human-token-unchanged');
    return saved;
  }
  let saved = await autofill();
  assert.match(await page.locator('[name=CATEGORY_ID] option:checked').textContent(), /Home Improvement/);
  if (latestDropdown) {
    assert.equal(await page.locator('[name=CATEGORY_ID] option').count(), 4);
    assert.equal(await page.locator('[name=CATEGORY_ID]').inputValue(), '346');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[name=CATEGORY_ID]').inputValue(), '346');
    console.log('PASS supplied CATEGORY_ID346/84/337: actual Smiley identity recognized, Home Improvement applied and retained');
  }
  assert(!saved['ba2.listingRun'].manual.some(reason => /Category:.*no suitable/i.test(reason)));
  for (const [name, value] of Object.entries({ TITLE: base.businessName, URL: base.website, DESCRIPTION: base.description, OWNER_NAME: base.contactName, OWNER_EMAIL: base.email })) assert.equal(await page.locator(`[name=${name}]`).inputValue(), value);
  console.log('PASS stale Events -> live Home Improvement fallback; all five active plumbing fields correct; CAPTCHA/Continue untouched');

  await page.locator('[name=CATEGORY_ID]').evaluate(select => select.insertAdjacentHTML('beforeend', '<option value="live-plumbing">Plumbing</option><option value="live-roofing">Roofing</option>'));
  const eventsBefore = await page.evaluate(() => window.fieldEvents);
  await autofill();
  assert.equal(await page.locator('[name=CATEGORY_ID]').inputValue(), 'live-plumbing');
  assert.equal(await page.evaluate(() => window.fieldEvents), eventsBefore, 'correct fields are not rewritten');
  for (const [index, category, expected] of [[1, 'Roofing Contractor', 'live-roofing'], [2, 'Plumbing Services', 'changed-plumbing-id'], [3, 'zzzzzz', '0']]) {
    if (index === 2) await page.locator('option[value=live-plumbing]').evaluate(option => { option.value = 'changed-plumbing-id'; });
    const businessName = index === 1 ? 'Example Roofing Business' : index === 2 ? 'Future Plumbing Business' : 'Example Unrelated Business';
    await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'switched' } }), { ...base, id: `active-${index}`, businessName, category });
    saved = await autofill();
    assert.equal(await page.locator('[name=CATEGORY_ID]').inputValue(), expected);
    assert.equal(saved['ba2.listingRun'].profileId, `active-${index}`);
  }
  console.log('PASS same-page ACTIVE profile switches, fresh category IDs, no stale-profile category reuse');

  for (const type of ['BA2_SELECT_ENTRY', 'BA2_SELECT_CATEGORY', 'BA2_AMPBLOGS_SUBMIT_LOGIN', 'BA2_BLOG_PUBLISH_ONCE', 'BA2_LOGIN_WATCH', 'BA2_REGISTRATION_WATCH']) {
    const reply = await worker.evaluate(async type => {
      const [tab] = await chrome.tabs.query({ url: 'http://linkedin-directory.com/submit.php' });
      return chrome.tabs.sendMessage(tab.id, { type, label: 'CAPTCHA TRAP', runId: 'stale-other-family' }, { frameId: 0 });
    }, type);
    assert.equal(reply.ok, false); assert.match(reply.error, /human-only/);
  }
  assert.equal(await page.evaluate(() => window.humanEvents), 0);
  console.log('PASS stale automatic action/watch messages rejected; CAPTCHA trap never clicked or focused');

  const before = await page.locator('form').evaluate(form => [...form.elements].map(element => [element.name, element.value]));
  await cdp.send('Extensions.uninstall', { id });
  await button.click();
  await page.waitForFunction(() => document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('.status').textContent.includes('Refresh this page'));
  assert.equal(await button.isDisabled(), true);
  assert.deepEqual(await page.locator('form').evaluate(form => [...form.elements].map(element => [element.name, element.value])), before);
  assert.equal(await page.evaluate(() => window.humanEvents), 0);
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal(page.url(), url);
  assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  console.log('PASS real extension context invalidation -> disabled AUTOFILL + refresh guidance; no page clicks/focus/changes/submission/navigation or unexpected HTTP');
} finally { await context.close(); }
