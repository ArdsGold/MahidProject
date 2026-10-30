import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

await mkdir('extension/test/.tmp', { recursive: true });
const directory = await mkdtemp(resolve('extension/test/.tmp/family3-captcha-'));
const context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const targets = [
  { url: 'https://expansiondirectory.com/submit.php', file: 'expansion-directory.html' },
  { url: 'http://linkedin-directory.com/submit.php', file: 'linkedin-directory.html' },
];
let unexpected = 0, nonGets = 0;
try {
  const pages = new Map();
  for (const target of targets) {
    const html = await readFile(`extension/test/family3/fixtures/${target.file}`, 'utf8');
    pages.set(target.url, html + `<script>
      window.actions=[];window.capEvents=[];window.submits=0;
      // An inert witness to page-level activation handlers; never load or solve
      // a real CAPTCHA. This tests event leakage, not the live site's handler.
      for(const type of ['pointerdown','mousedown','pointerup','mouseup','click','keydown','keyup','focusin','focusout','blur'])document.addEventListener(type,event=>{
        if(event.target.id==='ba2-floating-autofill')window.actions.push('MAHID event escaped to website: '+type);
        if(event.type==='blur'&&event.target.matches?.('[name=TITLE],[name=URL],[name=DESCRIPTION],[name=OWNER_NAME],[name=OWNER_EMAIL],[name=CATEGORY_ID]'))window.actions.push('Synthetic field blur: '+event.target.name);
      });
      for(const type of ['pointerdown','mousedown','click','focus','focusin','input','change','blur','keydown'])document.addEventListener(type,event=>{
        if(event.target.closest?.('.g-recaptcha,[name=submit]'))window.capEvents.push(type);
      },true);
      document.addEventListener('submit',event=>{event.preventDefault();window.submits++});
      document.querySelector('.g-recaptcha').innerHTML='<textarea name="g-recaptcha-response" hidden>human-token-unchanged</textarea><iframe title="reCAPTCHA" srcdoc="Inert human challenge"></iframe>';
      for(const method of ['submit','requestSubmit'])document.querySelector('form')[method]=()=>{window.submits++};
    </script>`);
  }
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (pages.has(route.request().url())) return route.fulfill({ contentType: 'text/html', body: pages.get(route.request().url()) });
    if (route.request().resourceType() !== 'document') return route.fulfill({ body: '' });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0];
  const profile = { id: 'captcha-fixture', businessName: 'Synthetic Plumbing Business', category: 'Plumbing Services', services: [],
    website: 'https://example.test', contactName: 'Synthetic Owner', email: 'owner@example.test', description: 'Synthetic business description.', updatedAt: '2026-10-20' };
  await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'test' } }), profile);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const failures = [];
  for (const target of targets) {
    await page.goto(target.url); await page.locator('#ba2-floating-autofill').waitFor();
    await page.locator('[name=CATEGORY_ID]').evaluate(select => select.insertAdjacentHTML('beforeend', '<option value="current-plumbing">Plumbing</option>'));
    await page.bringToFront();
    await page.locator('#ba2-floating-autofill button').click();
    await page.waitForFunction(() => !document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('button').disabled);
    const escaped = await page.evaluate(() => window.actions);
    console.log(JSON.stringify({ url: target.url, actionTrace: escaped }));
    if (escaped.length) failures.push(...escaped.map(action => `${target.url}: ${action}`));
    for (const [name, value] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email, CATEGORY_ID: 'current-plumbing' })) assert.equal(await page.locator(`[name=${name}]`).inputValue(), value);
    assert.deepEqual(await page.evaluate(() => window.capEvents), []);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(await page.locator('[name=g-recaptcha-response]').inputValue(), 'human-token-unchanged');
    // Keyboard activation and the existing drag interaction stay usable.
    const button = page.locator('#ba2-floating-autofill button');
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('button').disabled);
    const beforeDrag = await button.boundingBox();
    const runBeforeDrag = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'].id);
    await page.mouse.move(beforeDrag.x + 40, beforeDrag.y + 20); await page.mouse.down();
    await page.mouse.move(beforeDrag.x + 10, beforeDrag.y - 20, { steps: 6 }); await page.mouse.up();
    const afterDrag = await button.boundingBox();
    assert(afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y, 'existing button still drags');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'].id), runBeforeDrag, 'drag never starts autofill');
    // Refill through the popup exercises native field writes without a page click.
    await page.locator('[name=TITLE]').evaluate(input => { input.value = ''; });
    await page.bringToFront(); await popup.evaluate(() => document.getElementById('autofill-button').click());
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled && document.getElementById('result').textContent.trim());
    assert.equal(await page.locator('[name=TITLE]').inputValue(), profile.businessName);
    const afterPopup = await page.evaluate(() => window.actions);
    if (afterPopup.length > escaped.length) failures.push(...afterPopup.slice(escaped.length));
    assert.deepEqual(await page.evaluate(() => window.capEvents), []);
    assert.equal(page.url(), target.url);
  }
  assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  assert.deepEqual(failures, [], 'Family3 UI gestures and artificial blur must not reach website activation handlers');
  console.log('PASS ExpansionDirectory + LinkedIn: floating/popup/keyboard fill, drag preserved, all six fields correct; no leaked UI gesture/synthetic blur/CAPTCHA event/submission/navigation or unexpected HTTP');
} finally { await context.close(); }
