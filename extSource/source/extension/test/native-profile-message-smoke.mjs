import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Native MV3 delivery in a new isolated profile; never operator Chrome/storage.
// All website traffic is intercepted. No action messages or form interactions.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = join(root, 'test', '.tmp');
await mkdir(temp, { recursive: true });
const profile = await mkdtemp(join(temp, 'native-profile-message-'));
const extension = join(root, 'dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
try {
  await context.route(/^https?:\/\//, route => route.request().url() === 'https://bloguetechno.com/'
    ? route.fulfill({ contentType: 'text/html', body: '<html><body><a href="/login">Login</a><input name="unchanged" value="original"></body></html>' })
    : route.abort());
  const cdp = await context.browser().newBrowserCDPSession();
  const initialWorker = context.waitForEvent('serviceworker').catch(() => null);
  const initialLoad = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const initialPopup = await context.newPage();
  await initialPopup.goto(`chrome-extension://${initialLoad.id}/popup/popup.html`);
  const worker = await initialWorker;
  assert.ok(worker);
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://bloguetechno.com/', { waitUntil: 'load' });
  await page.locator('#ba2-floating-autofill').waitFor();
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    const before = JSON.stringify(await chrome.storage.local.get(null));
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_ACTIVE_PROFILE' }, { frameId: 0 });
    return { response, unchanged: JSON.stringify(await chrome.storage.local.get(null)) === before };
  });
  console.log(JSON.stringify({ nativeResponseType: result.response === null ? 'null' : typeof result.response, unchanged: result.unchanged }));
  assert.equal(typeof result.response?.ok, 'boolean', 'native frame-zero request must receive full content acknowledgement');
  assert.equal(result.unchanged, true);
  assert.equal(await page.locator('input[name=unchanged]').inputValue(), 'original');
  const nextWorker = context.waitForEvent('serviceworker').catch(() => null);
  await cdp.send('Extensions.uninstall', { id: new URL(worker.url()).hostname });
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loaded.id}/popup/popup.html`);
  const restoredWorker = await nextWorker;
  assert.ok(restoredWorker, 'reload worker must restart');
  const afterReload = await restoredWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content/publication-reader.js'] });
    const observed = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_BLOG_OBSERVE' }, { frameId: 0 });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_ACTIVE_PROFILE' }, { frameId: 0 });
    return { response, observedStage: observed.stage };
  });
  console.log(JSON.stringify({ afterReloadProfileType: typeof afterReload.response, observedStage: afterReload.observedStage }));
  assert.equal(afterReload.response, undefined, 'observer-only restoration reproduces exact native empty profile response');
  assert.equal(afterReload.observedStage, 'HOMEPAGE');
  const repaired = await restoredWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    const before = JSON.stringify(await chrome.storage.local.get(null));
    for (let i = 0; i < 2; i++) await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content/content.js'] });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_ACTIVE_PROFILE' }, { frameId: 0 });
    return { response, unchanged: JSON.stringify(await chrome.storage.local.get(null)) === before };
  });
  assert.equal(typeof repaired.response?.ok, 'boolean');
  assert.equal(repaired.unchanged, true);
  assert.equal(await page.locator('input[name=unchanged]').inputValue(), 'original');
  console.log('PASS native MV3: full receiver valid; context replacement plus observer-only recovery yields undefined; idempotent full-entry repair restores profile reply without actions/storage/input changes');
} finally { await context.close(); }
