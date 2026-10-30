import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

// Browser plugin not available. Test only synthetic profiles and intercepted forms.
const source = resolve(process.argv[2]);
const temp = await mkdtemp(join(tmpdir(), 'mahid-portable-check-'));
assert(resolve(temp).startsWith(resolve(tmpdir()) + sep + 'mahid-portable-check-'));
const bundle = join(temp, 'Transferred MAHID');
let server, context;
let output = '';
try {
  await cp(source, bundle, { recursive: true, dereference: true });
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Transferred package must not contain machine-specific links.');
      assert(!entry.name.startsWith('.env'), 'Environment files must not be transferred.');
      assert(!['.tmp', '.playwright-profile', '.dev-runtime', '.local-sheets'].includes(entry.name));
      if (entry.isDirectory()) await check(join(directory, entry.name));
    }
  }
  await check(bundle);
  server = spawn(join(bundle, 'runtime/node.exe'), [join(bundle, 'dashboard/web/server.js')], {
    cwd: temp, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3101', NODE_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:3101', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready || server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, `Standalone server failed: ${output}`);
  context = await chromium.launchPersistentContext(join(temp, 'browser'), {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const errors = [];
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:3000/')) {
      return route.fulfill({ response: await route.fetch({ url: url.replace('http://localhost:3000', 'http://127.0.0.1:3101') }) });
    }
    if (url === 'https://portable-fixture.example/') return route.fulfill({
      contentType: 'text/html', body: '<h1>Add Business Listing</h1><form><label>Business Name<input name="businessName"></label><label>Email<input type="email" name="email"></label><button type="submit">Submit</button></form><script>window.submissions=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submissions++}</script>',
    });
    return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: join(bundle, 'extension') });
  const worker = await pending;
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3000/');
  await page.getByRole('button', { name: 'New Profile', exact: true }).click();
  await page.locator('#field-businessName').fill('Portable QA Business');
  await page.locator('#field-email').fill('portable@example.test');
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await page.locator('.saved-item').waitFor();
  const activate = page.getByRole('button', { name: 'Set active', exact: true });
  if (await activate.count()) await activate.click();
  await page.reload();
  await page.getByText('Portable QA Business', { exact: true }).waitFor();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.locator('#sync-button').click();
  await popup.waitForFunction(() => document.querySelector('#profile-status').textContent.includes('Portable QA Business'));
  const form = await context.newPage();
  await form.goto('https://portable-fixture.example/');
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://portable-fixture.example/' });
    return chrome.tabs.sendMessage(tab.id, { type: 'BA2_LISTING_AUTOFILL' });
  });
  assert.equal(result.ok, true);
  assert.equal(await form.locator('[name=businessName]').inputValue(), 'Portable QA Business');
  assert.equal(await form.locator('[name=email]').inputValue(), 'portable@example.test');
  assert.equal(await form.evaluate(() => window.submissions), 0);
  assert.deepEqual(errors, []);
  console.log('PASS relocated ZIP contents: bundled Node standalone server, static assets/hydration, create/save/reload profile, actual packaged MV3 startup, dashboard sync, current-page autofill, zero submission, no page errors, no environment files or machine-specific links.');
} finally {
  if (context) await context.close();
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  await rm(temp, { recursive: true, force: true });
}
